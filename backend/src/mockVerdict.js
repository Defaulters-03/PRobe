/**
 * Evaluates a pull request payload using rule-based scoring upgraded with signals evidence.
 *
 * Scoring rules (start at 0, clamp to 0-100):
 * +35 whitespace_only;
 * +30 if total_changed_lines <= 4 and linked_issues is empty;
 * +25 if body_length < 20;
 * +20 if docs_only and generic_title;
 * +15 if the author account is under 30 days old;
 * +15 if author_prs_last_7d >= 10;
 * +10 if generic_branch;
 * +10 if author_association is FIRST_TIMER or FIRST_TIME_CONTRIBUTOR;
 * +10 if similar_open_prs is non-empty;
 * -30 if linked_issues is non-empty and total_changed_lines > 10;
 * -25 if author_merged_prs_in_repo >= 1;
 * -15 if author_association is CONTRIBUTOR.
 *
 * Labels: >=70 spam, 40-69 low_effort, <40 legit.
 * Actions: spam->close, low_effort->request_changes, legit->review.
 *
 * @param {object} payload - The normalized PR payload with context/signals
 * @returns {{ label: string, spam_score: number, reasons: string[], suggested_action: string }}
 */
export function generateMockVerdict(payload) {
  let score = 0;
  const reasons = [];

  const signals = payload.context || payload.signals || {};
  const totalLines =
    typeof signals.total_changed_lines === "number"
      ? signals.total_changed_lines
      : (payload.stats?.additions || 0) + (payload.stats?.deletions || 0);

  const linkedIssues = Array.isArray(signals.linked_issues) ? signals.linked_issues : [];
  const assoc = (signals.author_association || "").toUpperCase();

  // 1. +35 whitespace_only
  if (signals.whitespace_only) {
    score += 35;
    reasons.push("Diff consists solely of whitespace adjustments.");
  }

  // 2. +30 if total_changed_lines <= 4 and linked_issues is empty
  if (totalLines <= 4 && linkedIssues.length === 0) {
    score += 30;
    reasons.push("Very small diff with 4 or fewer total line changes and no linked issues.");
  }

  // 3. +25 if body_length < 20
  const bodyLen =
    typeof signals.body_length === "number"
      ? signals.body_length
      : (payload.body || "").length;
  if (bodyLen < 20) {
    score += 25;
    reasons.push("Pull request description is shorter than 20 characters.");
  }

  // 4. +20 if docs_only and generic_title
  if (signals.docs_only && signals.generic_title) {
    score += 20;
    reasons.push("Only documentation files modified with a generic pull request title.");
  }

  // 5. +15 if the author account is under 30 days old
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

  // 6. +15 if author_prs_last_7d >= 10
  if (typeof signals.author_prs_last_7d === "number" && signals.author_prs_last_7d >= 10) {
    score += 15;
    reasons.push("Author opened 10 or more pull requests in the last 7 days.");
  }

  // 7. +10 if generic_branch
  if (signals.generic_branch) {
    score += 10;
    reasons.push("Head branch name is generic (e.g. patch-1, main, master, or dev).");
  }

  // 8. +10 if author_association is FIRST_TIMER or FIRST_TIME_CONTRIBUTOR
  if (assoc === "FIRST_TIMER" || assoc === "FIRST_TIME_CONTRIBUTOR") {
    score += 10;
    reasons.push(`Author association is ${assoc}.`);
  }

  // 9. +10 if similar_open_prs is non-empty
  if (Array.isArray(signals.similar_open_prs) && signals.similar_open_prs.length > 0) {
    score += 10;
    reasons.push("Found similar open pull requests with matching title keywords.");
  }

  // 10. -30 if linked_issues is non-empty and total_changed_lines > 10
  if (linkedIssues.length > 0 && totalLines > 10) {
    score -= 30;
    reasons.push("Addresses linked issue(s) with meaningful code changes (>10 lines).");
  }

  // 11. -25 if author_merged_prs_in_repo >= 1
  if (typeof signals.author_merged_prs_in_repo === "number" && signals.author_merged_prs_in_repo >= 1) {
    score -= 25;
    reasons.push("Author has previously merged pull requests in this repository.");
  }

  // 12. -15 if author_association is CONTRIBUTOR
  if (assoc === "CONTRIBUTOR") {
    score -= 15;
    reasons.push("Author is an established repository contributor.");
  }

  // Clamp to 0-100
  const spam_score = Math.min(100, Math.max(0, score));

  // Determine label: >=70 spam, 40-69 low_effort, <40 legit
  let label = "legit";
  if (spam_score >= 70) {
    label = "spam";
  } else if (spam_score >= 40) {
    label = "low_effort";
  }

  // Determine suggested action: spam->close, low_effort->request_changes, legit->review
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
