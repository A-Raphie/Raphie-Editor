import React, { useState, useEffect } from "react";
import CandidatePicker from "./CandidatePicker";
import type { CandidatePreview } from "../../../shared/types";

interface Beat {
	id: string;
	type: string;
	duration: number;
	searchQuery?: string;
	imageAnimation?: string;
	overlay?: { type: string; [key: string]: any };
	[key: string]: any;
}

interface BeatStatus {
	status: string;
	downloadPercent?: number;
	error?: string;
	errorDetails?: string;
}

interface BeatEditorProps {
	beat: Beat;
	thumbnail: string | undefined;
	assetPath: string | undefined;
	onReDownload: ((beatId: string, query: string) => void) | undefined;
	onSaveSearch: ((beatId: string, query: string) => void) | undefined;
	onToggleOverlay: ((beatId: string) => void) | undefined;
	onSearchBeat: ((beatId: string, query: string) => void) | undefined;
	onSelectCandidate: ((beatId: string, index: number) => void) | undefined;
	onDownloadCandidate: ((beatId: string, index: number) => void) | undefined;
	isReDownloading: boolean;
	beatStatus: BeatStatus | undefined;
	subscribeHint: boolean;
	candidates: CandidatePreview[] | undefined;
	selectedCandidateIndex: number | undefined;
	scriptSegment: string | undefined;
}

export default function BeatEditor({ beat, thumbnail, assetPath, onReDownload, onSaveSearch, onToggleOverlay, onSearchBeat, onSelectCandidate, onDownloadCandidate, isReDownloading, beatStatus, subscribeHint, candidates, selectedCandidateIndex, scriptSegment }: BeatEditorProps) {
	const [query, setQuery] = useState(beat.searchQuery ?? "");

	useEffect(() => {
		setQuery(beat.searchQuery ?? "");
	}, [beat.id, beat.searchQuery]);

	const isDownloading = beatStatus?.status === "downloading";
	const isSearching = beatStatus?.status === "searching";
	const isChecking = beatStatus?.status === "checking";
	const isActive = isDownloading || isSearching || isChecking;

	return (
		<div className="bg-zinc-900 p-3 border-t border-zinc-800">
			<div className="flex gap-4">
				<div className="flex-shrink-0">
					{thumbnail ? (
						<div className="relative w-28 h-20 rounded-lg overflow-hidden border border-zinc-700">
							<img key={thumbnail} src={`file://${thumbnail.split("?")[0]}?t=${beat.id}`} className="w-full h-full object-cover" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
							{isDownloading && (
								<div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center">
									<div className="w-16 h-1.5 bg-zinc-600 rounded-full overflow-hidden">
										<div className="h-full bg-blue-400 rounded-full" style={{ width: `${beatStatus?.downloadPercent ?? 0}%` }} />
									</div>
									<span className="text-[8px] text-blue-300 mt-1">{beatStatus?.downloadPercent ?? 0}%</span>
								</div>
							)}
						</div>
					) : (
						<div className="w-28 h-20 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center">
							<span className="text-xs text-zinc-600">No thumb</span>
						</div>
					)}
				</div>
				<div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
					<div className="flex items-center gap-2">
						<span className="text-zinc-500">Beat</span>
						<span className="font-mono text-zinc-300">{beat.id}</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-zinc-500">Type</span>
						<span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${beat.type === "clip" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"}`}>{beat.type}</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-zinc-500">Duration</span>
						<span className="text-zinc-300">{beat.duration}s</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-zinc-500">Asset</span>
						{assetPath ? <span className="text-emerald-400">✓ Ready</span> : <span className="text-red-400">Missing</span>}
					</div>
					{beat.type === "image" && beat.imageAnimation && (
						<div className="flex items-center gap-2">
							<span className="text-zinc-500">Anim</span>
							<span className="text-zinc-300">{beat.imageAnimation.replace(/_/g, " ")}</span>
						</div>
					)}
					{subscribeHint && !beat.overlay && (
						<div className="flex items-center gap-2">
							<span className="text-zinc-500">Hint</span>
							<span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300">🔔 Subscribe detected</span>
						</div>
					)}
					{beat.overlay && (
						<div className="flex items-center gap-2">
							<span className="text-zinc-500">Overlay</span>
							{beat.overlay.type === "subscribe_cta" ? (
								<span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-300">CTA</span>
							) : (
								<span className="text-zinc-300">{beat.overlay.type.replace(/_/g, " ")}</span>
							)}
						</div>
					)}
					{isActive && (
						<div className="col-span-2 flex items-center gap-2 mt-1">
							<span className="text-amber-400">
								{isDownloading ? `Downloading ${beatStatus?.downloadPercent ?? 0}%` : isSearching ? "Searching..." : "Quality check..."}
							</span>
						</div>
					)}
				</div>
			</div>

			{candidates && candidates.length > 0 && (
				<CandidatePicker
					candidates={candidates}
					selectedIndex={selectedCandidateIndex ?? 0}
					onSelect={(index) => onSelectCandidate?.(beat.id, index)}
					onDownload={(index) => onDownloadCandidate?.(beat.id, index)}
					isDownloading={isDownloading}
					hasAsset={!!assetPath}
				/>
			)}

			<div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-800">
				<span className="text-xs text-zinc-500 shrink-0">Search</span>
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
					placeholder="Enter search query..."
				/>
				<button
					onClick={() => onSaveSearch?.(beat.id, query)}
					disabled={!query.trim()}
					className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${!query.trim() ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-zinc-600 hover:bg-zinc-500 text-zinc-200"}`}
				>
					Save
				</button>
				<button
					onClick={() => onSearchBeat?.(beat.id, query)}
					disabled={isReDownloading || isSearching || !query.trim()}
					className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${isReDownloading || isSearching || !query.trim() ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-zinc-900 font-semibold"}`}
				>
					{isSearching ? "Searching..." : "Preview"}
				</button>
				<button
					onClick={() => onReDownload?.(beat.id, query)}
					disabled={isReDownloading || !query.trim()}
					className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${isReDownloading || !query.trim() ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-zinc-600 hover:bg-zinc-500 text-zinc-200"}`}
				>
					{isReDownloading ? "..." : "Re-download"}
				</button>
				<button
					onClick={() => assetPath && window.api.openInFinder(assetPath)}
					disabled={!assetPath}
					className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${!assetPath ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-zinc-600 hover:bg-zinc-500 text-zinc-200"}`}
				>
					Finder
				</button>
				{!beat.overlay ? (
					<button
						onClick={() => onToggleOverlay?.(beat.id)}
						className="px-3 py-1.5 rounded text-xs font-medium transition-colors bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30"
					>
						Add CTA
					</button>
				) : (
					<button
						onClick={() => onToggleOverlay?.(beat.id)}
						className="px-3 py-1.5 rounded text-xs font-medium transition-colors bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
					>
						Remove CTA
					</button>
				)}
			</div>

			{scriptSegment && (
				<div className="mt-3 pt-3 border-t border-zinc-800">
					<div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">Script</div>
					<div className="text-[11px] text-zinc-400 italic bg-zinc-800/50 rounded p-2 max-h-16 overflow-y-auto line-clamp-3">{scriptSegment}</div>
				</div>
			)}
		</div>
	);
}
