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

const PAGE_SIZE = 5;

export default function CandidatePicker({ candidates, selectedIndex, onSelect, onDownload, isDownloading, hasAsset }: CandidatePickerProps) {
	const [page, setPage] = useState(0);
	const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
	const videoRefs = useRef<Record<number, HTMLVideoElement>>({});

	const totalPages = Math.ceil(candidates.length / PAGE_SIZE);

	useEffect(() => {
		setPage(0);
	}, [candidates.length]);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") { setFullscreenIndex(null); return; }
			if (fullscreenIndex !== null) return;
			if (e.key === "ArrowRight" && page < totalPages - 1) setPage((p) => p + 1);
			if (e.key === "ArrowLeft" && page > 0) setPage((p) => p - 1);
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [page, totalPages, fullscreenIndex]);

	if (candidates.length === 0) return null;

	const start = page * PAGE_SIZE;
	const end = Math.min(start + PAGE_SIZE, candidates.length);
	const visible = candidates.slice(start, end);
	const showPagination = candidates.length > PAGE_SIZE;

	const fsCandidate = fullscreenIndex !== null ? candidates[fullscreenIndex] : null;
	const fsIsClip = fsCandidate?.type === "clip";

	return (
		<>
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
				{showPagination && (
					<div className="flex items-center justify-center gap-2 mb-2">
						<button
							onClick={() => setPage((p) => Math.max(0, p - 1))}
							disabled={page === 0}
							className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all ${page === 0 ? "bg-zinc-800 text-zinc-700 cursor-default" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"}`}
						>
							‹
						</button>
						<span className="text-[10px] text-zinc-500 font-medium tabular-nums min-w-[80px] text-center">
							{start + 1}–{end} of {candidates.length}
						</span>
						<button
							onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
							disabled={page >= totalPages - 1}
							className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all ${page >= totalPages - 1 ? "bg-zinc-800 text-zinc-700 cursor-default" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"}`}
						>
							›
						</button>
					</div>
				)}
				<div className="grid grid-cols-5 gap-2">
					{visible.map((candidate, i) => {
						const globalIndex = start + i;
						const isSelected = globalIndex === selectedIndex;
						const isClip = candidate.type === "clip";
						return (
							<div
								key={globalIndex}
								onClick={() => onSelect(globalIndex)}
								className={`relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${isSelected ? "border-amber-500 shadow-md shadow-amber-500/20" : "border-zinc-700 hover:border-zinc-500"}`}
								style={{ aspectRatio: "16/9" }}
							>
								{isClip && candidate.previewUrl ? (
									<video
										ref={(el) => { if (el) videoRefs.current[globalIndex] = el; }}
										src={candidate.previewUrl}
										poster={candidate.thumbnailUrl || undefined}
										preload="metadata"
										muted
										loop
										playsInline
										autoPlay
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
									<span className={`text-[6px] font-bold px-1 py-0.5 rounded ${candidate.source === "pexels" ? "bg-green-600/80 text-white" : "bg-blue-600/80 text-white"}`}>
										{candidate.source}
									</span>
								</div>
								<button
									onClick={(e) => { e.stopPropagation(); setFullscreenIndex(globalIndex); }}
									className="absolute top-1 right-1 w-4 h-4 rounded bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
								>
									<span className="text-[8px] text-white">⛶</span>
								</button>
								<div className="absolute bottom-1 left-1 right-1 flex items-center justify-between">
									<span className="text-[6px] text-zinc-300 font-medium">{candidate.width}x{candidate.height}</span>
									{isClip && candidate.duration > 0 && (
										<span className="text-[6px] text-zinc-300 font-medium">{candidate.duration.toFixed(0)}s</span>
									)}
								</div>
								{isSelected && (
									<div className="absolute top-1 right-7 w-3 h-3 rounded-full bg-amber-500 flex items-center justify-center">
										<span className="text-[7px] text-black font-bold">✓</span>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>

			{fullscreenIndex !== null && fsCandidate && (
				<div
					className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
					onClick={() => setFullscreenIndex(null)}
				>
					<div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
						<button
							onClick={() => setFullscreenIndex(null)}
							className="absolute -top-8 right-0 text-zinc-400 hover:text-white text-lg font-bold"
						>
							✕
						</button>
						<div className="w-[80vw] max-w-[1280px] aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
							{fsIsClip && fsCandidate.previewUrl ? (
								<video
									src={fsCandidate.previewUrl}
									poster={fsCandidate.thumbnailUrl || undefined}
									autoPlay
									muted
									loop
									playsInline
									className="w-full h-full object-contain"
								/>
							) : fsCandidate.thumbnailUrl ? (
								<img src={fsCandidate.thumbnailUrl} className="w-full h-full object-contain" alt="" />
							) : (
								<div className="w-full h-full flex items-center justify-center">
									<span className="text-zinc-500">No preview</span>
								</div>
							)}
						</div>
						<div className="mt-3 flex items-center gap-3">
							<span className={`text-[10px] font-bold px-2 py-0.5 rounded ${fsCandidate.source === "pexels" ? "bg-green-600/80 text-white" : "bg-blue-600/80 text-white"}`}>
								{fsCandidate.source}
							</span>
							<span className="text-xs text-zinc-400">{fsCandidate.width}×{fsCandidate.height}</span>
							{fsIsClip && fsCandidate.duration > 0 && (
								<span className="text-xs text-zinc-400">{fsCandidate.duration.toFixed(1)}s</span>
							)}
							<button
								onClick={() => onDownload(fullscreenIndex)}
								disabled={isDownloading || hasAsset}
								className={`ml-2 px-3 py-1 rounded text-xs font-semibold transition-all ${isDownloading ? "bg-zinc-700 text-zinc-500 cursor-wait" : hasAsset ? "bg-emerald-600/20 text-emerald-400 cursor-default" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black"}`}
							>
								{isDownloading ? "Downloading..." : hasAsset ? "Downloaded" : "Download This"}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
