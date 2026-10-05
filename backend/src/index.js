// Test command:
// Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/analyze" -ContentType "application/json" -Body '{"repo":"expressjs/express","limit":5}'

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { normalizeRepo, parseLimit, fetchRepoPullRequests } from "./github.js";
import { analyzePRs } from "./analyze.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

// Warn if GITHUB_TOKEN is missing
if (!process.env.GITHUB_TOKEN?.trim()) {
  console.warn("⚠️ Warning: GITHUB_TOKEN is not set. GitHub API rate limits will be restricted.");
}

// Enable CORS for FRONTEND_ORIGIN
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// GET /health -> {"ok":true}
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// POST /api/analyze
app.post("/api/analyze", async (req, res, next) => {
  try {
    const { repo, limit } = req.body || {};

    // 1. Normalise the repo input to owner/name. Invalid -> 400 {"error":"..."}
    const normalizedRepo = normalizeRepo(repo);
    if (!normalizedRepo) {
      return res.status(400).json({
        error: "Invalid repository format. Please provide 'owner/repo' or a valid GitHub URL.",
      });
    }

    // 2. limit: default 10, max 20
    const parsedLimit = parseLimit(limit);

    // 3 & 4. Fetch PRs and build payloads
    const prItems = await fetchRepoPullRequests(normalizedRepo, parsedLimit);

    // 5, 6, 7 & 8. Analyze PRs (AI or mock, max 3 parallel, cached)
    const results = await analyzePRs(normalizedRepo, prItems);

    // Success response format
    return res.json({
      repo: normalizedRepo,
      analyzedAt: new Date().toISOString(),
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
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
