import type { ScenePlan, Beat, Section, SectionPlan } from "../types/scenePlan.js";
import { findSectionAt, isQueryDerailed, sectionLabel } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { createOpenRouterClient, createClientPool, chatCompletion } from "../utils/llm.js";
import { Logger } from "../utils/logger.js";
import type { SrtSegment } from "../utils/srtParser.js";
import { parseSrt, srtSegmentsToScriptText } from "../utils/srtParser.js";
import fs from "fs";
import { loadOverrides, applyOverrides } from "./overlayOverrides.js";
import type { OverlayOverrides } from "./overlayOverrides.js";

const COUNT_UP_PATTERN = /Number\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|\d+),\s*([^,\n]+)/gi;

const GARBAGE_WORDS = new Set([
  "closeup", "close-up", "close", "macro", "aerial", "drone", "overhead", "overhead",
  "pov", "point", "view", "angle", "panning", "tilt", "tilting", "pan", "dolly",
  "tracking", "tracking", "zoom", "zooming", "slow", "motion", "time", "lapse",
  "cinematic", "beautiful", "stunning", "amazing", "gorgeous", "breathtaking",
  "research", "study", "studies", "comparison", "vs", "versus", "benefit", "benefits",
  "vitamin", "vitamins", "antioxidant", "antioxidants", "nutrient", "nutrients",
  "mineral", "minerals", "enzyme", "enzymes", "protein", "proteins", "fiber", "fibers",
  "health", "healthy", "wellness", "healing", "heal", "natural", "organic", "raw",
  "fresh", "pure", "superfood", "superfoods", "nutrition", "nutritional",
  "medicinal", "medicine", "remedy", "remedies", "cure", "treatment", "therapy",
  "closeup", "close", "up", "shot", "scene", "footage", "video", "image", "picture",
  "photo", "photograph", "high", "quality", "hd", "4k", "8k", "ultra", "premium",
]);

function sanitizeSearchQuery(query: string, sectionContext?: string): string {
  if (sectionContext && query.toLowerCase().includes(sectionContext.toLowerCase())) {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 4).join(" ");
  }
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = words.filter((w) => {
    const clean = w.replace(/[^\w]/g, "");
    return !GARBAGE_WORDS.has(clean);
  });
  const result = filtered.length > 0 ? filtered.slice(0, 3).join(" ") : words.slice(0, 3).join(" ");
  if (sectionContext && !result.toLowerCase().includes(sectionContext.toLowerCase())) {
    return sectionContext;
  }
  return result || query.trim();
}

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
        addSubscribeOverlays(plan, script, logger);
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

export function enforceSectionContext(plan: ScenePlan, sectionPlan: SectionPlan): void {
  for (const beat of plan.beats) {
    const section = findSectionAt(beat.startTime, sectionPlan.sections);
    if (!section) continue;
    beat.sectionId = section.id;
    beat.sectionContext = section.searchContext || undefined;
    if (!section.searchContext) continue;
    if (isQueryDerailed(beat, section)) {
      console.log(`Section enforcement: '${beat.searchQuery}' → '${section.searchContext}' for ${beat.id}`);
      beat.searchQuery = section.searchContext;
    }
    beat.searchQuery = sanitizeSearchQuery(beat.searchQuery, section.searchContext);
  }
}

export function isListicleSectionPlan(sectionPlan: SectionPlan): boolean {
  return sectionPlan.sections.some((s) => s.type === "list");
}

export function assignSectionQueriesForListicle(plan: ScenePlan, sectionPlan: SectionPlan): void {
  if (!isListicleSectionPlan(sectionPlan)) return;
  // Collect known food names (sections with a real searchContext) so we can
  // fall back to a neighbor's context for inferred/gap-filled sections.
  const knownContexts = sectionPlan.sections
    .filter((s) => s.type === "list" && s.searchContext)
    .map((s) => s.searchContext!);
  for (const beat of plan.beats) {
    const section = findSectionAt(beat.startTime, sectionPlan.sections);
    if (!section || section.type !== "list") continue;
    // Use the section's context if it has one; otherwise fall back to the
    // nearest known neighbor's context (or a generic food term if none exist).
    let ctx = section.searchContext;
    if (!ctx) {
      const idx = sectionPlan.sections.indexOf(section);
      for (let d = 1; d <= 3 && !ctx; d++) {
        const prev = sectionPlan.sections[idx - d];
        const next = sectionPlan.sections[idx + d];
        if (prev?.searchContext) ctx = prev.searchContext;
        else if (next?.searchContext) ctx = next.searchContext;
      }
      ctx = ctx || (knownContexts[0] ?? "healthy food");
    }
    if (beat.searchQuery !== ctx) {
      console.log(`Listicle query assignment: '${beat.searchQuery}' → '${ctx}' for ${beat.id}`);
      beat.searchQuery = ctx;
      beat.searchQuery = sanitizeSearchQuery(beat.searchQuery, ctx);
    }
    beat.sectionContext = ctx;
  }
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, twentyone: 21, twentytwo: 22, twentythree: 23,
  twentyfour: 24, twentyfive: 25, twentysix: 26, twentyseven: 27, twentyeight: 28, twentynine: 29, thirty: 30,
};

const LIST_PATTERN_G = /(?:Number\s+|#)(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)[,:.]?\s+([^\n,.]{2,80})/gi;

function parseItemNumber(str: string): number {
  const clean = str.toLowerCase().replace(/\s/g, "");
  return NUMBER_WORDS[clean] ?? parseInt(clean);
}

function cleanLabel(raw: string): string {
  let label = raw.trim();
  label = label.replace(/^(is|are|the|a|an|we|have|comes|coming|this|that|number)\s+/gi, "");
  label = label.replace(/\s+/g, " ").trim();
  return label;
}

interface DetectedItem {
  number: number;
  label: string;
  startTime: number;
  sourceSnippet: string;
}

function extractListItems(segments: SrtSegment[], logger: Logger): DetectedItem[] {
  const rawItems: DetectedItem[] = [];

  const tryMatch = (text: string, fallbackTime: number) => {
    LIST_PATTERN_G.lastIndex = 0;
    let match;
    while ((match = LIST_PATTERN_G.exec(text)) !== null) {
      const number = parseItemNumber(match[1]);
      if (isNaN(number) || number < 1 || number > 50) continue;
      const label = cleanLabel(match[2]);
      if (label.length < 2) continue;
      const snippet = text.substring(match.index, Math.min(match.index + 120, text.length)).trim();
      rawItems.push({ number, label, startTime: fallbackTime, sourceSnippet: snippet });
    }
  };

  for (let i = 0; i < segments.length; i++) {
    tryMatch(segments[i].text, segments[i].startTime);
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const combined = segments[i].text + " " + segments[i + 1].text;
    tryMatch(combined, segments[i].startTime);
  }

  let fullText = "";
  const charToTime: { pos: number; time: number }[] = [];
  for (const seg of segments) {
    charToTime.push({ pos: fullText.length, time: seg.startTime });
    fullText += seg.text + " ";
  }
  LIST_PATTERN_G.lastIndex = 0;
  let gMatch;
  while ((gMatch = LIST_PATTERN_G.exec(fullText)) !== null) {
    const number = parseItemNumber(gMatch[1]);
    if (isNaN(number) || number < 1 || number > 50) continue;
    const label = cleanLabel(gMatch[2]);
    if (label.length < 2) continue;
    let matchTime = 0;
    for (const ct of charToTime) {
      if (ct.pos <= gMatch.index) matchTime = ct.time;
      else break;
    }
    const snippet = fullText.substring(gMatch.index, Math.min(gMatch.index + 120, fullText.length));
    rawItems.push({ number, label, startTime: matchTime, sourceSnippet: snippet.trim() });
  }

  rawItems.sort((a, b) => a.startTime - b.startTime);

  const firstOneIdx = rawItems.findIndex(i => i.number === 1);
  let filtered: DetectedItem[];
  if (firstOneIdx > 0) {
    const removed = rawItems.slice(0, firstOneIdx);
    logger.log(`Filtering ${removed.length} hook false positive(s): ${removed.map(i => "#" + i.number).join(", ")}`);
    filtered = rawItems.slice(firstOneIdx);
  } else {
    filtered = rawItems;
  }

  const deduped: DetectedItem[] = [];
  const seenNumbers = new Set<number>();
  const seenTimes = new Set<number>();
  for (const item of filtered) {
    const existing = deduped.find(d => d.number === item.number);
    if (existing) {
      if (item.sourceSnippet.length > existing.sourceSnippet.length) {
        deduped[deduped.indexOf(existing)] = item;
      }
      continue;
    }
    const timeKey = Math.floor(item.startTime);
    if (seenTimes.has(timeKey)) continue;
    seenNumbers.add(item.number);
    seenTimes.add(timeKey);
    deduped.push(item);
  }

  logger.log(`Detected ${deduped.length} items: ${deduped.map(i => "#" + i.number).join(", ")}`);

  const numbers = deduped.map(i => i.number);
  const minNum = Math.min(...numbers);
  const maxNum = Math.max(...numbers);
  const inferred: DetectedItem[] = [];

  for (let n = minNum; n <= maxNum; n++) {
    if (deduped.find(i => i.number === n)) continue;
    const before = deduped.filter(i => i.number < n).sort((a, b) => b.number - a.number)[0];
    const after = deduped.filter(i => i.number > n).sort((a, b) => a.number - b.number)[0];
    if (!before || !after) continue;
    const midTime = before.startTime + (after.startTime - before.startTime) / 2;
    inferred.push({ number: n, label: "", startTime: midTime, sourceSnippet: "" });
  }

  // Auto-suggest labels for inferred (gap-filled) items by scanning the SRT
  // text near each item's estimated timestamp for capitalized words that are
  // likely item/food names. Only fills if a word recurs >= 2 times nearby.
  const STOP_WORDS = new Set(["The", "This", "That", "When", "What", "Which", "Number", "Well", "But", "And", "With", "From", "They", "Were", "Been", "Have", "Has", "Its", "Not", "Are", "Was", "All", "Can", "Will", "Your", "Their", "There", "Then", "These", "Those", "Some", "More", "Very", "Just", "Only", "Also", "Even", "Still", "Here", "Like", "Into", "About", "After", "Before", "Make", "Makes", "Made", "Get", "Gets", "Got", "Now"]);
  for (const item of inferred) {
    const nearby = segments.filter((s) => s.startTime >= item.startTime - 30 && s.startTime <= item.startTime + 60);
    const words: string[] = [];
    for (const seg of nearby) {
      const caps = seg.text?.match(/\b[A-Z][a-z]{2,}\b/g);
      if (caps) words.push(...caps);
    }
    const filtered = words.filter((w) => !STOP_WORDS.has(w));
    if (filtered.length === 0) continue;
    const counts: Record<string, number> = {};
    for (const w of filtered) counts[w] = (counts[w] ?? 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) {
      item.label = best[0];
      item.sourceSnippet = `(suggested from SRT: "${best[0]}" appeared ${best[1]}x near this timestamp)`;
    }
  }

  if (inferred.length > 0) {
    const filled = inferred.filter((i) => i.label).length;
    logger.log(`Inferred ${inferred.length} gaps: ${inferred.map((i) => "#" + i.number).join(", ")}${filled > 0 ? ` (${filled} auto-suggested from SRT)` : ""}`);
  }

  const all = [...deduped, ...inferred].sort((a, b) => a.startTime - b.startTime);
  return all;
}

/**
 * Detect where the outro/ending begins by scanning forward from the last list
 * item for the next mention of its number. In listicle scripts, the outro
 * typically re-states the count: "Those twenty superfoods..." or "That's 20
 * foods...". That second mention marks the real ending boundary — much more
 * accurate than the old voDuration × 4% guess.
 *
 * Returns the outro segment's startTime, or null if no second mention found.
 */
function findOutroStart(
  segments: SrtSegment[],
  lastItemNumber: number,
  lastItemStartTime: number,
  logger: Logger
): number | null {
  // Build regex for the number as both word and digit.
  const wordForm = Object.entries(NUMBER_WORDS).find(([, n]) => n === lastItemNumber)?.[0];
  const alternatives = [String(lastItemNumber)];
  if (wordForm) alternatives.push(wordForm);
  // Also match hyphenated variants like "twenty-one".
  const escaped = alternatives.map((a) => a.replace(/[-]/g, "\\s*")).join("|");
  const re = new RegExp(`\\b(${escaped})\\b`, "i");

  // Scan segments AFTER the last item's start time. Skip the segment that
  // contains the original "Number X" match (it would match itself).
  for (const seg of segments) {
    if (seg.startTime <= lastItemStartTime) continue;
    if (re.test(seg.text)) {
      logger.log(`Ending detected: "${seg.text.trim()}" at ${seg.startTime.toFixed(1)}s (second mention of ${lastItemNumber})`);
      return seg.startTime;
    }
  }
  return null;
}

/**
 * Detect teaser mentions of list items in the hook/outro — e.g. "Stay with me
 * because number nine...". Returns timestamps where each number is mentioned
 * outside its own section, so we can attach callout overlays.
 */
export function extractTeaserMentions(
  segments: SrtSegment[],
  items: DetectedItem[],
  logger: Logger
): { number: number; startTime: number }[] {
  const mentions: { number: number; startTime: number }[] = [];
  if (items.length === 0) return mentions;

  // Scan the HOOK region — everything before the FIRST item's actual section.
  const firstItemStart = Math.min(...items.map(i => i.startTime));
  const hookSegments = segments.filter(s => s.startTime < firstItemStart);
  logger.log(`Teaser scan: ${hookSegments.length} hook segments (before ${firstItemStart.toFixed(1)}s)`);

  // Scan ALL hook segments for ANY #N or "number N" pattern — not just known
  // items. The hook may tease items that don't have their own section yet (e.g.
  // in a trimmed video, or when the narrator mentions #17 but only 2 items
  // have been detected so far).
  const seenNumbers = new Set<number>();
  const teaserRe = /(?:#|number\s+)(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi;

  for (const seg of hookSegments) {
    teaserRe.lastIndex = 0;
    let match;
    while ((match = teaserRe.exec(seg.text)) !== null) {
      const num = parseItemNumber(match[1]);
      if (isNaN(num) || num < 1 || num > 50) continue;
      if (seenNumbers.has(num)) continue;
      seenNumbers.add(num);
      mentions.push({ number: num, startTime: seg.startTime });
      logger.log(`Teaser mention: #${num} at ${seg.startTime.toFixed(1)}s ("${seg.text.trim().slice(0, 60)}")`);
    }
  }
  return mentions;
}

/**
 * Attach callout overlays (number_callout) to beats at teaser mention timestamps,
 * and item_banner overlays to the first beat of each list section.
 */
export function addCalloutOverlays(
  plan: ScenePlan,
  teaserMentions: { number: number; startTime: number }[],
  sectionPlan: SectionPlan,
  logger?: Logger,
  overrides?: OverlayOverrides,
): void {
  // Clear only auto-detected overlays (callouts/banners) — preserve subscribe_cta
  // which was added earlier by addSubscribeOverlays based on script keywords.
  for (const beat of plan.beats) {
    if (beat.overlay && (beat.overlay.type === "number_callout" || beat.overlay.type === "item_banner")) {
      delete beat.overlay;
    }
  }

  // Clamp: ensure section.endTime is never before section.startTime.
  // This can happen with stale section_plan.json files where the outro
  // detection fallback produced a backwards time range.
  for (const section of sectionPlan.sections) {
    if (section.endTime < section.startTime + 1) {
      logger?.log(`[DEBUG] Section #${section.number} endTime clamped: ${section.endTime.toFixed(1)} → ${(section.startTime + 5).toFixed(1)}`);
      section.endTime = section.startTime + 5;
    }
  }

  // Teaser callouts: find the beat at each teaser timestamp and tag it.
  // showAt is RELATIVE to beat.startTime (offset within the beat), so the
  // renderer's `beat.startTime + showAt` gives the exact SRT timestamp.
  for (const teaser of teaserMentions) {
    const beat = plan.beats.find((b) => b.startTime <= teaser.startTime && b.startTime + b.duration > teaser.startTime);
    if (beat && (beat.type === "clip" || beat.type === "image")) {
      const relShowAt = teaser.startTime - beat.startTime; // offset from beat start
      beat.overlay = {
        type: "number_callout",
        showAt: relShowAt,
        hideAt: 1.0,
        number: teaser.number,
      };
      logger?.log(`[DEBUG] Teaser callout: #${teaser.number} at ${teaser.startTime.toFixed(1)}s → beat=${beat.id} (beat.start=${beat.startTime.toFixed(1)}s, relShowAt=${relShowAt.toFixed(2)}s, absolute=${teaser.startTime.toFixed(1)}s)`);
    } else {
      logger?.log(`[DEBUG] Teaser callout: #${teaser.number} at ${teaser.startTime.toFixed(1)}s → NO BEAT FOUND (beat=${beat?.id ?? "none"}, beatType=${beat?.type ?? "n/a"})`);
    }
  }

  // Item banners: CTA-style — find the beat CONTAINING section.startTime
  // (the beat playing when narrator says the item), assign banner to it with
  // showAt: 0 so it appears when that beat starts in the concat video.
  // Skip beats that already have a number_callout (teaser).
  const bannerAssignedBeats = new Set<string>();
  for (const section of sectionPlan.sections) {
    if (section.type !== "list") continue;
    // Find beat whose SRT range contains section.startTime
    const containingBeat = plan.beats.find((b) =>
      (b.type === "clip" || b.type === "image") &&
      b.startTime <= section.startTime &&
      b.startTime + b.duration > section.startTime &&
      b.overlay?.type !== "number_callout"
    );
    if (containingBeat) {
      bannerAssignedBeats.add(containingBeat.id);
      containingBeat.overlay = {
        type: "item_banner",
        showAt: 0,          // CTA-style: at beat start in concat
        hideAt: 1.0,
        number: section.number,
        label: section.bannerText || section.label,
      };
      logger?.log(`[DEBUG] Banner (CTA-style): section#${section.number} "${section.label}" [${section.startTime.toFixed(1)}→${section.endTime.toFixed(1)}] → containing beat=${containingBeat.id} (beat.start=${containingBeat.startTime.toFixed(1)}s, dur=${containingBeat.duration.toFixed(1)}s), label="${section.bannerText || section.label}"`);
    } else {
      // Fallback: first beat in section range without callout
      const sectionBeats = plan.beats.filter((b) =>
        b.startTime >= section.startTime &&
        b.startTime < section.endTime &&
        (b.type === "clip" || b.type === "image") &&
        b.overlay?.type !== "number_callout"
      );
      const beat = sectionBeats.find((b) => !bannerAssignedBeats.has(b.id)) ?? sectionBeats[0];
      if (beat) {
        bannerAssignedBeats.add(beat.id);
        beat.overlay = {
          type: "item_banner",
          showAt: 0,
          hideAt: 1.0,
          number: section.number,
          label: section.bannerText || section.label,
        };
        logger?.log(`[DEBUG] Banner (fallback): section#${section.number} "${section.label}" → beat=${beat.id} (beat.start=${beat.startTime.toFixed(1)}s)`);
      } else {
logger?.log(`[DEBUG] Banner: section#${section.number} "${section.label}" → NO BEAT`);
    }
  }
  } // end for each section

  // Apply manual overrides from Overlay Editor (Step 3).
  // MUST be outside the for-loop above, otherwise it runs once per section.
  if (overrides) {
    applyOverrides(plan, { callouts: overrides.callouts ?? [], banners: overrides.banners ?? [], ctas: overrides.ctas ?? [], lastModified: Date.now() }, logger);
  }
}

export function generateSectionPlanFromSrt(
  srtPath: string,
  voDurationSeconds: number,
  logger: Logger
): SectionPlan {
  logger.log("Scanning SRT for list items...");

  const srtContent = fs.readFileSync(srtPath, "utf-8");
  const segments = parseSrt(srtContent);
  if (segments.length === 0) {
    throw new Error("SRT file contains no valid segments");
  }

  let items = extractListItems(segments, logger);

  if (items.length === 0) {
    throw new Error("No list items found in SRT. Untick 'Listicle Video' to generate without sections.");
  }

  const detectedCount = items.filter(i => i.sourceSnippet).length;
  const inferredCount = items.filter(i => !i.sourceSnippet).length;

  const sections: Section[] = [];

  const firstItemStart = items[0].startTime;
  if (firstItemStart > 3) {
    sections.push({
      id: "section_hook",
      type: "hook",
      label: "Opening",
      startTime: 0,
      endTime: firstItemStart,
      searchContext: "",
    });
  }

  // Detect the ending boundary: scan for the outro's re-mention of the final
  // number (e.g. "Those twenty superfoods..."). Falls back to a time-based
  // heuristic (last ~4% of VO) if no second mention is found.
  const lastItem = items[items.length - 1];
  const outroStart = findOutroStart(segments, lastItem.number, lastItem.startTime, logger);
  const endingDuration = Math.min(120, Math.max(30, voDurationSeconds * 0.04));
  const fallbackEndingStart = voDurationSeconds - endingDuration;
  const endingStart = outroStart !== null ? outroStart : fallbackEndingStart;
  if (outroStart !== null) {
    logger.log(`Ending boundary set to ${outroStart.toFixed(1)}s via outro detection (fallback would have been ${fallbackEndingStart.toFixed(1)}s)`);
  } else {
    logger.log(`No outro re-mention found, using time-based ending at ${fallbackEndingStart.toFixed(1)}s`);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nextStart = i < items.length - 1 ? items[i + 1].startTime : voDurationSeconds;
    const isLast = i === items.length - 1;
    let endTime = isLast && nextStart > endingStart ? endingStart : nextStart;
    // Clamp: endTime must be after startTime (can happen when items are detected
    // after the ending boundary in a trimmed video).
    if (endTime < item.startTime + 1) endTime = item.startTime + 5;
    // Auto-fill banner text: "#N Title Case Label — Tagline"
    const titleCaseLabel = (item.label || `Item ${item.number}`)
      .split(/\s+/).map((w) => w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    // Extract tagline from sourceSnippet — the descriptive sentence after the
    // item name (e.g. "#1 green tea. The original metabolic ignition switch.")
    let tagline = "";
    if (item.sourceSnippet) {
      const snippetLower = item.sourceSnippet.toLowerCase();
      const labelLower = (item.label || "").toLowerCase();
      const labelIdx = snippetLower.indexOf(labelLower);
      if (labelIdx >= 0) {
        // Find the tagline after the label — separated by period OR comma.
        // e.g. "#1 green tea. The original..." or "#2 cayenne pepper, the spice..."
        const afterLabel = item.sourceSnippet.substring(labelIdx + labelLower.length);
        const dotMatch = afterLabel.match(/^[.,]\s*(.+?)(?:[.,]\s|$)/i);
        if (dotMatch && dotMatch[1]) {
          tagline = dotMatch[1].trim()
            .split(/\s+/).map((w: string) => w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        }
      }
    }
    const bannerText = tagline
      ? `#${item.number} ${titleCaseLabel} — ${tagline}`
      : `#${item.number} ${titleCaseLabel}`;
    sections.push({
      id: `section_${item.number}`,
      type: "list",
      label: item.label || `Item ${item.number}`,
      startTime: item.startTime,
      endTime,
      searchContext: item.label ? item.label.toLowerCase() : "",
      bannerText,
      number: item.number,
      inferred: !item.sourceSnippet ? true : undefined,
      sourceSnippet: item.sourceSnippet || undefined,
    });
  }

  if (sections[sections.length - 1].endTime < voDurationSeconds - 5) {
    sections.push({
      id: "section_ending",
      type: "ending",
      label: "Ending",
      startTime: sections[sections.length - 1].endTime,
      endTime: voDurationSeconds,
      searchContext: "",
    });
  }

  logger.log(`Section plan: ${sections.length} sections (${detectedCount} detected, ${inferredCount} inferred)`);

  return { title: "", sections };
}

export async function generateSectionPlan(
  srtPath: string,
  voDurationSeconds: number,
  config: Config,
  logger: Logger
): Promise<SectionPlan> {
  try {
    return generateSectionPlanFromSrt(srtPath, voDurationSeconds, logger);
  } catch (err: any) {
    await logger.log(`Programmatic scan failed: ${err.message}. Falling back to LLM...`);
    return generateSectionPlanLLM(srtPath, voDurationSeconds, config, logger);
  }
}

async function generateSectionPlanLLM(
  srtPath: string,
  voDurationSeconds: number,
  config: Config,
  logger: Logger
): Promise<SectionPlan> {
  await logger.log("Generating section plan from SRT...");

  const srtContent = fs.readFileSync(srtPath, "utf-8");
  const segments = parseSrt(srtContent);
  if (segments.length === 0) {
    throw new Error("SRT file contains no valid segments");
  }

  const scriptText = srtSegmentsToScriptText(segments);
  const client = createOpenRouterClient(config.openrouterApiKeys[0]);

  const segmentLines = segments
    .map((s, i) => `SEGMENT ${i + 1} [${s.startTime.toFixed(2)}s → ${s.endTime.toFixed(2)}s]: ${s.text}`)
    .join("\n");

  const systemPrompt = `You create a section plan for a YouTube video. Read the SRT segments and identify the video's structure.

Output ONLY a JSON array of sections:
[
  {"type": "hook", "label": "Opening", "startTime": 0, "endTime": 60, "searchContext": ""},
  {"type": "list", "label": "Chicken Soup", "number": 1, "startTime": 60, "endTime": 240, "searchContext": "chicken soup"},
  {"type": "list", "label": "Tomato Soup", "number": 2, "startTime": 240, "endTime": 480, "searchContext": "tomato soup"},
  {"type": "ending", "label": "Ending", "startTime": 1700, "endTime": 1800, "searchContext": ""}
]

RULES:
- type: "hook" (opening), "list" (numbered item), or "ending" (outro)
- For "list" sections: look for "Number N, [item]" or "#N [item]" patterns. Extract the ACTUAL item name.
- searchContext: 1-3 words describing what to search on stock photo sites (Pexels, Pixabay). Use the item's real name.
- Leave hook/ending searchContext EMPTY — the user fills those manually.
- label: human-readable name for the section (the item name for list sections)
- number: the list position (1, 2, 3...) for list sections only
- startTime/endTime: in seconds, from the SRT timestamps
- Sections MUST cover the entire duration (${voDurationSeconds}s) with NO gaps and NO overlaps
- Each section ends where the next begins`;

  const userPrompt = `SRT Segments:
${segmentLines}

Total duration: ${voDurationSeconds} seconds

Create the section plan as a JSON array.`;

  const raw = await chatCompletion(
    client,
    config.scenePlannerModel,
    systemPrompt,
    userPrompt,
    4,
    (attempt, max, err) => {
      logger.log(`Connection error, retrying (${attempt}/${max}): ${err}`);
    }
  );

  let sections: any[];
  try {
    const parsed = JSON.parse(raw);
    sections = Array.isArray(parsed) ? parsed : (parsed.sections ?? []);
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("Failed to parse section plan from LLM response");
    sections = JSON.parse(match[0]);
  }

  for (let i = 0; i < sections.length; i++) {
    if (!sections[i].id) sections[i].id = `section_${i + 1}`;
    if (typeof sections[i].startTime !== "number") sections[i].startTime = i > 0 ? sections[i - 1].endTime : 0;
    if (typeof sections[i].endTime !== "number") sections[i].endTime = i < sections.length - 1 ? sections[i + 1].startTime : voDurationSeconds;
    if (!sections[i].searchContext) sections[i].searchContext = "";
    if (!sections[i].label) sections[i].label = sections[i].type === "hook" ? "Opening" : sections[i].type === "ending" ? "Ending" : `Section ${i + 1}`;
  }

  for (let i = 0; i < sections.length - 1; i++) {
    if (sections[i].endTime < sections[i + 1].startTime) {
      sections[i].endTime = sections[i + 1].startTime;
    }
    if (sections[i].endTime > sections[i + 1].startTime) {
      sections[i].endTime = sections[i + 1].startTime;
    }
  }
  if (sections.length > 0) {
    sections[0].startTime = 0;
    sections[sections.length - 1].endTime = voDurationSeconds;
  }

  const plan: SectionPlan = { title: "", sections };
  await logger.log(`Section plan generated: ${sections.length} sections (${sections.filter(s => s.type === "list").length} list items)`);
  return plan;
}


export async function planScenesFromSrt(
  srtPath: string,
  voDurationSeconds: number,
  config: Config,
  logger: Logger,
  sectionPlan?: SectionPlan
): Promise<ScenePlan> {
  await logger.log("Generating scene plan from SRT subtitles...");

  const srtContent = fs.readFileSync(srtPath, "utf-8");
  const segments = parseSrt(srtContent);
  if (segments.length === 0) {
    throw new Error("SRT file contains no valid segments");
  }

  await logger.log(`SRT: ${segments.length} segments, covering ${segments[0].startTime.toFixed(1)}s to ${segments[segments.length - 1].endTime.toFixed(1)}s`);

  let sectionConstraint = "";
  if (sectionPlan && sectionPlan.sections.length > 0) {
    const lines = sectionPlan.sections.map(s => {
      const numStr = s.number ? ` #${s.number}` : "";
      const ctxStr = s.searchContext ? ` → search for "${s.searchContext}"` : " → (user will set search context)";
      return `${s.type}${numStr} "${s.label}" [${s.startTime.toFixed(0)}s-${s.endTime.toFixed(0)}s]${ctxStr}`;
    }).join("\n");
    sectionConstraint = `\n\nSECTION CONSTRAINTS — every beat's searchQuery MUST contain its section's search context:\n${lines}\n- You CAN add descriptive words: "chicken soup pouring", "chicken soup bowl"\n- But the section's search context (e.g. "chicken soup") MUST always appear in the query`;
  }

  const chunkSize = config.srtChunkSize ?? 25;

  // Fast listicle path: skip the LLM entirely, build beats programmatically.
  // Only when the toggle is on AND this is a listicle section plan.
  if (config.fastListiclePlan && sectionPlan && isListicleSectionPlan(sectionPlan)) {
    await logger.log("Fast listicle planning enabled — building beats programmatically (no LLM)...");
    return planScenesFromSrtFast(segments, voDurationSeconds, config, logger, sectionPlan);
  }

  if (segments.length > chunkSize) {
    await logger.log(`Large SRT detected (${segments.length} segments) — using chunked planning (${chunkSize} segments per chunk)`);
    return planScenesFromSrtChunked(segments, voDurationSeconds, config, logger, sectionPlan, sectionConstraint);
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

Generate a complete scene plan as JSON. Each segment's time range MUST be fully covered by beats. Do NOT leave gaps.${sectionConstraint}`;

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
      if (sectionPlan) {
        enforceSectionContext(plan, sectionPlan);
        assignSectionQueriesForListicle(plan, sectionPlan);
      }
      if (config.vfxPath) {
        addSubscribeOverlays(plan, scriptText, logger);
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
  logger: Logger,
  sectionPlan?: SectionPlan,
  sectionConstraint?: string
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

        const sectionTag = (() => {
          if (!sectionPlan) return "";
          const mid = (globalOffset + chunkEnd) / 2;
          const s = findSectionAt(mid, sectionPlan.sections);
          if (!s) return "";
          return ` → ${sectionLabel(s)}`;
        })();

        if (isFreeModel) {
          await logger.log(`Chunk ${chunkIdx + 1}/${chunks.length}: segments ${globalOffset.toFixed(1)}s → ${chunkEnd.toFixed(1)}s${sectionTag} (key ${(chunkIdx % clientPool.length) + 1}/${clientPool.length})`);
        } else {
          await logger.log(`Chunk ${chunkIdx + 1}/${chunks.length}: segments ${globalOffset.toFixed(1)}s → ${chunkEnd.toFixed(1)}s${sectionTag}`);
        }

        const segmentLines = chunk
          .map((s, i) => `SEGMENT ${i + 1} [${s.startTime.toFixed(2)}s → ${s.endTime.toFixed(2)}s]: ${s.text}`)
          .join("\n");

        const userPrompt = `SRT Segments (part of a ${voDurationSeconds.toFixed(1)}s video):
${segmentLines}

Chunk time range: ${globalOffset.toFixed(1)}s to ${chunkEnd.toFixed(1)}s
Voiceover duration for this chunk: ${(chunkEnd - globalOffset).toFixed(1)} seconds
FPS: ${config.fps}

Generate a complete scene plan as JSON for these segments only. Beats MUST cover [${globalOffset.toFixed(2)}s, ${chunkEnd.toFixed(2)}s] with no gaps.${sectionConstraint ?? ""}`;

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
  if (sectionPlan) {
    enforceSectionContext(plan, sectionPlan);
    assignSectionQueriesForListicle(plan, sectionPlan);
  }
  if (config.vfxPath) {
    addSubscribeOverlays(plan, scriptText, logger);
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

// Fast listicle path: build beats programmatically (one beat per SRT segment),
// then run the exact same post-processing chain as the LLM chunked path. This
// skips all LLM calls — the result is structurally equivalent for listicles,
// where searchQuery/type/timing are all overwritten deterministically anyway.
async function planScenesFromSrtFast(
  segments: SrtSegment[],
  voDurationSeconds: number,
  config: Config,
  logger: Logger,
  sectionPlan: SectionPlan
): Promise<ScenePlan> {
  const beats: Beat[] = segments.map((s, i) => ({
    id: `fast_${i + 1}`,
    startTime: s.startTime,
    duration: Math.max(0.1, s.endTime - s.startTime),
    type: "clip",
    searchQuery: s.text.split(" ").slice(0, 3).join(" "),
  }));

  const totalDuration = segments[segments.length - 1].endTime;
  const plan: ScenePlan = {
    title: "Untitled",
    fps: config.fps,
    totalDurationSeconds: totalDuration,
    beats,
  };

  await logger.log(`Built ${beats.length} beats from ${segments.length} SRT segments — applying post-processing...`);

  const scriptText = srtSegmentsToScriptText(segments);
  enforceSectionContext(plan, sectionPlan);
  assignSectionQueriesForListicle(plan, sectionPlan);
  if (config.vfxPath) {
    addSubscribeOverlays(plan, scriptText, logger);
  }
  scaleToAudioDuration(plan, voDurationSeconds, logger);
  await enforceHookDurations(plan, config.hookDuration, config.hookClipMin, config.hookClipMax, logger);
  await enforceBodyDurations(plan, config.hookDuration, config.bodyClipMin, config.bodyClipMax, logger);
  enforceBeatDistribution(plan, config.clipPercent, config.imagePercent, config.hookDuration, logger);
  stretchToAudioDuration(plan, voDurationSeconds, logger);

  await logger.log(`Fast plan complete: ${plan.beats.length} beats (${countByType(plan, "clip")} clips, ${countByType(plan, "image")} images)`);
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
    if (beat.searchQuery) {
      const sanitized = sanitizeSearchQuery(beat.searchQuery);
      if (sanitized !== beat.searchQuery) {
        console.log(`Sanitized query '${beat.searchQuery}' → '${sanitized}' for ${beat.id}`);
        beat.searchQuery = sanitized;
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

export function addSubscribeOverlays(plan: ScenePlan, script: string, logger?: Logger): void {
  const lower = script.toLowerCase();
  if (!lower.includes("subscribe")) {
    logger?.log(`[DEBUG] addSubscribeOverlays: no "subscribe" keyword in script, skipping`);
    return;
  }

  const totalDuration = plan.totalDurationSeconds;
  const scriptLen = script.length;
  let taggedCount = 0;

  for (const beat of plan.beats) {
    if (beat.type !== "clip" && beat.type !== "image") continue;
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
      taggedCount++;
      logger?.log(`[DEBUG] addSubscribeOverlays: tagged beat ${beat.id} (start=${beat.startTime}s)`);
    }
  }

  logger?.log(`[DEBUG] addSubscribeOverlays: ${taggedCount} beat(s) tagged with subscribe_cta`);
}
