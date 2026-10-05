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

/**
 * Analyzes a single PR using the external AI service or mock logic, with caching.
 *
 * @param {string} repo - The normalized repo name (owner/repo)
 * @param {object} item - Object containing { payload, prSummary, headSha }
 * @returns {Promise<{ pr: object, verdict: object | null, error?: string }>}
 */
export async function analyzeSinglePR(repo, item) {
  const { payload, prSummary, headSha } = item;
  const cacheKey = `${repo}#${payload.number}#${headSha}`;

  // 1. Check cache first
  const cachedVerdict = verdictCache.get(cacheKey);
  if (cachedVerdict) {
    return {
      pr: prSummary,
      verdict: cachedVerdict,
    };
  }

  const useMockAi = (process.env.USE_MOCK_AI || "true").toLowerCase() === "true";

  // 2. Use mock AI if requested
  if (useMockAi) {
    try {
      const verdict = generateMockVerdict(payload);
      verdictCache.set(cacheKey, verdict);
      return {
        pr: prSummary,
        verdict,
      };
    } catch (err) {
      return {
        pr: prSummary,
        verdict: null,
        error: err.message || "Failed to generate mock verdict",
      };
    }
  }

  // 3. Call external AI service
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
    };
  } catch (err) {
    return {
      pr: prSummary,
      verdict: null,
      error: err.message || "AI service request failed",
    };
  }
}

/**
 * Analyzes multiple PRs with a maximum concurrency of 3.
 *
 * @param {string} repo - The normalized repo name (owner/repo)
 * @param {Array<{ payload: object, prSummary: object, headSha: string }>} prItems
 * @returns {Promise<Array<{ pr: object, verdict: object | null, error?: string }>>}
 */
export async function analyzePRs(repo, prItems) {
  return runWithConcurrency(prItems, 3, async (item) => {
    return analyzeSinglePR(repo, item);
  });
}
