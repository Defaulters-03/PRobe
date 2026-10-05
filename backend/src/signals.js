import crypto from "node:crypto";
import path from "node:path";
import { MemoryCache } from "./cache.js";

// 30-minute in-memory cache for author history search lookups
export const authorHistoryCache = new MemoryCache(30 * 60 * 1000);

/**
 * Escapes special regex characters in a string.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks if a title is generic according to the specified rules.
 *
 * @param {string} title
 * @returns {boolean}
 */
export function isGenericTitle(title) {
  const t = (title || "").toLowerCase().trim();
  if (t.length < 12) {
    return true;
  }

  const pattern = /^(update|create|delete|add|fix|edit)\s+[\w./-]+\.(md|txt|json|yml|yaml)$/;
  if (pattern.test(t)) {
    return true;
  }

  const genericPhrases = [
    "update readme",
    "fix typo",
    "add files via upload",
    "patch-1",
    "initial commit",
  ];

  return genericPhrases.some((phrase) => t.includes(phrase));
}

/**
 * Checks if a head branch is generic (/^patch-\d+$/ or /^(main|master|dev)$/).
 *
 * @param {string} headBranch
 * @returns {boolean}
 */
export function isGenericBranch(headBranch) {
  const b = (headBranch || "").trim();
  return /^patch-\d+$/.test(b) || /^(main|master|dev)$/.test(b);
}

/**
 * Checks if the changes across the first 5 file patches are whitespace only:
 * multiset of trimmed non-empty added lines equals multiset of trimmed non-empty removed lines.
 *
 * @param {Array<{ patch?: string }>} files
 * @returns {boolean}
 */
export function isWhitespaceOnly(files) {
  const filesToCheck = (files || []).slice(0, 5);
  const addedCounts = new Map();
  const removedCounts = new Map();
  let changeCount = 0;

  for (const file of filesToCheck) {
    const patch = file.patch || "";
    if (!patch) continue;
    const lines = patch.split("\n");
    for (const line of lines) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
        continue;
      }
      if (line.startsWith("+")) {
        changeCount++;
        const trimmed = line.slice(1).trim();
        if (trimmed.length > 0) {
          addedCounts.set(trimmed, (addedCounts.get(trimmed) || 0) + 1);
        }
      } else if (line.startsWith("-")) {
        changeCount++;
        const trimmed = line.slice(1).trim();
        if (trimmed.length > 0) {
          removedCounts.set(trimmed, (removedCounts.get(trimmed) || 0) + 1);
        }
      }
    }
  }

  if (changeCount === 0) {
    return false;
  }

  if (addedCounts.size !== removedCounts.size) {
    return false;
  }

  for (const [key, count] of addedCounts.entries()) {
    if (removedCounts.get(key) !== count) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if all changed files end in .md, .txt, .rst.
 *
 * @param {Array<{ filename?: string }>} files
 * @returns {boolean}
 */
export function isDocsOnly(files) {
  if (!files || files.length === 0) return false;
  return files.every((f) => {
    const name = (f.filename || "").toLowerCase();
    return name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".rst");
  });
}

/**
 * Returns counts by extension for the changed files, e.g. {".md": 2, ".js": 1}.
 *
 * @param {Array<{ filename?: string }>} files
 * @returns {Record<string, number>}
 */
export function getFileExtensions(files) {
  const counts = {};
  for (const file of files || []) {
    const fn = file.filename || "";
    let ext = path.extname(fn).toLowerCase();
    if (!ext) {
      const base = path.basename(fn).toLowerCase();
      ext = base.startsWith(".") ? base : (base ? `.${base}` : "none");
    }
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

/**
 * Extracts a Set of lowercase words from a title string.
 *
 * @param {string} title
 * @returns {Set<string>}
 */
function getTitleWordSet(title) {
  const words = (title || "").toLowerCase().match(/[a-z0-9_.-]+/g) || [];
  return new Set(words);
}

/**
 * Computes Jaccard similarity between two word sets.
 *
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number}
 */
function computeJaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersectionSize = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  if (unionSize === 0) return 0;
  return intersectionSize / unionSize;
}

/**
 * Finds other PRs in the same batch with Jaccard similarity >= 0.6.
 *
 * @param {number} currentPrNumber
 * @param {string} currentTitle
 * @param {Array<{ number: number, title: string }>} allPrsInBatch
 * @returns {Array<{ number: number, similarity: number }>}
 */
export function computeSimilarPRs(currentPrNumber, currentTitle, allPrsInBatch) {
  const currentSet = getTitleWordSet(currentTitle);
  const results = [];

  for (const other of allPrsInBatch || []) {
    if (other.number === currentPrNumber) continue;
    const otherSet = getTitleWordSet(other.title);
    const similarity = computeJaccardSimilarity(currentSet, otherSet);
    if (similarity >= 0.6) {
      results.push({
        number: other.number,
        similarity: Math.round(similarity * 100) / 100,
      });
    }
  }

  return results;
}

/**
 * Extracts issue numbers from body via keyword patterns and repo issue URLs.
 *
 * @param {string} body
 * @param {string} owner
 * @param {string} repo
 * @returns {number[]}
 */
export function extractLinkedIssues(body, owner, repo) {
  if (!body) return [];
  const linkedIssuesSet = new Set();

  // Pattern: /(fix(es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi
  const keywordRegex = /(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi;
  let m;
  while ((m = keywordRegex.exec(body)) !== null) {
    linkedIssuesSet.add(parseInt(m[1], 10));
  }

  // Issue URLs for this repo in body
  const escapedOwner = escapeRegex(owner);
  const escapedRepo = escapeRegex(repo);
  const urlRegex = new RegExp(
    `(?:https?:\\/\\/)?(?:www\\.)?github\\.com\\/${escapedOwner}\\/${escapedRepo}\\/issues\\/(\\d+)`,
    "gi"
  );
  while ((m = urlRegex.exec(body)) !== null) {
    linkedIssuesSet.add(parseInt(m[1], 10));
  }

  return Array.from(linkedIssuesSet).sort((a, b) => a - b);
}

/**
 * Performs author history lookups sequentially with a 300ms gap, cached for 30 minutes.
 * On ANY error (403, 422, 429), sets values to null and continues.
 *
 * @param {object} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string[]} authors
 * @returns {Promise<Map<string, { author_prs_last_7d: number | null, author_merged_prs_in_repo: number | null }>>}
 */
export async function fetchAuthorHistoryBatch(octokit, owner, repo, authors) {
  const uniqueAuthors = Array.from(new Set(authors.filter(Boolean)));
  const historyMap = new Map();
  const repoFullName = `${owner}/${repo}`;

  const sevenDaysAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  for (const login of uniqueAuthors) {
    const cacheKey7d = `author_7d#${login}`;
    const cacheKeyMerged = `author_merged#${repoFullName}#${login}`;

    let prsLast7d = authorHistoryCache.get(cacheKey7d);
    let mergedInRepo = authorHistoryCache.get(cacheKeyMerged);

    // 1. author_prs_last_7d
    if (prsLast7d === undefined) {
      try {
        const q = `author:${login} is:pr created:>=${sevenDaysAgoDate}`;
        const res = await octokit.rest.search.issuesAndPullRequests({
          q,
          per_page: 1,
        });
        prsLast7d = res.data?.total_count ?? 0;
        authorHistoryCache.set(cacheKey7d, prsLast7d);
      } catch (err) {
        prsLast7d = null;
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    // 2. author_merged_prs_in_repo
    if (mergedInRepo === undefined) {
      try {
        const q = `repo:${repoFullName} author:${login} is:pr is:merged`;
        const res = await octokit.rest.search.issuesAndPullRequests({
          q,
          per_page: 1,
        });
        mergedInRepo = res.data?.total_count ?? 0;
        authorHistoryCache.set(cacheKeyMerged, mergedInRepo);
      } catch (err) {
        mergedInRepo = null;
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    historyMap.set(login, {
      author_prs_last_7d: prsLast7d,
      author_merged_prs_in_repo: mergedInRepo,
    });
  }

  return historyMap;
}

/**
 * Builds the complete signals / context object for a PR.
 *
 * @param {object} params
 * @returns {object}
 */
export function buildSignals({
  pr,
  detailedPr,
  files,
  owner,
  repo,
  allPrsInBatch,
  authorHistory,
}) {
  const authorAssociation = detailedPr.author_association || pr.author_association || "NONE";
  const draft = Boolean(detailedPr.draft ?? pr.draft ?? false);
  const headBranch = pr.head?.ref || detailedPr.head?.ref || "";
  const isFork = Boolean(pr.head?.repo?.fork ?? detailedPr.head?.repo?.fork ?? false);
  const commits = detailedPr.commits ?? 0;
  const comments = detailedPr.comments ?? pr.comments ?? 0;
  const reviewComments = detailedPr.review_comments ?? 0;

  const rawBody = detailedPr.body ?? pr.body ?? "";
  const bodyLength = rawBody ? rawBody.length : 0;
  const uncheckedChecklistItems = rawBody ? (rawBody.match(/- \[ \]/g) || []).length : 0;
  const linkedIssues = extractLinkedIssues(rawBody, owner, repo);

  const title = detailedPr.title || pr.title || "";
  const genericTitle = isGenericTitle(title);
  const genericBranch = isGenericBranch(headBranch);
  const whitespaceOnly = isWhitespaceOnly(files);
  const docsOnly = isDocsOnly(files);
  const fileExtensions = getFileExtensions(files);
  const similarOpenPrs = computeSimilarPRs(pr.number, title, allPrsInBatch);

  const additions = detailedPr.additions ?? 0;
  const deletions = detailedPr.deletions ?? 0;
  const totalChangedLines = additions + deletions;

  const authorLogin = pr.user?.login;
  const authorStats = (authorLogin && authorHistory?.get(authorLogin)) || {
    author_prs_last_7d: null,
    author_merged_prs_in_repo: null,
  };

  return {
    author_association: authorAssociation,
    draft,
    head_branch: headBranch,
    is_fork: isFork,
    commits,
    comments,
    review_comments: reviewComments,
    body_length: bodyLength,
    unchecked_checklist_items: uncheckedChecklistItems,
    linked_issues: linkedIssues,
    generic_title: genericTitle,
    generic_branch: genericBranch,
    whitespace_only: whitespaceOnly,
    docs_only: docsOnly,
    file_extensions: fileExtensions,
    similar_open_prs: similarOpenPrs,
    total_changed_lines: totalChangedLines,
    author_prs_last_7d: authorStats.author_prs_last_7d,
    author_merged_prs_in_repo: authorStats.author_merged_prs_in_repo,
  };
}

/**
 * Computes a short deterministic hash of the context object for cache keys.
 *
 * @param {object} context
 * @returns {string}
 */
export function hashContext(context) {
  if (!context) return "empty";
  const str = JSON.stringify(context);
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 10);
}
