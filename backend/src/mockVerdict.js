/**
 * Evaluates a pull request payload using rule-based scoring.
 * 
 * Rules:
 * - score = 0;
 * - +40 if additions+deletions <= 4;
 * - +25 if body shorter than 20 chars;
 * - +20 if all files end in .md or .txt;
 * - +15 if the author account is under 30 days old;
 * - clamp to 0-100.
 * - label: >=70 spam, 40-69 low_effort, <40 legit.
 * - reasons: one short sentence per rule that fired.
 * - suggested_action: spam->close, low_effort->request_changes, legit->review.
 * 
 * @param {object} payload - The normalized PR payload
 * @returns {{ label: string, spam_score: number, reasons: string[], suggested_action: string }}
 */
export function generateMockVerdict(payload) {
  let score = 0;
  const reasons = [];

  // 1. additions + deletions <= 4
  const additions = payload.stats?.additions ?? 0;
  const deletions = payload.stats?.deletions ?? 0;
  if (additions + deletions <= 4) {
    score += 40;
    reasons.push("Diff is very small with 4 or fewer total line changes.");
  }

  // 2. body shorter than 20 chars
  const body = payload.body ?? "";
  if (body.trim().length < 20) {
    score += 25;
    reasons.push("Pull request description is shorter than 20 characters.");
  }

  // 3. all files end in .md or .txt
  const files = payload.files || [];
  if (
    files.length > 0 &&
    files.every((file) => {
      const name = (file.filename || "").toLowerCase();
      return name.endsWith(".md") || name.endsWith(".txt");
    })
  ) {
    score += 20;
    reasons.push("All modified files are documentation or text files (.md or .txt).");
  }

  // 4. author account is under 30 days old
  if (payload.author?.account_created_at) {
    const accountTime = new Date(payload.author.account_created_at).getTime();
    if (!isNaN(accountTime)) {
      const diffMs = Date.now() - accountTime;
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (diffMs >= 0 && diffMs < thirtyDaysMs) {
        score += 15;
        reasons.push("Author account was created less than 30 days ago.");
      }
    }
  }

  // Clamp to 0-100
  const spam_score = Math.min(100, Math.max(0, score));

  // Determine label
  let label = "legit";
  if (spam_score >= 70) {
    label = "spam";
  } else if (spam_score >= 40) {
    label = "low_effort";
  }

  // Determine suggested action
  let suggested_action = "review";
  if (label === "spam") {
    suggested_action = "close";
  } else if (label === "low_effort") {
    suggested_action = "request_changes";
  }

  return {
    label,
    spam_score,
    reasons,
    suggested_action,
  };
}
