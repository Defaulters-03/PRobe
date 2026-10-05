import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from app.schemas import AnalyzeRequest, AnalyzeResponse

logger = logging.getLogger("prsift.heuristics")


def compute_label(spam_score: int) -> Literal["spam", "low_effort", "legit"]:
    """Compute triage label from spam score."""
    if spam_score >= 70:
        return "spam"
    elif spam_score >= 40:
        return "low_effort"
    else:
        return "legit"


def derive_suggested_action(
    label: Literal["spam", "low_effort", "legit"],
    suggested_action: Optional[str] = None,
) -> Literal["close", "request_changes", "review"]:
    """
    Derive suggested action from label if model output is missing or invalid.
    spam -> close, low_effort -> request_changes, legit -> review.
    """
    valid_actions = {"close", "request_changes", "review"}
    if suggested_action and suggested_action in valid_actions:
        return suggested_action  # type: ignore

    if label == "spam":
        return "close"
    elif label == "low_effort":
        return "request_changes"
    else:
        return "review"


def is_account_under_30_days(account_created_at_str: str, pr_created_at_str: str) -> bool:
    """Check if the author account was created less than 30 days prior to PR creation."""
    try:
        acc_str = account_created_at_str.replace("Z", "+00:00")
        pr_str = pr_created_at_str.replace("Z", "+00:00")

        acc_dt = datetime.fromisoformat(acc_str)
        if acc_dt.tzinfo is None:
            acc_dt = acc_dt.replace(tzinfo=timezone.utc)

        try:
            pr_dt = datetime.fromisoformat(pr_str)
            if pr_dt.tzinfo is None:
                pr_dt = pr_dt.replace(tzinfo=timezone.utc)
        except Exception:
            pr_dt = datetime.now(timezone.utc)

        diff_days = (pr_dt - acc_dt).total_seconds() / 86400.0
        return diff_days < 30.0
    except Exception:
        return False


def run_heuristic_triage(pr: AnalyzeRequest, fallback_reason: str) -> AnalyzeResponse:
    """
    Fallback heuristic evaluation when model call or parsing fails.
    Rules:
      - score = 0
      - +40 if additions + deletions <= 4
      - +25 if body shorter than 20 chars
      - +20 if all files end in .md or .txt
      - +15 if author account is under 30 days old
      - clamp 0-100
      - one reason per rule that fired
      - log fallback reason to console
    """
    print(f"[Heuristic Fallback Triggered] Reason: {fallback_reason}", flush=True)
    logger.warning(f"[Heuristic Fallback Triggered] Reason: {fallback_reason}")

    score = 0
    reasons: list[str] = []

    # Rule 1: +40 if additions+deletions <= 4
    total_changes = pr.stats.additions + pr.stats.deletions
    if total_changes <= 4:
        score += 40
        reasons.append("Very small change (<= 4 changed lines)")

    # Rule 2: +25 if body shorter than 20 chars
    body_text = (pr.body or "").strip()
    if len(body_text) < 20:
        score += 25
        reasons.append("PR description is under 20 characters")

    # Rule 3: +20 if all files end in .md or .txt
    if pr.files and all(f.filename.lower().endswith((".md", ".txt")) for f in pr.files):
        score += 20
        reasons.append("All changed files are documentation or text files (.md, .txt)")

    # Rule 4: +15 if author account is under 30 days old
    if is_account_under_30_days(pr.author.account_created_at, pr.created_at):
        score += 15
        reasons.append("Author account is under 30 days old")

    # Clamp 0-100
    score = max(0, min(100, score))

    if not reasons:
        reasons.append("Substantial code changes with descriptive PR details")

    # Keep at most 3 reasons
    reasons = reasons[:3]

    label = compute_label(score)
    suggested_action = derive_suggested_action(label)

    return AnalyzeResponse(
        label=label,
        spam_score=score,
        reasons=reasons,
        suggested_action=suggested_action,
    )
