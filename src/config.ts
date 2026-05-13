import path from "path";

export type ModelOption = "default" | "budget";

interface ModelConfig {
  scenePlanner: string;
  qualityChecker: string;
}

const MODELS: Record<ModelOption, ModelConfig> = {
  default: {
    scenePlanner: "deepseek/deepseek-v4-flash",
    qualityChecker: "google/gemini-2.5-flash-lite",
  },
  budget: {
    scenePlanner: "deepseek/deepseek-v4-flash",
    qualityChecker: "google/gemini-2.5-flash-lite",
  },
};

export interface Config {
  openrouterApiKeys: string[];
  modelOption: ModelOption;
  scenePlannerModel: string;
  qualityCheckerModel: string;
  pexelsApiKey: string;
  pixabayApiKey: string;
  clipPercent: number;
  imagePercent: number;
  concurrency: number;
  previewConcurrency: number;
  renderConcurrency: number;
  fps: number;
  downloadResolution: number;
  downloadTimeout: number;
  maxRetries: number;
  logDir: string;
  outputDir: string;
  tempDir: string;
  clipsDir: string;
  imagesDir: string;
  inputDir: string;
  assetsDir: string;
  remotionEntryPath: string;
  remotionPublicDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  vfxPath: string;
  qualityCheckPrompt: string;
  scenePlannerRules: string;
  searchQueryRules: string;
  contentRules: string;
  acceptedContexts: string[];
  hookDuration: number;
  hookClipMin: number;
  hookClipMax: number;
  bodyClipMin: number;
  bodyClipMax: number;
  maxThumbnailsPerQuery: number;
  musicVolume: number;
  videoCodec: string;
  qualityScoreThreshold: number;
  segmentLength: number;
  enableVignette: boolean;
  enableColorGrade: boolean;
  subscribeOverlaySize: number;
  forbiddenWords: string[];
  genericFallbacks: string[];
  cleanupAfterRender: boolean;
  cleanupAfterDays: number;
  tempCleanupDays: number;
  parallelSegments: number;
  previewResolution: number;
  renderer: "remotion" | "ffmpeg";
  srtChunkSize: number;
  srtChunkDelayMs: number;
}

export function createConfig(overrides: Partial<Config> = {}): Config {
  const modelOption = overrides.modelOption ?? "default";
  const models = MODELS[modelOption];

  return {
    openrouterApiKeys: overrides.openrouterApiKeys?.length
      ? overrides.openrouterApiKeys
      : process.env.OPENROUTER_API_KEY
        ? [process.env.OPENROUTER_API_KEY]
        : [],
    modelOption,
    scenePlannerModel: overrides.scenePlannerModel ?? models.scenePlanner,
    qualityCheckerModel: overrides.qualityCheckerModel ?? models.qualityChecker,
    pexelsApiKey: overrides.pexelsApiKey ?? "",
    pixabayApiKey: overrides.pixabayApiKey ?? "",
    clipPercent: overrides.clipPercent ?? 70,
    imagePercent: overrides.imagePercent ?? 30,
    concurrency: overrides.concurrency ?? 4,
    previewConcurrency: (overrides as any).previewConcurrency ?? 10,
    renderConcurrency: (overrides as any).renderConcurrency ?? 3,
    fps: overrides.fps ?? 30,
    downloadResolution: overrides.downloadResolution ?? 2160,
    downloadTimeout: overrides.downloadTimeout ?? 90_000,
    maxRetries: 5,
    logDir: "output/logs",
    outputDir: "output",
    tempDir: "output/temp",
    clipsDir: "output/clips",
    imagesDir: "output/images",
    inputDir: "input",
    assetsDir: "assets",
    remotionEntryPath: path.resolve("src/remotion/index.ts"),
    remotionPublicDir: path.resolve("assets"),
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    vfxPath: overrides.vfxPath ?? "",
    qualityCheckPrompt: overrides.qualityCheckPrompt ?? "",
    scenePlannerRules: overrides.scenePlannerRules ?? "",
    searchQueryRules: overrides.searchQueryRules ?? "",
    contentRules: overrides.contentRules ?? "",
    acceptedContexts: overrides.acceptedContexts ?? [],
    hookDuration: overrides.hookDuration ?? 60,
    hookClipMin: overrides.hookClipMin ?? 2,
    hookClipMax: overrides.hookClipMax ?? 3,
    bodyClipMin: overrides.bodyClipMin ?? 5,
    bodyClipMax: overrides.bodyClipMax ?? 6,
    maxThumbnailsPerQuery: overrides.maxThumbnailsPerQuery ?? 5,
    musicVolume: overrides.musicVolume ?? 15,
    videoCodec: overrides.videoCodec ?? "h265",
    qualityScoreThreshold: overrides.qualityScoreThreshold ?? 5,
    segmentLength: overrides.segmentLength ?? 900,
    enableVignette: overrides.enableVignette ?? true,
    enableColorGrade: overrides.enableColorGrade ?? true,
    subscribeOverlaySize: overrides.subscribeOverlaySize ?? 30,
    forbiddenWords: overrides.forbiddenWords ?? ["subscribe", "like", "subscribe button", "like button", "cta"],
    genericFallbacks: overrides.genericFallbacks ?? ["nature", "garden", "landscape", "outdoor"],
    cleanupAfterRender: overrides.cleanupAfterRender ?? true,
    cleanupAfterDays: overrides.cleanupAfterDays ?? 0,
    tempCleanupDays: (overrides as any).tempCleanupDays ?? 1,
    parallelSegments: overrides.parallelSegments ?? 1,
    previewResolution: overrides.previewResolution ?? 1080,
    renderer: (overrides as any).renderer ?? "remotion",
    srtChunkSize: overrides.srtChunkSize ?? 25,
    srtChunkDelayMs: overrides.srtChunkDelayMs ?? 0,
    ...overrides,
  };
}

export function parseCommaList(value: string | undefined | null, defaults: string[] = []): string[] {
  if (!value) return defaults;
  return value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export { MODELS };
