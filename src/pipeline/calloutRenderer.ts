/**
 * Callout/banner overlay renderer.
 * Generates PNG overlays (white background, black text) using pureimage,
 * then composites them onto the video with FFmpeg.
 *
 * Two overlay types:
 * - number_callout: big "#9" centered, video dimmed 50%, rapid counting 1→N
 * - item_banner: small "#1 Green Tea — Tagline" at bottom-left, no dimming
 *
 * Timing: overlay.showAt is an offset from beat.startTime (relative within
 * the beat). The renderer computes startTime = beat.startTime + showAt to
 * get the absolute position in the concat video.
 */

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import type { Beat } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { Logger } from "../utils/logger.js";

interface Resolution {
  width: number;
  height: number;
}

const PImage = require("pureimage");

const FONT_PATHS = [
  "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
];

let loadedFont: any = null;
let loadedFontName = "Arial"; // fallback
async function getFont(): Promise<any> {
  if (loadedFont) return loadedFont;
  for (const p of FONT_PATHS) {
    if (fs.existsSync(p)) {
      try {
        // Register under a unique name so pureimage doesn't confuse it
        // with the default "Arial" fallback.
        loadedFontName = p.includes("Rounded") ? "ArialRoundedBold" : "ArialBold";
        loadedFont = PImage.registerFont(p, loadedFontName);
        await loadedFont.load();
        return loadedFont;
      } catch {}
    }
  }
  return null;
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function selectNumbers(targetNum: number): number[] {
  if (targetNum <= 5) {
    // Small numbers: count through every one
    return Array.from({ length: targetNum }, (_, i) => i + 1);
  }
  if (targetNum <= 10) {
    // Medium: 5 frames, 0.5s each, ending on target
    const middle = Array.from({ length: targetNum - 2 }, (_, i) => i + 2);
    const selected = shuffle(middle).slice(0, 3).sort((a, b) => a - b);
    return [1, ...selected, targetNum];
  }
  // Large (>10): 7 frames at 0.35s each = 2.45s, rapid-count feel.
  // Show evenly-spaced milestones to convey "counting up fast".
  const count = 7;
  const result: number[] = [1];
  for (let i = 1; i < count - 1; i++) {
    const v = Math.round(1 + (targetNum - 1) * (i / (count - 1)));
    if (v > 1 && v < targetNum) result.push(v);
  }
  result.push(targetNum);
  return result;
}

/**
 * Generate a callout PNG: white rectangle with black "#N" text.
 * IMPORTANT: pureimage defaults to fully transparent canvas. When FFmpeg
 * converts the PNG to yuv420p, any pixel with alpha < 255 turns BLACK.
 * So we must fill the ENTIRE canvas with opaque white (alpha = 255, not 0.9)
 * to avoid the thin black border around the box.
 */
async function generateCalloutPng(num: number, outPath: string): Promise<void> {
  const img = PImage.make(500, 400);
  const ctx = img.getContext("2d");
  // Opaque white fills entire canvas — prevents black border in yuv420p
  ctx.fillStyle = "rgb(255,255,255)";
  ctx.fillRect(0, 0, 500, 400);
  // Black "#N" text
  ctx.fillStyle = "#000000";
  ctx.font = `240pt '${loadedFontName}'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`#${num}`, 250, 200);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    PImage.encodePNGToStream(img, stream).catch(reject);
  });
}

/**
 * Generate a banner PNG: white rectangle with black text (two lines).
 * Fixed 800px width (handles 20-item lists), rounded to even for libx264.
 */
async function generateBannerPng(text: string, outPath: string, logger?: Logger): Promise<void> {
  const parts = text.split(/[—–]/).map((s: string) => s.trim()).filter(Boolean);
  const title = parts[0] || text;
  const tagline = parts[1] || "";
  const titleFontSize = 36;
  const taglineFontSize = 28;
  const height = tagline ? 120 : 70;
  const padding = 50;

  // Fixed width: 800px handles up to 20-item taglines.
  // Round to even — libx264 yuv420p requires even dimensions.
  const width = 800 + (800 % 2); // 800 is already even, but safety net
  const img = PImage.make(width, height);
  const ctx = img.getContext("2d");
  // Opaque white — alpha 0.9 turns black in yuv420p conversion
  ctx.fillStyle = "rgb(255,255,255)";
  ctx.fillRect(0, 0, width, height);
  // Title
  ctx.fillStyle = "#000000";
  ctx.font = `${titleFontSize}pt '${loadedFontName}'`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(title, padding, 12);
  // Tagline
  if (tagline) {
    ctx.fillStyle = "#000000";
    ctx.font = `${taglineFontSize}pt '${loadedFontName}'`;
    ctx.fillText(tagline, padding, 65);
  }
  if (logger) {
    await logger.log(`[DEBUG] BannerPng: text="${text}", title="${title}", tagline="${tagline || "(none)"}", canvas=${width}x${height}, titleFont=${titleFontSize}pt, taglineFont=${taglineFontSize}pt, outPath="${outPath}"`);
  }
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    PImage.encodePNGToStream(img, stream).catch(reject);
  });
}

function runFFmpegSimple(
  ffmpeg: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { timeout, signal });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-200)}`));
    });
    child.on("error", reject);
  });
}

/**
 * Pre-render a single PNG to a short MP4 clip using -loop 1.
 * Returns the path to the MP4 file.
 */
async function preRenderPngToMp4(
  ffmpeg: string,
  pngPath: string,
  durationSec: number,
  outPath: string,
): Promise<string> {
  await runFFmpegSimple(ffmpeg, [
    "-y",
    "-loop", "1",
    "-t", String(durationSec),
    "-i", pngPath,
    "-c:v", "libx264", "-crf", "18", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-r", "24",
    "-an",
    outPath,
  ], 30_000);
  return outPath;
}

/**
 * Pre-render counting animation (1→N) into a single MP4 clip.
 * Shows 5 randomized numbers (0.5s each = 2.5s total, matching calloutDuration).
 * Uses concat filter (re-encodes, reliable) instead of concat demuxer (copy, drops short segments).
 */
async function preRenderCountingToMp4(
  ffmpeg: string,
  beatId: string,
  targetNum: number,
  overlayDir: string,
): Promise<string> {
  const numbers = selectNumbers(targetNum);
  const outPath = path.join(overlayDir, `counting_${beatId}.mp4`);

  // Frame time: 0.5s for small/medium numbers, faster (0.35s) for large
  // so the rapid-count feels like 15-20x speed for targets >10.
  const frameTime = targetNum > 10 ? 0.35 : 0.5;

  // Generate all PNGs first
  const pngPaths: string[] = [];
  for (const n of numbers) {
    const pngPath = path.join(overlayDir, `count_${beatId}_${n}.png`);
    await generateCalloutPng(n, pngPath);
    pngPaths.push(pngPath);
  }

  // Single FFmpeg command: loop each PNG, concat filter stitches them together
  const inputs: string[] = [];
  const streamLabels: string[] = [];
  for (let i = 0; i < pngPaths.length; i++) {
    inputs.push("-loop", "1", "-t", String(frameTime), "-i", pngPaths[i]);
    streamLabels.push(`${i}:v`);
  }

  const filterComplex = `[${streamLabels.join("][")}]concat=n=${pngPaths.length}:v=1:a=0[out]`;

  await runFFmpegSimple(ffmpeg, [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-c:v", "libx264", "-crf", "18", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-r", "24",
    "-an",
    outPath,
  ], 30_000);

  // Cleanup PNGs
  for (const p of pngPaths) fs.unlinkSync(p);

  return outPath;
}

export async function generateCalloutOverlays(
  inputVideo: string,
  beats: Beat[],
  config: Config,
  logger: Logger,
  res: Resolution,
  segmentDir: string,
  signal?: AbortSignal,
  videoDuration?: number
): Promise<string> {
  await getFont();
  const ffmpeg = config.ffmpegPath || "ffmpeg";
  const outputVideo = path.join(segmentDir, "with_callouts.mp4");
  const overlayDir = path.join(segmentDir, "callout_pngs");
  fs.mkdirSync(overlayDir, { recursive: true });

  await logger.log(`[DEBUG] generateCalloutOverlays: input="${inputVideo}", beats=${beats.length}, resolution=${res.width}x${res.height}`);
  await logger.log(`[DEBUG] Font loaded: ${loadedFont ? "yes" : "no (using default)"}`);

  // Phase 1: Generate all overlay PNGs.
  // Callouts: 2 PNGs (N-1 flash, then N final).
  // Banners: 1 PNG (static text).
  // All fed with -loop 1 so frames are always available at any timestamp.
  const calloutPngMap = new Map<string, { prev2: string; prev1: string; final: string }>();
  const bannerPngMap = new Map<string, string>();

  for (const beat of beats) {
    const overlay = beat.overlay;
    if (!overlay) continue;

    try {
      if (overlay.type === "number_callout" && overlay.number) {
        const targetNum = overlay.number;
        const prev1Num = Math.max(1, targetNum - 1);
        const prev2Num = Math.max(1, targetNum - 2);
        const finalPath = path.join(overlayDir, `callout_${beat.id}_final.png`);
        const prev1Path = path.join(overlayDir, `callout_${beat.id}_prev1.png`);
        const prev2Path = path.join(overlayDir, `callout_${beat.id}_prev2.png`);
        await generateCalloutPng(targetNum, finalPath);
        if (prev1Num !== targetNum) await generateCalloutPng(prev1Num, prev1Path);
        if (prev2Num !== prev1Num && prev2Num !== targetNum) await generateCalloutPng(prev2Num, prev2Path);
        if (fs.existsSync(finalPath)) {
          calloutPngMap.set(beat.id, {
            prev2: fs.existsSync(prev2Path) ? prev2Path : "",
            prev1: fs.existsSync(prev1Path) ? prev1Path : "",
            final: finalPath,
          });
          await logger.log(`[DEBUG] Callout PNGs ready: beat=${beat.id}, num=${targetNum}, prev1=${prev1Num}, prev2=${prev2Num}`);
        }
      } else if (overlay.type === "item_banner" && overlay.label) {
        const pngPath = path.join(overlayDir, `banner_${beat.id}.png`);
        await generateBannerPng(overlay.label, pngPath, logger);
        if (fs.existsSync(pngPath)) {
          bannerPngMap.set(beat.id, pngPath);
          await logger.log(`[DEBUG] Banner PNG ready: beat=${beat.id}, label="${overlay.label}", path="${pngPath}"`);
        }
      }
    } catch (err) {
      await logger.warn(`[DEBUG] Pre-render failed for beat ${beat.id}: ${err}`);
    }
  }

  if (calloutPngMap.size === 0 && bannerPngMap.size === 0) return inputVideo;

  // Phase 2: Segment-split overlay (same pattern as applyVfxOverlays).
  // Instead of re-encoding the entire video, split it into segments at overlay
  // boundaries. Clean segments are stream-copied (instant). Overlay segments are
  // re-encoded with relative timestamps (fast — only a few seconds each).
  const totalDuration = videoDuration || 240;
  const padding = 1;

  // Collect all overlay windows with their beat info.
  interface OverlayWindow {
    start: number; end: number;
    beatId: string;
    type: "number_callout" | "item_banner";
    calloutDuration: number; // for callouts: 2.5s, for banners: 5s
  }
  const windows: OverlayWindow[] = [];
  for (const beat of beats) {
    const overlay = beat.overlay;
    if (!overlay) continue;
    const startTime = beat.startTime + (overlay.showAt || 0);
    if (overlay.type === "number_callout" && overlay.number) {
      windows.push({ start: startTime, end: startTime + 2.5, beatId: beat.id, type: "number_callout", calloutDuration: 2.5 });
    } else if (overlay.type === "item_banner" && overlay.label) {
      windows.push({ start: startTime, end: startTime + 5, beatId: beat.id, type: "item_banner", calloutDuration: 5 });
    }
  }

  // Sort by start time.
  windows.sort((a, b) => a.start - b.start);

  // Build segment list: clean (copy) and overlay (encode) segments.
  const segments: { start: number; end: number; overlays: OverlayWindow[] }[] = [];
  let currentPos = 0;
  for (const win of windows) {
    // Clean segment before this window (if there's a gap).
    if (win.start - padding > currentPos) {
      segments.push({ start: currentPos, end: win.start - padding, overlays: [] });
    }
    // Start or extend an overlay segment.
    const segStart = Math.max(currentPos, win.start - padding);
    const segEnd = win.end + padding;
    // Check if we can merge with the previous segment.
    const prevSeg = segments[segments.length - 1];
    if (prevSeg && prevSeg.overlays.length > 0 && prevSeg.end >= segStart) {
      // Merge: extend previous segment and add this overlay.
      prevSeg.end = Math.max(prevSeg.end, segEnd);
      prevSeg.overlays.push(win);
    } else {
      segments.push({ start: segStart, end: segEnd, overlays: [win] });
    }
    currentPos = segEnd;
  }
  // Trailing clean segment.
  if (currentPos < totalDuration) {
    segments.push({ start: currentPos, end: totalDuration, overlays: [] });
  }

  const overlayCount = segments.filter(s => s.overlays.length > 0).length;
  await logger.log(`Callout segment-split: ${segments.length} segments (${overlayCount} overlay, ${segments.length - overlayCount} clean), total re-encode ~${segments.filter(s => s.overlays.length > 0).reduce((sum, s) => sum + (s.end - s.start), 0).toFixed(0)}s of ${totalDuration.toFixed(0)}s`);

  // Process each segment.
  const segmentFiles: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dur = seg.end - seg.start;
    if (dur <= 0.01) continue;

    const partOutput = path.join(segmentDir, `callout_part_${i}.mp4`);

    if (seg.overlays.length === 0) {
      // Clean segment: stream-copy (instant).
      await runFFmpegSimple(ffmpeg, [
        "-y", "-ss", String(seg.start), "-i", inputVideo,
        "-t", String(dur), "-c", "copy", "-an", partOutput,
      ], 60_000, signal);
      await logger.log(`[DEBUG] Callout segment ${i}: clean copy, ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s (${dur.toFixed(1)}s)`);
    } else {
      // Overlay segment: re-encode with relative timestamps.
      const inputs: string[] = ["-y", "-ss", String(seg.start), "-i", inputVideo];
      const filters: string[] = [];
      let inputIdx = 1; // 0 = main video
      let clipInputIdx = 1;
      let prevLabel = "0:v";

      for (const ov of seg.overlays) {
        // Convert absolute timestamps to relative (shift by -seg.start).
        const relStart = ov.start - seg.start;
        const relEnd = ov.end - seg.start;

        if (ov.type === "number_callout") {
          const pngs = calloutPngMap.get(ov.beatId);
          if (!pngs) continue;
          const flashDuration = 0.15;
          const flash1End = relStart + flashDuration;
          const flash2End = relStart + flashDuration * 2;

          // Dim video during callout.
          const dimLabel = `d${inputIdx}`;
          filters.push(`[${prevLabel}]eq=brightness=-0.3:saturation=0.5:enable='between(t,${relStart},${relEnd})'[${dimLabel}]`);
          prevLabel = dimLabel;
          inputIdx++;

          // 3-number flash: prev2 → prev1 → final.
          if (pngs.prev2) {
            inputs.push("-loop", "1", "-t", String(dur), "-i", pngs.prev2);
            const oLabel = `ov${inputIdx}`;
            filters.push(`[${prevLabel}][${clipInputIdx}:v]overlay=(W-w)/2:(H-h)/2:enable='between(t,${relStart},${flash1End})'[${oLabel}]`);
            prevLabel = oLabel; inputIdx++; clipInputIdx++;
          }
          if (pngs.prev1) {
            inputs.push("-loop", "1", "-t", String(dur), "-i", pngs.prev1);
            const oLabel = `ov${inputIdx}`;
            filters.push(`[${prevLabel}][${clipInputIdx}:v]overlay=(W-w)/2:(H-h)/2:enable='between(t,${flash1End},${flash2End})'[${oLabel}]`);
            prevLabel = oLabel; inputIdx++; clipInputIdx++;
          }
          inputs.push("-loop", "1", "-t", String(dur), "-i", pngs.final);
          const oLabel = `ov${inputIdx}`;
          filters.push(`[${prevLabel}][${clipInputIdx}:v]overlay=(W-w)/2:(H-h)/2:enable='between(t,${flash2End},${relEnd})'[${oLabel}]`);
          prevLabel = oLabel; inputIdx++; clipInputIdx++;

        } else if (ov.type === "item_banner") {
          const pngPath = bannerPngMap.get(ov.beatId);
          if (!pngPath) continue;
          inputs.push("-loop", "1", "-t", String(dur), "-i", pngPath);
          const oLabel = `bn${inputIdx}`;
          filters.push(`[${prevLabel}][${clipInputIdx}:v]overlay=40:H-h-40:enable='between(t,${relStart},${relEnd})'[${oLabel}]`);
          prevLabel = oLabel; inputIdx++; clipInputIdx++;
        }
      }

      const filterComplex = filters.join(";");
      await logger.log(`[DEBUG] Callout segment ${i}: overlay, ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s (${dur.toFixed(1)}s), ${seg.overlays.length} overlay(s), ${filters.length} filter(s)`);

      await runFFmpegSimple(ffmpeg, [
        ...inputs,
        "-filter_complex", filterComplex,
        "-map", `[${prevLabel}]`,
        "-t", String(dur),
        "-c:v", "h264_videotoolbox", "-q:v", "78", "-profile", "high", "-level", "4.1",
        "-b:v", "4M", "-maxrate", "8M", "-bufsize", "12M",
        "-pix_fmt", "yuv420p",
        "-an",
        partOutput,
      ], 300_000, signal);
    }

    segmentFiles.push(partOutput);
  }

  // Phase 3: Concat all segments (stream-copy — instant).
  if (segmentFiles.length === 0) return inputVideo;
  if (segmentFiles.length === 1) {
    fs.copyFileSync(segmentFiles[0], outputVideo);
    return outputVideo;
  }

  const concatList = path.join(segmentDir, "callout_concat_list.txt");
  fs.writeFileSync(
    concatList,
    segmentFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
  );

  await logger.log(`Callout concat: joining ${segmentFiles.length} segments`);
  await runFFmpegSimple(ffmpeg, [
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatList,
    "-c", "copy",
    outputVideo,
  ], 300_000, signal);

  // Cleanup temp files.
  try { fs.unlinkSync(concatList); } catch {}
  for (const f of segmentFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }

  return outputVideo;
}
