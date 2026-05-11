import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import https from "https";
import http from "http";

const execFileAsync = promisify(execFile);

let ffprobeBin = "ffprobe";
let minResolution = 1920;

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

async function downloadFile(url: string, outputPath: string, onProgress?: DownloadProgressCb, timeoutMs = 60_000, signal?: AbortSignal): Promise<void> {
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
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
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
        downloadFile(res.headers.location, outputPath, onProgress, timeoutMs, signal).then(resolve, reject);
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
  pexelsApiKey: string,
  pixabayApiKey: string
): Promise<Array<{ url: string; previewUrl: string; thumbnailUrl: string; duration: number; width: number; height: number; source: string }>> {
  const candidates: any[] = [];
  if (pexelsApiKey) try {
    const { videos } = await httpGet(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&size=large`,
      { Authorization: pexelsApiKey }
    );
    if (videos && videos.length > 0) for (const video of videos) {
      const files = video.video_files;
      if (!files || files.length === 0) continue;
      const mp4Files = files.filter((f: any) => f.file_type === "video/mp4");
      const best = mp4Files.sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0];
      if (!best) continue;
      const preview = mp4Files.sort((a: any, b: any) => (a.width * a.height) - (b.width * b.height))[0];
      candidates.push({
        url: best.link,
        previewUrl: preview?.link ?? best.link,
        thumbnailUrl: video.image ?? "",
        duration: video.duration ?? 0,
        width: best.width,
        height: best.height,
        source: "pexels",
      });
    }
  } catch {}
  if (pixabayApiKey) try {
    const { hits } = await httpGet(
      `https://pixabay.com/api/videos/?key=${pixabayApiKey}&q=${encodeURIComponent(query)}&per_page=15&min_width=${minResolution}&video_type=film`
    );
    if (hits && hits.length > 0) for (const hit of hits) {
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
      if (!bestUrl) continue;
      const largeV = videos.large || videos.medium || videos.small || videos.tiny;
      candidates.push({
        url: bestUrl,
        previewUrl: previewUrl || bestUrl,
        thumbnailUrl: largeV?.thumbnail ?? "",
        duration: hit.duration ?? 0,
        width: largeV?.width ?? 0,
        height: largeV?.height ?? 0,
        source: "pixabay",
      });
    }
  } catch {}
  candidates.sort((a, b) => {
    return durationTier(a.duration) - durationTier(b.duration) || a.duration - b.duration;
  });
  return candidates;
}

export async function searchAllImageCandidates(
  query: string,
  pexelsApiKey: string,
  pixabayApiKey: string
): Promise<Array<{ url: string; thumbnailUrl: string; width: number; height: number; source: string }>> {
  const candidates: any[] = [];
  if (pexelsApiKey) try {
    const { photos } = await httpGet(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15`,
      { Authorization: pexelsApiKey }
    );
    if (photos && photos.length > 0) for (const photo of photos) candidates.push({
      url: photo.src?.large2x || photo.src?.original || photo.src?.large,
      thumbnailUrl: photo.src?.medium || photo.src?.small || "",
      width: photo.width ?? 0,
      height: photo.height ?? 0,
      source: "pexels",
    });
  } catch {}
  if (pixabayApiKey) try {
    const { hits } = await httpGet(
      `https://pixabay.com/api/?key=${pixabayApiKey}&q=${encodeURIComponent(query)}&per_page=15&min_width=${minResolution}&image_type=photo`
    );
    if (hits && hits.length > 0) for (const hit of hits) candidates.push({
      url: hit.largeImageURL || hit.fullHDURL || hit.webformatURL,
      thumbnailUrl: hit.previewURL || hit.webformatURL || "",
      width: hit.imageWidth ?? 0,
      height: hit.imageHeight ?? 0,
      source: "pixabay",
    });
  } catch {}
  return candidates;
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
