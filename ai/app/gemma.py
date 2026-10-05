import json
import logging
import os
import re
import time
from typing import Optional, Tuple

from google import genai
from google.genai import types
from app.heuristics import (
    compute_label,
    derive_suggested_action,
    run_heuristic_triage,
)
from app.prompts import build_pr_analysis_prompt
from app.schemas import AnalyzeRequest, AnalyzeResponse

logger = logging.getLogger("prsift.gemma")


def extract_token_counts(usage_metadata) -> Tuple[int, int, int]:
    """Safely extract token counts from response.usage_metadata without crashing."""
    if not usage_metadata:
        return 0, 0, 0
    prompt_tokens = (
        getattr(usage_metadata, "prompt_token_count", None)
        or getattr(usage_metadata, "prompt_tokens", None)
        or 0
    )
    output_tokens = (
        getattr(usage_metadata, "candidates_token_count", None)
        or getattr(usage_metadata, "output_token_count", None)
        or getattr(usage_metadata, "output_tokens", None)
        or 0
    )
    thought_tokens = (
        getattr(usage_metadata, "thoughts_token_count", None)
        or getattr(usage_metadata, "thought_token_count", None)
        or getattr(usage_metadata, "thought_tokens", None)
        or 0
    )
    return int(prompt_tokens), int(output_tokens), int(thought_tokens)


def is_retryable_http_error(ex: Exception) -> bool:
    """Check if exception corresponds to HTTP 429, 500, or 503."""
    code = getattr(ex, "code", None)
    if code in (429, 500, 503):
        return True
    status = getattr(ex, "status_code", None)
    if status in (429, 500, 503):
        return True
    msg = str(ex).lower()
    for code_str in ("429", "500", "503", "resource_exhausted", "unavailable"):
        if code_str in msg:
            return True
    return False


def repair_and_parse_json(raw_text: str) -> Optional[dict]:
    """
    Repair model output:
    - strip markdown code fences
    - extract the first {...} block (matching braces)
    - parse JSON dict
    """
    cleaned = raw_text.strip()

    # Strip code block fences if present (```json ... ``` or ``` ... ```)
    fence_pattern = r"```(?:json)?\s*([\s\S]*?)\s*```"
    match = re.search(fence_pattern, cleaned, re.IGNORECASE)
    if match:
        cleaned = match.group(1).strip()

    # Take first {...} block
    start_idx = cleaned.find("{")
    if start_idx == -1:
        return None

    depth = 0
    in_str = False
    esc = False
    end_idx = -1
    for i in range(start_idx, len(cleaned)):
        c = cleaned[i]
        if esc:
            esc = False
            continue
        if c == "\\":
            if in_str:
                esc = True
            continue
        if c == '"':
            in_str = not in_str
            continue
        if not in_str:
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end_idx = i
                    break

    if end_idx != -1:
        json_str = cleaned[start_idx : end_idx + 1]
    else:
        r_idx = cleaned.rfind("}")
        json_str = cleaned[start_idx : r_idx + 1] if r_idx > start_idx else cleaned[start_idx:]

    try:
        data = json.loads(json_str)
        if isinstance(data, dict):
            return data
        return None
    except Exception:
        return None


def execute_model_call(
    client: genai.Client,
    model: str,
    prompt: str,
):
    # Note on thinking setting:
    # types.ThinkingConfig(thinking_budget=0) is rejected by API for gemma-4-26b-a4b-it
    # with 400 INVALID_ARGUMENT ("Thinking budget is not supported for this model.").
    # However, types.ThinkingConfig(thinking_level="minimal") is supported by the SDK & API
    # and successfully cuts thinking tokens to 0, reducing latency from ~23s to ~3s.
    config = types.GenerateContentConfig(
        temperature=0.1,
        max_output_tokens=300,
        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
    )
    return client.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )


def analyze_pull_request(pr: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze a PR using the Gemma 4 model with fallback to heuristics.
    Instruments latency, token counts, and prints a single [perf] log line per request.
    """
    t_start = time.perf_counter()
    model_name = os.environ.get("GEMMA_MODEL", "gemma-4-26b-a4b-it").strip() or "gemma-4-26b-a4b-it"

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        fallback_reason = "GEMINI_API_KEY environment variable is missing or empty"
        res = run_heuristic_triage(pr, fallback_reason)
        total_ms = int(round((time.perf_counter() - t_start) * 1000))
        perf_line = (
            f"[perf] model={model_name} total={total_ms}ms attempts=0 "
            f"prompt_tokens=0 output_tokens=0 thought_tokens=0 "
            f"source=fallback reason={fallback_reason}"
        )
        print(perf_line, flush=True)
        return res

    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        fallback_reason = f"Failed to initialize GenAI client: {e}"
        res = run_heuristic_triage(pr, fallback_reason)
        total_ms = int(round((time.perf_counter() - t_start) * 1000))
        perf_line = (
            f"[perf] model={model_name} total={total_ms}ms attempts=0 "
            f"prompt_tokens=0 output_tokens=0 thought_tokens=0 "
            f"source=fallback reason={fallback_reason}"
        )
        print(perf_line, flush=True)
        return res

    prompt = build_pr_analysis_prompt(pr)

    attempts = 0
    response = None
    call_error: Optional[Exception] = None

    # Retry ONLY on HTTP 429/500/503, once, after 1 second
    for attempt in range(1, 3):
        attempts = attempt
        try:
            response = execute_model_call(
                client=client,
                model=model_name,
                prompt=prompt,
            )
            call_error = None
            break
        except Exception as ex:
            call_error = ex
            err_msg_150 = str(ex)[:150].replace("\n", " ")
            print(f"[{ex.__class__.__name__}] Attempt {attempt} failed: {err_msg_150}", flush=True)
            logger.warning(f"Attempt {attempt} failed ({ex.__class__.__name__}): {err_msg_150}")

            if attempt == 1 and is_retryable_http_error(ex):
                time.sleep(1.0)
                continue
            else:
                break

    # If all model attempts failed, use heuristic fallback
    if response is None:
        fallback_reason = f"{call_error.__class__.__name__}: {str(call_error)[:150].replace(chr(10), ' ')}"
        res = run_heuristic_triage(pr, fallback_reason)
        total_ms = int(round((time.perf_counter() - t_start) * 1000))
        perf_line = (
            f"[perf] model={model_name} total={total_ms}ms attempts={attempts} "
            f"prompt_tokens=0 output_tokens=0 thought_tokens=0 "
            f"source=fallback reason={fallback_reason}"
        )
        print(perf_line, flush=True)
        return res

    # Model call succeeded - extract tokens
    prompt_tokens, output_tokens, thought_tokens = extract_token_counts(
        getattr(response, "usage_metadata", None)
    )

    # Parse and repair JSON without retrying
    raw_text = response.text or ""
    parsed = repair_and_parse_json(raw_text)

    source = "gemma"
    reason = "none"

    # If JSON parse failed or missing keys, fill from heuristic fallback
    heuristic_res: Optional[AnalyzeResponse] = None
    if parsed is None:
        source = "fallback"
        reason = "JSON parse failed"
        heuristic_res = run_heuristic_triage(pr, "repair: full JSON parse failed")
        spam_score = heuristic_res.spam_score
        reasons = heuristic_res.reasons
        suggested_action = heuristic_res.suggested_action
        label = heuristic_res.label
    else:
        # Check spam_score
        raw_score = parsed.get("spam_score")
        if raw_score is not None:
            try:
                spam_score = max(0, min(100, int(round(float(raw_score)))))
            except (ValueError, TypeError):
                if heuristic_res is None:
                    heuristic_res = run_heuristic_triage(pr, "repair: invalid spam_score")
                spam_score = heuristic_res.spam_score
        else:
            if heuristic_res is None:
                heuristic_res = run_heuristic_triage(pr, "repair: missing spam_score")
            spam_score = heuristic_res.spam_score

        # Check reasons
        raw_reasons = parsed.get("reasons")
        if isinstance(raw_reasons, list) and raw_reasons:
            reasons = [str(r).strip() for r in raw_reasons if str(r).strip()][:3]
            if not reasons:
                if heuristic_res is None:
                    heuristic_res = run_heuristic_triage(pr, "repair: empty reasons")
                reasons = heuristic_res.reasons[:3]
        else:
            if heuristic_res is None:
                heuristic_res = run_heuristic_triage(pr, "repair: missing reasons")
            reasons = heuristic_res.reasons[:3]

        # Author merged PRs in repo discount rule
        if pr.context:
            merged_prs = pr.context.get("author_merged_prs_in_repo")
            if merged_prs is not None:
                try:
                    if int(merged_prs) >= 1:
                        spam_score = max(0, spam_score - 20)
                except (ValueError, TypeError):
                    pass

        label = compute_label(spam_score)
        suggested_action = derive_suggested_action(
            label=label,
            suggested_action=parsed.get("suggested_action"),
        )

    # Ensure reasons is at most 3 and non-empty
    if not reasons:
        reasons = [f"PR evaluated with spam score {spam_score}/100"]
    reasons = reasons[:3]

    res = AnalyzeResponse(
        label=label,
        spam_score=spam_score,
        reasons=reasons,
        suggested_action=suggested_action,
    )

    total_ms = int(round((time.perf_counter() - t_start) * 1000))
    perf_line = (
        f"[perf] model={model_name} total={total_ms}ms attempts={attempts} "
        f"prompt_tokens={prompt_tokens} output_tokens={output_tokens} "
        f"thought_tokens={thought_tokens} source={source} reason={reason}"
    )
    print(perf_line, flush=True)

    return res
