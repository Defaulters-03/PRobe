import re
from pathlib import Path
from app.schemas import AnalyzeRequest


def build_pr_analysis_prompt(pr: AnalyzeRequest) -> str:
    """
    Constructs the prompt for Gemma 4 containing maintainer instructions,
    a structured readable FACTS block with PR and context data,
    the evaluation rubric, 4 few-shot examples, and expected JSON output schema.
    """
    ctx = pr.context or {}

    # Extract or infer fields from context and request
    body_text = (pr.body or "").strip()
    # Truncate body to at most 1500 chars
    if len(body_text) > 1500:
        body_text = body_text[:1500]

    body_length = ctx.get("body_length", len(pr.body or ""))
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
    draft = ctx.get("draft", False)
    head_branch = ctx.get("head_branch", "unknown")
    is_fork = ctx.get("is_fork", False)
    commits = ctx.get("commits", 1)
    comments = ctx.get("comments", 0)

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

    generic_branch = ctx.get("generic_branch", False)
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

    similar_open_prs = ctx.get("similar_open_prs", [])
    total_changed_lines = ctx.get(
        "total_changed_lines", pr.stats.additions + pr.stats.deletions
    )
    author_prs_last_7d = ctx.get("author_prs_last_7d", 0)
    author_merged_prs_in_repo = ctx.get("author_merged_prs_in_repo", 0)

    # Format file diffs: at most 3 files, each patch at most 800 chars
    files_summary = []
    for f in (pr.files or [])[:3]:
        patch_text = f.patch or ""
        if len(patch_text) > 800:
            patch_text = patch_text[:800]
        files_summary.append(
            f"- File: {f.filename} ({f.status}, +{f.additions}/-{f.deletions})\n  Patch:\n{patch_text}"
        )
    files_block = "\n".join(files_summary) if files_summary else "No file changes provided."

    return f"""You are an experienced open-source maintainer triaging incoming pull requests.
Your task is to judge whether the pull request is spam / low effort or a legitimate contribution.

FACTS:
- PR Number: #{pr.number}
- Title: "{pr.title}"
- Description / Body: "{body_text if body_text else '[EMPTY]'}"
- Body Length: {body_length} characters
- Unchecked Checklist Items: {unchecked_checklist}
- Linked Issues: {linked_issues}
- Author:
  - Login: "{pr.author.login}"
  - Account Created At: "{pr.author.account_created_at}"
  - Public Repos: {pr.author.public_repos}
  - Followers: {pr.author.followers}
  - Author Association: "{author_assoc}"
  - Author PRs in Last 7 Days: {author_prs_last_7d}
  - Author Merged PRs in Repo: {author_merged_prs_in_repo}
- Repository & Git Details:
  - Head Branch: "{head_branch}"
  - Is Fork: {is_fork}
  - Draft: {draft}
  - Commits: {commits}
  - Comments: {comments}
  - Generic Title Flag: {generic_title}
  - Generic Branch Flag: {generic_branch}
  - Similar Open PRs: {similar_open_prs}
- Code Change Stats:
  - Total Changed Files: {pr.stats.changed_files}
  - Total Changed Lines: {total_changed_lines} (+{pr.stats.additions}/-{pr.stats.deletions})
  - Docs Only: {docs_only}
  - Whitespace Only: {whitespace_only}
  - File Extensions: {file_extensions}
- File Diffs:
{files_block}

TRIAGE RUBRIC:
Strong spam signals: whitespace_only, generic_title with no explanation, docs_only unrelated to project, author_prs_last_7d >= 10, tiny change (<=4 lines) with no linked issue, unfilled template with empty description, duplicate titles.
Strong legit signals: author_merged_prs_in_repo >= 1, linked_issues with meaningful code changes, clear specific description, changes matching description.
Scoring: 0-100 (higher = spam). >=70 spam (action: close), 40-69 low_effort (action: request_changes), <40 legit (action: review).
Require >=2 strong spam signals for score >=70. One weak signal is low_effort (40-69). Code fixes with linked issues must score <40.

EXAMPLES:

Example 1 (Spam):
Output:
{{
  "spam_score": 95,
  "reasons": [
    "whitespace_only change modifying 2 lines",
    "Generic title with empty description",
    "Author opened 14 PRs in 7 days"
  ],
  "suggested_action": "close"
}}

Example 2 (Low effort):
Output:
{{
  "spam_score": 45,
  "reasons": [
    "Small docs-only fix of 4 lines without linked issue",
    "Title addresses minor documentation typo",
    "Single weak signal qualifies as low effort"
  ],
  "suggested_action": "request_changes"
}}

Example 3 (Legit):
Output:
{{
  "spam_score": 5,
  "reasons": [
    "Resolves linked issue #452 with 46 changed lines",
    "Changes match described connection leak fix",
    "Author has 5 merged PRs in repo"
  ],
  "suggested_action": "review"
}}

OUTPUT FORMAT:
Output ONLY compact JSON: at most 3 reasons, each at most 12 words, no markdown fences, no text outside the JSON.
Schema:
{{
  "spam_score": <integer 0-100>,
  "reasons": [<at most 3 strings, each at most 12 words>],
  "suggested_action": <"close" | "request_changes" | "review">
}}
"""
