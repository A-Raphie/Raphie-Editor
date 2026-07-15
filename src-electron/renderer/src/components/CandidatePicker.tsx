import React, { useState, useEffect, useRef } from "react";
import type { CandidatePreview } from "../../../shared/types";

interface CandidatePickerProps {
	candidates: CandidatePreview[];
	selectedIndex: number;
	onSelect: (index: number) => void;
	onDownload: (index: number) => void;
	isDownloading: boolean;
	hasAsset: boolean;
	usedUrls?: Set<string>;
	sectionLabel?: string;
	sectionContext?: string;
}

export default function CandidatePicker({ candidates, selectedIndex, onSelect, onDownload, isDownloading, hasAsset, usedUrls, sectionLabel: sectionLabelText, sectionContext }: CandidatePickerProps) {
	const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
	const videoRefs = useRef<Record<number, HTMLVideoElement>>({});
	const scrollRef = useRef<HTMLDivElement>(null);
	const selectedRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (selectedRef.current) {
			selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
		}
	}, [selectedIndex]);

	useEffect(() => {
		const container = scrollRef.current;
		if (!container) return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const video = entry.target as HTMLVideoElement;
					if (entry.isIntersecting) {
						video.play().catch(() => {});
					} else {
						video.pause();
					}
				}
			},
			{ root: container, threshold: 0.5 }
		);
		const videos = container.querySelectorAll("video");
		videos.forEach((v) => observer.observe(v));
		return () => observer.disconnect();
	}, [candidates]);

	if (candidates.length === 0) return null;

	const fsCandidate = fullscreenIndex !== null ? candidates[fullscreenIndex] : null;
	const fsIsClip = fsCandidate?.type === "clip";

	return (
		<>
			<div className="mt-1.5 pt-1.5 border-t border-zinc-800">
				{sectionContext && (
					<div className="flex items-center gap-1.5 mb-1 px-0.5">
						<span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">Section</span>
						{sectionLabelText && <span className="text-[10px] font-medium text-amber-400">{sectionLabelText}</span>}
						<span className="text-zinc-600">—</span>
						<span className="text-[10px] text-zinc-400">pick images matching <span className="text-zinc-200 font-medium">"{sectionContext}"</span></span>
					</div>
				)}
				<div
					ref={scrollRef}
					className="flex gap-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent pb-1"
					style={{ scrollSnapType: "x mandatory" }}
				>
							{candidates.map((candidate, i) => {
						const isSelected = i === selectedIndex;
						const isClip = candidate.type === "clip";
						const isDup = usedUrls?.has(candidate.url);
						return (
							<div
								key={i}
								ref={isSelected ? selectedRef : undefined}
								onClick={() => onSelect(i)}
								className={`relative rounded overflow-hidden border-2 cursor-pointer transition-all shrink-0 ${isSelected ? "border-amber-500 shadow-md shadow-amber-500/20" : "border-zinc-700 hover:border-zinc-500"}`}
								style={{ aspectRatio: "16/9", width: "calc(20% - 6px)", scrollSnapAlign: "start" }}
							>
								{isClip && candidate.previewUrl ? (
									<video
										ref={(el) => { if (el) videoRefs.current[i] = el; }}
										src={candidate.previewUrl}
										poster={candidate.thumbnailUrl || undefined}
										preload="metadata"
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
								<div className="absolute top-0.5 left-0.5 flex items-center gap-0.5">
									<span className={`text-[5px] font-bold px-0.5 py-px rounded ${candidate.source === "pexels" ? "bg-green-600/80 text-white" : "bg-blue-600/80 text-white"}`}>
										{candidate.source}
									</span>
									{isDup && (
										<span className="text-[5px] font-bold px-0.5 py-px rounded bg-orange-600/80 text-white">DUP</span>
									)}
								</div>
								<button
									onClick={(e) => { e.stopPropagation(); setFullscreenIndex(i); }}
									className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
								>
									<span className="text-[7px] text-white">⛶</span>
								</button>
								<div className="absolute bottom-0.5 left-0.5 right-0.5 flex items-center justify-between">
									<span className="text-[8px] text-zinc-100 font-medium truncate max-w-[70%]">{(candidate as any).tags || (candidate as any).pageUrl?.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') || `${candidate.width}x${candidate.height}`}</span>
									{isClip && candidate.duration > 0 && (
										<span className="text-[8px] text-zinc-100 font-medium shrink-0">{candidate.duration.toFixed(0)}s</span>
									)}
								</div>
								{isSelected && (
									<div className="absolute top-0.5 right-5 w-2.5 h-2.5 rounded-full bg-amber-500 flex items-center justify-center">
										<span className="text-[6px] text-black font-bold">✓</span>
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
						<div className="mt-3 flex items-center gap-3 flex-wrap justify-center">
							<span className={`text-[10px] font-bold px-2 py-0.5 rounded ${fsCandidate.source === "pexels" ? "bg-green-600/80 text-white" : "bg-blue-600/80 text-white"}`}>
								{fsCandidate.source}
							</span>
							<span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">
								{fsCandidate.type || (fsIsClip ? "clip" : "image")}
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
						{(fsCandidate as any).tags && (
							<div className="mt-2 max-w-[80vw] text-center">
								<span className="text-[10px] text-zinc-500">Tags: </span>
								<span className="text-[10px] text-zinc-300">{(fsCandidate as any).tags}</span>
							</div>
						)}
						{(fsCandidate as any).pageUrl && (
							<div className="mt-1 max-w-[80vw] text-center">
								<a
									href={(fsCandidate as any).pageUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-[10px] text-blue-400 hover:text-blue-300 underline truncate inline-block max-w-full align-bottom"
									onClick={(e) => e.stopPropagation()}
								>
									{(fsCandidate as any).pageUrl}
								</a>
							</div>
						)}
					</div>
				</div>
			)}
		</>
	);
}
