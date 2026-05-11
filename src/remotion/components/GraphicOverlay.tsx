import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  OffthreadVideo,
  staticFile,
} from "remotion";
import type { BeatOverlay } from "../../types/scenePlan";

interface GraphicOverlayProps {
  overlay: BeatOverlay;
  clipDurationFrames: number;
  vfxDurationFrames?: number;
}

export const GraphicOverlay: React.FC<GraphicOverlayProps> = ({
  overlay,
  clipDurationFrames,
  vfxDurationFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  if (overlay.type === "subscribe_cta") {
    const totalFrames = vfxDurationFrames ?? 180;
    const fadeInFrames = Math.round(0.3 * fps);
    const fadeOutFrames = Math.round(0.3 * fps);
    const opacity = Math.min(
      interpolate(frame, [0, fadeInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      interpolate(frame, [totalFrames - fadeOutFrames, totalFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    );

    const vfxWidth = width * 0.3;

    return (
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity, pointerEvents: "none" }}>
        <OffthreadVideo
          src={staticFile("vfx/subscribe.mp4")}
          style={{ width: vfxWidth }}

        />
      </AbsoluteFill>
    );
  }

  return null;
};
