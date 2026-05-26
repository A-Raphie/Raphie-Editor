import React from "react";
import {
  AbsoluteFill,
  Sequence,
  Audio,
  useVideoConfig,
} from "remotion";
import type { ScenePlan, Beat, AssetMapping } from "../../types/scenePlan";
import { ImageSlide } from "../components/ImageSlide";
import { VideoClip } from "../components/VideoClip";
import { LowerThird } from "../components/LowerThird";
import { GraphicOverlay } from "../components/GraphicOverlay";
import { Transition } from "../components/Transition";

interface DocumentaryProps {
  scenePlan: ScenePlan;
  assets: AssetMapping;
  voPath?: string;
  musicPath?: string;
}

const VignetteOverlay: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)",
    }}
  />
);

const ColorGradeOverlay: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      backgroundColor: "rgba(15,8,0,0.12)",
      mixBlendMode: "multiply",
    }}
  />
);

export const Documentary: React.FC<DocumentaryProps> = ({
  scenePlan,
  assets,
  voPath,
  musicPath,
}) => {
  const { fps } = useVideoConfig();

  const beatFrames = scenePlan.beats.reduce((acc, beat) => {
    const dur = Math.round(beat.duration * fps);
    const prev = acc.length > 0 ? acc[acc.length - 1] : null;
    acc.push({ from: prev ? prev.end : 0, end: (prev ? prev.end : 0) + dur, durationInFrames: dur });
    return acc;
  }, [] as { from: number; end: number; durationInFrames: number }[]);

  const overlayFrameMap = new Map<string, { from: number; durationInFrames: number }>();
  scenePlan.beats.forEach((b, i) => overlayFrameMap.set(b.id, beatFrames[i]));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {scenePlan.beats.map((beat, idx) => {
        const { from, durationInFrames } = beatFrames[idx];
        const transitionOffset = Math.floor((beat.transitionDuration ?? 0) / 2);

        return (
          <Sequence
            key={beat.id}
            from={from - transitionOffset}
            durationInFrames={durationInFrames + transitionOffset}
          >
            <Transition
              type={beat.transitionIn}
              duration={beat.transitionDuration}
              direction="in"
            >
              <BeatContent beat={beat} assets={assets} fps={fps} />
            </Transition>
          </Sequence>
        );
      })}

      <VignetteOverlay />
      <ColorGradeOverlay />

      {scenePlan.beats
        .filter(b => b.overlay?.type === "subscribe_cta")
        .map(beat => {
          const frames = overlayFrameMap.get(beat.id)!;
          return (
            <Sequence
              key={`overlay-${beat.id}`}
              from={frames.from}
              durationInFrames={180}
            >
              <GraphicOverlay
                overlay={beat.overlay!}
                clipDurationFrames={frames.durationInFrames}
                vfxDurationFrames={180}
              />
            </Sequence>
          );
        })}

      {voPath && (
        <Audio src={voPath} volume={1} />
      )}
      {musicPath && (
        <Audio src={musicPath} volume={0.15} />
      )}
    </AbsoluteFill>
  );
};

const BeatContent: React.FC<{ beat: Beat; assets: AssetMapping; fps: number }> = ({ beat, assets, fps }) => {
  const assetPath = assets[beat.id];

  switch (beat.type) {
    case "clip":
      return assetPath ? (
        <AbsoluteFill>
          <VideoClip src={assetPath} />
        </AbsoluteFill>
      ) : (
        <LowerThird title={beat.searchQuery ?? "Content unavailable"} subtitle={beat.text ?? ""} />
      );

    case "image":
      return assetPath ? (
        <ImageSlide
          src={assetPath}
          animation={beat.imageAnimation ?? "zoom_in"}
          duration={beat.duration}
        />
      ) : (
        <LowerThird title={beat.searchQuery ?? "Image unavailable"} subtitle={beat.text ?? ""} />
      );

    case "lower_third":
      return (
        <LowerThird
          title={beat.lowerThirdData?.title ?? beat.text ?? ""}
          subtitle={beat.lowerThirdData?.subtitle ?? beat.subtitle ?? ""}
        />
      );

    default:
      return <LowerThird title="Unknown beat type" subtitle="" />;
  }
};
