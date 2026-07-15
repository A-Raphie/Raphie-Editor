import { useState, useCallback, useEffect } from "react";
import type { SavedProject } from "../../shared/types";
import { fmtElapsed } from "./usePipeline";

interface UseProjectsDeps {
	activePipelineProjectIdRef: React.MutableRefObject<string | null>;
	pendingPlanProjectIdRef: React.MutableRefObject<string | null>;
	currentProjectId: string | null;
	setCurrentProjectId: (v: string | null) => void;
	scriptPath: string | null;
	srtPath: string | null;
	voPath: string | null;
	musicPath: string | null;
	scenePlan: any;
	assets: Record<string, string>;
	beatCandidates: Record<string, any[]>;
	selectedCandidateIndex: Record<string, number>;
	setScriptPath: (v: string | null) => void;
	setSrtPath: (v: string | null) => void;
	setVoPath: (v: string | null) => void;
	setMusicPath: (v: string | null) => void;
	setScenePlan: (v: any) => void;
	setAssets: (v: Record<string, string>) => void;
	setThumbnails: (v: Record<string, string>) => void;
	setBeatStatuses: (v: Record<string, any>) => void;
	setAssetValidation: (v: Record<string, any>) => void;
	setDownloadingBeats: (v: string[]) => void;
	setBeatCandidates: (v: Record<string, any[]>) => void;
	setSelectedCandidateIndex: (v: Record<string, number>) => void;
	setBeatTextSegments: (v: Record<string, string>) => void;
	setScriptLength: (v: number) => void;
	setSelectedBeatId: (v: string | null) => void;
	setSubscribeHintBeatIds: (v: Set<string>) => void;
	setReDownloadingBeat: (v: string | null) => void;
	setCheckingAssets: (v: boolean) => void;
	setPreviewingAll: (v: boolean) => void;
	setDownloadingCandidateBeat: (v: string | null) => void;
	setView: (v: string) => void;
	setError: (v: any) => void;
	setProgress: (v: any) => void;
	setLogs: (v: string[]) => void;
	setRenderingError: (v: string | null) => void;
	setRegenerating: (v: boolean) => void;
	setOutputPath: (v: string | null) => void;
	setPipelineStateInfo: (v: any) => void;
	setConfirm: (v: any) => void;
	setRenderStartTime: (v: number | null) => void;
	setRenderElapsed: (v: string) => void;
	setRenderSizes: (v: { h264Bytes: number; finalBytes: number } | null) => void;
	setProjectName: (v: string) => void;
	setSectionPlan: (v: any) => void;
	setIsListicle: (v: boolean) => void;
}

export function useProjects(deps: UseProjectsDeps) {
	const {
		activePipelineProjectIdRef, pendingPlanProjectIdRef,
		currentProjectId, setCurrentProjectId,
		scriptPath, srtPath, voPath, musicPath, scenePlan, assets, beatCandidates, selectedCandidateIndex,
		setScriptPath, setSrtPath, setVoPath, setMusicPath, setScenePlan, setAssets, setThumbnails,
		setBeatStatuses, setAssetValidation, setDownloadingBeats, setBeatCandidates, setSelectedCandidateIndex,
		setBeatTextSegments, setScriptLength, setSelectedBeatId, setSubscribeHintBeatIds,
		setReDownloadingBeat, setCheckingAssets, setPreviewingAll, setDownloadingCandidateBeat,
		setView, setError, setProgress, setLogs, setRenderingError, setRegenerating, setOutputPath,
		setPipelineStateInfo, setConfirm, setRenderStartTime, setRenderElapsed, setRenderSizes, setProjectName,
		setSectionPlan, setIsListicle,
	} = deps;

	const [projects, setProjects] = useState<SavedProject[]>([]);
	const [openedNonce, setOpenedNonce] = useState(0);

	useEffect(() => {
		window.api.listProjects().then(setProjects);
	}, []);

	const refreshProjects = useCallback(async () => {
		setProjects(await window.api.listProjects());
	}, []);

	const autoSaveProject = useCallback(async (status: string, extra?: any) => {
		if (!scriptPath && !srtPath || !voPath) return;
		const data: any = {
			...(currentProjectId ? { id: currentProjectId } : {}),
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
		if (extra?.name) {
			data.name = extra.name;
		} else if (!currentProjectId) {
			data.name = srtPath?.split("/").pop()?.replace(/\.[^.]+$/, "") || scriptPath?.split("/").pop()?.replace(/\.[^.]+$/, "") || "Untitled Project";
		}
		const saved = await window.api.saveProject(data);
		if (!currentProjectId) setCurrentProjectId(saved.id);
		refreshProjects();
		return saved;
	}, [scriptPath, srtPath, voPath, musicPath, scenePlan, currentProjectId, beatCandidates, selectedCandidateIndex, assets, refreshProjects]);

	const handleOpenProject = useCallback(async (project: SavedProject) => {
		activePipelineProjectIdRef.current = null;
		const fresh = await window.api.getProject(project.id);
		const p = fresh ?? project;
		setScriptPath(p.scriptPath ?? null);
		setVoPath(p.voPath);
		setMusicPath(p.musicPath ?? null);
		setSrtPath(p.srtPath ?? null);
		setScenePlan(p.scenePlan ?? null);
		setCurrentProjectId(p.id);
		setProjectName(p.name || "");
		setError(null);
		setProgress(null);
		setLogs([]);
		setRenderingError(null);
		setRegenerating(false);
		setOutputPath(p.outputPath ?? null);
		setAssets({});
		setThumbnails({});
		setBeatStatuses({});
		setAssetValidation({});
		setDownloadingBeats([]);
		setBeatCandidates(p.beatCandidates ?? {});
		setSelectedCandidateIndex(p.selectedCandidateIndex ?? {});
		setBeatTextSegments({});
		setScriptLength(0);
		setSelectedBeatId(null);
		setSubscribeHintBeatIds(new Set());
		setReDownloadingBeat(null);
		setCheckingAssets(false);
		setSectionPlan(p.sectionPlan ? { ...p.sectionPlan, projectId: p.id } : null);
		setIsListicle(p.isListicle ?? true);
		setPreviewingAll(false);
		setDownloadingCandidateBeat(null);
		pendingPlanProjectIdRef.current = null;
		let stateInfo = null;
		if (p.id) try { stateInfo = await window.api.getPipelineState(p.id, p.scriptPath ?? "", p.voPath, p.srtPath); } catch {}
		setPipelineStateInfo(stateInfo);
		if (p.status === "complete" && (stateInfo as any)?.renderSegments?.elapsedMs) {
			setRenderElapsed(fmtElapsed((stateInfo as any).renderSegments.elapsedMs));
			setRenderStartTime(Date.now() - (stateInfo as any).renderSegments.elapsedMs);
		} else {
			setRenderElapsed("");
			setRenderStartTime(null);
		}
		if (p.status === "complete" && (stateInfo as any)?.renderSegments?.renderSizes) {
			setRenderSizes((stateInfo as any).renderSegments.renderSizes);
		} else {
			setRenderSizes(null);
		}
		let loadedAssets = stateInfo?.assets ?? p.assets ?? {};
		if (p.scenePlan && Object.keys(loadedAssets).length === 0 && p.id) {
			try {
				const recovered = await window.api.recoverAssets(p.scenePlan.beats, p.id);
				if (Object.keys(recovered).length > 0) loadedAssets = recovered;
			} catch {}
		}
		setAssets(loadedAssets);
		if (p.status === "complete" && p.outputPath) setView("complete");
		else if (p.scenePlan) setView("editor");
		else setView("input");
		setOpenedNonce((n) => n + 1);
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
		setSectionPlan(null);
		setIsListicle(true);
		setBeatTextSegments({});
		setSelectedBeatId(null);
		setSubscribeHintBeatIds(new Set());
		pendingPlanProjectIdRef.current = null;
		setOpenedNonce((n) => n + 1);
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

	return {
		projects, setProjects, refreshProjects, autoSaveProject,
		handleOpenProject, handleNewProject, handleRenameProject, handleDeleteProject,
		openedNonce,
	};
}
