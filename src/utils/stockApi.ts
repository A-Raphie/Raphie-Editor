import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import https from "https";
import http from "http";

const execFileAsync = promisify(execFile);

let ffprobeBin = "ffprobe";
let minResolution = 1920;
let minVideoResolution = 1280; // videos are harder to find at high res — use a lower bar

const PELS_LIMIT = 190;
const PELS_WINDOW_MS = 60 * 60 * 1000;
const PELS_MAX_WAIT_MS = 15000;
const pexelsKeyTimestamps: Map<string, number[]> = new Map();

const PIXA_LIMIT = 4900;
const PIXA_WINDOW_MS = 60 * 60 * 1000;
const pixabayKeyTimestamps: Map<string, number[]> = new Map();

async function throttlePexels(keys: string[]): Promise<string | null> {
  if (keys.length === 0) return null;
  const now = Date.now();
  for (const key of keys) {
    const timestamps = pexelsKeyTimestamps.get(key) ?? [];
    while (timestamps.length > 0 && timestamps[0] < now - PELS_WINDOW_MS) {
      timestamps.shift();
    }
    if (timestamps.length < PELS_LIMIT) {
      timestamps.push(Date.now());
      pexelsKeyTimestamps.set(key, timestamps);
      return key;
    }
  }
  const sortedByKey = keys.map(k => {
    const ts = pexelsKeyTimestamps.get(k) ?? [];
    return { key: k, waitMs: ts.length > 0 ? ts[0] + PELS_WINDOW_MS - now + 1000 : 0 };
  }).sort((a, b) => a.waitMs - b.waitMs);
  const best = sortedByKey[0];
  if (best.waitMs > 0 && best.waitMs <= PELS_MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, best.waitMs));
    const ts = pexelsKeyTimestamps.get(best.key) ?? [];
    ts.push(Date.now());
    pexelsKeyTimestamps.set(best.key, ts);
    return best.key;
  }
  return null;
}

async function throttlePixabay(keys: string[]): Promise<string | null> {
  if (keys.length === 0) return null;
  const now = Date.now();
  for (const key of keys) {
    const timestamps = pixabayKeyTimestamps.get(key) ?? [];
    while (timestamps.length > 0 && timestamps[0] < now - PIXA_WINDOW_MS) {
      timestamps.shift();
    }
    if (timestamps.length < PIXA_LIMIT) {
      timestamps.push(Date.now());
      pixabayKeyTimestamps.set(key, timestamps);
      return key;
    }
  }
  const sortedByKey = keys.map(k => {
    const ts = pixabayKeyTimestamps.get(k) ?? [];
    return { key: k, waitMs: ts.length > 0 ? ts[0] + PIXA_WINDOW_MS - now + 1000 : 0 };
  }).sort((a, b) => a.waitMs - b.waitMs);
  const best = sortedByKey[0];
  if (best.waitMs > 0) {
    await new Promise((r) => setTimeout(r, Math.max(best.waitMs, 1000)));
    const ts = pixabayKeyTimestamps.get(best.key) ?? [];
    ts.push(Date.now());
    pixabayKeyTimestamps.set(best.key, ts);
    return best.key;
  }
  return null;
}

// Relevance filter: drop results whose tags/description don't contain the
// query's core subject words. Prevents off-topic results (e.g. "ginger cat"
// showing up for "pickled ginger"). Uses stem-matching for robustness.
const FILTER_SUFFIXES = new Set(["close", "up", "bowl", "plate", "cooking", "harvest", "garden", "ingredient", "raw", "prepared", "fresh", "organic", "market", "video", "footage"]);
const FILTER_STOP = new Set(["the", "a", "an", "that", "will", "heal", "you", "instantly", "with", "and", "for", "your", "from", "are", "was", "this"]);
function stem(w: string): string { return w.replace(/(ing|ed|s)$/,""); }

/**
 * Extract descriptive text from a Pexels/Pixabay page URL slug.
 * e.g. "https://www.pexels.com/video/a-woman-putting-mangoes-11760121/"
 *  → "a woman putting mangoes"
 * Used as pseudo-tags for Pexels results (which have no real tags field).
 */
function slugToText(url: string): string {
  try {
    const parts = (url || "").split("/");
    const slug = parts[parts.length - 2] || parts[parts.length - 1] || "";
    return slug.replace(/-\d+$/, "").replace(/-/g, " ").trim();
  } catch { return ""; }
}

/**
 * Check if a Pexels candidate's slug text contains any of the query's core
 * words (stem-matched). Used as a hard filter to drop irrelevant results
 * (e.g. "mangoes" for "walnuts").
 */
function pexelsSlugMatchesQuery(query: string, slugText: string): boolean {
  const queryWords = query.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !FILTER_SUFFIXES.has(w) && !FILTER_STOP.has(w));
  if (queryWords.length === 0) return true;
  if (!slugText) return true; // no text to check → pass
  const slugStems = slugText.toLowerCase().split(/[^a-z]+/).map(stem);
  return queryWords.some((w) => slugStems.includes(stem(w)));
}

/**
 * Soft ranker: sort candidates so those whose tags match more query words float
 * to the top. Unlike the old hard filter, NO results are dropped — the food
 * category filter (sent to the API) handles relevance at the source. This just
 * boosts the best matches within the returned set.
 */
export function rankByTags<T extends { tags?: any }>(query: string, candidates: T[]): T[] {
  const queryWords = query.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !FILTER_SUFFIXES.has(w) && !FILTER_STOP.has(w));
  if (queryWords.length === 0) return candidates;
  const queryStems = queryWords.map(stem);
  const score = (tags: any): number => {
    const tagStr = typeof tags === "string" ? tags : "";
    if (!tagStr) return 0;
    const tagStems = tagStr.toLowerCase().split(/[^a-z]+/).map(stem);
    return queryStems.filter((w) => tagStems.includes(w)).length;
  };
  return [...candidates].sort((a, b) => score(b.tags) - score(a.tags));
}

export function setBinPaths(ffprobe: string): void {
  ffprobeBin = ffprobe;
}

export function setMinResolution(res: number): void {
  if (res >= 2160) minResolution = 3840;
  else if (res >= 1080) minResolution = 1920;
  else minResolution = 1280;
}

export async function probeVideo(
  filePath: string
): Promise<{ duration: number; width: number; height: number }> {
  try {
    const { stdout } = await execFileAsync(ffprobeBin, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      filePath,
    ], { timeout: 10_000 });

    const info = JSON.parse(stdout);
    const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
    const format = info.format;

    return {
      duration: parseFloat(format?.duration ?? "0"),
      width: videoStream?.width ?? 0,
      height: videoStream?.height ?? 0,
    };
  } catch {
    return { duration: 0, width: 0, height: 0 };
  }
}

export async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobeBin, [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    filePath,
  ], { timeout: 10_000 });

  const info = JSON.parse(stdout);
  return parseFloat(info.format?.duration ?? "0");
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers, timeout: 15_000 }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${body.slice(0, 200)}`));
        });
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ${url} (status ${res.statusCode}): ${data.slice(0, 100)}`));
        }
      });
    });
    req.on("error", (err) => { reject(new Error(`Network error: ${err.message || err.code || "unknown"} from ${url}`)); });
    req.on("timeout", () => { req.destroy(); reject(new Error(`Request timeout: ${url}`)); });
  });
}

export type DownloadProgressCb = (percent: number, downloadedMB: string, totalMB: string) => void;

async function downloadSingle(url: string, outputPath: string, onProgress?: DownloadProgressCb, timeoutMs = 0, signal?: AbortSignal): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });
  if (signal?.aborted) throw new Error("Download aborted");

  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const file = require("fs").createWriteStream(outputPath);
    const abortHandler = () => {
      req.destroy();
      file.close();
      fs.unlink(outputPath).catch(() => {});
    };
    if (signal) signal.addEventListener("abort", abortHandler);
    const req = mod.get(url, { timeout: timeoutMs || undefined }, (res) => {
      if (signal?.aborted) {
        file.close();
        fs.unlink(outputPath).catch(() => {});
        reject(new Error("Download aborted"));
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        file.close();
        fs.unlink(outputPath).catch(() => {});
        reject(new Error(`HTTP ${res.statusCode}: download failed`));
        return;
      }
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadSingle(res.headers.location, outputPath, onProgress, timeoutMs, signal).then(resolve, reject);
        return;
      }
      const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
      let receivedBytes = 0;
      let lastPercent = -1;
      res.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0 && onProgress) {
          const pct = Math.floor((receivedBytes / totalBytes) * 100);
          if (pct >= lastPercent + 10) {
            lastPercent = pct;
            onProgress(pct, fmtMB(receivedBytes), fmtMB(totalBytes));
          }
        }
      });
      res.pipe(file);
      file.on("finish", async () => {
        if (signal) signal.removeEventListener("abort", abortHandler);
        file.close();
        const stat = await fs.stat(outputPath).catch(() => null);
        if (stat && stat.size < 1000) {
          await fs.unlink(outputPath).catch(() => {});
          reject(new Error(`Downloaded file too small: ${stat.size} bytes`));
          return;
        }
        resolve();
      });
    });
    req.on("error", (err: Error) => {
      if (signal) signal.removeEventListener("abort", abortHandler);
      file.close();
      fs.unlink(outputPath).catch(() => {});
      reject(err);
    });
    req.on("timeout", () => {
      req.destroy();
      file.close();
      fs.unlink(outputPath).catch(() => {});
      reject(new Error("Download timeout"));
    });
  });
}

async function downloadFile(url: string, outputPath: string, onProgress?: DownloadProgressCb, timeoutMs = 0, signal?: AbortSignal): Promise<void> {
  const effectiveTimeout = timeoutMs || 60_000;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await downloadSingle(url, outputPath, onProgress, effectiveTimeout, signal);
      return;
    } catch (err: any) {
      if (signal?.aborted) throw err;
      if (attempt === maxAttempts) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function fmtMB(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)}KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function durationTier(d: number): number {
  if (d >= 5 && d <= 10) return 0;
  if (d >= 11 && d <= 15) return 1;
  if (d >= 16 && d <= 20) return 2;
  return 3;
}

export async function searchAllVideoCandidates(
  query: string,
  pexelsApiKeys: string[],
  pixabayApiKeys: string[],
  excludeUrls?: Set<string>,
  category?: string
): Promise<Array<{ url: string; previewUrl: string; thumbnailUrl: string; duration: number; width: number; height: number; source: string }>> {
  const startPage = Math.floor(Math.random() * 5) + 1;
  const catParam = category ? `&category=${encodeURIComponent(category.toLowerCase())}` : "";
  const pexelsCat = category ? `&category=${encodeURIComponent(category.charAt(0).toUpperCase() + category.slice(1).toLowerCase())}` : "";
  const MAX_PAGES = 8;

  const searchPixabay = async (pageNum: number): Promise<any[]> => {
    if (pixabayApiKeys.length === 0) return [];
    try {
      const activeKey = await throttlePixabay(pixabayApiKeys);
      if (!activeKey) return [];
      const { hits } = await httpGet(
        `https://pixabay.com/api/videos/?key=${activeKey}&q=${encodeURIComponent(query)}&per_page=40&min_width=${minVideoResolution}&video_type=film&page=${pageNum}${catParam}`
      );
      if (!hits || hits.length === 0) return [];
      return hits.map((hit: any) => {
        const videos = hit.videos;
        const tiers = ["large", "medium", "small", "tiny"];
        const previewTiers = ["small", "tiny", "medium", "large"];
        let bestUrl = "";
        let previewUrl = "";
        for (const tier of tiers) {
          const v = videos[tier];
          if (v && v.url && !bestUrl) bestUrl = v.url;
        }
        for (const tier of previewTiers) {
          const v = videos[tier];
          if (v && v.url && !previewUrl) previewUrl = v.url;
        }
        if (!bestUrl) return null;
        const largeV = videos.large || videos.medium || videos.small || videos.tiny;
        // Drop clips shorter than 5s — body beats are 5-6s, so shorter clips
        // would trigger -stream_loop which deadlocks on truncated files.
        if ((hit.duration ?? 0) < 5) return null;
        return {
          url: bestUrl,
          previewUrl: previewUrl || bestUrl,
          thumbnailUrl: largeV?.thumbnail ?? "",
          pageUrl: hit.pageURL ?? "",
          duration: hit.duration ?? 0,
          width: largeV?.width ?? 0,
          height: largeV?.height ?? 0,
          source: "pixabay",
          tags: hit.tags ?? "",
        };
      }).filter(Boolean);
    } catch (err: any) { console.log(`[pixabay-video-error] query="${query}" err=${err?.message ?? "unknown"}`); return []; }
  };

  const searchPexels = async (pageNum: number): Promise<any[]> => {
    if (pexelsApiKeys.length === 0) return [];
    try {
      const activeKey = await throttlePexels(pexelsApiKeys);
      if (!activeKey) return [];
      // Pexels uses Elasticsearch — quoted phrase forces exact match.
      const pexQuery = query.includes(" ") ? `"${query}"` : query;
      const { videos } = await httpGet(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(pexQuery)}&per_page=40&size=large&page=${pageNum}&min_duration=5${pexelsCat}`,
        { Authorization: activeKey }
      );
      if (!videos || videos.length === 0) return [];
      return videos.map((video: any) => {
        const files = video.video_files;
        if (!files || files.length === 0) return null;
        const mp4Files = files.filter((f: any) => f.file_type === "video/mp4");
        const best = mp4Files.sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0];
        if (!best) return null;
        const preview = mp4Files.sort((a: any, b: any) => (a.width * a.height) - (b.width * b.height))[0];
        return {
          url: best.link,
          previewUrl: preview?.link ?? best.link,
          thumbnailUrl: video.image ?? "",
          duration: video.duration ?? 0,
          width: best.width,
          height: best.height,
          source: "pexels",
          pageUrl: video.url ?? "",
          tags: slugToText(video.url),
        };
      }).filter(Boolean);
    } catch { return []; }
  };

  // Pixabay-first sequential search: exhaust Pixabay pages, then fall back to
  // Pexels only if Pixabay didn't return enough. Pexels has a strict rate limit
  // (190/hr) and no tags on videos, so it's the last resort.
  const seenUrls = new Set<string>();
  const allCandidates: any[] = [];
  let attemptCount = 0;

  // Phase 1 — Pixabay only. Keep fetching until we have enough RELEVANT
  // results (after the hard tag/slug filter), not just raw results.
  const relevantCandidates: any[] = [];
  for (let attempt = 0; attempt < MAX_PAGES; attempt++) {
    attemptCount = attempt + 1;
    const pageNum = ((startPage - 1 + attempt) % 10) + 1;
    const pixRes = await searchPixabay(pageNum).catch(() => [] as any[]);
    for (const c of pixRes) {
      if (!seenUrls.has(c.url)) {
        seenUrls.add(c.url);
        allCandidates.push(c);
        if (pexelsSlugMatchesQuery(query, c.tags ?? slugToText(c.pageUrl ?? ""))) {
          relevantCandidates.push(c);
        }
      }
    }
    if (relevantCandidates.length >= 20 || pixRes.length === 0) break;
  }

  // Phase 2 — Pexels fallback (only if relevant Pixabay results weren't enough).
  if (relevantCandidates.length < 10) {
    for (let attempt = 0; attempt < 3; attempt++) {
      attemptCount++;
      const pageNum = ((startPage - 1 + attempt) % 10) + 1;
      const pelRes = await searchPexels(pageNum).catch(() => [] as any[]);
      for (const c of pelRes) {
        if (!seenUrls.has(c.url)) {
          seenUrls.add(c.url);
          allCandidates.push(c);
          if (pexelsSlugMatchesQuery(query, c.tags ?? slugToText(c.pageUrl ?? ""))) {
            relevantCandidates.push(c);
          }
        }
      }
      if (relevantCandidates.length >= 20 || pelRes.length === 0) break;
    }
  }

  // Hard-filter ALL candidates whose tags/slug don't contain any query word.
  // Every candidate MUST match — no cats for ginger, no tigers for walnuts.
  // If this leaves few results, the IPC handler's image fallback fills the gap.
  const afterFilter = allCandidates.filter((c) => {
    return pexelsSlugMatchesQuery(query, c.tags ?? slugToText(c.pageUrl ?? ""));
  });

  // Soft-rank by tag relevance.
  const pool = rankByTags(query, afterFilter);

  const result = excludeUrls && excludeUrls.size > 0
    ? pool.filter((c) => !excludeUrls.has(c.url))
    : pool;

  result.sort((a, b) => {
    // Pixabay first (has real tags → better relevance filtering), then by duration.
    const sourceDiff = (a.source === "pixabay" ? 0 : 1) - (b.source === "pixabay" ? 0 : 1);
    if (sourceDiff !== 0) return sourceDiff;
    return durationTier(a.duration) - durationTier(b.duration) || a.duration - b.duration;
  });
  return result;
}

export async function searchAllImageCandidates(
  query: string,
  pexelsApiKeys: string[],
  pixabayApiKeys: string[],
  excludeUrls?: Set<string>,
  category?: string
): Promise<Array<{ url: string; thumbnailUrl: string; width: number; height: number; source: string }>> {
  const startPage = Math.floor(Math.random() * 5) + 1;
  const catParam = category ? `&category=${encodeURIComponent(category.toLowerCase())}` : "";
  const pexelsCat = category ? `&category=${encodeURIComponent(category.charAt(0).toUpperCase() + category.slice(1).toLowerCase())}` : "";
  const MAX_PAGES = 8;

  const searchPixabay = async (pageNum: number): Promise<any[]> => {
    if (pixabayApiKeys.length === 0) return [];
    try {
      const activeKey = await throttlePixabay(pixabayApiKeys);
      if (!activeKey) return [];
      const { hits } = await httpGet(
        `https://pixabay.com/api/?key=${activeKey}&q=${encodeURIComponent(query)}&per_page=40&min_width=${minResolution}&image_type=photo&page=${pageNum}${catParam}`
      );
      if (!hits || hits.length === 0) return [];
      return hits.map((hit: any) => ({
        url: hit.largeImageURL || hit.fullHDURL || hit.webformatURL,
        thumbnailUrl: hit.previewURL || hit.webformatURL || "",
        pageUrl: hit.pageURL ?? "",
        tags: hit.tags ?? "",
        width: hit.imageWidth ?? 0,
        height: hit.imageHeight ?? 0,
        source: "pixabay",
      }));
    } catch { return []; }
  };

  const searchPexels = async (pageNum: number): Promise<any[]> => {
    if (pexelsApiKeys.length === 0) return [];
    try {
      const activeKey = await throttlePexels(pexelsApiKeys);
      if (!activeKey) return [];
      const pexQuery = query.includes(" ") ? `"${query}"` : query;
      const { photos } = await httpGet(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(pexQuery)}&per_page=40&page=${pageNum}${pexelsCat}`,
        { Authorization: activeKey }
      );
      if (!photos || photos.length === 0) return [];
      return photos.map((photo: any) => ({
        url: photo.src?.large2x || photo.src?.original || photo.src?.large,
        thumbnailUrl: photo.src?.medium || photo.src?.small || "",
        pageUrl: photo.url ?? "",
        tags: photo.alt ?? "",
        width: photo.width ?? 0,
        height: photo.height ?? 0,
        source: "pexels",
      }));
    } catch { return []; }
  };

  // Pixabay-first sequential search (same as video variant).
  const seenUrls = new Set<string>();
  const allCandidates: any[] = [];
  let attemptCount = 0;
  const relevantCandidates: any[] = [];

  // Phase 1 — Pixabay only.
  for (let attempt = 0; attempt < MAX_PAGES; attempt++) {
    attemptCount = attempt + 1;
    const pageNum = ((startPage - 1 + attempt) % 10) + 1;
    const pixRes = await searchPixabay(pageNum).catch(() => [] as any[]);
    for (const c of pixRes) {
      if (!seenUrls.has(c.url)) {
        seenUrls.add(c.url);
        allCandidates.push(c);
        if (pexelsSlugMatchesQuery(query, c.tags ?? slugToText(c.pageUrl ?? ""))) {
          relevantCandidates.push(c);
        }
      }
    }
    if (relevantCandidates.length >= 20 || pixRes.length === 0) break;
  }

  // Phase 2 — Pexels fallback (only if relevant Pixabay results weren't enough).
  if (relevantCandidates.length < 10) {
    for (let attempt = 0; attempt < 3; attempt++) {
      attemptCount++;
      const pageNum = ((startPage - 1 + attempt) % 10) + 1;
      const pelRes = await searchPexels(pageNum).catch(() => [] as any[]);
      for (const c of pelRes) {
        if (!seenUrls.has(c.url)) {
          seenUrls.add(c.url);
          allCandidates.push(c);
          if (pexelsSlugMatchesQuery(query, c.tags ?? slugToText(c.pageUrl ?? ""))) {
            relevantCandidates.push(c);
          }
        }
      }
      if (relevantCandidates.length >= 20 || pelRes.length === 0) break;
    }
  }

  // Hard-filter ALL candidates whose tags/alt/slug don't contain any query word.
  const afterFilter = allCandidates.filter((c) => {
    return pexelsSlugMatchesQuery(query, c.tags ?? slugToText(c.pageUrl ?? ""));
  });

  // Soft-rank by tag relevance.
  const pool = rankByTags(query, afterFilter);

  const result = excludeUrls && excludeUrls.size > 0
    ? pool.filter((c) => !excludeUrls.has(c.url))
    : pool;

  // Pixabay first (has real tags → better relevance filtering).
  result.sort((a, b) => (a.source === "pixabay" ? 0 : 1) - (b.source === "pixabay" ? 0 : 1));
  return result;
}

export function getRateLimitStatus(): { pexelsRemaining: number; pixabayRemaining: number } {
  const now = Date.now();
  let pexelsUsed = 0;
  let pixabayUsed = 0;
  for (const ts of pexelsKeyTimestamps.values()) {
    while (ts.length > 0 && ts[0] < now - PELS_WINDOW_MS) ts.shift();
    pexelsUsed += ts.length;
  }
  for (const ts of pixabayKeyTimestamps.values()) {
    while (ts.length > 0 && ts[0] < now - PIXA_WINDOW_MS) ts.shift();
    pixabayUsed += ts.length;
  }
  return {
    pexelsRemaining: Math.max(0, PELS_LIMIT * Math.max(1, pexelsKeyTimestamps.size) - pexelsUsed),
    pixabayRemaining: Math.max(0, PIXA_LIMIT * Math.max(1, pixabayKeyTimestamps.size) - pixabayUsed),
  };
}

export async function downloadCandidate(
  url: string,
  outputPath: string,
  onProgress?: DownloadProgressCb,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<void> {
  await downloadFile(url, outputPath, onProgress, timeoutMs, signal);
}
