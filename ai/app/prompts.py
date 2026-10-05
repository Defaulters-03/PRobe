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
    body_length = ctx.get("body_length", len(body_text))
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

    # Format file diffs
    files_summary = []
    for f in pr.files:
        patch_text = f.patch or ""
        if len(patch_text) > 2000:
            patch_text = patch_text[:2000] + "\n...[diff truncated]..."
        files_summary.append(
            f"- File: {f.filename} ({f.status}, +{f.additions}/-{f.deletions})\n  Patch:\n{patch_text}"
        )
    files_block = "\n".join(files_summary) if files_summary else "No file changes provided."

    return f"""You are an experienced open-source maintainer triaging incoming pull requests.
Your task is to judge whether the pull request is spam / low effort (the junk-PR problem, such as trivial Hacktoberfest-style PRs) or a legitimate contribution.

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
Strong spam signals:
- whitespace_only
- generic_title with no explanation
- docs_only changes unrelated to the project
- author_prs_last_7d >= 10
- tiny change with no linked issue (<= 4 changed lines without a linked issue)
- unfilled template (unchecked_checklist_items > 0 with an empty description)
- near-duplicate titles in similar_open_prs

Strong legit signals:
- author_merged_prs_in_repo >= 1
- linked_issues present and a meaningful code change
- a clear specific description
- changes that match the described fix

NEVER penalise on their own:
- Being a first-time contributor
- Being from a fork
- A short but specific description
- A polished, AI-sounding description when the change is real and fixes a linked issue

Scoring & Threshold Rules:
- Score 0-100 where higher = more likely spam.
- >=70 is spam (suggested_action: "close")
- 40-69 is low_effort (suggested_action: "request_changes")
- <40 is legit (suggested_action: "review")
- Require at least TWO independent strong spam signals before giving a score of 70 or more.
- One weak signal means low_effort at most (score 40-69).
- A PR with legitimate code changes addressing an issue must score under 40.

EVIDENCE REQUIREMENT:
Every reason must cite concrete evidence from this PR (a number from the facts, or a quote of at most 8 words from the title or description). No generic statements.

EXAMPLES:

Example 1 (Obvious spam):
FACTS:
- Title: "Update README.md"
- Description / Body: "[EMPTY]"
- Total Changed Lines: 2 (+1/-1)
- Whitespace Only: True
- Generic Title Flag: True
- Author PRs in Last 7 Days: 14
- Linked Issues: []
Output:
{{
  "spam_score": 95,
  "reasons": [
    "whitespace_only change modifying 2 lines",
    "Generic title \\"Update README.md\\" with empty description",
    "Author opened 14 PRs in the last 7 days"
  ],
  "suggested_action": "close"
}}

Example 2 (Borderline docs typo):
FACTS:
- Title: "Fix typo in documentation"
- Description / Body: "Fixed typo in the installation section of the getting started guide."
- Total Changed Lines: 4 (+2/-2)
- Docs Only: True
- Whitespace Only: False
- Generic Title Flag: False
- Author PRs in Last 7 Days: 1
- Linked Issues: []
Output:
{{
  "spam_score": 45,
  "reasons": [
    "Small docs-only fix of 4 lines without a linked issue",
    "Title \\"Fix typo in documentation\\" addresses minor typo",
    "One weak signal without strong spam signals qualifies as low effort"
  ],
  "suggested_action": "request_changes"
}}

Example 3 (Legit fix with a linked issue):
FACTS:
- Title: "fix: resolve connection leak in worker pool (#452)"
- Description / Body: "Fixes #452. Under high concurrent load, connections were not being returned to the pool due to unhandled exceptions in the keep-alive handler. Added try/finally block and comprehensive regression unit tests."
- Total Changed Lines: 46 (+38/-8)
- Docs Only: False
- Whitespace Only: False
- Linked Issues: ["#452"]
- Author Merged PRs in Repo: 5
- Author PRs in Last 7 Days: 2
Output:
{{
  "spam_score": 5,
  "reasons": [
    "Resolves linked issue #452 with 46 changed lines",
    "Changes match described fix \\"resolve connection leak in worker pool\\"",
    "Author has 5 merged PRs in this repository"
  ],
  "suggested_action": "review"
}}

Example 4 (A first-timer's real contribution):
FACTS:
- Title: "fix: handle null pointer in auth token parser (#89)"
- Description / Body: "Fixes #89. Added check for missing Bearer prefix in Authorization header."
- Total Changed Lines: 18 (+14/-4)
- Author Association: "FIRST_TIME_CONTRIBUTOR"
- Is Fork: True
- Author Merged PRs in Repo: 0
- Author PRs in Last 7 Days: 1
- Linked Issues: ["#89"]
- Docs Only: False
- Whitespace Only: False
Output:
{{
  "spam_score": 10,
  "reasons": [
    "Addresses linked issue #89 with 18 lines of code and tests",
    "Specific fix matching description \\"Added check for missing Bearer prefix\\"",
    "First-time contributor from fork making legitimate bugfix"
  ],
  "suggested_action": "review"
}}

OUTPUT FORMAT:
Output ONLY a JSON object with keys "spam_score", "reasons", and "suggested_action".
- "spam_score": integer 0-100
- "reasons": array of max 3 short explanatory strings citing concrete evidence
- "suggested_action": "close", "request_changes", or "review"

No markdown fences, no preamble, no commentary. Output only the raw JSON object.
"""
