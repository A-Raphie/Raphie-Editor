import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
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
  }) => void;
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
    default:
      return `zoompan=z='1+0.2*on/${last}':x='iw/2-(ow/zoom)/2':y='ih/2-(oh/zoom)/2':d=${d}:s=${width}x${height}:fps=${fps}`;
  }
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

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "\\\\'")
    .replace(/:/g, "\\\\:")
    .replace(/\n/g, " ")
    .slice(0, 120);
}

async function renderBeatSegment(
  beat: Beat,
  assetPath: string | undefined,
  config: Config,
  logger: Logger,
  res: Resolution,
  segmentDir: string,
  renderDuration: number
): Promise<string> {
  const { width, height } = res;
  const fps = config.fps;
  const segmentPath = path.join(segmentDir, `beat_${beat.id}.mp4`);
  const ffmpeg = config.ffmpegPath;
  const totalFrames = Math.round(renderDuration * fps);

  const type = beat.type === "subscribe_cta" ? "lower_third" : beat.type;

  if (type === "clip" && assetPath && fs.existsSync(assetPath)) {
    const args = [
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      assetPath,
      "-t",
      String(renderDuration),
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "-c:v",
      "libx264",
      "-crf",
      "10",
      "-preset",
      "ultrafast",
      "-r",
      String(fps),
      "-an",
      "-movflags",
      "+faststart",
      segmentPath,
    ];
    await execFileAsync(ffmpeg, args, { timeout: 120_000 });
    return segmentPath;
  }

  if (type === "image" && assetPath && fs.existsSync(assetPath)) {
    const animation = beat.imageAnimation ?? "zoom_in";
    const zoompan = getZoompanFilter(animation, totalFrames, res, fps);
    const args = [
      "-y",
      "-loop",
      "1",
      "-i",
      assetPath,
      "-vf",
      zoompan,
      "-t",
      String(renderDuration),
      "-c:v",
      "libx264",
      "-crf",
      "10",
      "-preset",
      "ultrafast",
      "-r",
      String(fps),
      "-an",
      "-movflags",
      "+faststart",
      segmentPath,
    ];
    await execFileAsync(ffmpeg, args, { timeout: 120_000 });
    return segmentPath;
  }

  const title =
    beat.lowerThirdData?.title ??
    beat.searchQuery ??
    beat.text ??
    "Content unavailable";
  const subtitle = beat.lowerThirdData?.subtitle ?? beat.subtitle ?? "";
  const et = escapeText(title);
  const es = escapeText(subtitle);

  const vf = [
    `drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='${et}':fontsize=36:fontcolor=white:x=60:y=h-160:box=1:boxcolor=black@0.85:boxborderw=16`,
    `drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='${es}':fontsize=24:fontcolor=0xCCCCCC:x=76:y=h-110`,
  ].join(",");

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${renderDuration}:r=${fps}`,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-crf",
    "10",
    "-preset",
    "ultrafast",
    "-an",
    "-movflags",
    "+faststart",
    segmentPath,
  ];
  await execFileAsync(ffmpeg, args, { timeout: 60_000 });
  return segmentPath;
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
  batchIdx: number
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
      const outLabel =
        j === sbCount - 1 ? "out" : `v${j - 1}`;

      filterParts.push(
        `[${inA}][${j}:v]xfade=transition=${transName}:duration=${td.toFixed(4)}:offset=${offset.toFixed(4)}[${outLabel}]`
      );

      cumulative += beats[beatIdx].duration + getTransitionSec(beats[beatIdx], fps) - td;
    }

    args.push("-filter_complex", filterParts.join("; "));
    args.push("-map", "[out]");
    args.push("-c:v", "libx264", "-crf", "10", "-preset", "ultrafast", "-an");

    const sbOutput = subBatches === 1
      ? batchOutput
      : path.join(segmentDir, `xfade_sub_${batchIdx}_${sb}.mp4`);
    args.push(sbOutput);

    await execFileAsync(config.ffmpegPath, args, { timeout: 600_000 });
    subBatchPaths.push(sbOutput);
  }

  if (subBatchPaths.length === 1) {
    return subBatchPaths[0];
  }

  const concatList = path.join(segmentDir, `xfade_concat_${batchIdx}.txt`);
  fs.writeFileSync(
    concatList,
    subBatchPaths.map((p) => `file '${p}'`).join("\n")
  );

  await execFileAsync(
    config.ffmpegPath,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatList,
      "-c",
      "copy",
      batchOutput,
    ],
    { timeout: 300_000 }
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
  outputPath: string
): Promise<void> {
  const { width, height } = res;
  const vfxPath = config.vfxPath;
  if (!vfxPath || !fs.existsSync(vfxPath)) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const filterParts: string[] = [];
  filterParts.push(`[0:v]null[base]`);

  const n = overlayBeats.length;
  const inputArgs = ["-y", "-i", inputPath];

  for (let i = 0; i < n; i++) {
    inputArgs.push("-i", vfxPath);
  }

  let currentLabel = "base";
  const vfxWidth = Math.round(width * (config.subscribeOverlaySize / 100) * 0.01);

  for (let i = 0; i < n; i++) {
    const beat = overlayBeats[i];
    const startSec = beat.startTime;
    const fps = config.fps;
    const vfxDurationSec = 180 / fps;
    const endSec = startSec + vfxDurationSec;
    const fadeInSec = 0.3;
    const fadeOutSec = 0.3;

    const scaledLabel = `s${i}`;
    filterParts.push(
      `[${i + 1}:v]scale=${vfxWidth}:-1,format=rgba,colorchannelmixer=aa='if(between(t,${startSec},${startSec + fadeInSec}),(t-${startSec})/${fadeInSec},if(between(t,${endSec - fadeOutSec},${endSec}),(${endSec}-t)/${fadeOutSec},if(between(t,${startSec},${endSec}),1,0)))'[${scaledLabel}]`
    );

    const outLabel = i === n - 1 ? "vfx" : `o${i}`;
    filterParts.push(
      `[${currentLabel}][${scaledLabel}]overlay=(W-w)/2:(H-h)/2:enable='between(t,${startSec},${endSec})':format=auto[${outLabel}]`
    );
    currentLabel = outLabel;
  }

  const args = [
    ...inputArgs,
    "-filter_complex",
    filterParts.join("; "),
    "-map",
    `[${currentLabel}]`,
    "-c:v",
    "libx264",
    "-crf",
    "10",
    "-preset",
    "ultrafast",
    "-an",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  await execFileAsync(config.ffmpegPath, args, { timeout: 600_000 });
}

async function applyGlobalEffects(
  inputPath: string,
  config: Config,
  logger: Logger,
  res: Resolution,
  outputPath: string
): Promise<void> {
  const filters: string[] = [];

  if (config.enableColorGrade) {
    filters.push("colorbalance=rs=0.01:gs=-0.005:bs=-0.02");
  }
  if (config.enableVignette) {
    filters.push("vignette=angle=0.45");
  }

  if (filters.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const codec = config.videoCodec === "h264" ? "h264_videotoolbox" : "hevc_videotoolbox";
  const bitrate = config.videoCodec === "h264" ? "20M" : "15M";

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    filters.join(","),
    "-c:v",
    codec,
    "-b:v",
    bitrate,
    "-allow_sw",
    "1",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await execFileAsync(config.ffmpegPath, args, { timeout: 600_000 });
  } catch (err: any) {
    await logger.warn(`VideoToolbox encode failed, falling back to software: ${err.message}`);
    const swCodec = config.videoCodec === "h264" ? "libx264" : "libx265";
    const crf = config.videoCodec === "h264" ? "18" : "20";
    const fallbackArgs = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filters.join(","),
      "-c:v",
      swCodec,
      "-crf",
      crf,
      "-preset",
      "fast",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ];
    await execFileAsync(config.ffmpegPath, fallbackArgs, { timeout: 900_000 });
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
): Promise<void> {
  const hasOverlay = overlayBeats.length > 0 && config.vfxPath && fs.existsSync(config.vfxPath);
  const hasAnyAudio = voPath || musicPath || hasOverlay;

  if (!hasAnyAudio) {
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  let overlayAudioPath: string | null = null;
  if (hasOverlay) {
    overlayAudioPath = path.join(segmentDir, "overlay_audio.aac");
    try {
      await execFileAsync(
        config.ffmpegPath,
        ["-y", "-i", config.vfxPath, "-vn", "-acodec", "aac", overlayAudioPath],
        { timeout: 30_000 }
      );
    } catch {
      overlayAudioPath = null;
    }
  }

  const args = ["-y", "-i", videoPath];

  if (voPath) args.push("-i", path.resolve(voPath));
  if (musicPath) args.push("-i", path.resolve(musicPath));

  const overlayInputIndices: number[] = [];
  if (overlayAudioPath) {
    let nextIdx = 1 + (voPath ? 1 : 0) + (musicPath ? 1 : 0);
    for (const beat of overlayBeats) {
      args.push("-i", overlayAudioPath);
      overlayInputIndices.push(nextIdx);
      nextIdx++;
    }
  }

  const filterParts: string[] = [];
  const mapParts: string[] = ["-map", "0:v"];

  const voIdx = voPath ? 1 : -1;
  const musicIdx = musicPath ? (voPath ? 2 : 1) : -1;

  if (overlayAudioPath && overlayInputIndices.length > 0) {
    for (let i = 0; i < overlayInputIndices.length; i++) {
      const inputIdx = overlayInputIndices[i];
      const delayMs = Math.round(overlayBeats[i].startTime * 1000);
      const label = `ov${i}`;
      if (delayMs > 0) {
        filterParts.push(
          `[${inputIdx}:a]adelay=${delayMs}|${delayMs}[${label}]`
        );
      } else {
        filterParts.push(`[${inputIdx}:a]anull[${label}]`);
      }
    }

    if (voPath) {
      let mixLabel = `[${voIdx}:a]`;
      for (let i = 0; i < overlayInputIndices.length; i++) {
        const ovLabel = `ov${i}`;
        const outLabel =
          overlayInputIndices.length === 1 ? "vo_mix" : `mix${i}`;
        filterParts.push(
          `${mixLabel}[${ovLabel}]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[${outLabel}]`
        );
        mixLabel = `[${outLabel}]`;
      }
      mapParts.push("-map", mixLabel);
    } else {
      for (let i = 0; i < overlayInputIndices.length; i++) {
        mapParts.push("-map", `[ov${i}]`);
      }
    }
  } else {
    if (voPath) {
      mapParts.push("-map", `${voIdx}:a`);
    }
  }

  if (musicPath) {
    mapParts.push("-map", `${musicIdx}:a`);
  }

  if (filterParts.length > 0) {
    args.push("-filter_complex", filterParts.join("; "));
  }
  args.push(...mapParts);
  args.push("-c:v", "copy", "-c:a", "aac", "-shortest", outputPath);

  try {
    await execFileAsync(config.ffmpegPath, args, { timeout: 300_000 });
  } catch (muxErr: any) {
    await logger.warn(
      `Audio mux with overlay failed, retrying without overlay: ${muxErr.message}`
    );
    const fallbackArgs = ["-y", "-i", videoPath];
    if (voPath) fallbackArgs.push("-i", path.resolve(voPath));
    if (musicPath) fallbackArgs.push("-i", path.resolve(musicPath));
    fallbackArgs.push("-map", "0:v");
    if (voPath) fallbackArgs.push("-map", "1:a");
    if (musicPath)
      fallbackArgs.push("-map", `${voPath ? 2 : 1}:a`);
    fallbackArgs.push(
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      outputPath
    );
    await execFileAsync(config.ffmpegPath, fallbackArgs, {
      timeout: 300_000,
    });
  }
}

function cleanStaleTempDirs(logger: Logger): void {
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
          if (ageMs > 24 * 60 * 60 * 1000) {
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

  cleanStaleTempDirs(logger);

  const segmentDir =
    existingState?.segmentDir ??
    path.join(os.tmpdir(), `ffmpeg-render-${Date.now()}`);
  fs.mkdirSync(segmentDir, { recursive: true });

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

  await logger.log(
    `FFmpeg renderer: ${totalBeats} beats, ${width}x${height} @ ${fps}fps`
  );
  await logger.log(
    `${beats.filter((b) => b.type === "clip").length} clips, ${beats.filter((b) => b.type === "image").length} images, ${overlayBeats.length} VFX overlays`
  );

  const segmentPaths: (string | null)[] = new Array(totalBeats).fill(null);
  const renderDurations: number[] = new Array(totalBeats);

  for (let i = 0; i < totalBeats; i++) {
    const beat = beats[i];
    let ext = beat.duration;
    if (i > 0 && hasTransition(beat)) {
      ext += getTransitionSec(beat, fps);
    }
    if (i < totalBeats - 1 && hasTransition(beats[i + 1])) {
      ext += getTransitionSec(beats[i + 1], fps);
    }
    renderDurations[i] = ext;
  }

  const completedBeats = new Set<number>();
  let lastProgressTime = 0;

  await logger.log("Phase 1: Rendering beat segments...");

  const concurrency = Math.min(config.renderConcurrency ?? 4, 12);

  for (let i = 0; i < totalBeats; i += concurrency) {
    const batchEnd = Math.min(i + concurrency, totalBeats);
    const promises: Promise<void>[] = [];

    for (let j = i; j < batchEnd; j++) {
      const idx = j;
      promises.push(
        (async () => {
          try {
            const segPath = await renderBeatSegment(
              beats[idx],
              assets[beats[idx].id],
              config,
              logger,
              res,
              segmentDir,
              renderDurations[idx]
            );
            segmentPaths[idx] = segPath;
            completedBeats.add(idx);
          } catch (err: any) {
            await logger.warn(
              `Beat ${idx} (${beats[idx].id}) render failed: ${err.message}`
            );
            const fallbackPath = await renderBeatSegment(
              { ...beats[idx], type: "lower_third", imageAnimation: undefined },
              undefined,
              config,
              logger,
              res,
              segmentDir,
              renderDurations[idx]
            );
            segmentPaths[idx] = fallbackPath;
            completedBeats.add(idx);
          }
        })()
      );
    }

    await Promise.all(promises);

    const now = Date.now();
    if (now - lastProgressTime > 500 || batchEnd === totalBeats) {
      const done = completedBeats.size;
      callbacks?.onSegmentProgress?.(done - 1, totalBeats, done / totalBeats);
      lastProgressTime = now;
      await logger.log(`Beat segments: ${done}/${totalBeats} (${Math.round(done / totalBeats * 100)}%)`);
    }
  }

  await logger.log(
    `All ${totalBeats} beat segments rendered (${completedBeats.size} succeeded)`
  );

  const validSegments = segmentPaths.filter((p) => p !== null) as string[];
  if (validSegments.length === 0) {
    throw new Error("No beat segments were rendered successfully");
  }

  const missingIdx = segmentPaths
    .map((p, i) => (p === null ? i : -1))
    .filter((i) => i >= 0);
  if (missingIdx.length > 0) {
    await logger.warn(
      `${missingIdx.length} beat(s) had no rendered segment, using black frames`
    );
    for (const idx of missingIdx) {
      const blackPath = path.join(segmentDir, `beat_${beats[idx].id}.mp4`);
      const dur = renderDurations[idx];
      await execFileAsync(config.ffmpegPath, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${width}x${height}:d=${dur}:r=${fps}`,
        "-c:v",
        "libx264",
        "-crf",
        "10",
        "-preset",
        "ultrafast",
        "-an",
        blackPath,
      ]);
      segmentPaths[idx] = blackPath;
    }
  }

  callbacks?.onSegmentProgress?.(totalBeats - 1, totalBeats, 0.5);
  await logger.log("Phase 2: Concatenating with transitions...");

  const groups = groupBeats(beats);
  await logger.log(
    `${groups.length} beat groups (${groups.filter((g) => g.hasTransitions).length} with transitions, ${groups.filter((g) => !g.hasTransitions).length} hard cuts)`
  );

  const groupOutputs: string[] = [];

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
          gi
        );
        groupOutputs.push(result);
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

  const concatVideo = path.join(segmentDir, "concat_raw.mp4");

  if (groupOutputs.length === 1) {
    fs.copyFileSync(groupOutputs[0], concatVideo);
  } else {
    const concatList = path.join(segmentDir, "concat_all.txt");
    fs.writeFileSync(
      concatList,
      groupOutputs.map((p) => `file '${p}'`).join("\n")
    );

    await execFileAsync(
      config.ffmpegPath,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatList,
        "-c",
        "copy",
        concatVideo,
      ],
      { timeout: 300_000 }
    );

    try {
      fs.unlinkSync(concatList);
    } catch {}
  }

  await logger.log("Concatenation complete");

  let currentVideo = concatVideo;

  if (overlayBeats.length > 0 && config.vfxPath) {
    await logger.log(
      `Phase 3: Applying ${overlayBeats.length} VFX overlay(s)...`
    );
    const vfxVideo = path.join(segmentDir, "with_vfx.mp4");
    try {
      await applyVfxOverlays(
        currentVideo,
        overlayBeats,
        config,
        logger,
        res,
        segmentDir,
        vfxVideo
      );
      currentVideo = vfxVideo;
      await logger.log("VFX overlays applied");
    } catch (err: any) {
      await logger.warn(
        `VFX overlay failed: ${err.message}, continuing without overlays`
      );
    }
  }

  if (config.enableVignette || config.enableColorGrade) {
    await logger.log("Phase 4: Applying global effects...");
    const effectsVideo = path.join(segmentDir, "with_effects.mp4");
    try {
      await applyGlobalEffects(
        currentVideo,
        config,
        logger,
        res,
        effectsVideo
      );
      currentVideo = effectsVideo;
      await logger.log("Global effects applied");
    } catch (err: any) {
      await logger.warn(
        `Global effects failed: ${err.message}, continuing without effects`
      );
    }
  }

  await logger.log("Phase 5: Muxing audio...");
  await muxAudio(
    currentVideo,
    voPath,
    musicPath,
    overlayBeats,
    config,
    logger,
    segmentDir,
    outputPath
  );

  await logger.log(`FFmpeg render complete: ${outputPath}`);

  return {
    outputPath,
    segmentState: {
      segmentLength: 0,
      completedSegments: Array.from(completedBeats),
      totalSegments: totalBeats,
      segmentDir,
    },
  };
  } finally {
    try {
      fs.rmSync(segmentDir, { recursive: true, force: true });
    } catch {}
  }
}
