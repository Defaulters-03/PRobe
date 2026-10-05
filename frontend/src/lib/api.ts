import type { AnalyzeResponse } from "./types";
import { getMockResults } from "./mock";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

/**
 * Analyse a GitHub repo's open pull requests.
 * When USE_MOCK is true the network is skipped entirely.
 */
export async function analyzeRepo(repo: string): Promise<AnalyzeResponse> {
  if (USE_MOCK) {
    return getMockResults(repo);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, limit: 10 }),
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
