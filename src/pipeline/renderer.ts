import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ScenePlan, AssetMapping, RenderSegmentState } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { Logger } from "../utils/logger.js";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition, combineChunks } from "@remotion/renderer";

const execFileAsync = promisify(execFile);

const DUMMY_ICO = Buffer.from([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
  0x18, 0x00, 0x30, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const RENDER_PREFIX = "_render_";
const PUBLIC_DIR_NAME = ".remotion-public";

function ensureBundlerFavicon(): void {
  try {
    const bundlerDir = path.dirname(require.resolve("@remotion/bundler"));
    const faviconPath = path.join(bundlerDir, "..", "favicon.ico");
    if (!fs.existsSync(faviconPath)) {
      fs.writeFileSync(faviconPath, DUMMY_ICO);
    }
  } catch {}
}

function getCompositorBinDir(): string | undefined {
  try {
    if (process.resourcesPath) {
      const resourceBinDir = path.join(process.resourcesPath, "mac-arm64", "remotion-bin");
      if (fs.existsSync(path.join(resourceBinDir, "remotion"))) {
        return resourceBinDir;
      }
    }
    const pkg = require("@remotion/compositor-darwin-arm64") as { dir: string };
    return pkg.dir;
  } catch {
    return undefined;
  }
}

async function getBrowserExecutable(logger: Logger): Promise<string | undefined> {
  try {
    const prevCwd = process.cwd();
    process.chdir(os.homedir());
    try {
      const result = await ensureBrowser();
      return result.path;
    } finally {
      process.chdir(prevCwd);
    }
  } catch (err: any) {
    await logger.log(`Browser download skipped: ${err.message}`);
    return undefined;
  }
}

function preparePublicDir(
  outputDir: string,
  assets: AssetMapping,
  voPath?: string,
  musicPath?: string,
  vfxPath?: string
): { publicDir: string; voUrl: string | undefined; musicUrl: string | undefined } {
  const publicDir = path.join(outputDir, PUBLIC_DIR_NAME);

  try { fs.rmSync(publicDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(publicDir, { recursive: true });

  const assetEntries = Object.entries(assets).filter(([, absPath]) => absPath && fs.existsSync(absPath));
  for (let i = 0; i < assetEntries.length; i += 10) {
    const batch = assetEntries.slice(i, i + 10);
    for (const [, absPath] of batch) {
      const rel = path.relative(outputDir, absPath);
      const dest = path.join(publicDir, RENDER_PREFIX + "output", rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(absPath, dest);
    }
  }

  let voUrl: string | undefined;
  if (voPath) {
    const resolved = path.resolve(voPath);
    const name = RENDER_PREFIX + "vo" + path.extname(resolved);
    fs.copyFileSync(resolved, path.join(publicDir, name));
    voUrl = `/public/${name}`;
  }

  let musicUrl: string | undefined;
  if (musicPath) {
    const resolved = path.resolve(musicPath);
    const name = RENDER_PREFIX + "music" + path.extname(resolved);
    fs.copyFileSync(resolved, path.join(publicDir, name));
    musicUrl = `/public/${name}`;
  }

  if (vfxPath && fs.existsSync(vfxPath)) {
    const vfxDir = path.join(publicDir, "vfx");
    fs.mkdirSync(vfxDir, { recursive: true });
    fs.copyFileSync(vfxPath, path.join(vfxDir, "subscribe.mp4"));
  }

  return { publicDir, voUrl, musicUrl };
}

function cleanupPublicDir(publicDir: string): void {
  try { fs.rmSync(publicDir, { recursive: true, force: true }); } catch {}
}

function convertAssets(assets: AssetMapping, outputDir: string): AssetMapping {
  const result: AssetMapping = {};
  for (const [id, absPath] of Object.entries(assets)) {
    const rel = path.relative(outputDir, absPath);
    const urlPath = rel.split(path.sep).join("/");
    result[id] = `/public/${RENDER_PREFIX}output/${urlPath}`;
  }
  return result;
}

export async function renderVideo(
  scenePlan: ScenePlan,
  assets: AssetMapping,
  config: Config,
  logger: Logger,
  voPath?: string,
  musicPath?: string,
  onRenderProgress?: (percent: number) => void
): Promise<string> {
  const outputPath = path.join(config.outputDir, `${scenePlan.title.replace(/\s+/g, "_")}.mp4`);

  await logger.log("Ensuring browser is available...");
  const browserExecutable = await getBrowserExecutable(logger);

  await logger.log("Preparing render assets...");

  const { publicDir, voUrl, musicUrl } = preparePublicDir(
    config.outputDir, assets, voPath, musicPath, config.vfxPath
  );

  await logger.log("Bundling Remotion project...");

  ensureBundlerFavicon();
  const binariesDirectory = getCompositorBinDir();
  if (binariesDirectory) {
    await logger.log(`Using compositor binaries from: ${binariesDirectory}`);
  }

  try {
    const serveUrl = await bundle({
      entryPoint: config.remotionEntryPath,
      publicDir,
    });

    const publicAssets = convertAssets(assets, config.outputDir);

    await logger.log("Selecting composition...");

    const inputProps = {
      scenePlan,
      assets: publicAssets,
      voPath: voUrl,
      musicPath: musicUrl,
    };

    const composition = await selectComposition({
      serveUrl,
      id: "Documentary",
      inputProps,
      binariesDirectory,
      browserExecutable,
    });

    const singleRenderCodec = (config as any).videoCodec === "h264" ? "h264" : "h265";
    await renderMedia({
      composition,
      serveUrl,
      codec: singleRenderCodec as "h264" | "h265",
      audioCodec: "aac",
      outputLocation: outputPath,
      inputProps,
      binariesDirectory,
      browserExecutable,
      onProgress: ({ progress }: { progress: number }) => {
        const pct = Math.round(progress * 100);
        onRenderProgress?.(pct);
        if (pct % 10 === 0) {
          logger.log(`Render progress: ${pct}%`);
        }
      },
    });

    await logger.log(`Render complete: ${outputPath}`);
    return outputPath;
  } finally {
    cleanupPublicDir(publicDir);
  }
}

export interface SegmentRenderCallbacks {
  onSegmentProgress?: (segmentIndex: number, totalSegments: number, frameProgress: number) => void;
  onSegmentComplete?: (segmentIndex: number) => void;
  onSegmentsInit?: (info: { totalSegments: number; segmentLength: number; segmentDir: string }) => void;
  parallelSegments?: number;
}

export async function renderVideoSegments(
  scenePlan: ScenePlan,
  assets: AssetMapping,
  config: Config,
  logger: Logger,
  voPath?: string,
  musicPath?: string,
  existingState?: RenderSegmentState | null,
  callbacks?: SegmentRenderCallbacks
): Promise<{ outputPath: string; segmentState: RenderSegmentState }> {
  const outputPath = path.join(config.outputDir, `${scenePlan.title.replace(/\s+/g, "_")}.mp4`);

  const segmentLength = config.segmentLength ?? 900;

  await logger.log("Ensuring browser is available...");
  const browserExecutable = await getBrowserExecutable(logger);

  await logger.log("Preparing render assets...");

  const { publicDir, voUrl, musicUrl } = preparePublicDir(
    config.outputDir, assets, voPath, musicPath, config.vfxPath
  );

  await logger.log("Bundling Remotion project...");

  ensureBundlerFavicon();
  const binariesDirectory = getCompositorBinDir();
  if (binariesDirectory) {
    await logger.log(`Using compositor binaries from: ${binariesDirectory}`);
  }

    const segmentDir = existingState?.segmentDir ?? path.join(os.tmpdir(), `render-segments-${Date.now()}`);
  fs.mkdirSync(segmentDir, { recursive: true });

  try {
    const serveUrl = await bundle({
      entryPoint: config.remotionEntryPath,
      publicDir,
    });

    const publicAssets = convertAssets(assets, config.outputDir);

    await logger.log("Selecting composition...");

    const inputProps = {
      scenePlan,
      assets: publicAssets,
      voPath: voUrl,
      musicPath: musicUrl,
    };

    const composition = await selectComposition({
      serveUrl,
      id: "Documentary",
      inputProps,
      binariesDirectory,
      browserExecutable,
    });

    const totalFrames = composition.durationInFrames;
    const totalSegments = Math.ceil(totalFrames / segmentLength);
    const completedSegments = existingState?.completedSegments
      ? [...existingState.completedSegments]
      : [];

    callbacks?.onSegmentsInit?.({
      totalSegments,
      segmentLength,
      segmentDir,
    });

    await logger.log(
      `Segment rendering: ${totalFrames} frames, ${totalSegments} segments (${segmentLength / config.fps}s each), ${callbacks?.parallelSegments ?? 1} parallel`
    );

    if (completedSegments.length > 0) {
      await logger.log(`Resuming from segment ${completedSegments.length}/${totalSegments} (${completedSegments.length * segmentLength / config.fps}s already rendered)`);
    }

    const renderConcurrency = config.renderConcurrency ?? 3;
    const renderCodec = (config as any).videoCodec === "h264" ? "h264" : "h265";

    const renderSegment = async (seg: number) => {
      if (completedSegments.includes(seg)) return;

      const startFrame = seg * segmentLength;
      const endFrame = Math.min(startFrame + segmentLength - 1, totalFrames - 1);
      const segmentFile = path.join(segmentDir, `segment_${String(seg).padStart(4, "0")}.mp4`);

      const segStartSec = (startFrame / config.fps).toFixed(1);
      const segEndSec = (endFrame / config.fps).toFixed(1);
      await logger.log(`Rendering segment ${seg + 1}/${totalSegments} (${segStartSec}s-${segEndSec}s) with ${renderConcurrency} frame concurrency, ${renderCodec}...`);

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const timeoutMs = 20 * 60 * 1000;
          let timedOut = false;
          const result = await Promise.race([
            renderMedia({
              composition,
              serveUrl,
              codec: renderCodec as "h264" | "h265",
              outputLocation: segmentFile,
              inputProps,
              binariesDirectory,
              browserExecutable,
              frameRange: [startFrame, endFrame],
              muted: true,
              concurrency: renderConcurrency,
              onProgress: ({ progress }: { progress: number }) => {
                callbacks?.onSegmentProgress?.(seg, totalSegments, progress);
              },
            }),
            new Promise<"timeout">((resolve) => setTimeout(() => { timedOut = true; resolve("timeout"); }, timeoutMs)),
          ]);
          if (result === "timeout") {
            throw new Error(`Segment ${seg + 1} timed out after 20 minutes`);
          }
          break;
        } catch (err: any) {
          if (attempt < 2) {
            await logger.warn(`Segment ${seg + 1} failed (attempt ${attempt}/2): ${err.message}. Retrying...`);
          } else {
            throw err;
          }
        }
      }

      completedSegments.push(seg);
      callbacks?.onSegmentComplete?.(seg);
      await logger.log(`Segment ${seg + 1}/${totalSegments} complete`);
    };

    const parallelSegments = callbacks?.parallelSegments ?? 1;
    if (parallelSegments <= 1) {
      for (let seg = 0; seg < totalSegments; seg++) {
        await renderSegment(seg);
      }
    } else {
      for (let batchStart = 0; batchStart < totalSegments; batchStart += parallelSegments) {
        const batchPromises: Promise<void>[] = [];
        for (let i = 0; i < parallelSegments && batchStart + i < totalSegments; i++) {
          const seg = batchStart + i;
          if (!completedSegments.includes(seg)) {
            batchPromises.push(renderSegment(seg));
          }
        }
        if (batchPromises.length > 0) {
          await Promise.all(batchPromises);
        }
      }
    }

    await logger.log(`All ${totalSegments} segments rendered. Combining video...`);

    const videoFiles = completedSegments
      .sort((a, b) => a - b)
      .map((seg) => path.join(segmentDir, `segment_${String(seg).padStart(4, "0")}.mp4`));

    const tempVideo = outputPath.replace(/\.mp4$/, "_temp.mp4");
    await combineChunks({
      videoFiles,
      audioFiles: [],
      fps: config.fps,
      framesPerChunk: segmentLength,
      compositionDurationInFrames: totalFrames,
      codec: renderCodec as "h264" | "h265",
      audioCodec: "aac",
      outputLocation: tempVideo,
      binariesDirectory: binariesDirectory ?? null,
      preferLossless: false,
    });

    const ffmpegArgs = ["-y"];
    ffmpegArgs.push("-i", tempVideo);

    if (voPath) {
      ffmpegArgs.push("-i", path.resolve(voPath));
    }
    if (musicPath) {
      ffmpegArgs.push("-i", path.resolve(musicPath));
    }

    const overlayBeats = scenePlan.beats.filter(b => b.overlay?.type === "subscribe_cta");
    let overlayAudioPath: string | null = null;

    if (overlayBeats.length > 0 && config.vfxPath && fs.existsSync(config.vfxPath)) {
      overlayAudioPath = path.join(segmentDir, "overlay_audio.aac");
      try {
        await execFileAsync(config.ffmpegPath, [
          "-y", "-i", config.vfxPath,
          "-vn", "-acodec", "aac",
          overlayAudioPath,
        ], { timeout: 30000 });
        await logger.log(`Extracted overlay audio for ${overlayBeats.length} beat(s)`);
      } catch (err: any) {
        await logger.warn(`Overlay audio extraction failed: ${err.message}`);
        overlayAudioPath = null;
      }
    }

    const hasAnyAudio = voPath || musicPath || overlayAudioPath;

    if (hasAnyAudio) {
      const voInputIdx = voPath ? 1 : -1;
      const musicInputIdx = musicPath ? (voPath ? 2 : 1) : -1;
      let nextInputIdx = 1 + (voPath ? 1 : 0) + (musicPath ? 1 : 0);

      const overlayInputIndices: number[] = [];
      if (overlayAudioPath) {
        for (const _beat of overlayBeats) {
          ffmpegArgs.push("-i", overlayAudioPath);
          overlayInputIndices.push(nextInputIdx);
          nextInputIdx++;
        }
      }

      const filterParts: string[] = [];
      const mapParts: string[] = ["-map", "0:v"];

      if (overlayAudioPath && overlayInputIndices.length > 0) {
        for (let i = 0; i < overlayInputIndices.length; i++) {
          const inputIdx = overlayInputIndices[i];
          const delayMs = Math.round(overlayBeats[i].startTime * 1000);
          const label = `ov${i}`;
          if (delayMs > 0) {
            filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[${label}]`);
          } else {
            filterParts.push(`[${inputIdx}:a]anull[${label}]`);
          }
        }

        if (voPath) {
          let mixLabel = `[${voInputIdx}:a]`;
          for (let i = 0; i < overlayInputIndices.length; i++) {
            const ovLabel = `ov${i}`;
            const outLabel = overlayInputIndices.length === 1 ? "vo_mix" : `mix${i}`;
            filterParts.push(`${mixLabel}[${ovLabel}]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[${outLabel}]`);
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
          mapParts.push("-map", `${voInputIdx}:a`);
        }
      }

      if (musicPath) {
        mapParts.push("-map", `${musicInputIdx}:a`);
      }

      if (filterParts.length > 0) {
        ffmpegArgs.push("-filter_complex", filterParts.join("; "));
      }
      ffmpegArgs.push(...mapParts);
      ffmpegArgs.push("-c:v", "copy", "-c:a", "aac", "-shortest", outputPath);

      await logger.log("Muxing audio with ffmpeg...");
      try {
        await execFileAsync(config.ffmpegPath, ffmpegArgs, { timeout: 300000 });
      } catch (muxErr: any) {
        await logger.warn(`ffmpeg mux with overlay failed, retrying without overlay: ${muxErr.message}`);
        const fallbackArgs = ["-y", "-i", tempVideo];
        if (voPath) {
          fallbackArgs.push("-i", path.resolve(voPath));
        }
        if (musicPath) {
          fallbackArgs.push("-i", path.resolve(musicPath));
        }
        fallbackArgs.push("-map", "0:v");
        if (voPath) fallbackArgs.push("-map", "1:a");
        if (musicPath) fallbackArgs.push("-map", `${voPath ? 2 : 1}:a`);
        fallbackArgs.push("-c:v", "copy", "-c:a", "aac", "-shortest", outputPath);
        await execFileAsync(config.ffmpegPath, fallbackArgs, { timeout: 300000 });
      }
      try { fs.unlinkSync(tempVideo); } catch {}
    } else {
      try { fs.renameSync(tempVideo, outputPath); } catch {
        fs.copyFileSync(tempVideo, outputPath);
        try { fs.unlinkSync(tempVideo); } catch {}
      }
    }

    await logger.log(`Render complete: ${outputPath}`);

    for (const file of videoFiles) {
      try { fs.unlinkSync(file); } catch {}
    }
    try { fs.rmdirSync(segmentDir); } catch {}

    const segmentState: RenderSegmentState = {
      segmentLength,
      completedSegments,
      totalSegments,
      segmentDir,
    };

    return { outputPath, segmentState };
  } finally {
    cleanupPublicDir(publicDir);
  }
}
