import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { IPC_CHANNELS } from "../shared/types";
import type { AppSettings, RunPipelineArgs, PipelineProgress, SavedProject } from "../shared/types";
import {
  getProjectRoot,
  getSettingsPath,
  getOutputDir,
  getTempDir,
  getClipsDir,
  getImagesDir,
  getLogDir,
  getAssetsDir,
  getInputDir,
  getRemotionEntryPath,
  getRemotionPublicDir,
  getFfmpegPath,
  getFfprobePath,
  getVfxPath,
  ensureProjectDirs,
} from "./services/paths";
import * as projectsService from "./services/projects";
import { parseCommaList } from "../../src/config";

const execFileAsync = promisify(execFile);
const SETTINGS_PATH = getSettingsPath();

const DEFAULT_QUALITY_PROMPT = `You are a visual quality checker. You receive a search query and an image. Your ONLY job is to determine if the image visually matches the search query.

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

const DEFAULT_PLANNER_RULES = `IF the script is a COUNT-UP or RANKED LIST (e.g. "Number 1, [item]", "#2 [item]"):
- The script is divided into NUMBERED SECTIONS starting with "Number N, [item name]"
- Each section covers ONE specific item
- ALL beats within a section MUST use search queries featuring ONLY that specific item
- Do NOT use imagery from a different item in another item's section
- When the next "Number [N]," appears, switch to that new item
- Every searchQuery must include the section's item name or a closely related visual
- VARY the visuals: show different angles, parts, preparations, stages, close-ups
- Never reuse the same searchQuery in the same section
- When script mentions benefits → show THAT item specifically
- When script mentions preparation → show THAT item being prepared
- ALWAYS anchor the query to the section's item, never to abstract concepts

EXAMPLES — replace [item] with each section's actual topic:
- Section about [item] (e.g. "honey"): "raw honey jar", "honey dripping off spoon", "honeycomb close-up", "honey stirred into tea" ✓
  - "natural remedy" ✗ (no honey) — "sweet liquid" ✗ (no honey)
- Section about [item] (e.g. "aloe vera"): "aloe vera plant", "aloe gel scooped", "aloe leaf close-up", "aloe drink poured" ✓
  - "green plant" ✗ (not specific) — "healthy drink" ✗ (no aloe vera)`;

const DEFAULT_SEARCH_QUERY_RULES = `You are choosing what appears on screen for EACH beat. The searchQuery describes the visual footage/image to find on stock sites (Pexels, Pixabay).

CRITICAL — EACH QUERY MUST MATCH ITS OWN SEGMENT:
- Every beat covers a specific segment of narration. The searchQuery MUST visually represent what THAT specific segment is talking about
- Read each segment's text, understand what is being described IN THAT MOMENT, then write a query for that visual
- Do NOT carry visuals from one part of the script into a different part
- BAD: segment says "wellness startup or juice bar" → searchQuery: "old bible close up" (this is from a completely different part of the script)
- GOOD: segment says "wellness startup or juice bar" → searchQuery: "juice bar counter" or "smoothie shop interior"
- GOOD: segment says "described right there in the pages" → searchQuery: "old leather bible pages" or "ancient manuscript"
- BAD: segment says "healing properties of turmeric" → searchQuery: "sunset ocean" (unrelated visual)
- GOOD: segment says "healing properties of turmeric" → searchQuery: "turmeric powder" or "spice market"

TRANSLATION RULES:
- ALWAYS translate into what a stock photographer would actually photograph and tag
- NEVER copy script phrases directly into searchQuery — translate to concrete searchable visuals
- Ask yourself: "what image would I search for on a stock site to illustrate what this specific sentence is saying?"
- 1-3 COMMON, CONCRETE keywords per query
- Use BROAD terms: "tropical plant" not "Monstera deliciosa variegata"
- If the segment is abstract, pick the closest concrete visual: "biblical era" → "desert landscape", "ancient temple", "olive tree"
- ALWAYS describe WHAT APPEARS ON SCREEN, not the script's abstract MEANING
- Single common nouns work great: "seedling", "sunset", "ocean", "cat", "food"
- Every query MUST contain at least one word a stock photographer would use as a tag

Good queries (stock photographers tag these): "fern", "cactus", "moss", "watering plants", "greenhouse", "rainforest", "roots", "bee flower", "seedling", "ivy", "orchid", "mushroom", "compost", "leaf", "flower", "tree", "sunset", "ocean", "mountain", "city", "cat", "dog", "food", "juice bar", "old book", "ancient ruins"
Bad queries (nothing on stock sites): "agricultural innovation sustainable farming technology", "ethereal bioluminescent mushroom glow", "plant wisdom", "metaphysical healing"

- NEVER use "subscribe" as searchQuery (ABSOLUTELY NEVER)
- When script mentions CTA ("subscribe", "like"), use a neutral query matching the surrounding context
- Never reuse the same searchQuery across different beats — every beat MUST have a unique searchQuery
- VARY your queries: use different angles, close-ups, stages, and perspectives even for the same subject`;

const DEFAULT_SETTINGS: AppSettings = {
  openrouterApiKeys: [],
  scenePlannerModel: "deepseek/deepseek-v4-flash",
  qualityCheckerModel: "google/gemma-3-4b-it",
  concurrency: 4,
  previewConcurrency: 10,
  renderConcurrency: 3,
  fps: 30,
  downloadResolution: 1080,
  downloadTimeout: 0,
  qualityCheckPrompt: DEFAULT_QUALITY_PROMPT,
  scenePlannerRules: DEFAULT_PLANNER_RULES,
  searchQueryRules: DEFAULT_SEARCH_QUERY_RULES,
  contentRules: `This is a PLANT/BOTANICAL documentary. EVERY search query MUST include plant/botanical visual context.

RULES:
- NEVER generate a searchQuery that has NO plant/botanical element
- If the script describes a non-plant action (pouring, cooking, drinking), ADD plant context: "herbal tea pouring", "plant infusion in glass", "medicinal herbs on table"
- Translate abstract concepts into plant visuals: "healing" → "medicinal herbs", "ancient remedy" → "dried herbs mortar", "healthy drink" → "green juice herbs"
- Every query must contain at least one botanical term: plant, herb, leaf, flower, root, seed, garden, botanical, green, nature, moss, fern, tree, grass, vine, etc.
- EXAMPLE translations:
  - "glass cup pouring water" → "herbal tea pouring glass" or "plant infusion glass"
  - "healthy lifestyle" → "herbal garden" or "fresh herbs"
  - "traditional medicine" → "medicinal herbs" or "dried botanicals"
  - "kitchen preparation" → "herbs on cutting board" or "fresh basil"
  - "ancient wisdom" → "old botanical book" or "dried herbs ancient"
- Be specific about species, processes, and camera angles where possible`,
  acceptedContexts: [
    "plants",
    "seeds",
    "roots",
    "soil",
    "herbs",
    "flowers",
    "trees",
    "leaves",
    "farming",
    "food preparation",
    "juice",
    "botanical",
    "nature",
    "agriculture",
    "fruits",
    "vegetables",
    "greenhouse",
    "garden",
    "compost",
    "mushroom",
  ],
  hookDuration: 60,
  hookClipMin: 2,
  hookClipMax: 3,
  bodyClipMin: 5,
  bodyClipMax: 6,
  maxThumbnailsPerQuery: 5,
  cleanupAfterDays: 0,
  enableQualityCheckOnPreview: true,
  renderer: "remotion",
  tempCleanupDays: 1,
};

function buildConfigOverrides(settings: AppSettings, projectId?: string, args?: any) {
  const previewRes = args?.previewResolution ?? settings.previewResolution ?? 1080;
  return {
    openrouterApiKeys: settings.openrouterApiKeys ?? [],
    scenePlannerModel: settings.scenePlannerModel,
    qualityCheckerModel: settings.qualityCheckerModel,
    pexelsApiKey: settings.pexelsApiKey ?? "",
    pixabayApiKey: settings.pixabayApiKey ?? "",
    clipPercent: settings.clipPercent ?? 70,
    imagePercent: settings.imagePercent ?? 30,
    concurrency: settings.concurrency,
    previewConcurrency: settings.previewConcurrency ?? 10,
    renderConcurrency: settings.renderConcurrency ?? 3,
    fps: settings.fps,
    downloadResolution: settings.downloadResolution,
    downloadTimeout: (settings.downloadTimeout ?? 0) * 1000,
    outputDir: getOutputDir(projectId),
    tempDir: getTempDir(projectId),
    clipsDir: getClipsDir(projectId),
    imagesDir: getImagesDir(projectId),
    logDir: getLogDir(projectId),
    assetsDir: getAssetsDir(),
    inputDir: getInputDir(),
    remotionEntryPath: getRemotionEntryPath(),
    remotionPublicDir: getRemotionPublicDir(),
    ffmpegPath: getFfmpegPath(),
    ffprobePath: getFfprobePath(),
    vfxPath: getVfxPath(),
    qualityCheckPrompt: settings.qualityCheckPrompt ?? "",
    scenePlannerRules: settings.scenePlannerRules ?? "",
    searchQueryRules: settings.searchQueryRules ?? "",
    contentRules: settings.contentRules ?? "",
    acceptedContexts: settings.acceptedContexts ?? [],
    hookDuration: settings.hookDuration ?? 60,
    hookClipMin: settings.hookClipMin ?? 2,
    hookClipMax: settings.hookClipMax ?? 3,
    bodyClipMin: settings.bodyClipMin ?? 5,
    bodyClipMax: settings.bodyClipMax ?? 6,
    maxThumbnailsPerQuery: settings.maxThumbnailsPerQuery ?? 5,
    musicVolume: settings.musicVolume ?? 15,
    videoCodec: settings.videoCodec ?? "h265",
    qualityScoreThreshold: settings.qualityScoreThreshold ?? 5,
    segmentLength: settings.segmentLength ?? 900,
    enableVignette: settings.enableVignette ?? true,
    enableColorGrade: settings.enableColorGrade ?? true,
    subscribeOverlaySize: settings.subscribeOverlaySize ?? 30,
    forbiddenWords: parseCommaList(settings.forbiddenWords ?? ""),
    genericFallbacks: parseCommaList(settings.genericFallbacks ?? ""),
    cleanupAfterRender: settings.cleanupAfterRender ?? true,
    cleanupAfterDays: settings.cleanupAfterDays ?? 0,
    parallelSegments: settings.parallelSegments ?? 1,
    previewResolution: previewRes,
    srtChunkSize: settings.srtChunkSize ?? 25,
    srtChunkDelayMs: settings.srtChunkDelayMs ?? 0,
    renderer: settings.renderer ?? "remotion",
    tempCleanupDays: settings.tempCleanupDays ?? 1,
  };
}

export function registerIpcHandlers(win: BrowserWindow): void {
  let activePipeline: any = null;

  for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel);

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    return loadSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_SETTINGS, async (_, settings: AppSettings) => {
    await fs.promises.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.GET_MODEL_UPTIME, async (_, model: string) => {
    try {
      const settings = loadSettings();
      const apiKey = settings.openrouterApiKeys?.[0];
      if (!apiKey) return null;
      const [author, slug] = model.split("/");
      const resp = await fetch(`https://openrouter.ai/api/v1/models/${author}/${slug}/endpoints`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      const endpoints = json?.data?.endpoints;
      if (!endpoints || endpoints.length === 0) return null;
      let bestUptime: number | null = null;
      for (const ep of endpoints) {
        if (typeof ep.uptime_last_5m === "number") {
          if (bestUptime === null || ep.uptime_last_5m > bestUptime) {
            bestUptime = ep.uptime_last_5m;
          }
        }
      }
      return bestUptime;
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SELECT_FILES, async (_, options: { filters?: any[]; multiple?: boolean }) => {
    const result = await dialog.showOpenDialog(win, {
      properties: [options.multiple ? "multiSelections" : "openFile", "openFile"],
      filters: options.filters ?? [
        { name: "Audio", extensions: ["mp3", "wav", "m4a", "aac"] },
        { name: "Text", extensions: ["txt", "md"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle(
    IPC_CHANNELS.PREVIEW_SCENE_PLAN,
    async (_, scriptPath: string, voPath: string, projectId: string, srtPath: string) => {
      const { createConfig } = await import("../../src/config");
      ensureProjectDirs(projectId);

      const settings = loadSettings();
      process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

      const config = createConfig(buildConfigOverrides(settings, projectId));

      const { setBinPaths, setMinResolution } = await import("../../src/utils/stockApi");
      setBinPaths(config.ffprobePath);
      setMinResolution(config.downloadResolution);

      const { planScenes, planScenesFromSrt } = await import("../../src/pipeline/scenePlanner");
      const { getAudioDuration } = await import("../../src/utils/stockApi");
      const { Logger } = await import("../../src/utils/logger");

      if (!win.isDestroyed()) {
        win.webContents.send(
          IPC_CHANNELS.PIPELINE_LOG,
          srtPath ? "Starting scene plan preview from SRT..." : "Starting scene plan preview..."
        );
      }

      const voDuration = await getAudioDuration(voPath);

      const logger = new Logger(config, `preview_${Date.now()}`);
      logger.onLog = (msg: string) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_LOG, msg);
        }
      };
      await logger.init();

      let scenePlan;
      if (srtPath) {
        scenePlan = await planScenesFromSrt(srtPath, voDuration, config, logger);
      } else if (scriptPath) {
        const { parseFile } = await import("../../src/utils/fileParser");
        scenePlan = await planScenes(await parseFile(scriptPath), voDuration, config, logger);
      } else {
        throw new Error("Either scriptPath or srtPath is required");
      }

      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SCENE_PLAN_READY, scenePlan);
      }

      return scenePlan;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RUN_PIPELINE,
    async (_, args: RunPipelineArgs) => {
      const { createConfig } = await import("../../src/config");
      const { Pipeline } = await import("../../src/pipeline/orchestrator");

      ensureProjectDirs();

      const settings = loadSettings();
      process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

      const pipeline = new Pipeline(createConfig(buildConfigOverrides(settings, args.projectId, args)));
      activePipeline = pipeline;

      pipeline.onLog = (msg: string) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_LOG, msg);
        }
      };
      pipeline.onProgress = (p: PipelineProgress) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_PROGRESS, p);
        }
      };
      pipeline.onAssetBatch = (assets: any) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.ASSET_DOWNLOADED, assets);
        }
      };
      pipeline.onBeatStatus = (beatId: string, status: string, downloadPercent?: number) => {
        console.log(
          `[BEAT_STATUS] ${beatId}: ${status}`,
          downloadPercent !== undefined ? `${downloadPercent}%` : ""
        );
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.BEAT_STATUS, beatId, status, downloadPercent);
        }
      };

      try {
        const outputPath = await pipeline.run(
          args.scriptPath,
          args.voPath,
          args.musicPath,
          args.scenePlan
        );

        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_COMPLETE, outputPath);
        }

        return outputPath;
      } catch (err: any) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_ERROR, err.stack || err.message);
        }
        throw err;
      } finally {
        activePipeline = null;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.RESUME_PIPELINE, async (_, projectId: string) => {
    const { createConfig } = await import("../../src/config");
    const { Pipeline } = await import("../../src/pipeline/orchestrator");

    ensureProjectDirs(projectId);

    const settings = loadSettings();
    process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

    const config = createConfig(buildConfigOverrides(settings, projectId));

    const { setBinPaths, setMinResolution } = await import("../../src/utils/stockApi");
    setBinPaths(config.ffprobePath);
    setMinResolution(config.downloadResolution);

    const pipeline = new Pipeline(config);
    activePipeline = pipeline;

    pipeline.onLog = (msg: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.PIPELINE_LOG, msg);
      }
    };
    pipeline.onProgress = (p: PipelineProgress) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.PIPELINE_PROGRESS, p);
      }
    };
    pipeline.onAssetBatch = (assets: any) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.ASSET_DOWNLOADED, assets);
      }
    };
    pipeline.onBeatStatus = (beatId: string, status: string, downloadPercent?: number) => {
      console.log(
        `[BEAT_STATUS] ${beatId}: ${status}`,
        downloadPercent !== undefined ? `${downloadPercent}%` : ""
      );
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.BEAT_STATUS, beatId, status, downloadPercent);
      }
    };

    try {
      const outputPath = await pipeline.resume();
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.PIPELINE_COMPLETE, outputPath);
      }
      return outputPath;
    } catch (err: any) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.PIPELINE_ERROR, err.stack || err.message);
      }
      throw err;
    } finally {
      activePipeline = null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.CANCEL_PIPELINE, async () => {
    if (activePipeline) activePipeline.cancel();
    return true;
  });

  ipcMain.handle(
    IPC_CHANNELS.RENDER_VIDEO,
    async (
      _,
      projectId: string,
      scriptPath: string,
      voPath: string,
      musicPath: string,
      mode: string,
      srtPath: string,
      previewResolution: number
    ) => {
      const { createConfig } = await import("../../src/config");
      const { Pipeline } = await import("../../src/pipeline/orchestrator");
      const { setBinPaths, setMinResolution } = await import("../../src/utils/stockApi");

      ensureProjectDirs(projectId);

      const settings = loadSettings();
      process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

      const config = createConfig(buildConfigOverrides(settings, projectId, { previewResolution }));
      setBinPaths(config.ffprobePath);
      setMinResolution(config.downloadResolution);

      const outputDir = getOutputDir(projectId);
      const statePath = path.join(outputDir, "pipeline_state.json");
      let hasExistingAssets = false;

      if (fs.existsSync(statePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          if (Object.keys(state.assets ?? {}).length > 0) {
            hasExistingAssets = true;
          } else {
            const scenePlanPath =
              state.scenePlan || path.join(outputDir, "scene_plan.json");
            if (fs.existsSync(scenePlanPath)) {
              const plan = JSON.parse(fs.readFileSync(scenePlanPath, "utf-8"));
              const clipsDir = getClipsDir(projectId);
              const imagesDir = getImagesDir(projectId);
              const recovered: Record<string, string> = {};
              for (const beat of plan.beats || []) {
                if (beat.type === "clip") {
                  const p = path.join(clipsDir, `${beat.id}.mp4`);
                  if (fs.existsSync(p)) recovered[beat.id] = p;
                } else if (beat.type === "image") {
                  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
                    const p = path.join(imagesDir, `${beat.id}${ext}`);
                    if (fs.existsSync(p)) {
                      recovered[beat.id] = p;
                      break;
                    }
                  }
                }
              }
              if (Object.keys(recovered).length > 0) {
                state.assets = recovered;
                fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
                hasExistingAssets = true;
              }
            }
          }
        } catch {}
      }

      if (activePipeline) {
        activePipeline.cancel();
        activePipeline = null;
      }

      const pipeline = new Pipeline(config);
      activePipeline = pipeline;

      pipeline.onLog = (msg: string) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_LOG, msg);
        }
      };
      pipeline.onProgress = (p: PipelineProgress) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_PROGRESS, p);
        }
      };
      pipeline.onAssetBatch = (assets: any) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.ASSET_DOWNLOADED, assets);
        }
      };
      pipeline.onBeatStatus = (beatId: string, status: string, downloadPercent?: number) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.BEAT_STATUS, beatId, status, downloadPercent);
        }
      };

      try {
        let outputPath;
        if (hasExistingAssets && mode === "continue") {
          outputPath = await pipeline.renderOnly(voPath, musicPath);
        } else if (hasExistingAssets && mode === "render") {
          outputPath = await pipeline.renderNew(voPath, musicPath);
        } else if (hasExistingAssets) {
          outputPath = await pipeline.renderNew(voPath, musicPath);
        } else {
          outputPath = await pipeline.run(scriptPath, voPath, musicPath, undefined, srtPath);
        }

        if (!outputPath) {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.PIPELINE_COMPLETE, "");
          }
          return "";
        }

        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_COMPLETE, outputPath);
        }
        return outputPath;
      } catch (err: any) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_ERROR, err.stack || err.message);
        }
        throw err;
      } finally {
        activePipeline = null;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.SOURCE_ALL_ASSETS, async (_, projectId: string) => {
    const { createConfig } = await import("../../src/config");
    const { sourceAllAssets } = await import("../../src/pipeline/assetSourcer");
    const { setBinPaths, setMinResolution } = await import("../../src/utils/stockApi");

    ensureProjectDirs(projectId);

    const settings = loadSettings();
    process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

    const config = createConfig(buildConfigOverrides(settings, projectId));
    setBinPaths(config.ffprobePath);
    setMinResolution(config.downloadResolution);

    const outputDir = getOutputDir(projectId);
    const statePath = path.join(outputDir, "pipeline_state.json");
    const scenePlanPath = path.join(outputDir, "scene_plan.json");

    if (!fs.existsSync(scenePlanPath)) {
      throw new Error("No scene plan found. Generate one first.");
    }

    let state: any = {};
    if (fs.existsSync(statePath)) {
      try {
        state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      } catch {}
    }

    const plan = JSON.parse(fs.readFileSync(scenePlanPath, "utf-8"));
    const existingAssets: Record<string, string> = state.assets ?? {};
    const clipsDir = getClipsDir(projectId);
    const imagesDir = getImagesDir(projectId);

    for (const beat of plan.beats || []) {
      if (existingAssets[beat.id]) continue;
      if (beat.type === "clip") {
        const p = path.join(clipsDir, `${beat.id}.mp4`);
        if (fs.existsSync(p)) existingAssets[beat.id] = p;
      } else if (beat.type === "image") {
        for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
          const p = path.join(imagesDir, `${beat.id}${ext}`);
          if (fs.existsSync(p)) {
            existingAssets[beat.id] = p;
            break;
          }
        }
      }
    }

    const missingBeats = (plan.beats || []).filter(
      (b: any) => (b.type === "clip" || b.type === "image") && !existingAssets[b.id]
    );

    if (missingBeats.length === 0) {
      state.assets = existingAssets;
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.ASSET_DOWNLOADED, existingAssets);
      }
      return {
        sourced: 0,
        total: Object.keys(existingAssets).length,
      };
    }

    const { Logger } = await import("../../src/utils/logger");
    const logger = new Logger(config, `source-all-${Date.now()}`);
    logger.onLog = () => {};
    await logger.init();

    const emitBeatStatus = (
      beatId: string,
      status: string,
      downloadPercent?: number,
      error?: string,
      errorDetails?: string
    ) => {
      if (!win.isDestroyed()) {
        win.webContents.send(
          IPC_CHANNELS.BEAT_STATUS,
          beatId,
          status,
          downloadPercent,
          error,
          errorDetails
        );
      }
    };

    const onBeatStatus = (beatId: string, status: string, downloadPercent?: number) => {
      emitBeatStatus(beatId, status, downloadPercent);
    };

    const onAssetBatch = (newAssets: Record<string, string>) => {
      Object.assign(existingAssets, newAssets);
      state.assets = { ...existingAssets };
      try {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      } catch {}
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.ASSET_DOWNLOADED, existingAssets);
      }
    };

    const result = await sourceAllAssets(
      missingBeats,
      config,
      logger,
      {},
      (current: number, total: number) => {
        if (!win.isDestroyed()) {
          const pct = Math.round((current / total) * 100);
          win.webContents.send(IPC_CHANNELS.PIPELINE_PROGRESS, {
            step: "asset_sourcing",
            current,
            total,
            percent: 25 + Math.round(pct * 0.45),
            message: `Sourcing assets ${current}/${total}`,
          });
        }
      },
      onAssetBatch,
      undefined,
      onBeatStatus
    );

    const { dedupAndRedownload } = await import("../../src/pipeline/dedupChecker");
    const dedupResult = await dedupAndRedownload(
      missingBeats,
      result.assets,
      config,
      logger,
      (current: number, total: number) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PIPELINE_PROGRESS, {
            step: "asset_sourcing",
            current,
            total,
            percent: 25 + Math.round((current / total) * 0.45),
            message: `Dedup re-download ${current}/${total}`,
          });
        }
      },
      async (a: Record<string, string>) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.ASSET_DOWNLOADED, {
            ...existingAssets,
            ...a,
          });
        }
      },
      undefined,
      onBeatStatus
    );

    const finalAssets = {
      ...existingAssets,
      ...dedupResult.assets,
    };
    state.assets = finalAssets;
    if (!state.completedSteps) state.completedSteps = [];
    if (!state.completedSteps.includes("asset_sourcing")) {
      state.completedSteps.push("asset_sourcing");
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    await logger.close();

    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.ASSET_DOWNLOADED, finalAssets);
    }

    return {
      sourced: missingBeats.length - Object.keys(result.failed).length,
      total: Object.keys(finalAssets).length,
      failed: Object.keys(result.failed).length,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PREVIEW_CLEAN, async (_, projectId: string) => {
    const outputDir = getOutputDir(projectId);
    const scenePlanPath = path.join(outputDir, "scene_plan.json");
    const clipsDir = getClipsDir(projectId);
    const imagesDir = getImagesDir(projectId);
    const thumbsDir = path.join(outputDir, "thumbs");

    if (!fs.existsSync(scenePlanPath)) {
      return { clips: 0, images: 0, thumbs: 0, total: 0 };
    }

    const plan = JSON.parse(fs.readFileSync(scenePlanPath, "utf-8"));
    const validBeatIds = new Set((plan.beats || []).map((b: any) => b.id));
    const counts = { clips: 0, images: 0, thumbs: 0, total: 0 };

    for (const [dir, key] of [
      [clipsDir, "clips"],
      [imagesDir, "images"],
      [thumbsDir, "thumbs"],
    ] as [string, "clips" | "images" | "thumbs"][]) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.startsWith(".")) continue;
        const beatId = path.basename(file, path.extname(file));
        if (!validBeatIds.has(beatId)) {
          counts[key]++;
          counts.total++;
        }
      }
    }

    return counts;
  });

  ipcMain.handle(IPC_CHANNELS.CLEAN_ASSETS, async (_, projectId: string) => {
    const outputDir = getOutputDir(projectId);
    const scenePlanPath = path.join(outputDir, "scene_plan.json");
    const statePath = path.join(outputDir, "pipeline_state.json");
    const clipsDir = getClipsDir(projectId);
    const imagesDir = getImagesDir(projectId);
    const thumbsDir = path.join(outputDir, "thumbs");

    if (!fs.existsSync(scenePlanPath)) return { deleted: 0 };

    const plan = JSON.parse(fs.readFileSync(scenePlanPath, "utf-8"));
    const validBeatIds = new Set((plan.beats || []).map((b: any) => b.id));
    let deleted = 0;

    for (const dir of [clipsDir, imagesDir, thumbsDir]) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.startsWith(".")) continue;
        const beatId = path.basename(file, path.extname(file));
        if (!validBeatIds.has(beatId)) {
          try {
            fs.unlinkSync(path.join(dir, file));
            deleted++;
          } catch {}
        }
      }
    }

    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        const cleanedAssets: Record<string, string> = {};
        for (const [beatId, assetPath] of Object.entries(state.assets || {})) {
          if (validBeatIds.has(beatId)) cleanedAssets[beatId] = assetPath as string;
        }
        state.assets = cleanedAssets;
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      } catch {}
    }

    return { deleted };
  });

  ipcMain.handle(IPC_CHANNELS.GET_SCRIPT_TEXT, async (_, scriptPath: string) => {
    if (!scriptPath || !fs.existsSync(scriptPath)) return null;
    try {
      const { parseFile } = await import("../../src/utils/fileParser");
      return await parseFile(scriptPath);
    } catch (err) {
      console.error("Failed to read script:", err);
      return null;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.GET_BEAT_TEXT_SEGMENTS,
    async (_, beats: any[], scriptPath: string, srtPath: string) => {
      const result: Record<string, string> = {};

      if (srtPath && fs.existsSync(srtPath)) {
        try {
          const { parseSrt } = await import("../../src/utils/srtParser");
          const segments = parseSrt(fs.readFileSync(srtPath, "utf-8"));
          for (const beat of beats) {
            const beatStart = beat.startTime;
            const beatEnd = beat.startTime + beat.duration;
            const overlapping = segments.filter(
              (s: any) => s.endTime > beatStart && s.startTime < beatEnd
            );
            result[beat.id] = overlapping.map((s: any) => s.text).join(" ");
          }
        } catch {}
      } else if (scriptPath && fs.existsSync(scriptPath)) {
        try {
          const { parseFile } = await import("../../src/utils/fileParser");
          const words = (await parseFile(scriptPath))
            .split(/\s+/)
            .filter((w: string) => w.length > 0);
          if (words.length === 0) return result;
          const totalWords = words.length;
          const totalDuration = beats.reduce((sum: number, b: any) => sum + b.duration, 0);
          if (totalDuration <= 0) return result;
          const rate = totalWords / totalDuration;
          for (const beat of beats) {
            const startWord = Math.floor(beat.startTime * rate);
            const endWord = Math.min(
              Math.ceil((beat.startTime + beat.duration) * rate),
              totalWords
            );
            result[beat.id] = words.slice(startWord, endWord).join(" ");
          }
        } catch {}
      }

      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SAVE_SCENE_PLAN,
    async (_, projectId: string, scenePlan: any) => {
      const outputDir = getOutputDir(projectId);
      const scenePlanPath = path.join(outputDir, "scene_plan.json");
      fs.writeFileSync(scenePlanPath, JSON.stringify(scenePlan, null, 2));
      return true;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SEARCH_BEAT_CANDIDATES,
    async (_, beatId: string, searchQuery: string, beatType: string, projectId: string) => {
      const settings = loadSettings();
      process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

      const {
        searchAllVideoCandidates,
        searchAllImageCandidates,
        downloadCandidate,
      } = await import("../../src/utils/stockApi");
      const { checkThumbnail } = await import("../../src/pipeline/qualityChecker");
      const { createConfig } = await import("../../src/config");

      ensureProjectDirs(projectId);

      const config = createConfig(buildConfigOverrides(settings, projectId));
      const isClip = beatType === "clip";

      let candidates;
      if (isClip) {
        candidates = await searchAllVideoCandidates(
          searchQuery,
          config.pexelsApiKey,
          config.pixabayApiKey
        );
      } else {
        candidates = await searchAllImageCandidates(
          searchQuery,
          config.pexelsApiKey,
          config.pixabayApiKey
        );
      }

      if (candidates.length === 0) return [];

      const approved: any[] = [];

      if (settings.enableQualityCheckOnPreview) {
        const { Logger } = await import("../../src/utils/logger");
        const logger = new Logger(config, `search-${beatId}`);
        logger.onLog = () => {};
        await logger.init();

        const maxCheck = Math.min(candidates.length, config.maxThumbnailsPerQuery);

        for (let i = 0; i < maxCheck; i++) {
          const candidate = candidates[i];
          if (!candidate.thumbnailUrl) {
            approved.push({ ...candidate, type: isClip ? "clip" : "image" });
            continue;
          }
          const thumbPath = path.join(
            getTempDir(projectId),
            `thumb_${beatId}_${i}_${Date.now()}.jpg`
          );
          try {
            await downloadCandidate(candidate.thumbnailUrl, thumbPath, undefined, 15000);
            if ((await checkThumbnail(searchQuery, thumbPath, config, logger)).accepted) {
              approved.push({ ...candidate, type: isClip ? "clip" : "image" });
            }
          } catch {
            approved.push({ ...candidate, type: isClip ? "clip" : "image" });
          } finally {
            try {
              fs.unlinkSync(thumbPath);
            } catch {}
          }
        }

        if (approved.length === 0 && candidates.length > 0) {
          approved.push({ ...candidates[0], type: isClip ? "clip" : "image" });
        }

        await logger.close();
      } else {
        for (const candidate of candidates) {
          approved.push({ ...candidate, type: isClip ? "clip" : "image" });
        }
      }

      return approved;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_SELECTED_CANDIDATE,
    async (_, beatId: string, candidate: any, projectId: string) => {
      const { createConfig } = await import("../../src/config");
      const { downloadCandidate, probeVideo } = await import("../../src/utils/stockApi");

      ensureProjectDirs(projectId);

      const settings = loadSettings();
      process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

      const config = createConfig(buildConfigOverrides(settings, projectId));

      const { setBinPaths, setMinResolution } = await import("../../src/utils/stockApi");
      setBinPaths(config.ffprobePath);
      setMinResolution(config.downloadResolution);

      const isClip = candidate.type === "clip";
      const ext = isClip ? ".mp4" : ".jpg";
      const dir = isClip ? getClipsDir(projectId) : getImagesDir(projectId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const finalPath = path.join(dir, `${beatId}${ext}`);

      try {
        const { Logger } = await import("../../src/utils/logger");
        const logger = new Logger(config, `dl-${beatId}`);
        logger.onLog = () => {};
        await logger.init();

        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.BEAT_STATUS, beatId, "downloading", 0);
        }

        await downloadCandidate(
          candidate.url,
          finalPath,
          (pct: number, dl: number, total: number) => {
            if (!win.isDestroyed()) {
              win.webContents.send(IPC_CHANNELS.BEAT_STATUS, beatId, "downloading", pct);
            }
          },
          config.downloadTimeout
        );

        if (isClip) {
          const probe = await probeVideo(finalPath);
          const stat = fs.statSync(finalPath);
          if (!stat || stat.size < 10000 || probe.duration <= 0 || probe.width === 0) {
            try {
              fs.unlinkSync(finalPath);
            } catch {}
            throw new Error("Downloaded video is corrupt or too small");
          }
        } else {
          const stat = fs.statSync(finalPath);
          if (!stat || stat.size < 1000) {
            try {
              fs.unlinkSync(finalPath);
            } catch {}
            throw new Error("Downloaded image is too small");
          }
        }

        const statePath = path.join(getOutputDir(projectId), "pipeline_state.json");
        try {
          let state: any = {};
          if (fs.existsSync(statePath)) {
            state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          }
          if (!state.assets) state.assets = {};
          if (!state.qualityCheckResults) state.qualityCheckResults = {};
          state.assets[beatId] = finalPath;
          state.qualityCheckResults[beatId] = { accepted: true };
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        } catch {}

        const thumbsDir = path.join(getOutputDir(projectId), "thumbs");
        if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
        const thumbPath = path.join(thumbsDir, `${beatId}.jpg`);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

        if (isClip) {
          const ffmpeg = getFfmpegPath();
          try {
            await execFileAsync(
              ffmpeg,
              [
                "-y",
                "-i",
                finalPath,
                "-ss",
                "00:00:01",
                "-frames:v",
                "1",
                "-q:v",
                "4",
                "-vf",
                "scale=320:-1",
                thumbPath,
              ],
              { timeout: 15000 }
            );
          } catch {}
        } else {
          try {
            fs.copyFileSync(finalPath, thumbPath);
          } catch {}
        }

        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.BEAT_STATUS, beatId, "done");
        }

        const thumbnail = fs.existsSync(thumbPath) ? `${thumbPath}?t=${Date.now()}` : null;
        await logger.close();
        return { path: finalPath, thumbnail };
      } catch (err: any) {
        if (!win.isDestroyed()) {
          win.webContents.send(
            IPC_CHANNELS.BEAT_STATUS,
            beatId,
            "failed",
            undefined,
            "download_failed",
            err.message
          );
        }
        return { path: null, thumbnail: null };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.GET_PIPELINE_STATE,
    async (_, projectId: string, scriptPath: string, voPath: string, srtPath: string) => {
      if (!projectId) return null;

      const projectOutputDir = getOutputDir(projectId);
      ensureProjectDirs(projectId);
      const projectStatePath = path.join(projectOutputDir, "pipeline_state.json");
      const globalStatePath = path.join(getOutputDir(), "pipeline_state.json");

      let statePath: string | null = null;

      if (fs.existsSync(projectStatePath)) {
        statePath = projectStatePath;
      } else if (fs.existsSync(globalStatePath)) {
        try {
          const globalData = JSON.parse(fs.readFileSync(globalStatePath, "utf-8"));
          if (
            globalData.scriptPath === scriptPath &&
            globalData.voPath === voPath &&
            globalData.srtPath === (srtPath ?? undefined)
          ) {
            ensureProjectDirs(projectId);
            const globalOutputDir = getOutputDir();

            if (globalData.assets) {
              for (const [beatId, absPath] of Object.entries(globalData.assets)) {
                if (!absPath) continue;
                const rel = path.relative(globalOutputDir, absPath as string);
                if (rel.startsWith("..")) continue;
                const newPath = path.join(projectOutputDir, rel);
                const newDir = path.dirname(newPath);
                if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
                if (fs.existsSync(absPath as string) && !fs.existsSync(newPath)) {
                  try {
                    fs.copyFileSync(absPath as string, newPath);
                  } catch {}
                }
                globalData.assets[beatId] = newPath;
              }
            }

            try {
              fs.writeFileSync(projectStatePath, JSON.stringify(globalData, null, 2));
            } catch {}

            const globalScenePlan = path.join(globalOutputDir, "scene_plan.json");
            if (fs.existsSync(globalScenePlan)) {
              try {
                fs.copyFileSync(
                  globalScenePlan,
                  path.join(projectOutputDir, "scene_plan.json")
                );
              } catch {}
            }

            statePath = projectStatePath;
          }
        } catch {}
      }

      if (!statePath) return null;

      try {
        const data = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        let elapsedMs = data.renderSegments?.elapsedMs ?? 0;
        let sessionTimes: number[] = data.renderSegments?.sessionTimes ?? [];
        if (!elapsedMs && data.renderSegments?.segmentDir) {
          try {
            const manifestPath = path.join(data.renderSegments.segmentDir, "render_manifest.json");
            if (fs.existsSync(manifestPath)) {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
              elapsedMs = manifest.elapsedMs ?? 0;
              sessionTimes = manifest.sessionTimes ?? [];
            }
          } catch {}
        }
        return {
          status: data.status,
          currentStep: data.currentStep,
          completedSteps: data.completedSteps ?? [],
          totalBeats: data.totalBeats ?? 0,
          assetCount: Object.keys(data.assets ?? {}).length,
          assets: data.assets ?? {},
          renderSegments: data.renderSegments
            ? {
                completed: data.renderSegments.completedSegments?.length ?? 0,
                total: data.renderSegments.totalSegments ?? 0,
                elapsedMs,
                sessionTimes,
              }
            : null,
          outputPath: data.outputPath,
        };
      } catch {
        return null;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.OPEN_IN_FINDER, async (_, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.LIST_PROJECTS, async () => {
    return projectsService.listProjects();
  });

  ipcMain.handle(IPC_CHANNELS.GET_PROJECT, async (_, id: string) => {
    return projectsService.getProject(id);
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_PROJECT, async (_, data: Partial<SavedProject>) => {
    return projectsService.saveProject(data);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_PROJECT, async (_, id: string) => {
    return projectsService.deleteProject(id);
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_PROJECT, async (_, id: string, name: string) => {
    return projectsService.renameProject(id, name);
  });

  ipcMain.handle(
    IPC_CHANNELS.GENERATE_THUMBNAIL,
    async (_, videoPath: string, projectId: string) => {
      const ffmpeg = getFfmpegPath();
      const outputDir = projectId ? getOutputDir(projectId) : path.dirname(videoPath);
      const thumbPath = path.join(outputDir, "thumbnail.jpg");
      await execFileAsync(
        ffmpeg,
        [
          "-y",
          "-i",
          videoPath,
          "-ss",
          "00:00:03",
          "-frames:v",
          "1",
          "-q:v",
          "2",
          "-vf",
          "scale=1280:-1",
          thumbPath,
        ],
        { timeout: 30000 }
      );
      return thumbPath;
    }
  );

  ipcMain.handle(IPC_CHANNELS.EXPORT_SRT, async (_, beats: any[], projectId: string) => {
    const outputDir = projectId ? getOutputDir(projectId) : getOutputDir();
    const srtPath = path.join(outputDir, "subtitles.srt");
    const lines: string[] = [];
    let startTime = 0;

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const duration = beat.durationSeconds ?? 3;
      const endTime = startTime + duration;
      lines.push(String(i + 1));
      lines.push(`${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}`);
      lines.push(beat.text || beat.searchQuery || "");
      lines.push("");
      startTime = endTime;
    }

    fs.writeFileSync(srtPath, lines.join("\n"));
    return srtPath;
  });

  ipcMain.handle(IPC_CHANNELS.GET_ASSET_PATHS, async (_, projectId: string) => {
    if (!projectId) return {};
    const statePath = path.join(getOutputDir(projectId), "pipeline_state.json");
    if (!fs.existsSync(statePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(statePath, "utf-8")).assets ?? {};
    } catch {
      return {};
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.GET_BEAT_THUMBNAIL,
    async (_, beatId: string, assetPath: string, projectId: string) => {
      if (!assetPath || !fs.existsSync(assetPath)) return null;

      const outputDir = projectId ? getOutputDir(projectId) : path.dirname(assetPath);
      const thumbsDir = path.join(outputDir, "thumbs");
      if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
      const thumbPath = path.join(thumbsDir, `${beatId}.jpg`);

      if (fs.existsSync(thumbPath)) return thumbPath;

      const ext = path.extname(assetPath).toLowerCase();
      if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp") {
        fs.copyFileSync(assetPath, thumbPath);
        return thumbPath;
      }

      const ffmpeg = getFfmpegPath();
      try {
        await execFileAsync(
          ffmpeg,
          [
            "-y",
            "-i",
            assetPath,
            "-ss",
            "00:00:01",
            "-frames:v",
            "1",
            "-q:v",
            "4",
            "-vf",
            "scale=320:-1",
            thumbPath,
          ],
          { timeout: 15000 }
        );
        return fs.existsSync(thumbPath) ? thumbPath : null;
      } catch {
        return null;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RE_DOWNLOAD_BEAT,
    async (_, beatId: string, searchQuery: string, beatType: string, projectId: string) => {
      const { createConfig } = await import("../../src/config");
      const { sourceAllAssets } = await import("../../src/pipeline/assetSourcer");

      ensureProjectDirs(projectId);

      const settings = loadSettings();
      process.env.OPENROUTER_API_KEY = settings.openrouterApiKeys?.[0] ?? "";

      const config = createConfig(buildConfigOverrides(settings, projectId));

      const { setBinPaths, setMinResolution } = await import("../../src/utils/stockApi");
      setBinPaths(config.ffprobePath);
      setMinResolution(config.downloadResolution);

      const dummyBeat = {
        id: beatId,
        type: beatType,
        startTime: 0,
        duration: 5,
        searchQuery,
      };

      const { Logger } = await import("../../src/utils/logger");
      const logger = new Logger(config, `redl-${beatId}`);
      logger.onLog = () => {};
      await logger.init();

      let downloadError: string | undefined;
      let downloadErrorDetails: string | undefined;
      let finalPath: string | undefined;

      const emitBeatStatus = (
        bId: string,
        status: string,
        downloadPercent?: number,
        error?: string,
        errorDetails?: string
      ) => {
        if (!win.isDestroyed()) {
          win.webContents.send(
            IPC_CHANNELS.BEAT_STATUS,
            bId,
            status,
            downloadPercent,
            error,
            errorDetails
          );
        }
      };

      const onBeatStatus = (bId: string, status: string, downloadPercent?: number) => {
        emitBeatStatus(bId, status, downloadPercent);
      };

      const result = await sourceAllAssets(
        [dummyBeat],
        config,
        logger,
        {},
        undefined,
        undefined,
        undefined,
        onBeatStatus
      );

      const assetPath = result.assets[beatId];
      if (assetPath) {
        finalPath = assetPath;
        emitBeatStatus(beatId, "done");
      } else {
        downloadError = "no_candidates";
        downloadErrorDetails =
          result.failed[beatId]?.reason || "No stock assets found for search query";
        emitBeatStatus(beatId, "failed", undefined, downloadError, downloadErrorDetails);
      }

      await logger.close();

      const statePath = path.join(getOutputDir(projectId), "pipeline_state.json");
      if (fs.existsSync(statePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          if (finalPath) state.assets[beatId] = finalPath;
          else delete state.assets[beatId];
          if (!state.qualityCheckResults) state.qualityCheckResults = {};
          state.qualityCheckResults[beatId] = { accepted: !!finalPath };
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        } catch {}
      }

      const thumbsDir = path.join(getOutputDir(projectId), "thumbs");
      if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
      const thumbPath = path.join(thumbsDir, `${beatId}.jpg`);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

      if (finalPath) {
        const ext = path.extname(finalPath).toLowerCase();
        if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp") {
          fs.copyFileSync(finalPath, thumbPath);
        } else {
          const ffmpeg = getFfmpegPath();
          try {
            await execFileAsync(
              ffmpeg,
              [
                "-y",
                "-i",
                finalPath,
                "-ss",
                "00:00:01",
                "-frames:v",
                "1",
                "-q:v",
                "4",
                "-vf",
                "scale=320:-1",
                thumbPath,
              ],
              { timeout: 15000 }
            );
          } catch {}
        }
      }

      const scenePlanPath = path.join(getOutputDir(projectId), "scene_plan.json");
      if (fs.existsSync(scenePlanPath)) {
        try {
          const plan = JSON.parse(fs.readFileSync(scenePlanPath, "utf-8"));
          const beatIdx = plan.beats?.findIndex((b: any) => b.id === beatId);
          if (beatIdx !== undefined && beatIdx >= 0) {
            plan.beats[beatIdx].searchQuery = searchQuery;
            fs.writeFileSync(scenePlanPath, JSON.stringify(plan, null, 2));
          }
        } catch {}
      }

      const thumbnail =
        finalPath && fs.existsSync(thumbPath) ? `${thumbPath}?t=${Date.now()}` : null;
      return { path: finalPath || null, thumbnail };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.VALIDATE_ALL_ASSETS,
    async (_, beats: any[], assets: Record<string, string>, projectId: string) => {
      const ffprobe = getFfprobePath();
      const outputDir = getOutputDir(projectId);
      const statePath = path.join(outputDir, "pipeline_state.json");
      let qualityCheckResults: Record<string, any> = {};

      if (fs.existsSync(statePath)) {
        try {
          qualityCheckResults =
            JSON.parse(fs.readFileSync(statePath, "utf-8")).qualityCheckResults || {};
        } catch {}
      }

      const results: Record<string, any> = {};

      for (const beat of beats) {
        const assetPath = assets[beat.id];
        const qualityResult = qualityCheckResults[beat.id];

        let resolvedPath = assetPath;
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
          const clipsDir = getClipsDir(projectId);
          const imagesDir = getImagesDir(projectId);
          const beatType = beat.type === "clip" ? "clip" : "image";
          const ext = beatType === "clip" ? ".mp4" : ".jpg";
          for (const dir of [clipsDir, imagesDir]) {
            const candidate = path.join(dir, `${beat.id}${ext}`);
            if (fs.existsSync(candidate)) {
              resolvedPath = candidate;
              break;
            }
          }
        }

        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
          results[beat.id] = {
            valid: false,
            reason: "missing",
            hasAsset: false,
            qualityChecked: qualityResult ? true : false,
            qualityPassed: qualityResult?.accepted,
          };
          continue;
        }

        const ext = path.extname(resolvedPath).toLowerCase();

        try {
          if (ext === ".mp4" || ext === ".webm" || ext === ".mov") {
            const probe = await execFileAsync(
              ffprobe,
              [
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,stream=codec_name",
                "-of",
                "json",
                resolvedPath,
              ],
              { timeout: 30000 }
            );
            const probeData = JSON.parse(probe.stdout);
            const duration = parseFloat(probeData?.format?.duration || "0");

            if (
              !probeData?.streams?.some((s: any) => s.codec_type === "video") ||
              duration <= 0
            ) {
              results[beat.id] = {
                valid: false,
                reason: "corrupt",
                hasAsset: true,
                qualityChecked: qualityResult ? true : false,
                qualityPassed: qualityResult?.accepted,
              };
            } else if (qualityResult && !qualityResult.accepted) {
              results[beat.id] = {
                valid: true,
                reason: "quality_failed",
                hasAsset: true,
                qualityChecked: true,
                qualityPassed: false,
              };
            } else {
              results[beat.id] = {
                valid: true,
                hasAsset: true,
                qualityChecked: qualityResult ? true : false,
                qualityPassed: qualityResult?.accepted ?? true,
              };
            }
          } else if (
            [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)
          ) {
            if (fs.statSync(resolvedPath).size < 1000) {
              results[beat.id] = {
                valid: false,
                reason: "corrupt",
                hasAsset: true,
                qualityChecked: qualityResult ? true : false,
                qualityPassed: qualityResult?.accepted,
              };
            } else if (qualityResult && !qualityResult.accepted) {
              results[beat.id] = {
                valid: true,
                reason: "quality_failed",
                hasAsset: true,
                qualityChecked: true,
                qualityPassed: false,
              };
            } else {
              results[beat.id] = {
                valid: true,
                hasAsset: true,
                qualityChecked: qualityResult ? true : false,
                qualityPassed: qualityResult?.accepted ?? true,
              };
            }
          } else {
            results[beat.id] = {
              valid: false,
              reason: "unknown",
              hasAsset: true,
              qualityChecked: false,
              qualityPassed: false,
            };
          }
        } catch (err) {
          results[beat.id] = {
            valid: false,
            reason: "probe_error",
            hasAsset: true,
            qualityChecked: qualityResult ? true : false,
            qualityPassed: qualityResult?.accepted,
          };
        }
      }

      return results;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RECOVER_ASSETS,
    async (_, beats: any[], projectId: string) => {
      const outputDir = getOutputDir(projectId);
      const clipsDir = getClipsDir(projectId);
      const imagesDir = getImagesDir(projectId);
      const statePath = path.join(outputDir, "pipeline_state.json");

      const recovered: Record<string, string> = {};
      const beatIds = new Set(beats.map((b: any) => b.id));

      for (const dir of [clipsDir, imagesDir]) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const beatId = path.basename(file, path.extname(file));
          if (!beatIds.has(beatId)) continue;
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).size < 1000) continue;
          recovered[beatId] = fullPath;
        }
      }

      if (Object.keys(recovered).length > 0) {
        try {
          let state: any = {};
          if (fs.existsSync(statePath)) {
            state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          }
          if (!state.assets) state.assets = {};
          if (!state.qualityCheckResults) state.qualityCheckResults = {};
          for (const [beatId, assetPath] of Object.entries(recovered)) {
            if (!state.assets[beatId]) {
              state.assets[beatId] = assetPath;
              state.qualityCheckResults[beatId] = { accepted: true };
            }
          }
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        } catch {}
      }

      return recovered;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_PIPELINE_STATUS,
    async (_, projectId: string, status: string) => {
      const outputDir = getOutputDir(projectId);
      const statePath = path.join(outputDir, "pipeline_state.json");
      if (fs.existsSync(statePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          state.status = status;
          state.currentStep = "rendering";
          if (!state.completedSteps.includes("asset_sourcing")) {
            state.completedSteps.push("asset_sourcing");
          }
          if (!state.completedSteps.includes("scene_planning")) {
            state.completedSteps.push("scene_planning");
          }
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
          return true;
        } catch {}
      }
      return false;
    }
  );
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

const VALID_PLANNER_MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4.5",
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3-235b-a22b-2507",
  "google/gemma-3-4b-it",
  "openrouter/owl-alpha",
];

const VALID_CHECKER_MODELS = [
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash-lite",
  "google/gemma-3-4b-it",
];

const RETIRED_MODEL_MAP: Record<string, string> = {
  "deepseek/deepseek-chat-v3-0324": "deepseek/deepseek-v4-flash",
  "anthropic/claude-haiku-4": "anthropic/claude-haiku-4.5",
  "meta-llama/llama-3.2-11b-vision-instruct": "google/gemma-3-4b-it",
  "google/gemma-4-26b-a4b-it:free": "google/gemma-3-4b-it",
  "google/gemma-4-31b-it:free": "google/gemma-3-4b-it",
};

function loadSettings(): AppSettings {
  let settings: AppSettings;
  try {
    const data = fs.readFileSync(SETTINGS_PATH, "utf-8");
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }

  let migrated = false;

  const oldKey = (settings as any).openrouterApiKey;
  if (typeof oldKey === "string" && oldKey.length > 0 && (!settings.openrouterApiKeys || settings.openrouterApiKeys.length === 0)) {
    settings.openrouterApiKeys = [oldKey];
    delete (settings as any).openrouterApiKey;
    migrated = true;
  }

  if (!VALID_PLANNER_MODELS.includes(settings.scenePlannerModel)) {
    settings.scenePlannerModel =
      RETIRED_MODEL_MAP[settings.scenePlannerModel] ?? DEFAULT_SETTINGS.scenePlannerModel;
    migrated = true;
  }
  if (!VALID_CHECKER_MODELS.includes(settings.qualityCheckerModel)) {
    settings.qualityCheckerModel =
      RETIRED_MODEL_MAP[settings.qualityCheckerModel] ?? DEFAULT_SETTINGS.qualityCheckerModel;
    migrated = true;
  }

  if (settings.qualityCheckPrompt?.includes("NICHE:")) {
    settings.qualityCheckPrompt = DEFAULT_QUALITY_PROMPT;
    migrated = true;
  }
  if (
    [
      "plant-related",
      "botanical",
      "not plant",
      "plants and",
      "plant subject",
      "herbal",
      "reject if not plant",
    ].some((s) => (settings.qualityCheckPrompt ?? "").toLowerCase().includes(s))
  ) {
    settings.qualityCheckPrompt = DEFAULT_QUALITY_PROMPT;
    migrated = true;
  }
  if (
    settings.scenePlannerRules ===
    "The camera should focus on plants and botanical subjects, not people. Describe what the camera shows, not human activities. Prefer close-up shots of plant parts, nature processes, and botanical details."
  ) {
    settings.scenePlannerRules = DEFAULT_PLANNER_RULES;
    migrated = true;
  }
  if (
    settings.scenePlannerRules?.startsWith("IF the script is a COUNT-UP") &&
    !settings.scenePlannerRules.includes("EXAMPLES")
  ) {
    settings.scenePlannerRules = DEFAULT_PLANNER_RULES;
    migrated = true;
  }

  if (migrated) {
    try {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch {}
  }

  return settings;
}
