"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  ExternalLink,
  ChevronDown,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  CheckCircle2,
  RotateCcw,
  ArrowUpRight,
  Search,
  X,
  Activity,
  Check,
} from "lucide-react";
import { parseRepoInput } from "@/lib/parseRepoInput";
import { analyzeRepo } from "@/lib/api";
import type { AnalyzeResponse, AnalysisResult } from "@/lib/types";

const EXAMPLE_REPOS = [
  "expressjs/express",
  "facebook/react",
  "vuejs/core",
  "tailwindlabs/tailwindcss",
];

const ITEMS_PER_PAGE = 10;

type SortOption = "score_desc" | "newest" | "oldest";

function GithubIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

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

function getDaysOld(isoDate: string): number {
  const created = new Date(isoDate).getTime();
  const diff = Date.now() - created;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
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
    <div className="relative group/score w-[200px] flex items-center justify-between gap-3 cursor-help">
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

      {/* Floating Tooltip on Score */}
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

function SegmentedBar({
  spam,
  lowEffort,
  legit,
  unanalyzed,
  total,
}: {
  spam: number;
  lowEffort: number;
  legit: number;
  unanalyzed: number;
  total: number;
}) {
  const [animated, setAnimated] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setAnimated(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [total]);

  if (total === 0) {
    return (
      <div
        aria-label="No pull requests analyzed"
        className="h-2 w-full rounded-full bg-[#1A2027]"
      />
    );
  }

  return (
    <div className="relative h-2 w-full rounded-full bg-[#1A2027] flex gap-[3px]">
      {spam > 0 && (
        <div
          role="progressbar"
          aria-label={`Spam: ${spam}`}
          style={{
            width: animated ? `${(spam / total) * 100}%` : "0%",
          }}
          className="group/seg relative h-full bg-[#FF5A4F] rounded-full transition-all duration-700 ease-out cursor-help"
        >
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/seg:flex items-center px-2.5 py-1 rounded border border-white/10 bg-[#161B22] text-[11px] font-mono text-[#EDEDEF] shadow-xl z-20 whitespace-nowrap">
            Spam: {spam}
          </div>
        </div>
      )}
      {lowEffort > 0 && (
        <div
          role="progressbar"
          aria-label={`Low effort: ${lowEffort}`}
          style={{
            width: animated ? `${(lowEffort / total) * 100}%` : "0%",
          }}
          className="group/seg relative h-full bg-[#FFB224] rounded-full transition-all duration-700 ease-out cursor-help"
        >
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/seg:flex items-center px-2.5 py-1 rounded border border-white/10 bg-[#161B22] text-[11px] font-mono text-[#EDEDEF] shadow-xl z-20 whitespace-nowrap">
            Low effort: {lowEffort}
          </div>
        </div>
      )}
      {legit > 0 && (
        <div
          role="progressbar"
          aria-label={`Legit: ${legit}`}
          style={{
            width: animated ? `${(legit / total) * 100}%` : "0%",
          }}
          className="group/seg relative h-full bg-[#2DD4BF] rounded-full transition-all duration-700 ease-out cursor-help"
        >
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/seg:flex items-center px-2.5 py-1 rounded border border-white/10 bg-[#161B22] text-[11px] font-mono text-[#EDEDEF] shadow-xl z-20 whitespace-nowrap">
            Legit: {legit}
          </div>
        </div>
      )}
      {unanalyzed > 0 && (
        <div
          role="progressbar"
          aria-label={`Unanalyzed: ${unanalyzed}`}
          style={{
            width: animated ? `${(unanalyzed / total) * 100}%` : "0%",
          }}
          className="group/seg relative h-full bg-[#6B7280] rounded-full transition-all duration-700 ease-out cursor-help"
        >
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/seg:flex items-center px-2.5 py-1 rounded border border-white/10 bg-[#161B22] text-[11px] font-mono text-[#EDEDEF] shadow-xl z-20 whitespace-nowrap">
            Unanalyzed: {unanalyzed}
          </div>
        </div>
      )}
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
    { value: "score_desc", label: "Spam score (high → low)" },
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
  ];

  const currentLabel =
    options.find((o) => o.value === value)?.label || "Sort";

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

function CommandPalette({
  isOpen,
  onClose,
  onSelectRepo,
  onSelectFilter,
  onFocusInput,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectRepo: (repo: string) => void;
  onSelectFilter: (filter: string) => void;
  onFocusInput: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setQuery("");
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const actions = [
    {
      category: "Action",
      label: "Focus repository input",
      action: () => {
        onClose();
        onFocusInput();
      },
    },
    ...EXAMPLE_REPOS.map((repo) => ({
      category: "Example Repo",
      label: `Analyze ${repo}`,
      action: () => {
        onClose();
        onSelectRepo(repo);
      },
    })),
    {
      category: "Filter",
      label: "Show All PRs",
      action: () => {
        onClose();
        onSelectFilter("all");
      },
    },
    {
      category: "Filter",
      label: "Filter by Spam",
      action: () => {
        onClose();
        onSelectFilter("spam");
      },
    },
    {
      category: "Filter",
      label: "Filter by Low Effort",
      action: () => {
        onClose();
        onSelectFilter("low_effort");
      },
    },
    {
      category: "Filter",
      label: "Filter by Legit",
      action: () => {
        onClose();
        onSelectFilter("legit");
      },
    },
  ];

  const filteredActions = actions.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-xs animate-fade-rise"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0E1116] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-white/10">
          <Search className="size-4 text-[#8B95A5]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or repository..."
            className="w-full bg-transparent text-sm text-[#EDEDEF] placeholder:text-[#6B7280] outline-none font-medium"
          />
          <button
            onClick={onClose}
            className="text-[#8B95A5] hover:text-white p-1 rounded transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
          {filteredActions.length === 0 ? (
            <p className="p-4 text-center text-xs text-[#8B95A5]">
              No matching commands.
            </p>
          ) : (
            filteredActions.map((item, idx) => (
              <button
                key={idx}
                onClick={item.action}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs text-[#EDEDEF] hover:bg-white/[0.06] hover:text-[#C8F135] transition-colors cursor-pointer group"
              >
                <span>{item.label}</span>
                <span className="font-mono text-[10px] text-[#6B7280] group-hover:text-[#8B95A5]">
                  {item.category}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PRobeApp() {
  const searchParams = useSearchParams();

  const [repoInput, setRepoInput] = React.useState("vercel/next.js");
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [normalizedRepo, setNormalizedRepo] =
    React.useState<string>("vercel/next.js");
  const [isLoading, setIsLoading] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<AnalyzeResponse | null>(null);
  const [activeTab, setActiveTab] = React.useState<string>("all");
  const [sortOption, setSortOption] = React.useState<SortOption>("score_desc");
  const [expandedPrs, setExpandedPrs] = React.useState<Set<number>>(new Set());
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [isScrolled, setIsScrolled] = React.useState(false);

  // Pagination state
  const initialPage = parseInt(searchParams.get("page") || "1", 10);
  const [currentPage, setCurrentPage] = React.useState(
    Number.isFinite(initialPage) && initialPage > 0 ? initialPage : 1
  );

  const activeAnalysisIdRef = React.useRef<number>(0);
  const prListTopRef = React.useRef<HTMLDivElement>(null);
  const repoInputRef = React.useRef<HTMLInputElement>(null);

  // Scroll listener for floating nav pill
  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ⌘K / Ctrl+K shortcut listener
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sync page changes with URL and history
  const updatePage = React.useCallback(
    (newPage: number, shouldScroll = true) => {
      setCurrentPage(newPage);
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (newPage > 1) {
          params.set("page", String(newPage));
        } else {
          params.delete("page");
        }
        const queryString = params.toString() ? `?${params.toString()}` : "";
        window.history.pushState(
          null,
          "",
          `${window.location.pathname}${queryString}`
        );
      }

      if (shouldScroll && prListTopRef.current) {
        prListTopRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    },
    []
  );

  // Browser back/forward button support
  React.useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const p = parseInt(params.get("page") || "1", 10);
      setCurrentPage(Number.isFinite(p) && p > 0 ? p : 1);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const executeAnalysis = React.useCallback(
    async (rawInput: string) => {
      const parsed = parseRepoInput(rawInput);
      if (!parsed) {
        setInputError(
          "Paste a GitHub repo link, like https://github.com/expressjs/express"
        );
        return;
      }

      setInputError(null);
      setNormalizedRepo(parsed);

      const currentId = ++activeAnalysisIdRef.current;
      setIsLoading(true);
      setApiError(null);
      setElapsedSeconds(0);
      updatePage(1, false);

      try {
        const response = await analyzeRepo(parsed);
        if (activeAnalysisIdRef.current === currentId) {
          setData(response);
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
    [updatePage]
  );

  // Timer effect for loading counter & 120s timeout
  React.useEffect(() => {
    if (!isLoading) {
      return;
    }

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

  // Initial load
  React.useEffect(() => {
    const timer = setTimeout(() => {
      executeAnalysis("vercel/next.js");
    }, 0);
    return () => clearTimeout(timer);
  }, [executeAnalysis]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeAnalysis(repoInput);
  };

  const handleSelectExample = (repo: string) => {
    setRepoInput(repo);
    executeAnalysis(repo);
  };

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    updatePage(1, false);
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
    return {
      analyzed: results.length,
      spam,
      lowEffort,
      legit,
    };
  }, [results]);

  const unanalyzedCount = Math.max(
    0,
    results.filter((r) => !r.verdict).length
  );

  // Sorting
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

  // Pagination calculation
  const totalPages = Math.max(
    1,
    Math.ceil(filteredResults.length / ITEMS_PER_PAGE)
  );
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(
    startIndex + ITEMS_PER_PAGE,
    filteredResults.length
  );
  const paginatedResults = filteredResults.slice(startIndex, endIndex);

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

  // Cursor spotlight handler for stat cards
  const handleSpotlight = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.style.setProperty("--mouse-x", `${x}px`);
    e.currentTarget.style.setProperty("--mouse-y", `${y}px`);
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

  return (
    <div className="relative min-h-screen bg-[#0A0A0B] text-[#EDEDEF] selection:bg-[#C8F135]/20 selection:text-[#C8F135]">
      {/* Textured Dither Dot Pattern Background fading toward edges */}
      <div
        className="pointer-events-none fixed inset-0 dither-pattern z-0"
        aria-hidden="true"
      />

      <CommandPalette
        isOpen={commandOpen}
        onClose={() => setCommandOpen(false)}
        onSelectRepo={handleSelectExample}
        onSelectFilter={handleTabChange}
        onFocusInput={() => repoInputRef.current?.focus()}
      />

      {/* Floating Centered Pill Navbar (Final, untouched) */}
      <nav className="sticky top-4 z-40 px-4">
        <div
          className={`mx-auto max-w-xl flex items-center justify-between rounded-full border bg-[#0E1015]/80 backdrop-blur-md transition-all duration-200 ${
            isScrolled
              ? "py-1.5 px-3.5 border-white/20 shadow-xl shadow-black/50 scale-[0.99]"
              : "py-2 px-4 border-white/10 shadow-sm"
          }`}
        >
          {/* Left: PRobe logo + subtle dot */}
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#C8F135] shadow-[0_0_8px_#C8F135]" />
            <span className="font-semibold text-sm tracking-tight text-[#EDEDEF]">
              PRobe
            </span>
            <span className="text-[10px] font-mono text-[#6B7280] hidden sm:inline ml-1 border-l border-white/10 pl-2">
              triage
            </span>
          </div>

          {/* Right: GitHub link + ⌘K button */}
          <div className="flex items-center gap-2">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-white px-2 py-1 rounded-md transition-colors"
            >
              <GithubIcon className="size-3.5" />
              <span className="hidden sm:inline">GitHub</span>
            </a>

            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-full border border-white/10 bg-white/[0.04] text-[#9CA3AF] hover:text-white hover:border-white/20 transition-all font-mono text-[11px] cursor-pointer"
              title="Search commands (⌘K)"
            >
              <span>⌘K</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Container: Exact Same Max-Width and Left/Right Edges for Grid, Toolbar & List */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 sm:py-12">
        {/* Hero Section (Final, untouched) */}
        <section className="text-center space-y-6 pt-4 sm:pt-6">
          {/* Pill Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-[#12141A] text-xs font-mono text-[#9CA3AF]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C8F135] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#C8F135]" />
            </span>
            <span>Built for open-source maintainers</span>
          </div>

          {/* Headline */}
          <div className="space-y-1">
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-[-0.04em] leading-[1.0] text-balance animate-fade-rise">
              <span className="text-[#A1A1AA] block">Cut the spam.</span>
              <span className="text-white block">Review what matters.</span>
            </h1>
          </div>

          {/* Subtitle */}
          <p className="max-w-[60ch] mx-auto text-sm sm:text-base text-[#9CA3AF] leading-relaxed text-balance">
            Scores PRs from 0–100 using account age, change size and content
            signals, so maintainers can close junk fast.
          </p>

          {/* Centered CTA Row */}
          <form
            onSubmit={handleSubmit}
            className="max-w-xl mx-auto space-y-3 pt-2"
          >
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-white/10 bg-[#12151B] focus-within:border-[#C8F135] focus-within:ring-1 focus-within:ring-[#C8F135] transition-all">
                <GithubIcon className="size-4 text-[#8B95A5] shrink-0" />
                <input
                  ref={repoInputRef}
                  type="text"
                  value={repoInput}
                  onChange={(e) => {
                    setRepoInput(e.target.value);
                    if (inputError) setInputError(null);
                  }}
                  placeholder="Paste a GitHub repo link"
                  className="w-full bg-transparent text-[#EDEDEF] placeholder:text-[#6B7280] text-xs sm:text-sm font-mono outline-none border-none"
                />
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-[#6B7280] bg-[#161B22] border border-white/10 rounded select-none shrink-0">
                  ⏎
                </kbd>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="h-10 px-5 bg-[#C8F135] text-[#0A0A0B] font-semibold text-xs rounded-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Analyzing</span>
                  </>
                ) : (
                  <>
                    <span>Analyze</span>
                    <ArrowUpRight className="size-4" />
                  </>
                )}
              </button>
            </div>

            {/* Normalized repo name / target label */}
            {normalizedRepo && !inputError && (
              <p className="text-[11px] font-mono text-[#8B95A5] text-center">
                Target: <span className="text-[#EDEDEF]">{normalizedRepo}</span>
              </p>
            )}

            {/* Inline Error */}
            {inputError && (
              <p className="text-xs text-[#FF5A4F] font-mono text-center pt-0.5">
                {inputError}
              </p>
            )}

            {/* Example Chips */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-xs">
              <span className="text-[#6B7280] text-[11px] font-mono mr-1">
                Try:
              </span>
              {EXAMPLE_REPOS.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleSelectExample(repo)}
                  className="px-2 py-0.5 rounded border border-white/10 bg-[#12151B] text-[#9CA3AF] hover:text-[#EDEDEF] hover:border-white/20 hover:bg-[#161B22] transition-colors font-mono text-[11px] cursor-pointer disabled:opacity-40"
                >
                  {repo}
                </button>
              ))}
            </div>

            {/* Three Tiny Facts in Muted Mono */}
            <p className="text-[11px] font-mono text-[#6B7280] text-center pt-2">
              Score 0–100 · Account-age signals · Close in one click
            </p>
          </form>
        </section>

        {/* Loading Message Banner with Elapsed Seconds */}
        {isLoading && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#12151B] px-4 py-3 text-xs shadow-md animate-fade-rise">
            <div className="flex items-center gap-2.5 text-[#EDEDEF]">
              <span className="inline-block size-1.5 rounded-full bg-[#C8F135] animate-pulse shrink-0" />
              <span>Analyzing pull requests... this can take up to a minute</span>
            </div>
            <div className="font-mono text-[#9CA3AF] bg-[#161B22] px-2 py-0.5 rounded border border-white/10">
              {elapsedSeconds}s elapsed
            </div>
          </div>
        )}

        {/* Error Banner with Retry Button */}
        {apiError && (
          <div className="mt-8 rounded-lg border border-[#FF5A4F]/30 bg-[#FF5A4F]/10 p-3.5 text-[#FF5A4F] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
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
              onClick={() => executeAnalysis(repoInput)}
              className="px-3 py-1 bg-[#FF5A4F]/20 hover:bg-[#FF5A4F]/30 text-[#FF5A4F] border border-[#FF5A4F]/40 rounded text-xs font-semibold shrink-0 cursor-pointer active:scale-95 transition-all flex items-center gap-1.5"
            >
              <RotateCcw className="size-3" />
              Retry
            </button>
          </div>
        )}

        {/* ── 1. STAT SECTION: Keep only the Analyzed card, centered (64px below hero) ── */}
        <section
          aria-label="Repository Statistics"
          className="mt-16 max-w-[640px] mx-auto w-full"
        >
          <div
            onMouseMove={handleSpotlight}
            className="group relative rounded-2xl border border-white/[0.08] bg-[#11141A] p-8 transition-colors duration-200 select-none flex flex-col items-center text-center gap-6"
          >
            {/* Soft cursor-following spotlight on hover (no lift or click behavior) */}
            <div
              className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  "radial-gradient(280px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255, 255, 255, 0.05), transparent 80%)",
              }}
              aria-hidden="true"
            />

            {/* 1. Small muted mono uppercase label "ANALYZED" with its icon badge beside it */}
            <div className="flex items-center justify-center gap-2">
              <div className="size-6 rounded-md border border-white/10 bg-white/[0.04] flex items-center justify-center text-[#8B95A5]">
                <Activity className="size-3.5" />
              </div>
              <span className="text-xs font-mono uppercase tracking-wider text-[#8B95A5]">
                Analyzed
              </span>
            </div>

            {/* 2. Big number (48px, semibold, tabular-nums, keeping count-up animation) */}
            <div className="text-[48px] leading-none font-semibold tabular-nums text-[#EDEDEF]">
              <AnimatedNumber value={data ? stats.analyzed : 0} />
            </div>

            {/* 3. Segmented progress bar (8px tall, fully rounded, 3px gaps, full card width, animates in from 0 on load) */}
            <div className="w-full">
              <SegmentedBar
                spam={stats.spam}
                lowEffort={stats.lowEffort}
                legit={stats.legit}
                unanalyzed={unanalyzedCount}
                total={stats.analyzed}
              />
            </div>
          </div>
        </section>

        {/* ── 2. TOOLBAR: Vertical Rhythm -> 48px below stat cards ── */}
        <div className="mt-12 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Segmented control with sliding active pill */}
          <div
            role="tablist"
            className="h-12 p-1 rounded-full border border-white/[0.08] bg-[#11141A] inline-flex items-center gap-1 overflow-x-auto scrollbar-none max-w-full"
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleTabChange(tab.id)}
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
                    <AnimatedNumber value={tab.count} />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Styled Sort Dropdown (48px height, hairline border, no persistent lime ring) */}
          <SortDropdown
            value={sortOption}
            onChange={(val) => {
              setSortOption(val);
              updatePage(1, false);
            }}
          />
        </div>

        {/* ── 3. PR LIST CONTAINER: Vertical Rhythm -> 20px below toolbar ── */}
        {/* ── 3. PR LIST: Every row is its own framed card with 12px vertical gap ── */}
        <section ref={prListTopRef} className="mt-5 space-y-3">
          {/* Column header row above cards as plain text, aligned to the card grid */}
          <div className="hidden sm:grid grid-cols-[64px_1fr_128px_200px_32px] gap-4 items-center px-6 py-2 text-[11px] font-mono uppercase tracking-wider text-[#6B7280]">
            <span>PR</span>
            <span>Title &amp; Author</span>
            <span className="text-center">Status</span>
            <span className="flex items-center justify-between pr-2">
              <span>Spam Score</span>
              <span className="text-[10px] text-[#4B5563] font-normal lowercase">
                (0–100)
              </span>
            </span>
            <span className="sr-only">Actions</span>
          </div>

          {/* Cards Stack */}
          <div className="flex flex-col gap-3">
            {isLoading ? (
              // Individual Card-shaped Skeleton Loaders
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="min-h-[80px] rounded-xl border border-white/[0.08] bg-[#11141A] px-6 py-5 flex items-center justify-between animate-pulse"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="h-4 w-10 bg-white/[0.05] rounded" />
                    <div className="space-y-2 flex-1 max-w-sm">
                      <div className="h-4 w-3/4 bg-white/[0.05] rounded" />
                      <div className="h-3 w-1/2 bg-white/[0.04] rounded" />
                    </div>
                  </div>
                  <div className="hidden sm:grid grid-cols-[128px_200px_32px] gap-4 items-center">
                    <div className="flex justify-center">
                      <div className="h-6 w-20 bg-white/[0.05] rounded-full" />
                    </div>
                    <div className="h-2 w-32 bg-white/[0.05] rounded-full" />
                    <div className="flex justify-end">
                      <div className="size-6 bg-white/[0.05] rounded-lg" />
                    </div>
                  </div>
                </div>
              ))
            ) : filteredResults.length === 0 ? (
              // Clean Empty State Card
              <div className="rounded-xl border border-white/[0.08] bg-[#11141A] p-12 text-center space-y-3">
                <div className="size-10 mx-auto rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-[#8B95A5]">
                  <CheckCircle2 className="size-5 text-[#2DD4BF]" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#EDEDEF]">
                    No pull requests in this view
                  </p>
                  <p className="text-xs text-[#8B95A5]">
                    {activeTab !== "all"
                      ? `No items matching "${activeTab.replace("_", " ")}"`
                      : "No open pull requests found."}
                  </p>
                </div>
                {activeTab !== "all" && (
                  <button
                    type="button"
                    onClick={() => handleTabChange("all")}
                    className="px-3 py-1 rounded border border-white/10 bg-white/[0.04] text-xs font-mono text-[#EDEDEF] hover:bg-white/[0.08] cursor-pointer"
                  >
                    View all PRs
                  </button>
                )}
              </div>
            ) : (
              // PR Cards
              paginatedResults.map((result: AnalysisResult, index: number) => {
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
                    tabIndex={0}
                    role="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpand(pr.number)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(pr.number);
                      }
                    }}
                    style={{
                      animationDelay: `${index * 35}ms`,
                    }}
                    className={`group relative rounded-xl border bg-[#11141A] transition-all duration-150 cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135] animate-row-in hover:-translate-y-[1px] ${
                      isExpanded
                        ? `${expandedBorder} bg-[#13171F] hover:bg-[#151922]`
                        : "border-white/[0.08] hover:border-white/20 hover:bg-[#13171F]"
                    }`}
                  >
                    {/* Main Row Grid: padding 20px 24px (px-6 py-5), min-height 80px */}
                    <div className="relative min-h-[80px] grid grid-cols-1 sm:grid-cols-[64px_1fr_128px_200px_32px] gap-3 sm:gap-4 items-center px-6 py-5">
                      {/* 3px rounded bar INSIDE the card, vertically inset 14px, shown only on hover and when expanded */}
                      <div
                        style={{ backgroundColor: statusColor }}
                        className={`absolute left-1.5 top-3.5 bottom-3.5 w-[3px] rounded-full transition-opacity duration-150 pointer-events-none ${
                          isExpanded
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                        aria-hidden="true"
                      />

                      {/* 1. PR Number (64px) */}
                      <div className="font-mono text-xs text-[#6B7280]">
                        #{pr.number}
                      </div>

                      {/* 2. Title + Meta (1fr) */}
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

                      {/* 3. Status Pill (128px, centered, nowrap) */}
                      <div className="hidden sm:block">
                        <StatusPill label={verdict?.label} />
                      </div>

                      {/* 4. Score Bar & Number (200px) */}
                      <div className="hidden sm:block">
                        <RowScore
                          score={verdict?.spam_score}
                          label={verdict?.label}
                        />
                      </div>

                      {/* Mobile View for Status Pill and Score */}
                      <div className="flex sm:hidden items-center justify-between pt-1">
                        <StatusPill label={verdict?.label} />
                        <RowScore
                          score={verdict?.spam_score}
                          label={verdict?.label}
                        />
                      </div>

                      {/* 5. Chevron Button (32px) */}
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

                    {/* Expanded details open INSIDE the same card below the row, with subtle top divider and padding aligned with title column */}
                    {isExpanded && (
                      <div className="border-t border-white/[0.06] sm:pl-[104px] sm:pr-6 px-6 py-5 animate-fade-rise">
                        <div className="space-y-4">
                          {verdict ? (
                            <>
                              <div className="space-y-2">
                                <span className="text-[10px] uppercase font-mono tracking-wider text-[#6B7280]">
                                  Reasons flagged
                                </span>
                                {verdict.reasons &&
                                verdict.reasons.length > 0 ? (
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
                                        : verdict.suggested_action ===
                                          "request_changes"
                                        ? "bg-[#FFB224]/10 text-[#FFB224] border-[#FFB224]/30"
                                        : "bg-[#2DD4BF]/10 text-[#2DD4BF] border-[#2DD4BF]/30"
                                    }`}
                                  >
                                    {verdict.suggested_action.replace(
                                      "_",
                                      " "
                                    )}
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
              })
            )}
          </div>

          {/* Pagination Bar (Hidden when <= 10 items) */}
          {!isLoading && filteredResults.length > ITEMS_PER_PAGE && (
            <nav
              tabIndex={0}
              onKeyDown={handlePaginationKeyDown}
              aria-label="Pagination"
              className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs font-mono outline-none focus-visible:ring-1 focus-visible:ring-[#C8F135] rounded px-1"
            >
              <span className="text-[#8B95A5]">
                Showing {filteredResults.length === 0 ? 0 : startIndex + 1}–
                {endIndex} of {filteredResults.length}
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safeCurrentPage <= 1}
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
                  disabled={safeCurrentPage >= totalPages}
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
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
          <Loader2 className="size-6 text-[#C8F135] animate-spin" />
        </div>
      }
    >
      <PRobeApp />
    </React.Suspense>
  );
}
