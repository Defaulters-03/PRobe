import { verdictCache } from "./cache.js";
import { generateMockVerdict } from "./mockVerdict.js";

/**
 * Concurrently processes an array of items with a maximum concurrency limit.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function runWithConcurrency(items, limit, fn) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

// In-flight map to de-duplicate concurrent analyses for the same repo+PR
const inFlightAnalyses = new Map();

/**
 * Internal single PR analysis implementation.
 *
 * @param {string} repo - The normalized repo name (owner/repo)
 * @param {object} item - Object containing { payload, prSummary, headSha, signals }
 * @returns {Promise<{ pr: object, verdict: object | null, signals: object, error?: string, skippedAsTrusted?: boolean }>}
 */
async function _analyzeSinglePRInternal(repo, item) {
  const t0 = Date.now();
  const { payload, prSummary, headSha, signals } = item;

  if (item.error) {
    const totalMs = Date.now() - t0;
    console.log(`[perf] pr=#${payload?.number || prSummary?.number} total=${totalMs}ms source=error`);
    return {
      pr: prSummary,
      verdict: null,
      signals: signals || {},
      error: item.error,
    };
  }

  const context = payload.context || signals;
  const authorAssociation = (context?.author_association || "").toUpperCase();

  // Trusted shortcut: OWNER, MEMBER, COLLABORATOR
  if (["OWNER", "MEMBER", "COLLABORATOR"].includes(authorAssociation)) {
    const verdict = {
      label: "legit",
      spam_score: 5,
      reasons: [`Author is a repository ${authorAssociation}`],
      suggested_action: "review",
    };
    const totalMs = Date.now() - t0;
    console.log(`[perf] pr=#${payload.number} total=${totalMs}ms source=trusted`);
    return {
      pr: prSummary,
      verdict,
      signals,
      skippedAsTrusted: true,
    };
  }

  // Persistent cache lookup: key repo|number|headSha|PROMPT_VERSION, 60 minutes TTL
  const PROMPT_VERSION = process.env.PROMPT_VERSION || "1";
  const cacheKey = `${repo}|${payload.number}|${headSha}|${PROMPT_VERSION}`;

  const cachedVerdict = verdictCache.get(cacheKey);
  if (cachedVerdict) {
    const totalMs = Date.now() - t0;
    console.log(`[perf] pr=#${payload.number} total=${totalMs}ms source=cache`);
    return {
      pr: prSummary,
      verdict: cachedVerdict,
      signals,
    };
  }

  const useMockAi = (process.env.USE_MOCK_AI || "true").toLowerCase() === "true";

  // Mock AI
  if (useMockAi) {
    try {
      const verdict = generateMockVerdict(payload);
      verdictCache.set(cacheKey, verdict, 60 * 60 * 1000);
      const totalMs = Date.now() - t0;
      console.log(`[perf] pr=#${payload.number} total=${totalMs}ms source=mock`);
      return {
        pr: prSummary,
        verdict,
        signals,
      };
    } catch (err) {
      const totalMs = Date.now() - t0;
      console.log(`[perf] pr=#${payload.number} total=${totalMs}ms source=error`);
      return {
        pr: prSummary,
        verdict: null,
        signals,
        error: err.message || "Failed to generate mock verdict",
      };
    }
  }

  // External AI service
  const baseUrl = (process.env.AI_SERVICE_URL || "http://localhost:8000").replace(/\/+$/, "");
  const analyzeUrl = `${baseUrl}/analyze`;

  try {
    const response = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(40000), // 40-second timeout
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`AI service returned ${response.status}: ${errBody || response.statusText}`);
    }

    const data = await response.json();
    const verdict = {
      label: data.label,
      spam_score: Number(data.spam_score),
      reasons: Array.isArray(data.reasons) ? data.reasons : [],
      suggested_action: data.suggested_action,
    };

    verdictCache.set(cacheKey, verdict, 60 * 60 * 1000);

    const totalMs = Date.now() - t0;
    console.log(`[perf] pr=#${payload.number} total=${totalMs}ms source=ai`);

    return {
      pr: prSummary,
      verdict,
      signals,
    };
  } catch (err) {
    const totalMs = Date.now() - t0;
    console.log(`[perf] pr=#${payload.number} total=${totalMs}ms source=error`);
    return {
      pr: prSummary,
      verdict: null,
      signals,
      error: err.message || "AI service request failed",
    };
  }
}

/**
 * Analyzes a single PR using de-duplication: if the same repo+PR analysis is already running,
 * returns the existing promise.
 *
 * @param {string} repo - The normalized repo name (owner/repo)
 * @param {object} item - Object containing { payload, prSummary, headSha, signals }
 * @returns {Promise<{ pr: object, verdict: object | null, signals: object, error?: string, skippedAsTrusted?: boolean }>}
 */
export function analyzeSinglePR(repo, item) {
  const prNumber = item?.payload?.number || item?.prSummary?.number;
  const inFlightKey = `${repo}|${prNumber}`;

  if (inFlightAnalyses.has(inFlightKey)) {
    return inFlightAnalyses.get(inFlightKey);
  }

  const promise = (async () => {
    try {
      return await _analyzeSinglePRInternal(repo, item);
    } finally {
      inFlightAnalyses.delete(inFlightKey);
    }
  })();

  inFlightAnalyses.set(inFlightKey, promise);
  return promise;
}

/**
 * Analyzes multiple PRs with configurable concurrency (defaults to AI_CONCURRENCY or 10).
 * Logs how many AI calls were skipped as trusted.
 *
 * @param {string} repo - The normalized repo name (owner/repo)
 * @param {Array<{ payload: object, prSummary: object, headSha: string, signals: object }>>} prItems
 * @param {number} [concurrency] - Optional custom concurrency limit
 * @returns {Promise<Array<{ pr: object, verdict: object | null, signals: object, error?: string }>>}
 */
export async function analyzePRs(repo, prItems, concurrency) {
  const AI_CONCURRENCY = parseInt(process.env.AI_CONCURRENCY || "10", 10) || 10;
  const limit = typeof concurrency === "number" ? concurrency : AI_CONCURRENCY;

  const rawResults = await runWithConcurrency(prItems, limit, async (item) => {
    return analyzeSinglePR(repo, item);
  });

  const skippedAsTrustedCount = rawResults.filter((r) => r.skippedAsTrusted).length;
  console.log(`[PRobe] Skipped ${skippedAsTrustedCount} AI call(s) as trusted.`);

  // Clean internal flag before returning
  return rawResults.map((r) => {
    const resultItem = {
      pr: r.pr,
      verdict: r.verdict,
      signals: r.signals,
    };
    if (r.error) {
      resultItem.error = r.error;
    }
    return resultItem;
  });
}

/**
 * Sorts analyzed results by the given sort option.
 * Options:
 * - "spam_score": high to low (default)
 * - "created_at_desc": newest first
 * - "created_at_asc": oldest first
 *
 * @param {Array<{ pr: object, verdict: object | null, signals: object, error?: string }>} results
 * @param {string} sort
 * @returns {Array<{ pr: object, verdict: object | null, signals: object, error?: string }>}
 */
export function sortResults(results, sort = "spam_score") {
  const sorted = [...results];
  if (sort === "created_at_asc") {
    sorted.sort(
      (a, b) => new Date(a.pr.createdAt).getTime() - new Date(b.pr.createdAt).getTime()
    );
  } else if (sort === "created_at_desc") {
    sorted.sort(
      (a, b) => new Date(b.pr.createdAt).getTime() - new Date(a.pr.createdAt).getTime()
    );
  } else {
    // "spam_score": default high -> low
    sorted.sort((a, b) => {
      const scoreA = typeof a.verdict?.spam_score === "number" ? a.verdict.spam_score : -1;
      const scoreB = typeof b.verdict?.spam_score === "number" ? b.verdict.spam_score : -1;
      return scoreB - scoreA;
    });
  }
  return sorted;
}
