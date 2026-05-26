import { useState, useCallback, useEffect, useRef } from "react";
import type { SavedProject } from "../../shared/types";

interface UseProjectsDeps {
	activePipelineProjectIdRef: React.MutableRefObject<string | null>;
	pendingPlanProjectIdRef: React.MutableRefObject<string | null>;
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
}

export function useProjects(deps: UseProjectsDeps) {
	const {
		activePipelineProjectIdRef, pendingPlanProjectIdRef,
		scriptPath, srtPath, voPath, musicPath, scenePlan, assets, beatCandidates, selectedCandidateIndex,
		setScriptPath, setSrtPath, setVoPath, setMusicPath, setScenePlan, setAssets, setThumbnails,
		setBeatStatuses, setAssetValidation, setDownloadingBeats, setBeatCandidates, setSelectedCandidateIndex,
		setBeatTextSegments, setScriptLength, setSelectedBeatId, setSubscribeHintBeatIds,
		setReDownloadingBeat, setCheckingAssets, setPreviewingAll, setDownloadingCandidateBeat,
		setView, setError, setProgress, setLogs, setRenderingError, setRegenerating, setOutputPath,
		setPipelineStateInfo, setConfirm,
	} = deps;

	const [projects, setProjects] = useState<SavedProject[]>([]);
	const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
	const currentProjectIdRef = useRef<string | null>(null);

	useEffect(() => {
		window.api.listProjects().then(setProjects);
	}, []);

	const refreshProjects = useCallback(async () => {
		setProjects(await window.api.listProjects());
	}, []);

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

	return {
		projects, setProjects, currentProjectId, setCurrentProjectId, currentProjectIdRef,
		refreshProjects, autoSaveProject, handleOpenProject, handleNewProject,
		handleRenameProject, handleDeleteProject,
	};
}
