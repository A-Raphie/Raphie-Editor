# M - Types

## Source Files
- `src-electron/shared/types.ts` — Shared between renderer and main process
- `src/types/scenePlan.ts` — Pipeline-internal types
- `src/config.ts` — Config interface and defaults

---

## Shared Types (`src-electron/shared/types.ts`)

### CandidatePreview
```ts
interface CandidatePreview {
  url: string;
  previewUrl: string;
  thumbnailUrl: string;
  duration: number;
  width: number;
  height: number;
  source: string;
  type: "clip" | "image";
}
```

### SavedProject
```ts
interface SavedProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scriptPath?: string;    // optional — SRT-only projects don't have scripts
  voPath: string;          // required — voiceover audio
  musicPath?: string;
  srtPath?: string;        // optional — some projects use SRT instead of script
  scenePlan?: any;
  status: "planning" | "editing" | "rendering" | "complete" | "error";
  outputPath?: string;
  modelTier?: string;
}
```

### AppSettings (aka Settings)
```ts
interface AppSettings {
  openrouterApiKey: string;
  scenePlannerModel: string;
  qualityCheckerModel: string;
  pexelsApiKey: string;
  pixabayApiKey: string;
  clipPercent: number;              // default 70
  imagePercent: number;             // default 30
  concurrency: number;              // default 4
  fps: number;                      // default 30
  downloadResolution: number;       // default 2160
  downloadTimeout: number;          // default 90000
  musicPath?: string;
  lastProjectDir?: string;
  qualityCheckPrompt?: string;
  scenePlannerRules?: string;
  searchQueryRules?: string;
  contentRules?: string;
  acceptedContexts?: string[];
  hookDuration?: number;            // default 60 seconds
  hookClipMin?: number;             // default 2
  hookClipMax?: number;             // default 3
  bodyClipMin?: number;             // default 5
  bodyClipMax?: number;             // default 6
  maxThumbnailsPerQuery?: number;   // default 5
  musicVolume?: number;             // default 15
  videoCodec?: "h265" | "h264";    // default "h265"
  qualityScoreThreshold?: number;   // default 5
  segmentLength?: number;           // default 900
  enableVignette?: boolean;         // default true
  enableColorGrade?: boolean;       // default true
  subscribeOverlaySize?: number;    // default 30
  forbiddenWords?: string;
  genericFallbacks?: string;
  cleanupAfterRender?: boolean;     // default true
  cleanupAfterDays?: number;        // default 0
  parallelSegments: number;         // default 1, range 1-3
  previewResolution: number;        // default 1080
}
```

### PipelineProgress
```ts
interface PipelineProgress {
  step: string;
  current: number;
  total: number;
  percent: number;
  message: string;
}
```

### LogEntry
```ts
interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}
```

### RunPipelineArgs
```ts
interface RunPipelineArgs {
  scriptPath?: string;
  voPath: string;
  musicPath?: string;
  srtPath?: string;
  scenePlan?: any;
  projectId?: string;
  previewResolution?: number;
}
```

### PipelineStateInfo
```ts
interface PipelineStateInfo {
  status: "in_progress" | "completed" | "failed" | "ready_to_render";
  currentStep: string;
  completedSteps: string[];
  totalBeats: number;
  assetCount: number;
  assets: Record<string, string>;
  renderSegments: { completed: number; total: number } | null;
  outputPath?: string;
}
```

### IPC_CHANNELS (37 channels)
```ts
const IPC_CHANNELS = {
  RUN_PIPELINE, RESUME_PIPELINE, PREVIEW_SCENE_PLAN,
  GET_SETTINGS, SAVE_SETTINGS, CANCEL_PIPELINE,
  SELECT_FILES, OPEN_IN_FINDER,
  PIPELINE_PROGRESS, PIPELINE_LOG, PIPELINE_COMPLETE, PIPELINE_ERROR,
  SCENE_PLAN_READY,
  LIST_PROJECTS, SAVE_PROJECT, DELETE_PROJECT, RENAME_PROJECT, GET_PROJECT,
  GET_PIPELINE_STATE,
  GENERATE_THUMBNAIL, EXPORT_SRT, GET_ASSET_PATHS,
  GET_BEAT_THUMBNAIL, RE_DOWNLOAD_BEAT,
  ASSET_DOWNLOADED, BEAT_STATUS,
  VALIDATE_ALL_ASSETS, UPDATE_PIPELINE_STATUS,
  RENDER_VIDEO, SOURCE_ALL_ASSETS,
  CLEAN_ASSETS, PREVIEW_CLEAN,
  GET_SCRIPT_TEXT, SAVE_SCENE_PLAN,
  SEARCH_BEAT_CANDIDATES, DOWNLOAD_SELECTED_CANDIDATE,
  GET_BEAT_TEXT_SEGMENTS,
} as const;
```

---

## Pipeline Types (`src/types/scenePlan.ts`)

### BeatType, TransitionType, ImageAnimation
```ts
type BeatType = "image" | "clip" | "lower_third" | "subscribe_cta";
type TransitionType = "crossfade" | "zoom_through" | "slide_left" | "slide_up" | "whip_pan" | "glitch" | "flash_white" | "blur" | "mask_wipe" | "fade";
type ImageAnimation = "zoom_in" | "zoom_out" | "pan_lr" | "pan_rl" | "pan_tb" | "pan_bt" | "drift";
```

### Beat
```ts
interface Beat {
  id: string;
  startTime: number;
  duration: number;
  type: BeatType;
  imageAnimation?: ImageAnimation;
  searchQuery?: string;
  text?: string;
  subtitle?: string;
  transitionIn?: TransitionType;
  transitionDuration?: number;
  overlay?: BeatOverlay;
  lowerThirdData?: { title: string; subtitle: string; };
}
```

### BeatOverlay
```ts
interface BeatOverlay {
  type: "subscribe_cta";
  showAt: number;
  hideAt: number;
}
```

### ScenePlan
```ts
interface ScenePlan {
  title: string;
  fps: number;
  totalDurationSeconds: number;
  beats: Beat[];
}
```

### AssetMapping
```ts
interface AssetMapping { [beatId: string]: string; }
```

### RenderSegmentState
```ts
interface RenderSegmentState {
  segmentLength: number;
  completedSegments: number[];
  totalSegments: number;
  segmentDir: string;
}
```

### PipelineState
```ts
interface PipelineState {
  runId: string;
  status: "in_progress" | "completed" | "failed";
  currentStep: string;
  completedSteps: string[];
  totalBeats: number;
  completedBeats: string[];
  failedBeats: Record<string, { reason: string; fallback: string }>;
  scenePlan: string;
  assets: AssetMapping;
  scriptPath: string;
  voPath: string;
  musicPath: string;
  renderSegments: RenderSegmentState | null;
}
```

### sanitizeScenePlan()
- Converts `title_card` → `lower_third`
- Converts unknown types → `lower_third`
- Removes invalid overlays
- Deletes `clipSpeed` and `clipEffect` properties

---

## Config (`src/config.ts`)

### Config Interface
Extends AppSettings with runtime paths:
- `modelOption: ModelOption` ("default" | "budget")
- `maxRetries: number` (5)
- `logDir, outputDir, tempDir, clipsDir, imagesDir, inputDir, assetsDir`
- `remotionEntryPath, remotionPublicDir`
- `ffmpegPath, ffprobePath, vfxPath`
- `forbiddenWords: string[]` (parsed from comma list)
- `genericFallbacks: string[]` (parsed from comma list)

### Models
```ts
const MODELS = {
  default: { scenePlanner: "deepseek/deepseek-v4-flash", qualityChecker: "google/gemini-2.5-flash-lite" },
  budget:  { scenePlanner: "deepseek/deepseek-v4-flash", qualityChecker: "google/gemini-2.5-flash-lite" },
};
```

### createConfig(overrides)
- Takes `Partial<Config>`, returns `Config`
- All defaults are hardcoded in this function
- `parseCommaList()` utility for splitting comma-separated settings fields

---

## Cross-References
- `AppSettings` → `Config` via `createConfig(settings)` in ipc-handlers
- `ScenePlan.beats[].type` must be one of `BeatType` values after `sanitizeScenePlan()`
- `PipelineState` is serialized to `pipeline_state.json` in output dir
- `AssetMapping` maps `Beat.id` → file path on disk
