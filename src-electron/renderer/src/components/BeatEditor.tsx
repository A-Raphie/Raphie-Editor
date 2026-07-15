import React, { useState, useEffect, useRef } from "react";
import CandidatePicker from "./CandidatePicker";
import type { CandidatePreview } from "../../../shared/types";
import { beatDerailment, sectionLabel } from "../../../shared/sectionUtils";

interface Beat {
	id: string;
	type: string;
	duration: number;
	startTime?: number;
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
	rateLimits?: { pexelsRemaining: number; pixabayRemaining: number };
	allBeatCandidates?: Record<string, any[]>;
	allSelectedIndex?: Record<string, number>;
	sectionPlan?: any;
	onResetToSection?: ((beatId: string) => void) | undefined;
	onRepreviewSection?: ((sectionId: string) => void) | undefined;
	repreviewingSectionId?: string | null;
}

function fmtTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${String(s).padStart(2, "0")}`;
}

export default function BeatEditor({ beat, assetPath, onReDownload, onSaveSearch, onToggleOverlay, onSearchBeat, onSelectCandidate, onDownloadCandidate, isReDownloading, beatStatus, subscribeHint, candidates, selectedCandidateIndex, scriptSegment, rateLimits, allBeatCandidates, allSelectedIndex, sectionPlan, onResetToSection, onRepreviewSection, repreviewingSectionId }: BeatEditorProps) {
	const [query, setQuery] = useState(beat.searchQuery ?? "");
	const [savedFlash, setSavedFlash] = useState(false);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => {
		setQuery(beat.searchQuery ?? "");
	}, [beat.id, beat.searchQuery]);

	useEffect(() => {
		return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
	}, []);

	const isDownloading = beatStatus?.status === "downloading";
	const isSearching = beatStatus?.status === "searching";
	const isChecking = beatStatus?.status === "checking";
	const isActive = isDownloading || isSearching || isChecking;

	const startTime = beat.startTime ?? 0;
	const endTime = startTime + beat.duration;
	const derail = sectionPlan ? beatDerailment(beat, sectionPlan) : null;

	const saveIfChanged = () => {
		const trimmed = query.trim();
		if (trimmed && trimmed !== beat.searchQuery) {
			onSaveSearch?.(beat.id, trimmed);
			setSavedFlash(true);
			if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
			savedTimerRef.current = setTimeout(() => setSavedFlash(false), 1500);
		}
	};

	return (
		<div className="bg-zinc-900 p-2 border-t border-zinc-800">
			<div className="flex items-center gap-1.5 text-xs text-zinc-400 flex-wrap mb-1.5">
				<span className="font-mono text-zinc-300">{beat.id}</span>
				<span className="text-zinc-600 text-[10px] tabular-nums">{fmtTime(startTime)}–{fmtTime(endTime)}</span>
				<span className="text-zinc-600">•</span>
				<span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${beat.type === "clip" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"}`}>{beat.type}</span>
				<span className="text-zinc-600">•</span>
				<span>{beat.duration.toFixed(2)}s</span>
				<span className="text-zinc-600">•</span>
				{assetPath ? <span className="text-emerald-400">✓ Ready</span> : <span className="text-red-400">Missing</span>}
				{candidates && candidates.length > 0 && (
					<>
						<span className="text-zinc-600">•</span>
						<span className="text-zinc-500">{candidates.length} candidate{candidates.length !== 1 ? "s" : ""}</span>
					</>
				)}
				{beat.type === "image" && beat.imageAnimation && (
					<>
						<span className="text-zinc-600">•</span>
						<span>{beat.imageAnimation.replace(/_/g, " ")}</span>
					</>
				)}
				{beat.overlay?.type === "subscribe_cta" && (
					<>
						<span className="text-zinc-600">•</span>
						<span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-300">CTA</span>
					</>
				)}
				{subscribeHint && !beat.overlay && (
					<>
						<span className="text-zinc-600">•</span>
						<span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300">🔔 Subscribe</span>
					</>
				)}
				{isActive && (
					<>
						<span className="text-zinc-600">•</span>
						<span className="text-amber-400">
							{isDownloading ? `Downloading ${beatStatus?.downloadPercent ?? 0}%` : isSearching ? "Searching..." : "Quality check..."}
						</span>
					</>
				)}
				{rateLimits && (
					<>
						<span className="text-zinc-700 mx-0.5">|</span>
						<span className={`text-[10px] font-mono ${rateLimits.pexelsRemaining < 20 ? "text-red-400" : rateLimits.pexelsRemaining < 100 ? "text-amber-400" : "text-emerald-400"}`} title="Pexels API quota remaining this hour">
							P:{rateLimits.pexelsRemaining}
						</span>
						<span className={`text-[10px] font-mono ${rateLimits.pixabayRemaining < 100 ? "text-red-400" : rateLimits.pixabayRemaining < 1000 ? "text-amber-400" : "text-emerald-400"}`} title="Pixabay API quota remaining this hour">
							X:{rateLimits.pixabayRemaining}
						</span>
					</>
				)}
				{scriptSegment && (
					<>
						<span className="text-zinc-700 mx-0.5">|</span>
						<span className="text-[11px] text-zinc-500 italic truncate">{scriptSegment}</span>
					</>
				)}
				{derail?.section && (
					<>
						<span className="text-zinc-700 mx-0.5">|</span>
						<span className="text-[10px] text-zinc-500">Expected:</span>
						<span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${derail.derailed ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"}`} title={`Section search context: ${derail.section.searchContext}`}>
							{sectionLabel(derail.section)} {derail.derailed ? "⚠ derailed" : "✓"}
						</span>
					</>
				)}
			</div>

			{candidates && candidates.length > 0 && (
				<CandidatePicker
					candidates={candidates}
					selectedIndex={selectedCandidateIndex ?? 0}
					onSelect={(index) => onSelectCandidate?.(beat.id, index)}
					onDownload={(index) => onDownloadCandidate?.(beat.id, index)}
					isDownloading={isDownloading}
					hasAsset={!!assetPath}
					sectionLabel={derail?.section ? sectionLabel(derail.section) : undefined}
					sectionContext={derail?.section?.searchContext}
					usedUrls={(() => {
						const urls = new Set<string>();
						if (allBeatCandidates && allSelectedIndex) {
							for (const [bid, cands] of Object.entries(allBeatCandidates)) {
								if (bid === beat.id) continue;
								const idx = allSelectedIndex[bid] ?? 0;
								if (cands?.[idx]?.url) urls.add(cands[idx].url);
							}
						}
						return urls;
					})()}
				/>
			)}

			<div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-zinc-800">
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onBlur={saveIfChanged}
					onKeyDown={(e) => { if (e.key === "Enter") saveIfChanged(); }}
					className="flex-1 max-w-[66%] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
					placeholder="Search query..."
				/>
				{savedFlash && (
					<span className="text-[10px] text-emerald-400 font-medium animate-pulse">✓ Saved</span>
				)}
				<button
					onClick={() => { saveIfChanged(); onSearchBeat?.(beat.id, query); }}
					disabled={isReDownloading || isSearching || !query.trim()}
					className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${isReDownloading || isSearching || !query.trim() ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-zinc-600 hover:bg-zinc-500 text-zinc-200"}`}
				>
					{isSearching ? "Searching..." : "Preview"}
				</button>
				<button
					onClick={() => {
						if (candidates && candidates.length > 0) {
							onDownloadCandidate?.(beat.id, selectedCandidateIndex ?? 0);
						}
					}}
					disabled={isReDownloading || isDownloading || !candidates || candidates.length === 0}
					className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${isReDownloading || isDownloading || !candidates || candidates.length === 0 ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-zinc-900 font-semibold"}`}
				>
					{isDownloading ? "Downloading..." : assetPath ? "Replace" : "Download"}
				</button>
				<button
					onClick={() => assetPath && window.api.openInFinder(assetPath)}
					disabled={!assetPath}
					className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${!assetPath ? "bg-zinc-700 text-zinc-500 cursor-not-allowed" : "bg-zinc-600 hover:bg-zinc-500 text-zinc-200"}`}
				>
					Finder
				</button>
				{!beat.overlay ? (
					<button
						onClick={() => onToggleOverlay?.(beat.id)}
						className="px-2.5 py-1 rounded text-[10px] font-medium transition-colors bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30"
					>
						Add CTA
					</button>
			) : (
				<button
					onClick={() => onToggleOverlay?.(beat.id)}
					className="px-2.5 py-1 rounded text-[10px] font-medium transition-colors bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
				>
					Remove CTA
				</button>
			)}
			{derail?.derailed && onResetToSection && (
				<button
					onClick={() => onResetToSection(beat.id)}
					disabled={isReDownloading || isActive}
					title={`Reset search query to section context: ${derail.section?.searchContext ?? ""}`}
					className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors border ${isReDownloading || isActive ? "bg-zinc-700 text-zinc-500 border-zinc-600 cursor-not-allowed" : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/30"}`}
				>
					Reset to Section
				</button>
			)}
		</div>
		</div>
	);
}
