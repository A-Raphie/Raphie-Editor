import React from "react";
import type { PipelineProgress } from "../../../shared/types";

interface ProgressBarProps {
  progress: PipelineProgress;
}

export default function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-zinc-400">{progress.message || progress.step}</span>
        <span className="text-xs font-mono text-zinc-300">
          {progress.current}/{progress.total} ({progress.percent}%)
        </span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}
