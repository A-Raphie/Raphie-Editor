import type { Beat } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { Logger } from "../utils/logger.js";
import { sourceAllAssets } from "./assetSourcer.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const QUERY_MODIFIERS = [
  "close-up",
  "macro shot",
  "aerial view",
  "detail",
  "wide angle",
  "slow motion",
  "top view",
  "side angle",
  "cinematic",
  "shallow depth of field",
  "silhouette",
  "backlit",
];

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const ext = path.extname(filePath).toLowerCase();
    const isVideo = [".mp4", ".webm", ".mov"].includes(ext);
    const stream = fs.createReadStream(
      filePath,
      isVideo ? { start: 0, end: 1024 * 1024 - 1 } : {}
    );
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function detectDuplicateAssets(
  assets: Record<string, string>,
  logger?: Logger
): Promise<string[][]> {
  const entries = Object.entries(assets).filter(([_, p]) => p && fs.existsSync(p));
  if (entries.length < 2) return [];

  const hashMap = new Map<string, string[]>();
  for (const [beatId, assetPath] of entries) {
    try {
      const hash = await hashFile(assetPath);
      const group = hashMap.get(hash) || [];
      group.push(beatId);
      hashMap.set(hash, group);
    } catch {}
  }

  const duplicates: string[][] = [];
  for (const [hash, beatIds] of hashMap) {
    if (beatIds.length > 1) {
      duplicates.push(beatIds);
      if (logger) await logger.log(`Duplicate detected: ${beatIds.join(", ")} (hash: ${hash.substring(0, 12)}...)`);
    }
  }
  return duplicates;
}

export async function dedupAndRedownload(
  beats: Beat[],
  assets: Record<string, string>,
  config: Config,
  logger: Logger,
  onBeatProgress: (beatId: string, progress: number) => void,
  onAssetComplete: (beatId: string, assetPath: string) => void,
  signal: AbortSignal,
  onBeatStatus: (beatId: string, status: string) => void,
  maxRounds: number = 2
): Promise<{ assets: Record<string, string>; failed: Record<string, { reason: string }>; dedupCount: number }> {
  let currentAssets = { ...assets };
  let currentBeats = beats;
  const failed: Record<string, { reason: string }> = {};
  let totalDeduped = 0;

  for (let round = 0; round < maxRounds; round++) {
    const duplicates = await detectDuplicateAssets(currentAssets, logger);
    if (duplicates.length === 0) break;

    const beatsToRedownload: Beat[] = [];
    const modifierIndex = round * 3;

    for (const group of duplicates) {
      for (let i = 1; i < group.length; i++) {
        const beatId = group[i];
        const originalBeat = currentBeats.find((b) => b.id === beatId);
        if (!originalBeat) continue;

        const modifier = QUERY_MODIFIERS[(modifierIndex + i - 1) % QUERY_MODIFIERS.length];
        const newQuery = `${originalBeat.searchQuery} ${modifier}`;

        beatsToRedownload.push({
          ...originalBeat,
          searchQuery: newQuery,
        });

        const oldPath = currentAssets[beatId];
        if (oldPath) {
          try { fs.unlinkSync(oldPath); } catch {}
        }
        delete currentAssets[beatId];

        if (logger) await logger.log(`Dedup round ${round + 1}: re-downloading beat ${beatId} with modified query "${newQuery}"`);
      }
      totalDeduped += group.length - 1;
    }

    if (beatsToRedownload.length === 0) break;

    const result = await sourceAllAssets(
      beatsToRedownload, config, logger, currentAssets,
      onBeatProgress, onAssetComplete, signal, onBeatStatus
    );
    currentAssets = { ...currentAssets, ...result.assets };
    for (const [beatId, info] of Object.entries(result.failed)) {
      (failed as any)[beatId] = info;
    }
  }

  const finalDuplicates = await detectDuplicateAssets(currentAssets, logger);
  if (finalDuplicates.length > 0 && logger) {
    await logger.log(`Warning: ${finalDuplicates.length} duplicate group(s) remain after ${maxRounds} dedup rounds`);
  }

  return { assets: currentAssets, failed, dedupCount: totalDeduped };
}
