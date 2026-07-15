export type ImageAnimation =
  | "zoom_in"
  | "zoom_out"
  | "pan_lr"
  | "pan_rl"
  | "pan_tb"
  | "pan_bt"
  | "drift"
  | "zoom_in_tl"
  | "zoom_in_tr"
  | "zoom_in_bl"
  | "zoom_in_br"
  | "zoom_out_tl"
  | "zoom_out_tr"
  | "zoom_out_bl"
  | "zoom_out_br"
  | "dramatic_in"
  | "dramatic_out"
  | "random";

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

export type OverlayType = "subscribe_cta" | "number_callout" | "item_banner";

export interface BeatOverlay {
  type: OverlayType;
  showAt: number;
  hideAt: number;
  number?: number;
  label?: string;
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

  sectionId?: string;
  sectionContext?: string;
}

export type SectionType = "hook" | "list" | "ending";

export interface Section {
  id: string;
  type: SectionType;
  label: string;
  startTime: number;
  endTime: number;
  searchContext: string;
  bannerText?: string;
  number?: number;
  inferred?: boolean;
  sourceSnippet?: string;
}

export interface SectionPlan {
  title: string;
  sections: Section[];
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
  renderPhase?: "beats" | "concat" | "overlay" | "mux";
  elapsedMs?: number;
  sessionTimes?: number[];
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
  srtPath?: string;
  renderSegments: RenderSegmentState | null;
  qualityCheckResults?: Record<string, { accepted: boolean }>;
}

const VALID_BEAT_TYPES: string[] = ["clip", "image", "lower_third"];
const VALID_OVERLAY_TYPES: string[] = ["subscribe_cta", "number_callout", "item_banner"];

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

export function findSectionAt(time: number, sections: Section[]): Section | null {
  for (const s of sections) {
    if (time >= s.startTime && time < s.endTime) return s;
  }
  if (sections.length > 0 && time >= sections[sections.length - 1].endTime) {
    return sections[sections.length - 1];
  }
  return null;
}

export function isQueryDerailed(beat: Beat, section: Section | null): boolean {
  if (!section?.searchContext || !beat.searchQuery) return false;
  return !beat.searchQuery.toLowerCase().includes(section.searchContext.toLowerCase());
}

export interface BeatDerailment {
  section: Section | null;
  constrained: boolean;
  derailed: boolean;
}

export function beatDerailment(beat: Beat, sectionPlan: SectionPlan | null | undefined): BeatDerailment {
  const section = sectionPlan ? findSectionAt(beat.startTime, sectionPlan.sections) : null;
  const constrained = !!(section && section.searchContext);
  return { section, constrained, derailed: constrained && isQueryDerailed(beat, section) };
}

export function sectionLabel(section: Section): string {
  if (section.type === "hook") return "Hook";
  if (section.number) return `#${section.number} ${section.label}`;
  return section.label;
}
