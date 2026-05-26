import type { ScenePlan, Beat } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { createOpenRouterClient, createClientPool, chatCompletion } from "../utils/llm.js";
import { Logger } from "../utils/logger.js";
import type { SrtSegment } from "../utils/srtParser.js";
import { parseSrt, srtSegmentsToScriptText } from "../utils/srtParser.js";
import fs from "fs";

const COUNT_UP_PATTERN = /Number\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|\d+),\s*([^,\n]+)/gi;

function detectCountUpMode(script: string): boolean {
  const matches = script.match(COUNT_UP_PATTERN);
  return (matches?.length ?? 0) >= 2;
}

export function buildSystemPrompt(
  clipPercent: number,
  imagePercent: number,
  hookDuration: number,
  hookClipMin: number,
  hookClipMax: number,
  bodyClipMin: number,
  bodyClipMax: number,
  extraRules: string,
  searchQueryRules: string,
  contentRules: string
): string {
  const rulesSection = extraRules ? `\n\nADDITIONAL RULES:\n${extraRules}` : "";
  return `You are a documentary scene planner. You receive a script and voiceover duration, and you break the script into visual beats.

CONTENT RULES:
${contentRules}

BEAT TYPE DISTRIBUTION (user-specified):
- Video clips: ~${clipPercent}% of beats
- Images: ~${imagePercent}% of beats
- ONLY "clip" and "image" beat types — no other types
- NO "overlay" property on beats — output ONLY: id, startTime, duration, type, searchQuery, imageAnimation

SUBSCRIBE OVERLAY RULE:
- If the script contains the word "subscribe", identify which beat overlaps with where "subscribe" is mentioned
- Add this to that beat: "overlay": {"type": "subscribe_cta", "showAt": 0, "hideAt": 1.0}
- Example: if "subscribe" appears 30 seconds into a 60-second video, and there's a beat from 25-35 seconds, add the overlay to that beat
- This is REQUIRED when "subscribe" is in the script — do not skip it

CLIP RULES:
- Play at normal speed (no clipSpeed or clipEffect properties)
- Hook section (first ${hookDuration} seconds): ALL clips are EXACTLY ${hookClipMin}-${hookClipMax} seconds. NO ${hookClipMax + 1}-second clips in the hook. Fast-paced editing.
- Body (after the first ${hookDuration} seconds): use ${bodyClipMin}-${bodyClipMax} second clips

IMAGE RULES:
- Every image MUST have an imageAnimation: "zoom_in", "zoom_out", "pan_lr", "pan_rl", "pan_tb", "pan_bt", or "drift"
- Never show a static image
- Alternate animations for variety

TRANSITIONS:
- All transitions are hard cuts (no fade, dissolve, or effect transitions)
- Do NOT output transitionIn or transitionDuration fields

SEARCH QUERY RULES:
${searchQueryRules}

OUTPUT FORMAT: JSON matching this structure:
{
  "title": "Video Title",
  "fps": 30,
  "totalDurationSeconds": <number>,
  "beats": [
    {
      "id": "beat_001",
      "startTime": <seconds>,
      "duration": <seconds>,
      "type": "clip" | "image",
      "searchQuery": "<search query>" (REQUIRED for clip and image types),
      "imageAnimation": "<animation>" (for image types)
    }
  ]
}

Ensure beats cover the ENTIRE script duration with no gaps.${rulesSection}`;
}

export async function planScenes(
  script: string,
  voDurationSeconds: number,
  config: Config,
  logger: Logger
): Promise<ScenePlan> {
  await logger.log("Generating scene plan...");

  if (detectCountUpMode(script)) {
    await logger.log("Detected count-up format — using section-locked rules");
  }

  const client = createOpenRouterClient(config.openrouterApiKeys[0]);
  const systemPrompt = buildSystemPrompt(
    config.clipPercent, config.imagePercent,
    config.hookDuration, config.hookClipMin, config.hookClipMax,
    config.bodyClipMin, config.bodyClipMax,
    config.scenePlannerRules, config.searchQueryRules, config.contentRules
  );

  const userPrompt = `Script:
${script}

Voiceover duration: ${voDurationSeconds} seconds
Target video length: ${voDurationSeconds} seconds
FPS: ${config.fps}

Generate a complete scene plan as JSON.`;

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    const raw = await chatCompletion(
      client,
      config.scenePlannerModel,
      systemPrompt,
      userPrompt,
      8,
      (attempt, max, err) => {
        logger.log(`Connection error, retrying (${attempt}/${max}): ${err}`);
      }
    );

    try {
      const plan = JSON.parse(raw) as ScenePlan;
      validateScenePlan(plan, config.forbiddenWords, config.genericFallbacks);
      if (config.vfxPath) {
        addSubscribeOverlays(plan, script);
      }
      scaleToAudioDuration(plan, voDurationSeconds, logger);
      await enforceHookDurations(plan, config.hookDuration, config.hookClipMin, config.hookClipMax, logger);
      await enforceBodyDurations(plan, config.hookDuration, config.bodyClipMin, config.bodyClipMax, logger);
      enforceBeatDistribution(plan, config.clipPercent, config.imagePercent, config.hookDuration, logger);
      stretchToAudioDuration(plan, voDurationSeconds, logger);
      await logger.log(
        `Scene plan generated: ${plan.beats.length} beats (${countByType(plan, "clip")} clips, ${countByType(plan, "image")} images, ${countWithOverlay(plan)} with overlays)`
      );
      return plan;
    } catch (err: any) {
      await logger.warn(`Invalid scene plan (attempt ${attempts}/${maxAttempts}): ${err.message}`);
      if (attempts >= maxAttempts) throw err;
    }
  }

  throw new Error("Failed to generate valid scene plan");
}

export function buildSrtSystemPrompt(
  clipPercent: number,
  imagePercent: number,
  hookDuration: number,
  hookClipMin: number,
  hookClipMax: number,
  bodyClipMin: number,
  bodyClipMax: number,
  extraRules: string,
  searchQueryRules: string,
  contentRules: string
): string {
  const rulesSection = extraRules ? `\n\nADDITIONAL RULES:\n${extraRules}` : "";
  return `You are a documentary scene planner. You receive SRT subtitle segments with EXACT timestamps and voiceover duration, and you create visual beats that are STRICTLY LOCKED to each segment's time range.

CONTENT RULES:
${contentRules}

BEAT TYPE DISTRIBUTION (user-specified):
- Video clips: ~${clipPercent}% of beats
- Images: ~${imagePercent}% of beats
- ONLY "clip" and "image" beat types — no other types
- NO "overlay" property on beats — output ONLY: id, startTime, duration, type, searchQuery, imageAnimation

SUBSCRIBE OVERLAY RULE:
- If any SRT segment text contains the word "subscribe", identify which beat overlaps with where "subscribe" is mentioned
- Add this to that beat: "overlay": {"type": "subscribe_cta", "showAt": 0, "hideAt": 1.0}
- This is REQUIRED when "subscribe" is in any segment — do not skip it

CRITICAL SRT SEGMENT LOCKING RULES:
- You receive a list of SRT segments, each with startTime, endTime, and text
- For EACH segment, generate one or more beats whose combined time EXACTLY covers [startTime, endTime]
- The sum of beat durations within a segment MUST equal the segment's duration (endTime - startTime)
- Do NOT create beats that cross segment boundaries
- Do NOT leave gaps between segments
- The first beat's startTime MUST equal the first segment's startTime (usually 0)
- The last beat's endTime MUST equal the last segment's endTime (which equals totalDurationSeconds)

CLIP RULES:
- Play at normal speed (no clipSpeed or clipEffect properties)
- Hook section (first ${hookDuration} seconds): ALL clips are EXACTLY ${hookClipMin}-${hookClipMax} seconds. NO ${hookClipMax + 1}-second clips in the hook. Fast-paced editing.
- Body (after the first ${hookDuration} seconds): use ${bodyClipMin}-${bodyClipMax} second clips

IMAGE RULES:
- Every image MUST have an imageAnimation: "zoom_in", "zoom_out", "pan_lr", "pan_rl", "pan_tb", "pan_bt", or "drift"
- Never show a static image
- Alternate animations for variety

TRANSITIONS:
- All transitions are hard cuts (no fade, dissolve, or effect transitions)
- Do NOT output transitionIn or transitionDuration fields

SEARCH QUERY RULES:
${searchQueryRules}

OUTPUT FORMAT: JSON matching this structure:
{
  "title": "Video Title",
  "fps": 30,
  "totalDurationSeconds": <number>,
  "beats": [
    {
      "id": "beat_001",
      "startTime": <seconds>,
      "duration": <seconds>,
      "type": "clip" | "image",
      "searchQuery": "<search query>" (REQUIRED for clip and image types),
      "imageAnimation": "<animation>" (for image types)
    }
  ]
}

Ensure beats cover the ENTIRE duration with no gaps and no overlaps.${rulesSection}`;
}


export async function planScenesFromSrt(
  srtPath: string,
  voDurationSeconds: number,
  config: Config,
  logger: Logger
): Promise<ScenePlan> {
  await logger.log("Generating scene plan from SRT subtitles...");

  const srtContent = fs.readFileSync(srtPath, "utf-8");
  const segments = parseSrt(srtContent);
  if (segments.length === 0) {
    throw new Error("SRT file contains no valid segments");
  }

  await logger.log(`SRT: ${segments.length} segments, covering ${segments[0].startTime.toFixed(1)}s to ${segments[segments.length - 1].endTime.toFixed(1)}s`);

  const chunkSize = config.srtChunkSize ?? 25;
  if (segments.length > chunkSize) {
    await logger.log(`Large SRT detected (${segments.length} segments) — using chunked planning (${chunkSize} segments per chunk)`);
    return planScenesFromSrtChunked(segments, voDurationSeconds, config, logger);
  }

  const scriptText = srtSegmentsToScriptText(segments);
  const isCountUp = detectCountUpMode(scriptText);
  if (isCountUp) {
    await logger.log("Detected count-up format — using section-locked rules");
  }

  const client = createOpenRouterClient(config.openrouterApiKeys[0]);
  const systemPrompt = buildSrtSystemPrompt(
    config.clipPercent, config.imagePercent,
    config.hookDuration, config.hookClipMin, config.hookClipMax,
    config.bodyClipMin, config.bodyClipMax,
    config.scenePlannerRules, config.searchQueryRules, config.contentRules
  );

  const segmentLines = segments
    .map((s, i) => `SEGMENT ${i + 1} [${s.startTime.toFixed(2)}s → ${s.endTime.toFixed(2)}s]: ${s.text}`)
    .join("\n");

  const userPrompt = `SRT Segments:
${segmentLines}

Voiceover duration: ${voDurationSeconds} seconds
Target video length: ${voDurationSeconds} seconds
FPS: ${config.fps}

Generate a complete scene plan as JSON. Each segment's time range MUST be fully covered by beats. Do NOT leave gaps.`;

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    const raw = await chatCompletion(
      client,
      config.scenePlannerModel,
      systemPrompt,
      userPrompt,
      8,
      (attempt, max, err) => {
        logger.log(`Connection error, retrying (${attempt}/${max}): ${err}`);
      }
    );

    try {
      const plan = JSON.parse(raw) as ScenePlan;
      validateScenePlan(plan, config.forbiddenWords, config.genericFallbacks);
      if (config.vfxPath) {
        addSubscribeOverlays(plan, scriptText);
      }
      scaleToAudioDuration(plan, voDurationSeconds, logger);
      await enforceHookDurations(plan, config.hookDuration, config.hookClipMin, config.hookClipMax, logger);
      await enforceBodyDurations(plan, config.hookDuration, config.bodyClipMin, config.bodyClipMax, logger);
      enforceBeatDistribution(plan, config.clipPercent, config.imagePercent, config.hookDuration, logger);
      stretchToAudioDuration(plan, voDurationSeconds, logger);
      await logger.log(
        `Scene plan generated: ${plan.beats.length} beats (${countByType(plan, "clip")} clips, ${countByType(plan, "image")} images, ${countWithOverlay(plan)} with overlays)`
      );
      return plan;
    } catch (err: any) {
      await logger.warn(`Invalid scene plan (attempt ${attempts}/${maxAttempts}): ${err.message}`);
      if (attempts >= maxAttempts) throw err;
    }
  }

  throw new Error("Failed to generate valid scene plan from SRT");
}

async function planScenesFromSrtChunked(
  segments: SrtSegment[],
  voDurationSeconds: number,
  config: Config,
  logger: Logger
): Promise<ScenePlan> {
  const clientPool = createClientPool(config.openrouterApiKeys);
  const systemPrompt = buildSrtSystemPrompt(
    config.clipPercent, config.imagePercent,
    config.hookDuration, config.hookClipMin, config.hookClipMax,
    config.bodyClipMin, config.bodyClipMax,
    config.scenePlannerRules, config.searchQueryRules, config.contentRules
  );

  const isFreeModel = config.scenePlannerModel.includes("owl") || config.scenePlannerModel.includes("free");
  const chunkSize = config.srtChunkSize ?? 25;
  const chunkConcurrency = isFreeModel
    ? Math.min(clientPool.length * 2, 4)
    : clientPool.length * 2;
  const chunkDelayMs = isFreeModel ? (config.srtChunkDelayMs ?? 0) : 0;

  const chunks: SrtSegment[][] = [];
  for (let i = 0; i < segments.length; i += chunkSize) {
    chunks.push(segments.slice(i, i + chunkSize));
  }

  if (isFreeModel) {
    await logger.log(`Planning ${chunks.length} chunks (${chunkSize} segments per chunk, ${chunkConcurrency} concurrent across ${clientPool.length} key(s), ${chunkDelayMs}ms delay)...`);
  } else {
    await logger.log(`Planning ${chunks.length} chunks (${chunkSize} segments per chunk, ${chunkConcurrency} concurrent)...`);
  }

  let fundedKeyIdx: number | null = null;

  const chunkPlans: ScenePlan[] = [];
  for (let batchStart = 0; batchStart < chunks.length; batchStart += chunkConcurrency) {
    const batch = chunks.slice(batchStart, batchStart + chunkConcurrency);
    const results = await Promise.allSettled(
      batch.map(async (chunk, batchIdx) => {
        if (isFreeModel && batchIdx > 0) await new Promise(r => setTimeout(r, 500));
        const chunkIdx = batchStart + batchIdx;
        const globalOffset = chunk[0].startTime;
        const chunkEnd = chunk[chunk.length - 1].endTime;

        if (isFreeModel) {
          await logger.log(`Chunk ${chunkIdx + 1}/${chunks.length}: segments ${globalOffset.toFixed(1)}s → ${chunkEnd.toFixed(1)}s (key ${(chunkIdx % clientPool.length) + 1}/${clientPool.length})`);
        } else {
          await logger.log(`Chunk ${chunkIdx + 1}/${chunks.length}: segments ${globalOffset.toFixed(1)}s → ${chunkEnd.toFixed(1)}s`);
        }

        const segmentLines = chunk
          .map((s, i) => `SEGMENT ${i + 1} [${s.startTime.toFixed(2)}s → ${s.endTime.toFixed(2)}s]: ${s.text}`)
          .join("\n");

        const userPrompt = `SRT Segments (part of a ${voDurationSeconds.toFixed(1)}s video):
${segmentLines}

Chunk time range: ${globalOffset.toFixed(1)}s to ${chunkEnd.toFixed(1)}s
Voiceover duration for this chunk: ${(chunkEnd - globalOffset).toFixed(1)} seconds
FPS: ${config.fps}

Generate a complete scene plan as JSON for these segments only. Beats MUST cover [${globalOffset.toFixed(2)}s, ${chunkEnd.toFixed(2)}s] with no gaps.`;

        const ccRetries = isFreeModel ? 2 : Math.max(8, clientPool.length + 2);
        const maxAttempts = isFreeModel ? clientPool.length * 2 : Math.max(3, clientPool.length + 2);
        let attempts = 0;
        while (attempts < maxAttempts) {
          attempts++;
          let retryClient: import("openai").default;
          if (!isFreeModel && fundedKeyIdx !== null) {
            retryClient = clientPool[fundedKeyIdx];
          } else {
            retryClient = clientPool[(chunkIdx + attempts - 1) % clientPool.length];
          }
          const keyIdx = (chunkIdx + attempts - 1) % clientPool.length;
          try {
            const raw = await chatCompletion(retryClient, config.scenePlannerModel, systemPrompt, userPrompt, ccRetries,
              (a, m, err) => logger.log(`Chunk ${chunkIdx + 1} retry (${a}/${m}): ${err}`)
            );
            const plan = JSON.parse(raw) as ScenePlan;
            plan.totalDurationSeconds = chunkEnd - globalOffset;
            plan.beats = plan.beats.filter(b => b.duration > 0);
            for (const b of plan.beats) {
              if (!b.id) b.id = `chunk${chunkIdx}_beat_${plan.beats.indexOf(b) + 1}`;
            }
            validateScenePlan(plan, config.forbiddenWords, config.genericFallbacks);
            if (!isFreeModel && fundedKeyIdx === null) fundedKeyIdx = keyIdx;
            return plan;
          } catch (err: any) {
            const is402 = err?.status === 402 || err?.status === 403 || (err?.message || "").includes("402") || (err?.message || "").includes("403");
            if (!isFreeModel && is402) {
              await logger.log(`Chunk ${chunkIdx + 1}: key ${keyIdx + 1} unfunded, trying next...`);
            } else {
              await logger.warn(`Chunk ${chunkIdx + 1} invalid (attempt ${attempts}/${maxAttempts}): ${err.message}`);
            }
            if (attempts >= maxAttempts) {
              await logger.warn(`Chunk ${chunkIdx + 1} failed — generating fallback beats`);
              return generateFallbackChunkPlan(chunk, chunkIdx);
            }
          }
        }
        return generateFallbackChunkPlan(chunk, chunkIdx);
      })
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        chunkPlans.push(r.value);
      } else {
        const chunkIdx = batchStart + i;
        await logger.warn(`Chunk ${chunkIdx + 1} failed completely — using fallback`);
        chunkPlans.push(generateFallbackChunkPlan(chunks[chunkIdx], chunkIdx));
      }
    }

    if (chunkDelayMs > 0 && batchStart + chunkConcurrency < chunks.length) {
      await new Promise(r => setTimeout(r, chunkDelayMs));
    }
  }
  const allBeats: Beat[] = [];
  for (let i = 0; i < chunkPlans.length; i++) {
    const chunk = chunks[i];
    const globalOffset = chunk[0].startTime;
    for (const beat of chunkPlans[i].beats) {
      beat.startTime = beat.startTime + globalOffset;
      allBeats.push(beat);
    }
  }

  const totalDuration = segments[segments.length - 1].endTime;
  const plan: ScenePlan = {
    title: chunkPlans[0]?.title || "Untitled",
    fps: config.fps,
    totalDurationSeconds: totalDuration,
    beats: allBeats,
  };

  const scriptText = srtSegmentsToScriptText(segments);
  if (config.vfxPath) {
    addSubscribeOverlays(plan, scriptText);
  }
  scaleToAudioDuration(plan, voDurationSeconds, logger);
  await enforceHookDurations(plan, config.hookDuration, config.hookClipMin, config.hookClipMax, logger);
  await enforceBodyDurations(plan, config.hookDuration, config.bodyClipMin, config.bodyClipMax, logger);
  enforceBeatDistribution(plan, config.clipPercent, config.imagePercent, config.hookDuration, logger);
  stretchToAudioDuration(plan, voDurationSeconds, logger);

  await logger.log(
    `Chunked plan complete: ${plan.beats.length} beats (${countByType(plan, "clip")} clips, ${countByType(plan, "image")} images, ${countWithOverlay(plan)} with overlays) from ${chunks.length} chunks`
  );
  return plan;
}

function generateFallbackChunkPlan(chunk: SrtSegment[], chunkIdx: number): ScenePlan {
  const beats: Beat[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const s = chunk[i];
    beats.push({
      id: `chunk${chunkIdx}_fallback_${i + 1}`,
      startTime: s.startTime,
      duration: s.endTime - s.startTime,
      type: "clip",
      searchQuery: `documentary footage ${s.text.split(" ").slice(0, 3).join(" ")}`,
    });
  }
  return {
    title: "Untitled",
    fps: 30,
    totalDurationSeconds: chunk[chunk.length - 1].endTime - chunk[0].startTime,
    beats,
  };
}

function countByType(plan: ScenePlan, type: string): number {
  return plan.beats.filter(b => b.type === type).length;
}

function countWithOverlay(plan: ScenePlan): number {
	return plan.beats.filter(b => b.overlay).length;
}

function scaleToAudioDuration(plan: ScenePlan, voDurationSeconds: number, logger: { log: (msg: string) => Promise<void> }): void {
	if (!voDurationSeconds || plan.totalDurationSeconds === voDurationSeconds) return;
	const diff = voDurationSeconds - plan.totalDurationSeconds;
	if (Math.abs(diff) < 0.5) {
		plan.beats[plan.beats.length - 1].duration += diff;
	} else {
		const scale = voDurationSeconds / plan.totalDurationSeconds;
		for (const beat of plan.beats) {
			beat.duration = beat.duration * scale;
		}
	}
	let t = 0;
	for (const beat of plan.beats) {
		beat.startTime = t;
		t += beat.duration;
	}
	plan.totalDurationSeconds = voDurationSeconds;
	logger.log(`Scaled plan to audio duration: ${voDurationSeconds.toFixed(1)}s (adjusted ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}s)`);
}

const IMAGE_ANIMATIONS: import("../types/scenePlan.js").ImageAnimation[] = [
  "zoom_in",
  "zoom_out",
  "pan_lr",
  "pan_rl",
  "pan_tb",
  "pan_bt",
  "drift",
  "zoom_in_tl",
  "zoom_in_tr",
  "zoom_in_bl",
  "zoom_in_br",
  "zoom_out_tl",
  "zoom_out_tr",
  "zoom_out_bl",
  "zoom_out_br",
  "dramatic_in",
  "dramatic_out",
];

const SPLIT_MODIFIERS = [
  "",
  "close-up",
  "wide shot",
  "panning",
  "detail",
  "aerial view",
  "slow motion",
  "cinematic angle",
  "tracking shot",
  "low angle",
];

async function enforceHookDurations(
  plan: ScenePlan,
  hookDuration: number,
  hookClipMin: number,
  hookClipMax: number,
  logger: Logger
): Promise<void> {
  if (hookClipMin <= 0 || hookClipMax <= 0) return;

  const hookBeats: { index: number; beat: Beat }[] = [];
  for (let i = 0; i < plan.beats.length; i++) {
    const b = plan.beats[i];
    if (b.startTime < hookDuration && (b.type === "clip" || b.type === "image")) {
      hookBeats.push({ index: i, beat: b });
    }
  }

  if (hookBeats.length === 0) return;

  let splitCount = 0;
  let mergeCount = 0;
  const indicesToRemove = new Set<number>();
  const replacements: { index: number; beats: Beat[] }[] = [];
  const targetAvg = (hookClipMin + hookClipMax) / 2;

  let buffer: Beat[] = [];
  let bufferDuration = 0;

  const resolveType = (beats: Beat[]): "image" | "clip" => {
    const images = beats.filter(b => b.type === "image").length;
    const clips = beats.length - images;
    return images >= clips ? "image" : "clip";
  };

  const flushBuffer = () => {
    if (buffer.length === 0) return;

    if (bufferDuration >= hookClipMin) {
      const numBeats = Math.max(1, Math.round(bufferDuration / targetAvg));
      const durPerBeat = bufferDuration / numBeats;
      const mergedType = resolveType(buffer);
      const merged: Beat[] = [];
      for (let s = 0; s < numBeats; s++) {
        const mod = SPLIT_MODIFIERS[s % SPLIT_MODIFIERS.length];
        const srcQuery = buffer[Math.min(s, buffer.length - 1)].searchQuery || "documentary footage";
        const query = s === 0 ? srcQuery : `${srcQuery} ${mod}`.trim();
        const b: Beat = {
          id: `merged_hook_${Date.now()}_${s}`,
          startTime: 0,
          duration: durPerBeat,
          type: mergedType,
          searchQuery: query,
        };
        if (mergedType === "image") {
          b.imageAnimation = IMAGE_ANIMATIONS[s % IMAGE_ANIMATIONS.length];
        }
        if (s === 0 && buffer[0].overlay) b.overlay = buffer[0].overlay;
        merged.push(b);
      }
      for (const b of buffer) indicesToRemove.add(plan.beats.indexOf(b));
      replacements.push({ index: plan.beats.indexOf(buffer[0]), beats: merged });
      mergeCount += buffer.length - numBeats;
    }
    buffer = [];
    bufferDuration = 0;
  };

  for (const { beat } of hookBeats) {
    if (beat.duration > hookClipMax) {
      flushBuffer();
      const numSplits = Math.ceil(beat.duration / hookClipMax);
      const splitDur = beat.duration / numSplits;
      const splitBeats: Beat[] = [];
      for (let s = 0; s < numSplits; s++) {
        const mod = SPLIT_MODIFIERS[s % SPLIT_MODIFIERS.length];
        const query = mod ? `${beat.searchQuery} ${mod}` : (beat.searchQuery || "");
        const splitBeat: Beat = {
          id: `${beat.id}_s${s + 1}`,
          startTime: 0,
          duration: splitDur,
          type: beat.type,
          searchQuery: query,
        };
        if (beat.type === "image") {
          splitBeat.imageAnimation = IMAGE_ANIMATIONS[s % IMAGE_ANIMATIONS.length];
        }
        if (s === 0 && beat.overlay) splitBeat.overlay = beat.overlay;
        splitBeats.push(splitBeat);
      }
      indicesToRemove.add(plan.beats.indexOf(beat));
      replacements.push({ index: plan.beats.indexOf(beat), beats: splitBeats });
      splitCount++;
    } else if (beat.duration < hookClipMin) {
      buffer.push(beat);
      bufferDuration += beat.duration;
      if (bufferDuration >= hookClipMin) {
        flushBuffer();
      }
    } else {
      flushBuffer();
    }
  }

  if (buffer.length > 0 && bufferDuration > 0) {
    const lastReplacement = replacements.length > 0 ? replacements[replacements.length - 1] : null;
    if (lastReplacement && lastReplacement.beats.length > 0) {
      const lastBeat = lastReplacement.beats[lastReplacement.beats.length - 1];
      const shortfall = hookClipMin - bufferDuration;
      if (shortfall > 0 && lastBeat.duration > shortfall + hookClipMin) {
        lastBeat.duration -= shortfall;
        bufferDuration = hookClipMin;
      }
    }
    const tailType = resolveType(buffer);
    const numBeats = Math.max(1, Math.round(bufferDuration / targetAvg));
    const durPerBeat = bufferDuration / numBeats;
    const merged: Beat[] = [];
    for (let s = 0; s < numBeats; s++) {
      const srcQuery = buffer[Math.min(s, buffer.length - 1)].searchQuery || "documentary footage";
      const mod = SPLIT_MODIFIERS[s % SPLIT_MODIFIERS.length];
      const query = s === 0 ? srcQuery : `${srcQuery} ${mod}`.trim();
      const b: Beat = {
        id: `merged_hook_tail_${s}`,
        startTime: 0,
        duration: durPerBeat,
        type: tailType,
        searchQuery: query,
      };
      if (tailType === "image") {
        b.imageAnimation = IMAGE_ANIMATIONS[s % IMAGE_ANIMATIONS.length];
      }
      merged.push(b);
    }
    for (const b of buffer) indicesToRemove.add(plan.beats.indexOf(b));
    replacements.push({ index: plan.beats.indexOf(buffer[0]), beats: merged });
    mergeCount += buffer.length;
  }

  if (replacements.length === 0) return;

  const newBeats: Beat[] = [];
  const replaceMap = new Map<number, Beat[]>();
  for (const r of replacements) replaceMap.set(r.index, r.beats);

  for (let i = 0; i < plan.beats.length; i++) {
    if (indicesToRemove.has(i)) {
      if (replaceMap.has(i)) {
        newBeats.push(...replaceMap.get(i)!);
      }
      continue;
    }
    if (!replaceMap.has(i)) {
      newBeats.push(plan.beats[i]);
    }
  }

  let t = 0;
  for (let i = 0; i < newBeats.length; i++) {
    newBeats[i].startTime = t;
    t += newBeats[i].duration;
  }

  plan.beats = newBeats;
  plan.totalDurationSeconds = t;
  for (let i = 0; i < plan.beats.length; i++) {
    plan.beats[i].id = `beat_${String(i + 1).padStart(3, "0")}`;
  }

  await logger.log(
    `Hook durations enforced: ${splitCount} split, ${mergeCount} merged (target: ${hookClipMin}-${hookClipMax}s)`
  );
}

async function enforceBodyDurations(
  plan: ScenePlan,
  hookDuration: number,
  bodyClipMin: number,
  bodyClipMax: number,
  logger: Logger
): Promise<void> {
  if (bodyClipMin <= 0 || bodyClipMax <= 0) return;

  const bodyBeats: { index: number; beat: Beat }[] = [];
  for (let i = 0; i < plan.beats.length; i++) {
    const b = plan.beats[i];
    if (b.startTime >= hookDuration && (b.type === "clip" || b.type === "image")) {
      bodyBeats.push({ index: i, beat: b });
    }
  }

  if (bodyBeats.length === 0) return;

  let splitCount = 0;
  let mergeCount = 0;
  const indicesToRemove = new Set<number>();
  const replacements: { index: number; beats: Beat[] }[] = [];
  const targetAvg = (bodyClipMin + bodyClipMax) / 2;

  let buffer: Beat[] = [];
  let bufferDuration = 0;

  const resolveType = (beats: Beat[]): "image" | "clip" => {
    const images = beats.filter(b => b.type === "image").length;
    const clips = beats.length - images;
    return images >= clips ? "image" : "clip";
  };

  const flushBuffer = () => {
    if (buffer.length === 0) return;

    if (bufferDuration >= bodyClipMin) {
      const numBeats = Math.max(1, Math.round(bufferDuration / targetAvg));
      const durPerBeat = bufferDuration / numBeats;
      const mergedType = resolveType(buffer);
      const merged: Beat[] = [];
      for (let s = 0; s < numBeats; s++) {
        const mod = SPLIT_MODIFIERS[s % SPLIT_MODIFIERS.length];
        const srcQuery = buffer[Math.min(s, buffer.length - 1)].searchQuery || "documentary footage";
        const query = s === 0 ? srcQuery : `${srcQuery} ${mod}`.trim();
        const b: Beat = {
          id: `merged_${Date.now()}_${s}`,
          startTime: 0,
          duration: durPerBeat,
          type: mergedType,
          searchQuery: query,
        };
        if (mergedType === "image") {
          b.imageAnimation = IMAGE_ANIMATIONS[s % IMAGE_ANIMATIONS.length];
        }
        if (s === 0 && buffer[0].overlay) b.overlay = buffer[0].overlay;
        merged.push(b);
      }
      for (const b of buffer) indicesToRemove.add(plan.beats.indexOf(b));
      replacements.push({ index: plan.beats.indexOf(buffer[0]), beats: merged });
      mergeCount += buffer.length - numBeats;
    }
    buffer = [];
    bufferDuration = 0;
  };

  for (const { beat } of bodyBeats) {
    if (beat.duration > bodyClipMax) {
      flushBuffer();
      const numSplits = Math.ceil(beat.duration / bodyClipMax);
      const splitDur = beat.duration / numSplits;
      const splitBeats: Beat[] = [];
      for (let s = 0; s < numSplits; s++) {
        const mod = SPLIT_MODIFIERS[s % SPLIT_MODIFIERS.length];
        const query = mod ? `${beat.searchQuery} ${mod}` : (beat.searchQuery || "");
        const splitBeat: Beat = {
          id: `${beat.id}_s${s + 1}`,
          startTime: 0,
          duration: splitDur,
          type: beat.type,
          searchQuery: query,
        };
        if (beat.type === "image") {
          splitBeat.imageAnimation = IMAGE_ANIMATIONS[s % IMAGE_ANIMATIONS.length];
        }
        if (s === 0 && beat.overlay) splitBeat.overlay = beat.overlay;
        splitBeats.push(splitBeat);
      }
      indicesToRemove.add(plan.beats.indexOf(beat));
      replacements.push({ index: plan.beats.indexOf(beat), beats: splitBeats });
      splitCount++;
    } else if (beat.duration < bodyClipMin) {
      buffer.push(beat);
      bufferDuration += beat.duration;
      if (bufferDuration >= bodyClipMin) {
        flushBuffer();
      }
    } else {
      flushBuffer();
    }
  }

  if (buffer.length > 0 && bufferDuration > 0) {
    const lastReplacement = replacements.length > 0 ? replacements[replacements.length - 1] : null;
    if (lastReplacement && lastReplacement.beats.length > 0) {
      const lastBeat = lastReplacement.beats[lastReplacement.beats.length - 1];
      const shortfall = bodyClipMin - bufferDuration;
      if (shortfall > 0 && lastBeat.duration > shortfall + bodyClipMin) {
        lastBeat.duration -= shortfall;
        bufferDuration = bodyClipMin;
      }
    }
    const tailType = resolveType(buffer);
    const numBeats = Math.max(1, Math.round(bufferDuration / targetAvg));
    const durPerBeat = bufferDuration / numBeats;
    const merged: Beat[] = [];
    for (let s = 0; s < numBeats; s++) {
      const srcQuery = buffer[Math.min(s, buffer.length - 1)].searchQuery || "documentary footage";
      const mod = SPLIT_MODIFIERS[s % SPLIT_MODIFIERS.length];
      const query = s === 0 ? srcQuery : `${srcQuery} ${mod}`.trim();
      const b: Beat = {
        id: `merged_tail_${s}`,
        startTime: 0,
        duration: durPerBeat,
        type: tailType,
        searchQuery: query,
      };
      if (tailType === "image") {
        b.imageAnimation = IMAGE_ANIMATIONS[s % IMAGE_ANIMATIONS.length];
      }
      merged.push(b);
    }
    for (const b of buffer) indicesToRemove.add(plan.beats.indexOf(b));
    replacements.push({ index: plan.beats.indexOf(buffer[0]), beats: merged });
    mergeCount += buffer.length;
  }

  if (replacements.length === 0) return;

  const newBeats: Beat[] = [];
  const replaceMap = new Map<number, Beat[]>();
  for (const r of replacements) replaceMap.set(r.index, r.beats);

  for (let i = 0; i < plan.beats.length; i++) {
    if (indicesToRemove.has(i)) {
      if (replaceMap.has(i)) {
        newBeats.push(...replaceMap.get(i)!);
      }
      continue;
    }
    if (!replaceMap.has(i)) {
      newBeats.push(plan.beats[i]);
    }
  }

  let t = 0;
  for (let i = 0; i < newBeats.length; i++) {
    newBeats[i].startTime = t;
    t += newBeats[i].duration;
  }

  plan.beats = newBeats;
  plan.totalDurationSeconds = t;
  for (let i = 0; i < plan.beats.length; i++) {
    plan.beats[i].id = `beat_${String(i + 1).padStart(3, "0")}`;
  }

  await logger.log(
    `Body durations enforced: ${splitCount} split, ${mergeCount} merged (target: ${bodyClipMin}-${bodyClipMax}s)`
  );
}

function bresenhamSelect(total: number, count: number): number[] {
  if (count <= 0 || total <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  const selected: number[] = [];
  let error = Math.floor(total / 2);
  const step = total;
  for (let i = 0; i < total && selected.length < count; i++) {
    error -= count;
    if (error < 0) {
      error += step;
      selected.push(i);
    }
  }
  return selected;
}

async function enforceBeatDistribution(plan: ScenePlan, clipPercent: number, imagePercent: number, hookDuration: number, logger: Logger): Promise<void> {
  let hookConverted = 0;
  for (const beat of plan.beats) {
    if (beat.startTime < hookDuration && beat.type === "image" && !beat.overlay) {
      beat.type = "clip";
      delete beat.imageAnimation;
      hookConverted++;
    }
  }

  const hookClipCount = plan.beats.filter(b => b.startTime < hookDuration && b.type === "clip").length;
  const bodyBeats = plan.beats.filter(b => b.startTime >= hookDuration);
  const bodyTotal = bodyBeats.length;
  const totalBeats = plan.beats.length;

  if (bodyTotal === 0) {
    if (hookConverted > 0) {
      await logger.log(`Hook: converted ${hookConverted} images → clips (hook is clips-only)`);
    }
    return;
  }

  const totalTargetClips = Math.round(totalBeats * clipPercent / 100);
  const targetBodyClips = Math.max(0, totalTargetClips - hookClipCount);
  const currentBodyClips = bodyBeats.filter(b => b.type === "clip").length;
  const diff = currentBodyClips - targetBodyClips;

  let bodyConverted = 0;
  if (diff > 0) {
    const candidates = bodyBeats.filter(b => b.type === "clip" && !b.overlay);
    const toConvert = Math.min(Math.abs(diff), candidates.length);
    const selected = bresenhamSelect(candidates.length, toConvert);
    for (const idx of selected) {
      candidates[idx].type = "image";
      candidates[idx].imageAnimation = IMAGE_ANIMATIONS[Math.floor(Math.random() * IMAGE_ANIMATIONS.length)];
      bodyConverted++;
    }
  } else if (diff < 0) {
    const candidates = bodyBeats.filter(b => b.type === "image" && !b.overlay);
    const toConvert = Math.min(Math.abs(diff), candidates.length);
    const selected = bresenhamSelect(candidates.length, toConvert);
    for (const idx of selected) {
      candidates[idx].type = "clip";
      delete candidates[idx].imageAnimation;
      bodyConverted++;
    }
  }

  const parts: string[] = [];
  if (hookConverted > 0) parts.push(`hook: ${hookConverted} images → clips`);
  if (bodyConverted > 0) parts.push(`body: ${bodyConverted} converted (overall target: ${clipPercent}% clips, ${imagePercent}% images)`);
  if (parts.length > 0) {
    await logger.log(`Distribution enforced — ${parts.join(", ")}`);
  }
}

function stretchToAudioDuration(plan: ScenePlan, voDurationSeconds: number, logger: { log: (msg: string) => void }): void {
  const diff = voDurationSeconds - plan.totalDurationSeconds;
  if (Math.abs(diff) < 0.01) return;

  if (Math.abs(diff) < 1.0) {
    plan.beats[plan.beats.length - 1].duration += diff;
  } else {
    const scale = voDurationSeconds / plan.totalDurationSeconds;
    for (const beat of plan.beats) {
      beat.duration *= scale;
    }
  }

  let t = 0;
  for (const beat of plan.beats) {
    beat.startTime = t;
    t += beat.duration;
  }
  plan.totalDurationSeconds = t;
  logger.log(`Duration stretched to VO: ${voDurationSeconds.toFixed(1)}s (adjusted ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}s)`);
}

function validateScenePlan(plan: ScenePlan, forbiddenWords: string[], genericFallbacks: string[]): void {
  if (!plan.title) throw new Error("Missing title");
  if (!plan.beats || plan.beats.length === 0) throw new Error("No beats generated");

  for (let i = 0; i < plan.beats.length; i++) {
    const beat = plan.beats[i];
    if (!beat.id) beat.id = `beat_${String(i + 1).padStart(3, "0")}`;
    if (typeof beat.startTime !== "number" || isNaN(beat.startTime)) {
      throw new Error(`Beat ${beat.id} has invalid startTime`);
    }
    if (typeof beat.duration !== "number" || isNaN(beat.duration) || beat.duration <= 0) {
      throw new Error(`Beat ${beat.id} has invalid duration`);
    }

    if (!beat.searchQuery) {
      const neighbors = [
        plan.beats[i - 1]?.searchQuery,
        plan.beats[i + 1]?.searchQuery,
      ].filter((q: string | undefined) => !!q);
      beat.searchQuery = neighbors[0] ?? genericFallbacks[Math.floor(Math.random() * genericFallbacks.length)];
      console.log(`Auto-filled missing searchQuery for ${beat.type} beat ${beat.id} with '${beat.searchQuery}'`);
    }
    if (beat.searchQuery && (IMAGE_ANIMATIONS as readonly string[]).includes(beat.searchQuery)) {
      const neighbors = [
        plan.beats[i - 1]?.searchQuery,
        plan.beats[i + 1]?.searchQuery,
      ].filter((q: string | undefined) => !!q && !(IMAGE_ANIMATIONS as readonly string[]).includes(q!));
      const original = beat.searchQuery;
      beat.searchQuery = neighbors[0] ?? genericFallbacks[Math.floor(Math.random() * genericFallbacks.length)];
      console.log(`Replaced animation-as-query '${original}' for ${beat.id} with '${beat.searchQuery}'`);
    }
    if (beat.searchQuery) {
      const lower = beat.searchQuery.toLowerCase().trim();
      if (forbiddenWords.some((q: string) => lower === q || lower.startsWith(q + " "))) {
        const neighbors = [
          plan.beats[i - 1]?.searchQuery,
          plan.beats[i + 1]?.searchQuery,
        ].filter((q: string | undefined) => !!q && !forbiddenWords.some((f: string) => q.toLowerCase().startsWith(f)));
        const original = beat.searchQuery;
        beat.searchQuery = neighbors[0] ?? genericFallbacks[Math.floor(Math.random() * genericFallbacks.length)];
        console.log(`Replaced forbidden query '${original}' with '${beat.searchQuery}'`);
      }
    }
    if (beat.type === "image" && !beat.imageAnimation) {
      beat.imageAnimation = IMAGE_ANIMATIONS[Math.floor(Math.random() * IMAGE_ANIMATIONS.length)];
    }
    delete beat.overlay;
  }

  const totalDuration = plan.beats.reduce((sum, b) => sum + b.duration, 0);
  const expectedDuration = plan.totalDurationSeconds;
  if (Math.abs(totalDuration - expectedDuration) > 5) {
    const scale = expectedDuration / totalDuration;
    for (const beat of plan.beats) {
      beat.duration = Math.max(0.5, beat.duration * scale);
    }
    const newTotal = plan.beats.reduce((sum, b) => sum + b.duration, 0);
    if (Math.abs(newTotal - expectedDuration) > 5) {
      throw new Error(
        `Beat durations (${totalDuration}s) don't match total (${expectedDuration}s) even after scaling`
      );
    }
  }
}

export function addSubscribeOverlays(plan: ScenePlan, script: string): void {
  const lower = script.toLowerCase();
  if (!lower.includes("subscribe")) return;

  const totalDuration = plan.totalDurationSeconds;
  const scriptLen = script.length;

  for (const beat of plan.beats) {
    if (beat.type !== "clip") continue;
    if (beat.overlay) continue;

    const startChar = Math.floor((beat.startTime / totalDuration) * scriptLen);
    const endChar = Math.min(
      Math.floor(((beat.startTime + beat.duration) / totalDuration) * scriptLen),
      scriptLen
    );

    const segment = lower.slice(startChar, endChar);
    if (segment.includes("subscribe")) {
      beat.overlay = {
        type: "subscribe_cta",
        showAt: 0,
        hideAt: 1.0,
      };
      return;
    }
  }
}
