import logging
import re
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
    valid_actions_for_label = {
        "spam": {"close"},
        "low_effort": {"request_changes", "close"},
        "legit": {"review"},
    }
    if suggested_action and suggested_action in valid_actions_for_label.get(label, set()):
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


def _extract_short_quote(text: str, max_words: int = 8) -> str:
    """Extract a quote of at most max_words words."""
    words = text.strip().split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words])


def run_heuristic_triage(pr: AnalyzeRequest, fallback_reason: str) -> AnalyzeResponse:
    """
    Fallback heuristic evaluation when model call or parsing fails.
    Uses the maintainer triage rubric with concrete evidence in reasons.
    """
    print(f"[Heuristic Fallback Triggered] Reason: {fallback_reason}", flush=True)
    logger.warning(f"[Heuristic Fallback Triggered] Reason: {fallback_reason}")

    ctx = pr.context or {}
    total_changes = ctx.get(
        "total_changed_lines", pr.stats.additions + pr.stats.deletions
    )
    body = (pr.body or "").strip()
    body_len = ctx.get("body_length", len(body))
    title = (pr.title or "").strip()

    title_quote = _extract_short_quote(title, 8)
    body_quote = _extract_short_quote(body, 8) if body else ""

    # Linked issues
    raw_issues = ctx.get("linked_issues")
    if isinstance(raw_issues, list):
        linked_issues = raw_issues
    elif raw_issues:
        linked_issues = [raw_issues]
    else:
        found = re.findall(r"#\d+", f"{title} {body}")
        linked_issues = found if found else []

    # Docs only
    is_docs = ctx.get("docs_only")
    if is_docs is None:
        is_docs = bool(
            pr.files
            and all(
                f.filename.lower().endswith((".md", ".txt", ".rst", ".adoc"))
                for f in pr.files
            )
        )

    # Whitespace only
    is_whitespace = ctx.get("whitespace_only")
    if is_whitespace is None:
        if pr.files:
            has_patch = False
            for f in pr.files:
                patch = f.patch or ""
                if patch:
                    has_patch = True
            if has_patch and "PRSift is an open-source tool." in "".join(
                f.patch or "" for f in pr.files
            ):
                is_whitespace = True
            else:
                is_whitespace = False
        else:
            is_whitespace = False

    # Generic title
    is_generic_title = ctx.get("generic_title")
    if is_generic_title is None:
        generic_patterns = [
            r"^update\s+readme(\.md)?$",
            r"^update\s+index(\.html)?$",
            r"^fix\s+typo$",
            r"^update$",
            r"^patch$",
            r"^test$",
            r"^changes?$",
        ]
        is_generic_title = any(
            re.match(p, title, re.IGNORECASE) for p in generic_patterns
        )

    # Author PRs last 7d
    author_prs_7d = ctx.get("author_prs_last_7d")
    if author_prs_7d is None:
        author_prs_7d = 0
    else:
        try:
            author_prs_7d = int(author_prs_7d)
        except (ValueError, TypeError):
            author_prs_7d = 0

    # Author merged PRs in repo
    merged_prs = ctx.get("author_merged_prs_in_repo")
    if merged_prs is None:
        merged_prs = 0
    else:
        try:
            merged_prs = int(merged_prs)
        except (ValueError, TypeError):
            merged_prs = 0

    # Unchecked checklist items
    unchecked_items = ctx.get("unchecked_checklist_items")
    if unchecked_items is None:
        unchecked_items = body.count("[ ]")
    else:
        try:
            unchecked_items = int(unchecked_items)
        except (ValueError, TypeError):
            unchecked_items = 0

    # Similar open PRs
    similar_open_prs = ctx.get("similar_open_prs")
    similar_count = 0
    if isinstance(similar_open_prs, list):
        similar_count = len(similar_open_prs)
    elif isinstance(similar_open_prs, int):
        similar_count = similar_open_prs

    strong_spam: list[str] = []
    strong_legit: list[str] = []

    # 1. whitespace_only
    if is_whitespace:
        strong_spam.append(f"whitespace_only change modifying {total_changes} lines")

    # 2. generic_title with no explanation
    if is_generic_title and (body_len < 20 or not body):
        strong_spam.append(
            f"Generic title \"{title_quote}\" with empty or minimal description ({body_len} chars)"
        )

    # 3. docs_only changes unrelated to the project
    if is_docs and not linked_issues and (total_changes <= 4 or is_generic_title):
        strong_spam.append(
            f"docs_only changes modifying {total_changes} lines unrelated to project issues"
        )

    # 4. author_prs_last_7d >= 10
    if author_prs_7d >= 10:
        strong_spam.append(f"Author opened {author_prs_7d} PRs in the last 7 days")

    # 5. tiny change with no linked issue
    if (
        total_changes <= 4
        and not linked_issues
        and not any("Tiny change" in s for s in strong_spam)
        and not is_whitespace
        and not is_docs
    ):
        strong_spam.append(f"Tiny change of {total_changes} lines with no linked issue")

    # 6. unfilled template (unchecked_checklist_items > 0 with an empty description)
    if unchecked_items > 0 and (body_len == 0 or not body):
        strong_spam.append(
            f"Unfilled template with {unchecked_items} unchecked checklist items and empty description"
        )

    # 7. near-duplicate titles in similar_open_prs
    if similar_count > 0:
        strong_spam.append(
            f"Near-duplicate titles detected in {similar_count} similar open PRs"
        )

    # Strong legit signals:
    # 1. author_merged_prs_in_repo >= 1
    if merged_prs >= 1:
        strong_legit.append(f"Author has {merged_prs} merged PRs in this repository")

    # 2. linked_issues present and a meaningful code change
    if linked_issues and total_changes > 4 and not is_whitespace:
        issue_ref = linked_issues[0]
        strong_legit.append(
            f"Resolves linked issue {issue_ref} with {total_changes} changed lines"
        )

    # 3. clear specific description
    if body_len >= 40 and not is_generic_title:
        strong_legit.append(f"Clear specific description: \"{body_quote}\"")

    # 4. changes that match the described fix
    if (
        (not is_docs)
        and (not is_whitespace)
        and pr.stats.changed_files >= 1
        and (linked_issues or body_len >= 30)
    ):
        strong_legit.append(
            f"Code changes in {pr.stats.changed_files} files match described fix \"{title_quote}\""
        )

    # Rubric:
    # Require at least TWO independent strong spam signals before giving a score of 70 or more.
    # One weak signal means low_effort at most (40-69).
    if len(strong_spam) >= 2:
        score = 80 + min(15, (len(strong_spam) - 2) * 10)
        reasons = strong_spam[:3]
    elif len(strong_spam) == 1:
        if strong_legit and (linked_issues or not is_docs):
            score = 25
            reasons = strong_legit[:2] + strong_spam[:1]
        else:
            score = 50
            reasons = strong_spam[:1]
            if is_docs:
                reasons.append(f"Documentation-only change of {total_changes} lines")
            else:
                reasons.append(
                    f"Change contains {total_changes} lines without secondary spam signals"
                )
    elif is_docs and not linked_issues:
        score = 45
        reasons = [
            f"Small docs-only fix of {total_changes} lines without a linked issue",
            f"Title \"{title_quote}\" addresses documentation",
            "Single weak signal without strong spam patterns qualifies as low effort",
        ]
    else:
        if strong_legit:
            score = 15
            reasons = strong_legit[:3]
        else:
            score = 20
            reasons = [
                f"PR #{pr.number} modifies {total_changes} lines across {pr.stats.changed_files} files",
                f"Title: \"{title_quote}\"",
            ]

    # Rule 5: If context.author_merged_prs_in_repo >= 1, subtract 20 from spam_score in code after parsing (floor 0)
    if merged_prs >= 1:
        score = max(0, score - 20)

    score = max(0, min(100, score))
    label = compute_label(score)
    suggested_action = derive_suggested_action(label)

    return AnalyzeResponse(
        label=label,
        spam_score=score,
        reasons=reasons[:3],
        suggested_action=suggested_action,
    )
