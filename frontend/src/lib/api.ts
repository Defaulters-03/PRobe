import type { AnalyzeResponse } from "./types";
import { getMockResults } from "./mock";

// Extension environment: read the stored backend API URL from chrome.storage.sync
// (chrome.storage.sync.get is asynchronous, so the read happens inside analyzeRepo).
// Development environment: fall back to env vars.
async function getApiUrl(): Promise<string> {
  const g = globalThis as unknown as { chrome?: { storage?: { sync?: { get: (k: string) => Promise<Record<string, unknown>> } } } };
  if (g.chrome?.storage?.sync) {
    const stored = await g.chrome.storage.sync.get("apiUrl");
    return (stored?.apiUrl as string | undefined) ?? "http://localhost:4000";
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

/**
 * Analyse a GitHub repo's open pull requests.
 * When USE_MOCK is true the network is skipped entirely.
 */
export async function analyzeRepo(
  repo: string,
  page: number = 1
): Promise<AnalyzeResponse> {
  if (USE_MOCK) {
    return getMockResults(repo, page);
  }

  let res: Response;
  try {
    const API_URL = await getApiUrl();
    const url = new URL(`${API_URL}/api/analyze`);
    url.searchParams.set("page", String(page));

    res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, limit: 10, page }),
    });
  } catch {
    throw new Error("Could not reach the server");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body?.error ?? `Server responded with ${res.status}`
    );
  }

  return res.json() as Promise<AnalyzeResponse>;
}
