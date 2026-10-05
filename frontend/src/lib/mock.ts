import type { AnalyzeResponse } from "./types";

/**
 * Returns 6 realistic mock PR analysis results after a 1-second fake delay.
 * 2 spam, 2 low_effort, 2 legit, one with verdict null (analysis failed).
 */
export async function getMockResults(repo: string): Promise<AnalyzeResponse> {
  await new Promise((r) => setTimeout(r, 1000));

  const now = new Date().toISOString();
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString();

  return {
    repo,
    analyzedAt: now,
    count: 7,
    results: [
      // ── Spam ────────────────────────────────────────────────
      {
        pr: {
          number: 842,
          title: "Update README.md",
          url: `https://github.com/${repo}/pull/842`,
          author: "spambot2024",
          authorCreatedAt: daysAgo(2),
          createdAt: daysAgo(0),
          additions: 1,
          deletions: 0,
          changedFiles: 1,
          bodyPreview: "",
        },
        verdict: {
          label: "spam",
          spam_score: 95,
          reasons: [
            "Account is only 2 days old",
            "Trivial one-line change with no description",
            "Only modifies README with no meaningful content",
          ],
          suggested_action: "close",
        },
      },
      {
        pr: {
          number: 839,
          title: "fix: typo in contributing.md",
          url: `https://github.com/${repo}/pull/839`,
          author: "hacktober-farmer",
          authorCreatedAt: daysAgo(5),
          createdAt: daysAgo(1),
          additions: 1,
          deletions: 1,
          changedFiles: 1,
          bodyPreview: "Fixed a typo",
        },
        verdict: {
          label: "spam",
          spam_score: 88,
          reasons: [
            "Account created during Hacktoberfest window",
            "Single whitespace / trivial typo change",
            "No linked issue or meaningful description",
          ],
          suggested_action: "close",
        },
      },

      // ── Low effort ────────────────────────────────────────
      {
        pr: {
          number: 835,
          title: "Add dark mode toggle",
          url: `https://github.com/${repo}/pull/835`,
          author: "junior-dev-42",
          authorCreatedAt: daysAgo(90),
          createdAt: daysAgo(3),
          additions: 12,
          deletions: 2,
          changedFiles: 2,
          bodyPreview: "Added a toggle for dark mode.",
        },
        verdict: {
          label: "low_effort",
          spam_score: 52,
          reasons: [
            "No tests added for new UI feature",
            "PR description lacks implementation details",
            "Does not reference an issue or RFC",
          ],
          suggested_action: "request_changes",
        },
      },
      {
        pr: {
          number: 831,
          title: "Bump lodash from 4.17.20 to 4.17.21",
          url: `https://github.com/${repo}/pull/831`,
          author: "dependabot[bot]",
          authorCreatedAt: daysAgo(1200),
          createdAt: daysAgo(5),
          additions: 3,
          deletions: 3,
          changedFiles: 1,
          bodyPreview:
            "Bumps lodash from 4.17.20 to 4.17.21. This update includes a security fix.",
        },
        verdict: {
          label: "low_effort",
          spam_score: 35,
          reasons: [
            "Automated dependency bump with no human review",
            "Single-file lockfile change",
          ],
          suggested_action: "request_changes",
        },
      },

      // ── Legit ─────────────────────────────────────────────
      {
        pr: {
          number: 827,
          title: "feat: implement streaming SSR for React Server Components",
          url: `https://github.com/${repo}/pull/827`,
          author: "core-contributor",
          authorCreatedAt: daysAgo(800),
          createdAt: daysAgo(7),
          additions: 342,
          deletions: 58,
          changedFiles: 14,
          bodyPreview:
            "This PR implements streaming server-side rendering for RSC, improving TTFB by ~40%. Linked to #412.",
        },
        verdict: {
          label: "legit",
          spam_score: 5,
          reasons: [
            "Experienced contributor with 2+ year account history",
            "Substantial code change across multiple files",
            "Well-documented PR with linked issue and perf metrics",
          ],
          suggested_action: "review",
        },
      },
      {
        pr: {
          number: 820,
          title: "fix: resolve memory leak in WebSocket reconnection handler",
          url: `https://github.com/${repo}/pull/820`,
          author: "senior-eng",
          authorCreatedAt: daysAgo(1500),
          createdAt: daysAgo(10),
          additions: 67,
          deletions: 23,
          changedFiles: 4,
          bodyPreview:
            "Fixes #389. The reconnection handler was holding stale references, causing a slow memory leak under high concurrency.",
        },
        verdict: {
          label: "legit",
          spam_score: 3,
          reasons: [
            "Addresses a specific bug with linked issue",
            "Includes targeted fix and test coverage",
            "Account has extensive contribution history",
          ],
          suggested_action: "review",
        },
      },

      // ── Analysis failed ────────────────────────────────────
      {
        pr: {
          number: 815,
          title: "chore: migrate CI to GitHub Actions",
          url: `https://github.com/${repo}/pull/815`,
          author: "devops-lead",
          authorCreatedAt: daysAgo(600),
          createdAt: daysAgo(14),
          additions: 185,
          deletions: 210,
          changedFiles: 8,
          bodyPreview:
            "Migrating from CircleCI to GitHub Actions. All pipelines have been replicated and tested.",
        },
        verdict: null,
        error: "Model rate limit exceeded — could not analyze this PR",
      },
    ],
  };
}
