import React, { useState } from "react";
import type { CandidatePreview } from "../../../shared/types";

interface Beat {
	id: string;
	type: string;
	duration: number;
	searchQuery?: string;
	overlay?: { type: string; [key: string]: any };
	[key: string]: any;
}

interface BeatStatus {
	status: string;
	downloadPercent?: number;
	error?: string;
	errorDetails?: string;
}

interface AssetValidation {
	valid: boolean;
	reason?: string;
	hasAsset?: boolean;
}

interface BeatTimelineProps {
	beats: Beat[];
	selectedBeatId: string | null;
	onSelectBeat: (id: string | null) => void;
	assets: Record<string, string>;
	thumbnails: Record<string, string>;
	beatStatuses: Record<string, BeatStatus>;
	assetValidation: Record<string, AssetValidation>;
	subscribeHintBeatIds: Set<string>;
	beatCandidates: Record<string, CandidatePreview[]>;
	selectedCandidateIndex: Record<string, number>;
	filterMode: string | null;
	onFilterChange: (mode: string | null) => void;
}

export default function BeatTimeline({ beats, selectedBeatId, onSelectBeat, assets, thumbnails, beatStatuses, assetValidation, subscribeHintBeatIds, beatCandidates, selectedCandidateIndex, filterMode, onFilterChange }: BeatTimelineProps) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [subOnly, setSubOnly] = useState(false);

	const subBeats = beats.filter((b) => b.overlay?.type === "subscribe_cta" || subscribeHintBeatIds?.has(b.id));
	const baseBeats = subOnly ? subBeats : beats;

	const assetableBeats = beats.filter((b) => b.type === "clip" || b.type === "image");
	const missingDownloadCount = assetableBeats.filter((b) => !assets?.[b.id]).length;
	const missingThumbnailCount = assetableBeats.filter((b) => !assets?.[b.id] && !beatCandidates?.[b.id]?.length).length;

	const displayedBeats = baseBeats.filter((b) => {
		if (filterMode === "missingDownload") return !assets?.[b.id];
		if (filterMode === "missingThumbnail") return !assets?.[b.id] && !beatCandidates?.[b.id]?.length;
		return true;
	});

	const getBorderColor = (beat: Beat) => {
		const validation = assetValidation?.[beat.id];
		const beatStatus = beatStatuses?.[beat.id];
		const hasAsset = !!assets?.[beat.id];
		const isActive = beatStatus?.status === "downloading" || beatStatus?.status === "searching" || beatStatus?.status === "checking";
		const isDone = beatStatus?.status === "done";
		const isFailed = beatStatus?.status === "failed";
		if (isActive) return "border-yellow-500 shadow-yellow-500/30";
		if (isDone) return "border-emerald-500 shadow-emerald-500/20";
		if (isFailed) return "border-red-500 shadow-red-500/30";
		if (validation && !validation.valid) return "border-red-500/60";
		if (hasAsset && validation?.valid) return "border-emerald-500/50 shadow-emerald-500/10";
		if (hasAsset) return "border-zinc-600";
		return "border-zinc-700";
	};

	const getBgColor = (beat: Beat) => {
		if (beat.type === "clip") return "bg-blue-900/30";
		return "bg-purple-900/30";
	};

	return (
		<div className="bg-zinc-900/50 rounded-xl p-4">
			<div className="flex items-center justify-between mb-4 px-1">
				<div className="flex items-center gap-3">
					<h3 className="text-sm font-semibold text-zinc-300">
						Scene Plan — <span className="text-amber-400">{beats.length} beats</span>
					</h3>
					{subBeats.length > 0 && (
						<button
							onClick={() => setSubOnly(!subOnly)}
							className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-all ${subOnly ? "bg-red-950/80 text-red-300 border-red-500/50" : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300"}`}
						>
							SUB
						</button>
					)}
					<button
						onClick={() => onFilterChange(filterMode === "missingDownload" ? null : "missingDownload")}
						className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-all ${filterMode === "missingDownload" ? "bg-red-950/80 text-red-300 border-red-500/50" : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300"}`}
					>
						Missing Download <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filterMode === "missingDownload" ? "bg-red-500/30" : "bg-red-500/20 text-red-400"}`}>{missingDownloadCount}</span>
					</button>
					<button
						onClick={() => onFilterChange(filterMode === "missingThumbnail" ? null : "missingThumbnail")}
						className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-all ${filterMode === "missingThumbnail" ? "bg-orange-950/80 text-orange-300 border-orange-500/50" : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300"}`}
					>
						Missing Thumbnail <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filterMode === "missingThumbnail" ? "bg-orange-500/30" : "bg-orange-500/20 text-orange-400"}`}>{missingThumbnailCount}</span>
					</button>
					{filterMode && (
						<button
							onClick={() => onFilterChange(null)}
							className="text-xs px-2 py-1 rounded-md border font-medium bg-zinc-700 text-zinc-300 border-zinc-600 hover:bg-zinc-600 transition-all"
						>
							✕ Clear
						</button>
					)}
				</div>
			</div>
			<div
				className="flex flex-wrap gap-3 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
				style={{ maxHeight: "calc(100vh - 340px)", overflowY: "auto" }}
			>
				{displayedBeats.map((beat, i) => {
					const origIdx = beats.indexOf(beat);
					const isSelected = beat.id === selectedBeatId;
					const hasAsset = !!assets?.[beat.id];
					const thumbUrl = thumbnails?.[beat.id];
					const selectedCandidate = beatCandidates?.[beat.id]?.[selectedCandidateIndex?.[beat.id] ?? 0];
					const previewThumb = !hasAsset && selectedCandidate?.thumbnailUrl ? selectedCandidate.thumbnailUrl : null;
					const beatStatus = beatStatuses?.[beat.id];
					const validation = assetValidation?.[beat.id];
					const isHovered = hoveredId === beat.id;
					const isActive = beatStatus?.status === "downloading" || beatStatus?.status === "searching" || beatStatus?.status === "checking";
					const isDone = beatStatus?.status === "done";
					const isFailed = beatStatus?.status === "failed";
					const borderColor = getBorderColor(beat);
					const isInvalid = validation && !validation.valid;
					const isValid = hasAsset && validation?.valid;

					return (
						<button
							key={beat.id}
							onClick={() => onSelectBeat(isSelected ? null : beat.id)}
							onMouseEnter={() => setHoveredId(beat.id)}
							onMouseLeave={() => setHoveredId(null)}
							className={`relative rounded-lg border-2 overflow-hidden transition-all duration-150 cursor-pointer ${isSelected ? "ring-2 ring-white/80 ring-offset-2 ring-offset-zinc-900" : ""} ${borderColor} ${isHovered ? "transform scale-[1.02] shadow-lg" : "shadow-sm"}`}
							style={{ width: 128, height: 80 }}
							title={`#${origIdx + 1} ${beat.type} — ${beat.duration}s\n${beat.searchQuery || ""}`}
						>
							{previewThumb ? (
								<img key={previewThumb} src={previewThumb} className="w-full h-full object-cover" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
							) : thumbUrl ? (
								<img key={thumbUrl} src={`file://${thumbUrl}`} className="w-full h-full object-cover" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
							) : (
								<div className={`w-full h-full flex items-center justify-center ${getBgColor(beat)}`}>
									<span className="text-xs text-zinc-500 font-medium">{origIdx + 1}</span>
								</div>
							)}

							<div className="absolute top-1.5 right-1.5">
								{isActive && <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />}
								{isDone && !isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
								{isFailed && !isActive && <div className="w-1.5 h-1.5 rounded-full bg-red-500" />}
							</div>

							{(beat.overlay?.type === "subscribe_cta" || subscribeHintBeatIds?.has(beat.id)) && (
								<div className="absolute bottom-0.5 left-1">
									<span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${beat.overlay?.type === "subscribe_cta" ? "text-red-300 bg-red-950/90" : "text-amber-300 bg-amber-950/90"}`}>
										🔔 {beat.overlay?.type === "subscribe_cta" ? "SUB" : ""}
									</span>
								</div>
							)}

							{beatCandidates?.[beat.id] && !hasAsset && (
								<div className="absolute bottom-1 right-1">
									<div
										className="flex items-center gap-0.5 bg-amber-500/90 text-black px-1 py-0.5 rounded"
										title={`${beatCandidates[beat.id].length} candidate${beatCandidates[beat.id].length !== 1 ? "s" : ""} — download needed`}
									>
										<svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
											<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
										</svg>
										<span className="text-[7px] font-bold">{beatCandidates[beat.id].length}</span>
									</div>
								</div>
							)}

							{isActive && beatStatus?.downloadPercent !== undefined && (
								<div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700">
									<div className="h-full bg-blue-500 transition-all" style={{ width: `${beatStatus.downloadPercent}%` }} />
								</div>
							)}

							{isHovered && (
								<>
									{isActive && beatStatus?.downloadPercent !== undefined && (
										<div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center">
											<div className="w-14 h-1.5 bg-zinc-600 rounded-full overflow-hidden">
												<div className="h-full bg-blue-400 rounded-full" style={{ width: `${beatStatus.downloadPercent}%` }} />
											</div>
											<span className="text-[8px] text-blue-300 mt-1 font-medium">{beatStatus.downloadPercent}%</span>
										</div>
									)}
									{isActive && beatStatus?.status === "searching" && (
										<div className="absolute inset-0 bg-black/75 flex items-center justify-center">
											<span className="text-[8px] text-amber-300 font-medium">Searching...</span>
										</div>
									)}
									{isActive && beatStatus?.status === "checking" && (
										<div className="absolute inset-0 bg-black/75 flex items-center justify-center">
											<span className="text-[8px] text-amber-300 font-medium">Checking...</span>
										</div>
									)}
									{isDone && !isActive && (
										<div className="absolute inset-0 bg-emerald-500/50 flex items-center justify-center">
											<span className="text-[9px] text-emerald-100 font-bold">DONE</span>
										</div>
									)}
									{isFailed && !isActive && (
										<div className="absolute inset-0 bg-red-500/50 flex flex-col items-center justify-center group">
											<span className="text-[8px] text-red-100 font-bold">
												{beatStatus?.error === "no_candidates" ? "NO RESULTS" : beatStatus?.error === "quality_rejected" ? "Q REJECTED" : "FAILED"}
											</span>
											{beatStatus?.errorDetails && (
												<div className="absolute bottom-full mb-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-[8px] text-zinc-300 whitespace-nowrap hidden group-hover:block max-w-[120px] truncate">
													{beatStatus.errorDetails}
												</div>
											)}
										</div>
									)}
									<div className="absolute top-1 left-1.5 flex flex-col gap-0.5">
										<span className="text-[9px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{origIdx + 1}</span>
										{isInvalid && !isFailed && (
											<span className={`text-[7px] font-bold px-1 rounded ${validation?.reason === "corrupt" ? "bg-red-600 text-white" : validation?.reason === "quality_failed" ? "bg-amber-600 text-white" : "bg-red-600 text-white"}`}>
												{validation?.reason === "corrupt" ? "CORRUPT" : validation?.reason === "quality_failed" ? "BAD QUAL" : "MISSING"}
											</span>
										)}
										{isValid && !isDone && <span className="text-[8px] font-bold text-emerald-300">✓</span>}
									</div>
								</>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}
