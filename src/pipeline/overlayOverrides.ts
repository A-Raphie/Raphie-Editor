import fs from "fs";
import path from "path";
import type { Logger } from "./logger.js";

export interface OverlayOverride {
  beatId: string;
  type: "number_callout" | "item_banner" | "subscribe_cta";
  showAt?: number;
  label?: string;
  enabled?: boolean;
}

export interface OverlayOverrides {
  projectId: string;
  callouts: OverlayOverride[];
  banners: OverlayOverride[];
  ctas: OverlayOverride[];
  lastModified: number;
}

function getOverridesPath(outputDir: string, projectId: string): string {
  return path.join(outputDir, "overlay_overrides.json");
}

export function loadOverrides(outputDir: string, projectId: string, logger?: Logger): OverlayOverrides | null {
  const filePath = getOverridesPath(outputDir, projectId);
  try {
    if (!fs.existsSync(filePath)) {
      logger?.log(`[DEBUG] loadOverrides: no file at ${filePath}`);
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as OverlayOverrides;
    logger?.log(`[DEBUG] loadOverrides: ${data.callouts.length} callout(s), ${data.banners.length} banner(s), ${data.ctas.length} CTA(s) from ${filePath}`);
    return data;
  } catch (err: any) {
    logger?.warn(`[DEBUG] loadOverrides: failed to parse ${filePath}: ${err.message}`);
    return null;
  }
}

export function saveOverrides(outputDir: string, overrides: OverlayOverrides, logger?: Logger): void {
  const filePath = getOverridesPath(outputDir, overrides.projectId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  overrides.lastModified = Date.now();
  fs.writeFileSync(filePath, JSON.stringify(overrides, null, 2));
  logger?.log(`[DEBUG] saveOverrides: wrote ${overrides.callouts.length} callout(s), ${overrides.banners.length} banner(s), ${overrides.ctas.length} CTA(s) to ${filePath}`);
}

export function applyOverrides(
  plan: any,
  overrides: { callouts: OverlayOverride[]; banners: OverlayOverride[]; ctas: OverlayOverride[] },
  logger?: Logger,
): void {
  // Clear existing overlays of these types that aren't explicitly in overrides
  // (overrides take precedence)
  const overrideBeatIds = new Set([
    ...overrides.callouts.map(o => o.beatId),
    ...overrides.banners.map(o => o.beatId),
    ...overrides.ctas.map(o => o.beatId),
  ]);

  // First pass: clear existing overlays that are in override list (they'll be re-added)
  let clearedCount = 0;
  for (const beat of plan.beats) {
    if (beat.overlay && overrideBeatIds.has(beat.id)) {
      delete beat.overlay;
      clearedCount++;
    }
  }

  // Apply callout overrides
  let calloutsApplied = 0;
  for (const ov of overrides.callouts) {
    const beat = plan.beats.find((b: any) => b.id === ov.beatId);
    if (beat && ov.enabled !== false) {
      beat.overlay = {
        type: "number_callout",
        showAt: ov.showAt ?? 0,
        hideAt: 1.0,
        number: parseInt(ov.label?.replace("#", "") || "0"),
      };
      calloutsApplied++;
    } else if (!beat) {
      logger?.warn(`[DEBUG] applyOverrides: callout beatId "${ov.beatId}" not found in plan`);
    }
  }

  // Apply banner overrides
  let bannersApplied = 0;
  for (const ov of overrides.banners) {
    const beat = plan.beats.find((b: any) => b.id === ov.beatId);
    if (beat && ov.enabled !== false) {
      beat.overlay = {
        type: "item_banner",
        showAt: ov.showAt ?? 0,
        hideAt: 1.0,
        number: parseInt(ov.label?.match(/#(\d+)/)?.[1] || "0"),
        label: ov.label,
      };
      bannersApplied++;
    } else if (!beat) {
      logger?.warn(`[DEBUG] applyOverrides: banner beatId "${ov.beatId}" not found in plan`);
    }
  }

  // Apply CTA overrides
  let ctasApplied = 0;
  for (const ov of overrides.ctas) {
    const beat = plan.beats.find((b: any) => b.id === ov.beatId);
    if (beat && ov.enabled !== false) {
      beat.overlay = {
        type: "subscribe_cta",
        showAt: ov.showAt ?? 0,
        hideAt: 1.0,
      };
      ctasApplied++;
    } else if (!beat) {
      logger?.warn(`[DEBUG] applyOverrides: CTA beatId "${ov.beatId}" not found in plan`);
    }
  }

  logger?.log(`[DEBUG] applyOverrides: cleared ${clearedCount} existing overlay(s), applied ${calloutsApplied} callout(s), ${bannersApplied} banner(s), ${ctasApplied} CTA(s)`);
}