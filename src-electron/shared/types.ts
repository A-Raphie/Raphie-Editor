export interface CandidatePreview {
  url: string;
  previewUrl: string;
  thumbnailUrl: string;
  duration: number;
  width: number;
  height: number;
  source: string;
  type: "clip" | "image";
}

export interface SavedProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scriptPath?: string;
  voPath: string;
  musicPath?: string;
  srtPath?: string;
  scenePlan?: any;
  status: "planning" | "editing" | "rendering" | "complete" | "error";
  outputPath?: string;
  modelTier?: string;
}

export const IPC_CHANNELS = {
  RUN_PIPELINE: "run-pipeline",
  RESUME_PIPELINE: "resume-pipeline",
  PREVIEW_SCENE_PLAN: "preview-scene-plan",
  GET_SETTINGS: "get-settings",
  SAVE_SETTINGS: "save-settings",
  CANCEL_PIPELINE: "cancel-pipeline",
  SELECT_FILES: "select-files",
  OPEN_IN_FINDER: "open-in-finder",
  PIPELINE_PROGRESS: "pipeline-progress",
  PIPELINE_LOG: "pipeline-log",
  PIPELINE_COMPLETE: "pipeline-complete",
  PIPELINE_ERROR: "pipeline-error",
  SCENE_PLAN_READY: "scene-plan-ready",
  LIST_PROJECTS: "list-projects",
  SAVE_PROJECT: "save-project",
  DELETE_PROJECT: "delete-project",
  RENAME_PROJECT: "rename-project",
  GET_PROJECT: "get-project",
  GET_PIPELINE_STATE: "get-pipeline-state",
  GENERATE_THUMBNAIL: "generate-thumbnail",
  EXPORT_SRT: "export-srt",
  GET_ASSET_PATHS: "get-asset-paths",
  GET_BEAT_THUMBNAIL: "get-beat-thumbnail",
  RE_DOWNLOAD_BEAT: "re-download-beat",
  ASSET_DOWNLOADED: "asset-downloaded",
  BEAT_STATUS: "beat-status",
  VALIDATE_ALL_ASSETS: "validate-all-assets",
  UPDATE_PIPELINE_STATUS: "update-pipeline-status",
  RENDER_VIDEO: "render-video",
  SOURCE_ALL_ASSETS: "source-all-assets",
  CLEAN_ASSETS: "clean-assets",
  PREVIEW_CLEAN: "preview-clean",
  GET_SCRIPT_TEXT: "get-script-text",
  SAVE_SCENE_PLAN: "save-scene-plan",
  SEARCH_BEAT_CANDIDATES: "search-beat-candidates",
  DOWNLOAD_SELECTED_CANDIDATE: "download-selected-candidate",
  GET_BEAT_TEXT_SEGMENTS: "get-beat-text-segments",
} as const;

export interface AppSettings {
  openrouterApiKey: string;
  scenePlannerModel: string;
  qualityCheckerModel: string;
  pexelsApiKey: string;
  pixabayApiKey: string;
  clipPercent: number;
  imagePercent: number;
  concurrency: number;
  fps: number;
  downloadResolution: number;
  downloadTimeout: number;
  musicPath?: string;
  lastProjectDir?: string;
  qualityCheckPrompt?: string;
  scenePlannerRules?: string;
  searchQueryRules?: string;
  contentRules?: string;
  acceptedContexts?: string[];
  hookDuration?: number;
  hookClipMin?: number;
  hookClipMax?: number;
  bodyClipMin?: number;
  bodyClipMax?: number;
  maxThumbnailsPerQuery?: number;
  musicVolume?: number;
  videoCodec?: "h265" | "h264";
  qualityScoreThreshold?: number;
  segmentLength?: number;
  enableVignette?: boolean;
  enableColorGrade?: boolean;
  subscribeOverlaySize?: number;
  forbiddenWords?: string;
  genericFallbacks?: string;
  cleanupAfterRender?: boolean;
  cleanupAfterDays?: number;
  parallelSegments: number;
  previewResolution: number;
  enableQualityCheckOnPreview?: boolean;
}

export interface PipelineProgress {
  step: string;
  current: number;
  total: number;
  percent: number;
  message: string;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RunPipelineArgs {
  scriptPath?: string;
  voPath: string;
  musicPath?: string;
  srtPath?: string;
  scenePlan?: any;
  projectId?: string;
  previewResolution?: number;
}

export interface PipelineStateInfo {
  status: "in_progress" | "completed" | "failed" | "ready_to_render";
  currentStep: string;
  completedSteps: string[];
  totalBeats: number;
  assetCount: number;
  assets: Record<string, string>;
  renderSegments: { completed: number; total: number } | null;
  outputPath?: string;
}

export type { AppSettings as Settings };
