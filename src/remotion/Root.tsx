import React from "react";
import { Composition } from "remotion";
import { Documentary } from "./compositions/Documentary";
import type { ScenePlan, AssetMapping } from "../types/scenePlan";

interface CompProps {
  scenePlan: ScenePlan;
  assets: AssetMapping;
  voPath?: string;
  musicPath?: string;
}

const defaultProps: CompProps = {
  scenePlan: { title: "Test", fps: 30, totalDurationSeconds: 300, beats: [] },
  assets: {},
  voPath: undefined,
  musicPath: undefined,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Documentary"
        component={Documentary as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={9000}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultProps as unknown as Record<string, unknown>}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as CompProps;
          const durationSeconds = p.scenePlan?.totalDurationSeconds ?? 300;
          return {
            durationInFrames: Math.round(durationSeconds * 30),
            props,
          };
        }}
      />
    </>
  );
};
