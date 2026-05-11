export type ImageAnimation =
  | "zoom_in"
  | "zoom_out"
  | "pan_lr"
  | "pan_rl"
  | "pan_tb"
  | "pan_bt"
  | "drift";

export type TransitionType =
  | "crossfade"
  | "zoom_through"
  | "slide_left"
  | "slide_up"
  | "whip_pan"
  | "glitch"
  | "flash_white"
  | "blur"
  | "mask_wipe"
  | "fade";

export type BeatType = "image" | "clip" | "lower_third" | "subscribe_cta";

export type OverlayType = "subscribe_cta";

export interface BeatOverlay {
  type: OverlayType;
  showAt: number;
  hideAt: number;
}

export interface Beat {
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

  lowerThirdData?: {
    title: string;
    subtitle: string;
  };
}

export interface ScenePlan {
  title: string;
  fps: number;
  totalDurationSeconds: number;
  beats: Beat[];
}

export interface AssetMapping {
  [beatId: string]: string;
}

export interface RenderSegmentState {
  segmentLength: number;
  completedSegments: number[];
  totalSegments: number;
  segmentDir: string;
}

export interface PipelineState {
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

const VALID_BEAT_TYPES: string[] = ["clip", "image", "lower_third"];
const VALID_OVERLAY_TYPES: string[] = ["subscribe_cta"];

export function sanitizeScenePlan(plan: ScenePlan): ScenePlan {
  for (const beat of plan.beats) {
    if (beat.type === "title_card") {
      (beat as any).type = "lower_third";
    } else if (!VALID_BEAT_TYPES.includes(beat.type)) {
      (beat as any).type = "lower_third";
    }
    if (beat.overlay && !VALID_OVERLAY_TYPES.includes(beat.overlay.type)) {
      delete beat.overlay;
    }
    delete (beat as any).clipSpeed;
    delete (beat as any).clipEffect;
    if (typeof beat.startTime !== "number" || isNaN(beat.startTime)) (beat as any).startTime = 0;
    if (typeof beat.duration !== "number" || isNaN(beat.duration) || beat.duration <= 0) (beat as any).duration = 5;
    if (typeof beat.transitionDuration !== "number") (beat as any).transitionDuration = 0;
  }
  return plan;
}
