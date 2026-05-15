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

const execFileAsync = promisify(execFile);

const XFADE_BATCH = 15;
const MAX_RETRIES = 3;

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
}

interface Resolution {
  width: number;
  height: number;
}

function getResolution(config: Config): Resolution {
  const r = config.previewResolution ?? 1080;
  if (r <= 720) return { width: 1280, height: 720 };
  if (r <= 1080) return { width: 1920, height: 1080 };
  return { width: 3840, height: 2160 };
}

function getZoompanFilter(
  animation: ImageAnimation,
  totalFrames: number,
  res: Resolution,
  fps: number
): string {
  const { width, height } = res;
  const d = Math.max(totalFrames, 2);
  const last = d - 1;

  switch (animation) {
    case "zoom_in":
      return `zoompan=z='1+0.3*on/${last}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_out":
      return `zoompan=z='1.3-0.3*on/${last}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "pan_lr":
      return `zoompan=z='1.15':x='(iw-ow/zoom)*on/${last}':y='(ih-oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "pan_rl":
      return `zoompan=z='1.15':x='(iw-ow/zoom)*(1.0-on/${last})':y='(ih-oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "pan_tb":
      return `zoompan=z='1.15':x='(iw-ow/zoom)/2':y='(ih-oh/zoom)*on/${last}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "pan_bt":
      return `zoompan=z='1.15':x='(iw-ow/zoom)/2':y='(ih-oh/zoom)*(1.0-on/${last})':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "drift":
      return `zoompan=z='1.1+0.15*on/${last}':x='(iw-ow/zoom)/2+(iw-ow/zoom)*0.25*on/${last}':y='(ih-oh/zoom)/2+(ih-oh/zoom)*0.2*on/${last}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_in_tl":
      return `zoompan=z='1+0.5*on/${last}':x='(iw-ow/zoom)*on/${last}':y='(ih-oh/zoom)*on/${last}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_in_tr":
      return `zoompan=z='1+0.5*on/${last}':x='(iw-ow/zoom)*(1.0-on/${last})':y='(ih-oh/zoom)*on/${last}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_in_bl":
      return `zoompan=z='1+0.5*on/${last}':x='(iw-ow/zoom)*on/${last}':y='(ih-oh/zoom)*(1.0-on/${last})':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_in_br":
      return `zoompan=z='1+0.5*on/${last}':x='(iw-ow/zoom)*(1.0-on/${last})':y='(ih-oh/zoom)*(1.0-on/${last})':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_out_tl":
      return `zoompan=z='1.5-0.5*on/${last}':x='(iw-ow/zoom)*on/${last}':y='(ih-oh/zoom)*on/${last}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_out_tr":
      return `zoompan=z='1.5-0.5*on/${last}':x='(iw-ow/zoom)*(1.0-on/${last})':y='(ih-oh/zoom)*on/${last}':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_out_bl":
      return `zoompan=z='1.5-0.5*on/${last}':x='(iw-ow/zoom)*on/${last}':y='(ih-oh/zoom)*(1.0-on/${last})':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "zoom_out_br":
      return `zoompan=z='1.5-0.5*on/${last}':x='(iw-ow/zoom)*(1.0-on/${last})':y='(ih-oh/zoom)*(1.0-on/${last})':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "dramatic_in":
      return `zoompan=z='1+0.8*on/${last}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    case "dramatic_out":
      return `zoompan=z='1.8-0.8*on/${last}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
    default:
      return `zoompan=z='1+0.2*on/${last}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
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
  signal?: AbortSignal
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { timeout });
    let stderr = "";

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
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
  signal?: AbortSignal
): Promise<string> {
  const { width, height } = res;
  const fps = config.fps;
  const segmentPath = path.join(segmentDir, `beat_${beat.id}.mp4`);
  const ffmpeg = config.ffmpegPath;
  const totalFrames = Math.round(renderDuration * fps);

  const type = beat.type === "subscribe_cta" ? "lower_third" : beat.type;

  if (type === "clip" && assetPath && fs.existsSync(assetPath)) {
    const baseVf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const sourceDur = await getVideoDuration(assetPath, ffmpeg);
    const needLoop = sourceDur < renderDuration;
    const args = ["-y"];
    if (needLoop) {
      const vf = buildSegmentVf(baseVf, config);
      args.push(
        "-stream_loop", "-1",
        "-t", String(renderDuration),
        "-i", assetPath,
        "-vf", vf,
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-r", String(fps),
        "-an",
        segmentPath,
      );
    } else {
      const vf = buildSegmentVf(baseVf, config);
      args.push(
        "-i", assetPath,
        "-t", String(renderDuration),
        "-vf", vf,
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-r", String(fps),
        "-an",
        segmentPath,
      );
    }
    await runFFmpeg(ffmpeg, args, logger, 120_000, signal);
    return segmentPath;
  }

  if (type === "image" && assetPath && fs.existsSync(assetPath)) {
    const animation = resolveAnimation(beat);
    const zoompan = getZoompanFilter(animation, totalFrames, res, fps);
    const cropVf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const baseVf = `${cropVf},${zoompan}`;
    const vf = buildSegmentVf(baseVf, config);
    const args = [
      "-y",
      "-loop", "1",
      "-i", assetPath,
      "-vf", vf,
      "-t", String(renderDuration),
      "-c:v", "libx264",
      "-crf", "23",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      "-an",
      segmentPath,
    ];
    await runFFmpeg(ffmpeg, args, logger, 120_000, signal);
    return segmentPath;
  }

  const baseVf = `color=c=black:s=${width}x${height}:d=${renderDuration}:r=${fps}`;
  const vf = buildSegmentVf(baseVf, config);
  const args = [
    "-y",
    "-f", "lavfi",
    "-i", baseVf,
    "-vf", vf,
    "-c:v", "libx264",
    "-crf", "23",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-an",
    "-movflags", "+faststart",
    segmentPath,
  ];
  await runFFmpeg(ffmpeg, args, logger, 120_000, signal);
  return segmentPath;
}

async function renderBeatWithRetries(
  beat: Beat,
  assetPath: string | undefined,
  config: Config,
  logger: Logger,
  res: Resolution,
  segmentDir: string,
  renderDuration: number,
  signal?: AbortSignal
): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("cancelled by user");
    try {
      return await renderBeatSegment(
        beat, assetPath, config, logger, res, segmentDir, renderDuration, signal
      );
    } catch (err: any) {
      lastErr = err;
      if (err.message === "cancelled by user") throw err;
      await logger.warn(
        `Beat ${beat.id} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`
      );
    }
  }
  throw new Error(
    `Beat ${beat.id} failed after ${MAX_RETRIES} attempts: ${lastErr?.message}`
  );
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
  signal?: AbortSignal
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

    const xfadeEffects: string[] = [];
    if (config.enableColorGrade) {
      xfadeEffects.push("colorbalance=rs=0.01:gs=-0.005:bs=-0.02");
    }
    if (config.enableVignette) {
      xfadeEffects.push("vignette=angle=0.45");
    }
    xfadeEffects.push("setsar=1");
    filterParts.push(`[out]${xfadeEffects.join(",")}[out_eff]`);

    args.push("-filter_complex", filterParts.join("; "));
    args.push("-map", "[out_eff]");
    args.push(
      "-c:v", "libx264", "-crf", "23", "-preset", "ultrafast",
      "-pix_fmt", "yuv420p", "-r", String(fps), "-an"
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
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const fps = config.fps;
  const vfxDurationSec = 180 / fps;
  const padding = 1;
  const vfxWidth = Math.round(width * config.subscribeOverlaySize / 100);

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

  const inputDur = await getVideoDuration(inputPath, config.ffmpegPath);
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
        "-c:v", "libx264", "-crf", "23", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", "-r", String(fps),
        "-an",
        partOutput,
      ];
      await runFFmpeg(config.ffmpegPath, args, logger, 300_000, callbacks?.abortSignal);
    } else {
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

async function getVideoDuration(videoPath: string, ffmpeg: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(ffmpeg, [
      "-v", "quiet", "-show_entries", "format=duration",
      "-of", "csv=p=0", videoPath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function muxAudio(
  videoPath: string,
  voPath: string | undefined,
  musicPath: string | undefined,
  overlayBeats: Beat[],
  config: Config,
  logger: Logger,
  segmentDir: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const hasOverlay = overlayBeats.length > 0 && config.vfxPath && fs.existsSync(config.vfxPath);
  const hasAnyAudio = voPath || musicPath || hasOverlay;

  if (!hasAnyAudio) {
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  if (voPath && !musicPath && !hasOverlay) {
    await runFFmpeg(
      config.ffmpegPath,
      [
        "-y", "-i", videoPath, "-i", path.resolve(voPath),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "copy",
        "-movflags", "+faststart",
        outputPath,
      ],
      logger,
      300_000,
      signal
    );
    return;
  }

  let overlayAudioPath: string | null = null;
  if (hasOverlay) {
    overlayAudioPath = path.join(segmentDir, "overlay_audio.aac");
    try {
      await runFFmpeg(
        config.ffmpegPath,
        ["-y", "-i", config.vfxPath, "-vn", "-acodec", "aac", overlayAudioPath],
        logger,
        30_000,
        signal
      );
    } catch {
      overlayAudioPath = null;
    }
  }

  const filterParts: string[] = [];
  const inputArgs = ["-y", "-i", videoPath];
  let inputIdx = 1;

  const voInputIdx = voPath ? inputIdx++ : -1;
  if (voPath) inputArgs.push("-i", path.resolve(voPath));

  const musicInputIdx = musicPath ? inputIdx++ : -1;
  if (musicPath) inputArgs.push("-i", path.resolve(musicPath));

  const overlayInputIndices: number[] = [];
  if (overlayAudioPath) {
    for (let i = 0; i < overlayBeats.length; i++) {
      overlayInputIndices.push(inputIdx++);
      inputArgs.push("-i", overlayAudioPath);
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

  if (overlayAudioPath && overlayInputIndices.length > 0) {
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
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  ];

  try {
    await runFFmpeg(config.ffmpegPath, args, logger, 300_000, signal);
  } catch (muxErr: any) {
    await logger.warn(
      `Audio mux failed: ${muxErr.message}, trying VO only`
    );
    const fallbackArgs = ["-y", "-i", videoPath];
    if (voPath) fallbackArgs.push("-i", path.resolve(voPath));
    fallbackArgs.push("-map", "0:v");
    if (voPath) fallbackArgs.push("-map", "1:a");
    fallbackArgs.push("-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", outputPath);
    await runFFmpeg(config.ffmpegPath, fallbackArgs, logger, 300_000, signal);
  }
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
  const title = scenePlan.title.replace(/\s+/g, "_");
  const outputPath = path.join(config.outputDir, `${title}.mp4`);
  const res = getResolution(config);
  const fps = config.fps;
  const { width, height } = res;

  cleanStaleTempDirs(config, logger);

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
    await logger.log(phaseTime("Skipping Phase 1 & 2: concat_raw.mp4 exists from previous render"));
    callbacks?.onPercent?.(PHASE2_END, "Resuming from concat...");
  } else {
    await logger.log(phaseTime("Phase 1: Rendering beat segments..."));
    if (completedBeats.size > 0) {
      const initialPct = Math.round(PHASE1_END * (completedBeats.size / totalBeats));
      callbacks?.onPercent?.(initialPct, `Rendering segment ${completedBeats.size}/${totalBeats}`);
    } else {
      callbacks?.onPercent?.(0, "Rendering beat segments...");
    }

    const concurrency = Math.min(config.renderConcurrency ?? 12, 12);

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
            const segPath = await renderBeatWithRetries(
              beats[idx],
              assets[beats[idx].id],
              config,
              logger,
              res,
              segmentDir,
              renderDurations[idx],
              callbacks?.abortSignal
            );
            segmentPaths[idx] = segPath;
            completedBeats.add(idx);
            manifest.completedBeats[idx] = segPath;
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
        const pct = Math.round(PHASE1_END * (done / totalBeats));
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
      throw new Error(
        `${missingIdx.length} beat(s) failed to render after ${MAX_RETRIES} attempts: ${missingIdx.slice(0, 10).join(", ")}`
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

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      try {
        if (group.hasTransitions && group.count > 1) {
          const result = await xfadeGroup(
            segmentPaths as string[],
            beats,
            group,
            config,
            logger,
            segmentDir,
            gi,
            callbacks?.abortSignal
          );
          groupOutputs.push(result);
          processedTransitionGroups++;
          if (groupsWithTransitions.length > 0) {
            const phasePct = PHASE1_END + Math.round((PHASE2_END - PHASE1_END) * (processedTransitionGroups / groupsWithTransitions.length));
            callbacks?.onPercent?.(phasePct, `Applying transitions ${processedTransitionGroups}/${groupsWithTransitions.length}`);
          }
        } else {
          for (let j = group.startIdx; j < group.startIdx + group.count; j++) {
            groupOutputs.push(segmentPaths[j]!);
          }
        }
      } catch (err: any) {
        await logger.warn(
          `Group ${gi} xfade failed (${err.message}), falling back to hard cuts`
        );
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
  const concatDur = await getVideoDuration(concatVideo, config.ffmpegPath);
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

  if (callbacks?.isCancelled?.()) {
    await logger.log(phaseTime("Render cancelled before mux"));
    wasCancelled = true;
    throw new Error("cancelled by user");
  }

  await logger.log(phaseTime("Phase 5: Muxing audio..."));
  callbacks?.onPercent?.(PHASE3_END, "Muxing audio...");
  await muxAudio(
    currentVideo,
    voPath,
    musicPath,
    overlayBeats,
    config,
    logger,
    segmentDir,
    outputPath,
    callbacks?.abortSignal
  );

  const totalElapsedMs = Date.now() - renderStart;

  callbacks?.onPhaseComplete?.("mux", segmentDir, totalElapsedMs);

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
