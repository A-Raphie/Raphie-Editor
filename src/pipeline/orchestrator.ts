import fs from "fs/promises";
import path from "path";
import type { ScenePlan, PipelineState, AssetMapping } from "../types/scenePlan.js";
import { sanitizeScenePlan } from "../types/scenePlan.js";
import type { Config } from "../config.js";
import { Logger } from "../utils/logger.js";
import { parseFile } from "../utils/fileParser.js";
import { planScenes, planScenesFromSrt, addSubscribeOverlays } from "./scenePlanner.js";
import { sourceAllAssets } from "./assetSourcer.js";
import { qualityCheckAssets } from "./qualityChecker.js";
import { renderVideoSegments } from "./renderer.js";
import { renderVideoSegmentsFFmpeg } from "./ffmpeg-renderer.js";
import type { RenderSegmentState } from "../types/scenePlan.js";
import { ensureDir, deleteFile, cleanDir } from "../utils/fileManager.js";
import { getAudioDuration, setBinPaths as setStockBinPaths } from "../utils/stockApi.js";

export interface PipelineProgressEvent {
  step: string;
  current: number;
  total: number;
  percent: number;
  message: string;
}

const STEP_RANGES: Record<string, [number, number]> = {
  init: [0, 5],
  scene_planning: [5, 25],
  asset_sourcing: [25, 70],
  quality_check: [70, 85],
  rendering: [85, 100],
};

const STATE_FILE = "pipeline_state.json";
const SCENE_PLAN_FILE = "scene_plan.json";

export class Pipeline {
  private config: Config;
  private logger!: Logger;
  private state!: PipelineState;
  private statePath: string;
  private abortController: AbortController | null = null;
  public onLog?: (message: string) => void;
  public onProgress?: (progress: PipelineProgressEvent) => void;
  public onAssetBatch?: (assets: AssetMapping) => void;
  public onBeatStatus?: (beatId: string, status: string, downloadPercent?: number) => void;

  constructor(config: Config) {
    this.config = config;
    this.statePath = path.join(config.outputDir, STATE_FILE);
  }

  private createAbortSignal(): AbortSignal | undefined {
    this.abortController = new AbortController();
    return this.abortController.signal;
  }

  private async handleAssetBatch(assets: AssetMapping): Promise<void> {
    this.onAssetBatch?.(assets);
  }

  async run(scriptPath: string, voPath: string, musicPath?: string, scenePlanOverride?: any, srtPath?: string): Promise<string> {
    if (scenePlanOverride) {
      return this.runWithScenePlan(scriptPath, voPath, musicPath, scenePlanOverride, srtPath);
    }

    try {
      const stateData = await fs.readFile(this.statePath, "utf-8");
      const existing = JSON.parse(stateData) as PipelineState;
      if (
        existing.scriptPath === scriptPath &&
        existing.voPath === voPath
      ) {
        if (
          existing.status === "failed" &&
          (existing.completedSteps ?? []).length > 0
        ) {
          this.onLog?.(`Found previous failed run with ${existing.completedSteps.length} completed steps, resuming...`);
          return this.resume();
        }

        const scenePlanPath = existing.scenePlan || path.join(this.config.outputDir, SCENE_PLAN_FILE);
        try {
          await fs.access(scenePlanPath);
          this.onLog?.(`Found existing scene plan, reusing it with fresh assets...`);
          return this.rerunWithExistingPlan(scriptPath, voPath, musicPath, scenePlanPath);
        } catch {}
      }
    } catch {}

    const runId = `run_${Date.now()}`;

    this.logger = new Logger(this.config, runId);
    this.logger.onLog = (msg) => this.onLog?.(msg);
    await this.logger.init();
    setStockBinPaths(this.config.ffprobePath);

    await this.preflightCheck(scriptPath, voPath);

    this.state = {
      runId,
      status: "in_progress",
      currentStep: "init",
      completedSteps: [],
      totalBeats: 0,
      completedBeats: [],
      failedBeats: {},
      scenePlan: "",
      assets: {},
      scriptPath,
      voPath,
      musicPath: musicPath ?? "",
      renderSegments: null,
    };
    await this.saveState();

    try {
      const voDuration = await getAudioDuration(voPath);

      let scenePlan: ScenePlan;
      if (srtPath) {
        await this.logger.log(`SRT mode | VO: ${voDuration}s`);
        scenePlan = await this.runStep("scene_planning", () =>
          planScenesFromSrt(srtPath, voDuration, this.config, this.logger)
        );
      } else {
        const script = await parseFile(scriptPath);
        await this.logger.log(`Script: ${script.length} chars | VO: ${voDuration}s`);
        scenePlan = await this.runStep("scene_planning", () =>
          planScenes(script, voDuration, this.config, this.logger)
        );
      }

      this.state.totalBeats = scenePlan.beats.length;
      this.state.scenePlan = path.join(this.config.outputDir, SCENE_PLAN_FILE);
      await fs.writeFile(this.state.scenePlan, JSON.stringify(scenePlan, null, 2));
      await this.saveState();

      const { assets, failed } = await this.runStep("asset_sourcing", () =>
        sourceAllAssets(
          scenePlan.beats, this.config, this.logger, {},
          (current, total) => this.emitProgress("asset_sourcing", current, total, `Sourcing assets ${current}/${total}`),
          (a) => this.handleAssetBatch(a),
          this.createAbortSignal(),
          (beatId, status, pct) => this.onBeatStatus?.(beatId, status, pct)
        )
      );

      for (const [beatId, info] of Object.entries(failed)) {
        this.state.failedBeats[beatId] = { reason: info.reason, fallback: "lower_third" };
      }
      this.state.assets = assets;
      await this.saveState();

      const finalAssets = await this.qualityCheckLoop(scenePlan, assets);
      const verifiedAssets = await this.verifyAssetsExist(finalAssets);

      const { outputPath } = await this.runStep("rendering", () =>
        this.renderWithSegments(scenePlan, verifiedAssets, voPath, musicPath)
      );

      this.state.status = "completed";
      await this.saveState();

      await this.cleanup();

      await this.logger.log(`Pipeline complete! Output: ${outputPath}`);
      await this.logger.close();

      return outputPath;
    } catch (err: any) {
      this.state.status = "failed";
      await this.saveState();
      await this.logger.error(`Pipeline failed: ${err.message}`);
      await this.logger.close();
      throw err;
    }
  }

  private async rerunWithExistingPlan(
    scriptPath: string,
    voPath: string,
    musicPath: string | undefined,
    scenePlanPath: string
  ): Promise<string> {
    const runId = `run_${Date.now()}`;

    this.logger = new Logger(this.config, runId);
    this.logger.onLog = (msg) => this.onLog?.(msg);
    await this.logger.init();
    setStockBinPaths(this.config.ffprobePath);

    await this.preflightCheck(scriptPath, voPath);

    this.state = {
      runId,
      status: "in_progress",
      currentStep: "init",
      completedSteps: ["scene_planning"],
      totalBeats: 0,
      completedBeats: [],
      failedBeats: {},
      scenePlan: scenePlanPath,
      assets: {},
      scriptPath,
      voPath,
      musicPath: musicPath ?? "",
      renderSegments: null,
    };
    await this.saveState();

    try {
      await this.logger.log("Reusing existing scene plan...");
      const scenePlan: ScenePlan = sanitizeScenePlan(JSON.parse(await fs.readFile(scenePlanPath, "utf-8")));
      this.state.totalBeats = scenePlan.beats.length;
      await this.logger.log(`Loaded scene plan: ${scenePlan.beats.length} beats (${countByType(scenePlan, "clip")} clips, ${countByType(scenePlan, "image")} images)`);
      await this.saveState();

      const { assets, failed } = await this.runStep("asset_sourcing", () =>
        sourceAllAssets(
          scenePlan.beats, this.config, this.logger, {},
          (current, total) => this.emitProgress("asset_sourcing", current, total, `Sourcing assets ${current}/${total}`),
          (a) => this.handleAssetBatch(a),
          this.createAbortSignal(),
          (beatId, status, pct) => this.onBeatStatus?.(beatId, status, pct)
        )
      );

      for (const [beatId, info] of Object.entries(failed)) {
        this.state.failedBeats[beatId] = { reason: info.reason, fallback: "lower_third" };
      }
      this.state.assets = assets;
      await this.saveState();

      const finalAssets = await this.qualityCheckLoop(scenePlan, assets);
      const verifiedAssets = await this.verifyAssetsExist(finalAssets);

      const { outputPath } = await this.runStep("rendering", () =>
        this.renderWithSegments(scenePlan, verifiedAssets, voPath, musicPath)
      );

      this.state.status = "completed";
      await this.saveState();

      await this.cleanup();

      await this.logger.log(`Pipeline complete! Output: ${outputPath}`);
      await this.logger.close();

      return outputPath;
    } catch (err: any) {
      this.state.status = "failed";
      await this.saveState();
      await this.logger.error(`Pipeline failed: ${err.message}`);
      await this.logger.close();
      throw err;
    }
  }

  private async runWithScenePlan(
    scriptPath: string,
    voPath: string,
    musicPath: string | undefined,
    scenePlan: ScenePlan,
    srtPath?: string
  ): Promise<string> {
    sanitizeScenePlan(scenePlan);
    const runId = `run_${Date.now()}`;

    this.logger = new Logger(this.config, runId);
    this.logger.onLog = (msg) => this.onLog?.(msg);
    await this.logger.init();
    setStockBinPaths(this.config.ffprobePath);

    await this.preflightCheck(scriptPath, voPath);

    if (this.config.vfxPath) {
      let scriptText = "";
      if (srtPath) {
        const { parseSrt, srtSegmentsToScriptText } = await import("../utils/srtParser.js");
        const srtContent = await fs.readFile(srtPath, "utf-8");
        scriptText = srtSegmentsToScriptText(parseSrt(srtContent));
      } else {
        const { parseFile } = await import("../utils/fileParser.js");
        scriptText = await parseFile(scriptPath);
      }
      addSubscribeOverlays(scenePlan, scriptText);
      await this.logger.log(`Subscribe CTA overlays: ${scenePlan.beats.filter(b => b.overlay?.type === "subscribe_cta").length} beats tagged`);
    }

    const scenePlanPath = path.join(this.config.outputDir, SCENE_PLAN_FILE);
    await fs.writeFile(scenePlanPath, JSON.stringify(scenePlan, null, 2));

    this.state = {
      runId,
      status: "in_progress",
      currentStep: "init",
      completedSteps: ["scene_planning"],
      totalBeats: scenePlan.beats.length,
      completedBeats: [],
      failedBeats: {},
      scenePlan: scenePlanPath,
      assets: {},
      scriptPath,
      voPath,
      musicPath: musicPath ?? "",
      renderSegments: null,
    };
    await this.saveState();

    try {
      await this.logger.log(`Using scene plan from editor: ${scenePlan.beats.length} beats (${countByType(scenePlan, "clip")} clips, ${countByType(scenePlan, "image")} images)`);

      const { assets, failed } = await this.runStep("asset_sourcing", () =>
        sourceAllAssets(
          scenePlan.beats, this.config, this.logger, {},
          (current, total) => this.emitProgress("asset_sourcing", current, total, `Sourcing assets ${current}/${total}`),
          (a) => this.handleAssetBatch(a),
          this.createAbortSignal(),
          (beatId, status, pct) => this.onBeatStatus?.(beatId, status, pct)
        )
      );

      for (const [beatId, info] of Object.entries(failed)) {
        this.state.failedBeats[beatId] = { reason: info.reason, fallback: "lower_third" };
      }
      this.state.assets = assets;
      await this.saveState();

      const finalAssets = await this.qualityCheckLoop(scenePlan, assets);
      const verifiedAssets = await this.verifyAssetsExist(finalAssets);

      const { outputPath } = await this.runStep("rendering", () =>
        this.renderWithSegments(scenePlan, verifiedAssets, voPath, musicPath)
      );

      this.state.status = "completed";
      await this.saveState();

      await this.cleanup();

      await this.logger.log(`Pipeline complete! Output: ${outputPath}`);
      await this.logger.close();

      return outputPath;
    } catch (err: any) {
      this.state.status = "failed";
      await this.saveState();
      await this.logger.error(`Pipeline failed: ${err.message}`);
      await this.logger.close();
      throw err;
    }
  }

  async resume(): Promise<string> {
    const stateData = await fs.readFile(this.statePath, "utf-8");
    this.state = JSON.parse(stateData) as PipelineState;

    this.logger = new Logger(this.config, this.state.runId);
    this.logger.onLog = (msg) => this.onLog?.(msg);
    await this.logger.init();
    setStockBinPaths(this.config.ffprobePath);

    const completed = this.state.completedSteps ?? [];
    await this.logger.log(`Resuming pipeline. Completed steps: ${completed.join(", ") || "none"}`);

    const scenePlanPath = this.state.scenePlan || path.join(this.config.outputDir, SCENE_PLAN_FILE);
    let scenePlan: ScenePlan;

    if (completed.includes("scene_planning")) {
      scenePlan = sanitizeScenePlan(JSON.parse(await fs.readFile(scenePlanPath, "utf-8")));
      await this.logger.log(`Loaded scene plan: ${scenePlan.beats.length} beats`);
    } else {
      const script = await parseFile(this.state.scriptPath);
      const voDuration = await getAudioDuration(this.state.voPath);
      await this.logger.log(`Script: ${script.length} chars | VO: ${voDuration}s`);

      scenePlan = await this.runStep("scene_planning", () =>
        planScenes(script, voDuration, this.config, this.logger)
      );

      this.state.totalBeats = scenePlan.beats.length;
      this.state.scenePlan = path.join(this.config.outputDir, SCENE_PLAN_FILE);
      await fs.writeFile(this.state.scenePlan, JSON.stringify(scenePlan, null, 2));
      await this.saveState();
    }

    let assets = { ...this.state.assets };

    if (!completed.includes("asset_sourcing")) {
      const result = await this.runStep("asset_sourcing", () =>
        sourceAllAssets(
          scenePlan.beats, this.config, this.logger, assets,
          (current, total) => this.emitProgress("asset_sourcing", current, total, `Sourcing assets ${current}/${total}`),
          (a) => this.handleAssetBatch(a),
          this.createAbortSignal(),
          (beatId, status, pct) => this.onBeatStatus?.(beatId, status, pct)
        )
      );

      for (const [beatId, info] of Object.entries(result.failed)) {
        this.state.failedBeats[beatId] = { reason: info.reason, fallback: "lower_third" };
      }
      assets = result.assets;
      this.state.assets = assets;
      await this.saveState();
    } else {
      await this.logger.log(`Skipping asset_sourcing (already complete, ${Object.keys(assets).length} assets)`);
    }

    let finalAssets: AssetMapping;

    if (!completed.includes("quality_check")) {
      finalAssets = await this.qualityCheckLoop(scenePlan, assets);
    } else {
      await this.logger.log("Skipping quality_check (already complete)");
      finalAssets = assets;
    }

    finalAssets = await this.verifyAssetsExist(finalAssets);

    const { outputPath } = await this.runStep("rendering", () =>
      this.renderWithSegments(scenePlan, finalAssets, this.state.voPath, this.state.musicPath || undefined)
    );

    this.state.status = "completed";
    await this.saveState();
    await this.cleanup();

    await this.logger.log(`Pipeline complete! Output: ${outputPath}`);
    await this.logger.close();

    return outputPath;
  }

  private async renderWithSegments(
    scenePlan: ScenePlan,
    assets: AssetMapping,
    voPath: string | undefined,
    musicPath: string | undefined
  ): Promise<{ outputPath: string }> {
    const existingState = this.state.renderSegments;
    const completedSoFar = existingState?.completedSegments
      ? [...existingState.completedSegments]
      : [] as number[];
    let totalSegments = existingState?.totalSegments ?? 0;
    let segmentLength = existingState?.segmentLength ?? this.config.segmentLength ?? 900;
    let segmentDir = existingState?.segmentDir ?? "";

    const parallelSegments = this.config.parallelSegments ?? 1;
    const useFFmpeg = (this.config as any).renderer === "ffmpeg";

    const renderFn = useFFmpeg ? renderVideoSegmentsFFmpeg : renderVideoSegments;
    const rendererLabel = useFFmpeg ? "FFmpeg" : "Remotion";

    const { outputPath } = await renderFn(
      scenePlan,
      assets,
      this.config,
      this.logger,
      voPath,
      musicPath,
      existingState,
      {
        onSegmentsInit: (info) => {
          totalSegments = info.totalSegments;
          segmentLength = info.segmentLength;
          segmentDir = info.segmentDir;
        },
        onSegmentProgress: (seg, total, frameProgress) => {
          totalSegments = total;
          const done = completedSoFar.length;
          const pct = Math.round(((done + frameProgress) / total) * 100);
          const framePct = Math.round(frameProgress * 100);
          this.emitProgress("rendering", pct, 100, `Rendering segment ${seg + 1}/${total} — ${framePct}%`);
        },
        onSegmentComplete: async (seg) => {
          completedSoFar.push(seg);
          this.state.renderSegments = {
            segmentLength,
            completedSegments: [...completedSoFar],
            totalSegments,
            segmentDir,
          };
          await this.saveState();
        },
        parallelSegments,
      }
    );

    this.state.renderSegments = null;
    return { outputPath };
  }

  private async runStep<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
    this.state.currentStep = stepName;
    await this.saveState();
    await this.logger.log(`Starting step: ${stepName}`);
    this.emitProgress(stepName, 0, 1, `${stepName}...`);

    const result = await fn();

    const steps = this.state.completedSteps ?? [];
    if (!steps.includes(stepName)) {
      steps.push(stepName);
    }
    this.state.completedSteps = steps;
    await this.saveState();
    await this.logger.log(`Completed step: ${stepName}`);
    return result;
  }

  private emitProgress(step: string, current: number, total: number, message: string): void {
    const range = STEP_RANGES[step] ?? [0, 100];
    const stepPercent = total > 0 ? current / total : 0;
    const percent = Math.round(range[0] + (range[1] - range[0]) * stepPercent);
    this.onProgress?.({ step, current, total, percent, message });
  }

  private async qualityCheckLoop(
    scenePlan: ScenePlan,
    assets: AssetMapping,
    maxRounds = 5
  ): Promise<AssetMapping> {
    let currentAssets = { ...assets };
    let allRejectedBeatIds: string[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      const { accepted, rejected } = await this.runStep("quality_check", () =>
        qualityCheckAssets(scenePlan.beats, currentAssets, this.config, this.logger)
      );

      if (rejected.length === 0) {
        await this.logger.log(`Quality check round ${round}: all ${Object.keys(accepted).length} assets passed`);
        return accepted;
      }

      await this.logger.log(`Quality check round ${round}: ${Object.keys(accepted).length} accepted, ${rejected.length} rejected`);

      if (round < maxRounds) {
        const failedBeats = scenePlan.beats.filter((b) => rejected.includes(b.id));
        await this.logger.log(`Re-sourcing ${failedBeats.length} rejected assets...`);

        const { assets: newAssets, failed } = await this.runStep("asset_sourcing", () =>
          sourceAllAssets(
            failedBeats, this.config, this.logger, {},
            (current, total) => this.emitProgress("asset_sourcing", current, total, `Re-sourcing ${current}/${total}`),
            (a) => this.handleAssetBatch(a),
            this.createAbortSignal(),
            (beatId, status, pct) => this.onBeatStatus?.(beatId, status, pct)
          )
        );

        currentAssets = { ...accepted, ...newAssets };

        for (const [beatId, info] of Object.entries(failed)) {
          allRejectedBeatIds.push(beatId);
          this.state.failedBeats[beatId] = { reason: info.reason, fallback: "lower_third" };
        }
      } else {
        allRejectedBeatIds = rejected;
      }
    }

    return this.resolveFallbacks(scenePlan, currentAssets, allRejectedBeatIds);
  }

  private resolveFallbacks(
    scenePlan: ScenePlan,
    accepted: AssetMapping,
    rejected: string[]
  ): AssetMapping {
    const finalAssets = { ...accepted };

    for (const beatId of rejected) {
      const beat = scenePlan.beats.find((b) => b.id === beatId);
      if (beat) {
        this.state.failedBeats[beatId] = {
          reason: this.state.failedBeats[beatId]?.reason ?? "Quality check rejected",
          fallback: "lower_third",
        };
      }
      delete finalAssets[beatId];
    }

    return finalAssets;
  }

  private async verifyAssetsExist(assets: AssetMapping): Promise<AssetMapping> {
    const verified: AssetMapping = {};
    let missing = 0;
    for (const [id, absPath] of Object.entries(assets)) {
      try {
        await fs.access(absPath);
        verified[id] = absPath;
      } catch {
        missing++;
        await this.logger.warn(`Missing asset file for ${id}: ${absPath}`);
      }
    }
    if (missing > 0) {
      await this.logger.warn(`${missing} asset file(s) missing, excluded from render`);
    }
    return verified;
  }

  private async saveState(): Promise<void> {
    await ensureDir(this.config.outputDir);
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
  }

  private async preflightCheck(scriptPath: string, voPath: string): Promise<void> {
    await this.logger.log("Running pre-flight checks...");

    if (!this.config.pexelsApiKey && !this.config.pixabayApiKey) {
      throw new Error("At least one stock footage API key (Pexels or Pixabay) is required");
    }

    if (!this.config.openrouterApiKeys || this.config.openrouterApiKeys.length === 0) {
      throw new Error("OPENROUTER_API_KEY not set");
    }

    const scriptExists = await fs.access(scriptPath).then(() => true).catch(() => false);
    if (!scriptExists) throw new Error(`Script file not found: ${scriptPath}`);

    const voExists = await fs.access(voPath).then(() => true).catch(() => false);
    if (!voExists) throw new Error(`VO file not found: ${voPath}`);

    try {
      const { execFile } = require("child_process");
      const { promisify } = require("util");
      const execFileAsync = promisify(execFile);
      await execFileAsync(this.config.ffmpegPath, ["-version"]);
    } catch {
      throw new Error(`ffmpeg not found at: ${this.config.ffmpegPath}`);
    }

    await ensureDir(this.config.outputDir);
    await ensureDir(this.config.tempDir);
    await ensureDir(this.config.clipsDir);
    await ensureDir(this.config.imagesDir);

    await this.logger.log("Pre-flight checks passed");
  }

  private async cleanup(): Promise<void> {
    await this.logger.log("Cleaning up temp files...");
    await cleanDir(this.config.tempDir);
    await this.logger.log("Cleanup complete");
  }

  async renderOnly(): Promise<string> {
    const stateData = await fs.readFile(this.statePath, "utf-8");
    this.state = JSON.parse(stateData) as PipelineState;
    const runId = `render_${Date.now()}`;
    this.logger = new Logger(this.config, runId);
    this.logger.onLog = (msg) => this.onLog?.(msg);
    await this.logger.init();
    setStockBinPaths(this.config.ffprobePath);

    const scenePlanPath = this.state.scenePlan || path.join(this.config.outputDir, SCENE_PLAN_FILE);
    const scenePlan = sanitizeScenePlan(JSON.parse(await fs.readFile(scenePlanPath, "utf-8")));
    await this.logger.log(`Render-only: ${scenePlan.beats.length} beats`);

    const missing = scenePlan.beats
      .filter((b) => b.type === "clip" || b.type === "image")
      .filter((b) => !this.state.assets[b.id]);
    if (missing.length > 0) {
      const details = missing.map((b) => `${b.id} (${b.searchQuery})`).join(", ");
      throw new Error(`Cannot render: ${missing.length} beat(s) have no assets: ${details}`);
    }

    const verifiedAssets = await this.verifyAssetsExist(this.state.assets);
    const droppedCount = Object.keys(this.state.assets).length - Object.keys(verifiedAssets).length;
    if (droppedCount > 0) {
      const details = Object.keys(this.state.assets)
        .filter((id) => !verifiedAssets[id])
        .map((id) => `${id} (${scenePlan.beats.find((b) => b.id === id)?.searchQuery ?? "unknown"})`)
        .join(", ");
      throw new Error(`Cannot render: ${droppedCount} asset(s) are missing or corrupt: ${details}`);
    }

    this.state.status = "in_progress";
    this.state.currentStep = "rendering";
    await this.saveState();

    try {
      const { outputPath } = await this.runStep("rendering", () =>
        this.renderWithSegments(scenePlan, verifiedAssets, this.state.voPath, this.state.musicPath || undefined)
      );
      this.state.outputPath = outputPath;
      this.state.status = "completed";
      await this.saveState();
      await this.cleanup();
      await this.logger.log(`Render complete! Output: ${outputPath}`);
      await this.logger.close();
      return outputPath;
    } catch (err: any) {
      this.state.status = "failed";
      await this.saveState();
      await this.logger.error(`Render failed: ${err.message}`);
      await this.logger.close();
      throw err;
    }
  }

  async renderNew(): Promise<string> {
    try {
      const stateData = await fs.readFile(this.statePath, "utf-8");
      this.state = JSON.parse(stateData) as PipelineState;
      this.state.renderSegments = null;
      await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
    } catch {}
    return this.renderOnly();
  }
}

function countByType(plan: ScenePlan, type: string): number {
  return plan.beats.filter((b) => b.type === type).length;
}
