"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RotateCcw,
  Search,
  X,
  Activity,
  CheckCircle2,
  ArrowUpRight,
  Check,
  Command,
  ArrowUpDown,
} from "lucide-react";
import type {
  AnalyzeResponse,
  AnalysisResult,
} from "@/lib/types";
import { analyzeRepo } from "@/lib/api";

const ITEMS_PER_PAGE = 10;
type SortOption = "score_desc" | "newest" | "oldest";

function getDaysOld(isoDate: string): number {
  const created = new Date(isoDate).getTime();
  const diff = Date.now() - created;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function getPaginationItems(
  current: number,
  total: number
): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  for (let i = current - 1; i <= current + 1; i++) {
    if (i >= 1 && i <= total) pages.add(i);
  }
  if (current <= 2) {
    pages.add(2);
    pages.add(3);
  }
  if (current >= total - 1) {
    pages.add(total - 1);
    pages.add(total - 2);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push("ellipsis");
    }
    result.push(sorted[i]);
  }
  return result;
}

export interface ResultsDisplayProps {
  /**
   * The repo to analyze automatically on mount, e.g. "vercel/next.js".
   * When provided, the component fetches immediately without needing an
   * input field or hero — the extension has no place for those.
   */
  repo: string;
  /**
   * When true, the component drops the hero/search shell and only renders
   * the results content (analyzed card + PR table + pagination).
   */
  isEmbedded?: boolean;
}

/**
 * Embedded / lightweight version of the PRobe results view.
 *
 * Designed to be mounted by the browser-extension content script inside the
 * GitHub PR listing page. When `isEmbedded` is true (the default for the
 * extension) the hero, input field, navbar dock and command palette are
 * stripped away — only the analysed card, the PR table and the pagination bar
 * are rendered, wrapped in a slim header banner.
 */
export default function ResultsDisplay({
  repo,
  isEmbedded = true,
}: ResultsDisplayProps) {
  const [data, setData] = React.useState<AnalyzeResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [activeTab, setActiveTab] = React.useState<string>("all");
  const [sortOption, setSortOption] = React.useState<SortOption>("score_desc");
  const [expandedPrs, setExpandedPrs] = React.useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = React.useState(1);
  const [lastAnalyzedAt, setLastAnalyzedAt] = React.useState<number | null>(null);

  const activeAnalysisIdRef = React.useRef<number>(0);
  const prListTopRef = React.useRef<HTMLDivElement>(null);

  // ── Fetch ───────────────────────────────────────────────────────
  const fetchPage = React.useCallback(
    async (repoToFetch: string, pageToFetch: number = 1) => {
      const currentId = ++activeAnalysisIdRef.current;
      setIsLoading(true);
      setApiError(null);
      setElapsedSeconds(0);

      try {
        const response = await analyzeRepo(repoToFetch, pageToFetch);
        if (activeAnalysisIdRef.current === currentId) {
          setData(response);
          setLastAnalyzedAt(Date.now());
          setExpandedPrs(new Set());
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (activeAnalysisIdRef.current === currentId) {
          const message =
            err instanceof Error ? err.message : "Could not reach the server";
          setApiError(message);
          setData(null);
          setIsLoading(false);
        }
      }
    },
    []
  );

  const updatePage = React.useCallback(
    (newPage: number, shouldFetch = true) => {
      setCurrentPage(newPage);
      if (shouldFetch) {
        fetchPage(repo, newPage);
      }
    },
    [repo, fetchPage]
  );

  // Initial load
  React.useEffect(() => {
    fetchPage(repo, 1);
  }, [fetchPage, repo]);

  // Timer for elapsed seconds while loading
  React.useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= 120) {
          activeAnalysisIdRef.current = 0;
          setIsLoading(false);
          setApiError("Taking too long, try again");
          return 120;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isLoading]);

  // ── Stats ───────────────────────────────────────────────────────
  const results = React.useMemo(() => data?.results || [], [data?.results]);

  const stats = React.useMemo(() => {
    let spam = 0;
    let lowEffort = 0;
    let legit = 0;
    for (const r of results) {
      if (r.verdict?.label === "spam") spam++;
      else if (r.verdict?.label === "low_effort") lowEffort++;
      else if (r.verdict?.label === "legit") legit++;
    }
    return { analyzed: results.length, spam, lowEffort, legit };
  }, [results]);

  const unanalyzedCount = Math.max(
    0,
    results.filter((r) => !r.verdict).length
  );

  const analyzedWithScore = React.useMemo(
    () => results.filter((r) => typeof r.verdict?.spam_score === "number"),
    [results]
  );

  const avgSpamScore = React.useMemo(() => {
    if (analyzedWithScore.length === 0) return 0;
    const sum = analyzedWithScore.reduce(
      (acc, r) => acc + (r.verdict?.spam_score ?? 0),
      0
    );
    return Math.round(sum / analyzedWithScore.length);
  }, [analyzedWithScore]);

  const highestPR = React.useMemo(() => {
    if (analyzedWithScore.length === 0) return null;
    return analyzedWithScore.reduce((max, r) => {
      const score = r.verdict?.spam_score ?? 0;
      const maxScore = max.verdict?.spam_score ?? 0;
      return score > maxScore ? r : max;
    }, analyzedWithScore[0]);
  }, [analyzedWithScore]);

  const highestScore = highestPR?.verdict?.spam_score ?? 0;
  const spamRate =
    stats.analyzed > 0 ? Math.round((stats.spam / stats.analyzed) * 100) : 0;

  const sortedResults = React.useMemo(() => {
    return [...results].sort((a, b) => {
      if (sortOption === "newest") {
        return (
          new Date(b.pr.createdAt).getTime() -
          new Date(a.pr.createdAt).getTime()
        );
      }
      if (sortOption === "oldest") {
        return (
          new Date(a.pr.createdAt).getTime() -
          new Date(b.pr.createdAt).getTime()
        );
      }
      const scoreA = a.verdict?.spam_score ?? -1;
      const scoreB = b.verdict?.spam_score ?? -1;
      return scoreB - scoreA;
    });
  }, [results, sortOption]);

  const filteredResults = React.useMemo(() => {
    if (activeTab === "spam")
      return sortedResults.filter((r) => r.verdict?.label === "spam");
    if (activeTab === "low_effort")
      return sortedResults.filter((r) => r.verdict?.label === "low_effort");
    if (activeTab === "legit")
      return sortedResults.filter((r) => r.verdict?.label === "legit");
    if (activeTab === "unanalyzed")
      return sortedResults.filter((r) => !r.verdict);
    return sortedResults;
  }, [sortedResults, activeTab]);

  const totalPages = Math.max(
    1,
    data?.totalPages ??
      (data?.total
        ? Math.ceil(data.total / ITEMS_PER_PAGE)
        : undefined) ??
      (results.length === ITEMS_PER_PAGE ? Math.max(currentPage + 1, 3) : Math.max(currentPage, 1))
  );
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredResults.length);
  const paginatedResults =
    filteredResults.length > ITEMS_PER_PAGE
      ? filteredResults.slice(startIndex, endIndex)
      : filteredResults;

  const totalItemsCount =
    data?.total ??
    (data?.totalPages
      ? data.totalPages * ITEMS_PER_PAGE
      : results.length === ITEMS_PER_PAGE
        ? Math.max(currentPage * ITEMS_PER_PAGE, 30)
        : (safeCurrentPage - 1) * ITEMS_PER_PAGE + results.length);

  const displayStart =
    results.length > 0 ? (safeCurrentPage - 1) * ITEMS_PER_PAGE + 1 : 0;
  const displayEnd =
    results.length > 0
      ? (safeCurrentPage - 1) * ITEMS_PER_PAGE + paginatedResults.length
      : 0;

  const paginationItems = React.useMemo(
    () => getPaginationItems(safeCurrentPage, totalPages),
    [safeCurrentPage, totalPages]
  );

  const handlePaginationKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" && safeCurrentPage > 1) {
      e.preventDefault();
      updatePage(safeCurrentPage - 1);
    } else if (e.key === "ArrowRight" && safeCurrentPage < totalPages) {
      e.preventDefault();
      updatePage(safeCurrentPage + 1);
    }
  };

  const tabs = [
    {
      id: "all",
      label: "All",
      count: data ? stats.analyzed : 0,
      badgeActiveColor: "bg-white/[0.12] text-white",
    },
    {
      id: "spam",
      label: "Spam",
      count: data ? stats.spam : 0,
      badgeActiveColor: "bg-[#FF5A4F]/20 text-[#FF5A4F]",
    },
    {
      id: "low_effort",
      label: "Low effort",
      count: data ? stats.lowEffort : 0,
      badgeActiveColor: "bg-[#FFB224]/20 text-[#FFB224]",
    },
    {
      id: "legit",
      label: "Legit",
      count: data ? stats.legit : 0,
      badgeActiveColor: "bg-[#2DD4BF]/20 text-[#2DD4BF]",
    },
  ];

  // When embedded, don't render the hero / input / navbar — just the results.
  const content = (
    <>
      {/* Loading banner */}
      {isLoading && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#12151B] px-4 py-3 text-xs shadow-md animate-fade-rise">
          <div className="flex items-center gap-2.5 text-[#EDEDEF]">
            <Loader2 className="size-4 animate-spin text-[#C8F135] shrink-0" />
            <span>Fetching PRs... this may take a few seconds</span>
          </div>
          <div className="font-mono text-[#9CA3AF] bg-[#161B22] px-2 py-0.5 rounded border border-white/10">
            {elapsedSeconds}s elapsed
          </div>
        </div>
      )}

      {/* Error banner */}
      {apiError && !isLoading && (
        <div className="mt-4 rounded-lg border border-[#FF5A4F]/30 bg-[#FF5A4F]/10 p-3.5 text-[#FF5A4F] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                {apiError === "Taking too long, try again"
                  ? "Taking too long, try again"
                  : "Analysis failed"}
              </p>
              {apiError !== "Taking too long, try again" && (
                <p className="text-[11px] opacity-90">{apiError}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchPage(repo, 1)}
            className="px-3 py-1 bg-[#FF5A4F]/20 hover:bg-[#FF5A4F]/30 text-[#FF5A4F] border border-[#FF5A4F]/40 rounded text-xs font-semibold shrink-0 cursor-pointer active:scale-95 transition-all flex items-center gap-1.5"
          >
            <RotateCcw className="size-3" />
            Retry
          </button>
        </div>
      )}

      {/* Tab bar */}
      {data && !isLoading && (
        <div
          role="tablist"
          className="mt-4 h-12 p-1 rounded-full border border-white/[0.08] bg-[#11141A] inline-flex items-center gap-1 overflow-x-auto scrollbar-none max-w-full"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`h-full px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer flex items-center gap-2 select-none outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135] ${
                  isActive
                    ? "bg-[#1C2028] text-white shadow-xs"
                    : "text-[#8B95A5] hover:text-[#EDEDEF]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
                    isActive
                      ? tab.badgeActiveColor
                      : "bg-white/[0.06] text-[#A1A1AA]"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Sort dropdown + PR list */}
      {!isLoading && results.length > 0 && (
        <>
          {/* Sort dropdown row */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] font-mono text-[#8B95A5]">
              Sorted by{" "}
              {sortOption === "score_desc"
                ? "Spam Score (high→low)"
                : sortOption === "newest"
                ? "Date (newest first)"
                : "Date (oldest first)"}
            </span>
            <SortDropdown
              value={sortOption}
              onChange={(val) => {
                setSortOption(val);
                if (safeCurrentPage !== 1) setCurrentPage(1);
              }}
            />
          </div>

          {/* PR table card */}
          <section ref={prListTopRef} className="mt-3 space-y-3">
            {/* Column header (desktop) */}
            <div className="hidden sm:grid grid-cols-[64px_1fr_128px_200px_32px] gap-4 items-center px-6 py-2 text-[11px] font-mono uppercase tracking-wider text-[#6B7280]">
              <span>PR</span>
              <span>Title &amp; Author</span>
              <span className="text-center">Status</span>
              <span className="text-[10px] text-[#4B5563] font-normal lowercase">
                Spam Score (0–100)
              </span>
              <span className="sr-only">Actions</span>
            </div>

            {/* Cards stack */}
            <div className="flex flex-col gap-3">
              {paginatedResults.map((result: AnalysisResult, index: number) => {
                const { pr, verdict, error } = result;
                const isExpanded = expandedPrs.has(pr.number);
                const daysOld = getDaysOld(pr.authorCreatedAt);

                const statusColor =
                  verdict?.label === "spam"
                    ? "#FF5A4F"
                    : verdict?.label === "low_effort"
                    ? "#FFB224"
                    : verdict?.label === "legit"
                    ? "#2DD4BF"
                    : "#8B95A5";

                const expandedBorder =
                  verdict?.label === "spam"
                    ? "border-[#FF5A4F]/35"
                    : verdict?.label === "low_effort"
                    ? "border-[#FFB224]/35"
                    : verdict?.label === "legit"
                    ? "border-[#2DD4BF]/35"
                    : "border-white/20";

                return (
                  <div
                    key={pr.number}
                    id={`pr-row-${pr.number}`}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isExpanded}
                    onClick={() => {
                      setExpandedPrs((prev) => {
                        const next = new Set(prev);
                        if (next.has(pr.number)) next.delete(pr.number);
                        else next.add(pr.number);
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedPrs((prev) => {
                          const next = new Set(prev);
                          if (next.has(pr.number)) next.delete(pr.number);
                          else next.add(pr.number);
                          return next;
                        });
                      }
                    }}
                    style={{ animationDelay: `${index * 35}ms` }}
                    className={`group relative rounded-xl border bg-[#11141A] transition-all duration-150 cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135] animate-row-in hover:-translate-y-[1px] ${
                      isExpanded
                        ? `${expandedBorder} bg-[#13171F] hover:bg-[#151922]`
                        : "border-white/[0.08] hover:border-white/20 hover:bg-[#13171F]"
                    }`}
                  >
                    {/* Main row grid */}
                    <div className="relative min-h-[80px] grid grid-cols-1 sm:grid-cols-[64px_1fr_128px_200px_32px] gap-3 sm:gap-4 items-center px-6 py-5">
                      <div
                        style={{ backgroundColor: statusColor }}
                        className={`absolute left-1.5 top-3.5 bottom-3.5 w-[3px] rounded-full transition-opacity duration-150 pointer-events-none ${
                          isExpanded
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                        aria-hidden="true"
                      />

                      <div className="font-mono text-xs text-[#6B7280]">
                        #{pr.number}
                      </div>

                      <div className="min-w-0">
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[15px] font-medium leading-snug text-[#EDEDEF] group-hover:text-white transition-colors truncate flex items-center gap-1.5"
                          title={pr.title}
                        >
                          <span className="truncate">{pr.title}</span>
                          <ExternalLink className="size-3.5 text-[#8B95A5] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </a>

                        <div className="mt-1.5 text-[13px] text-[#8B95A5] flex items-center flex-wrap">
                          <span>@{pr.author}</span>
                          <span className="mx-2 text-[#4B5563]">·</span>
                          <span>{daysOld}d old</span>
                          <span className="mx-2 text-[#4B5563]">·</span>
                          <span className="font-mono">
                            <span className="text-[#2DD4BF]">
                              +{pr.additions}
                            </span>{" "}
                            <span className="text-[#FF5A4F]">
                              −{pr.deletions}
                            </span>
                          </span>
                          <span className="mx-2 text-[#4B5563]">·</span>
                          <span>
                            {pr.changedFiles}{" "}
                            {pr.changedFiles === 1 ? "file" : "files"}
                          </span>
                        </div>
                      </div>

                      <div className="hidden sm:block">
                        <StatusPill label={verdict?.label} />
                      </div>

                      <div className="hidden sm:block">
                        <RowScore
                          score={verdict?.spam_score}
                          label={verdict?.label}
                        />
                      </div>

                      <div className="flex sm:hidden items-center justify-between pt-1">
                        <StatusPill label={verdict?.label} />
                        <RowScore
                          score={verdict?.spam_score}
                          label={verdict?.label}
                        />
                      </div>

                      <div className="flex justify-end">
                        <div
                          className={`size-8 rounded-lg flex items-center justify-center text-[#8B95A5] group-hover:text-white hover:bg-white/[0.05] transition-transform duration-200 ${
                            isExpanded ? "rotate-180 text-white" : ""
                          }`}
                        >
                          <ChevronDown className="size-4" />
                        </div>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-white/[0.06] sm:pl-[104px] sm:pr-6 px-6 py-5 animate-fade-rise">
                        <div className="space-y-4">
                          {verdict ? (
                            <>
                              <div className="space-y-2">
                                <span className="text-[10px] uppercase font-mono tracking-wider text-[#6B7280]">
                                  Reasons flagged
                                </span>
                                {verdict.reasons && verdict.reasons.length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {verdict.reasons.map((reason, i) => (
                                      <ReasonTag key={i} reason={reason} />
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs font-mono text-[#6B7280]">
                                    No specific trigger reasons flagged.
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center justify-between pt-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-mono text-[#8B95A5]">
                                    Action:
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border ${
                                      verdict.suggested_action === "close"
                                        ? "bg-[#FF5A4F]/10 text-[#FF5A4F] border-[#FF5A4F]/30"
                                        : verdict.suggested_action === "request_changes"
                                        ? "bg-[#FFB224]/10 text-[#FFB224] border-[#FFB224]/30"
                                        : "bg-[#2DD4BF]/10 text-[#2DD4BF] border-[#2DD4BF]/30"
                                    }`}
                                  >
                                    {verdict.suggested_action.replace("_", " ")}
                                  </span>
                                </div>

                                <a
                                  href={pr.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-xs font-mono text-[#C8F135] hover:underline"
                                >
                                  <span>View on GitHub</span>
                                  <ArrowUpRight className="size-3.5" />
                                </a>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center justify-between text-xs">
                              <p className="text-[#FFB224] font-mono text-[11px]">
                                {error || "Analysis not available."}
                              </p>
                              <a
                                href={pr.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 font-mono text-[#C8F135] hover:underline"
                              >
                                View on GitHub
                                <ArrowUpRight className="size-3.5" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination bar */}
            {!isLoading && results.length > 0 && (
              <nav
                tabIndex={0}
                onKeyDown={handlePaginationKeyDown}
                aria-label="Pagination"
                className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 text-xs font-mono outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135] rounded px-1"
              >
                <span className="text-[#8B95A5]">
                  Showing {displayStart}–{displayEnd} of {totalItemsCount}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={safeCurrentPage <= 1 || isLoading}
                    onClick={() => updatePage(safeCurrentPage - 1)}
                    aria-label="Previous page"
                    className="px-2.5 py-1 rounded border border-white/10 bg-[#12151B] text-[#EDEDEF] hover:bg-[#161B22] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135]"
                  >
                    <ChevronLeft className="size-3.5" />
                    <span>Prev</span>
                  </button>

                  <div className="flex items-center gap-1">
                    {paginationItems.map((item, idx) => {
                      if (item === "ellipsis") {
                        return (
                          <span
                            key={`ell-${idx}`}
                            className="px-1 text-[#6B7280] select-none"
                          >
                            …
                          </span>
                        );
                      }
                      const isActive = item === safeCurrentPage;
                      return (
                        <button
                          key={item}
                          type="button"
                          disabled={isLoading}
                          onClick={() => updatePage(item)}
                          aria-label={`Go to page ${item}`}
                          aria-current={isActive ? "page" : undefined}
                          className={`size-7 rounded font-mono text-xs font-medium transition-all cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135] ${
                            isActive
                              ? "bg-[#C8F135] text-[#0A0A0B] font-bold"
                              : "border border-white/10 bg-[#12151B] text-[#9CA3AF] hover:text-[#EDEDEF] hover:bg-[#161B22]"
                          }`}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={safeCurrentPage >= totalPages || isLoading}
                    onClick={() => updatePage(safeCurrentPage + 1)}
                    aria-label="Next page"
                    className="px-2.5 py-1 rounded border border-white/10 bg-[#12151B] text-[#EDEDEF] hover:bg-[#161B22] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135]"
                  >
                    <span>Next</span>
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </nav>
            )}
          </section>
        </>
      )}

      {/* Empty state */}
      {!isLoading && !apiError && data && results.length === 0 && (
        <div className="mt-8 rounded-xl border border-white/[0.08] bg-[#11141A] p-8 text-center space-y-3">
          <div className="size-10 mx-auto rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-[#8B95A5]">
            <CheckCircle2 className="size-5 text-[#2DD4BF]" />
          </div>
          <p className="text-sm font-semibold text-[#EDEDEF]">
            No pull requests in this view
          </p>
          <p className="text-xs text-[#8B95A5]">
            No open pull requests found.
          </p>
        </div>
      )}
    </>
  );

  if (!isEmbedded) {
    // Full-page version: render hero + navbar + all the original chrome
    return (
      <div className="relative min-h-screen bg-[#0A0A0B] text-[#EDEDEF]">
        <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 sm:py-12">
          <section className="text-center space-y-6 pt-4 sm:pt-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-[#12141A] text-xs font-mono text-[#9CA3AF]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C8F135] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#C8F135]" />
              </span>
              <span>Built for open-source maintainers</span>
            </div>

            <div className="space-y-1">
              <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-[-0.04em] leading-[1.0] text-balance animate-fade-rise">
                <span className="text-[#A1A1AA] block">Cut the spam.</span>
                <span className="text-white block">Review what matters.</span>
              </h1>
            </div>

            <p className="max-w-[60ch] mx-auto text-sm sm:text-base text-[#9CA3AF] leading-relaxed text-balance">
              Scores PRs from 0–100 using account age, change size and content
              signals, so maintainers can close junk fast.
            </p>

            <div className="mt-6 text-center text-xs text-[#8B95A5] font-mono">
              Analyzing <span className="text-[#EDEDEF]">{repo}</span>
            </div>
          </section>

          <div className="mt-8">{content}</div>
        </div>
      </div>
    );
  }

  // Embedded: slim header + results only
  return (
    <div className="p-4 text-[#EDEDEF]">
      <div className="mb-4 flex items-center gap-2 text-xs font-mono text-[#9CA3AF]">
        <Activity className="size-3.5" />
        <span>
          PRobe analyzing <span className="text-[#EDEDEF]">{repo}</span>
        </span>
      </div>

      {content}
    </div>
  );
}

// ── Sub-components (extracted from page.tsx) ────────────────────────────────

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = React.useState(value);
  const prevValueRef = React.useRef(value);

  React.useEffect(() => {
    const start = prevValueRef.current;
    const end = value;
    prevValueRef.current = end;
    if (start === end) {
      setDisplayValue(end);
      return;
    }

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const frame = requestAnimationFrame(() => setDisplayValue(end));
      return () => cancelAnimationFrame(frame);
    }

    const duration = 500;
    const startTime = performance.now();

    let animationFrameId: number;
    const update = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.round(start + (end - start) * ease);
      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(update);
      }
    };

    animationFrameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrameId);
  }, [value]);

  return <span>{displayValue}</span>;
}

function StatusPill({
  label,
}: {
  label?: "spam" | "low_effort" | "legit" | null;
}) {
  let text = "Unanalyzed";
  let style = "bg-white/[0.04] text-[#8B95A5] border-white/10";

  if (label === "spam") {
    text = "Spam";
    style = "bg-[#FF5A4F]/10 text-[#FF5A4F] border-[#FF5A4F]/25";
  } else if (label === "low_effort") {
    text = "Low effort";
    style = "bg-[#FFB224]/10 text-[#FFB224] border-[#FFB224]/25";
  } else if (label === "legit") {
    text = "Legit";
    style = "bg-[#2DD4BF]/10 text-[#2DD4BF] border-[#2DD4BF]/25";
  }

  return (
    <div className="w-[128px] flex items-center justify-center">
      <span
        className={`h-6 px-3 rounded-full inline-flex items-center justify-center text-[11px] font-mono uppercase tracking-[0.04em] font-semibold border whitespace-nowrap select-none ${style}`}
      >
        {text}
      </span>
    </div>
  );
}

function RowScore({
  score,
  label,
}: {
  score?: number | null;
  label?: "spam" | "low_effort" | "legit" | null;
}) {
  const [animatedWidth, setAnimatedWidth] = React.useState(0);

  React.useEffect(() => {
    if (typeof score === "number") {
      const timeout = setTimeout(() => {
        setAnimatedWidth(Math.min(100, Math.max(0, score)));
      }, 40);
      return () => clearTimeout(timeout);
    }
  }, [score]);

  if (typeof score !== "number") {
    return (
      <div className="w-[200px] flex items-center justify-between gap-3">
        <div className="w-[120px] h-[5px] rounded-full bg-[#1A2027]" />
        <span className="w-8 text-right font-mono font-semibold text-xs text-[#6B7280]">
          —
        </span>
      </div>
    );
  }

  const barColor =
    label === "spam"
      ? "#FF5A4F"
      : label === "low_effort"
      ? "#FFB224"
      : "#2DD4BF";

  return (
    <div className="relative group/score w-[200px] flex items-center justify-between gap-3 cursor-default">
      <div className="w-[120px] h-[5px] rounded-full bg-[#1A2027] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${animatedWidth}%`,
            backgroundColor: barColor,
          }}
        />
      </div>

      <span className="w-8 text-right font-mono font-semibold text-xs tabular-nums text-[#EDEDEF]">
        {score}
      </span>

      <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden w-52 rounded-lg border border-white/10 bg-[#161B22] p-2 text-xs text-[#EDEDEF] shadow-xl group-hover/score:block z-30">
        <p className="font-semibold text-[#C8F135] text-[11px] mb-0.5">
          Spam Score: {score}/100
        </p>
        <p className="text-[#9CA3AF] text-[11px] leading-relaxed">
          {score < 30
            ? "Low likelihood of spam. Looks legitimate."
            : score < 70
            ? "Moderate low-effort signals detected."
            : "High likelihood of automated or junk PR."}
        </p>
      </div>
    </div>
  );
}

function ReasonTag({ reason }: { reason: string }) {
  const lower = reason.toLowerCase();
  let tagClass = "border-white/10 bg-white/[0.03] text-[#A1A1AA]";

  if (
    lower.includes("new account") ||
    lower.includes("spam") ||
    lower.includes("bot") ||
    lower.includes("suspicious")
  ) {
    tagClass = "border-[#FF5A4F]/25 bg-[#FF5A4F]/10 text-[#FF5A4F]";
  } else if (
    lower.includes("low effort") ||
    lower.includes("1 line") ||
    lower.includes("1-line") ||
    lower.includes("whitespace") ||
    lower.includes("no description")
  ) {
    tagClass = "border-[#FFB224]/25 bg-[#FFB224]/10 text-[#FFB224]";
  } else if (
    lower.includes("clean") ||
    lower.includes("test") ||
    lower.includes("verified") ||
    lower.includes("reputable")
  ) {
    tagClass = "border-[#2DD4BF]/25 bg-[#2DD4BF]/10 text-[#2DD4BF]";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border ${tagClass}`}
    >
      <span className="size-1 rounded-full bg-current opacity-80" />
      <span>{reason}</span>
    </span>
  );
}

function SortDropdown({
  value,
  onChange,
}: {
  value: SortOption;
  onChange: (val: SortOption) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const options: { value: SortOption; label: string }[] = [
    { value: "score_desc", label: "Spam Score (high→low)" },
    { value: "newest", label: "Date (newest first)" },
    { value: "oldest", label: "Date (oldest first)" },
  ];

  const currentLabel =
    options.find((o) => o.value === value)?.label || "Spam Score (high→low)";

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`h-12 px-4 rounded-[10px] border bg-[#11141A] text-xs font-mono text-[#EDEDEF] hover:bg-[#161B22] flex items-center gap-2 cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135] ${
          isOpen
            ? "border-[#C8F135]/60 ring-1 ring-[#C8F135]/60"
            : "border-white/[0.08]"
        }`}
      >
        <ArrowUpDown className="size-3.5 text-[#8B95A5]" />
        <span>{currentLabel}</span>
        <ChevronDown
          className={`size-3.5 text-[#8B95A5] transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-[10px] border border-white/[0.08] bg-[#11141A] shadow-2xl p-1 z-30 animate-fade-rise"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-mono text-left cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-white/[0.06] text-[#C8F135]"
                    : "text-[#EDEDEF] hover:bg-white/[0.04]"
                }`}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="size-3.5 text-[#C8F135]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
