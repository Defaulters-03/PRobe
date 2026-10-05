import type { AnalyzeResponse, AnalysisResult } from "./types";

/**
 * Returns realistic mock PR analysis results partitioned into pages.
 * Simulates server-side pagination with page size 10.
 */
export async function getMockResults(
  repo: string,
  page: number = 1
): Promise<AnalyzeResponse> {
  await new Promise((r) => setTimeout(r, 600));

  const now = new Date().toISOString();
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString();

  const allMockResults: AnalysisResult[] = [
    // ── Page 1 (PRs #842 - #815) ─────────────────────────
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
    {
      pr: {
        number: 837,
        title: "automated bot: add badging comments",
        url: `https://github.com/${repo}/pull/837`,
        author: "badge-bot-ai",
        authorCreatedAt: daysAgo(1),
        createdAt: daysAgo(1),
        additions: 15,
        deletions: 0,
        changedFiles: 1,
        bodyPreview: "Automated badge generator.",
      },
      verdict: {
        label: "spam",
        spam_score: 91,
        reasons: [
          "Account created yesterday",
          "Automated comment spam detected",
          "Suspicious pattern across multiple repos",
        ],
        suggested_action: "close",
      },
    },
    {
      pr: {
        number: 835,
        title: "Add dark mode toggle",
        url: `https://github.com/${repo}/pull/835`,
        author: "junior-dev-42",
        authorCreatedAt: daysAgo(90),
        createdAt: daysAgo(2),
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
        createdAt: daysAgo(3),
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
    {
      pr: {
        number: 829,
        title: "refactor: clean up unused helper variables",
        url: `https://github.com/${repo}/pull/829`,
        author: "alex-coder",
        authorCreatedAt: daysAgo(180),
        createdAt: daysAgo(4),
        additions: 5,
        deletions: 12,
        changedFiles: 3,
        bodyPreview: "Removes a few unused variables in the utils module.",
      },
      verdict: {
        label: "low_effort",
        spam_score: 42,
        reasons: [
          "Minor cosmetic changes",
          "Missing accompanying unit tests",
        ],
        suggested_action: "request_changes",
      },
    },
    {
      pr: {
        number: 827,
        title: "feat: implement streaming SSR for React Server Components",
        url: `https://github.com/${repo}/pull/827`,
        author: "core-contributor",
        authorCreatedAt: daysAgo(800),
        createdAt: daysAgo(5),
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
        number: 824,
        title: "perf: optimize AST node traversal speed by 25%",
        url: `https://github.com/${repo}/pull/824`,
        author: "ast-wizard",
        authorCreatedAt: daysAgo(640),
        createdAt: daysAgo(6),
        additions: 88,
        deletions: 34,
        changedFiles: 5,
        bodyPreview: "Replaces recursive walker with iterative stack traversal.",
      },
      verdict: {
        label: "legit",
        spam_score: 8,
        reasons: [
          "Includes comprehensive benchmark suite",
          "Clear performance improvements verified",
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
        createdAt: daysAgo(7),
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
    {
      pr: {
        number: 815,
        title: "chore: migrate CI to GitHub Actions",
        url: `https://github.com/${repo}/pull/815`,
        author: "devops-lead",
        authorCreatedAt: daysAgo(600),
        createdAt: daysAgo(8),
        additions: 185,
        deletions: 210,
        changedFiles: 8,
        bodyPreview:
          "Migrating from CircleCI to GitHub Actions. All pipelines have been replicated and tested.",
      },
      verdict: null,
      error: "Model rate limit exceeded — could not analyze this PR",
    },

    // ── Page 2 (PRs #812 - #785) ─────────────────────────
    {
      pr: {
        number: 812,
        title: "Update LICENSE year to 2026",
        url: `https://github.com/${repo}/pull/812`,
        author: "year-updater-bot",
        authorCreatedAt: daysAgo(3),
        createdAt: daysAgo(9),
        additions: 1,
        deletions: 1,
        changedFiles: 1,
        bodyPreview: "Happy new year! Updated copyright.",
      },
      verdict: {
        label: "spam",
        spam_score: 97,
        reasons: [
          "Automated copyright churn PR",
          "Account less than 1 week old",
        ],
        suggested_action: "close",
      },
    },
    {
      pr: {
        number: 809,
        title: "fix: add missing semicolon",
        url: `https://github.com/${repo}/pull/809`,
        author: "token-farmer",
        authorCreatedAt: daysAgo(4),
        createdAt: daysAgo(10),
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        bodyPreview: "Added semicolon.",
      },
      verdict: {
        label: "spam",
        spam_score: 94,
        reasons: [
          "Trivial 1-line formatting change",
          "No test or issue reference",
        ],
        suggested_action: "close",
      },
    },
    {
      pr: {
        number: 806,
        title: "docs: fix broken link in installation guide",
        url: `https://github.com/${repo}/pull/806`,
        author: "doc-enthusiast",
        authorCreatedAt: daysAgo(45),
        createdAt: daysAgo(11),
        additions: 2,
        deletions: 2,
        changedFiles: 1,
        bodyPreview: "Fixes the 404 URL in installation docs.",
      },
      verdict: {
        label: "low_effort",
        spam_score: 38,
        reasons: ["Helpful doc fix but small surface area"],
        suggested_action: "review",
      },
    },
    {
      pr: {
        number: 803,
        title: "refactor: convert callbacks to async/await in auth helper",
        url: `https://github.com/${repo}/pull/803`,
        author: "js-cleaner",
        authorCreatedAt: daysAgo(120),
        createdAt: daysAgo(12),
        additions: 24,
        deletions: 38,
        changedFiles: 2,
        bodyPreview: "Modernize callbacks to promises.",
      },
      verdict: {
        label: "low_effort",
        spam_score: 45,
        reasons: [
          "Refactoring without new test assertions",
          "Potential subtle behavior alteration",
        ],
        suggested_action: "request_changes",
      },
    },
    {
      pr: {
        number: 800,
        title: "feat: add support for HTTP/3 and QUIC transport",
        url: `https://github.com/${repo}/pull/800`,
        author: "net-specialist",
        authorCreatedAt: daysAgo(1100),
        createdAt: daysAgo(13),
        additions: 512,
        deletions: 44,
        changedFiles: 16,
        bodyPreview: "Adds draft implementation for QUIC sockets.",
      },
      verdict: {
        label: "legit",
        spam_score: 2,
        reasons: [
          "Established contributor with deep domain knowledge",
          "Comprehensive unit & integration tests included",
        ],
        suggested_action: "review",
      },
    },
    {
      pr: {
        number: 798,
        title: "fix: handle null pointer on unmounted canvas context",
        url: `https://github.com/${repo}/pull/798`,
        author: "frontend-pro",
        authorCreatedAt: daysAgo(750),
        createdAt: daysAgo(14),
        additions: 18,
        deletions: 4,
        changedFiles: 2,
        bodyPreview: "Prevents exception when canvas unmounts mid-frame.",
      },
      verdict: {
        label: "legit",
        spam_score: 4,
        reasons: [
          "Direct fix for issue #521 with regression test",
          "Reputable account history",
        ],
        suggested_action: "review",
      },
    },
    {
      pr: {
        number: 795,
        title: "test: increase coverage for router edge cases",
        url: `https://github.com/${repo}/pull/795`,
        author: "qa-lead",
        authorCreatedAt: daysAgo(920),
        createdAt: daysAgo(15),
        additions: 120,
        deletions: 5,
        changedFiles: 4,
        bodyPreview: "Adds unit tests covering nested wildcard routes.",
      },
      verdict: {
        label: "legit",
        spam_score: 1,
        reasons: [
          "High quality test suite additions",
          "Zero code regression risk",
        ],
        suggested_action: "review",
      },
    },
    {
      pr: {
        number: 792,
        title: "chore: update prettier configuration",
        url: `https://github.com/${repo}/pull/792`,
        author: "style-bot",
        authorCreatedAt: daysAgo(20),
        createdAt: daysAgo(16),
        additions: 4,
        deletions: 2,
        changedFiles: 1,
        bodyPreview: "Adjust singleQuote setting.",
      },
      verdict: {
        label: "low_effort",
        spam_score: 55,
        reasons: [
          "Unsolicited stylistic config change",
          "No project team discussion",
        ],
        suggested_action: "request_changes",
      },
    },
    {
      pr: {
        number: 788,
        title: "Add awesome link to README",
        url: `https://github.com/${repo}/pull/788`,
        author: "promo-account",
        authorCreatedAt: daysAgo(8),
        createdAt: daysAgo(17),
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        bodyPreview: "Check out my tool!",
      },
      verdict: {
        label: "spam",
        spam_score: 93,
        reasons: [
          "Self-promotional link insertion",
          "Account created recently with multiple spam flags",
        ],
        suggested_action: "close",
      },
    },
    {
      pr: {
        number: 785,
        title: "security: patch prototype pollution in query parser",
        url: `https://github.com/${repo}/pull/785`,
        author: "whitehat-sec",
        authorCreatedAt: daysAgo(1400),
        createdAt: daysAgo(18),
        additions: 32,
        deletions: 6,
        changedFiles: 3,
        bodyPreview: "Disallows __proto__ and constructor object keys.",
      },
      verdict: {
        label: "legit",
        spam_score: 2,
        reasons: [
          "Critical security vulnerability resolution",
          "Verified exploit test case included",
        ],
        suggested_action: "review",
      },
    },

    // ── Page 3 (PRs #781 - #770) ─────────────────────────
    {
      pr: {
        number: 781,
        title: "fix: race condition in worker pool termination",
        url: `https://github.com/${repo}/pull/781`,
        author: "concurrency-dev",
        authorCreatedAt: daysAgo(1600),
        createdAt: daysAgo(19),
        additions: 45,
        deletions: 12,
        changedFiles: 3,
        bodyPreview: "Ensures all worker threads drain before resolving close.",
      },
      verdict: {
        label: "legit",
        spam_score: 3,
        reasons: [
          "Verified multithreaded test attached",
          "High quality contribution from trusted member",
        ],
        suggested_action: "review",
      },
    },
    {
      pr: {
        number: 779,
        title: "Delete CONTRIBUTING.md",
        url: `https://github.com/${repo}/pull/779`,
        author: "troll-user-99",
        authorCreatedAt: daysAgo(1),
        createdAt: daysAgo(20),
        additions: 0,
        deletions: 80,
        changedFiles: 1,
        bodyPreview: "Not needed.",
      },
      verdict: {
        label: "spam",
        spam_score: 99,
        reasons: [
          "Malicious file deletion",
          "Brand new account with hostile behavior",
        ],
        suggested_action: "close",
      },
    },
    {
      pr: {
        number: 775,
        title: "docs: add troubleshooting section for Windows PowerShell",
        url: `https://github.com/${repo}/pull/775`,
        author: "win-user",
        authorCreatedAt: daysAgo(300),
        createdAt: daysAgo(21),
        additions: 25,
        deletions: 0,
        changedFiles: 1,
        bodyPreview: "Helpful guide for PowerShell execution policy.",
      },
      verdict: {
        label: "low_effort",
        spam_score: 25,
        reasons: ["Helpful Windows documentation update"],
        suggested_action: "review",
      },
    },
    {
      pr: {
        number: 770,
        title: "feat: add experimental WebAssembly build target",
        url: `https://github.com/${repo}/pull/770`,
        author: "wasm-hacker",
        authorCreatedAt: daysAgo(850),
        createdAt: daysAgo(22),
        additions: 420,
        deletions: 30,
        changedFiles: 9,
        bodyPreview: "Compiles core engine to Wasm with Emscripten.",
      },
      verdict: {
        label: "legit",
        spam_score: 6,
        reasons: [
          "Innovative feature extension",
          "Clear documentation and build flags provided",
        ],
        suggested_action: "review",
      },
    },
  ];

  const PAGE_SIZE = 10;
  const safePage = Math.max(1, page);
  const totalPages = Math.ceil(allMockResults.length / PAGE_SIZE);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageResults = allMockResults.slice(startIndex, startIndex + PAGE_SIZE);

  return {
    repo,
    analyzedAt: now,
    count: pageResults.length,
    results: pageResults,
    page: safePage,
    totalPages,
    total: allMockResults.length,
  };
}
