import re
from pathlib import Path
from app.schemas import AnalyzeRequest


def build_pr_analysis_prompt(pr: AnalyzeRequest) -> str:
    """
    Constructs an optimized, token-efficient prompt for Gemma 4 containing
    essential facts, maintainer rubric, compact examples, and expected JSON output.
    """
    ctx = pr.context or {}

    body_text = (pr.body or "").strip()
    body_length = ctx.get("body_length", len(body_text))
    body_snippet = body_text[:300] + ("..." if len(body_text) > 300 else "")

    unchecked_checklist = ctx.get("unchecked_checklist_items", 0)

    raw_issues = ctx.get("linked_issues")
    if isinstance(raw_issues, list):
        linked_issues = raw_issues
    elif raw_issues:
        linked_issues = [raw_issues]
    else:
        found = re.findall(r"#\d+", f"{pr.title} {body_text}")
        linked_issues = found if found else []

    author_assoc = ctx.get("author_association", "NONE")
    head_branch = ctx.get("head_branch", "unknown")
    is_fork = ctx.get("is_fork", False)

    generic_title = ctx.get("generic_title")
    if generic_title is None:
        title_lower = pr.title.lower().strip()
        generic_title = title_lower in [
            "update readme.md",
            "update",
            "fix typo",
            "patch",
            "test",
            "update index.html",
        ]

    whitespace_only = ctx.get("whitespace_only", False)

    docs_only = ctx.get("docs_only")
    if docs_only is None:
        docs_only = bool(
            pr.files
            and all(
                f.filename.lower().endswith((".md", ".txt", ".rst", ".adoc"))
                for f in pr.files
            )
        )

    file_extensions = ctx.get("file_extensions")
    if not file_extensions:
        file_extensions = sorted(
            list({Path(f.filename).suffix for f in pr.files if Path(f.filename).suffix})
        )

    similar_prs = ctx.get("similar_open_prs", [])
    similar_count = len(similar_prs) if isinstance(similar_prs, list) else similar_prs

    total_changed_lines = ctx.get(
        "total_changed_lines", pr.stats.additions + pr.stats.deletions
    )
    author_prs_7d = ctx.get("author_prs_last_7d", 0)
    merged_prs = ctx.get("author_merged_prs_in_repo", 0)

    # Compact file diffs: max 2 files, 400 chars patch each
    files_summary = []
    for f in pr.files[:2]:
        patch = (f.patch or "").strip()
        if len(patch) > 400:
            patch = patch[:400] + "\n...[truncated]..."
        files_summary.append(f"{f.filename} (+{f.additions}/-{f.deletions}):\n{patch}")
    if len(pr.files) > 2:
        files_summary.append(f"...and {len(pr.files) - 2} more files")
    files_str = "\n".join(files_summary) if files_summary else "No diffs."

    return f"""You are an open-source maintainer triaging PRs for spam/low-effort vs legitimate contributions.

FACTS:
- PR #{pr.number}: "{pr.title}" (generic_title={generic_title})
- Description ({body_length} chars): "{body_snippet if body_snippet else '[EMPTY]'}"
- Author: {pr.author.login} (assoc={author_assoc}, 7d_prs={author_prs_7d}, merged_in_repo={merged_prs})
- Branch: {head_branch} (is_fork={is_fork}, similar_open_prs={similar_count})
- Changes: {pr.stats.changed_files} files, {total_changed_lines} lines (+{pr.stats.additions}/-{pr.stats.deletions}), docs_only={docs_only}, whitespace_only={whitespace_only}, exts={file_extensions}
- Issues: linked={linked_issues}, unchecked_checklist={unchecked_checklist}
Diffs:
{files_str}

RUBRIC:
- Strong spam signals: whitespace_only; generic_title with no explanation; docs_only changes unrelated to project; author_prs_last_7d >= 10; tiny change (<=4 lines) with no linked issue; unfilled template; near-duplicate titles in similar_open_prs.
- Strong legit signals: author_merged_prs_in_repo >= 1; linked_issues + meaningful code change; clear specific description; changes match described fix.
- NEVER penalise on their own: first-time contributor, fork, short specific description, AI-sounding description when change is real and fixes linked issue.
- Thresholds: >=70 spam (requires >=2 strong spam signals); 40-69 low_effort (1 weak signal); <40 legit.
- Evidence rule: Every reason must cite concrete facts (a number or quote <= 8 words).

EXAMPLES:
1. Spam (title "Update README.md", empty body, 2 lines, whitespace_only, 14 PRs in 7d):
{{"spam_score": 95, "reasons": ["whitespace_only change modifying 2 lines", "Generic title \\"Update README.md\\" with empty description", "Author opened 14 PRs in the last 7 days"], "suggested_action": "close"}}
2. Borderline (docs typo, 4 lines, docs_only, no issue):
{{"spam_score": 45, "reasons": ["Small docs-only fix of 4 lines without a linked issue", "Title \\"Fix typo in documentation\\" addresses minor typo"], "suggested_action": "request_changes"}}
3. Legit (issue #452, 46 lines, 5 merged PRs):
{{"spam_score": 5, "reasons": ["Resolves linked issue #452 with 46 changed lines", "Changes match fix \\"resolve connection leak in worker pool\\"", "Author has 5 merged PRs in this repository"], "suggested_action": "review"}}
4. First-timer (first_timer, fork, issue #89, 18 lines):
{{"spam_score": 10, "reasons": ["Addresses linked issue #89 with 18 lines of code and tests", "Specific fix matching \\"Added check for missing Bearer prefix\\"", "First-time contributor from fork making legitimate bugfix"], "suggested_action": "review"}}

Output ONLY a JSON object: {{"spam_score": int, "reasons": ["max 3 strings"], "suggested_action": "close"|"request_changes"|"review"}}. No markdown or preamble."""
