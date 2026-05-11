import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
  Img,
} from "remotion";
import type { ImageAnimation } from "../../types/scenePlan";

interface ImageSlideProps {
  src: string;
  animation: ImageAnimation;
  duration: number;
}

export const ImageSlide: React.FC<ImageSlideProps> = ({ src, animation, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const totalFrames = duration * fps;

  const progress = interpolate(frame, [0, totalFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  let transform = "";
  let scale = 1;

  const eased = interpolate(progress, [0, 1], [0, 1], {
    easing: Easing.linear,
  });

  switch (animation) {
    case "zoom_in":
      scale = interpolate(eased, [0, 1], [1, 1.3]);
      break;
    case "zoom_out":
      scale = interpolate(eased, [0, 1], [1.3, 1]);
      break;
    case "pan_lr": {
      const tx = interpolate(eased, [0, 1], [-10, 10]);
      scale = 1.15;
      transform = `translateX(${tx}%)`;
      break;
    }
    case "pan_rl": {
      const tx = interpolate(eased, [0, 1], [10, -10]);
      scale = 1.15;
      transform = `translateX(${tx}%)`;
      break;
    }
    case "pan_tb": {
      const ty = interpolate(eased, [0, 1], [-8, 8]);
      scale = 1.15;
      transform = `translateY(${ty}%)`;
      break;
    }
    case "pan_bt": {
      const ty = interpolate(eased, [0, 1], [8, -8]);
      scale = 1.15;
      transform = `translateY(${ty}%)`;
      break;
    }
    case "drift": {
      const tx = interpolate(eased, [0, 1], [-5, 5]);
      const ty = interpolate(eased, [0, 1], [-3, 3]);
      scale = interpolate(eased, [0, 1], [1.1, 1.25]);
      transform = `translate(${tx}%, ${ty}%)`;
      break;
    }
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `${transform} scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};
