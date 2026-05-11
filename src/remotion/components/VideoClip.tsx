import React from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";

interface VideoClipProps {
  src: string;
}

export const VideoClip: React.FC<VideoClipProps> = ({ src }) => {
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <OffthreadVideo
        src={src}
        muted={true}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </AbsoluteFill>
  );
};
