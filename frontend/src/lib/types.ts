// ── PR data from the backend ──────────────────────────────────

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string;
  authorCreatedAt: string; // ISO date
  createdAt: string;       // ISO date
  additions: number;
  deletions: number;
  changedFiles: number;
  bodyPreview: string;
}

export type Label = "spam" | "low_effort" | "legit";
export type SuggestedAction = "close" | "request_changes" | "review";

export interface Verdict {
  label: Label;
  spam_score: number;       // 0–100
  reasons: string[];
  suggested_action: SuggestedAction;
}

export interface AnalysisResult {
  pr: PullRequest;
  verdict: Verdict | null;
  error?: string;
}

// ── API response shapes ──────────────────────────────────────

export interface AnalyzeResponse {
  repo: string;
  analyzedAt: string;
  count: number;
  results: AnalysisResult[];
  page?: number;
  totalPages?: number;
  total?: number;
}

export interface ApiError {
  error: string;
}
