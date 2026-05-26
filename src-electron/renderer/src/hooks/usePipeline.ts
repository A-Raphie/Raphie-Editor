import { useState, useCallback, useEffect, useRef } from "react";
import type { PipelineProgress, PipelineStateInfo } from "../../shared/types";

export interface ErrorInfo {
	title: string;
	message: string;
	actionLabel?: string;
	onAction?: () => void;
}

function translateError(raw: string): ErrorInfo {
	const msg = raw.toLowerCase();
	if (msg.includes("enotdir") || msg.includes("esbuild") || msg.includes("spawn")) return { title: "Renderer Error", message: raw.length > 300 ? raw.slice(0, 300) + "..." : raw };
	if (msg.includes("401") || msg.includes("403") || msg.includes("incorrect api key") || msg.includes("openrouter_api_key")) return { title: "API Key Error", message: "Your OpenRouter API key is missing or invalid. Check Settings.", actionLabel: "Open Settings" };
	if (msg.includes("connection") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed")) return { title: "Connection Error", message: "Could not connect to the server. Check your internet connection and try again." };
	if (msg.includes("command failed") && msg.includes("ffmpeg")) return { title: "Missing Tool", message: "ffmpeg was not found. Try restarting the app." };
	return { title: "Error", message: raw.length > 200 ? raw.slice(0, 200) + "..." : raw };
}

export function fmtElapsed(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	if (totalSec > 0) return `${totalSec}.${Math.floor((ms % 1000) / 100)}s`;
	return "0s";
}

interface UsePipelineDeps {
	settings: any;
	scriptPath: string | null;
	srtPath: string | null;
	voPath: string | null;
	musicPath: string | null;
	scenePlan: any;
	currentProjectId: string | null;
	currentProjectIdRef: React.MutableRefObject<string | null>;
	selectedResolution: number;
	batchCurrentIndex: number;
	beatCandidates: Record<string, any[]>;
	assets: Record<string, string>;
	autoSaveProject: (status: string, extra?: any) => Promise<void>;
	refreshProjects: () => Promise<void>;
	openSettings: () => void;
	setScenePlan: (v: any) => void;
	setView: (v: string) => void;
	setError: (v: ErrorInfo | null) => void;
	setProgress: (v: PipelineProgress | null) => void;
	setLogs: (v: string[]) => void;
	setOutputPath: (v: string | null) => void;
	setRenderingError: (v: string | null) => void;
	setRenderStartTime: (v: number | null) => void;
	setRenderElapsed: (v: string) => void;
	setPreviousElapsed: (v: string) => void;
	setSessionTimes: (v: number[]) => void;
	setShowSessionDetails: (v: boolean) => void;
	setRegenerating: (v: boolean) => void;
	setPipelineStateInfo: (v: PipelineStateInfo | null) => void;
	setAssets: (v: Record<string, string>) => void;
	setThumbnails: (v: Record<string, string>) => void;
	setBeatStatuses: (v: Record<string, any>) => void;
	setAssetValidation: (v: Record<string, any>) => void;
	setDownloadingBeats: (v: string[]) => void;
	setBeatCandidates: (v: Record<string, any[]>) => void;
	setSelectedCandidateIndex: (v: Record<string, number>) => void;
	setBatchQueue: (updater: (q: any[]) => any[]) => void;
}

export function usePipeline(deps: UsePipelineDeps) {
	const {
		settings, scriptPath, srtPath, voPath, musicPath, scenePlan, currentProjectId,
		currentProjectIdRef, selectedResolution, batchCurrentIndex, beatCandidates, assets,
		autoSaveProject, refreshProjects, openSettings,
		setScenePlan, setView, setError, setProgress, setLogs, setOutputPath,
		setRenderingError, setRenderStartTime, setRenderElapsed, setPreviousElapsed,
		setSessionTimes, setShowSessionDetails, setRegenerating, setPipelineStateInfo,
		setAssets, setThumbnails, setBeatStatuses, setAssetValidation, setDownloadingBeats,
		setBeatCandidates, setSelectedCandidateIndex, setBatchQueue,
	} = deps;

	const activePipelineProjectIdRef = useRef<string | null>(null);
	const isRenderingRef = useRef(false);
	const renderStartTimeRef = useRef<number | null>(null);
	const viewRef = useRef<string>("input");
	const scenePlanRef = useRef<any>(null);
	const autoSaveProjectRef = useRef(autoSaveProject);
	const openSettingsRef = useRef(openSettings);
	const pendingPlanProjectIdRef = useRef<string | null>(null);

	autoSaveProjectRef.current = autoSaveProject;
	openSettingsRef.current = openSettings;
	scenePlanRef.current = scenePlan;
	currentProjectIdRef.current = currentProjectId;

	useEffect(() => {
		const unsubProgress = window.api.onProgress((p: PipelineProgress) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid !== currentProjectIdRef.current) return;
			setProgress(p);
			if (batchCurrentIndex >= 0) {
				setBatchQueue((q) => q.map((it, idx) => idx === batchCurrentIndex ? { ...it, progress: p } : it));
			}
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
			setLogs((prev: string[]) => [...prev, msg]);
		};
		const unsubAssets = (newAssets: Record<string, string>) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid && activePid !== currentProjectIdRef.current) return;
			setAssets((prev: Record<string, string>) => ({ ...prev, ...newAssets }));
		};
		const unsubBeatStatus = (beatId: string, status: string, downloadPercent: number, error: string, errorDetails: string) => {
			const activePid = activePipelineProjectIdRef.current;
			if (activePid && activePid !== currentProjectIdRef.current) return;
			setBeatStatuses((prev: Record<string, any>) => ({ ...prev, [beatId]: { status, downloadPercent, error, errorDetails } }));
		};
		window.api.onComplete(unsubComplete);
		window.api.onError(unsubError);
		window.api.onScenePlanReady(unsubScenePlan);
		window.api.onLog(unsubLog);
		window.api.onAssetDownloaded(unsubAssets);
		window.api.onBeatStatus(unsubBeatStatus);
		return () => { unsubProgress(); };
	}, []);

	const validate = useCallback((needsApi = true) => {
		if ((!settings?.openrouterApiKeys || settings.openrouterApiKeys.length === 0) && needsApi) {
			setError({ title: "Missing API Key", message: "Please add your OpenRouter API key in Settings to use AI features.", actionLabel: "Open Settings", onAction: () => { setError(null); openSettings(); } });
			return false;
		}
		if (!scriptPath && !srtPath) { setError({ title: "Missing Input", message: "Please select an SRT subtitles file or a script file." }); return false; }
		if (!voPath) { setError({ title: "Missing Voiceover", message: "Please select a voiceover audio file (.mp3, .wav, etc.)." }); return false; }
		return true;
	}, [settings, scriptPath, srtPath, voPath, openSettings]);

	const doPreview = useCallback(async () => {
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

	return {
		activePipelineProjectIdRef, isRenderingRef, renderStartTimeRef,
		viewRef, scenePlanRef, autoSaveProjectRef, openSettingsRef,
		pendingPlanProjectIdRef, currentProjectIdRef,
		validate, doPreview, handleRegenerate, handleRenderVideo,
		handleStop, handleBackToEditor, fmtElapsed,
	};
}
