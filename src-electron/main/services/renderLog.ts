import path from "path";
import fs from "fs";
import { app } from "electron";

const MAX_ENTRIES = 50;

export interface RenderLogEntry {
  timestamp: string;
  totalBeats: number;
  durationSeconds: number;
  resolution: number;
  aspectRatio: string;
  codec: string;
  renderMode: string;
  renderConcurrency: number;
  totalMs: number;
  avgMsPerBeat: number;
  outputSizeBytes: number;
  imageCount: number;
  clipCount: number;
}

function getLogPath(): string {
  return path.join(app.getPath("userData"), "render_log.json");
}

export function appendRenderEntry(entry: RenderLogEntry): void {
  const logPath = getLogPath();
  let entries: RenderLogEntry[] = [];
  try {
    if (fs.existsSync(logPath)) {
      entries = JSON.parse(fs.readFileSync(logPath, "utf-8"));
    }
  } catch {}
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  try {
    fs.writeFileSync(logPath, JSON.stringify(entries, null, 2));
  } catch {}
}

export interface RenderEstimate {
  estMs: number;
  estSizeGB: number;
  confidence: "none" | "low" | "good";
  pastRenders: number;
}

const BASELINE_BYTES_PER_SEC: Record<string, Record<string, number>> = {
  h265: { "720": 375000, "1080": 750000, "2160": 1875000 },
  h264: { "720": 500000, "1080": 1000000, "2160": 3125000 },
};

export function getRenderEstimate(
  totalBeats: number,
  resolution: number,
  codec: string,
  renderMode: string,
  durationSeconds: number
): RenderEstimate {
  const logPath = getLogPath();
  let entries: RenderLogEntry[] = [];
  try {
    if (fs.existsSync(logPath)) {
      entries = JSON.parse(fs.readFileSync(logPath, "utf-8"));
    }
  } catch {}

  const matching = entries.filter(
    (e) =>
      e.resolution === resolution &&
      e.codec === codec &&
      e.renderMode === renderMode
  );

  const resKey = String(resolution);
  const baselineBytesPerSec = (BASELINE_BYTES_PER_SEC[codec] ?? BASELINE_BYTES_PER_SEC.h264)[resKey] ?? 750000;

  if (matching.length === 0) {
    const perBeatMs = resolution >= 2160 ? 4500 : 1500;
    const overheadMs = codec === "h265" ? 180000 : 60000;
    const estMs = totalBeats * perBeatMs + overheadMs;
    return {
      estMs,
      estSizeGB: parseFloat(((baselineBytesPerSec * durationSeconds) / 1024 / 1024 / 1024).toFixed(1)),
      confidence: "none",
      pastRenders: 0,
    };
  }

  const avgMsPerBeat =
    matching.reduce((sum, e) => sum + e.avgMsPerBeat, 0) / matching.length;
  const avgOverheadMs =
    matching.reduce((sum, e) => sum + (e.totalMs - e.avgMsPerBeat * e.totalBeats), 0) /
    matching.length;
  const estMs = Math.round(totalBeats * avgMsPerBeat + avgOverheadMs);

  let estSizeGB: number;
  const sizeEntries = matching.filter((e) => e.outputSizeBytes > 0 && e.durationSeconds > 0);
  if (sizeEntries.length > 0) {
    const avgBytesPerSec = sizeEntries.reduce(
      (sum, e) => sum + (e.outputSizeBytes / e.durationSeconds), 0
    ) / sizeEntries.length;
    estSizeGB = parseFloat(((avgBytesPerSec * durationSeconds) / 1024 / 1024 / 1024).toFixed(1));
  } else {
    estSizeGB = parseFloat(((baselineBytesPerSec * durationSeconds) / 1024 / 1024 / 1024).toFixed(1));
  }

  return {
    estMs,
    estSizeGB,
    confidence: matching.length >= 3 ? "good" : "low",
    pastRenders: matching.length,
  };
}
