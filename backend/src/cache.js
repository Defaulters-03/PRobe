import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VERDICTS_FILE = path.resolve(__dirname, "../.cache/verdicts.json");

export class MemoryCache {
  constructor(defaultTtlMs = 10 * 60 * 1000) {
    this.cache = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

export class PersistentMemoryCache extends MemoryCache {
  constructor(filePath = DEFAULT_VERDICTS_FILE, defaultTtlMs = 60 * 60 * 1000) {
    super(defaultTtlMs);
    this.filePath = filePath;
    this.minIntervalMs = 5000; // write at most every 5 seconds
    this.lastSaveTime = 0;
    this.saveTimeout = null;

    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          const now = Date.now();
          for (const [key, entry] of Object.entries(data)) {
            if (
              entry &&
              entry.value &&
              typeof entry.expiresAt === "number" &&
              entry.expiresAt > now
            ) {
              this.cache.set(key, entry);
            }
          }
        }
      }
    } catch {
      // Ignore a missing or corrupt file
    }
  }

  flushToDisk() {
    this.lastSaveTime = Date.now();
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const now = Date.now();
      const obj = {};
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt > now) {
          obj[key] = entry;
        }
      }

      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error("Failed to persist verdicts cache:", err.message);
    }
  }

  scheduleSave() {
    if (this.saveTimeout) {
      return;
    }

    const now = Date.now();
    const timeSinceLastSave = now - this.lastSaveTime;

    if (timeSinceLastSave >= this.minIntervalMs) {
      this.saveTimeout = setTimeout(() => {
        this.saveTimeout = null;
        this.flushToDisk();
      }, 50);
    } else {
      const delay = this.minIntervalMs - timeSinceLastSave;
      this.saveTimeout = setTimeout(() => {
        this.saveTimeout = null;
        this.flushToDisk();
      }, delay);
    }
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    super.set(key, value, ttlMs);
    this.scheduleSave();
  }

  delete(key) {
    super.delete(key);
    this.scheduleSave();
  }

  clear() {
    super.clear();
    this.scheduleSave();
  }
}

// 60 minutes persistent per-PR verdict cache
export const verdictCache = new PersistentMemoryCache(DEFAULT_VERDICTS_FILE, 60 * 60 * 1000);

// 30 minutes in-memory author lookup cache
export const authorLookupCache = new MemoryCache(30 * 60 * 1000);

// 10 minutes in-memory full response cache for pagination and sorting
export const responseCache = new MemoryCache(10 * 60 * 1000);

