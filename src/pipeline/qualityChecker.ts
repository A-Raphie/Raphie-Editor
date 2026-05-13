import type { Beat, AssetMapping } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { Logger } from "../utils/logger.js";
import { createOpenRouterClient, chatWithImages } from "../utils/llm.js";
import { fileToBase64, getMimeType, deleteFile } from "../utils/fileManager.js";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

async function extractFrame(videoPath: string, config: Config): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `qc_frame_${Date.now()}.jpg`);
  await execFileAsync(config.ffmpegPath, [
    "-i", videoPath,
    "-ss", "0.5",
    "-frames:v", "1",
    "-q:v", "2",
    "-y",
    tmpFile,
  ]);
  return tmpFile;
}

function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".mp4", ".webm", ".mkv", ".avi", ".mov"].includes(ext);
}

const QUALITY_PROMPT = `You are a visual quality checker. You receive a search query and an image. Your ONLY job is to determine if the image visually matches the search query.

RULES:
- ACCEPT if the image shows what the search query describes
- REJECT only if: completely unrelated to the query, blurry/pixelated, text/logos/screens as main content
- The search query is the SOLE authority on what is acceptable
- Do NOT reject based on subject matter bias, niche requirements, or missing elements not in the query
- A query like "herbal tea pouring" should ACCEPT: tea being poured, herbs in liquid, steaming cup with herbs
- A query like "barley field" should ACCEPT: a field of barley grain
- A query like "cumin seeds" should ACCEPT: cumin seeds in any context

SCORING:
- 9-10: Perfect match, high quality
- 7-8: Clearly matches query
- 5-6: Acceptable match
- 1-4: Wrong content or very poor quality

Respond with ONLY valid JSON:
{"accept": true/false, "reason": "explanation", "score": 1-10, "is_relevant": true/false, "is_blurry": true/false}

Accept if score >= 5 AND is_relevant is true.`;

export interface QualityResult {
  beatId: string;
  accepted: boolean;
  score: number;
  reason: string;
}

export async function qualityCheckAssets(
  beats: Beat[],
  assets: AssetMapping,
  config: Config,
  logger: Logger
): Promise<{ accepted: AssetMapping; rejected: string[] }> {
  const client = createOpenRouterClient(config.openrouterApiKeys[0]);
  const accepted: AssetMapping = {};
  const rejected: string[] = [];

  const checkableBeats = beats.filter(
    (b) => (b.type === "clip" || b.type === "image") && assets[b.id]
  );

  await logger.log(`Quality checking ${checkableBeats.length} assets...`);

  for (let i = 0; i < checkableBeats.length; i += 5) {
    const batch = checkableBeats.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((beat) => qualityCheckSingle(beat, assets[beat.id], config, client, logger))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const beat = batch[j];

      if (result.status === "fulfilled" && result.value.accepted) {
        accepted[beat.id] = assets[beat.id];
      } else {
        rejected.push(beat.id);
        await deleteFile(assets[beat.id]);
        const reason =
          result.status === "rejected"
            ? result.reason?.message
            : result.value?.reason;
        await logger.log(`Rejected ${beat.id}: ${reason}`);
      }
    }

    if (i + 5 < checkableBeats.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  await logger.log(
    `Quality check complete: ${Object.keys(accepted).length} accepted, ${rejected.length} rejected`
  );

  return { accepted, rejected };
}

async function qualityCheckSingle(
  beat: Beat,
  assetPath: string,
  config: Config,
  client: any,
  logger: Logger
): Promise<QualityResult> {
  let framePath: string | undefined;
  let checkPath = assetPath;

  try {
    if (isVideoFile(assetPath)) {
      framePath = await extractFrame(assetPath, config);
      checkPath = framePath;
    }

    const base64 = await fileToBase64(checkPath);
    const mimeType = await getMimeType(checkPath);

    const prompt = `Check this ${beat.type} for the context: "${beat.searchQuery}"`;
    const qualityPrompt = config.qualityCheckPrompt || QUALITY_PROMPT;

    const response = await chatWithImages(
      client,
      config.qualityCheckerModel,
      qualityPrompt,
      prompt,
      [{ base64, mimeType }],
      5,
      (attempt, max, err) => {
        logger.log(`Quality check ${beat.id} retry (${attempt}/${max}): ${err}`);
      }
    );

    const parsed = JSON.parse(response);

    const isBlurry = parsed.is_blurry === true;
    const isRelevant = parsed.is_relevant === true;
    const score = parsed.score ?? 0;

    const accepted = parsed.accept === true && score >= config.qualityScoreThreshold && !isBlurry && isRelevant;

    return {
      beatId: beat.id,
      accepted,
      score,
      reason: parsed.reason ?? "No reason given",
    };
  } catch (err: any) {
    const msg = err.message || "";
    if (msg.includes("400") || msg.includes("Provider returned error")) {
      await logger.log(`Quality check ${beat.id}: provider error, rejecting asset`);
      return {
        beatId: beat.id,
        accepted: false,
        score: 0,
        reason: "Rejected (quality check failed due to provider error)",
      };
    }
    return {
      beatId: beat.id,
      accepted: false,
      score: 0,
      reason: `Quality check error: ${msg}`,
    };
  } finally {
    if (framePath) {
      await deleteFile(framePath).catch(() => {});
    }
  }
}

export async function checkThumbnail(
  searchQuery: string,
  thumbnailPath: string,
  config: Config,
  logger: Logger
): Promise<{ accepted: boolean; score: number; reason: string }> {
  const client = createOpenRouterClient(config.openrouterApiKeys[0]);
  try {
    const base64 = await fileToBase64(thumbnailPath);
    const mimeType = await getMimeType(thumbnailPath);
    const prompt = `Check this thumbnail for the context: "${searchQuery}"`;
    const qualityPrompt = config.qualityCheckPrompt || QUALITY_PROMPT;

    const response = await chatWithImages(
      client,
      config.qualityCheckerModel,
      qualityPrompt,
      prompt,
      [{ base64, mimeType }],
      3,
      (attempt, max, err) => {
        logger.log(`Thumbnail check retry (${attempt}/${max}): ${err}`);
      }
    );

    const parsed = JSON.parse(response);
    const isBlurry = parsed.is_blurry === true;
    const isRelevant = parsed.is_relevant === true;
    const score = parsed.score ?? 0;

    return {
      accepted: parsed.accept === true && score >= config.qualityScoreThreshold && !isBlurry && isRelevant,
      score,
      reason: parsed.reason ?? "No reason given",
    };
  } catch (err: any) {
    return {
      accepted: false,
      score: 0,
      reason: `Thumbnail check error: ${err.message}`,
    };
  }
}
