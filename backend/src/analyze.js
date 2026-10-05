import { verdictCache } from "./cache.js";
import { generateMockVerdict } from "./mockVerdict.js";
import { hashContext } from "./signals.js";

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

/**
 * Analyzes a single PR using trusted shortcut, cache, external AI service, or mock logic.
 *
 * @param {string} repo - The normalized repo name (owner/repo)
 * @param {object} item - Object containing { payload, prSummary, headSha, signals }
 * @returns {Promise<{ pr: object, verdict: object | null, signals: object, error?: string, skippedAsTrusted?: boolean }>}
 */
export async function analyzeSinglePR(repo, item) {
  const { payload, prSummary, headSha, signals } = item;

  if (item.error) {
    return {
      pr: prSummary,
      verdict: null,
      signals: signals || {},
      error: item.error,
    };
  }

  const context = payload.context || signals;
  const authorAssociation = (context?.author_association || "").toUpperCase();

  // 4. Trusted shortcut: OWNER, MEMBER, COLLABORATOR
  if (["OWNER", "MEMBER", "COLLABORATOR"].includes(authorAssociation)) {
    const verdict = {
      label: "legit",
      spam_score: 5,
      reasons: [`Author is a repository ${authorAssociation}`],
      suggested_action: "review",
    };
    return {
      pr: prSummary,
      verdict,
      signals,
      skippedAsTrusted: true,
    };
  }

  // 8. Cache lookup with short context hash
  const contextHash = hashContext(context);
  const cacheKey = `${repo}#${payload.number}#${headSha}#${contextHash}`;

  const cachedVerdict = verdictCache.get(cacheKey);
  if (cachedVerdict) {
    return {
      pr: prSummary,
      verdict: cachedVerdict,
      signals,
    };
  }

  const useMockAi = (process.env.USE_MOCK_AI || "true").toLowerCase() === "true";

  // 7. Mock AI
  if (useMockAi) {
    try {
      const verdict = generateMockVerdict(payload);
      verdictCache.set(cacheKey, verdict);
      return {
        pr: prSummary,
        verdict,
        signals,
      };
    } catch (err) {
      return {
        pr: prSummary,
        verdict: null,
        signals,
        error: err.message || "Failed to generate mock verdict",
      };
    }
  }

  // 5. Call external AI service
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

    verdictCache.set(cacheKey, verdict);

    return {
      pr: prSummary,
      verdict,
      signals,
    };
  } catch (err) {
    return {
      pr: prSummary,
      verdict: null,
      signals,
      error: err.message || "AI service request failed",
    };
  }
}

/**
 * Analyzes multiple PRs with a maximum concurrency of 5.
 * Logs how many AI calls were skipped as trusted.
 *
 * @param {string} repo - The normalized repo name (owner/repo)
 * @param {Array<{ payload: object, prSummary: object, headSha: string, signals: object }>>} prItems
 * @returns {Promise<Array<{ pr: object, verdict: object | null, signals: object, error?: string }>>}
 */
export async function analyzePRs(repo, prItems) {
  // Raise parallel AI calls from 3 to 5
  const rawResults = await runWithConcurrency(prItems, 5, async (item) => {
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
