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

logger = logging.getLogger("probe.gemma")

# Fast model (about 3s on a trivial prompt). gemma-4-31b-it measured ~21s and threw 500s.
DEFAULT_MODEL = "gemma-4-26b-a4b-it"

_client: Optional[genai.Client] = None
_client_api_key: Optional[str] = None


def get_genai_client(api_key: str) -> genai.Client:
    """Return a cached genai.Client with a hard per-request timeout (default 10s)."""
    global _client, _client_api_key
    if _client is None or _client_api_key != api_key:
        try:
            timeout_ms = int(os.environ.get("GEMMA_TIMEOUT_MS", "10000"))
        except ValueError:
            timeout_ms = 10000
        _client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=timeout_ms),
        )
        _client_api_key = api_key
    return _client


def extract_token_counts(usage_metadata) -> Tuple[int, int, int]:
    """Safely read (prompt, output, thought) token counts; never crash."""
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
    """True for HTTP 429 / 500 / 503 style errors (rate limit, internal, unavailable)."""
    for attr in ("code", "status_code"):
        if getattr(ex, attr, None) in (429, 500, 503):
            return True
    msg = str(ex).lower()
    return any(
        s in msg
        for s in ("429", "503", "resource_exhausted", "unavailable", "internal error")
    )


def repair_and_parse_json(raw_text: str) -> Optional[dict]:
    """Strip code fences, take the first balanced {...} block, parse it. None on failure."""
    cleaned = (raw_text or "").strip()

    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    if match:
        cleaned = match.group(1).strip()

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
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def clean_reasons(raw_reasons) -> list:
    """Keep at most 3 non-empty reasons, each trimmed to 12 words."""
    out = []
    if isinstance(raw_reasons, list):
        for r in raw_reasons:
            text = str(r).strip()
            if not text:
                continue
            words = text.split()
            if len(words) > 12:
                text = " ".join(words[:12])
            out.append(text)
    return out[:3]


def execute_model_call(client: genai.Client, model: str, prompt: str):
    # thinking_budget=0 is rejected for gemma-4-26b-a4b-it (400 INVALID_ARGUMENT), but
    # thinking_level="minimal" works and cut latency from ~23s to ~3s in our tests.
    config = types.GenerateContentConfig(
        temperature=0.1,
        max_output_tokens=300,
        thinking_config=types.ThinkingConfig(thinking_level="minimal"),
    )
    return client.models.generate_content(model=model, contents=prompt, config=config)


def _log_perf(model_name, t_start, attempts, tokens, source, reason):
    total_ms = int(round((time.perf_counter() - t_start) * 1000))
    prompt_tokens, output_tokens, thought_tokens = tokens
    line = (
        f"[perf] model={model_name} total={total_ms}ms attempts={attempts} "
        f"prompt_tokens={prompt_tokens} output_tokens={output_tokens} "
        f"thought_tokens={thought_tokens} source={source} reason={reason}"
    )
    print(line, flush=True)
    logger.info(line)


def _fallback(pr, model_name, t_start, attempts, reason) -> AnalyzeResponse:
    reason = str(reason).replace("\n", " ")[:150]
    res = run_heuristic_triage(pr, reason)
    _log_perf(model_name, t_start, attempts, (0, 0, 0), "fallback", reason)
    return res


def analyze_pull_request(pr: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze a PR with Gemma, falling back to heuristics on any failure (never raises).

    This is a plain (sync) function: the /analyze endpoint in main.py must be a plain
    `def` (not `async def`) and must call this WITHOUT `await`. FastAPI then runs each
    request in its own worker thread, so concurrent requests really run in parallel.
    """
    t_start = time.perf_counter()
    model_name = os.environ.get("GEMMA_MODEL", "").strip() or DEFAULT_MODEL
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()

    if not api_key:
        return _fallback(pr, model_name, t_start, 0, "GEMINI_API_KEY is missing or empty")

    try:
        client = get_genai_client(api_key)
    except Exception as e:
        return _fallback(pr, model_name, t_start, 0, f"Failed to initialize GenAI client: {e}")

    try:
        prompt = build_pr_analysis_prompt(pr)
    except Exception as e:
        return _fallback(pr, model_name, t_start, 0, f"Failed to build prompt: {e}")

    attempts = 0
    response = None
    call_error: Optional[Exception] = None

    # Retry once, after 1 second, ONLY on 429/500/503. A bad JSON parse is repaired, not retried.
    for attempt in (1, 2):
        attempts = attempt
        try:
            response = execute_model_call(client, model_name, prompt)
            call_error = None
            break
        except Exception as ex:
            call_error = ex
            short = str(ex)[:150].replace("\n", " ")
            print(f"[{ex.__class__.__name__}] attempt {attempt} failed: {short}", flush=True)
            logger.warning("Attempt %s failed (%s): %s", attempt, ex.__class__.__name__, short)
            if attempt == 1 and is_retryable_http_error(ex):
                time.sleep(1.0)
                continue
            break

    if response is None:
        return _fallback(
            pr,
            model_name,
            t_start,
            attempts,
            f"{call_error.__class__.__name__}: {str(call_error)[:150]}",
        )

    tokens = extract_token_counts(getattr(response, "usage_metadata", None))

    try:
        raw_text = response.text or ""
    except Exception:
        raw_text = ""
    parsed = repair_and_parse_json(raw_text)

    source = "gemma"
    reason = "none"
    heuristic_res: Optional[AnalyzeResponse] = None

    def heuristic(why: str) -> AnalyzeResponse:
        nonlocal heuristic_res
        if heuristic_res is None:
            heuristic_res = run_heuristic_triage(pr, why)
        return heuristic_res

    if parsed is None:
        source = "fallback"
        reason = "JSON parse failed"
        h = heuristic("repair: full JSON parse failed")
        spam_score = h.spam_score
        reasons = h.reasons
        suggested_action = h.suggested_action
        label = h.label
    else:
        # spam_score: use the model's value if valid, else the heuristic's
        try:
            spam_score = max(0, min(100, int(round(float(parsed.get("spam_score"))))))
        except (ValueError, TypeError):
            spam_score = heuristic("repair: missing or invalid spam_score").spam_score

        # reasons: trimmed model reasons, else the heuristic's
        reasons = clean_reasons(parsed.get("reasons"))
        if not reasons:
            reasons = heuristic("repair: missing or empty reasons").reasons[:3]

        # An author with a merged PR in this repo is much less likely to be spam
        if pr.context:
            merged_prs = pr.context.get("author_merged_prs_in_repo")
            if merged_prs is not None:
                try:
                    if int(merged_prs) >= 1:
                        spam_score = max(0, spam_score - 20)
                except (ValueError, TypeError):
                    pass

        # The label is always computed in code from the score, never trusted from the model
        label = compute_label(spam_score)
        suggested_action = derive_suggested_action(
            label=label,
            suggested_action=parsed.get("suggested_action"),
        )

    if not reasons:
        reasons = [f"PR evaluated with spam score {spam_score}/100"]

    res = AnalyzeResponse(
        label=label,
        spam_score=spam_score,
        reasons=reasons[:3],
        suggested_action=suggested_action,
    )
    _log_perf(model_name, t_start, attempts, tokens, source, reason)
    return res