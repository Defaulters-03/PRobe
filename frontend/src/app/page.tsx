"use client";

import * as React from "react";
import { ExternalLink, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { analyzeRepo } from "@/lib/api";
import type { AnalyzeResponse, AnalysisResult } from "@/lib/types";

function normalizeRepoInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let clean = trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (clean.toLowerCase().startsWith("github.com/")) {
    clean = clean.slice("github.com/".length);
  }
  clean = clean.replace(/\.git$/i, "").replace(/\/+$/, "");

  const parts = clean.split("/");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    const owner = parts[0].trim();
    const repo = parts[1].trim();
    const validOwner = /^[a-zA-Z0-9_.-]+$/.test(owner);
    const validRepo = /^[a-zA-Z0-9_.-]+$/.test(repo);
    if (validOwner && validRepo) {
      return `${owner}/${repo}`;
    }
  }
  return null;
}

function getDaysOld(isoDate: string): number {
  const created = new Date(isoDate).getTime();
  const diff = Date.now() - created;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export default function Home() {
  const [repoInput, setRepoInput] = React.useState("vercel/next.js");
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<AnalyzeResponse | null>(null);
  const [activeTab, setActiveTab] = React.useState<string>("all");
  const [expandedPrs, setExpandedPrs] = React.useState<Set<number>>(new Set());

  const executeAnalysis = React.useCallback(async (targetRepo: string) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const response = await analyzeRepo(targetRepo);
      setData(response);
      setExpandedPrs(new Set());
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not reach the server";
      setApiError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load with default repo
  React.useEffect(() => {
    executeAnalysis("vercel/next.js");
  }, [executeAnalysis]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRepoInput(repoInput);
    if (!normalized) {
      setInputError(
        "Please enter a valid owner/repo (e.g. vercel/next.js) or GitHub URL."
      );
      return;
    }
    setInputError(null);
    executeAnalysis(normalized);
  };

  const toggleExpand = (prNumber: number) => {
    setExpandedPrs((prev) => {
      const next = new Set(prev);
      if (next.has(prNumber)) {
        next.delete(prNumber);
      } else {
        next.add(prNumber);
      }
      return next;
    });
  };

  // Stats calculation
  const results = data?.results || [];
  const stats = React.useMemo(() => {
    let spam = 0;
    let lowEffort = 0;
    let legit = 0;
    for (const r of results) {
      if (r.verdict?.label === "spam") spam++;
      else if (r.verdict?.label === "low_effort") lowEffort++;
      else if (r.verdict?.label === "legit") legit++;
    }
    return {
      analyzed: results.length,
      spam,
      lowEffort,
      legit,
    };
  }, [results]);

  // Sorting: spam_score descending
  const sortedResults = React.useMemo(() => {
    return [...results].sort((a, b) => {
      const scoreA = a.verdict?.spam_score ?? -1;
      const scoreB = b.verdict?.spam_score ?? -1;
      return scoreB - scoreA;
    });
  }, [results]);

  // Tab filtering
  const filteredResults = React.useMemo(() => {
    if (activeTab === "spam") {
      return sortedResults.filter((r) => r.verdict?.label === "spam");
    }
    if (activeTab === "low_effort") {
      return sortedResults.filter((r) => r.verdict?.label === "low_effort");
    }
    if (activeTab === "legit") {
      return sortedResults.filter((r) => r.verdict?.label === "legit");
    }
    return sortedResults;
  }, [sortedResults, activeTab]);

  return (
    <div className="min-h-screen bg-[#0A0C0F] text-[#E8ECF1]">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        {/* 1. Header */}
        <header className="flex items-center justify-between pb-6 border-b border-[#262E38]">
          <div className="flex items-center gap-2.5">
            <span className="w-3.5 h-3.5 bg-[#C8F135] rounded-sm shrink-0" />
            <span className="font-bold text-xl tracking-tight text-[#E8ECF1]">
              PRSift
            </span>
          </div>
          <span className="text-xs text-[#8B95A5] font-mono">
            Maintainer PR Triage
          </span>
        </header>

        {/* 2. Hero */}
        <section className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-[#E8ECF1]">
              Cut the spam. Review what matters.
            </h1>
            <p className="text-[#8B95A5] text-base md:text-lg">
              Automated junk PR triage for open-source maintainers. Spot and close spam fast.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Input
                  value={repoInput}
                  onChange={(e) => {
                    setRepoInput(e.target.value);
                    if (inputError) setInputError(null);
                  }}
                  placeholder="owner/repo, e.g. vercel/next.js"
                  className="h-11 bg-[#12161B] border-[#262E38] text-[#E8ECF1] placeholder:text-[#8B95A5] rounded-lg focus-visible:ring-[#C8F135] focus-visible:border-[#C8F135] px-3.5 text-sm"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="h-11 px-6 bg-[#C8F135] text-[#0A0C0F] font-semibold hover:bg-[#b8de31] rounded-lg disabled:opacity-50 transition-colors shrink-0"
              >
                {isLoading ? "Analyzing..." : "Analyze"}
              </Button>
            </div>
            {inputError && (
              <p className="text-xs text-[#FF5A4F] font-medium pt-1">
                {inputError}
              </p>
            )}
          </form>
        </section>

        {/* Error Banner State */}
        {apiError && (
          <div className="rounded-xl border border-[#FF5A4F] bg-[#FF5A4F]/10 p-4 text-[#FF5A4F] flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-sm">Failed to fetch analysis</p>
              <p className="text-xs sm:text-sm opacity-90">{apiError}</p>
            </div>
          </div>
        )}

        {/* 3. Stats row, 4 cards */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <Card className="rounded-xl border border-[#262E38] bg-[#12161B] p-4 sm:p-5 gap-1 shadow-none">
            <span className="text-xs uppercase tracking-wider font-medium text-[#8B95A5]">
              Analyzed
            </span>
            <span className="text-2xl sm:text-3xl font-semibold text-[#E8ECF1]">
              {isLoading ? "—" : stats.analyzed}
            </span>
          </Card>
          <Card className="rounded-xl border border-[#262E38] bg-[#12161B] p-4 sm:p-5 gap-1 shadow-none">
            <span className="text-xs uppercase tracking-wider font-medium text-[#8B95A5]">
              Spam
            </span>
            <span className="text-2xl sm:text-3xl font-semibold text-[#FF5A4F]">
              {isLoading ? "—" : stats.spam}
            </span>
          </Card>
          <Card className="rounded-xl border border-[#262E38] bg-[#12161B] p-4 sm:p-5 gap-1 shadow-none">
            <span className="text-xs uppercase tracking-wider font-medium text-[#8B95A5]">
              Low effort
            </span>
            <span className="text-2xl sm:text-3xl font-semibold text-[#FFB224]">
              {isLoading ? "—" : stats.lowEffort}
            </span>
          </Card>
          <Card className="rounded-xl border border-[#262E38] bg-[#12161B] p-4 sm:p-5 gap-1 shadow-none">
            <span className="text-xs uppercase tracking-wider font-medium text-[#8B95A5]">
              Legit
            </span>
            <span className="text-2xl sm:text-3xl font-semibold text-[#2DD4BF]">
              {isLoading ? "—" : stats.legit}
            </span>
          </Card>
        </section>

        {/* 4. Tabs row */}
        <section className="space-y-4">
          <Tabs
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as string)}
            className="w-full"
          >
            <TabsList className="bg-[#12161B] border border-[#262E38] p-1 rounded-lg flex flex-wrap h-auto gap-1">
              <TabsTrigger
                value="all"
                className="data-active:bg-[#1A2027] data-active:text-[#E8ECF1] text-[#8B95A5] rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-colors"
              >
                All ({stats.analyzed})
              </TabsTrigger>
              <TabsTrigger
                value="spam"
                className="data-active:bg-[#1A2027] data-active:text-[#FF5A4F] text-[#8B95A5] rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-colors"
              >
                Spam ({stats.spam})
              </TabsTrigger>
              <TabsTrigger
                value="low_effort"
                className="data-active:bg-[#1A2027] data-active:text-[#FFB224] text-[#8B95A5] rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-colors"
              >
                Low effort ({stats.lowEffort})
              </TabsTrigger>
              <TabsTrigger
                value="legit"
                className="data-active:bg-[#1A2027] data-active:text-[#2DD4BF] text-[#8B95A5] rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-colors"
              >
                Legit ({stats.legit})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* 5. PR Cards list */}
          <div className="space-y-3">
            {isLoading ? (
              // Loading State: 5 Skeleton cards
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[#262E38] bg-[#12161B] p-4 sm:p-5 space-y-3.5"
                >
                  <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-5 w-2/5 sm:w-1/3 bg-[#1A2027]" />
                    <Skeleton className="h-5 w-20 rounded-full bg-[#1A2027]" />
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <Skeleton className="h-4 w-48 bg-[#1A2027]" />
                    <Skeleton className="h-4 w-32 bg-[#1A2027]" />
                  </div>
                </div>
              ))
            ) : filteredResults.length === 0 ? (
              // Empty State
              <div className="rounded-xl border border-[#262E38] bg-[#12161B] p-12 text-center space-y-2">
                <p className="text-[#8B95A5] text-base">
                  No open pull requests found.
                </p>
              </div>
            ) : (
              // PR Cards
              filteredResults.map((result: AnalysisResult) => {
                const { pr, verdict, error } = result;
                const isExpanded = expandedPrs.has(pr.number);
                const daysOld = getDaysOld(pr.authorCreatedAt);

                return (
                  <div
                    key={pr.number}
                    onClick={() => toggleExpand(pr.number)}
                    className="rounded-xl border border-[#262E38] bg-[#12161B] hover:border-[#333E4C] transition-colors p-4 sm:p-5 cursor-pointer space-y-3"
                  >
                    {/* Header Row: PR Title + Badge + Expand toggle */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#E8ECF1] font-semibold text-sm sm:text-base hover:text-[#C8F135] transition-colors inline-flex items-center gap-1.5 group"
                        >
                          <span>#{pr.number} {pr.title}</span>
                          <ExternalLink className="size-3.5 opacity-60 group-hover:opacity-100 shrink-0" />
                        </a>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-auto">
                        {verdict ? (
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${
                              verdict.label === "spam"
                                ? "bg-[#FF5A4F]/15 text-[#FF5A4F] border-[#FF5A4F]/30"
                                : verdict.label === "low_effort"
                                ? "bg-[#FFB224]/15 text-[#FFB224] border-[#FFB224]/30"
                                : "bg-[#2DD4BF]/15 text-[#2DD4BF] border-[#2DD4BF]/30"
                            }`}
                          >
                            {verdict.label === "low_effort"
                              ? "Low effort"
                              : verdict.label === "spam"
                              ? "Spam"
                              : "Legit"}
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FFB224]/15 text-[#FFB224] border border-[#FFB224]/30">
                            Analysis failed
                          </span>
                        )}
                        <div className="text-[#8B95A5]">
                          {isExpanded ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Metadata Row: Author info, diff stats, score bar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#8B95A5] pt-0.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>@{pr.author} · account {daysOld} days old</span>
                        <span>•</span>
                        <span className="font-mono">
                          <span className="text-[#2DD4BF]">+{pr.additions}</span>{" "}
                          <span className="text-[#FF5A4F]">−{pr.deletions}</span>{" "}
                          <span>· {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}</span>
                        </span>
                      </div>

                      {verdict ? (
                        <div className="flex items-center gap-2 self-start sm:self-auto">
                          <span className="text-[11px] text-[#8B95A5] uppercase tracking-wider font-mono">
                            Spam Score
                          </span>
                          <div className="w-20 sm:w-24 h-2 rounded-full bg-[#1A2027] border border-[#262E38] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, Math.max(0, verdict.spam_score))}%`,
                                backgroundColor:
                                  verdict.label === "spam"
                                    ? "#FF5A4F"
                                    : verdict.label === "low_effort"
                                    ? "#FFB224"
                                    : "#2DD4BF",
                              }}
                            />
                          </div>
                          <span className="font-mono font-bold text-xs text-[#E8ECF1] w-7 text-right">
                            {verdict.spam_score}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* If verdict is null, show the error text right on card */}
                    {!verdict && error && (
                      <div className="text-xs text-[#FFB224] bg-[#FFB224]/10 rounded-md p-2 border border-[#FFB224]/20">
                        {error}
                      </div>
                    )}

                    {/* Expanded Drawer */}
                    {isExpanded && (
                      <div className="pt-3 mt-3 border-t border-[#262E38] space-y-3">
                        {verdict ? (
                          <>
                            <div className="space-y-1.5">
                              <span className="text-xs font-semibold text-[#8B95A5] uppercase tracking-wider">
                                Reasons
                              </span>
                              <ul className="space-y-1 text-xs sm:text-sm text-[#E8ECF1]">
                                {verdict.reasons.map((reason, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <span className="text-[#8B95A5] mt-1 text-xs">•</span>
                                    <span>{reason}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-[#8B95A5]">
                                  Suggested action:
                                </span>
                                <span
                                  className={`px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider border ${
                                    verdict.suggested_action === "close"
                                      ? "bg-[#FF5A4F]/15 text-[#FF5A4F] border-[#FF5A4F]/30"
                                      : verdict.suggested_action === "request_changes"
                                      ? "bg-[#FFB224]/15 text-[#FFB224] border-[#FFB224]/30"
                                      : "bg-[#2DD4BF]/15 text-[#2DD4BF] border-[#2DD4BF]/30"
                                  }`}
                                >
                                  {verdict.suggested_action === "close"
                                    ? "close"
                                    : verdict.suggested_action === "request_changes"
                                    ? "request_changes"
                                    : "review"}
                                </span>
                              </div>

                              <a
                                href={pr.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 text-xs text-[#C8F135] hover:underline font-semibold"
                              >
                                Open on GitHub
                                <ExternalLink className="size-3.5" />
                              </a>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-[#FFB224]">
                              {error || "Analysis failed for this pull request."}
                            </p>
                            <a
                              href={pr.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 text-xs text-[#C8F135] hover:underline font-semibold"
                            >
                              Open on GitHub
                              <ExternalLink className="size-3.5" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
