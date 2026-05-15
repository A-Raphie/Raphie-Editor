import path from "path";
import fs from "fs/promises";
import os from "os";
import type { Beat, AssetMapping } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { Logger } from "../utils/logger.js";
import {
  searchAllVideoCandidates,
  searchAllImageCandidates,
  downloadCandidate,
  probeVideo,
} from "../utils/stockApi.js";
import { ensureDir, deleteFile } from "../utils/fileManager.js";
import { checkThumbnail } from "./qualityChecker.js";
import { createOpenRouterClient, chatCompletion } from "../utils/llm.js";

const QUERY_TRANSLATOR_PROMPT = `You rewrite stock footage search queries into concrete terms that stock photographers actually use as tags.

RULES:
- Output 3 alternative queries, each 1-4 words
- Each query MUST be something you could type into Pexels right now and get 10+ results
- Use ONLY common nouns and simple descriptors a photographer would tag their photo with
- NEVER use abstract, conceptual, or literary language
- NEVER combine more than 2 concepts in one query
- Think: what OBJECT is on screen? Name it plainly.

BAD (no stock photographer tags these): "ancient middle eastern market spices", "biblical healing tradition", "sacred botanical remedy", "ethereal wellness ceremony", "timeless natural wisdom"
GOOD (actual photographer tags): "spice market", "cinnamon sticks", "saffron", "herbs mortar", "dried herbs", "tea pouring", "olive oil", "honey jar"

Respond with ONLY valid JSON:
{"queries": ["query1", "query2", "query3"]}`;

async function translateQuery(
  originalQuery: string,
  config: Config,
  logger: Logger
): Promise<string[]> {
  if (!config.openrouterApiKeys?.length) return [];
  try {
    const client = createOpenRouterClient(config.openrouterApiKeys[0]);
    const model = config.qualityCheckerModel || "google/gemma-3-4b-it";
    const raw = await chatCompletion(
      client,
      model,
      QUERY_TRANSLATOR_PROMPT,
      `Original query: "${originalQuery}"`,
      3,
      undefined,
      256
    );
    const parsed = JSON.parse(raw);
    if (parsed.queries && Array.isArray(parsed.queries)) {
      return parsed.queries.filter((q: string) => typeof q === "string" && q.trim());
    }
    return [];
  } catch (err: any) {
    await logger.log(`Query translation failed: ${err.message}`);
    return [];
  }
}

interface SourceResult {
  beatId: string;
  assetPath: string;
  success: boolean;
  reason?: string;
}

export async function sourceAllAssets(
  beats: Beat[],
  config: Config,
  logger: Logger,
  existingAssets: AssetMapping = {},
  onBeatProgress?: (current: number, total: number) => void,
  onAssetComplete?: (assets: AssetMapping) => Promise<void>,
  signal?: AbortSignal,
  onBeatStatus?: (beatId: string, status: string, downloadPercent?: number) => void
): Promise<{ assets: AssetMapping; failed: Record<string, { reason: string }> }> {
  const assets: AssetMapping = { ...existingAssets };
  const failed: Record<string, { reason: string }> = {};

  const clipBeats = beats.filter((b) => b.type === "clip" && !existingAssets[b.id]);
  const imageBeats = beats.filter((b) => b.type === "image" && !existingAssets[b.id]);
  const totalBeats = clipBeats.length + imageBeats.length;
  let completedBeats = 0;
  const startTime = Date.now();

  await logger.log(`Sourcing assets: ${clipBeats.length} clips, ${imageBeats.length} images`);

  const afterBeatDone = async () => {
    completedBeats++;
    const failCount = Object.keys(failed).length;
    const avgMs = (Date.now() - startTime) / completedBeats;
    const remaining = Math.round((avgMs * (totalBeats - completedBeats)) / 1000);
    const eta = remaining > 60 ? `${Math.round(remaining / 60)}m ${remaining % 60}s` : `${remaining}s`;
    onBeatProgress?.(completedBeats, totalBeats);
    await logger.log(`Asset ${completedBeats}/${totalBeats} complete (${failCount} failed) — ~${eta} remaining`);
  };

  await Promise.all([
    sourceBeatsParallel(clipBeats, "clip", assets, failed, config, logger, afterBeatDone, onAssetComplete, signal, onBeatStatus),
    sourceBeatsParallel(imageBeats, "image", assets, failed, config, logger, afterBeatDone, onAssetComplete, signal, onBeatStatus),
  ]);

  await logger.log(
    `Sourcing complete: ${Object.keys(assets).length} assets, ${Object.keys(failed).length} failed`
  );

  return { assets, failed };
}

async function sourceBeatsParallel(
  beats: Beat[],
  beatKind: "clip" | "image",
  assets: AssetMapping,
  failed: Record<string, { reason: string }>,
  config: Config,
  logger: Logger,
  onBeatDone: () => Promise<void>,
  onAssetComplete?: (assets: AssetMapping) => Promise<void>,
  signal?: AbortSignal,
  onBeatStatus?: (beatId: string, status: string, downloadPercent?: number) => void
): Promise<void> {
  const { concurrency } = config;
  for (let i = 0; i < beats.length; i += concurrency) {
    if (signal?.aborted) break;
    const batch = beats.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((beat) => sourceBeatWithThumbnails(beat, beatKind, config, logger, signal, onBeatStatus))
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const beat = batch[j];
      if (result.status === "fulfilled" && result.value.success) {
        assets[beat.id] = result.value.assetPath;
      } else {
        const reason = result.status === "rejected"
          ? result.reason?.message ?? "Unknown error"
          : result.value?.reason ?? "Failed";
        failed[beat.id] = { reason };
        await logger.warn(`${beat.id} failed: ${reason}`);
      }
      await onBeatDone?.();
    }
    if (onAssetComplete) await onAssetComplete({ ...assets });
    if (i + concurrency < beats.length) await new Promise((r) => setTimeout(r, 500));
  }
}

async function sourceBeatWithThumbnails(
  beat: Beat,
  kind: "clip" | "image",
  config: Config,
  logger: Logger,
  signal?: AbortSignal,
  onBeatStatus?: (beatId: string, status: string, downloadPercent?: number) => void
): Promise<SourceResult> {
  const isClip = kind === "clip";
  const ext = isClip ? ".mp4" : ".jpg";
  const dir = isClip ? config.clipsDir : config.imagesDir;
  const finalPath = path.join(dir, `${beat.id}${ext}`);
  await ensureDir(dir);

  const queries = [beat.searchQuery];
  const allQueries = [...new Set(queries.filter(Boolean))];
  let bestRejected: { candidate: any; score: number; reason: string } | null = null;
  let queriesBailed = 0;
  let translatedUsed = false;

  for (const query of allQueries) {
    if (signal?.aborted) break;
    if (queriesBailed >= 3) break;

    onBeatStatus?.(beat.id, "searching");
    await logger.log(`${beat.id}: searching "${query}"...`);

    let candidates: any[];
    if (isClip) {
      candidates = await searchAllVideoCandidates(query, config.pexelsApiKey, config.pixabayApiKey);
    } else {
      candidates = await searchAllImageCandidates(query, config.pexelsApiKey, config.pixabayApiKey);
    }

    if (candidates.length === 0 && !translatedUsed && query) {
      await logger.log(`${beat.id}: no results for "${query}" — translating query...`);
      const translated = await translateQuery(query, config, logger);
      if (translated.length > 0) {
        translatedUsed = true;
        for (const alt of translated) {
          if (signal?.aborted) break;
          await logger.log(`${beat.id}: retrying with "${alt}"...`);
          if (isClip) {
            candidates = await searchAllVideoCandidates(alt, config.pexelsApiKey, config.pixabayApiKey);
          } else {
            candidates = await searchAllImageCandidates(alt, config.pexelsApiKey, config.pixabayApiKey);
          }
          if (candidates.length > 0) {
            await logger.log(`${beat.id}: found ${candidates.length} candidates for "${alt}"`);
            break;
          }
          await logger.log(`${beat.id}: no results for "${alt}" either`);
        }
      }
    }

    if (candidates.length === 0) {
      await logger.log(`${beat.id}: no results for "${query}"`);
      queriesBailed++;
      continue;
    }

    await logger.log(`${beat.id}: found ${candidates.length} candidates for "${query}"`);
    let checked = 0;
    let consecutiveLow = 0;

    for (const candidate of candidates) {
      if (signal?.aborted) break;
      if (checked >= config.maxThumbnailsPerQuery) break;
      if (!candidate.thumbnailUrl) continue;

      const thumbPath = path.join(os.tmpdir(), `thumb_${beat.id}_${Date.now()}.jpg`);
      try {
        await downloadCandidate(candidate.thumbnailUrl, thumbPath, undefined, 30_000, signal);

        onBeatStatus?.(beat.id, "checking");
        const thumbResult = await checkThumbnail(beat.searchQuery, thumbPath, config, logger);

        if (thumbResult.accepted) {
          await logger.log(`${beat.id}: thumbnail accepted (score ${thumbResult.score}) — downloading full ${kind}`);

          onBeatStatus?.(beat.id, "downloading", 0);
          const onProgress = (pct: number, dl: string, total: string) => {
            onBeatStatus?.(beat.id, "downloading", pct);
            logger.log(`${beat.id}: downloading ${pct}% (${dl}/${total})`).catch(() => {});
          };
          await downloadCandidate(candidate.url, finalPath, onProgress, config.downloadTimeout, signal);
          await deleteFile(thumbPath);
          onBeatStatus?.(beat.id, "done");

          if (isClip) {
            const probe = await probeVideo(finalPath);
            const stat = await fs.stat(finalPath).catch(() => null);
            const sizeStr = stat ? fmtSize(stat.size) : "";
            if (!stat || stat.size < 10000) {
              await deleteFile(finalPath).catch(() => {});
              throw new Error(`Downloaded file too small (${stat?.size ?? 0} bytes) - likely corrupt`);
            }
            if (probe.duration <= 0 || probe.width === 0 || probe.height === 0) {
              await deleteFile(finalPath).catch(() => {});
              throw new Error(`Downloaded video is corrupt (probe failed: ${probe.width}x${probe.height}, ${probe.duration}s)`);
            }
            await logger.log(`${beat.id}: done — ${probe.width}x${probe.height} from ${candidate.source}${sizeStr ? ` (${sizeStr})` : ""}`);
          } else {
            const stat = await fs.stat(finalPath).catch(() => null);
            const sizeStr = stat ? fmtSize(stat.size) : "";
            if (!stat || stat.size < 1000) {
              await deleteFile(finalPath).catch(() => {});
              throw new Error(`Downloaded image too small (${stat?.size ?? 0} bytes) - likely corrupt`);
            }
            await logger.log(`${beat.id}: done — ${candidate.width}x${candidate.height} from ${candidate.source}${sizeStr ? ` (${sizeStr})` : ""}`);
          }

          return { beatId: beat.id, assetPath: finalPath, success: true };
        }

        if (!bestRejected || thumbResult.score > bestRejected.score) {
          bestRejected = { candidate, score: thumbResult.score, reason: thumbResult.reason };
        }
        await logger.log(`${beat.id}: thumbnail rejected (score ${thumbResult.score}: ${thumbResult.reason})`);

        if (thumbResult.score <= 2) {
          consecutiveLow++;
          if (consecutiveLow >= 3) {
            await logger.log(`${beat.id}: bailing out of "${query}" after ${consecutiveLow} low scores`);
            break;
          }
        } else {
          consecutiveLow = 0;
        }
        checked++;
      } catch (err: any) {
        await logger.log(`${beat.id}: thumbnail check error: ${err.message}`);
      } finally {
        await deleteFile(thumbPath).catch(() => {});
      }
    }

    if (checked === 0 || consecutiveLow >= 3) queriesBailed++;
  }

  if (bestRejected) {
    await logger.log(`${beat.id}: using best rejected candidate (score ${bestRejected.score})`);
    try {
      onBeatStatus?.(beat.id, "downloading", 0);
      const onProgress = (pct: number, dl: string, total: string) => {
        onBeatStatus?.(beat.id, "downloading", pct);
        logger.log(`${beat.id}: downloading ${pct}% (${dl}/${total})`).catch(() => {});
      };
      await downloadCandidate(bestRejected.candidate.url, finalPath, onProgress, config.downloadTimeout, signal);

      if (isClip) {
        const probe = await probeVideo(finalPath);
        const stat = await fs.stat(finalPath).catch(() => null);
        if (!stat || stat.size < 10000) {
          await deleteFile(finalPath).catch(() => {});
          throw new Error(`Downloaded file too small (${stat?.size ?? 0} bytes) - likely corrupt`);
        }
        if (probe.duration <= 0 || probe.width === 0 || probe.height === 0) {
          await deleteFile(finalPath).catch(() => {});
          throw new Error(`Downloaded video is corrupt (probe failed: ${probe.width}x${probe.height}, ${probe.duration}s)`);
        }
        await logger.log(`${beat.id}: downloaded best-rejected — ${probe.width}x${probe.height}`);
      } else {
        const stat = await fs.stat(finalPath).catch(() => null);
        if (!stat || stat.size < 1000) {
          await deleteFile(finalPath).catch(() => {});
          throw new Error(`Downloaded image too small (${stat?.size ?? 0} bytes) - likely corrupt`);
        }
        await logger.log(`${beat.id}: downloaded best-rejected — ${bestRejected.candidate.width}x${bestRejected.candidate.height}`);
      }

      onBeatStatus?.(beat.id, "done");
      return { beatId: beat.id, assetPath: finalPath, success: true };
    } catch (err: any) {
      await deleteFile(finalPath).catch(() => {});
      onBeatStatus?.(beat.id, "failed");
      return { beatId: beat.id, assetPath: "", success: false, reason: err.message };
    }
  }

  onBeatStatus?.(beat.id, "failed");
  return { beatId: beat.id, assetPath: "", success: false, reason: "No candidates found for any query variant" };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
