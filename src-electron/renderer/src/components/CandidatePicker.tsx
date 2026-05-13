import React, { useState, useEffect, useRef } from "react";
import type { CandidatePreview } from "../../../shared/types";

interface CandidatePickerProps {
	candidates: CandidatePreview[];
	selectedIndex: number;
	onSelect: (index: number) => void;
	onDownload: (index: number) => void;
	isDownloading: boolean;
	hasAsset: boolean;
}

export default function CandidatePicker({ candidates, selectedIndex, onSelect, onDownload, isDownloading, hasAsset }: CandidatePickerProps) {
	const [playingIndex, setPlayingIndex] = useState<number | null>(null);
	const videoRefs = useRef<Record<number, HTMLVideoElement>>({});

	useEffect(() => {
		if (playingIndex === null) return;
		const idx = playingIndex;
		const video = videoRefs.current[idx];
		if (video) video.play().catch(() => {});
		return () => {
			const v = videoRefs.current[idx];
			if (v) {
				v.pause();
				v.currentTime = 0;
			}
		};
	}, [playingIndex]);

	if (candidates.length === 0) return null;

	return (
		<div className="mt-2 pt-2 border-t border-zinc-800">
			<div className="flex items-center justify-between mb-2">
				<span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
					{candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
				</span>
				<button
					onClick={() => onDownload(selectedIndex)}
					disabled={isDownloading || hasAsset}
					className={`px-3 py-1 rounded text-[10px] font-semibold transition-all ${isDownloading ? "bg-zinc-700 text-zinc-500 cursor-wait" : hasAsset ? "bg-emerald-600/20 text-emerald-400 cursor-default" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black"}`}
				>
					{isDownloading ? "Downloading..." : hasAsset ? "Downloaded" : "Download This"}
				</button>
			</div>
			<div className="grid grid-cols-5 gap-2">
				{candidates.map((candidate, i) => {
					const isSelected = i === selectedIndex;
					const isClip = candidate.type === "clip";
					return (
						<div
							key={i}
							onClick={() => onSelect(i)}
							onMouseEnter={() => isClip && setPlayingIndex(i)}
							onMouseLeave={() => setPlayingIndex(null)}
							className={`relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${isSelected ? "border-amber-500 shadow-md shadow-amber-500/20" : "border-zinc-700 hover:border-zinc-500"}`}
							style={{ aspectRatio: "16/10" }}
						>
							{isClip && candidate.previewUrl ? (
								<video
									ref={(el) => { if (el) videoRefs.current[i] = el; }}
									src={candidate.previewUrl}
									poster={candidate.thumbnailUrl || undefined}
									preload={playingIndex === i ? "auto" : "metadata"}
									muted
									loop
									playsInline
									className="w-full h-full object-cover"
								/>
							) : candidate.thumbnailUrl ? (
								<img src={candidate.thumbnailUrl} className="w-full h-full object-cover" alt="" />
							) : (
								<div className="w-full h-full bg-zinc-800 flex items-center justify-center">
									<span className="text-[10px] text-zinc-600">No preview</span>
								</div>
							)}
							<div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
							<div className="absolute top-1 left-1 flex items-center gap-1">
								<span className={`text-[7px] font-bold px-1 py-0.5 rounded ${candidate.source === "pexels" ? "bg-green-600/80 text-white" : "bg-blue-600/80 text-white"}`}>
									{candidate.source}
								</span>
							</div>
							<div className="absolute bottom-1 left-1 right-1 flex items-center justify-between">
								<span className="text-[8px] text-zinc-300 font-medium">{candidate.width}x{candidate.height}</span>
								{isClip && candidate.duration > 0 && (
									<span className="text-[8px] text-zinc-300 font-medium">{candidate.duration.toFixed(0)}s</span>
								)}
							</div>
							{isSelected && (
								<div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
									<span className="text-[8px] text-black font-bold">✓</span>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
