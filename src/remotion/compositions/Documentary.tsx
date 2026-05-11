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

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {scenePlan.beats.map((beat) => {
        const from = Math.floor(beat.startTime * fps);
        const durationInFrames = Math.floor(beat.duration * fps);
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
        .map(beat => (
          <Sequence
            key={`overlay-${beat.id}`}
            from={Math.floor(beat.startTime * fps)}
            durationInFrames={180}
          >
            <GraphicOverlay
              overlay={beat.overlay!}
              clipDurationFrames={Math.floor(beat.duration * fps)}
              vfxDurationFrames={180}
            />
          </Sequence>
        ))}

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
