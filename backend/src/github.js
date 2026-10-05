import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import { buildSignals, fetchAuthorHistoryBatch } from "./signals.js";

dotenv.config();

let octokitInstance = null;
let tokenWarned = false;

export class GitHubError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = "GitHubError";
  }
}

/**
 * Returns a configured Octokit instance.
 */
export function getOctokit() {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token && !tokenWarned) {
    console.warn("⚠️ Warning: GITHUB_TOKEN is not set. GitHub API rate limits will be restricted.");
    tokenWarned = true;
  }
  if (!octokitInstance) {
    octokitInstance = new Octokit(token ? { auth: token } : {});
  }
  return octokitInstance;
}

/**
 * Normalizes user input repository string or URL to "owner/repo".
 * Returns null if invalid.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeRepo(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  let str = input.trim();

  // Strip hash / fragment first
  const hashIdx = str.indexOf("#");
  if (hashIdx !== -1) {
    str = str.slice(0, hashIdx);
  }

  // Strip query string
  const queryIdx = str.indexOf("?");
  if (queryIdx !== -1) {
    str = str.slice(0, queryIdx);
  }

  // Handle git@github.com:owner/repo.git
  if (str.startsWith("git@github.com:")) {
    str = str.slice("git@github.com:".length);
  } else {
    // If input is an absolute URL
    try {
      if (/^https?:\/\//i.test(str)) {
        const parsedUrl = new URL(str);
        const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
        if (host !== "github.com") {
          return null;
        }
        str = parsedUrl.pathname;
      }
    } catch {
      return null;
    }

    // Strip github.com/ or www.github.com/ if provided without protocol
    str = str.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
  }

  // Strip leading and trailing slashes
  str = str.replace(/^\/+|\/+$/g, "");

  // Take only the first two path segments
  const parts = str.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const owner = parts[0].trim();
  let repo = parts[1].trim();

  // Strip trailing .git from repo name if present
  repo = repo.replace(/\.git$/i, "");

  // Validate they match /^[A-Za-z0-9_.-]+$/
  const validPattern = /^[A-Za-z0-9_.-]+$/;
  if (!validPattern.test(owner) || !validPattern.test(repo)) {
    return null;
  }

  return `${owner}/${repo}`;
}

/**
 * Parses and clamps limit (default 10, max 20).
 *
 * @param {any} limit
 * @returns {number}
 */
export function parseLimit(limit) {
  if (limit === undefined || limit === null || limit === "") {
    return 10;
  }
  const parsed = Number(limit);
  if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return 10;
  }
  return Math.min(20, parsed);
}

/**
 * Handles Octokit errors and maps them to appropriate GitHubError instances.
 *
 * @param {any} err
 */
export function handleOctokitError(err) {
  if (err.statusCode) {
    throw err;
  }

  const status = err.status || err.response?.status;
  const message = err.message || "";
  const remaining = err.response?.headers?.["x-ratelimit-remaining"];

  if (status === 404) {
    throw new GitHubError("Repository not found or access denied", 404);
  }

  if (
    status === 429 ||
    (status === 403 &&
      (remaining === "0" ||
        message.toLowerCase().includes("rate limit") ||
        message.toLowerCase().includes("secondary rate limit")))
  ) {
    throw new GitHubError("GitHub rate limit reached, add a GITHUB_TOKEN", 429);
  }

  throw new GitHubError(message || "GitHub API error", status || 500);
}

/**
 * Fetches open pull requests, detailed PR data, author history, and computed signals.
 *
 * @param {string} normalizedRepo - "owner/repo"
 * @param {number} limit - Number of PRs to fetch (default 10, max 20)
 * @param {number} page - Page number (default 1)
 * @param {string} sort - Sort option ("spam_score", "created_at_asc", "created_at_desc")
 * @returns {Promise<Array<{ payload: object, prSummary: object, headSha: string, signals: object, error?: string }>>}
 */
export async function fetchRepoPullRequests(normalizedRepo, limit = 10, page = 1, sort = "spam_score") {
  const [owner, repo] = normalizedRepo.split("/");
  const octokit = getOctokit();

  const direction = sort === "created_at_asc" ? "asc" : "desc";
  const perPage = Math.min(20, Math.max(1, limit || 10));

  let pullsListRes;
  try {
    pullsListRes = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      sort: "created",
      direction,
      per_page: perPage,
      page,
    });
  } catch (err) {
    handleOctokitError(err);
  }

  const openPRs = pullsListRes.data || [];
  if (openPRs.length === 0) {
    return [];
  }

  // Pre-extract batch title summaries for similarity matching
  const allPrsInBatch = openPRs.map((p) => ({
    number: p.number,
    title: p.title || "",
  }));

  // Look up author history once per unique author with 300ms gap and 30-min cache
  const authorLogins = openPRs.map((p) => p.user?.login).filter(Boolean);
  const authorHistory = await fetchAuthorHistoryBatch(octokit, owner, repo, authorLogins);

  // Cache user lookups during this request to avoid redundant calls
  const userCache = new Map();

  async function getUserInfo(username) {
    if (!username) return null;
    if (userCache.has(username)) {
      return userCache.get(username);
    }
    try {
      const res = await octokit.rest.users.getByUsername({ username });
      userCache.set(username, res.data);
      return res.data;
    } catch (err) {
      if (
        err.status === 429 ||
        (err.status === 403 && (err.message || "").toLowerCase().includes("rate limit"))
      ) {
        handleOctokitError(err);
      }
      userCache.set(username, null);
      return null;
    }
  }

  const items = await Promise.all(
    openPRs.map(async (pr) => {
      try {
        const [detailedPrRes, filesRes, userData] = await Promise.all([
          octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pr.number,
          }),
          octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 5,
            page: 1,
          }),
          getUserInfo(pr.user?.login),
        ]);

        const detailedPr = detailedPrRes.data;
        const filesData = filesRes.data || [];

        // Build signals and context object
        const signals = buildSignals({
          pr,
          detailedPr,
          files: filesData,
          owner,
          repo,
          allPrsInBatch,
          authorHistory,
        });

        // 4. Build payload per PR (with added context object)
        const payload = {
          number: pr.number,
          title: pr.title || "",
          body: pr.body ? String(pr.body).slice(0, 2000) : "",
          url: pr.html_url || "",
          created_at: pr.created_at,
          author: {
            login: pr.user?.login || "",
            account_created_at: userData?.created_at || null,
            public_repos: userData?.public_repos ?? 0,
            followers: userData?.followers ?? 0,
          },
          stats: {
            changed_files: detailedPr.changed_files ?? 0,
            additions: detailedPr.additions ?? 0,
            deletions: detailedPr.deletions ?? 0,
          },
          files: filesData.slice(0, 5).map((f) => ({
            filename: f.filename || "",
            status: f.status || "",
            additions: f.additions ?? 0,
            deletions: f.deletions ?? 0,
            patch: f.patch ? String(f.patch).slice(0, 1500) : "",
          })),
          context: signals,
        };

        // Frontend PR summary shape (unchanged)
        const prSummary = {
          number: pr.number,
          title: pr.title || "",
          url: pr.html_url || "",
          author: pr.user?.login || "",
          authorCreatedAt: userData?.created_at || null,
          createdAt: pr.created_at,
          additions: detailedPr.additions ?? 0,
          deletions: detailedPr.deletions ?? 0,
          changedFiles: detailedPr.changed_files ?? 0,
          bodyPreview: pr.body ? String(pr.body).slice(0, 300) : "",
        };

        const headSha = pr.head?.sha || detailedPr.head?.sha || "";

        return {
          payload,
          prSummary,
          headSha,
          signals,
        };
      } catch (err) {
        if (
          err.statusCode === 429 ||
          (err.message && err.message.toLowerCase().includes("rate limit"))
        ) {
          handleOctokitError(err);
        }
        return {
          payload: {
            number: pr.number,
            title: pr.title || "",
            body: pr.body ? String(pr.body).slice(0, 2000) : "",
            url: pr.html_url || "",
            created_at: pr.created_at,
            author: { login: pr.user?.login || "" },
            stats: { changed_files: 0, additions: 0, deletions: 0 },
            files: [],
            context: {},
          },
          prSummary: {
            number: pr.number,
            title: pr.title || "",
            url: pr.html_url || "",
            author: pr.user?.login || "",
            authorCreatedAt: null,
            createdAt: pr.created_at,
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            bodyPreview: pr.body ? String(pr.body).slice(0, 300) : "",
          },
          headSha: pr.head?.sha || "",
          signals: {},
          error: err.message || "Failed to fetch PR details",
        };
      }
    })
  );

  return items;
}
