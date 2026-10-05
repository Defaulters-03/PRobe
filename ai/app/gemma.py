import asyncio
import json
import logging
import os
import re
import time
from typing import Optional

from google import genai
from google.genai import types
from app.heuristics import (
    compute_label,
    derive_suggested_action,
    run_heuristic_triage,
)
from app.prompts import build_pr_analysis_prompt
from app.schemas import AnalyzeRequest, AnalyzeResponse, GemmaRawOutput

logger = logging.getLogger("prsift.gemma")

_client: Optional[genai.Client] = None
_client_api_key: Optional[str] = None


def get_genai_client(api_key: str) -> genai.Client:
    """Return a cached, reusable genai.Client instance."""
    global _client, _client_api_key
    if _client is None or _client_api_key != api_key:
        _client = genai.Client(api_key=api_key)
        _client_api_key = api_key
    return _client


def parse_model_response(raw_text: str) -> GemmaRawOutput:
    """
    Robustly parse the model response:
    - strip markdown code block fences
    - extract the first {...} block
    - validate with pydantic
    """
    cleaned = (raw_text or "").strip()

    # Strip code block fences if present (```json ... ``` or ``` ... ```)
    fence_pattern = r"```(?:json)?\s*([\s\S]*?)\s*```"
    match = re.search(fence_pattern, cleaned, re.IGNORECASE)
    if match:
        cleaned = match.group(1).strip()

    # Extract JSON object starting with first { and ending with last }
    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        raise ValueError(f"Could not locate valid JSON object in response: {cleaned[:200]}")

    json_str = cleaned[start_idx : end_idx + 1]
    parsed_json = json.loads(json_str)

    # Validate with GemmaRawOutput schema
    return GemmaRawOutput.model_validate(parsed_json)


def _is_rate_limit_or_unavailable(exc: Exception) -> bool:
    """Check if exception represents HTTP 429 (rate limit) or 503 (unavailable)."""
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code in (429, 503):
        return True
    err_str = str(exc).lower()
    return any(
        x in err_str
        for x in ["429", "503", "resource_exhausted", "unavailable", "rate limit"]
    )


async def analyze_pull_request(pr: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze a PR using the Gemma 4 async client with fallback to heuristics.
    Non-blocking async call, overall 10s timeout, retries once after 1s only on 429/503.
    """
    start_time = time.perf_counter()
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    model_name = os.environ.get("GEMMA_MODEL", "gemma-4-31b-it").strip() or "gemma-4-31b-it"

    def _finish(resp: AnalyzeResponse, source: str) -> AnalyzeResponse:
        elapsed_ms = int(round((time.perf_counter() - start_time) * 1000))
        perf_msg = f"[perf] /analyze {elapsed_ms}ms model={model_name} source={source}"
        print(perf_msg, flush=True)
        logger.info(perf_msg)
        return resp

    if not api_key:
        fallback = run_heuristic_triage(
            pr, "GEMINI_API_KEY environment variable is missing or empty"
        )
        return _finish(fallback, "fallback")

    try:
        client = get_genai_client(api_key)
    except Exception as e:
        fallback = run_heuristic_triage(pr, f"Failed to initialize GenAI client: {e}")
        return _finish(fallback, "fallback")

    try:
        prompt = build_pr_analysis_prompt(pr)
    except Exception as e:
        fallback = run_heuristic_triage(pr, f"Failed to build prompt: {e}")
        return _finish(fallback, "fallback")

    config = types.GenerateContentConfig(
        temperature=0.1,
        max_output_tokens=300,
        thinking_config=types.ThinkingConfig(
            thinking_level=types.ThinkingLevel.MINIMAL
        ),
    )

    overall_deadline = start_time + 10.0
    last_error: Optional[Exception] = None

    for attempt in range(1, 3):
        remaining_timeout = overall_deadline - time.perf_counter()
        if remaining_timeout <= 0.2:
            last_error = TimeoutError("Overall 10s request budget exhausted")
            break

        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=config,
                ),
                timeout=remaining_timeout,
            )
            raw_text = response.text or ""
            raw_output = parse_model_response(raw_text)

            # Raw spam score bounded 0-100
            spam_score = max(0, min(100, int(round(raw_output.spam_score))))

            # If context.author_merged_prs_in_repo >= 1, subtract 20 from spam_score in code after parsing (floor 0)
            if pr.context:
                merged_prs = pr.context.get("author_merged_prs_in_repo")
                if merged_prs is not None:
                    try:
                        if int(merged_prs) >= 1:
                            spam_score = max(0, spam_score - 20)
                    except (ValueError, TypeError):
                        pass

            # Compute label in code from spam_score
            label = compute_label(spam_score)

            # Derive suggested_action from label if missing or invalid
            suggested_action = derive_suggested_action(
                label=label,
                suggested_action=raw_output.suggested_action,
            )

            # Clean and cap reasons to max 3 short strings of at most 12 words
            clean_reasons = []
            for r in raw_output.reasons:
                text = str(r).strip()
                if text:
                    words = text.split()
                    if len(words) > 12:
                        text = " ".join(words[:12])
                    clean_reasons.append(text)
            reasons = clean_reasons[:3]

            if not reasons:
                reasons = [f"PR evaluated with spam score {spam_score}/100"]

            res = AnalyzeResponse(
                label=label,
                spam_score=spam_score,
                reasons=reasons,
                suggested_action=suggested_action,
            )
            return _finish(res, "gemma")

        except asyncio.TimeoutError as te:
            last_error = te
            logger.warning(f"Gemma model call attempt {attempt} timed out")
            break
        except Exception as ex:
            last_error = ex
            logger.warning(f"Gemma model call attempt {attempt} failed: {ex}")
            # Retry once after 1s only on HTTP 429/503
            if attempt == 1 and _is_rate_limit_or_unavailable(ex):
                await asyncio.sleep(1.0)
                continue
            break

    # On timeout or any error return heuristic fallback (never a 500)
    fallback = run_heuristic_triage(
        pr, f"Model call failed or timed out: {last_error}"
    )
    return _finish(fallback, "fallback")
