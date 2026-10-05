import asyncio
import json
import logging
import os
import re
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


def parse_model_response(raw_text: str) -> GemmaRawOutput:
    """
    Robustly parse the model response:
    - strip markdown code block fences
    - extract the first {...} block
    - validate with pydantic
    """
    cleaned = raw_text.strip()

    # Strip code block fences if present (```json ... ``` or ``` ... ```)
    fence_pattern = r"```(?:json)?\s*([\s\S]*?)\s*```"
    match = re.search(fence_pattern, cleaned, re.IGNORECASE)
    if match:
        cleaned = match.group(1).strip()

    # Extract JSON object starting with first { and ending with last }
    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        raise ValueError(f"Could not locate valid JSON object in response: {raw_text[:200]}")

    json_str = cleaned[start_idx : end_idx + 1]
    parsed_json = json.loads(json_str)

    # Validate with GemmaRawOutput schema
    return GemmaRawOutput.model_validate(parsed_json)


async def execute_model_call(
    client: genai.Client,
    model: str,
    prompt: str,
    timeout: float = 30.0,
) -> str:
    """Execute generate_content in a thread pool with temperature=0.1 and strict 30s timeout."""
    loop = asyncio.get_running_loop()

    def _call() -> str:
        config = types.GenerateContentConfig(temperature=0.1)
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        return response.text or ""

    return await asyncio.wait_for(loop.run_in_executor(None, _call), timeout=timeout)


async def analyze_pull_request(pr: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze a PR using the Gemma 4 model with fallback to heuristics.
    Retries once on call/parse failure before falling back.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return run_heuristic_triage(
            pr, "GEMINI_API_KEY environment variable is missing or empty"
        )

    model_name = os.environ.get("GEMMA_MODEL", "gemma-4-31b-it").strip() or "gemma-4-31b-it"

    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        return run_heuristic_triage(pr, f"Failed to initialize GenAI client: {e}")

    prompt = build_pr_analysis_prompt(pr)

    last_error: Optional[Exception] = None

    # Call with 1 retry (total 2 attempts)
    for attempt in range(1, 3):
        try:
            raw_text = await execute_model_call(
                client=client,
                model=model_name,
                prompt=prompt,
                timeout=30.0,
            )
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

            # Compute label in code from spam_score (do NOT trust model's label)
            label = compute_label(spam_score)

            # Derive suggested_action from label if missing or invalid
            suggested_action = derive_suggested_action(
                label=label,
                suggested_action=raw_output.suggested_action,
            )

            # Clean and cap reasons to max 3 short strings
            reasons = [
                str(r).strip()
                for r in raw_output.reasons
                if str(r).strip()
            ][:3]

            if not reasons:
                reasons = [f"PR evaluated with spam score {spam_score}/100"]

            return AnalyzeResponse(
                label=label,
                spam_score=spam_score,
                reasons=reasons,
                suggested_action=suggested_action,
            )

        except asyncio.TimeoutError as te:
            last_error = te
            print(f"[Gemma Model Call] Attempt {attempt} timed out after 30s", flush=True)
            logger.warning(f"Gemma model call attempt {attempt} timed out")
        except Exception as ex:
            last_error = ex
            print(f"[Gemma Model Call] Attempt {attempt} failed: {ex}", flush=True)
            logger.warning(f"Gemma model call attempt {attempt} failed: {ex}")

    # If both attempts failed or parsing failed twice, return heuristic fallback
    return run_heuristic_triage(
        pr, f"Model call or response parsing failed after 2 attempts: {last_error}"
    )
