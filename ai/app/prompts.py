import json
from app.schemas import AnalyzeRequest


def build_pr_analysis_prompt(pr: AnalyzeRequest) -> str:
    """
    Constructs the prompt for Gemma 4 containing the role, PR details, and triage rubric.
    The entire instruction is inside this single prompt string.
    """
    files_data = []
    for f in pr.files:
        patch_text = f.patch or ""
        if len(patch_text) > 4000:
            patch_text = patch_text[:4000] + "\n...[truncated]..."
        files_data.append(
            {
                "filename": f.filename,
                "status": f.status,
                "additions": f.additions,
                "deletions": f.deletions,
                "patch": patch_text,
            }
        )

    pr_context = {
        "number": pr.number,
        "title": pr.title,
        "body": pr.body or "",
        "url": pr.url,
        "created_at": pr.created_at,
        "author": {
            "login": pr.author.login,
            "account_created_at": pr.author.account_created_at,
            "public_repos": pr.author.public_repos,
            "followers": pr.author.followers,
        },
        "stats": {
            "changed_files": pr.stats.changed_files,
            "additions": pr.stats.additions,
            "deletions": pr.stats.deletions,
        },
        "files": files_data,
    }

    return f"""You are an experienced open-source maintainer triaging incoming pull requests.
Your task is to judge whether the pull request is spam / low effort (the junk-PR problem, such as trivial Hacktoberfest-style PRs) or a legitimate contribution.

RUBRIC:
SPAM signals:
- tiny change (<=4 changed lines) with no explanation;
- whitespace/formatting-only edits;
- typo or README edits unrelated to the project;
- empty, templated or meaningless description;
- generic title like "Update README.md";
- brand-new account with many PRs;
- changes that add nothing useful.

LEGIT signals:
- fixes or implements something specific;
- references an issue;
- meaningful code change;
- clear description;
- tests or docs that match the code.

Score 0-100 where higher = more likely spam.
- >=70 is spam
- 40-69 is low_effort
- <40 is legit

PULL REQUEST DATA:
{json.dumps(pr_context, indent=2)}

OUTPUT FORMAT:
Output ONLY a JSON object with keys "spam_score", "reasons", and "suggested_action".
- "spam_score": integer 0-100
- "reasons": array of max 3 short explanatory strings
- "suggested_action": "close", "request_changes", or "review"

No markdown fences, no preamble, no commentary. Output only the raw JSON object.
"""
