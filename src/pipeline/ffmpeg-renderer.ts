import path from "path";
import fs from "fs";
import os from "os";
import { spawn, ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import type {
  ScenePlan,
  AssetMapping,
  Beat,
  ImageAnimation,
  TransitionType,
  RenderSegmentState,
} from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { Logger } from "../utils/logger.js";
import {
  searchAllVideoCandidates,
  searchAllImageCandidates,
  downloadCandidate,
  probeVideo,
} from "../utils/stockApi.js";

const execFileAsync = promisify(execFile);

const XFADE_BATCH = 15;
const MAX_RETRIES = 3;
const CPU_CORES = os.cpus().length;
let threadsPerProcess = 2;

// Stall detection: if FFmpeg produces no new frame for this long, kill it.
// A healthy encode emits frame progress continuously; zero movement = hung.
const STALL_INTERVAL_MS = 200;       // how often to check for progress
const STALL_THRESHOLD_MS = 20_000;   // max time with no new frame before kill

// Replacement budget for stuck-beat recovery.
const REPLACEMENT_MAX_CANDIDATES = 3;
const REPLACEMENT_BUDGET_MS = 30_000;

export function setThreadsForConcurrency(concurrency: number): void {
  threadsPerProcess = Math.max(2, Math.floor(CPU_CORES / concurrency));
}

function getSegmentCodecArgs(config: Config, res?: Resolution): string[] {
  if (config.renderMode !== "bestSource") {
    const r = config.previewResolution ?? 1080;
    const bitrate = r >= 2160 ? "8M" : r >= 1080 ? "4M" : "3M";
    const maxrate = r >= 2160 ? "16M" : r >= 1080 ? "8M" : "5M";
    const bufsize = r >= 2160 ? "24M" : r >= 1080 ? "12M" : "8M";
    const base = ["-c:v", "h264_videotoolbox", "-q:v", "78", "-profile", "high", "-level", "4.1", "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize, "-g", "250"];
    if (res) base.push("-s", `${res.width}x${res.height}`);
    return base;
  }
  return ["-c:v", "libx264", "-crf", "20", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-x264-params", "bframes=0:rc-lookahead=0"];
}

function getFinalCodecArgs(config: Config): string[] {
  if (config.videoCodec === "h265") {
    if (config.renderMode === "hybrid") {
      return ["-c:v", "libx265", "-crf", "22", "-preset", "fast", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"];
    }
    const r = config.previewResolution ?? 1080;
    const bitrate = r >= 2160 ? "12M" : r >= 1080 ? "5M" : "3M";
    const maxrate = r >= 2160 ? "24M" : r >= 1080 ? "10M" : "6M";
    const bufsize = r >= 2160 ? "40M" : r >= 1080 ? "16M" : "10M";
        return ["-c:v", "hevc_videotoolbox", "-q:v", "70", "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize, "-tag:v", "hvc1"];
  }
  return ["-c:v", "libx264", "-crf", "20", "-preset", "fast", "-pix_fmt", "yuv420p"];
}

export interface FFmpegRenderCallbacks {
  onSegmentProgress?: (
    segmentIndex: number,
    totalSegments: number,
    frameProgress: number
  ) => void;
  onSegmentComplete?: (segmentIndex: number) => void;
  onSegmentsInit?: (info: {
    totalSegments: number;
    segmentLength: number;
    segmentDir: string;
    previousElapsedMs?: number;
    sessionTimes?: number[];
  }) => void;
  onPercent?: (percent: number, message: string) => void;
  onPhaseComplete?: (phase: "beats" | "concat" | "overlay" | "mux", segmentDir: string, elapsedMs?: number) => void;
  isCancelled?: () => boolean;
  abortSignal?: AbortSignal;
  previousElapsedMs?: number;
  sessionTimes?: number[];
  parallelSegments?: number;
  onRenderSizes?: (h264Bytes: number, finalBytes: number) => void;
}

interface Resolution {
  width: number;
  height: number;
}

function getResolution(config: Config): Resolution {
  const r = config.previewResolution ?? 1080;
  const portrait = config.aspectRatio === "9:16";
  if (r <= 720) return portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
  if (r <= 1080) return portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  return portrait ? { width: 2160, height: 3840 } : { width: 3840, height: 2160 };
}

function getAnimationFilter(
  animation: ImageAnimation,
  totalFrames: number,
  res: Resolution,
  fps: number,
  durationSec: number
): string {
  const { width, height } = res;
  const d = Math.max(totalFrames, 2);
  const last = d - 1;

  // Ease-out 0→1 for zoom animations (zoompan handles this well)
  // Wrapped in parentheses so operator precedence doesn't break when interpolated
  const linearProgress = `(1-(1-on/${last})*(1-on/${last}))`;

  // Drift only: gentle 0→1→0.85 return
  const driftPingPong = `(if(lt(on,${last}/2),
    3*(2*on/${last})*(2*on/${last}) - 2*(2*on/${last})*(2*on/${last})*(2*on/${last}),
    0.85 + 0.15 * (3*(2-2*on/${last})*(2-2*on/${last}) - 2*(2-2*on/${last})*(2-2*on/${last})*(2-2*on/${last}))
  ))`;

  // Linear progress for crop-based pans (uses n variable, not on)
  const cropProgress = `n/${last}`;

  const zoomRange = 0.12;
  const dramaticRange = 0.20;
  const driftZoomRange = 0.08;

  // --- Pan animations: use crop filter (zoompan freezes after ~23% with constant zoom) ---
  // The prescale buffer is 1.25× output. Crop window = output res. Pan range = prescale - output.
  switch (animation) {
    case "pan_lr":
      return `crop=${width}:${height}:(iw-ow)*${cropProgress}:0`;
    case "pan_rl":
      return `crop=${width}:${height}:(iw-ow)*(1-${cropProgress}):0`;
    case "pan_tb":
      return `crop=${width}:${height}:0:(ih-oh)*(1-${cropProgress})`;
    case "pan_bt":
      return `crop=${width}:${height}:0:(ih-oh)*${cropProgress}`;
  }

  // --- Zoom / drift animations: zoompan works fine (varying z prevents freeze) ---
  switch (animation) {
    case "zoom_in":
    case "zoom_out":
      return `zoompan=z='1+${zoomRange}*${linearProgress}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "drift":
      return `zoompan=z='1.05+${driftZoomRange}*${driftPingPong}':x='(iw-ow/zoom)/2+(iw-ow/zoom)*0.175*${driftPingPong}':y='(ih-oh/zoom)/2+(ih-oh/zoom)*0.14*${driftPingPong}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_in_tl":
    case "zoom_in_tr":
    case "zoom_in_bl":
    case "zoom_in_br":
      return `zoompan=z='1+${zoomRange}*${linearProgress}':x='(iw-ow/zoom)*0.7*${linearProgress}':y='(ih-oh/zoom)*0.7*${linearProgress}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_out_tl":
    case "zoom_out_tr":
    case "zoom_out_bl":
    case "zoom_out_br":
      return `zoompan=z='1+${zoomRange}*${linearProgress}':x='(iw-ow/zoom)*(1-0.7*${linearProgress})':y='(ih-oh/zoom)*(1-0.7*${linearProgress})':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "dramatic_in":
    case "dramatic_out":
      return `zoompan=z='1+${dramaticRange}*${linearProgress}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    default:
      return `zoompan=z='1+0.1*${linearProgress}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
  }
}

const RANDOM_FOCAL_ANIMATIONS: ImageAnimation[] = [
  "zoom_in_tl", "zoom_in_tr", "zoom_in_bl", "zoom_in_br",
];

function resolveAnimation(beat: Beat): ImageAnimation {
  if (beat.imageAnimation && beat.imageAnimation !== "random") {
    return beat.imageAnimation;
  }
  const idx = beat.startTime
    ? Math.floor(beat.startTime * 7) % RANDOM_FOCAL_ANIMATIONS.length
    : Math.floor(Math.random() * RANDOM_FOCAL_ANIMATIONS.length);
  return RANDOM_FOCAL_ANIMATIONS[idx];
}

/**
 * Build the upstream scale+crop filter that pre-downscales the source image to
 * a working buffer (1.5× the output resolution) BEFORE zoompan iterates over it.
 * zoompan is single-threaded and must render all `d` frames before emitting
 * frame 1, so feeding it a 4000×3000 JPEG makes it stall. A 1.5× buffer gives
 * zoom animations headroom (max zoom is 1.8×; 1.5× is enough for the default
 * 1.5× corner zooms) while cutting per-frame work ~2.5×. The final output
 * resolution is still controlled by zoompan's `s` parameter.
 */
function getImagePrescaleFilter(res: Resolution): string {
  const bufW = Math.round(res.width * 1.25);
  const bufH = Math.round(res.height * 1.25);
  return `scale=${bufW}:${bufH}:force_original_aspect_ratio=increase:flags=bilinear,crop=${bufW}:${bufH}`;
}

function getXfadeTransition(type: TransitionType | undefined): string {
  switch (type) {
    case "fade":
    case "crossfade":
      return "fade";
    case "slide_left":
      return "slideleft";
    case "slide_up":
      return "slideup";
    case "mask_wipe":
      return "wipeleft";
    case "whip_pan":
      return "slideright";
    default:
      return "fade";
  }
}

function getTransitionSec(beat: Beat, fps: number): number {
  const td = beat.transitionDuration ?? 0;
  return td > 0 ? td / fps / 2 : 0;
}

function hasTransition(beat: Beat): boolean {
  return !!beat.transitionIn && (beat.transitionDuration ?? 0) > 0;
}

function buildSegmentVf(
  baseFilter: string,
  config: Config
): string {
  const parts = [baseFilter, "format=yuv420p"];
  if (config.enableColorGrade) {
    parts.push("colorbalance=rs=0.01:gs=-0.005:bs=-0.02");
  }
  if (config.enableVignette) {
    parts.push("vignette=angle=0.45");
  }
  parts.push("setsar=1");
  return parts.join(",");
}

async function runFFmpeg(
  ffmpeg: string,
  args: string[],
  logger: Logger,
  timeout = 120_000,
  signal?: AbortSignal,
  stallMs = STALL_THRESHOLD_MS
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const threadedArgs = [...args.slice(0, -1), "-threads", String(threadsPerProcess), args[args.length - 1]];
    const child = spawn(ffmpeg, threadedArgs, { timeout });
    let stderr = "";
    let settled = false;

    // --- Stall detection ---
    // Parse the highest frame= count from accumulated stderr. If no new frame
    // arrives within STALL_THRESHOLD_MS, the encode is hung (corrupt input,
    // -stream_loop deadlock, zoompan stall). Kill it immediately instead of
    // waiting for the blunt 120s spawn timeout.
    let lastFrame = 0;
    let lastProgressAt = Date.now();
    const stallTimer = setInterval(() => {
      if (settled) return;
      const matches = stderr.match(/frame=\s*(\d+)/g);
      const highest = matches ? Math.max(...matches.map((m) => parseInt(m.replace(/\D/g, ""), 10))) : 0;
      if (highest > lastFrame) {
        lastFrame = highest;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > stallMs) {
        clearInterval(stallTimer);
        if (!settled) {
          child.kill("SIGTERM");
          // Include the first ~250 chars of stderr — FFmpeg prints input stream
          // info (codec, resolution, duration) at startup, which reveals WHY the
          // stall happened (e.g. JPEG read as video, truncated file, unknown codec).
          const stderrHead = stderr.slice(0, 250).replace(/[\r\n]+/g, " | ").trim();
          reject(new Error(`FFmpeg stalled (no frame progress for ${stallMs / 1000}s, frame=${lastFrame}) [${stderrHead}]`));
        }
      }
    }, STALL_INTERVAL_MS);

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearInterval(stallTimer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(stderr);
      } else {
        const msg = stderr.slice(-300);
        reject(new Error(`FFmpeg exited with code ${code}: ${msg}`));
      }
    });

    child.on("error", (err) => {
      clearInterval(stallTimer);
      if (settled) return;
      settled = true;
      reject(err);
    });

    if (signal) {
      signal.addEventListener("abort", () => {
        clearInterval(stallTimer);
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new Error("cancelled by user"));
      }, { once: true });
    }
  }).catch(async (err: any) => {
    const msg = err.stderr || err.message || "";
    if (msg && err.message !== "cancelled by user") {
      await logger.warn(`FFmpeg error: ${msg.slice(-300)}`);
    }
    throw err;
  });
}

function parseFfmpegTime(line: string): number | null {
  const m = line.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return parseFloat(m[1]) * 3600 + parseFloat(m[2]) * 60 + parseFloat(m[3]);
}

async function runFFmpegWithProgress(
  ffmpeg: string,
  args: string[],
  logger: Logger,
  timeout: number,
  signal: AbortSignal | undefined,
  totalDurationSeconds: number,
  onProgress: (percent: number) => void
): Promise<string> {
  const progressArgs = [...args.slice(0, -1), "-stats", args[args.length - 1]];
  const threadedArgs = [...progressArgs.slice(0, -1), "-threads", String(threadsPerProcess), progressArgs[progressArgs.length - 1]];
  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, threadedArgs, { timeout });
    let stderr = "";
    let lastProgressTime = 0;

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (totalDurationSeconds > 0) {
        const now = Date.now();
        if (now - lastProgressTime >= 1000) {
          const lines = chunk.split("\r");
          for (const line of lines) {
            const t = parseFfmpegTime(line);
            if (t !== null) {
              const pct = Math.min(99, Math.floor((t / totalDurationSeconds) * 100));
              onProgress(pct);
              lastProgressTime = now;
              break;
            }
          }
        }
      }
    });

    child.on("close", (code) => {
      if (code === 0 || code === 255) {
        resolve(stderr);
      } else {
        const msg = stderr.slice(-300);
        reject(new Error(`FFmpeg exited with code ${code}: ${msg}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });

    if (signal) {
      signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        reject(new Error("cancelled by user"));
      }, { once: true });
    }
  }).catch(async (err: any) => {
    const msg = err.stderr || err.message || "";
    if (msg && err.message !== "cancelled by user") {
      await logger.warn(`FFmpeg error: ${msg.slice(-300)}`);
    }
    throw err;
  });
}

async function renderBeatSegment(
  beat: Beat,
  assetPath: string | undefined,
  config: Config,
  logger: Logger,
  res: Resolution,
  segmentDir: string,
  renderDuration: number,
  signal?: AbortSignal,
  prerenderedPath?: string,
  forceSoftware?: boolean,
  realtimeDecode?: boolean,
): Promise<string> {
  const { width, height } = res;
  const fps = config.fps;
  const segmentPath = path.join(segmentDir, `beat_${beat.id}.mp4`);
  const ffmpeg = config.ffmpegPath;
  const totalFrames = Math.round(renderDuration * fps);
  const codecArgs = forceSoftware
    ? ["-c:v", "libx264", "-crf", "20", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-x264-params", "bframes=0:rc-lookahead=0"]
    : getSegmentCodecArgs(config, res);

  // Resolve the effective type from the asset's file extension, not just
  // beat.type. When an image candidate is picked for a clip beat, the asset is a
  // .jpg but beat.type is still "clip" — routing it through the clip branch
  // stalls because there's no -loop 1 and FFmpeg waits for input that never
  // comes. Detect the actual asset type and override accordingly.
  const imageExts = [".jpg", ".jpeg", ".png", ".webp"];
  const assetIsImage = assetPath && imageExts.some((ext) => assetPath.toLowerCase().endsWith(ext));
  const assetIsVideo = assetPath && assetPath.toLowerCase().endsWith(".mp4");
  // An image-typed beat with a .mp4 asset is a type mismatch — treat it as a
  // clip so it uses the video render path (no -loop 1, which doesn't work on
  // .mp4 files). Only real image extensions (.jpg/.png/.webp) use the image path.
  const type = assetIsImage
    ? "image"
    : assetIsVideo
      ? "clip"
      : beat.type === "subscribe_cta" ? "lower_third" : beat.type;

  if (type === "clip" && assetPath && fs.existsSync(assetPath)) {
    const baseVf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    let sourceDur = 0;
    try { sourceDur = await getVideoDuration(assetPath, config.ffprobePath); } catch {}
    const needLoop = sourceDur > 0 && sourceDur < renderDuration;
    // When looping (-stream_loop -1), ignore_err can cause an infinite
    // seek-back spin on truncated files. Use discardcorrupt instead so bad
    // packets are dropped rather than silently retried forever. For the
    // non-loop path, ignore_err is harmless and tolerates minor glitches.
    const args = ["-y", ...(needLoop ? ["-fflags", "+discardcorrupt"] : ["-err_detect", "ignore_err"])];
    const vf = buildSegmentVf(baseVf, config);
    if (realtimeDecode) args.push("-re");
    if (needLoop) {
      args.push("-stream_loop", "-1", "-t", String(renderDuration), "-i", assetPath, "-vf", vf, ...codecArgs, "-r", String(fps), "-an", segmentPath);
    } else {
      args.push("-i", assetPath, "-t", String(renderDuration), "-vf", vf, ...codecArgs, "-r", String(fps), "-an", segmentPath);
    }
    await runFFmpeg(ffmpeg, args, logger, 120_000, signal);
    return segmentPath;
  }

  if (type === "image" && prerenderedPath && fs.existsSync(prerenderedPath)) {
    let prerenderValid = true;
    try {
      const dur = await getVideoDuration(prerenderedPath, config.ffprobePath);
      if (dur <= 0) prerenderValid = false;
    } catch {
      prerenderValid = false;
    }
    if (prerenderValid) {
      const vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p,setsar=1`;
      const args = ["-y", "-i", prerenderedPath, "-t", String(renderDuration), "-vf", vf, ...codecArgs, "-r", String(fps), "-an", segmentPath];
      await runFFmpeg(ffmpeg, args, logger, 120_000, signal);
      return segmentPath;
    } else {
      await logger.warn(`Beat ${beat.id}: prerender was corrupt, using raw image`);
      try { fs.unlinkSync(prerenderedPath); } catch {}
    }
  }

  if (type === "image" && assetPath && fs.existsSync(assetPath)) {
    const animation = resolveAnimation(beat);
    const zoompan = getAnimationFilter(animation, totalFrames, res, fps, totalFrames / fps);
    const cropVf = getImagePrescaleFilter(res);
    const baseVf = `${cropVf},${zoompan}`;
    const vf = buildSegmentVf(baseVf, config);
    const args = realtimeDecode
      ? ["-y", "-re", "-i", assetPath, "-vf", vf, "-frames:v", String(totalFrames), ...codecArgs, "-r", String(fps), "-an", segmentPath]
      : ["-y", "-loop", "1", "-i", assetPath, "-vf", vf, "-frames:v", String(totalFrames), ...codecArgs, "-r", String(fps), "-an", segmentPath];
    await runFFmpeg(ffmpeg, args, logger, 120_000, signal);
    return segmentPath;
  }

  const baseVf = `color=c=black:s=${width}x${height}:d=${renderDuration}:r=${fps}`;
  const vf = buildSegmentVf(baseVf, config);
  const args = ["-y", "-f", "lavfi", "-i", baseVf, "-vf", vf, ...codecArgs, "-r", String(fps), "-an", "-movflags", "+faststart", segmentPath];
  await runFFmpeg(ffmpeg, args, logger, 120_000, signal);
  return segmentPath;
}

/**
 * Re-search and re-download a replacement asset for a beat whose original
 * source file hung/stalled during FFmpeg rendering. Mirrors the validation
 * recipe in assetSourcer.ts (download → size check → probeVideo for clips).
 * Tries up to REPLACEMENT_MAX_CANDIDATES distinct candidates within
 * REPLACEMENT_BUDGET_MS. Returns the path of the first clean download, or
 * undefined if nothing usable was found.
 */
async function downloadReplacementAsset(
  beat: Beat,
  config: Config,
  logger: Logger,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const isClip = beat.type !== "image";
  const query = beat.searchQuery;
  if (!query) return undefined;

  const dir = isClip ? config.clipsDir : config.imagesDir;
  const ext = isClip ? ".mp4" : ".jpg";
  const finalPath = path.join(dir, `${beat.id}${ext}`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  let candidates: any[];
  try {
    if (isClip) {
      candidates = await searchAllVideoCandidates(query, config.pexelsApiKeys, config.pixabayApiKeys, undefined, config.stockCategory);
    } else {
      candidates = await searchAllImageCandidates(query, config.pexelsApiKeys, config.pixabayApiKeys, undefined, config.stockCategory);
    }
  } catch (err: any) {
    await logger.warn(`Beat ${beat.id}: replacement search failed: ${err?.message ?? err}`);
    return undefined;
  }

  if (candidates.length === 0) {
    await logger.warn(`Beat ${beat.id}: no replacement candidates found for "${query}"`);
    return undefined;
  }

  const deadline = Date.now() + REPLACEMENT_BUDGET_MS;
  let tried = 0;
  for (const candidate of candidates) {
    if (signal?.aborted) return undefined;
    if (tried >= REPLACEMENT_MAX_CANDIDATES) break;
    if (Date.now() > deadline) {
      await logger.warn(`Beat ${beat.id}: replacement budget exhausted after ${tried} candidate(s)`);
      break;
    }
    tried++;
    try {
      const dlDeadline = Math.min(deadline, Date.now() + 15_000);
      const dlTimeout = Math.max(5_000, dlDeadline - Date.now());
      await downloadCandidate(candidate.url, finalPath, undefined, dlTimeout, signal);

      const stat = await fs.promises.stat(finalPath).catch(() => null);
      if (!stat) {
        await fs.promises.unlink(finalPath).catch(() => {});
        continue;
      }
      if (isClip) {
        if (stat.size < 10_000) {
          await fs.promises.unlink(finalPath).catch(() => {});
          await logger.warn(`Beat ${beat.id}: replacement clip too small (${stat.size} bytes), trying next`);
          continue;
        }
        const probe = await probeVideo(finalPath);
        if (probe.duration <= 0 || probe.width === 0 || probe.height === 0) {
          await fs.promises.unlink(finalPath).catch(() => {});
          await logger.warn(`Beat ${beat.id}: replacement clip failed probe (${probe.width}x${probe.height}, ${probe.duration}s), trying next`);
          continue;
        }
      } else {
        if (stat.size < 1_000) {
          await fs.promises.unlink(finalPath).catch(() => {});
          await logger.warn(`Beat ${beat.id}: replacement image too small (${stat.size} bytes), trying next`);
          continue;
        }
      }
      // Clean candidate found.
      return finalPath;
    } catch (err: any) {
      await fs.promises.unlink(finalPath).catch(() => {});
      await logger.warn(`Beat ${beat.id}: replacement candidate ${tried}/${REPLACEMENT_MAX_CANDIDATES} failed: ${err?.message ?? err}`);
    }
  }
  return undefined;
}

async function renderBeatWithRetries(
  beat: Beat,
  assetPath: string | undefined,
  config: Config,
  logger: Logger,
  res: Resolution,
  segmentDir: string,
  renderDuration: number,
  signal?: AbortSignal,
  prerenderedPath?: string,
): Promise<string> {
  let lastErr: Error | null = null;
  // Tracks the asset path used for retries. Attempt 3 may replace this with a
  // freshly re-downloaded candidate; subsequent rendering picks it up because
  // renderBeatSegment gates on fs.existsSync(assetPath).
  let currentAssetPath = assetPath;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("cancelled by user");
    try {
      if (attempt === 1) {
        return await renderBeatSegment(beat, currentAssetPath, config, logger, res, segmentDir, renderDuration, signal, prerenderedPath);
      } else if (attempt === 2) {
        // Software encoder + real-time decode (-re) to break -stream_loop and
        // zoompan deadlocks that hang the normal pipeline at frame 1.
        await logger.log(`Beat ${beat.id}: retrying with software encoder + real-time decode`);
        return await renderBeatSegment(beat, currentAssetPath, config, logger, res, segmentDir, renderDuration, signal, undefined, true, true);
      } else {
        // Attempt 3: re-search and download a replacement candidate. If a clean
        // one is found, render it; otherwise fall through to a black segment so
        // the render always completes instead of aborting.
        await logger.log(`Beat ${beat.id}: re-searching for replacement asset...`);
        const replacement = await downloadReplacementAsset(beat, config, logger, signal);
        if (replacement) {
          currentAssetPath = replacement;
          await logger.log(`Beat ${beat.id}: original asset stalled, replaced with re-downloaded ${replacement}`);
          return await renderBeatSegment(beat, currentAssetPath, config, logger, res, segmentDir, renderDuration, signal, undefined, true, true);
        }
        // No usable replacement — fall back to a black segment (always works).
        await logger.warn(`Beat ${beat.id}: no usable replacement found, using black fallback`);
        return await renderBeatSegment(beat, undefined, config, logger, res, segmentDir, renderDuration, signal, undefined, true);
      }
    } catch (err: any) {
      lastErr = err;
      if (err.message === "cancelled by user") throw err;
      // Surface the beat type and asset path so stalls are diagnosable from the
      // log alone. Flag a TYPE MISMATCH when a clip beat has an image asset (or
      // vice versa) — that's the most common stall cause.
      const imageExts = [".jpg", ".jpeg", ".png", ".webp"];
      const assetIsImage = currentAssetPath && imageExts.some((ext) => currentAssetPath.toLowerCase().endsWith(ext));
      const mismatch = (beat.type === "clip" && assetIsImage) || (beat.type === "image" && !assetIsImage && currentAssetPath);
      const mismatchTag = mismatch ? " [TYPE MISMATCH]" : "";
      await logger.warn(
        `Beat ${beat.id} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message} | type=${beat.type} asset=${currentAssetPath ?? "none"}${mismatchTag}`
      );
    }
  }
  // All attempts exhausted — as a last resort, render a black segment so the
  // overall render never aborts on a single bad beat.
  await logger.warn(`Beat ${beat.id}: all ${MAX_RETRIES} attempts failed, using black fallback`);
  try {
    return await renderBeatSegment(beat, undefined, config, logger, res, segmentDir, renderDuration, signal, undefined, true);
  } catch (err: any) {
    throw new Error(`Beat ${beat.id} failed after ${MAX_RETRIES} attempts: ${lastErr?.message}`);
  }
}

interface BeatGroup {
  startIdx: number;
  count: number;
  hasTransitions: boolean;
}

function groupBeats(beats: Beat[]): BeatGroup[] {
  const groups: BeatGroup[] = [];
  let i = 0;
  while (i < beats.length) {
    if (i === 0 || !hasTransition(beats[i])) {
      groups.push({ startIdx: i, count: 1, hasTransitions: false });
      i++;
      continue;
    }
    const last = groups[groups.length - 1];
    if (last.hasTransitions) {
      last.count++;
    } else {
      if (last.count === 1) {
        last.hasTransitions = true;
        last.count++;
      } else {
        groups.push({ startIdx: i, count: 1, hasTransitions: false });
        i++;
        continue;
      }
    }
    i++;
    while (i < beats.length && hasTransition(beats[i])) {
      last.count++;
      i++;
    }
  }
  return groups;
}

async function xfadeGroup(
  segmentPaths: string[],
  beats: Beat[],
  group: BeatGroup,
  config: Config,
  logger: Logger,
  segmentDir: string,
  batchIdx: number,
  signal?: AbortSignal,
  res?: Resolution
): Promise<string> {
  const fps = config.fps;
  const { startIdx, count } = group;

  if (count === 1) {
    return segmentPaths[startIdx];
  }

  const batchOutput = path.join(segmentDir, `xfade_batch_${batchIdx}.mp4`);

  const subBatchSize = XFADE_BATCH;
  const subBatches = Math.ceil(count / subBatchSize);
  const subBatchPaths: string[] = [];

  for (let sb = 0; sb < subBatches; sb++) {
    const sbStart = startIdx + sb * subBatchSize;
    const sbEnd = Math.min(sbStart + subBatchSize, startIdx + count);
    const sbCount = sbEnd - sbStart;

    if (sbCount === 1) {
      subBatchPaths.push(segmentPaths[sbStart]);
      continue;
    }

    const args = ["-y"];
    for (let j = sbStart; j < sbEnd; j++) {
      args.push("-i", segmentPaths[j]);
    }

    const filterParts: string[] = [];
    let cumulative = beats[sbStart].duration + getTransitionSec(beats[sbStart], fps);

    for (let j = 1; j < sbCount; j++) {
      const beatIdx = sbStart + j;
      const td = getTransitionSec(beats[beatIdx], fps);
      const transName = getXfadeTransition(beats[beatIdx].transitionIn);
      const offset = cumulative - td;

      const inA = j === 1 ? "0:v" : `v${j - 2}`;
      const outLabel = j === sbCount - 1 ? "out" : `v${j - 1}`;

      filterParts.push(
        `[${inA}][${j}:v]xfade=transition=${transName}:duration=${td.toFixed(4)}:offset=${offset.toFixed(4)}[${outLabel}]`
      );

      cumulative += beats[beatIdx].duration + getTransitionSec(beats[beatIdx], fps) - td;
    }

    filterParts.push(`[out]format=yuv420p,setsar=1[out_eff]`);

    args.push("-filter_complex", filterParts.join("; "));
    args.push("-map", "[out_eff]");
    args.push(
      ...getSegmentCodecArgs(config, res), "-r", String(fps), "-an"
    );

    const sbOutput = subBatches === 1
      ? batchOutput
      : path.join(segmentDir, `xfade_sub_${batchIdx}_${sb}.mp4`);
    args.push(sbOutput);

    await logger.log(`xfade sub-batch ${sb}: ${sbCount} beats (group ${batchIdx})`);
    await runFFmpeg(config.ffmpegPath, args, logger, 180_000, signal);
    subBatchPaths.push(sbOutput);
  }

  if (subBatchPaths.length === 1) {
    return subBatchPaths[0];
  }

  const concatList = path.join(segmentDir, `xfade_concat_${batchIdx}.txt`);
  fs.writeFileSync(
    concatList,
    subBatchPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
  );

  await runFFmpeg(
    config.ffmpegPath,
    [
      "-y", "-f", "concat", "-safe", "0",
      "-i", concatList,
      "-c", "copy",
      batchOutput,
    ],
    logger,
    300_000,
    signal
  );

  try {
    fs.unlinkSync(concatList);
    for (let sb = 0; sb < subBatches; sb++) {
      const p = path.join(segmentDir, `xfade_sub_${batchIdx}_${sb}.mp4`);
      if (p !== batchOutput && fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch {}

  return batchOutput;
}

async function applyVfxOverlays(
  inputPath: string,
  overlayBeats: Beat[],
  config: Config,
  logger: Logger,
  res: Resolution,
  segmentDir: string,
  outputPath: string,
  callbacks?: FFmpegRenderCallbacks,
  phasePctStart?: number,
  phasePctEnd?: number,
  expectedDuration?: number
): Promise<void> {
  const { width, height } = res;
  const vfxPath = config.vfxPath;
  if (!vfxPath || !fs.existsSync(vfxPath)) {
    logger.log(`[DEBUG] applyVfxOverlays: no vfxPath or file missing, copying input as-is`);
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const fps = config.fps;
  const vfxDurationSec = 180 / fps;
  const padding = 1;
  const vfxWidth = Math.round(width * config.subscribeOverlaySize / 100);

  logger.log(`[DEBUG] applyVfxOverlays: ${overlayBeats.length} overlay beat(s), vfxDuration=${vfxDurationSec.toFixed(1)}s, vfxWidth=${vfxWidth}px`);

  const parts: { start: number; end: number; overlayStart: number }[] = [];
  let currentPos = 0;

  for (const beat of overlayBeats) {
    const overlayStart = beat.startTime;
    const overlayEnd = overlayStart + vfxDurationSec;

    if (overlayStart > currentPos + padding) {
      parts.push({ start: currentPos, end: overlayStart - padding, overlayStart: -1 });
    }

    parts.push({ start: Math.max(currentPos, overlayStart - padding), end: overlayEnd + padding, overlayStart });
    currentPos = overlayEnd + padding;
  }

  const inputDur = await getVideoDuration(inputPath, config.ffprobePath);
  const totalDur = (inputDur > 0) ? inputDur : (expectedDuration ?? inputDur);
  if (currentPos < totalDur) {
    parts.push({ start: currentPos, end: totalDur, overlayStart: -1 });
  }

  const segmentFiles: string[] = [];
  let completedOverlays = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const dur = part.end - part.start;
    if (dur <= 0) continue;

    const partOutput = path.join(segmentDir, `vfx_part_${i}.mp4`);

    if (part.overlayStart >= 0) {
      completedOverlays++;
      const relStart = part.overlayStart - part.start;
      const relEnd = relStart + vfxDurationSec;
      const fadeIn = 0.3;
      const fadeOut = 0.3;
      const fadeOutStart = vfxDurationSec - fadeOut;

      logger.log(`[DEBUG] applyVfxOverlays segment ${i}: overlay beat, time=${part.start.toFixed(1)}s-${part.end.toFixed(1)}s (dur=${dur.toFixed(1)}s), overlayStart=${part.overlayStart.toFixed(1)}s, relStart=${relStart.toFixed(1)}s`);

      const filterChain = [
        `[1:v]scale=${vfxWidth}:-1,fade=t=in:st=0:d=${fadeIn},fade=t=out:st=${fadeOutStart}:d=${fadeOut}[ov_scaled]`,
        `[0:v][ov_scaled]overlay=(W-w)/2:(H-h)/2:enable='between(t,${relStart},${relEnd})':format=auto[out]`,
      ].join(";");

      const args = [
        "-y",
        "-ss", String(part.start),
        "-i", inputPath,
        "-i", vfxPath,
        "-t", String(dur),
        "-filter_complex", filterChain,
        "-map", "[out]",
        ...getSegmentCodecArgs(config, res), "-r", String(fps),
        "-an",
        partOutput,
      ];
      await runFFmpeg(config.ffmpegPath, args, logger, 300_000, callbacks?.abortSignal);
    } else {
      logger.log(`[DEBUG] applyVfxOverlays segment ${i}: clean pass-through, time=${part.start.toFixed(1)}s-${part.end.toFixed(1)}s (dur=${dur.toFixed(1)}s)`);
      const args = [
        "-y",
        "-ss", String(part.start),
        "-i", inputPath,
        "-t", String(dur),
        "-c", "copy",
        partOutput,
      ];
      await runFFmpeg(config.ffmpegPath, args, logger, 120_000, callbacks?.abortSignal);
    }

    segmentFiles.push(partOutput);

    if (callbacks && phasePctStart !== undefined && phasePctEnd !== undefined) {
      const pct = phasePctStart + Math.round((phasePctEnd - phasePctStart) * ((i + 1) / parts.length));
      callbacks.onPercent?.(pct, `VFX overlay ${Math.min(completedOverlays, overlayBeats.length)}/${overlayBeats.length}`);
    }
  }

  if (segmentFiles.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  if (segmentFiles.length === 1) {
    fs.copyFileSync(segmentFiles[0], outputPath);
    for (const f of segmentFiles) {
      if (f !== outputPath && fs.existsSync(f)) fs.unlinkSync(f);
    }
    return;
  }

  const vfxConcatList = path.join(segmentDir, "vfx_concat_list.txt");
  fs.writeFileSync(
    vfxConcatList,
    segmentFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
  );

  logger.log(`[DEBUG] applyVfxOverlays: concatenating ${segmentFiles.length} segments`);

  await runFFmpeg(
    config.ffmpegPath,
    [
      "-y", "-f", "concat", "-safe", "0",
      "-i", vfxConcatList,
      "-c", "copy",
      outputPath,
    ],
    logger,
    300_000,
    callbacks?.abortSignal
  );

  try {
    fs.unlinkSync(vfxConcatList);
  } catch {}

  try {
    for (const f of segmentFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch {}
}

async function getVideoDuration(videoPath: string, ffprobePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v", "quiet", "-show_entries", "format=duration",
      "-of", "csv=p=0", videoPath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// Mux audio into video. Produces with_audio.mp4 (H.264 + audio).
// Does NOT do HEVC — the caller handles that separately so the two steps
// can be redone independently.
async function muxAudio(
  videoPath: string,
  voPath: string | undefined,
  musicPath: string | undefined,
  overlayBeats: Beat[],
  config: Config,
  logger: Logger,
  segmentDir: string,
  signal?: AbortSignal,
): Promise<string> {
  const hasOverlay = overlayBeats.length > 0 && config.vfxPath && fs.existsSync(config.vfxPath);
  const hasAnyAudio = voPath || musicPath || hasOverlay;

  const tmpH264 = path.join(segmentDir, "with_audio.mp4");

  if (!hasAnyAudio) {
    fs.copyFileSync(videoPath, tmpH264);
    return tmpH264;
  }

  if (voPath && !musicPath && !hasOverlay) {
    await runFFmpeg(
      config.ffmpegPath,
      [
        "-y", "-i", videoPath, "-i", path.resolve(voPath),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        tmpH264,
      ],
      logger,
      300_000,
      signal,
      120_000
    );
    return tmpH264;
  }

  const filterParts: string[] = [];
  const inputArgs = ["-y", "-i", videoPath];
  let inputIdx = 1;

  const voInputIdx = voPath ? inputIdx++ : -1;
  if (voPath) inputArgs.push("-i", path.resolve(voPath));

  const musicInputIdx = musicPath ? inputIdx++ : -1;
  if (musicPath) inputArgs.push("-i", path.resolve(musicPath));

  const overlayInputIndices: number[] = [];
  if (hasOverlay) {
    for (let i = 0; i < overlayBeats.length; i++) {
      overlayInputIndices.push(inputIdx++);
      inputArgs.push("-i", config.vfxPath);
    }
  }

  const mixInputs: string[] = [];

  if (voPath) {
    mixInputs.push(`[${voInputIdx}:a]`);
  }

  if (musicPath) {
    const musicLabel = "music";
    filterParts.push(`[${musicInputIdx}:a]volume=0.3[${musicLabel}]`);
    mixInputs.push(`[${musicLabel}]`);
  }

  if (hasOverlay && overlayInputIndices.length > 0) {
    for (let i = 0; i < overlayInputIndices.length; i++) {
      const delayMs = Math.round(overlayBeats[i].startTime * 1000);
      const label = `ov${i}`;
      if (delayMs > 0) {
        filterParts.push(`[${overlayInputIndices[i]}:a]adelay=${delayMs}|${delayMs}[${label}]`);
      } else {
        filterParts.push(`[${overlayInputIndices[i]}:a]anull[${label}]`);
      }
      mixInputs.push(`[${label}]`);
    }
  }

  if (mixInputs.length > 1) {
    const mixLabel = mixInputs.map((l) => l).join("");
    filterParts.push(
      `${mixLabel}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0:normalize=0[audio_out]`
    );
  } else if (mixInputs.length === 1) {
    filterParts.push(`${mixInputs[0]}acopy[audio_out]`);
  }

  const args = [
    ...inputArgs,
    "-filter_complex", filterParts.join("; "),
    "-map", "0:v",
    "-map", "[audio_out]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    tmpH264,
  ];

  try {
    await runFFmpeg(config.ffmpegPath, args, logger, 300_000, signal, 120_000);
    return tmpH264;
  } catch (muxErr: any) {
    await logger.warn(
      `Audio mux failed: ${muxErr.message}, trying VO only`
    );
    const fallbackTmp = path.join(segmentDir, "mux_fallback_h264.mp4");
    const fallbackArgs = ["-y", "-i", videoPath];
    if (voPath) fallbackArgs.push("-i", path.resolve(voPath));
    fallbackArgs.push("-map", "0:v");
    if (voPath) fallbackArgs.push("-map", "1:a");
    fallbackArgs.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", fallbackTmp);
    await runFFmpeg(config.ffmpegPath, fallbackArgs, logger, 300_000, signal, 120_000);
    fs.renameSync(fallbackTmp, tmpH264);
    return tmpH264;
  }
}

async function runHevcTranscode(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  logger: Logger,
  videoDurationSeconds: number,
  signal?: AbortSignal,
  renderMode?: string,
  onProgress?: (percent: number) => void,
  resolution?: number
): Promise<void> {
  const r = resolution ?? 1080;
  const codecArgs = renderMode === "hybrid"
    ? ["-c:v", "libx265", "-crf", "22", "-preset", "fast", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"]
    : (() => {
        const bitrate = r >= 2160 ? "12M" : r >= 1080 ? "5M" : "3M";
        const maxrate = r >= 2160 ? "24M" : r >= 1080 ? "10M" : "6M";
        const bufsize = r >= 2160 ? "40M" : r >= 1080 ? "16M" : "10M";
    return ["-c:v", "hevc_videotoolbox", "-q:v", "70", "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize, "-tag:v", "hvc1"];
      })();
  const timeout = renderMode === "hybrid"
    ? Math.max(600_000, Math.ceil(videoDurationSeconds * 2000))
    : Math.max(600_000, Math.ceil(videoDurationSeconds * 300));
  const args = [
    "-y", "-i", inputPath,
    ...codecArgs,
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ];
  const run = onProgress
    ? () => runFFmpegWithProgress(ffmpegPath, args, logger, timeout, signal, videoDurationSeconds, onProgress)
    : () => runFFmpeg(ffmpegPath, args, logger, timeout, signal);
  await run().catch(async (err: any) => {
    if (fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      if (stat.size > 1024 * 1024) {
        await logger.log(`HEVC transcode exited with error but output file looks valid (${(stat.size / 1024 / 1024).toFixed(0)} MB), continuing`);
        return;
      }
    }
    throw err;
  });
}

function cleanStaleTempDirs(config: Config, logger: Logger): void {
  const cleanupDays = config.tempCleanupDays ?? 1;
  if (cleanupDays <= 0) return;
  const maxAgeMs = cleanupDays * 24 * 60 * 60 * 1000;
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir);
    const prefixes = ["ffmpeg-render-", "remotion-webpack-bundle-", "react-motion-render"];
    let cleaned = 0;
    for (const entry of entries) {
      if (prefixes.some((p) => entry.startsWith(p))) {
        try {
          const fullPath = path.join(tmpDir, entry);
          const stat = fs.statSync(fullPath);
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs > maxAgeMs) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            cleaned++;
          }
        } catch {}
      }
    }
    if (cleaned > 0) {
      logger.log(`Cleaned ${cleaned} stale temp dir(s)`);
    }
  } catch {}
}

const MANIFEST_FILE = "render_manifest.json";

interface RenderManifest {
  completedBeats: Record<number, string>;
  elapsedMs?: number;
  sessionTimes?: number[];
  prerenderedImages?: Record<number, string>;
}

function loadManifest(segmentDir: string): RenderManifest {
  const p = path.join(segmentDir, MANIFEST_FILE);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch {}
  return { completedBeats: {}, sessionTimes: [] };
}

function saveManifest(segmentDir: string, manifest: RenderManifest): void {
  const p = path.join(segmentDir, MANIFEST_FILE);
  const tmp = p + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(manifest));
    fs.renameSync(tmp, p);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function preRenderImages(
  beats: Beat[],
  assets: AssetMapping,
  config: Config,
  logger: Logger,
  res: Resolution,
  segmentDir: string,
  renderDurations: number[],
  manifest: RenderManifest,
  callbacks?: FFmpegRenderCallbacks,
): Promise<void> {
  if (!manifest.prerenderedImages) manifest.prerenderedImages = {};

  const imageBeats: { idx: number; beat: Beat }[] = [];
  const imageExts = [".jpg", ".jpeg", ".png", ".webp"];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    // Detect image assets by extension too — a clip beat with a .jpg asset
    // renders through the image path (zoompan) and needs prerendering.
    const assetPath = assets[beat.id];
    const assetIsImage = assetPath && imageExts.some((ext) => assetPath.toLowerCase().endsWith(ext));
    const assetIsVideo = assetPath && assetPath.toLowerCase().endsWith(".mp4");
    // An image-typed beat with a .mp4 asset is a type mismatch — treat it as a
    // clip so it skips the image prerender (-loop 1 doesn't work on .mp4 files).
    const type = assetIsImage
      ? "image"
      : assetIsVideo
        ? "clip"
        : beat.type === "subscribe_cta" ? "lower_third" : beat.type;
    if (type === "image") {
      if (assetPath && fs.existsSync(assetPath)) {
        const prerenderPath = path.join(segmentDir, `beat_${beat.id}_prerender.mp4`);
        const projectPrerenderPath = path.join(path.dirname(assetPath), `${beat.id}_prerender.mp4`);

        // Reuse existing pre-render from MP4 button if valid — skip FFmpeg conversion
        if (fs.existsSync(projectPrerenderPath) && fs.statSync(projectPrerenderPath).size > 1000) {
          try {
            if (!fs.existsSync(prerenderPath)) {
              fs.copyFileSync(projectPrerenderPath, prerenderPath);
            }
            manifest.prerenderedImages[i] = prerenderPath;
            await logger.log(`[DEBUG] Phase 0: reused pre-render for ${beat.id} from ${projectPrerenderPath}`);
          } catch (err: any) {
            await logger.warn(`[DEBUG] Phase 0: failed to copy pre-render for ${beat.id}: ${err.message}, will re-render`);
            try { fs.unlinkSync(prerenderPath); } catch {}
            imageBeats.push({ idx: i, beat });
          }
        } else {
          // No valid pre-render — convert now
          try { fs.unlinkSync(prerenderPath); } catch {}
          imageBeats.push({ idx: i, beat });
        }
      }
    }
  }

  const skippedCount = manifest.prerenderedImages ? Object.keys(manifest.prerenderedImages).length : 0;
  if (skippedCount > 0) {
    await logger.log(`Phase 0: ${skippedCount} image(s) reused from pre-render cache`);
  }

  if (imageBeats.length === 0) return;

  const { width, height } = res;
  const fps = config.fps;
  const concurrency = Math.min(config.renderConcurrency ?? 3, 12);

  await logger.log(`Pre-rendering ${imageBeats.length} images (${concurrency} parallel)`);

  for (let i = 0; i < imageBeats.length; i += concurrency) {
    const batch = imageBeats.slice(i, Math.min(i + concurrency, imageBeats.length));
    const promises = batch.map(async ({ idx, beat }) => {
      const assetPath = assets[beat.id]!;
      const animation = resolveAnimation(beat);
      const totalFrames = Math.round(renderDurations[idx] * fps);
      const zoompan = getAnimationFilter(animation, totalFrames, res, fps, totalFrames / fps);
      const cropVf = getImagePrescaleFilter(res);
      const baseVf = `${cropVf},${zoompan}`;
      const vf = buildSegmentVf(baseVf, config);
      const prerenderPath = path.join(segmentDir, `beat_${beat.id}_prerender.mp4`);
      const args = [
        "-y",
        "-loop", "1",
        "-i", assetPath,
        "-vf", vf,
        "-frames:v", String(totalFrames),
        ...getSegmentCodecArgs(config, res),
        "-r", String(fps),
        "-an",
        prerenderPath,
      ];
      await runFFmpeg(config.ffmpegPath, args, logger, 120_000, callbacks?.abortSignal);
      manifest.prerenderedImages[idx] = prerenderPath;
    });

    await Promise.allSettled(promises);
    saveManifest(segmentDir, manifest);

    const totalImages = beats.filter((b) => {
      const t = b.type === "subscribe_cta" ? "lower_third" : b.type;
      return t === "image" && assets[b.id] && fs.existsSync(assets[b.id]);
    }).length;
    const preRendered = Object.keys(manifest.prerenderedImages).length;
    callbacks?.onPercent?.(
      Math.round(10 * (preRendered / totalImages)),
      `Pre-rendering images... ${preRendered}/${totalImages}`
    );

    if (callbacks?.isCancelled?.()) throw new Error("cancelled by user");
  }

  await logger.log(`Pre-rendered ${imageBeats.length} images`);
}

export async function prerenderImageToMp4(
  imagePath: string,
  outputPath: string,
  beatMeta: { duration: number; imageAnimation?: string; startTime?: number },
  config: Config,
): Promise<void> {
  const res = getResolution(config);
  const { width, height } = res;
  const fps = config.fps;
  const totalFrames = Math.round(beatMeta.duration * fps);
  const animation = resolveAnimationFromMeta(beatMeta);
  const zoompan = getAnimationFilter(animation, totalFrames, res, fps, totalFrames / fps);
  const cropVf = getImagePrescaleFilter(res);
  const baseVf = `${cropVf},${zoompan}`;
  const vf = buildSegmentVf(baseVf, config);
  const args = [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-vf", vf,
    "-frames:v", String(totalFrames),
    ...getSegmentCodecArgs(config, res),
    "-r", String(fps),
    "-an",
    outputPath,
  ];
  await runFFmpeg(config.ffmpegPath, args, { log: async () => {}, warn: async () => {}, init: async () => {}, close: async () => {} } as any, 120_000);
}

function resolveAnimationFromMeta(meta: { imageAnimation?: string; startTime?: number }): ImageAnimation {
  if (meta.imageAnimation && meta.imageAnimation !== "random") {
    return meta.imageAnimation as ImageAnimation;
  }
  const idx = meta.startTime
    ? Math.floor(meta.startTime * 7) % RANDOM_FOCAL_ANIMATIONS.length
    : Math.floor(Math.random() * RANDOM_FOCAL_ANIMATIONS.length);
  return RANDOM_FOCAL_ANIMATIONS[idx];
}

export async function renderVideoSegmentsFFmpeg(
  scenePlan: ScenePlan,
  assets: AssetMapping,
  config: Config,
  logger: Logger,
  voPath?: string,
  musicPath?: string,
  existingState?: RenderSegmentState | null,
  callbacks?: FFmpegRenderCallbacks
): Promise<{ outputPath: string; segmentState: RenderSegmentState }> {
  const title = (config.projectName || scenePlan.title || "output").replace(/\s+/g, "_");
  const outputPath = path.join(config.outputDir, `${title}.mp4`);
  const res = getResolution(config);
  const fps = config.fps;
  const { width, height } = res;

  cleanStaleTempDirs(config, logger);
  setThreadsForConcurrency(config.renderConcurrency ?? 3);

  const segmentDir =
    existingState?.segmentDir ??
    path.join(config.outputDir, "temp", "render-segments");
  fs.mkdirSync(segmentDir, { recursive: true });

  let wasCancelled = false;
  const renderStart = Date.now();

  try {
  const beats = scenePlan.beats;
  const totalBeats = beats.length;

  const overlayBeats = beats.filter(
    (b) => b.overlay?.type === "subscribe_cta"
  );

  callbacks?.onSegmentsInit?.({
    totalSegments: totalBeats,
    segmentLength: 0,
    segmentDir,
  });

  const phaseTime = (label: string) => {
    const elapsed = ((Date.now() - renderStart) / 1000).toFixed(1);
    return `${label} [${elapsed}s elapsed]`;
  };

  await logger.log(
    phaseTime(`FFmpeg renderer: ${totalBeats} beats, ${width}x${height} @ ${fps}fps`)
  );
  await logger.log(
    `${beats.filter((b) => b.type === "clip").length} clips, ${beats.filter((b) => b.type === "image").length} images, ${overlayBeats.length} VFX overlays`
  );

  const groups = groupBeats(beats);
  const beatInTransitionGroup = new Set<number>();
  for (const g of groups) {
    if (g.hasTransitions) {
      for (let j = g.startIdx; j < g.startIdx + g.count; j++) {
        beatInTransitionGroup.add(j);
      }
    }
  }

  const segmentPaths: (string | null)[] = new Array(totalBeats).fill(null);
  const renderDurations: number[] = new Array(totalBeats);

  for (let i = 0; i < totalBeats; i++) {
    const beat = beats[i];
    if (beatInTransitionGroup.has(i)) {
      let ext = beat.duration;
      if (i > 0 && hasTransition(beat)) {
        ext += getTransitionSec(beat, fps);
      }
      if (i < totalBeats - 1 && hasTransition(beats[i + 1])) {
        ext += getTransitionSec(beats[i + 1], fps);
      }
      renderDurations[i] = ext;
    } else {
      renderDurations[i] = beat.duration;
    }
  }

  const PHASE0_END = 10;
  const PHASE1_END = 70;
  const PHASE2_END = 85;
  const PHASE3_END = 95;
  const PHASE5_END = 100;

  const priorPhase = existingState?.renderPhase;
  const concatVideo = path.join(segmentDir, "concat_raw.mp4");
  const vfxVideo = path.join(segmentDir, "with_vfx.mp4");
  const canSkipBeats = priorPhase === "concat" || priorPhase === "overlay" || priorPhase === "mux";
  const canSkipConcat = priorPhase === "overlay" || priorPhase === "mux";
  const canSkipOverlay = priorPhase === "mux";

  const manifest = loadManifest(segmentDir);
  const previousElapsedMs = manifest.elapsedMs ?? callbacks?.previousElapsedMs ?? 0;
  const sessionTimes = manifest.sessionTimes ?? callbacks?.sessionTimes ?? [];

  const completedBeats = new Set<number>(
    Object.keys(manifest.completedBeats).map(Number)
  );
  let lastProgressTime = 0;

  callbacks?.onSegmentsInit?.({
    totalSegments: totalBeats,
    segmentLength: 0,
    segmentDir,
    previousElapsedMs: previousElapsedMs > 0 ? previousElapsedMs : undefined,
    sessionTimes: sessionTimes.length > 0 ? sessionTimes : undefined,
  });

  if (canSkipBeats && fs.existsSync(concatVideo)) {
    await logger.log(phaseTime("Skipping Phase 0-2: concat_raw.mp4 exists from previous render"));
    callbacks?.onPercent?.(PHASE2_END, "Resuming from concat...");
  } else {
    const canSkipPhase0 = canSkipBeats;
    if (!canSkipPhase0) {
      await logger.log(phaseTime("Phase 0: Pre-rendering images..."));
      callbacks?.onPercent?.(0, "Pre-rendering images...");
      try {
        await preRenderImages(
          beats, assets, config, logger, res, segmentDir,
          renderDurations, manifest, callbacks
        );
      } catch (err: any) {
        if (err.message === "cancelled by user") { wasCancelled = true; throw err; }
        await logger.warn(`Image pre-render had errors: ${err.message}`);
      }
      callbacks?.onPercent?.(PHASE0_END, "Pre-rendering complete");
    }

    await logger.log(phaseTime("Phase 1: Rendering beat segments..."));
    if (completedBeats.size > 0) {
      const initialPct = PHASE0_END + Math.round((PHASE1_END - PHASE0_END) * (completedBeats.size / totalBeats));
      callbacks?.onPercent?.(initialPct, `Rendering segment ${completedBeats.size}/${totalBeats}`);
    } else {
      callbacks?.onPercent?.(PHASE0_END, "Rendering beat segments...");
    }

    const concurrency = Math.min(config.renderConcurrency ?? 3, 12);
    const renderErrors: Record<number, string> = {};

    for (let i = 0; i < totalBeats; i += concurrency) {
      const batchEnd = Math.min(i + concurrency, totalBeats);
      const promises: Promise<void>[] = [];

      for (let j = i; j < batchEnd; j++) {
        const idx = j;

        if (manifest.completedBeats[idx] && fs.existsSync(manifest.completedBeats[idx])) {
          segmentPaths[idx] = manifest.completedBeats[idx];
          completedBeats.add(idx);
          continue;
        }

        promises.push(
          (async () => {
            const prerendered = manifest.prerenderedImages?.[idx];
            try {
              const segPath = await renderBeatWithRetries(
                beats[idx],
                assets[beats[idx].id],
                config,
                logger,
                res,
                segmentDir,
                renderDurations[idx],
                callbacks?.abortSignal,
                prerendered
              );
              segmentPaths[idx] = segPath;
              completedBeats.add(idx);
              manifest.completedBeats[idx] = segPath;
            } catch (err: any) {
              renderErrors[idx] = err.message;
            }
          })()
        );
      }

      await Promise.allSettled(promises);

      if (promises.length > 0) {
        manifest.elapsedMs = Date.now() - renderStart;
        saveManifest(segmentDir, manifest);
        for (let j = i; j < batchEnd; j++) {
          if (completedBeats.has(j)) {
            callbacks?.onSegmentComplete?.(j);
          }
        }
      }

      const now = Date.now();
      if (now - lastProgressTime > 500 || batchEnd === totalBeats) {
        const done = completedBeats.size;
        const pct = PHASE0_END + Math.round((PHASE1_END - PHASE0_END) * (done / totalBeats));
        callbacks?.onPercent?.(pct, `Rendering segment ${done}/${totalBeats}`);
        callbacks?.onSegmentProgress?.(done - 1, totalBeats, done / totalBeats);
        lastProgressTime = now;
        await logger.log(`Beat segments: ${done}/${totalBeats} (${Math.round(done / totalBeats * 100)}%) [${((Date.now() - renderStart) / 1000).toFixed(1)}s]`);
      }

      if (callbacks?.isCancelled?.()) {
        await logger.log(phaseTime("Render cancelled by user during beat rendering"));
        wasCancelled = true;
        throw new Error("cancelled by user");
      }
    }

    await logger.log(
      phaseTime(`All ${totalBeats} beat segments rendered (${completedBeats.size} succeeded)`)
    );

    const validSegments = segmentPaths.filter((p) => p !== null) as string[];
    if (validSegments.length === 0) {
      throw new Error("No beat segments were rendered successfully");
    }

    const missingIdx = segmentPaths
      .map((p, i) => (p === null ? i : -1))
      .filter((i) => i >= 0);
    if (missingIdx.length > 0) {
      const errorDetails = missingIdx.slice(0, 5).map(idx =>
        `beat ${beats[idx].id} (${renderErrors[idx] ?? "unknown error"})`
      ).join(", ");
      const more = missingIdx.length > 5 ? ` and ${missingIdx.length - 5} more` : "";
      throw new Error(
        `${missingIdx.length} beat(s) failed: ${errorDetails}${more}`
      );
    }

    callbacks?.onPhaseComplete?.("beats", segmentDir);

    if (callbacks?.isCancelled?.()) {
      await logger.log(phaseTime("Render cancelled before concat"));
      wasCancelled = true;
      throw new Error("cancelled by user");
    }

    callbacks?.onPercent?.(PHASE1_END, "Concatenating segments...");
    await logger.log(phaseTime("Phase 2: Concatenating segments..."));
    const transitionGroups = groups.filter((g) => g.hasTransitions).length;
    const hardCutGroups = groups.filter((g) => !g.hasTransitions).length;
    await logger.log(
      `${groups.length} beat groups (${transitionGroups} with transitions, ${hardCutGroups} hard cuts)`
    );

    const groupOutputs: string[] = [];
    const groupsWithTransitions = groups.filter((g) => g.hasTransitions && g.count > 1);
    let processedTransitionGroups = 0;
    const XFADE_PARALLEL = 3;

    const xfadeResults: Map<number, string> = new Map();
    const xfadeIndices = groups
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.hasTransitions && g.count > 1);

    for (let bi = 0; bi < xfadeIndices.length; bi += XFADE_PARALLEL) {
      const batch = xfadeIndices.slice(bi, bi + XFADE_PARALLEL);
      const results = await Promise.allSettled(
        batch.map(({ g, i: gi }) =>
          xfadeGroup(
            segmentPaths as string[],
            beats,
            g,
            config,
            logger,
            segmentDir,
            gi,
            callbacks?.abortSignal,
            res
          ).then((result) => ({ gi, result }))
        )
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          xfadeResults.set(r.value.gi, r.value.result);
        } else {
          const gi = batch[results.indexOf(r)].i;
          await logger.warn(`Group ${gi} xfade failed (${r.reason?.message}), falling back to hard cuts`);
        }
      }
      processedTransitionGroups += batch.length;
      if (groupsWithTransitions.length > 0) {
        const phasePct = PHASE1_END + Math.round((PHASE2_END - PHASE1_END) * (processedTransitionGroups / groupsWithTransitions.length));
        callbacks?.onPercent?.(phasePct, `Applying transitions ${processedTransitionGroups}/${groupsWithTransitions.length}`);
      }
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      if (xfadeResults.has(gi)) {
        groupOutputs.push(xfadeResults.get(gi)!);
      } else {
        for (let j = group.startIdx; j < group.startIdx + group.count; j++) {
          groupOutputs.push(segmentPaths[j]!);
        }
      }
    }

    if (groupOutputs.length === 1) {
      fs.copyFileSync(groupOutputs[0], concatVideo);
    } else {
      await logger.log(`Concatenating ${groupOutputs.length} segments...`);
      const concatList = path.join(segmentDir, "concat_list.txt");
      fs.writeFileSync(
        concatList,
        groupOutputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
      );
      await runFFmpeg(
        config.ffmpegPath,
        [
          "-y", "-f", "concat", "-safe", "0",
          "-i", concatList,
          "-c", "copy",
          concatVideo,
        ],
        logger,
        600_000,
        callbacks?.abortSignal
      );
      try { fs.unlinkSync(concatList); } catch {}
    }

    callbacks?.onPercent?.(PHASE2_END, "Concatenation complete");
    callbacks?.onPhaseComplete?.("concat", segmentDir);
  }

  let currentVideo = concatVideo;

  const plannedDur = scenePlan.totalDurationSeconds;
  const concatDur = await getVideoDuration(concatVideo, config.ffprobePath);
  if (concatDur > plannedDur + 0.5) {
    await logger.log(
      phaseTime(`Trimming concat from ${concatDur.toFixed(2)}s to ${plannedDur.toFixed(2)}s`)
    );
    const trimmedVideo = path.join(segmentDir, "trimmed.mp4");
    await runFFmpeg(
      config.ffmpegPath,
      ["-y", "-i", concatVideo, "-t", String(plannedDur), "-c", "copy", trimmedVideo],
      logger,
      300_000,
      callbacks?.abortSignal
    );
    currentVideo = trimmedVideo;
  }

  if (callbacks?.isCancelled?.()) {
    await logger.log(phaseTime("Render cancelled before overlay"));
    wasCancelled = true;
    throw new Error("cancelled by user");
  }

  if (overlayBeats.length > 0 && config.vfxPath) {
    if (canSkipOverlay && fs.existsSync(vfxVideo)) {
      await logger.log(phaseTime("Skipping Phase 3: with_vfx.mp4 exists from previous render"));
      currentVideo = vfxVideo;
    } else {
      await logger.log(phaseTime(`Phase 3: Applying ${overlayBeats.length} VFX overlay(s)...`));
      try {
        await applyVfxOverlays(
          currentVideo,
          overlayBeats,
          config,
          logger,
          res,
          segmentDir,
          vfxVideo,
          callbacks,
          PHASE2_END,
          PHASE3_END,
          scenePlan.totalDurationSeconds
        );
        currentVideo = vfxVideo;
        await logger.log(phaseTime("VFX overlays applied"));
        callbacks?.onPhaseComplete?.("overlay", segmentDir);
      } catch (err: any) {
        await logger.warn(
          `VFX overlay failed: ${err.message}, continuing without overlays`
        );
      }
    }
  }

  // --- Callout/Banner overlay pass ---
  const calloutBeats = beats.filter(
    (b) => b.overlay?.type === "number_callout" || b.overlay?.type === "item_banner"
  );
  if (calloutBeats.length > 0) {
    if (canSkipOverlay && fs.existsSync(path.join(segmentDir, "with_callouts.mp4"))) {
      await logger.log(phaseTime("Skipping callout phase: with_callouts.mp4 exists"));
      currentVideo = path.join(segmentDir, "with_callouts.mp4");
    } else {
      await logger.log(phaseTime(`Phase 3b: Applying ${calloutBeats.length} callout/banner overlay(s)...`));
      const overlayStart = Date.now();
      try {
        const { generateCalloutOverlays } = await import("./calloutRenderer.js");
        const calloutVideo = await generateCalloutOverlays(
          currentVideo,
          calloutBeats,
          config,
          logger,
          res,
          segmentDir,
          callbacks?.abortSignal,
          plannedDur
        );
        currentVideo = calloutVideo;
        const overlayDuration = ((Date.now() - overlayStart) / 1000).toFixed(1);
        await logger.log(phaseTime(`Callout/banner overlays applied (${overlayDuration}s for ${calloutBeats.length} overlay(s))`));
      } catch (err: any) {
        await logger.warn(`Callout overlay failed: ${err.message}, continuing without callouts`);
      }
    }
  }

  if (callbacks?.isCancelled?.()) {
    await logger.log(phaseTime("Render cancelled before mux"));
    wasCancelled = true;
    throw new Error("cancelled by user");
  }

  await logger.log(phaseTime("Phase 5: Muxing audio..."));
  callbacks?.onPercent?.(PHASE3_END, "Muxing audio...");
  const muxStart = Date.now();
  const audioPath = await muxAudio(
    currentVideo,
    voPath,
    musicPath,
    overlayBeats,
    config,
    logger,
    segmentDir,
    callbacks?.abortSignal
  );
  const muxDuration = ((Date.now() - muxStart) / 1000).toFixed(1);
  await logger.log(phaseTime(`Audio muxing complete (${muxDuration}s)`));
  callbacks?.onPhaseComplete?.("mux", segmentDir);

  // Phase 6: HEVC encode (separate from mux so each can be redone independently)
  const useHevc = config.videoCodec === "h265";
  const hevcLabel = config.renderMode === "hybrid" ? "Transcoding HEVC (libx265)..." : "Transcoding HEVC (VideoToolbox)...";
  if (useHevc) {
    await logger.log(phaseTime("Phase 6: HEVC encode..."));
    callbacks?.onPercent?.(95, hevcLabel);
    const hevcStart = Date.now();
    await runHevcTranscode(config.ffmpegPath, audioPath, outputPath, logger, plannedDur, callbacks?.abortSignal, config.renderMode, (pct: number) => {
      callbacks?.onPercent?.(95 + Math.round(pct * 0.05), `${hevcLabel} ${pct}%`);
    }, config.previewResolution ?? 1080);
    const hevcDuration = ((Date.now() - hevcStart) / 1000).toFixed(1);
    await logger.log(phaseTime(`HEVC encode complete (${hevcDuration}s)`));
    try { fs.unlinkSync(audioPath); } catch {}
  } else {
    fs.renameSync(audioPath, outputPath);
  }

  try {
    const h264Stat = fs.statSync(currentVideo);
    const finalStat = fs.statSync(outputPath);
    callbacks?.onRenderSizes?.(h264Stat.size, finalStat.size);
  } catch {}

  const totalElapsedMs = Date.now() - renderStart;

  callbacks?.onPhaseComplete?.("hevc", segmentDir, totalElapsedMs);

  callbacks?.onPercent?.(PHASE5_END, "Render complete");
  await logger.log(phaseTime(`FFmpeg render complete: ${outputPath}`));

  return {
    outputPath,
    segmentState: {
      segmentLength: 0,
      completedSegments: Array.from(completedBeats),
      totalSegments: totalBeats,
      segmentDir,
      elapsedMs: totalElapsedMs,
    },
  };
  } finally {
    try {
      const manifestPath = path.join(segmentDir, MANIFEST_FILE);
      if (fs.existsSync(manifestPath)) {
        const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const elapsed = Date.now() - renderStart;
        m.elapsedMs = elapsed;
        if (!m.sessionTimes) m.sessionTimes = [];
        if (wasCancelled) {
          m.sessionTimes.push(elapsed);
        }
        fs.writeFileSync(manifestPath, JSON.stringify(m));
      }
    } catch {}
    if (!wasCancelled) {
      try {
        const manifestPath = path.join(segmentDir, MANIFEST_FILE);
        if (fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
        }
      } catch {}
    }
  }
}
