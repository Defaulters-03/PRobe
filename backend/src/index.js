// Test command:
// Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/analyze" -ContentType "application/json" -Body '{"repo":"expressjs/express","limit":5}'

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { normalizeRepo, parseLimit, fetchRepoPullRequests } from "./github.js";
import { analyzePRs, sortResults } from "./analyze.js";
import { responseCache } from "./cache.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

// Warn if GITHUB_TOKEN is missing
if (!process.env.GITHUB_TOKEN?.trim()) {
  console.warn("⚠️ Warning: GITHUB_TOKEN is not set. GitHub API rate limits will be restricted.");
}

// Enable CORS for FRONTEND_ORIGIN and chrome extension origins
app.use(
  cors({
    origin: [FRONTEND_ORIGIN, "chrome-extension://*"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// GET /health -> 200 OK {"ok":true}
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// POST /api/analyze
app.post("/api/analyze", async (req, res, next) => {
  const pageStart = Date.now();
  try {
    const { repo, limit } = req.body || {};

    // 1. Normalise the repo input to owner/name. Invalid -> 400 {"error":"..."}
    const normalizedRepo = normalizeRepo(repo);
    if (!normalizedRepo) {
      return res.status(400).json({
        error: "Invalid GitHub repo. Paste a link like https://github.com/owner/repo",
      });
    }

    console.log(`[PRobe] Normalized repo: ${normalizedRepo}`);

    // Pagination: accept optional "page" param (default 1). Page size fixed at 10.
    const page = Math.max(1, parseInt(req.query.page || req.body?.page || "1", 10) || 1);
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    // Sorting: options "spam_score", "created_at_asc", "created_at_desc" (default: "spam_score")
    const rawSort = (req.query.sort || req.body?.sort || "spam_score").toLowerCase();
    const validSorts = ["spam_score", "created_at_asc", "created_at_desc"];
    const sort = validSorts.includes(rawSort) ? rawSort : "spam_score";

    // Limit param (default 10, max 20)
    const parsedLimit = req.body?.limit ? parseLimit(limit) : pageSize;

    // Check full response cache (10 min) keyed by repo, page, and sort
    const responseCacheKey = `${normalizedRepo}#page=${page}#sort=${sort}#limit=${parsedLimit}`;
    const cachedResponse = responseCache.get(responseCacheKey);
    if (cachedResponse) {
      const pageDuration = Date.now() - pageStart;
      console.log(`[perf] page=${page} total=${pageDuration}ms prs=${cachedResponse.count || 0}`);
      return res.json(cachedResponse);
    }

    // Fetch PRs from GitHub using pagination / sorting params
    const prItems = await fetchRepoPullRequests(normalizedRepo, parsedLimit, page, sort);

    // Parallel AI calls with AI_CONCURRENCY (default 10)
    const analyzedResults = await analyzePRs(normalizedRepo, prItems);

    // Apply sorting before slicing for pagination
    const sortedResults = sortResults(analyzedResults, sort);
    const paginatedResults = sortedResults.slice(0, pageSize);

    // Success response format
    const responseData = {
      repo: normalizedRepo,
      analyzedAt: new Date().toISOString(),
      page,
      sort,
      count: paginatedResults.length,
      results: paginatedResults,
    };

    // Cache full response for 10 minutes
    responseCache.set(responseCacheKey, responseData);

    const pageDuration = Date.now() - pageStart;
    console.log(`[perf] page=${page} total=${pageDuration}ms prs=${paginatedResults.length}`);

    return res.json(responseData);
  } catch (err) {
    next(err);
  }
});

// POST /api/prefetch {repo, page, sort}
app.post("/api/prefetch", (req, res) => {
  const { repo } = req.body || {};
  const normalizedRepo = normalizeRepo(repo);
  if (!normalizedRepo) {
    return res.status(400).json({
      error: "Invalid GitHub repo. Paste a link like https://github.com/owner/repo",
    });
  }

  const page = Math.max(1, parseInt(req.query.page || req.body?.page || "1", 10) || 1);
  const pageSize = 10;
  const rawSort = (req.query.sort || req.body?.sort || "spam_score").toLowerCase();
  const validSorts = ["spam_score", "created_at_asc", "created_at_desc"];
  const sort = validSorts.includes(rawSort) ? rawSort : "spam_score";

  // Reply 202 immediately
  res.status(202).json({
    status: "accepted",
    message: "Prefetch started",
    repo: normalizedRepo,
    page,
    sort,
  });

  // Background task: Never throw from the background task
  setImmediate(async () => {
    try {
      const responseCacheKey = `${normalizedRepo}#page=${page}#sort=${sort}#limit=${pageSize}`;
      if (responseCache.has(responseCacheKey)) {
        return;
      }

      const tStart = Date.now();
      const prItems = await fetchRepoPullRequests(normalizedRepo, pageSize, page, sort);
      if (!prItems || prItems.length === 0) {
        return;
      }

      // Concurrency of 4 for prefetch
      const analyzedResults = await analyzePRs(normalizedRepo, prItems, 4);
      const sortedResults = sortResults(analyzedResults, sort);
      const paginatedResults = sortedResults.slice(0, pageSize);

      const responseData = {
        repo: normalizedRepo,
        analyzedAt: new Date().toISOString(),
        page,
        sort,
        count: paginatedResults.length,
        results: paginatedResults,
      };

      responseCache.set(responseCacheKey, responseData);

      const pageDuration = Date.now() - tStart;
      console.log(`[perf] prefetch page=${page} total=${pageDuration}ms prs=${paginatedResults.length}`);
    } catch (err) {
      console.error("[PRobe] Prefetch background error:", err.message);
    }
  });
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";

  if (
    status === 429 ||
    message.toLowerCase().includes("rate limit")
  ) {
    return res.status(429).json({
      error: "GitHub rate limit reached, add a GITHUB_TOKEN",
    });
  }

  if (status === 404) {
    return res.status(404).json({
      error: message || "Repository not found",
    });
  }

  if (status === 400) {
    return res.status(400).json({
      error: message || "Bad request",
    });
  }

  console.error("Unhandled error:", err);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    error: message,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 PRobe backend listening on port ${PORT}`);
  console.log(`📡 Frontend Origin: ${FRONTEND_ORIGIN}`);
  console.log(`🤖 Mock AI: ${process.env.USE_MOCK_AI === "true" ? "ENABLED" : "DISABLED"}`);
});
