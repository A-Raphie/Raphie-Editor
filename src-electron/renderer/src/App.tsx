import React, { useState, useEffect, useRef, useCallback } from "react";
import type { AppSettings, SavedProject, PipelineProgress, PipelineStateInfo } from "../../shared/types";
import { PLANNER_MODELS, CHECKER_MODELS } from "../../shared/types";
import Sidebar from "./components/Sidebar";
import DropZone from "./components/DropZone";
import PlanningView from "./components/PlanningView";
import ProjectsView from "./components/ProjectsView";
import BeatTimeline from "./components/BeatTimeline";
import BeatEditor from "./components/BeatEditor";
import Settings from "./components/Settings";
import ErrorModal from "./components/ErrorModal";
import ConfirmModal from "./components/ConfirmModal";
import { useBatchQueue } from "./hooks/useBatchQueue";
import { useProjects } from "./hooks/useProjects";
import { usePipeline, fmtElapsed } from "./hooks/usePipeline";
import type { ErrorInfo } from "./hooks/usePipeline";
import { useAssets } from "./hooks/useAssets";
import { useBeatCandidates } from "./hooks/useBeatCandidates";

interface ConfirmInfo {
	title: string;
	message: string;
	confirmLabel: string;
	onConfirm: () => void;
}

export default function App() {
	const [settings, setSettings] = useState<AppSettings | null>(null);
	const [view, setView] = useState<string>("input");
	const [scriptPath, setScriptPath] = useState<string | null>(null);
	const [scriptLength, setScriptLength] = useState(0);
	const [srtPath, setSrtPath] = useState<string | null>(null);
	const [voPath, setVoPath] = useState<string | null>(null);
	const [musicPath, setMusicPath] = useState<string | null>(null);
	const [scenePlan, setScenePlan] = useState<any>(null);
	const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
	const [progress, setProgress] = useState<PipelineProgress | null>(null);
	const [logs, setLogs] = useState<string[]>([]);
	const [outputPath, setOutputPath] = useState<string | null>(null);
	const [error, setError] = useState<ErrorInfo | null>(null);
	const [showSettings, setShowSettings] = useState(false);
	const [renderingError, setRenderingError] = useState<string | null>(null);
	const [renderStartTime, setRenderStartTime] = useState<number | null>(null);
	const [renderElapsed, setRenderElapsed] = useState<string>("");
	const [previousElapsed, setPreviousElapsed] = useState<string>("");
	const [sessionTimes, setSessionTimes] = useState<number[]>([]);
	const [showSessionDetails, setShowSessionDetails] = useState(false);
	const [regenerating, setRegenerating] = useState(false);
	const [pipelineStateInfo, setPipelineStateInfo] = useState<PipelineStateInfo | null>(null);
	const [selectedResolution, setSelectedResolution] = useState(1080);
	const [showResumePicker, setShowResumePicker] = useState(false);
	const [resumeOptions, setResumeOptions] = useState<any[]>([]);
	const [confirm, setConfirm] = useState<ConfirmInfo | null>(null);
	const [beatFilter, setBeatFilter] = useState<string | null>(null);

	const logsEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		window.api.getSettings().then(setSettings);
	}, []);

	const openSettings = useCallback(() => setShowSettings(true), []);

	const handleSaveSettings = useCallback(async (newSettings: AppSettings) => {
		await window.api.saveSettings(newSettings);
		setSettings(newSettings);
		setShowSettings(false);
	}, []);

	const handleFilesDropped = useCallback(async (files: Record<string, string>) => {
		if (files.srt) { setSrtPath(files.srt); setScriptPath(null); }
		if (files.script) {
			setScriptPath(files.script);
			try { setScriptLength((await (await fetch(`file://${files.script}`)).text()).length); } catch { setScriptLength(0); }
		}
		if (files.vo) setVoPath(files.vo);
		if (files.music) setMusicPath(files.music);
	}, []);

	const pipeline = usePipeline({
		settings, scriptPath, srtPath, voPath, musicPath, scenePlan, currentProjectId: null,
		currentProjectIdRef: { current: null } as any, selectedResolution, batchCurrentIndex: -1,
		beatCandidates: {}, assets: {},
		autoSaveProject: async () => {}, refreshProjects: async () => {}, openSettings,
		setScenePlan, setView, setError, setProgress, setLogs, setOutputPath,
		setRenderingError, setRenderStartTime, setRenderElapsed, setPreviousElapsed,
		setSessionTimes, setShowSessionDetails, setRegenerating, setPipelineStateInfo,
		setAssets: () => {}, setThumbnails: () => {}, setBeatStatuses: () => {},
		setAssetValidation: () => {}, setDownloadingBeats: () => {},
		setBeatCandidates: () => {}, setSelectedCandidateIndex: () => {}, setBatchQueue: () => {},
	});

	const assetsHook = useAssets({
		currentProjectId: null, currentProjectIdRef: pipeline.currentProjectIdRef,
		scenePlan, scriptPath, voPath, srtPath,
		autoSaveProjectRef: pipeline.autoSaveProjectRef,
		setScenePlan, setError,
		setBeatCandidates: () => {}, selectedCandidateIndex: {}, beatCandidates: {},
	});

	const candidatesHook = useBeatCandidates({
		currentProjectId: null, currentProjectIdRef: pipeline.currentProjectIdRef,
		scenePlan, settings, assets: assetsHook.assets,
		setBeatStatuses: assetsHook.setBeatStatuses,
		setAssets: assetsHook.setAssets, setThumbnails: assetsHook.setThumbnails, setError,
		selectedCandidateIndex: {}, beatCandidates: {},
	});

	const projectsHook = useProjects({
		activePipelineProjectIdRef: pipeline.activePipelineProjectIdRef,
		pendingPlanProjectIdRef: pipeline.pendingPlanProjectIdRef,
		scriptPath, srtPath, voPath, musicPath, scenePlan,
		assets: assetsHook.assets, beatCandidates: candidatesHook.beatCandidates,
		selectedCandidateIndex: candidatesHook.selectedCandidateIndex,
		setScriptPath, setSrtPath, setVoPath, setMusicPath, setScenePlan,
		setAssets: assetsHook.setAssets, setThumbnails: assetsHook.setThumbnails,
		setBeatStatuses: assetsHook.setBeatStatuses,
		setAssetValidation: assetsHook.setAssetValidation,
		setDownloadingBeats: assetsHook.setDownloadingBeats,
		setBeatCandidates: candidatesHook.setBeatCandidates,
		setSelectedCandidateIndex: candidatesHook.setSelectedCandidateIndex,
		setBeatTextSegments: assetsHook.setBeatTextSegments,
		setScriptLength, setSelectedBeatId,
		setSubscribeHintBeatIds: assetsHook.setSubscribeHintBeatIds,
		setReDownloadingBeat: assetsHook.setReDownloadingBeat,
		setCheckingAssets: assetsHook.setCheckingAssets,
		setPreviewingAll: candidatesHook.setPreviewingAll,
		setDownloadingCandidateBeat: candidatesHook.setDownloadingCandidateBeat,
		setView, setError, setProgress, setLogs, setRenderingError,
		setRegenerating, setOutputPath, setPipelineStateInfo, setConfirm,
	});

	const batchHook = useBatchQueue({
		activePipelineProjectIdRef: pipeline.activePipelineProjectIdRef,
		setView, setLogs, setError, setRenderingError,
	});

	const currentProjectId = projectsHook.currentProjectId;

	useEffect(() => {
		if (view !== "editor" || !scenePlan?.beats?.length) return;
		const handler = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			const beats = scenePlan.beats;
			if (e.key === "Escape") { setSelectedBeatId(null); return; }
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			e.preventDefault();
			const idx = beats.findIndex((b: any) => b.id === selectedBeatId);
			if (e.key === "ArrowRight") {
				if (idx < 0 || idx >= beats.length - 1) setSelectedBeatId(beats[0].id);
				else setSelectedBeatId(beats[idx + 1].id);
			} else {
				if (idx <= 0) setSelectedBeatId(beats[beats.length - 1].id);
				else setSelectedBeatId(beats[idx - 1].id);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [view, scenePlan, selectedBeatId]);

	useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs.length]);

	useEffect(() => {
		if (view !== "rendering" || !renderStartTime) return;
		const interval = setInterval(() => { setRenderElapsed(fmtElapsed(Date.now() - renderStartTime)); }, 500);
		setRenderElapsed(fmtElapsed(Date.now() - renderStartTime));
		return () => clearInterval(interval);
	}, [view, renderStartTime]);

	useEffect(() => {
		if (!currentProjectId || !scenePlan) return;
		if (Object.keys(assetsHook.assets).length === 0 && Object.keys(candidatesHook.beatCandidates).length === 0) return;
		const timer = setTimeout(() => { pipeline.autoSaveProjectRef.current("editing"); }, 1000);
		return () => clearTimeout(timer);
	}, [assetsHook.assets, candidatesHook.beatCandidates, currentProjectId, scenePlan]);

	pipeline.viewRef.current = view;

	const handlePreview = useCallback(() => {
		if (!scriptPath && !srtPath) { setError({ title: "Missing Input", message: "Please select an SRT subtitles file or a script file." }); return; }
		if (!voPath) { setError({ title: "Missing Voiceover", message: "Please select a voiceover audio file (.mp3, .wav, etc.)." }); return; }
		if (!settings?.openrouterApiKeys || settings.openrouterApiKeys.length === 0) {
			setError({ title: "Missing API Key", message: "Please add your OpenRouter API key in Settings to use AI features.", actionLabel: "Open Settings", onAction: () => { setError(null); openSettings(); } });
			return;
		}
		const plannerLabel = PLANNER_MODELS.find(m => m.value === settings.scenePlannerModel)?.label ?? settings.scenePlannerModel;
		const checkerLabel = CHECKER_MODELS.find(m => m.value === settings.qualityCheckerModel)?.label ?? settings.qualityCheckerModel;
		const checkerCost = CHECKER_MODELS.find(m => m.value === settings.qualityCheckerModel)?.cost ?? "";
		const plannerCost = PLANNER_MODELS.find(m => m.value === settings.scenePlannerModel)?.cost ?? "";
		setConfirm({
			title: "Preview Scene Plan",
			message: `Scene Planner: ${plannerLabel} (${plannerCost})\nQuality Checker: ${checkerLabel} (${checkerCost})`,
			confirmLabel: "Continue",
			onConfirm: () => { setConfirm(null); pipeline.doPreview(); }
		});
	}, [scriptPath, srtPath, voPath, settings, openSettings, pipeline.doPreview]);

	const selectedBeat = scenePlan?.beats.find((b: any) => b.id === selectedBeatId) ?? null;

	if (!settings) return <div className="flex h-screen items-center justify-center bg-zinc-950"><div className="text-zinc-400">Loading...</div></div>;

	return (
		<div className="flex h-screen bg-zinc-950">
			<Sidebar view={view} onNew={projectsHook.handleNewProject} onProjects={() => setView("projects")} onQueue={() => setView("queue")} onSettings={openSettings} />
			<main className="flex-1 flex flex-col">
				{view === "input" && (
					<DropZone scriptPath={scriptPath} voPath={voPath} musicPath={musicPath} srtPath={srtPath} onFilesSelected={handleFilesDropped} onPreview={handlePreview} canPreview={(!!scriptPath || !!srtPath) && !!voPath} />
				)}

				{view === "projects" && (
					<ProjectsView projects={projectsHook.projects} onOpen={projectsHook.handleOpenProject} onRename={projectsHook.handleRenameProject} onDelete={projectsHook.handleDeleteProject} onNew={projectsHook.handleNewProject} onAddToQueue={batchHook.addToQueue} />
				)}

				{view === "queue" && (
					<div className="flex-1 p-6 overflow-auto">
						<div className="max-w-2xl mx-auto">
							<div className="flex items-center gap-4 mb-6">
								<h2 className="text-xl font-bold text-zinc-100">Batch Queue</h2>
								<span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-800/80 px-3 py-1.5 rounded-full border border-zinc-700/50">
									{batchHook.batchQueue.length} item{batchHook.batchQueue.length !== 1 ? "s" : ""}
								</span>
							</div>
							{batchHook.batchQueue.length === 0 ? (
								<div className="text-center py-16">
									<div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-zinc-800/50 flex items-center justify-center"><span className="text-4xl opacity-40">📋</span></div>
									<p className="text-zinc-400 mb-2">No projects in queue</p>
									<p className="text-sm text-zinc-600">Add projects from the Projects view to start batch processing</p>
								</div>
							) : (
								<div className="space-y-3">
									{batchHook.batchQueue.map((item, idx) => (
										<div key={item.id} className={`p-4 rounded-xl border transition-all ${idx === batchHook.batchCurrentIndex ? "border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10" : item.status === "completed" ? "border-emerald-500/50 bg-emerald-500/5" : item.status === "failed" ? "border-red-500/50 bg-red-500/5" : "border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-800/60"}`}>
											<div className="flex items-center gap-4">
												<span className="text-zinc-500 text-sm font-medium w-6">{idx + 1}.</span>
												<span className="text-zinc-200 text-sm flex-1 truncate font-medium">{item.scriptPath.split("/").pop()}</span>
												<span className={`text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-md ${item.status === "pending" ? "bg-zinc-700/50 text-zinc-400 border border-zinc-600/30" : item.status === "running" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : item.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>{item.status}</span>
												{item.status === "pending" && <button onClick={() => batchHook.removeFromQueue(idx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all">✕</button>}
												{item.status === "failed" && <button onClick={() => batchHook.handleStartBatchQueue(idx)} className="px-2 py-1 rounded-md text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all">Retry</button>}
												{item.status === "completed" && item.outputPath && <button onClick={() => window.api.openInFinder(item.outputPath!)} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-all text-sm">📂</button>}
											</div>
											{item.status === "running" && item.progress && (
												<div className="mt-2 space-y-1">
													<div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
														<div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all rounded-full" style={{ width: `${item.progress.percent}%` }} />
													</div>
													<p className="text-xs text-zinc-500">{item.progress.message}</p>
												</div>
											)}
											{item.status === "failed" && item.errorMessage && (
												<p className="mt-2 text-xs text-red-400/70 truncate">{item.errorMessage}</p>
											)}
										</div>
									))}
									{batchHook.batchQueue.length > 0 && (() => {
										const done = batchHook.batchQueue.filter((q) => q.status === "completed").length;
										const failed = batchHook.batchQueue.filter((q) => q.status === "failed").length;
										return <p className="text-xs text-zinc-500">{done}/{batchHook.batchQueue.length} complete{failed > 0 ? `, ${failed} failed` : ""}</p>;
									})()}
								</div>
							)}
							{batchHook.batchQueue.length > 0 && batchHook.batchCurrentIndex === -1 && (
								<button onClick={() => batchHook.handleStartBatchQueue()} className="mt-6 w-full py-3 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 rounded-xl text-sm font-semibold shadow-lg hover:shadow-xl transition-all">▶ Start Queue</button>
							)}
							{batchHook.batchCurrentIndex >= 0 && (
								<div className="mt-6 p-4 bg-zinc-800/60 rounded-xl border border-zinc-700/50">
									<p className="text-sm text-zinc-300 font-medium mb-3">Processing: <span className="text-amber-400">{batchHook.batchQueue[batchHook.batchCurrentIndex]?.scriptPath.split("/").pop()}</span></p>
									{progress && (
										<div className="space-y-2">
											<div className="h-2.5 bg-zinc-700 rounded-full overflow-hidden">
												<div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all rounded-full" style={{ width: `${progress.percent}%` }} />
											</div>
											<p className="text-xs text-zinc-500">{progress.message}</p>
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				)}

				{view === "planning" && !scenePlan && (
					<PlanningView scriptName={scriptPath?.split("/").pop() ?? null} logs={logs} error={error?.message ?? null} onRetry={handlePreview} />
				)}

				{(view === "editor" || view === "complete") && scenePlan && (
					<>
						<div className="flex-1 flex flex-col min-h-0 relative">
							{regenerating && (
								<div className="absolute inset-0 bg-zinc-950/70 flex flex-col items-center justify-center z-20">
									<div className="flex items-center gap-3 mb-3">
										<svg className="w-5 h-5 animate-spin text-zinc-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" /></svg>
										<span className="text-sm text-zinc-300">Regenerating scene plan...</span>
									</div>
									{logs.length > 0 && (
										<div className="max-w-md w-full bg-zinc-900/80 rounded-lg p-3 text-[11px] font-mono text-zinc-500 space-y-0.5 max-h-64 overflow-y-auto">
											{logs.slice(-20).map((line, i) => <div key={i} className={`truncate ${line.includes("WARNING") || line.includes("⚠") ? "text-yellow-500" : line.includes("ERROR") ? "text-red-400" : "text-zinc-500"}`}>{line}</div>)}
											<div ref={logsEndRef} />
										</div>
									)}
								</div>
							)}
							<div className="flex-1 overflow-y-auto p-4">
								<div className="flex items-center justify-between mb-4">
									<div className="flex items-center gap-3">
										<h2 className="text-lg font-bold text-zinc-100 tracking-tight truncate">{scenePlan.title}</h2>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 bg-zinc-800/80 px-2.5 py-1 rounded-md border border-zinc-700/50">
											{Math.floor(scenePlan.totalDurationSeconds / 60)}:{String(Math.floor(scenePlan.totalDurationSeconds % 60)).padStart(2, "0")}
										</span>
										<span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 bg-zinc-800/80 px-2.5 py-1 rounded-md border border-zinc-700/50">
											{scenePlan.beats.length} beats
										</span>
										<span className="text-[10px] font-semibold uppercase tracking-wide text-blue-400 bg-blue-500/20 px-2.5 py-1 rounded-md border border-blue-500/30">
											{scenePlan.beats.filter((b: any) => b.type === "clip").length} clips
										</span>
										<span className="text-[10px] font-semibold uppercase tracking-wide text-purple-400 bg-purple-500/20 px-2.5 py-1 rounded-md border border-purple-500/30">
											{scenePlan.beats.filter((b: any) => b.type === "image").length} images
										</span>
									</div>
								</div>
								<div className="flex items-center gap-2 mb-4">
									<div className="flex items-center gap-1.5">
										<select value={selectedResolution} onChange={(e) => setSelectedResolution(parseInt(e.target.value))} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500">
											<option value={480}>480p</option>
											<option value={720}>720p</option>
											<option value={1080}>1080p</option>
										</select>
										{(pipelineStateInfo as any)?.renderSegments?.completed > 0 ? (
											<>
												<button
													onClick={() => setConfirm({ title: "Continue Render?", message: "This will continue rendering from where it stopped.", confirmLabel: "Continue", onConfirm: () => { setConfirm(null); pipeline.handleRenderVideo("continue"); } })}
													disabled={assetsHook.checkingAssets || candidatesHook.previewingAll}
													className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${assetsHook.checkingAssets || candidatesHook.previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black shadow-md hover:shadow-lg"}`}
												>
													{candidatesHook.previewingAll ? "Searching..." : assetsHook.checkingAssets ? "Checking..." : "▶ Continue"}
												</button>
												<button
													onClick={() => setConfirm({ title: "New Render?", message: "This will re-render the video from scratch, replacing the existing output.", confirmLabel: "New Render", onConfirm: () => { setConfirm(null); pipeline.handleRenderVideo("render"); } })}
													className="text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
												>
													New Render
												</button>
											</>
										) : (
											<button
												onClick={() => {
												const assetableBeats = scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image");
												const missingCount = assetableBeats.filter((b: any) => !assetsHook.assets[b.id]).length;
												const totalBeats = scenePlan.beats.length;
												const estMin = Math.round(totalBeats * 0.5);
												const lines = [
													`This will start rendering the final video using the current assets.`,
													``,
													`${totalBeats} beats (${assetableBeats.length} clips/images)`,
												];
												if (missingCount > 0) lines.push(`⚠ ${missingCount} missing asset${missingCount > 1 ? "s" : ""} (will use lower-third fallback)`);
												if (missingCount === 0) lines.push(`All assets ready`);
												lines.push(``, `Estimated time: ~${estMin} min`);
												if (settings.qualityCheckerModel !== "none") {
													const checks = assetableBeats.length * (settings.maxThumbnailsPerQuery ?? 5);
													lines.push(`~${checks} thumbnail AI checks`);
												}
												setConfirm({ title: "Render Video?", message: lines.join("\n"), confirmLabel: "Render", onConfirm: () => { setConfirm(null); pipeline.handleRenderVideo("render"); } });
											}}
												disabled={assetsHook.checkingAssets || candidatesHook.previewingAll}
												className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${assetsHook.checkingAssets || candidatesHook.previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black shadow-md hover:shadow-lg"}`}
											>
												{candidatesHook.previewingAll ? "Searching..." : assetsHook.checkingAssets ? "Checking..." : "▶ Render"}
											</button>
										)}
									</div>
									<div className="w-px h-6 bg-zinc-700/60 mx-1" />
									<div className="flex items-center gap-1.5">
										<button onClick={candidatesHook.handlePreviewAll} disabled={candidatesHook.previewingAll} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${candidatesHook.previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200 shadow-sm hover:shadow-md"}`}>{candidatesHook.previewingAll ? "Searching..." : "Preview"}</button>
										{Object.keys(candidatesHook.beatCandidates).length > 0 && (
											<button onClick={candidatesHook.handleDownloadAllSelected} disabled={candidatesHook.previewingAll || Object.keys(assetsHook.assets).length >= scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image").length} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${candidatesHook.previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-blue-600 hover:bg-blue-500 text-white shadow-sm hover:shadow-md"}`}>Download</button>
										)}
										<button onClick={assetsHook.handleCheckAllAssets} disabled={assetsHook.checkingAssets} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${assetsHook.checkingAssets ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200 shadow-sm hover:shadow-md"}`}>{assetsHook.checkingAssets ? "Checking..." : "Check"}</button>
										<button
											onClick={async () => {
												if (!currentProjectId) return;
												try {
													const preview = await window.api.previewClean(currentProjectId);
													if (preview.total === 0) { setError({ title: "Nothing to Clean", message: "No orphaned files found. All assets match the current scene plan beats." }); return; }
													const parts: string[] = [];
													if (preview.clips) parts.push(`${preview.clips} clip${preview.clips > 1 ? "s" : ""}`);
													if (preview.images) parts.push(`${preview.images} image${preview.images > 1 ? "s" : ""}`);
													if (preview.thumbs) parts.push(`${preview.thumbs} thumbnail${preview.thumbs > 1 ? "s" : ""}`);
													setConfirm({ title: `Delete ${preview.total} Orphaned File${preview.total > 1 ? "s" : ""}?`, message: `This will permanently delete ${parts.join(", ")}. These files don't match any beats in the current scene plan. This cannot be undone.`, confirmLabel: "Delete", onConfirm: () => { setConfirm(null); assetsHook.handleCleanAssets(); } });
												} catch (err: any) { setError({ title: "Preview Failed", message: err.message }); }
											}}
											className="px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm bg-zinc-700 hover:bg-red-900/30 text-red-400 hover:text-red-300 hover:shadow-md"
										>Clean</button>
									</div>
									<div className="w-px h-6 bg-zinc-700/60 mx-1" />
									<button
										onClick={() => setConfirm({ title: "New Scene Plan?", message: "This will create a new scene plan from scratch. All assets for the current beats will be deleted and need to be re-downloaded.", confirmLabel: "New Plan", onConfirm: () => { setConfirm(null); pipeline.handleRegenerate(); } })}
										disabled={regenerating}
										className={`ml-auto px-4 py-2 rounded-lg text-xs font-semibold transition-all ${regenerating ? "bg-zinc-800 text-zinc-500 cursor-wait" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"}`}
									>{regenerating ? "Generating..." : "↻ New Scene Plan"}</button>
								</div>
								{Object.keys(assetsHook.assetValidation).length > 0 && (
									<div className="mb-2 px-1 text-xs">
										{(() => {
											const valid = Object.values(assetsHook.assetValidation).filter((v) => v.valid && v.hasAsset && v.reason !== "quality_failed").length;
											const invalid = Object.values(assetsHook.assetValidation).filter((v) => !v.valid && v.hasAsset).length;
											const missing = Object.values(assetsHook.assetValidation).filter((v) => !v.valid && !v.hasAsset).length;
											const qualityFailed = Object.values(assetsHook.assetValidation).filter((v) => v.reason === "quality_failed").length;
											return <span className={invalid > 0 || missing > 0 || qualityFailed > 0 ? "text-red-400" : "text-emerald-400"}>{valid} valid, {invalid} corrupt, {missing} missing, {qualityFailed} quality failed</span>;
										})()}
									</div>
								)}
								<BeatTimeline beats={scenePlan.beats} selectedBeatId={selectedBeatId} onSelectBeat={setSelectedBeatId} assets={assetsHook.assets} thumbnails={assetsHook.thumbnails} beatStatuses={assetsHook.beatStatuses} assetValidation={assetsHook.assetValidation} subscribeHintBeatIds={assetsHook.subscribeHintBeatIds} beatCandidates={candidatesHook.beatCandidates} selectedCandidateIndex={candidatesHook.selectedCandidateIndex} filterMode={beatFilter} onFilterChange={setBeatFilter} />
							</div>
							{view === "editor" && selectedBeat && (
								<div className="border-t border-zinc-800">
								<BeatEditor
									beat={selectedBeat}
									assetPath={assetsHook.assets[selectedBeat.id]}
										onReDownload={assetsHook.handleReDownloadBeat}
										onSaveSearch={assetsHook.handleSaveSearch}
										onToggleOverlay={assetsHook.handleToggleOverlay}
										onSearchBeat={candidatesHook.handleSearchBeat}
										onSelectCandidate={candidatesHook.handleSelectCandidate}
										onDownloadCandidate={candidatesHook.handleDownloadCandidate}
										isReDownloading={assetsHook.downloadingBeats.includes(selectedBeat.id) || candidatesHook.downloadingCandidateBeat === selectedBeat.id}
										beatStatus={assetsHook.beatStatuses[selectedBeat.id]}
										subscribeHint={assetsHook.subscribeHintBeatIds.has(selectedBeat.id)}
										candidates={candidatesHook.beatCandidates[selectedBeat.id]}
										selectedCandidateIndex={candidatesHook.selectedCandidateIndex[selectedBeat.id]}
										scriptSegment={assetsHook.beatTextSegments[selectedBeat.id]}
									/>
								</div>
							)}
						</div>
						{view === "complete" && outputPath && (
							<div className="p-5 border-t border-zinc-800 bg-zinc-900/80">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-4">
										<div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center"><span className="text-2xl">✅</span></div>
										<div>
											<div className="text-emerald-400 font-bold text-lg">Render Complete</div>
											<div className="text-zinc-400 text-xs mt-1">Took {renderElapsed || fmtElapsed(Date.now() - (renderStartTime || Date.now()))}</div>
											<div className="text-zinc-500 text-sm font-mono truncate max-w-md">{outputPath}</div>
										</div>
									</div>
									<div className="flex gap-3">
										<button className="px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-xl text-sm font-medium transition-all" onClick={() => setView("editor")}>← Back to Editor</button>
										<button className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black rounded-xl text-sm font-semibold shadow-lg hover:shadow-xl transition-all" onClick={() => setConfirm({ title: "New Render?", message: "This will re-render the video from scratch, replacing the existing output.", confirmLabel: "New Render", onConfirm: () => { setConfirm(null); pipeline.handleRenderVideo("render"); } })}>New Render</button>
										<button className="px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-xl text-sm font-medium transition-all" onClick={() => window.api.openInFinder(outputPath)}>📂 Open</button>
									</div>
								</div>
							</div>
						)}
					</>
				)}

				{view === "rendering" && (
					<div className="flex-1 flex items-center justify-center p-8">
						<div className="text-center w-full max-w-lg">
							{renderingError ? (
								<>
									<div className="text-lg font-semibold text-red-400 mb-1">Rendering Failed</div>
									<div className="text-sm text-zinc-500 font-mono mb-3">{renderElapsed}</div>
									<div className="text-sm text-zinc-400 mb-6">{renderingError}</div>
									<div className="flex gap-3 justify-center">
										{(pipelineStateInfo as any)?.renderSegments && (pipelineStateInfo as any).renderSegments.completed > 0 && (
											<button className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-sm font-medium" onClick={() => pipeline.handleRenderVideo("continue")}>Continue Render</button>
										)}
										<button className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-medium" onClick={pipeline.handleBackToEditor}>Back to Editor</button>
									</div>
								</>
							) : (
								<>
									<div className="text-lg font-semibold text-zinc-200 mb-2">Rendering Video</div>
									{(() => {
										const isFFmpeg = settings?.renderer === "ffmpeg";
										const count = isFFmpeg
											? (settings?.renderConcurrency ?? 4)
											: (settings?.parallelSegments ?? 1);
										return (
											<>
												<div className="text-sm text-zinc-400 mb-2">Using {count} parallel {isFFmpeg ? "FFmpeg process" : "segment"}{count > 1 ? "es" : ""}</div>
											</>
										);
									})()}
									{previousElapsed ? (
										<div className="mb-3">
											<div
												className="flex items-center justify-center gap-3 cursor-pointer select-none"
												onClick={() => setShowSessionDetails(!showSessionDetails)}
											>
												<div className="text-sm text-zinc-500 font-mono">Prev: {previousElapsed}</div>
												<div className="text-zinc-700">|</div>
												<div className="text-sm text-zinc-300 font-mono">Now: {renderElapsed}</div>
												{sessionTimes.length > 1 && (
													<span className="text-[10px] text-zinc-600 ml-1">{showSessionDetails ? "▲" : "▼"}</span>
												)}
											</div>
											{showSessionDetails && sessionTimes.length > 1 && (
												<div className="mt-2 bg-zinc-800/50 rounded-lg border border-zinc-700/30 max-h-32 overflow-y-auto">
													{sessionTimes.map((t, i) => (
														<div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs font-mono text-zinc-500 border-b border-zinc-700/20 last:border-b-0">
															<span>Session {i + 1}</span>
															<span>{fmtElapsed(t)}</span>
														</div>
													))}
												</div>
											)}
										</div>
									) : (
										<div className="text-sm text-zinc-500 mb-3 font-mono">{renderElapsed}</div>
									)}
									{progress ? (
										<>
											<div className="text-sm text-zinc-400 mb-3">{progress.message}</div>
											<div className="h-3 bg-zinc-800 rounded-full overflow-hidden mb-2">
												<div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-300" style={{ width: `${progress.percent}%` }} />
											</div>
											<div className="text-sm font-mono text-zinc-300 mb-4">{progress.percent}%</div>
										</>
									) : (
										<div className="text-zinc-500 mb-4">Preparing pipeline...</div>
									)}
									<button className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium" onClick={pipeline.handleStop}>Stop</button>
								</>
							)}
						</div>
					</div>
				)}
			</main>

			{showSettings && <Settings settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}

			{error && view !== "planning" && view !== "rendering" && (
				<ErrorModal title={error.title} message={error.message} actionLabel={error.actionLabel} onAction={error.onAction} onDismiss={() => setError(null)} />
			)}

			{showResumePicker && (
				<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
					<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full">
						<h3 className="text-lg font-semibold text-zinc-200 mb-4">Select Project to Resume</h3>
						<div className="space-y-2 max-h-64 overflow-y-auto">
							{resumeOptions.map(({ project, state }: any) => (
								<button
									key={project.id}
									onClick={async () => {
										setShowResumePicker(false);
										pipeline.activePipelineProjectIdRef.current = project.id;
										projectsHook.setCurrentProjectId(project.id);
										setScriptPath(project.scriptPath ?? null);
										setSrtPath(project.srtPath ?? null);
										setVoPath(project.voPath);
										setMusicPath(project.musicPath ?? null);
										setScenePlan(project.scenePlan ?? null);
										setView("rendering");
										setError(null);
										setProgress(null);
										setLogs([]);
										setRenderingError(null);
										setRegenerating(false);
										assetsHook.setAssets({});
										assetsHook.setThumbnails({});
										assetsHook.setBeatStatuses({});
										assetsHook.setAssetValidation({});
										assetsHook.setDownloadingBeats([]);
										candidatesHook.setBeatCandidates(project.beatCandidates ?? {});
										candidatesHook.setSelectedCandidateIndex(project.selectedCandidateIndex ?? {});
										assetsHook.setBeatTextSegments({});
										setSelectedBeatId(null);
										assetsHook.setReDownloadingBeat(null);
										assetsHook.setCheckingAssets(false);
										candidatesHook.setPreviewingAll(false);
										candidatesHook.setDownloadingCandidateBeat(null);
										try { await window.api.resumePipeline(project.id); } catch {}
									}}
									className="w-full text-left p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
								>
									<div className="flex items-center justify-between">
										<span className="text-zinc-200 font-medium">{project.name || project.scriptPath?.split("/").pop() || project.srtPath?.split("/").pop() || "Untitled"}</span>
										<span className={`text-xs px-2 py-0.5 rounded ${state.status === "failed" ? "bg-red-600 text-white" : "bg-amber-600 text-white"}`}>{state.status === "failed" ? "Interrupted" : "In Progress"}</span>
									</div>
									<div className="text-xs text-zinc-500 mt-1">{state.assetCount} assets • {state.completedSteps?.join(", ") || "No steps completed"}</div>
								</button>
							))}
						</div>
						<button onClick={() => setShowResumePicker(false)} className="mt-4 w-full py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-300">Cancel</button>
					</div>
				</div>
			)}

			{confirm && <ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
		</div>
	);
}
