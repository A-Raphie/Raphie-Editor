import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
} from "remotion";
import type { TransitionType } from "../../types/scenePlan";

interface TransitionProps {
  type: TransitionType;
  duration: number;
  direction: "in" | "out";
  children: React.ReactNode;
}

export const Transition: React.FC<TransitionProps> = ({
  type,
  duration,
  direction,
  children,
}) => {
  const frame = useCurrentFrame();

  let animationStyle: React.CSSProperties = {};

  switch (type) {
    case "crossfade": {
      const opacity = direction === "in"
        ? interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(frame, [0, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      animationStyle = { opacity };
      break;
    }

    case "fade": {
      const opacity = direction === "in"
        ? interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(frame, [0, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      animationStyle = { opacity };
      break;
    }

    case "zoom_through": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (direction === "out") {
        const scale = interpolate(progress, [0, 1], [1, 3]);
        const opacity = interpolate(progress, [0, 0.7, 1], [1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        animationStyle = { transform: `scale(${scale})`, opacity };
      } else {
        const scale = interpolate(progress, [0, 1], [0.3, 1]);
        const opacity = interpolate(progress, [0, 0.3, 1], [0, 0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        animationStyle = { transform: `scale(${scale})`, opacity };
      }
      break;
    }

    case "slide_left": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (direction === "in") {
        const x = interpolate(progress, [0, 1], [100, 0]);
        animationStyle = { transform: `translateX(${x}%)` };
      } else {
        const x = interpolate(progress, [0, 1], [0, -100]);
        animationStyle = { transform: `translateX(${x}%)` };
      }
      break;
    }

    case "slide_up": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (direction === "in") {
        const y = interpolate(progress, [0, 1], [100, 0]);
        animationStyle = { transform: `translateY(${y}%)` };
      } else {
        const y = interpolate(progress, [0, 1], [0, -100]);
        animationStyle = { transform: `translateY(${y}%)` };
      }
      break;
    }

    case "whip_pan": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (direction === "out") {
        const x = interpolate(progress, [0, 0.5, 1], [0, -30, -100]);
        animationStyle = { transform: `translateX(${x}%)` };
      } else {
        const x = interpolate(progress, [0, 0.5, 1], [100, 30, 0]);
        animationStyle = { transform: `translateX(${x}%)` };
      }
      break;
    }

    case "flash_white": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (direction === "in") {
        const opacity = interpolate(progress, [0, 0.2, 0.5, 1], [0, 0, 0.8, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        animationStyle = { opacity };
      } else {
        const opacity = interpolate(progress, [0, 0.5, 0.8, 1], [1, 1, 0, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        animationStyle = { opacity };
      }
      break;
    }

    case "blur": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (direction === "out") {
        const blur = interpolate(progress, [0, 1], [0, 30]);
        const opacity = interpolate(progress, [0, 0.7, 1], [1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        animationStyle = { filter: `blur(${blur}px)`, opacity };
      } else {
        const blur = interpolate(progress, [0, 1], [30, 0]);
        const opacity = interpolate(progress, [0, 0.3, 1], [0, 0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        animationStyle = { filter: `blur(${blur}px)`, opacity };
      }
      break;
    }

    case "glitch": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const intensity = direction === "in"
        ? interpolate(progress, [0, 0.5, 1], [15, 5, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(progress, [0, 0.5, 1], [0, 5, 15], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const skewX = Math.sin(frame * 0.8) * intensity;
      const translateX = Math.cos(frame * 1.2) * intensity;
      animationStyle = {
        transform: `skewX(${skewX}deg) translateX(${translateX}px)`,
      };
      break;
    }

    case "mask_wipe": {
      const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      if (direction === "in") {
        const clipPath = `inset(0 ${interpolate(progress, [0, 1], [100, 0])}% 0 0)`;
        animationStyle = { clipPath };
      } else {
        const clipPath = `inset(0 0 0 ${interpolate(progress, [0, 1], [0, 100])}%)`;
        animationStyle = { clipPath };
      }
      break;
    }
  }

  return (
    <AbsoluteFill style={animationStyle}>
      {children}
    </AbsoluteFill>
  );
};
