import React, { useState, useEffect, useRef, useCallback } from "react";
import type { AppSettings, SavedProject, PipelineProgress, PipelineStateInfo } from "../shared/types";
import Sidebar from "./components/Sidebar";
import DropZone from "./components/DropZone";
import PlanningView from "./components/PlanningView";
import ProjectsView from "./components/ProjectsView";
import ModelSelector from "./components/ModelSelector";
import BeatTimeline from "./components/BeatTimeline";
import BeatEditor from "./components/BeatEditor";
import Settings from "./components/Settings";
import ErrorModal from "./components/ErrorModal";
import ConfirmModal from "./components/ConfirmModal";

interface ErrorInfo {
	title: string;
	message: string;
	actionLabel?: string;
	onAction?: () => void;
}

interface ConfirmInfo {
	title: string;
	message: string;
	confirmLabel: string;
	onConfirm: () => void;
}

interface BatchQueueItem {
	id: string;
	scriptPath: string;
	voPath: string;
	musicPath?: string;
	status: "pending" | "running" | "completed" | "failed";
	outputPath?: string;
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

function translateError(raw: string): ErrorInfo {
	const msg = raw.toLowerCase();
	if (msg.includes("enotdir") || msg.includes("esbuild") || msg.includes("spawn")) return { title: "Renderer Error", message: raw.length > 300 ? raw.slice(0, 300) + "..." : raw };
	if (msg.includes("401") || msg.includes("403") || msg.includes("incorrect api key") || msg.includes("openrouter_api_key")) return { title: "API Key Error", message: "Your OpenRouter API key is missing or invalid. Check Settings.", actionLabel: "Open Settings" };
	if (msg.includes("connection") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed")) return { title: "Connection Error", message: "Could not connect to the server. Check your internet connection and try again." };
	if (msg.includes("command failed") && msg.includes("ffmpeg")) return { title: "Missing Tool", message: "ffmpeg was not found. Try restarting the app." };
	return { title: "Error", message: raw.length > 200 ? raw.slice(0, 200) + "..." : raw };
}

function fmtElapsed(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	if (totalSec > 0) return `${totalSec}.${Math.floor((ms % 1000) / 100)}s`;
	return "0s";
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
	const [subscribeHintBeatIds, setSubscribeHintBeatIds] = useState<Set<string>>(new Set());
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
	const [projects, setProjects] = useState<SavedProject[]>([]);
	const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
	const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
	const [batchCurrentIndex, setBatchCurrentIndex] = useState(-1);
	const [selectedResolution, setSelectedResolution] = useState(1080);
	const [showResumePicker, setShowResumePicker] = useState(false);
	const [resumeOptions, setResumeOptions] = useState<any[]>([]);
	const [assets, setAssets] = useState<Record<string, string>>({});
	const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
	const [reDownloadingBeat, setReDownloadingBeat] = useState<string | null>(null);
	const [downloadingBeats, setDownloadingBeats] = useState<string[]>([]);
	const [beatStatuses, setBeatStatuses] = useState<Record<string, BeatStatus>>({});
	const [assetValidation, setAssetValidation] = useState<Record<string, AssetValidation>>({});
	const [checkingAssets, setCheckingAssets] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmInfo | null>(null);
	const [beatCandidates, setBeatCandidates] = useState<Record<string, any[]>>({});
	const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<Record<string, number>>({});
	const [previewingAll, setPreviewingAll] = useState(false);
	const [downloadingCandidateBeat, setDownloadingCandidateBeat] = useState<string | null>(null);
	const [beatTextSegments, setBeatTextSegments] = useState<Record<string, string>>({});

	const logsEndRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef(view);
	const scenePlanRef = useRef(scenePlan);
	const openSettingsRef = useRef(() => setShowSettings(true));
	const autoSaveProjectRef = useRef(async (_s: string, _e?: any) => {});
	const pendingPlanProjectIdRef = useRef<string | null>(null);
	const currentProjectIdRef = useRef<string | null>(null);
	const activePipelineProjectIdRef = useRef<string | null>(null);
	const renderStartTimeRef = useRef<number | null>(null);
	const isRenderingRef = useRef(false);

	useEffect(() => {
		window.api.getSettings().then(setSettings);
		window.api.listProjects().then(setProjects);
	}, []);

	useEffect(() => {
		logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [logs.length]);

	useEffect(() => {
		const entries = Object.entries(assets);
		if (entries.length === 0) return;
		let cancelled = false;
		const loadThumbs = async () => {
			const newThumbs: Record<string, string> = {};
			for (const [beatId, assetPath] of entries) {
				if (cancelled) break;
				if (thumbnails[beatId]) { newThumbs[beatId] = thumbnails[beatId]; continue; }
				try {
					const thumb = await window.api.getBeatThumbnail(beatId, assetPath, currentProjectId ?? undefined);
					if (thumb) newThumbs[beatId] = thumb;
				} catch {}
			}
			if (!cancelled && Object.keys(newThumbs).length > 0) setThumbnails((prev) => ({ ...prev, ...newThumbs }));
		};
		loadThumbs();
		return () => { cancelled = true; };
	}, [assets, currentProjectId]);

	useEffect(() => {
		if (!scenePlan || Object.keys(beatTextSegments).length === 0) { setSubscribeHintBeatIds(new Set()); return; }
		const subscribeKeywords = /subscri(be|bing|ption)|smash.*sub|hit.*sub|like.*sub|follow.*sub|click.*sub|button.*sub|channel.*sub|don't.*forget.*sub/i;
		const hints = new Set<string>();
		for (const beat of scenePlan.beats) {
			const text = beatTextSegments[beat.id];
			if (text && subscribeKeywords.test(text)) hints.add(beat.id);
		}
		setSubscribeHintBeatIds(hints);
	}, [scenePlan, beatTextSegments]);

	useEffect(() => {
		if (!scenePlan || (!scriptPath && !srtPath)) { setBeatTextSegments({}); return; }
		let cancelled = false;
		const compute = async () => {
			try {
				const beats = scenePlan.beats.map((b: any) => ({ id: b.id, startTime: b.startTime, duration: b.duration }));
				const segments = await window.api.getBeatTextSegments(beats, scriptPath ?? undefined, srtPath ?? undefined);
				if (!cancelled) setBeatTextSegments(segments);
			} catch {}
		};
		compute();
		return () => { cancelled = true; };
	}, [scenePlan, scriptPath, srtPath]);

	const refreshProjects = useCallback(async () => { setProjects(await window.api.listProjects()); }, []);

	const autoSaveProject = useCallback(async (status: string, extra?: any) => {
		if (!scriptPath && !srtPath || !voPath) return;
		const name = scenePlan?.title || srtPath?.split("/").pop()?.replace(/\.[^.]+$/, "") || scriptPath?.split("/").pop()?.replace(/\.[^.]+$/, "") || "Untitled Project";
		const data: any = {
			...(currentProjectId ? { id: currentProjectId } : {}),
			name,
			scriptPath: scriptPath ?? undefined,
			voPath,
			musicPath: musicPath ?? undefined,
			srtPath: srtPath ?? undefined,
			scenePlan: scenePlan ?? undefined,
			beatCandidates: Object.keys(beatCandidates).length > 0 ? beatCandidates : undefined,
			selectedCandidateIndex: Object.keys(selectedCandidateIndex).length > 0 ? selectedCandidateIndex : undefined,
			assets: Object.keys(assets).length > 0 ? assets : undefined,
			status,
			...extra
		};
		const saved = await window.api.saveProject(data);
		if (!currentProjectId) setCurrentProjectId(saved.id);
		refreshProjects();
	}, [scriptPath, srtPath, voPath, musicPath, scenePlan, currentProjectId, beatCandidates, selectedCandidateIndex, assets, refreshProjects]);

	useEffect(() => {
		const unsubProgress = window.api.onProgress((p: PipelineProgress) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid !== currentProjectIdRef.current) return;
			setProgress(p);
		});
		const unsubComplete = async (path: string) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid !== null && activePid !== currentProjectIdRef.current) return;
			isRenderingRef.current = false;
			activePipelineProjectIdRef.current = null;
			setPreviousElapsed("");
			setSessionTimes([]);
			setShowSessionDetails(false);
			if (!path) {
				const pid = currentProjectIdRef.current;
				if (pid && scriptPath && voPath) {
					try {
						const stateInfo = await window.api.getPipelineState(pid, scriptPath, voPath, srtPath ?? undefined);
						if (stateInfo?.renderSegments?.completed > 0) {
							setPipelineStateInfo(stateInfo);
						}
					} catch {}
				}
				setRenderingError(null);
				setProgress(null);
				setRenderElapsed(fmtElapsed(Date.now() - (renderStartTimeRef.current || Date.now())));
				setView(scenePlanRef.current ? "editor" : "input");
				return;
			}
			setOutputPath(path);
			setView("complete");
			setRenderingError(null);
			setProgress(null);
			setRenderElapsed(fmtElapsed(Date.now() - (renderStartTimeRef.current || Date.now())));
			autoSaveProjectRef.current("complete", { outputPath: path });
		};
		const unsubError = async (err: string) => {
			if (err.includes("cancelled by user")) {
				isRenderingRef.current = false;
				setPreviousElapsed("");
				setSessionTimes([]);
				setShowSessionDetails(false);
				const pid = currentProjectIdRef.current;
				if (pid && scriptPath && voPath) {
					try {
						const stateInfo = await window.api.getPipelineState(pid, scriptPath, voPath, srtPath ?? undefined);
						if (stateInfo?.renderSegments?.completed > 0) {
							setPipelineStateInfo(stateInfo);
						}
					} catch {}
				}
				setRenderingError(null);
				setProgress(null);
				setRenderElapsed(fmtElapsed(Date.now() - (renderStartTimeRef.current || Date.now())));
				setView(scenePlanRef.current ? "editor" : "input");
				return;
			}
			const activePid = activePipelineProjectIdRef.current;
			if (activePid !== null && activePid !== currentProjectIdRef.current) return;
			isRenderingRef.current = false;
			activePipelineProjectIdRef.current = null;
			setPreviousElapsed("");
			setSessionTimes([]);
			setShowSessionDetails(false);
			const translated = translateError(err);
			if (translated.actionLabel === "Open Settings") translated.onAction = () => { setError(null); openSettingsRef.current(); };
			setRenderingError(null);
			setProgress(null);
			autoSaveProjectRef.current("error");
			if (viewRef.current === "rendering") setRenderingError(translated.message);
			else setError(translated);
		};
		const unsubScenePlan = (plan: any) => {
			const pendingPid = pendingPlanProjectIdRef.current;
			if (pendingPid && pendingPid !== currentProjectIdRef.current) { pendingPlanProjectIdRef.current = null; return; }
			setScenePlan(plan);
			setView("editor");
			if (pendingPid) {
				window.api.saveProject({ id: pendingPid, scenePlan: plan, status: "editing" }).then(() => { refreshProjects(); }).catch(console.error);
				window.api.saveScenePlan(pendingPid, plan).catch(console.error);
				pendingPlanProjectIdRef.current = null;
			} else {
				autoSaveProjectRef.current("editing", { scenePlan: plan });
			}
		};
		const unsubLog = (msg: string) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid && activePid !== currentProjectIdRef.current) return;
			setLogs((prev) => [...prev, msg]);
		};
		const unsubAssets = (newAssets: Record<string, string>) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid && activePid !== currentProjectIdRef.current) return;
			setAssets((prev) => ({ ...prev, ...newAssets }));
		};
		const unsubBeatStatus = (beatId: string, status: string, downloadPercent: number, error: string, errorDetails: string) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid && activePid !== currentProjectIdRef.current) return;
			setBeatStatuses((prev) => ({ ...prev, [beatId]: { status, downloadPercent, error, errorDetails } }));
		};
		window.api.onComplete(unsubComplete);
		window.api.onError(unsubError);
		window.api.onScenePlanReady(unsubScenePlan);
		window.api.onLog(unsubLog);
		window.api.onAssetDownloaded(unsubAssets);
		window.api.onBeatStatus(unsubBeatStatus);
		return () => { unsubProgress(); };
	}, []);

	useEffect(() => {
		if (view !== "rendering" || !renderStartTime) return;
		const interval = setInterval(() => {
			setRenderElapsed(fmtElapsed(Date.now() - renderStartTime));
		}, 500);
		setRenderElapsed(fmtElapsed(Date.now() - renderStartTime));
		return () => clearInterval(interval);
	}, [view, renderStartTime]);

	useEffect(() => {
		if (!currentProjectId || !scenePlan) return;
		if (Object.keys(assets).length === 0 && Object.keys(beatCandidates).length === 0) return;
		const timer = setTimeout(() => {
			autoSaveProjectRef.current("editing");
		}, 1000);
		return () => clearTimeout(timer);
	}, [assets, beatCandidates, currentProjectId, scenePlan]);

	const openSettings = useCallback(() => setShowSettings(true), []);

	const validate = useCallback((needsApi = true) => {
		if ((!settings?.openrouterApiKeys || settings.openrouterApiKeys.length === 0) && needsApi) {
			setError({ title: "Missing API Key", message: "Please add your OpenRouter API key in Settings to use AI features.", actionLabel: "Open Settings", onAction: () => { setError(null); openSettings(); } });
			return false;
		}
		if (!scriptPath && !srtPath) { setError({ title: "Missing Input", message: "Please select an SRT subtitles file or a script file." }); return false; }
		if (!voPath) { setError({ title: "Missing Voiceover", message: "Please select a voiceover audio file (.mp3, .wav, etc.)." }); return false; }
		return true;
	}, [settings, scriptPath, srtPath, voPath, openSettings]);

	const handleFilesDropped = useCallback(async (files: Record<string, string>) => {
		if (files.srt) { setSrtPath(files.srt); setScriptPath(null); }
		if (files.script) {
			setScriptPath(files.script);
			try { setScriptLength((await (await fetch(`file://${files.script}`)).text()).length); } catch { setScriptLength(0); }
		}
		if (files.vo) setVoPath(files.vo);
		if (files.music) setMusicPath(files.music);
	}, []);

	const handlePreview = useCallback(async () => {
		if (!validate(true)) return;
		const pid = currentProjectId;
		setView("planning");
		setError(null);
		setLogs([]);
		pendingPlanProjectIdRef.current = pid;
		await autoSaveProject("planning");
		try {
			const plan = await window.api.previewScenePlan(scriptPath ?? undefined, voPath!, pid ?? undefined, srtPath ?? undefined);
			if (currentProjectIdRef.current !== pid) {
				if (pid) { window.api.saveProject({ id: pid, scenePlan: plan, status: "editing" }).catch(() => {}); window.api.saveScenePlan(pid, plan).catch(() => {}); }
				return;
			}
			setScenePlan(plan);
			setView("editor");
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			const msg = err.message || "";
			if (msg.includes("401") || msg.includes("403") || msg.includes("Incorrect API key")) {
				setError({ title: "API Key Invalid", message: "Your OpenRouter API key was rejected. Check Settings.", actionLabel: "Open Settings", onAction: () => { setError(null); openSettings(); } });
			} else {
				setError({ title: "Preview Failed", message: msg || "Failed to generate scene plan. Click Retry to try again." });
			}
			setView("planning");
		}
	}, [scriptPath, voPath, validate, openSettings, autoSaveProject, currentProjectId]);

	const handleRegenerate = useCallback(async () => {
		if (!validate(true)) return;
		const pid = currentProjectId;
		setRegenerating(true);
		setError(null);
		setLogs([]);
		setPipelineStateInfo(null);
		setOutputPath(null);
		setBeatStatuses({});
		setDownloadingBeats([]);
		setAssetValidation({});
		pendingPlanProjectIdRef.current = pid;
		setBeatCandidates({});
		setSelectedCandidateIndex({});
		try {
			const plan = await window.api.previewScenePlan(scriptPath ?? undefined, voPath!, pid ?? undefined, srtPath ?? undefined);
			if (currentProjectIdRef.current !== pid) {
				if (pid) { window.api.saveProject({ id: pid, scenePlan: plan, status: "editing" }).catch(() => {}); window.api.saveScenePlan(pid, plan).catch(() => {}); try { await window.api.cleanAssets(pid); } catch {} }
				return;
			}
			setScenePlan(plan);
			autoSaveProject("editing", { scenePlan: plan });
			if (pid) try { await window.api.cleanAssets(pid); } catch {}
			setAssets({});
			setThumbnails({});
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setError({ title: "Regeneration Failed", message: err.message || "Failed to regenerate scene plan." });
		} finally {
			if (currentProjectIdRef.current === pid) setRegenerating(false);
		}
	}, [scriptPath, voPath, validate, autoSaveProject, currentProjectId]);

	const addToQueue = useCallback((project: SavedProject) => {
		setBatchQueue((q) => [...q, { id: project.id, scriptPath: project.scriptPath ?? "", voPath: project.voPath, musicPath: project.musicPath, status: "pending" }]);
	}, []);

	const handleStartBatchQueue = useCallback(async () => {
		if (batchQueue.length === 0) return;
		setBatchCurrentIndex(0);
		setView("rendering");
		for (let i = 0; i < batchQueue.length; i++) {
			const item = batchQueue[i];
			activePipelineProjectIdRef.current = item.id;
			setBatchQueue((q) => q.map((it, idx) => idx === i ? { ...it, status: "running" } : it));
			setBatchCurrentIndex(i);
			setLogs([]);
			setError(null);
			setRenderingError(null);
			try {
				const output = await window.api.runPipeline({ scriptPath: item.scriptPath, voPath: item.voPath, musicPath: item.musicPath, projectId: item.id });
				setBatchQueue((q) => q.map((it, idx) => idx === i ? { ...it, status: "completed", outputPath: output } : it));
			} catch (err) {
				setBatchQueue((q) => q.map((it, idx) => idx === i ? { ...it, status: "failed" } : it));
			}
		}
		setBatchCurrentIndex(-1);
	}, [batchQueue]);

	const handleReDownloadBeat = useCallback(async (beatId: string, newQuery: string) => {
		if (!currentProjectId || downloadingBeats.includes(beatId)) return;
		const pid = currentProjectId;
		setDownloadingBeats((prev) => [...prev, beatId]);
		try {
			const result = await window.api.reDownloadBeat(beatId, newQuery, scenePlan?.beats.find((b: any) => b.id === beatId)?.type ?? "clip", pid);
			if (currentProjectIdRef.current !== pid) return;
			if (result?.path) {
				setAssets((prev) => ({ ...prev, [beatId]: result.path }));
				if (result.thumbnail) setThumbnails((prev) => ({ ...prev, [beatId]: result.thumbnail }));
				else setThumbnails((prev) => { const next = { ...prev }; delete next[beatId]; return next; });
				setScenePlan((prev) => {
					if (!prev) return prev;
					const updated = { ...prev, beats: prev.beats.map((b: any) => b.id === beatId ? { ...b, searchQuery: newQuery } : b) };
					autoSaveProjectRef.current("editing", { scenePlan: updated });
					if (pid) window.api.saveScenePlan(pid, updated).catch(console.error);
					return updated;
				});
			}
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setError({ title: "Re-download Failed", message: err.message });
		}
		if (currentProjectIdRef.current === pid) setDownloadingBeats((prev) => prev.filter((id) => id !== beatId));
	}, [currentProjectId, downloadingBeats, scenePlan]);

	const handleSaveSearch = useCallback(async (beatId: string, newQuery: string) => {
		setScenePlan((prev) => {
			if (!prev) return prev;
			const updated = { ...prev, beats: prev.beats.map((b: any) => b.id === beatId ? { ...b, searchQuery: newQuery } : b) };
			autoSaveProjectRef.current("editing", { scenePlan: updated });
			if (currentProjectId) window.api.saveScenePlan(currentProjectId, updated).catch(console.error);
			return updated;
		});
	}, [currentProjectId]);

	const handleToggleOverlay = useCallback((beatId: string) => {
		setScenePlan((prev) => {
			if (!prev) return prev;
			const updated = { ...prev, beats: prev.beats.map((b: any) => {
				if (b.id !== beatId) return b;
				if (b.overlay) { const { overlay, ...rest } = b; return rest; }
				return { ...b, overlay: { type: "subscribe_cta", showAt: 0, hideAt: 1 } };
			})};
			autoSaveProjectRef.current("editing", { scenePlan: updated });
			if (currentProjectId) window.api.saveScenePlan(currentProjectId, updated).catch(console.error);
			return updated;
		});
	}, [currentProjectId]);

	const handleCheckAllAssets = useCallback(async () => {
		if (!scenePlan || !currentProjectId) return;
		const pid = currentProjectId;
		setCheckingAssets(true);
		setAssetValidation({});
		try {
			const results = await window.api.validateAllAssets(scenePlan.beats, assets, pid);
			if (currentProjectIdRef.current !== pid) return;
			setAssetValidation(results);
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setError({ title: "Check Failed", message: err.message });
		}
		if (currentProjectIdRef.current === pid) setCheckingAssets(false);
	}, [scenePlan, assets, currentProjectId]);

	const handleSaveSettings = useCallback(async (newSettings: AppSettings) => {
		await window.api.saveSettings(newSettings);
		setSettings(newSettings);
		setShowSettings(false);
	}, []);

	const handleCleanAssets = useCallback(async () => {
		if (!currentProjectId) return;
		const pid = currentProjectId;
		try {
			await window.api.cleanAssets(pid);
			const stateInfo = await window.api.getPipelineState(pid, scriptPath!, voPath!, srtPath ?? undefined);
			if (currentProjectIdRef.current !== pid) return;
		setAssets(stateInfo?.assets ?? {});
			setThumbnails({});
			setAssetValidation({});
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setError({ title: "Clean Failed", message: err.message });
		}
	}, [currentProjectId, scriptPath, voPath, srtPath]);

	const handleSearchBeat = useCallback(async (beatId: string, query: string) => {
		if (!currentProjectId || !scenePlan || !query.trim()) return;
		const beat = scenePlan.beats.find((b: any) => b.id === beatId);
		if (!beat) return;
		const pid = currentProjectId;
		setBeatStatuses((prev) => ({ ...prev, [beatId]: { status: "searching" } }));
		try {
			const results = await window.api.searchBeatCandidates(beatId, query, beat.type, pid);
			if (currentProjectIdRef.current !== pid) return;
			setBeatCandidates((prev) => ({ ...prev, [beatId]: results }));
			if (results.length > 0 && selectedCandidateIndex[beatId] === undefined) setSelectedCandidateIndex((prev) => ({ ...prev, [beatId]: 0 }));
			setBeatStatuses((prev) => { const next = { ...prev }; delete next[beatId]; return next; });
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setBeatStatuses((prev) => ({ ...prev, [beatId]: { status: "failed", error: "search_failed", errorDetails: err.message } }));
		}
	}, [currentProjectId, scenePlan, selectedCandidateIndex]);

	const handlePreviewAll = useCallback(async () => {
		if (!currentProjectId || !scenePlan) return;
		const pid = currentProjectId;
		setPreviewingAll(true);
		setBeatStatuses({});
		setBeatCandidates({});
		setSelectedCandidateIndex({});
		const assetableBeats = scenePlan.beats.filter((b: any) => (b.type === "clip" || b.type === "image") && b.searchQuery);
		const concurrency = settings?.previewConcurrency ?? 10;
		for (let i = 0; i < assetableBeats.length; i += concurrency) {
			if (currentProjectIdRef.current !== pid) return;
			const batch = assetableBeats.slice(i, i + concurrency);
			await Promise.allSettled(batch.map(async (beat: any) => {
				setBeatStatuses((prev) => ({ ...prev, [beat.id]: { status: "searching" } }));
				try {
					const results = await window.api.searchBeatCandidates(beat.id, beat.searchQuery, beat.type, pid);
					if (currentProjectIdRef.current !== pid) return;
					setBeatCandidates((prev) => ({ ...prev, [beat.id]: results }));
					if (results.length > 0) setSelectedCandidateIndex((prev) => ({ ...prev, [beat.id]: 0 }));
					setBeatStatuses((prev) => { const next = { ...prev }; delete next[beat.id]; return next; });
				} catch {
					if (currentProjectIdRef.current !== pid) return;
					setBeatStatuses((prev) => ({ ...prev, [beat.id]: { status: "failed" } }));
				}
			}));
		}
		if (currentProjectIdRef.current === pid) setPreviewingAll(false);
	}, [currentProjectId, scenePlan]);

	const handleSelectCandidate = useCallback((beatId: string, index: number) => {
		setSelectedCandidateIndex((prev) => ({ ...prev, [beatId]: index }));
	}, []);

	const handleDownloadCandidate = useCallback(async (beatId: string, index: number) => {
		if (!currentProjectId) return;
		const candidates = beatCandidates[beatId];
		if (!candidates || !candidates[index]) return;
		const pid = currentProjectId;
		setDownloadingCandidateBeat(beatId);
		try {
			const result = await window.api.downloadSelectedCandidate(beatId, candidates[index], pid);
			if (currentProjectIdRef.current !== pid) return;
			if (result.path) {
				setAssets((prev) => ({ ...prev, [beatId]: result.path }));
				if (result.thumbnail) setThumbnails((prev) => ({ ...prev, [beatId]: result.thumbnail }));
			}
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setError({ title: "Download Failed", message: err.message });
		}
		if (currentProjectIdRef.current === pid) setDownloadingCandidateBeat(null);
	}, [currentProjectId, beatCandidates]);

	const handleDownloadAllSelected = useCallback(async () => {
		if (!currentProjectId || !scenePlan) return;
		const pid = currentProjectId;
		const toDownload = scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image").filter((b: any) => beatCandidates[b.id]?.length && !assets[b.id]);
		const concurrency = settings?.concurrency ?? 4;
		const maxRetries = 3;

		const downloadBatch = async (batch: any[], getIdx: (beatId: string) => number) => {
			const failed: any[] = [];
			await Promise.allSettled(batch.map(async (beat: any) => {
				const idx = getIdx(beat.id);
				const candidates = beatCandidates[beat.id];
				if (!candidates?.[idx]) { failed.push(beat); return; }
				try {
					const result = await window.api.downloadSelectedCandidate(beat.id, candidates[idx], pid);
					if (currentProjectIdRef.current !== pid) return;
					if (result.path) {
						setAssets((prev) => ({ ...prev, [beat.id]: result.path }));
						if (result.thumbnail) setThumbnails((prev) => ({ ...prev, [beat.id]: result.thumbnail }));
					} else {
						failed.push(beat);
					}
				} catch {
					failed.push(beat);
				}
			}));
			return failed;
		};

		for (let i = 0; i < toDownload.length; i += concurrency) {
			if (currentProjectIdRef.current !== pid) return;
			const batch = toDownload.slice(i, i + concurrency);
			let failed = await downloadBatch(batch, (beatId) => selectedCandidateIndex[beatId] ?? 0);

			for (let retry = 1; retry <= maxRetries && failed.length > 0; retry++) {
				if (currentProjectIdRef.current !== pid) return;
				const retryFailed = await downloadBatch(failed, (beatId) => {
					const base = selectedCandidateIndex[beatId] ?? 0;
					const next = base + retry;
					const candidates = beatCandidates[beatId];
					return candidates?.[next] ? next : base;
				});
				failed = retryFailed;
			}
		}
	}, [currentProjectId, scenePlan, beatCandidates, selectedCandidateIndex, assets]);

	const handleRenderVideo = useCallback(async (mode = "render") => {
		if (isRenderingRef.current) return;
		if (!scenePlan || !currentProjectId || (!scriptPath && !srtPath) || !voPath) return;
		const pid = currentProjectId;
		isRenderingRef.current = true;
		const stateInfo = await window.api.getPipelineState(pid, scriptPath ?? "", voPath, srtPath ?? undefined);
		if (currentProjectIdRef.current !== pid) { isRenderingRef.current = false; return; }
		const currentAssets = stateInfo?.assets ?? {};
		const missing = scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image").filter((b: any) => !currentAssets[b.id]);
		if (missing.length > 0) {
			setAssets(currentAssets);
			const details = missing.slice(0, 10).map((b: any) => b.searchQuery).join(", ") + (missing.length > 10 ? ` and ${missing.length - 10} more` : "");
			setError({ title: `${missing.length} Asset(s) Missing`, message: `Cannot render. Download all assets first. Missing: ${details}` });
			return;
		}
		setAssets(currentAssets);
		setPipelineStateInfo(stateInfo);
		setShowSessionDetails(false);
		if (mode === "continue") {
			const prevMs = (stateInfo as any)?.renderSegments?.elapsedMs ?? 0;
			const times = (stateInfo as any)?.renderSegments?.sessionTimes ?? [];
			setSessionTimes(times);
			setPreviousElapsed(prevMs > 0 ? fmtElapsed(prevMs) : "");
		} else {
			setSessionTimes([]);
			setPreviousElapsed("");
		}
		activePipelineProjectIdRef.current = pid;
		setRenderStartTime(Date.now());
		renderStartTimeRef.current = Date.now();
		setView("rendering");
		try {
			await window.api.renderVideo(pid, scriptPath ?? "", voPath, musicPath || undefined, mode, srtPath ?? undefined, selectedResolution);
		} catch (err: any) {
			isRenderingRef.current = false;
			if (currentProjectIdRef.current !== pid) return;
			console.error("Render failed:", err.message);
			setRenderElapsed(fmtElapsed(Date.now() - (renderStartTimeRef.current || Date.now())));
			setError({ title: "Render Failed", message: err.message });
		}
	}, [scenePlan, currentProjectId, scriptPath, srtPath, voPath, musicPath, selectedResolution]);

	const handleStop = useCallback(async () => {
		try { await window.api.cancelPipeline(); } catch {}
		activePipelineProjectIdRef.current = null;
		setPreviousElapsed("");
		setSessionTimes([]);
		setShowSessionDetails(false);
		setRenderingError(null);
		setProgress(null);
		setRenderElapsed(fmtElapsed(Date.now() - (renderStartTimeRef.current || Date.now())));
		setView(scenePlanRef.current ? "editor" : "input");
	}, []);

	const handleBackToEditor = useCallback(() => {
		setRenderingError(null);
		setProgress(null);
		setPreviousElapsed("");
		setSessionTimes([]);
		setShowSessionDetails(false);
		setView(scenePlanRef.current ? "editor" : "input");
	}, []);

	const handleOpenProject = useCallback(async (project: SavedProject) => {
		activePipelineProjectIdRef.current = null;
		setScriptPath(project.scriptPath ?? null);
		setVoPath(project.voPath);
		setMusicPath(project.musicPath ?? null);
		setSrtPath(project.srtPath ?? null);
		setScenePlan(project.scenePlan ?? null);
		setCurrentProjectId(project.id);
		setError(null);
		setProgress(null);
		setLogs([]);
		setRenderingError(null);
		setRegenerating(false);
		setOutputPath(project.outputPath ?? null);
		setThumbnails({});
		setBeatStatuses({});
		setAssetValidation({});
		setDownloadingBeats([]);
		setBeatCandidates(project.beatCandidates ?? {});
		setSelectedCandidateIndex(project.selectedCandidateIndex ?? {});
		setBeatTextSegments({});
		setScriptLength(0);
		setSelectedBeatId(null);
		setSubscribeHintBeatIds(new Set());
		setReDownloadingBeat(null);
		setCheckingAssets(false);
		setPreviewingAll(false);
		setDownloadingCandidateBeat(null);
		pendingPlanProjectIdRef.current = null;
		let stateInfo = null;
		if (project.id) try { stateInfo = await window.api.getPipelineState(project.id, project.scriptPath ?? "", project.voPath, project.srtPath); } catch {}
		setPipelineStateInfo(stateInfo);
		let loadedAssets = stateInfo?.assets ?? project.assets ?? {};
		if (project.scenePlan && Object.keys(loadedAssets).length === 0 && project.id) {
			try {
				const recovered = await window.api.recoverAssets(project.scenePlan.beats, project.id);
				if (Object.keys(recovered).length > 0) loadedAssets = recovered;
			} catch {}
		}
		setAssets(loadedAssets);
		if (project.status === "complete" && project.outputPath) setView("complete");
		else if (project.scenePlan) setView("editor");
		else setView("input");
	}, []);

	const handleNewProject = useCallback(() => {
		activePipelineProjectIdRef.current = null;
		setView("input");
		setScenePlan(null);
		setOutputPath(null);
		setError(null);
		setProgress(null);
		setLogs([]);
		setCurrentProjectId(null);
		setPipelineStateInfo(null);
		setScriptPath(null);
		setScriptLength(0);
		setSrtPath(null);
		setVoPath(null);
		setMusicPath(null);
		setBeatCandidates({});
		setSelectedCandidateIndex({});
		setRenderingError(null);
		setRegenerating(false);
		setAssets({});
		setThumbnails({});
		setReDownloadingBeat(null);
		setDownloadingBeats([]);
		setBeatStatuses({});
		setAssetValidation({});
		setCheckingAssets(false);
		setConfirm(null);
		setPreviewingAll(false);
		setDownloadingCandidateBeat(null);
		setBeatTextSegments({});
		setSelectedBeatId(null);
		setSubscribeHintBeatIds(new Set());
		pendingPlanProjectIdRef.current = null;
	}, []);

	const handleRenameProject = useCallback(async (id: string, name: string) => {
		await window.api.renameProject(id, name);
		refreshProjects();
	}, [refreshProjects]);

	const handleDeleteProject = useCallback(async (id: string) => {
		await window.api.deleteProject(id);
		if (currentProjectId === id) setCurrentProjectId(null);
		refreshProjects();
	}, [currentProjectId, refreshProjects]);

	viewRef.current = view;
	scenePlanRef.current = scenePlan;
	autoSaveProjectRef.current = autoSaveProject;
	currentProjectIdRef.current = currentProjectId;

	const selectedBeat = scenePlan?.beats.find((b: any) => b.id === selectedBeatId) ?? null;

	if (!settings) return <div className="flex h-screen items-center justify-center bg-zinc-950"><div className="text-zinc-400">Loading...</div></div>;

	return (
		<div className="flex h-screen bg-zinc-950">
			<Sidebar view={view} onNew={handleNewProject} onProjects={() => setView("projects")} onQueue={() => setView("queue")} onSettings={openSettings} />
			<main className="flex-1 flex flex-col">
				{view === "input" && (
					<DropZone scriptPath={scriptPath} voPath={voPath} musicPath={musicPath} srtPath={srtPath} onFilesSelected={handleFilesDropped} onPreview={handlePreview} canPreview={(!!scriptPath || !!srtPath) && !!voPath} />
				)}

				{view === "projects" && (
					<ProjectsView projects={projects} onOpen={handleOpenProject} onRename={handleRenameProject} onDelete={handleDeleteProject} onNew={handleNewProject} onAddToQueue={addToQueue} />
				)}

				{view === "queue" && (
					<div className="flex-1 p-6 overflow-auto">
						<div className="max-w-2xl mx-auto">
							<div className="flex items-center gap-4 mb-6">
								<h2 className="text-xl font-bold text-zinc-100">Batch Queue</h2>
								<span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-800/80 px-3 py-1.5 rounded-full border border-zinc-700/50">
									{batchQueue.length} item{batchQueue.length !== 1 ? "s" : ""}
								</span>
							</div>
							{batchQueue.length === 0 ? (
								<div className="text-center py-16">
									<div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-zinc-800/50 flex items-center justify-center"><span className="text-4xl opacity-40">📋</span></div>
									<p className="text-zinc-400 mb-2">No projects in queue</p>
									<p className="text-sm text-zinc-600">Add projects from the Projects view to start batch processing</p>
								</div>
							) : (
								<div className="space-y-3">
									{batchQueue.map((item, idx) => (
										<div key={item.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${idx === batchCurrentIndex ? "border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10" : item.status === "completed" ? "border-emerald-500/50 bg-emerald-500/5" : item.status === "failed" ? "border-red-500/50 bg-red-500/5" : "border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-800/60"}`}>
											<span className="text-zinc-500 text-sm font-medium w-6">{idx + 1}.</span>
											<span className="text-zinc-200 text-sm flex-1 truncate font-medium">{item.scriptPath.split("/").pop()}</span>
											<span className={`text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-md ${item.status === "pending" ? "bg-zinc-700/50 text-zinc-400 border border-zinc-600/30" : item.status === "running" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : item.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>{item.status}</span>
											{item.status === "pending" && <button onClick={() => setBatchQueue((q) => q.filter((_, i) => i !== idx))} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all">✕</button>}
											{item.status === "completed" && item.outputPath && <button onClick={() => window.api.openInFinder(item.outputPath!)} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-all text-sm">📂</button>}
										</div>
									))}
								</div>
							)}
							{batchQueue.length > 0 && batchCurrentIndex === -1 && (
								<button onClick={handleStartBatchQueue} className="mt-6 w-full py-3 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 rounded-xl text-sm font-semibold shadow-lg hover:shadow-xl transition-all">▶ Start Queue</button>
							)}
							{batchCurrentIndex >= 0 && (
								<div className="mt-6 p-4 bg-zinc-800/60 rounded-xl border border-zinc-700/50">
									<p className="text-sm text-zinc-300 font-medium mb-3">Processing: <span className="text-amber-400">{batchQueue[batchCurrentIndex]?.scriptPath.split("/").pop()}</span></p>
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
							{(view === "editor" || view === "complete") && (
								<div className="pt-5 px-4 pb-4 border-b border-zinc-800">
									<ModelSelector settings={settings} onChange={(s) => { setSettings(s); window.api.saveSettings(s); }} />
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
													onClick={() => setConfirm({ title: "Continue Render?", message: "This will continue rendering from where it stopped.", confirmLabel: "Continue", onConfirm: () => { setConfirm(null); handleRenderVideo("continue"); } })}
													disabled={checkingAssets || previewingAll}
													className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${checkingAssets || previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black shadow-md hover:shadow-lg"}`}
												>
													{previewingAll ? "Searching..." : checkingAssets ? "Checking..." : "▶ Continue"}
												</button>
												<button
													onClick={() => setConfirm({ title: "New Render?", message: "This will re-render the video from scratch, replacing the existing output.", confirmLabel: "New Render", onConfirm: () => { setConfirm(null); handleRenderVideo("render"); } })}
													className="text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
												>
													New Render
												</button>
											</>
										) : (
											<button
												onClick={() => setConfirm({ title: "Render Video?", message: "This will start rendering the final video using the current assets. Make sure all assets are downloaded and checked.", confirmLabel: "Render", onConfirm: () => { setConfirm(null); handleRenderVideo("render"); } })}
												disabled={checkingAssets || previewingAll}
												className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${checkingAssets || previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black shadow-md hover:shadow-lg"}`}
											>
												{previewingAll ? "Searching..." : checkingAssets ? "Checking..." : "▶ Render"}
											</button>
										)}
									</div>
									<div className="w-px h-6 bg-zinc-700/60 mx-1" />
									<div className="flex items-center gap-1.5">
										<button onClick={handlePreviewAll} disabled={previewingAll} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200 shadow-sm hover:shadow-md"}`}>{previewingAll ? "Searching..." : "Preview"}</button>
										{Object.keys(beatCandidates).length > 0 && (
											<button onClick={handleDownloadAllSelected} disabled={previewingAll || Object.keys(assets).length >= scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image").length} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${previewingAll ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-blue-600 hover:bg-blue-500 text-white shadow-sm hover:shadow-md"}`}>Download</button>
										)}
										<button onClick={handleCheckAllAssets} disabled={checkingAssets} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${checkingAssets ? "bg-zinc-700 text-zinc-500 cursor-wait" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200 shadow-sm hover:shadow-md"}`}>{checkingAssets ? "Checking..." : "Check"}</button>
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
													setConfirm({ title: `Delete ${preview.total} Orphaned File${preview.total > 1 ? "s" : ""}?`, message: `This will permanently delete ${parts.join(", ")}. These files don't match any beats in the current scene plan. This cannot be undone.`, confirmLabel: "Delete", onConfirm: () => { setConfirm(null); handleCleanAssets(); } });
												} catch (err: any) { setError({ title: "Preview Failed", message: err.message }); }
											}}
											className="px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm bg-zinc-700 hover:bg-red-900/30 text-red-400 hover:text-red-300 hover:shadow-md"
										>Clean</button>
									</div>
									<div className="w-px h-6 bg-zinc-700/60 mx-1" />
									<button
										onClick={() => setConfirm({ title: "New Scene Plan?", message: "This will create a new scene plan from scratch. All assets for the current beats will be deleted and need to be re-downloaded.", confirmLabel: "New Plan", onConfirm: () => { setConfirm(null); handleRegenerate(); } })}
										disabled={regenerating}
										className={`ml-auto px-4 py-2 rounded-lg text-xs font-semibold transition-all ${regenerating ? "bg-zinc-800 text-zinc-500 cursor-wait" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"}`}
									>{regenerating ? "Generating..." : "↻ New Scene Plan"}</button>
								</div>
								{Object.keys(assetValidation).length > 0 && (
									<div className="mb-2 px-1 text-xs">
										{(() => {
											const valid = Object.values(assetValidation).filter((v) => v.valid && v.hasAsset && v.reason !== "quality_failed").length;
											const invalid = Object.values(assetValidation).filter((v) => !v.valid && v.hasAsset).length;
											const missing = Object.values(assetValidation).filter((v) => !v.valid && !v.hasAsset).length;
											const qualityFailed = Object.values(assetValidation).filter((v) => v.reason === "quality_failed").length;
											return <span className={invalid > 0 || missing > 0 || qualityFailed > 0 ? "text-red-400" : "text-emerald-400"}>{valid} valid, {invalid} corrupt, {missing} missing, {qualityFailed} quality failed</span>;
										})()}
									</div>
								)}
								<BeatTimeline beats={scenePlan.beats} selectedBeatId={selectedBeatId} onSelectBeat={setSelectedBeatId} assets={assets} thumbnails={thumbnails} beatStatuses={beatStatuses} assetValidation={assetValidation} subscribeHintBeatIds={subscribeHintBeatIds} beatCandidates={beatCandidates} selectedCandidateIndex={selectedCandidateIndex} />
							</div>
							{view === "editor" && selectedBeat && (
								<div className="border-t border-zinc-800">
									<BeatEditor
										beat={selectedBeat}
										thumbnail={thumbnails[selectedBeat.id]}
										assetPath={assets[selectedBeat.id]}
										onReDownload={handleReDownloadBeat}
										onSaveSearch={handleSaveSearch}
										onToggleOverlay={handleToggleOverlay}
										onSearchBeat={handleSearchBeat}
										onSelectCandidate={handleSelectCandidate}
										onDownloadCandidate={handleDownloadCandidate}
										isReDownloading={downloadingBeats.includes(selectedBeat.id) || downloadingCandidateBeat === selectedBeat.id}
										beatStatus={beatStatuses[selectedBeat.id]}
										subscribeHint={subscribeHintBeatIds.has(selectedBeat.id)}
										candidates={beatCandidates[selectedBeat.id]}
										selectedCandidateIndex={selectedCandidateIndex[selectedBeat.id]}
										scriptSegment={beatTextSegments[selectedBeat.id]}
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
										<button className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black rounded-xl text-sm font-semibold shadow-lg hover:shadow-xl transition-all" onClick={() => setConfirm({ title: "New Render?", message: "This will re-render the video from scratch, replacing the existing output.", confirmLabel: "New Render", onConfirm: () => { setConfirm(null); handleRenderVideo("render"); } })}>New Render</button>
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
											<button className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-sm font-medium" onClick={() => handleRenderVideo("continue")}>Continue Render</button>
										)}
										<button className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-medium" onClick={handleBackToEditor}>Back to Editor</button>
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
									<button className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium" onClick={handleStop}>Stop</button>
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
										activePipelineProjectIdRef.current = project.id;
										setCurrentProjectId(project.id);
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
										setAssets({});
										setThumbnails({});
										setBeatStatuses({});
										setAssetValidation({});
										setDownloadingBeats([]);
		setBeatCandidates(project.beatCandidates ?? {});
		setSelectedCandidateIndex(project.selectedCandidateIndex ?? {});
										setBeatTextSegments({});
										setSelectedBeatId(null);
										setReDownloadingBeat(null);
										setCheckingAssets(false);
										setPreviewingAll(false);
										setDownloadingCandidateBeat(null);
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
