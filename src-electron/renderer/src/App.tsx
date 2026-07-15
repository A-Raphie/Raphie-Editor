import React, { useState, useEffect, useRef, useCallback } from "react";
import type { AppSettings, SavedProject, PipelineProgress, PipelineStateInfo } from "../../shared/types";
import { PLANNER_MODELS, CHECKER_MODELS } from "../../shared/types";
import { beatDerailment } from "../../shared/sectionUtils";
import Sidebar from "./components/Sidebar";
import DropZone from "./components/DropZone";
import PlanningView from "./components/PlanningView";
import ProjectsView from "./components/ProjectsView";
import BeatTimeline from "./components/BeatTimeline";
import BeatEditor from "./components/BeatEditor";
import Settings from "./components/Settings";
import ErrorModal from "./components/ErrorModal";
import ConfirmModal from "./components/ConfirmModal";
import SectionPlanModal from "./components/SectionPlanModal";
import SectionSummary from "./components/SectionSummary";
import OverlayEditor from "./pages/OverlayEditor";
import { useBatchQueue } from "./hooks/useBatchQueue";
import { useProjects } from "./hooks/useProjects";
import { usePipeline, fmtElapsed } from "./hooks/usePipeline";
import type { ErrorInfo } from "./hooks/usePipeline";
import { useAssets } from "./hooks/useAssets";
import { useBeatCandidates } from "./hooks/useBeatCandidates";

interface ConfirmInfo {
	title: string;
	message: React.ReactNode;
	confirmLabel: string;
	onConfirm: () => void;
	inputLabel?: string;
	extraContent?: React.ReactNode;
	showListicle?: boolean;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	return `${Math.round(bytes / 1_000_000)} MB`;
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
	const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
	const [selectedResolution, setSelectedResolution] = useState(1080);
	const [selectedAspectRatio, setSelectedAspectRatio] = useState("16:9");
	const [selectedCodec, setSelectedCodec] = useState("h265");
	const [renderMode, setRenderMode] = useState<"bestSource" | "balanced" | "hybrid">("balanced");
	const [showResumePicker, setShowResumePicker] = useState(false);
	const [resumeOptions, setResumeOptions] = useState<any[]>([]);
	const [confirm, setConfirm] = useState<ConfirmInfo | null>(null);
	const [prerenderConverting, setPrerenderConverting] = useState(false);
	const [prerenderProgress, setPrerenderProgress] = useState<{ total: number; done: number } | null>(null);
	const [renderSizes, setRenderSizes] = useState<{ h264Bytes: number; finalBytes: number } | null>(null);
	const [projectName, setProjectName] = useState("");
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [beatFilter, setBeatFilter] = useState<string | null>(null);
	const [beatCandidates, setBeatCandidates] = useState<Record<string, any[]>>({});
	const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<Record<string, number>>({});
	const [isListicle, setIsListicle] = useState(true);
	const [sectionPlan, setSectionPlan] = useState<any>(null);
	const [showSectionModal, setShowSectionModal] = useState(false);
	const [generatingSections, setGeneratingSections] = useState(false);
	const [sectionLog, setSectionLog] = useState("");
	const [showOverlayEditor, setShowOverlayEditor] = useState(false);
	const isListicleRef = useRef(false);
	useEffect(() => { isListicleRef.current = isListicle; }, [isListicle]);

	useEffect(() => {
		setShowSectionModal(false);
		setGeneratingSections(false);
		setSectionLog("");
	}, [currentProjectId]);

	useEffect(() => {
		if (!generatingSections) { setSectionLog(""); return; }
		const unsub = window.api.onLog((msg) => setSectionLog(msg));
		return unsub;
	}, [generatingSections]);

	// Permanent main-process log → DevTools console echo, so diagnostics
	// (e.g. [search-diag]) are visible in the renderer regardless of flow.
	useEffect(() => {
		const unsub = window.api.onLog((msg) => console.log("[main]", msg));
		return unsub;
	}, []);

	const logsEndRef = useRef<HTMLDivElement>(null);
	const currentProjectIdRef = useRef<string | null>(null);
	const activePipelineProjectIdRef = useRef<string | null>(null);
	const pendingPlanProjectIdRef = useRef<string | null>(null);
	const autoSaveProjectRef = useRef(async (_s: string, _e?: any) => {});

	useEffect(() => { currentProjectIdRef.current = currentProjectId; }, [currentProjectId]);

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

	const assetsHook = useAssets({
		currentProjectId, currentProjectIdRef,
		scenePlan, scriptPath, voPath, srtPath,
		autoSaveProjectRef, setScenePlan, setError,
		setBeatCandidates, setSelectedCandidateIndex,
	});

	const candidatesHook = useBeatCandidates({
		currentProjectId, currentProjectIdRef,
		scenePlan, settings, sectionPlan, setScenePlan, assets: assetsHook.assets,
		beatCandidates, setBeatCandidates,
		selectedCandidateIndex, setSelectedCandidateIndex,
		setBeatStatuses: assetsHook.setBeatStatuses,
		setAssets: assetsHook.setAssets, setThumbnails: assetsHook.setThumbnails, setError,
	});

	const batchHook = useBatchQueue({
		activePipelineProjectIdRef,
		setView, setLogs, setError, setRenderingError,
	});

	const pipeline = usePipeline({
		settings, scriptPath, srtPath, voPath, musicPath, scenePlan, currentProjectId,
		currentProjectIdRef, activePipelineProjectIdRef, pendingPlanProjectIdRef,
		autoSaveProjectRef, selectedResolution, selectedAspectRatio, selectedCodec, renderMode, projectName,
		batchCurrentIndex: batchHook.batchCurrentIndex,
		openSettings, refreshProjects: async () => {},
		setScenePlan, setView, setError, setProgress, setLogs, setOutputPath,
		setRenderingError, setRenderStartTime, setRenderElapsed, setPreviousElapsed,
		setSessionTimes, setShowSessionDetails, setRegenerating, setPipelineStateInfo,
		setAssets: assetsHook.setAssets, setThumbnails: assetsHook.setThumbnails,
		setBeatStatuses: assetsHook.setBeatStatuses, setAssetValidation: assetsHook.setAssetValidation,
		setDownloadingBeats: assetsHook.setDownloadingBeats,
		setBeatCandidates: candidatesHook.setBeatCandidates,
		setSelectedCandidateIndex: candidatesHook.setSelectedCandidateIndex,
		setBatchQueue: batchHook.setBatchQueue,
		setRenderSizes,
	});

	const projectsHook = useProjects({
		activePipelineProjectIdRef, pendingPlanProjectIdRef,
		currentProjectId, setCurrentProjectId,
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
		setRenderStartTime, setRenderElapsed, setRenderSizes, setProjectName,
		setSectionPlan, setIsListicle,
	});

	useEffect(() => {
		autoSaveProjectRef.current = projectsHook.autoSaveProject;
	}, [projectsHook.autoSaveProject]);

	useEffect(() => {
		if (view !== "editor" || !scenePlan?.beats?.length) return;
		const handler = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			const beats = scenePlan.beats;
			if (e.key === "Escape") { setSelectedBeatId(null); return; }
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
			e.preventDefault();
			const idx = beats.findIndex((b: any) => b.id === selectedBeatId);
			if (e.key === "ArrowRight") {
				if (idx < 0 || idx >= beats.length - 1) setSelectedBeatId(beats[0].id);
				else setSelectedBeatId(beats[idx + 1].id);
			} else if (e.key === "ArrowLeft") {
				if (idx <= 0) setSelectedBeatId(beats[beats.length - 1].id);
				else setSelectedBeatId(beats[idx - 1].id);
			} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				const grid = document.querySelector("[data-beat-grid]");
				if (!grid) return;
				const gridWidth = grid.clientWidth;
				const cols = Math.floor((gridWidth + 12) / 140) || 1;
				const newIdx = e.key === "ArrowDown"
					? (idx < 0 ? 0 : Math.min(idx + cols, beats.length - 1))
					: (idx < 0 ? 0 : Math.max(idx - cols, 0));
				setSelectedBeatId(beats[newIdx].id);
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
		const timer = setTimeout(() => { autoSaveProjectRef.current("editing"); }, 1000);
		return () => clearTimeout(timer);
	}, [assetsHook.assets, candidatesHook.beatCandidates, currentProjectId, scenePlan]);

	useEffect(() => {
		if (!currentProjectId) return;
		// Only persist the section plan if it belongs to the current project —
		// prevents a stale plan from a previous project being written into the
		// new project's save file.
		if (sectionPlan && sectionPlan.projectId && sectionPlan.projectId !== currentProjectId) return;
		window.api.saveProject({ id: currentProjectId, sectionPlan: sectionPlan ?? undefined, isListicle })
			.then(() => projectsHook.refreshProjects())
			.catch(() => {});
	}, [sectionPlan, isListicle, currentProjectId]);

	useEffect(() => {
		const unsub = window.api.onPrerenderProgress((data) => {
			setPrerenderProgress(data);
			if (data.done >= data.total) {
				setTimeout(() => setPrerenderProgress(null), 3000);
			}
		});
		return unsub;
	}, []);

	useEffect(() => {
		const unsub = window.api.onRenderSizes((data) => {
			setRenderSizes(data);
		});
		return unsub;
	}, []);

	pipeline.viewRef.current = view;

	const handleListiclePreview = useCallback(async (name?: string) => {
		if (!srtPath || !voPath) return;
		let pid = currentProjectId;
		if (!pid) {
			const saved = await autoSaveProjectRef.current("planning", name ? { name } : undefined);
			pid = saved?.id ?? currentProjectIdRef.current;
		}
		if (!pid) return;
		// Only show existing plan if it belongs to THIS project. A plan from a
		// different project (e.g. after creating a new project) must not be shown —
		// it needs to be regenerated for the new SRT.
		if (sectionPlan && sectionPlan.sections?.length > 0 && sectionPlan.projectId === pid) {
			setShowSectionModal(true);
			return;
		}
		setGeneratingSections(true);
		setError(null);
		try {
			const plan = await window.api.generateSectionPlan(srtPath, voPath, pid);
			setSectionPlan({ ...plan, projectId: pid });
			setShowSectionModal(true);
		} catch (err: any) {
			setError({ title: "Section Plan Failed", message: err.message || "Failed to generate section plan." });
		} finally {
			setGeneratingSections(false);
		}
	}, [srtPath, voPath, currentProjectId, sectionPlan]);

	// Auto-resume: when opening a listicle project stuck at "planning" (has SRT +
	// VO but no scene plan), automatically open the SectionPlanModal once per
	// explicit open. Keys off the open-nonce (bumped by handleOpenProject /
	// handleNewProject) so it fires exactly once per open, never on state
	// settling or modal cancel — preventing loops.
	const lastOpenNonceRef = useRef(0);
	const autoResumedNonceRef = useRef(0);
	useEffect(() => {
		const nonce = projectsHook.openedNonce;
		if (nonce !== lastOpenNonceRef.current) {
			lastOpenNonceRef.current = nonce;
			autoResumedNonceRef.current = 0;
		}
		if (view !== "input") return;
		if (!isListicle || !srtPath || !voPath || !currentProjectId) return;
		if (scenePlan || generatingSections || showSectionModal) return;
		if (autoResumedNonceRef.current === nonce) return;
		autoResumedNonceRef.current = nonce;
		handleListiclePreview(projectName || undefined);
	}, [projectsHook.openedNonce, view, isListicle, srtPath, voPath, currentProjectId, scenePlan, generatingSections, showSectionModal, projectName, handleListiclePreview]);

	const handleRescanSections = useCallback(async () => {
		if (!srtPath || !voPath || !currentProjectId) return;
		setShowSectionModal(false);
		setGeneratingSections(true);
		setError(null);
		try {
			const plan = await window.api.generateSectionPlan(srtPath, voPath, currentProjectId);
			setSectionPlan({ ...plan, projectId: currentProjectId });
			setShowSectionModal(true);
		} catch (err: any) {
			setError({ title: "Section Plan Failed", message: err.message || "Failed to generate section plan." });
		} finally {
			setGeneratingSections(false);
		}
	}, [srtPath, voPath, currentProjectId]);

	const handleRegenerateSection = useCallback(async (sectionId: string): Promise<any[] | null> => {
		if (!srtPath || !voPath || !currentProjectId) return null;
		try {
			const plan = await window.api.generateSectionPlan(srtPath, voPath, currentProjectId);
			return plan?.sections ?? null;
		} catch (err: any) {
			setError({ title: "Section Regenerate Failed", message: err.message || "Failed to re-detect section." });
			return null;
		}
	}, [srtPath, voPath, currentProjectId]);

	const handleSaveSectionTemplates = useCallback(async (newSettings: AppSettings) => {
		await window.api.saveSettings(newSettings);
		setSettings(newSettings);
	}, []);

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
			inputLabel: "Video Name",
			showListicle: true,
		onConfirm: (val?: string) => {
			setConfirm(null);
			const name = val?.trim();
			if (isListicleRef.current && srtPath) {
				handleListiclePreview(name);
			} else {
				pipeline.doPreview(name);
			}
		}
		});
	}, [scriptPath, srtPath, voPath, settings, openSettings, pipeline.doPreview, isListicle, currentProjectId]);

	const derailedBeats = (() => {
		if (!scenePlan || !sectionPlan) return [];
		return scenePlan.beats.filter((b: any) => (b.type === "clip" || b.type === "image") && beatDerailment(b, sectionPlan).derailed);
	})();

	// Beats whose selected candidate URL or perceptual hash is shared by another
	// beat (duplicate). Matches BeatTimeline's duplicate detection logic.
	const duplicateBeats = (() => {
		if (!scenePlan) return [];
		const assetable = scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image");
		// Exact-URL collisions.
		const urlToBeats = new Map<string, string[]>();
		for (const b of assetable) {
			const cands = candidatesHook.beatCandidates[b.id];
			if (!cands?.length) continue;
			const idx = candidatesHook.selectedCandidateIndex[b.id] ?? 0;
			const url = cands[idx]?.url;
			if (!url) continue;
			const group = urlToBeats.get(url) ?? [];
			group.push(b.id);
			urlToBeats.set(url, group);
		}
		// Perceptual-hash collisions.
		const hashToBeats = new Map<string, string[]>();
		if (candidatesHook.imageHashes) {
			for (const [id, hash] of Object.entries(candidatesHook.imageHashes)) {
				if (!hash) continue;
				const group = hashToBeats.get(hash) ?? [];
				group.push(id);
				hashToBeats.set(hash, group);
			}
		}
		const dupIds = new Set<string>();
		for (const group of urlToBeats.values()) if (group.length > 1) for (const id of group) dupIds.add(id);
		for (const group of hashToBeats.values()) if (group.length > 1) for (const id of group) dupIds.add(id);
		return assetable.filter((b: any) => dupIds.has(b.id));
	})();

	const handleResetBeatToSection = useCallback((beatId: string) => {
		if (!scenePlan || !sectionPlan || !currentProjectId) return;
		const beat = scenePlan.beats.find((b: any) => b.id === beatId);
		if (!beat) return;
		const d = beatDerailment(beat, sectionPlan);
		if (!d.derailed || !d.section?.searchContext) return;
		const updated = { ...scenePlan, beats: scenePlan.beats.map((b: any) => b.id === beatId ? { ...b, searchQuery: d.section!.searchContext } : b) };
		setScenePlan(updated);
		setBeatCandidates((prev) => { const next = { ...prev }; delete next[beatId]; return next; });
		window.api.saveScenePlan(currentProjectId, updated).catch(() => {});
	}, [scenePlan, sectionPlan, currentProjectId]);

	const handleEditSectionLabel = useCallback((sectionId: string, newLabel: string) => {
		if (!scenePlan || !sectionPlan || !currentProjectId) return;
		const ctx = newLabel.toLowerCase().trim();
		const updatedSectionPlan = {
			...sectionPlan,
			sections: sectionPlan.sections.map((s: any) =>
				s.id === sectionId ? { ...s, label: newLabel, searchContext: ctx } : s
			),
		};
		setSectionPlan(updatedSectionPlan);
		const updated = {
			...scenePlan,
			beats: scenePlan.beats.map((b: any) => {
				const d = beatDerailment(b, updatedSectionPlan);
				if (d.section?.id !== sectionId) return b;
				return { ...b, searchQuery: ctx };
			}),
		};
		setScenePlan(updated);
		const sectionBeatIds = new Set(
			scenePlan.beats
				.filter((b: any) => beatDerailment(b, updatedSectionPlan).section?.id === sectionId)
				.map((b: any) => b.id)
		);
		setBeatCandidates((prev) => {
			const next = { ...prev };
			for (const id of sectionBeatIds) delete next[id];
			return next;
		});
		window.api.saveScenePlan(currentProjectId, updated).catch(() => {});
	}, [scenePlan, sectionPlan, currentProjectId]);

	const handleFixDerailed = useCallback(() => {
		if (derailedBeats.length === 0 || !scenePlan || !sectionPlan || !currentProjectId) return;
		const list = (
			<div className="max-h-48 overflow-y-auto mt-2 mb-2 text-[11px] text-zinc-400 border border-zinc-700 rounded-md p-2 space-y-1">
				{derailedBeats.map((b: any) => {
					const d = beatDerailment(b, sectionPlan);
					return (
						<div key={b.id} className="flex items-baseline gap-1.5">
							<span className="text-zinc-500 font-mono shrink-0">#{scenePlan.beats.indexOf(b) + 1}</span>
							<span className="text-rose-300 truncate">{b.searchQuery}</span>
							<span className="text-zinc-600 shrink-0">→</span>
							<span className="text-emerald-300 truncate">{d.section?.searchContext}</span>
						</div>
					);
				})}
			</div>
		);
		setConfirm({
			title: `Fix ${derailedBeats.length} Derailed Beat${derailedBeats.length > 1 ? "s" : ""}?`,
			message: "Reset each search query to its section context. Stale candidates will be cleared.",
			confirmLabel: "Apply",
			extraContent: list,
			onConfirm: () => {
				setConfirm(null);
				const fixedIds = new Set(derailedBeats.map((b: any) => b.id));
				const updated = {
					...scenePlan,
					beats: scenePlan.beats.map((b: any) => {
						if (!fixedIds.has(b.id)) return b;
						const d = beatDerailment(b, sectionPlan);
						return d.section?.searchContext ? { ...b, searchQuery: d.section.searchContext } : b;
					}),
				};
				setScenePlan(updated);
				setBeatCandidates((prev) => { const next = { ...prev }; for (const id of fixedIds) delete next[id]; return next; });
				window.api.saveScenePlan(currentProjectId, updated).catch(() => {});
			},
		});
	}, [derailedBeats, scenePlan, sectionPlan, currentProjectId]);

	const handleFixDuplicates = useCallback(() => {
		if (duplicateBeats.length === 0) return;
		// Clear the duplicate beats' candidates so Preview All picks them up
		// for re-searching. Use setTimeout(0) so the React state update flushes
		// (and beatCandidatesRef syncs) before handlePreviewAll runs — otherwise
		// the ref still sees the old candidates and skips the cleared beats.
		const dupIds = duplicateBeats.map((b: any) => b.id);
		setBeatCandidates((prev) => {
			const next = { ...prev };
			for (const id of dupIds) delete next[id];
			return next;
		});
		// Trigger Preview All after state flushes.
		setTimeout(() => candidatesHook.handlePreviewAll().catch(() => {}), 0);
	}, [duplicateBeats, candidatesHook]);

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
					<ProjectsView projects={projectsHook.projects} onOpen={projectsHook.handleOpenProject} onRename={projectsHook.handleRenameProject} onDelete={projectsHook.handleDeleteProject} onNew={projectsHook.handleNewProject} onAddToQueue={batchHook.addToQueue} onAddManyToQueue={(projs) => { const eligible = projs.filter((p) => p.scenePlan?.beats?.length); eligible.forEach((p) => batchHook.addToQueue(p)); if (eligible.length < projs.length) setError({ title: "Some projects skipped", message: `${projs.length - eligible.length} project(s) were not added — they have no scene plan yet. Open each and generate a scene plan first.` }); }} />
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
									<p className="text-sm text-zinc-600">Select projects and add them to download their beats in the background</p>
								</div>
							) : (
								<div className="space-y-3">
									{batchHook.batchQueue.map((item, idx) => (
										<div key={item.id} className={`p-4 rounded-xl border transition-all ${idx === batchHook.batchCurrentIndex ? "border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/10" : item.status === "completed" ? "border-emerald-500/50 bg-emerald-500/5" : item.status === "failed" ? "border-red-500/50 bg-red-500/5" : "border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-800/60"}`}>
											<div className="flex items-center gap-4">
												<span className="text-zinc-500 text-sm font-medium w-6">{idx + 1}.</span>
												<span className="text-zinc-200 text-sm flex-1 truncate font-medium">{item.scriptPath.split("/").pop()}</span>
												<span className={`text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-md ${item.status === "pending" ? "bg-zinc-700/50 text-zinc-400 border border-zinc-600/30" : item.status === "running" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : item.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>{item.status}</span>
												{item.status !== "running" && <button onClick={() => batchHook.removeFromQueue(idx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Remove from queue">✕</button>}
												{item.status === "failed" && <button onClick={() => batchHook.handleStartBatchQueue(item.id)} className="px-2 py-1 rounded-md text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all">Retry</button>}
												{item.status === "completed" && (() => { const p = projectsHook.projects.find((pp) => pp.id === item.id); return p ? <button onClick={() => projectsHook.handleOpenProject(p)} className="px-2 py-1 rounded-md text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all">Open</button> : null; })()}
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
									<div className="flex items-center justify-between mb-3">
										<p className="text-sm text-zinc-300 font-medium">Processing: <span className="text-amber-400">{batchHook.batchQueue[batchHook.batchCurrentIndex]?.scriptPath.split("/").pop()}</span></p>
										<button onClick={() => batchHook.handleStopBatchQueue()} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all">⏹ Stop Queue</button>
									</div>
									{(() => {
										const itemProgress = batchHook.batchQueue[batchHook.batchCurrentIndex]?.progress;
										return itemProgress ? (
											<div className="space-y-2">
												<div className="h-2.5 bg-zinc-700 rounded-full overflow-hidden">
													<div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all rounded-full" style={{ width: `${itemProgress.percent}%` }} />
												</div>
												<p className="text-xs text-zinc-500">{itemProgress.message}</p>
											</div>
										) : null;
									})()}
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
								<div className="flex items-center justify-between mb-3">
									{editingTitle ? (
										<div className="flex items-center gap-1.5 mr-4">
											<input
												autoFocus
												type="text"
												value={titleDraft}
												onChange={(e) => setTitleDraft(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter" && titleDraft.trim()) { setEditingTitle(false); setProjectName(titleDraft.trim()); if (currentProjectId) projectsHook.handleRenameProject(currentProjectId, titleDraft.trim()); }
													if (e.key === "Escape") { setEditingTitle(false); }
												}}
												onBlur={() => { if (titleDraft.trim() && titleDraft.trim() !== projectName) { setProjectName(titleDraft.trim()); if (currentProjectId) projectsHook.handleRenameProject(currentProjectId, titleDraft.trim()); } setEditingTitle(false); }}
												className="text-sm font-semibold text-zinc-200 bg-zinc-800 border border-amber-500 rounded px-2 py-0.5 focus:outline-none min-w-0 max-w-xs"
											/>
										</div>
									) : (
										<h2
											className="text-sm font-semibold text-zinc-300 tracking-tight truncate mr-4 cursor-text hover:text-zinc-100"
											onDoubleClick={() => { setTitleDraft(projectName || scenePlan?.title || ""); setEditingTitle(true); }}
											title="Double-click to rename"
										>{projectName || scenePlan?.title || "Untitled"}</h2>
									)}
									<div className="flex items-center gap-2 shrink-0">
										<select value={selectedAspectRatio} onChange={(e) => setSelectedAspectRatio(e.target.value)} className="h-7 bg-zinc-800/80 border border-zinc-700/60 rounded-md px-2 text-[11px] text-zinc-400 focus:outline-none focus:border-zinc-500 cursor-pointer">
											<option value="16:9">16:9</option>
											<option value="9:16">9:16</option>
										</select>
										<select value={selectedCodec} onChange={(e) => setSelectedCodec(e.target.value)} className="h-7 bg-zinc-800/80 border border-zinc-700/60 rounded-md px-2 text-[11px] text-zinc-400 focus:outline-none focus:border-zinc-500 cursor-pointer">
											<option value="h265">HEVC</option>
											<option value="h264">H.264</option>
										</select>
										<select value={selectedResolution} onChange={(e) => setSelectedResolution(parseInt(e.target.value))} className="h-7 bg-zinc-800/80 border border-zinc-700/60 rounded-md px-2 text-[11px] text-zinc-400 focus:outline-none focus:border-zinc-500 cursor-pointer">
											<option value={720}>720p</option>
											<option value={1080}>1080p</option>
											<option value={2160}>4K</option>
										</select>
										<select value={renderMode} onChange={(e) => setRenderMode(e.target.value as any)} className="h-7 bg-zinc-800/80 border border-zinc-700/60 rounded-md px-2 text-[11px] text-zinc-400 focus:outline-none focus:border-zinc-500 cursor-pointer">
										<option value="bestSource">Best Source (x264→HEVC)</option>
										<option value="balanced">Balanced (VT→HEVC)</option>
										<option value="hybrid">Hybrid (VT→x265)</option>
										</select>
										<span className="text-zinc-700 mx-1">·</span>
										<span className="text-[11px] text-zinc-500 tabular-nums">{Math.floor(scenePlan.totalDurationSeconds / 60)}:{String(Math.floor(scenePlan.totalDurationSeconds % 60)).padStart(2, "0")}</span>
										<span className="text-zinc-700">·</span>
										<span className="text-[11px] text-zinc-500">{scenePlan.beats.filter((b: any) => b.type === "clip").length} clips</span>
										<span className="text-zinc-700">·</span>
										<span className="text-[11px] text-zinc-500">{scenePlan.beats.filter((b: any) => b.type === "image").length} images</span>
										{candidatesHook.imageConversionTotal > 0 && candidatesHook.imageConversionDone < candidatesHook.imageConversionTotal && (
											<>
												<span className="text-zinc-700">·</span>
												<span className="text-[11px] text-cyan-400">{candidatesHook.imageConversionDone}/{candidatesHook.imageConversionTotal} converted</span>
											</>
										)}
										{candidatesHook.imageConversionTotal > 0 && candidatesHook.imageConversionDone === candidatesHook.imageConversionTotal && (
											<>
												<span className="text-zinc-700">·</span>
												<span className="text-[11px] text-emerald-400">all converted</span>
											</>
										)}
										{renderSizes && (
											<>
												<span className="text-zinc-700">·</span>
												<span className="text-[11px] text-zinc-400">{formatBytes(renderSizes.h264Bytes)} → {formatBytes(renderSizes.finalBytes)}</span>
											</>
										)}
									</div>
								</div>
								<div className="flex items-center gap-2 mb-2">
										{(pipelineStateInfo as any)?.renderSegments?.completed > 0 && (pipelineStateInfo as any).renderSegments.completed < (pipelineStateInfo as any).renderSegments.total ? (
											<>
												<button
													onClick={() => setConfirm({ title: "Continue Render?", message: "This will continue rendering from where it stopped.", confirmLabel: "Continue", onConfirm: () => { setConfirm(null); pipeline.handleRenderVideo("continue"); } })}
													disabled={assetsHook.checkingAssets || candidatesHook.previewingAll}
													className={`h-7 px-4 rounded-md text-[11px] font-semibold transition-all ${assetsHook.checkingAssets || candidatesHook.previewingAll ? "bg-zinc-800 text-zinc-600 cursor-wait" : "bg-amber-500 hover:bg-amber-400 text-black"}`}
												>
													{candidatesHook.previewingAll ? "Searching..." : assetsHook.checkingAssets ? "Checking..." : "▶ Continue"}
												</button>
												<button
													onClick={() => setConfirm({ title: "New Render?", message: "This will re-render the video from scratch, replacing the existing output.", confirmLabel: "New Render", onConfirm: () => { setConfirm(null); pipeline.handleRenderVideo("render"); } })}
													className="h-7 px-3 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
												>
													New Render
												</button>
											</>
										) : (
											<button
												onClick={async () => {
												const assetableBeats = scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image");
												const missingCount = assetableBeats.filter((b: any) => !assetsHook.assets[b.id]).length;
												const totalBeats = scenePlan.beats.length;
												const durationSec = scenePlan.totalDurationSeconds ?? 0;
												const durationMin = Math.floor(durationSec / 60);
												const durationSecRem = Math.round(durationSec % 60);
												const formatLabel = selectedAspectRatio === "9:16" ? "Portrait (9:16)" : "Landscape (16:9)";
												const codecLabel = selectedCodec === "h265" ? "HEVC (H.265)" : "H.264";
												const resLabel = selectedResolution === 720 ? "720p" : selectedResolution === 1080 ? "1080p" : "4K";
												const durationStr = `${durationMin}:${String(durationSecRem).padStart(2, "0")}`;
												let estTimeLabel = "Calculating...";
												let estSizeGB = "...";
												try {
													const est = await window.api.getRenderEstimate(totalBeats, selectedResolution, selectedCodec, renderMode, durationSec);
													const estMin = Math.ceil(est.estMs / 60000);
													estTimeLabel = `~${estMin} min`;
													estSizeGB = est.estSizeGB.toFixed(1);
												} catch {
													estTimeLabel = "~" + Math.ceil(totalBeats * 1.5 / 60 + 5) + " min (estimate)";
													const baselineBps = selectedCodec === "h265"
														? (selectedResolution >= 2160 ? 1875000 : selectedResolution >= 1080 ? 750000 : 375000)
														: (selectedResolution >= 2160 ? 3125000 : selectedResolution >= 1080 ? 1000000 : 500000);
													estSizeGB = ((baselineBps * durationSec) / 1024 / 1024 / 1024).toFixed(1);
												}
												setConfirm({
													title: "Render Video?",
													message: (
														<div className="space-y-3">
															<p className="text-xs text-zinc-400">This will start rendering the final video using the current assets.</p>
															<div className="bg-zinc-800/60 rounded-lg p-3 space-y-1 font-mono text-xs">
																<div className="flex gap-3"><span className="text-zinc-500 w-16 shrink-0">Format</span><span className="text-zinc-300">{formatLabel} • {resLabel} @ {settings?.fps ?? 30}fps</span></div>
																<div className="flex gap-3"><span className="text-zinc-500 w-16 shrink-0">Codec</span><span className="text-zinc-300">{codecLabel} • AAC 192kbps</span></div>
																<div className="flex gap-3"><span className="text-zinc-500 w-16 shrink-0">Output</span><span className="text-zinc-300">{durationStr} • ~{estSizeGB} GB</span></div>
																{renderMode !== "bestSource" && <div className="flex gap-3"><span className="text-zinc-500 w-16 shrink-0">Mode</span><span className="text-amber-400">{renderMode === "hybrid" ? "Hybrid (VT h264 + x265 final)" : "Balanced (VT h264 + HEVC VT final)"}</span></div>}
															</div>
															<div className="space-y-1 text-xs">
																<div className="text-zinc-400">{totalBeats} beats ({assetableBeats.length} clips/images)</div>
																{missingCount > 0
																	? <div className="text-amber-400">⚠ {missingCount} missing asset{missingCount > 1 ? "s" : ""} (will use lower-third fallback)</div>
																	: <div className="text-green-400">✓ All assets ready</div>
																}
															</div>
															<div className="text-xs text-zinc-500 pt-1">Estimated render time: {estTimeLabel}{settings?.qualityCheckerModel !== "none" ? ` • ~${assetableBeats.length * (settings?.maxThumbnailsPerQuery ?? 5)} AI quality checks` : ""}</div>
														</div>
													),
													confirmLabel: "Render",
													inputLabel: "Video Name",
													onConfirm: (val?: string) => {
														setConfirm(null);
														const name = val?.trim();
														if (name && name !== projectName) {
															setProjectName(name);
															if (currentProjectId) projectsHook.handleRenameProject(currentProjectId, name);
														}
														pipeline.handleRenderVideo("render");
													}
												});
											}}
												disabled={assetsHook.checkingAssets || candidatesHook.previewingAll}
												className={`h-7 px-4 rounded-md text-[11px] font-semibold transition-all ${assetsHook.checkingAssets || candidatesHook.previewingAll ? "bg-zinc-800 text-zinc-600 cursor-wait" : "bg-amber-500 hover:bg-amber-400 text-black"}`}
											>
												{candidatesHook.previewingAll ? "Searching..." : assetsHook.checkingAssets ? "Checking..." : "▶ Render"}
											</button>
										)}
									{derailedBeats.length > 0 && (
										<button onClick={handleFixDerailed} disabled={candidatesHook.previewingAll} className={`h-7 px-3 rounded-md text-[11px] font-medium transition-colors border ${candidatesHook.previewingAll ? "bg-zinc-800 text-zinc-600 border-zinc-700 cursor-wait" : "bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border-rose-500/40"}`}>Fix Derailed <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/30">{derailedBeats.length}</span></button>
									)}
									{duplicateBeats.length > 0 && (
										<button onClick={handleFixDuplicates} disabled={candidatesHook.previewingAll} className={`h-7 px-3 rounded-md text-[11px] font-medium transition-colors border ${candidatesHook.previewingAll ? "bg-zinc-800 text-zinc-600 border-zinc-700 cursor-wait" : "bg-orange-950/60 hover:bg-orange-900/60 text-orange-300 border-orange-500/40"}`}>Fix Duplicates <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-500/30">{duplicateBeats.length}</span></button>
									)}
									{candidatesHook.rateLimits && (
										<div className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/50" title="API quota remaining this hour (refreshes every 5s)">
											<span className={candidatesHook.rateLimits.pexelsRemaining < 20 ? "text-red-400" : candidatesHook.rateLimits.pexelsRemaining < 100 ? "text-amber-400" : "text-emerald-400"}>P:{candidatesHook.rateLimits.pexelsRemaining}</span>
											<span className={candidatesHook.rateLimits.pixabayRemaining < 100 ? "text-red-400" : candidatesHook.rateLimits.pixabayRemaining < 1000 ? "text-amber-400" : "text-emerald-400"}>X:{candidatesHook.rateLimits.pixabayRemaining}</span>
										</div>
									)}
									<button onClick={() => candidatesHook.handlePreviewAll().catch(() => {})} disabled={candidatesHook.previewingAll} className={`h-7 px-3 rounded-md text-[11px] font-medium transition-colors ${candidatesHook.previewingAll ? "bg-zinc-800 text-zinc-600 cursor-wait" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}`} title={candidatesHook.previewSectionProgress ? candidatesHook.previewSectionProgress.map((s: any) => `${s.label}: ${s.done}/${s.total}`).join(" | ") : undefined}>{candidatesHook.previewingAll ? (candidatesHook.previewProgress ? `Searching ${candidatesHook.previewProgress.done}/${candidatesHook.previewProgress.total}` : "Searching...") : "Preview"}</button>
									{Object.keys(candidatesHook.beatCandidates).length > 0 && (
										<button onClick={candidatesHook.handleDownloadAllSelected} disabled={candidatesHook.previewingAll || candidatesHook.downloadingAll || Object.keys(assetsHook.assets).length >= scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image").length} className={`h-7 px-3 rounded-md text-[11px] font-medium transition-colors ${candidatesHook.previewingAll || candidatesHook.downloadingAll ? "bg-zinc-800 text-zinc-600 cursor-wait" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}`}>{candidatesHook.downloadingAll ? "Downloading..." : "Download"}</button>
									)}
									<button onClick={assetsHook.handleCheckAllAssets} disabled={assetsHook.checkingAssets} className={`h-7 px-3 rounded-md text-[11px] font-medium transition-colors ${assetsHook.checkingAssets ? "bg-zinc-800 text-zinc-600 cursor-wait" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}`}>{assetsHook.checkingAssets ? "Checking..." : "Check"}</button>
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
										className="h-7 px-3 rounded-md text-[11px] font-medium bg-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
									>Clean</button>
									<button
										onClick={async () => {
											if (!currentProjectId) return;
											setPrerenderConverting(true);
											try {
												const result = await window.api.prerenderExistingImages(currentProjectId);
												setPrerenderConverting(false);
												if (result.converted === 0) {
													setConfirm({
														title: "All Images Already Have MP4s",
														message: "All images already have Ken Burns MP4 prerenders.",
														confirmLabel: "Reconvert All",
														onConfirm: () => {
															setConfirm({
																title: "⚠️ Are You Sure?",
																message: "This will DELETE all existing prerenders and re-render every image from scratch. This cannot be undone.",
																confirmLabel: "Yes, Reconvert",
																onConfirm: async () => {
																	setConfirm(null);
																	if (!currentProjectId) return;
																	setPrerenderConverting(true);
																	try {
																		const result2 = await window.api.prerenderExistingImages(currentProjectId, true);
																		setPrerenderConverting(false);
																		setConfirm({ title: `Reconverted ${result2.converted} Images`, message: "All images have been re-rendered with the latest Ken Burns settings.", confirmLabel: "OK", onConfirm: () => setConfirm(null) });
																	} catch (err: any) {
																		setPrerenderConverting(false);
																		setError({ title: "Reconversion Failed", message: err.message });
																	}
																}
															});
														}
													});
													return;
												}
												setConfirm({ title: `Converted ${result.converted} Images`, message: "Images have been pre-rendered to MP4. Future renders will skip Phase 0 for these images.", confirmLabel: "OK", onConfirm: () => setConfirm(null) });
											} catch (err: any) {
												setPrerenderConverting(false);
												setError({ title: "Conversion Failed", message: err.message });
											}
										}}
										disabled={prerenderConverting}
										className={`h-7 px-3 rounded-md text-[11px] font-medium transition-colors ${prerenderConverting ? "bg-zinc-800 text-zinc-600 cursor-wait" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400"}`}
									>{prerenderConverting ? "Converting..." : "MP4"}</button>
								<button
									onClick={() => setShowOverlayEditor(true)}
									className="h-7 px-3 rounded-md text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
								>Overlays</button>
								<button
									onClick={() => setConfirm({ title: "New Scene Plan?", message: "This will create a new scene plan from scratch. All assets for the current beats will be deleted and need to be re-downloaded.", confirmLabel: "New Plan", onConfirm: () => { setConfirm(null); pipeline.handleRegenerate(sectionPlan ?? undefined); } })}
									disabled={regenerating}
									className={`ml-auto h-7 px-3 rounded-md text-[11px] font-medium transition-colors ${regenerating ? "bg-zinc-800 text-zinc-600 cursor-wait" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400"}`}
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
								{candidatesHook.previewingAll && candidatesHook.previewSectionProgress && candidatesHook.previewSectionProgress.length > 0 && (
									<div className="flex flex-wrap items-center gap-1.5 px-1 py-1">
										{candidatesHook.previewSectionProgress.map((s: any, i: number) => (
											<span key={i} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${s.done === s.total ? "text-emerald-300 bg-emerald-950/40" : "text-amber-300 bg-amber-950/40"}`}>
												{s.label} {s.done}/{s.total}{s.done < s.total ? "…" : " ✓"}
											</span>
										))}
									</div>
								)}
								{sectionPlan && (
									<SectionSummary sectionPlan={sectionPlan} beats={scenePlan.beats} assets={assetsHook.assets} onSelectBeat={setSelectedBeatId} onRepreviewSection={candidatesHook.handlePreviewSection} repreviewingSectionId={candidatesHook.repreviewingSectionId} />
								)}
								<BeatTimeline beats={scenePlan.beats} selectedBeatId={selectedBeatId} onSelectBeat={setSelectedBeatId} assets={assetsHook.assets} thumbnails={assetsHook.thumbnails} beatStatuses={assetsHook.beatStatuses} assetValidation={assetsHook.assetValidation} subscribeHintBeatIds={assetsHook.subscribeHintBeatIds} beatCandidates={candidatesHook.beatCandidates} selectedCandidateIndex={candidatesHook.selectedCandidateIndex} imageHashes={candidatesHook.imageHashes} filterMode={beatFilter} onFilterChange={setBeatFilter} prerenderProgress={prerenderProgress} sectionPlan={sectionPlan} onRepreviewSection={candidatesHook.handlePreviewSection} repreviewingSectionId={candidatesHook.repreviewingSectionId} onEditSection={handleEditSectionLabel} />
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
										rateLimits={candidatesHook.rateLimits}
										allBeatCandidates={candidatesHook.beatCandidates}
										allSelectedIndex={candidatesHook.selectedCandidateIndex}
										sectionPlan={sectionPlan}
										onResetToSection={handleResetBeatToSection}
										onRepreviewSection={candidatesHook.handlePreviewSection}
										repreviewingSectionId={candidatesHook.repreviewingSectionId}
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
											{renderSizes && <div className="text-zinc-500 text-xs mt-0.5">{formatBytes(renderSizes.h264Bytes)} → {formatBytes(renderSizes.finalBytes)}</div>}
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

			{showOverlayEditor && scenePlan && (
				<OverlayEditor
					scenePlan={scenePlan}
					sectionPlan={sectionPlan}
					projectId={currentProjectId ?? ""}
					beatTextSegments={assetsHook.beatTextSegments}
						onComplete={async () => {
							setShowOverlayEditor(false);
							if (!currentProjectId) return;
							try {
								const ov = await window.api.loadOverlayOverrides(currentProjectId);
								if (ov && scenePlan) {
									const copy = JSON.parse(JSON.stringify(scenePlan));
									// Clear ALL overlay types managed by the Overlay Editor
									// (callouts, banners, ctas) so deleted overlays don't linger.
									for (const beat of copy.beats) {
										if (beat.overlay && (
											beat.overlay.type === "number_callout" ||
											beat.overlay.type === "item_banner" ||
											beat.overlay.type === "subscribe_cta"
										)) {
											delete beat.overlay;
										}
									}
									// Re-apply only what's in the saved overrides
									for (const ovItem of (ov.callouts || [])) {
										const beat = copy.beats.find((b: any) => b.id === ovItem.beatId);
										if (beat && ovItem.enabled !== false) {
											beat.overlay = { type: "number_callout", showAt: ovItem.showAt ?? 0, hideAt: 1.0, number: ovItem.number ?? parseInt(ovItem.label?.replace("#", "") || "0") };
										}
									}
									for (const ovItem of (ov.banners || [])) {
										const beat = copy.beats.find((b: any) => b.id === ovItem.beatId);
										if (beat && ovItem.enabled !== false) {
											beat.overlay = { type: "item_banner", showAt: ovItem.showAt ?? 0, hideAt: 1.0, number: parseInt(ovItem.label?.match(/#(\d+)/)?.[1] || "0"), label: ovItem.label };
										}
									}
									for (const ovItem of (ov.ctas || [])) {
										const beat = copy.beats.find((b: any) => b.id === ovItem.beatId);
										if (beat && ovItem.enabled !== false) {
											beat.overlay = { type: "subscribe_cta", showAt: ovItem.showAt ?? 0, hideAt: 1.0 };
										}
									}
									setScenePlan(copy);
								}
							} catch (err) {
								console.error("Failed to apply overlay overrides:", err);
							}
						}}
					onBack={() => setShowOverlayEditor(false)}
				/>
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

			{generatingSections && (
				<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40">
					<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4">
						<div className="text-zinc-300 text-sm font-medium mb-3 flex items-center gap-2">
							<div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
							Generating section plan...
						</div>
						<div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-3">
							<div className="h-full w-1/3 bg-gradient-to-r from-amber-500 to-amber-400 rounded-full animate-pulse" style={{ animation: "slide 1.2s ease-in-out infinite" }} />
						</div>
						<style>{`@keyframes slide { 0% { transform: translateX(-100%); } 50% { transform: translateX(150%); } 100% { transform: translateX(300%); } }`}</style>
						{sectionLog && <p className="text-xs text-zinc-500 truncate">{sectionLog}</p>}
					</div>
				</div>
			)}

			{confirm && <ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} inputLabel={confirm.inputLabel} inputValue={projectName} onInputChange={setProjectName} isListicle={isListicle} onListicleChange={setIsListicle} showListicle={confirm.showListicle} />}

			{showSectionModal && sectionPlan && (
				<SectionPlanModal
					key={sectionPlan.sections.length + "-" + (sectionPlan.sections[0]?.id ?? "")}
					sections={sectionPlan.sections}
					onGenerate={(sections) => {
						setShowSectionModal(false);
						const updatedPlan = { ...sectionPlan, sections };
						setSectionPlan(updatedPlan);
						pipeline.doPreview(projectName.trim() || undefined, updatedPlan);
					}}
					onCancel={(sections) => {
						setShowSectionModal(false);
						const updatedPlan = { ...sectionPlan, sections };
						setSectionPlan(updatedPlan);
					}}
					onRescan={handleRescanSections}
					onRegenerateSection={handleRegenerateSection}
					settings={settings}
					onSaveSettings={handleSaveSectionTemplates}
				/>
			)}
		</div>
	);
}
