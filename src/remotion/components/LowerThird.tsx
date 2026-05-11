import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";

interface LowerThirdProps {
  title: string;
  subtitle: string;
  backgroundColor?: string;
  accentColor?: string;
}

export const LowerThird: React.FC<LowerThirdProps> = ({
  title,
  subtitle,
  backgroundColor = "rgba(0,0,0,0.85)",
  accentColor = "#4CAF50",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 100 },
  });

  const slideOut = interpolate(frame, [70, 85], [0, -100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const barWidth = interpolate(frame, [5, 30], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  const subtitleOpacity = interpolate(frame, [15, 25, 70, 80], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "flex-start",
        paddingBottom: 60,
        paddingLeft: 40,
      }}
    >
      <div
        style={{
          transform: `translateX(${interpolate(slideIn, [0, 1], [-300, 0])}px) translateY(${slideOut}px)`,
        }}
      >
        <div
          style={{
            backgroundColor: accentColor,
            height: 3,
            width: `${barWidth}%`,
            maxWidth: "30%",
            marginBottom: 6,
          }}
        />
        <div
          style={{
            backgroundColor,
            padding: "8px 16px",
            borderRadius: 4,
          }}
        >
          <div
            style={{
              color: "#ffffff",
              fontSize: 20,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontWeight: "bold",
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: "#cccccc",
              fontSize: 14,
              fontFamily: "Arial, Helvetica, sans-serif",
              opacity: subtitleOpacity,
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
