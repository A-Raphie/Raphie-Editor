import { useState, useCallback, useEffect } from "react";

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

interface UseAssetsDeps {
	currentProjectId: string | null;
	currentProjectIdRef: React.MutableRefObject<string | null>;
	scenePlan: any;
	scriptPath: string | null;
	voPath: string | null;
	srtPath: string | null;
	autoSaveProjectRef: React.MutableRefObject<(status: string, extra?: any) => Promise<void>>;
	setScenePlan: (v: any) => void;
	setError: (v: { title: string; message: string } | null) => void;
}

export function useAssets(deps: UseAssetsDeps) {
	const {
		currentProjectId, currentProjectIdRef, scenePlan, scriptPath, voPath, srtPath,
		autoSaveProjectRef, setScenePlan, setError,
	} = deps;

	const [assets, setAssets] = useState<Record<string, string>>({});
	const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
	const [reDownloadingBeat, setReDownloadingBeat] = useState<string | null>(null);
	const [downloadingBeats, setDownloadingBeats] = useState<string[]>([]);
	const [beatStatuses, setBeatStatuses] = useState<Record<string, BeatStatus>>({});
	const [assetValidation, setAssetValidation] = useState<Record<string, AssetValidation>>({});
	const [checkingAssets, setCheckingAssets] = useState(false);
	const [beatTextSegments, setBeatTextSegments] = useState<Record<string, string>>({});
	const [subscribeHintBeatIds, setSubscribeHintBeatIds] = useState<Set<string>>(new Set());

	useEffect(() => {
		const entries = Object.entries(assets);
		if (entries.length === 0) return;
		let cancelled = false;
		const pid = currentProjectId;
		const loadThumbs = async () => {
			const toLoad = entries.filter(([beatId]) => !thumbnails[beatId]);
			if (toLoad.length === 0) return;
			const batchSize = 10;
			for (let i = 0; i < toLoad.length; i += batchSize) {
				if (cancelled) break;
				const batch = toLoad.slice(i, i + batchSize);
				const results = await Promise.allSettled(batch.map(async ([beatId, assetPath]) => {
					const thumb = await window.api.getBeatThumbnail(beatId, assetPath, pid ?? undefined);
					return thumb ? [beatId, thumb] as const : null;
				}));
				const newThumbs: Record<string, string> = {};
				for (const r of results) {
					if (r.status === "fulfilled" && r.value) {
						newThumbs[r.value[0]] = r.value[1];
					}
				}
				if (!cancelled && Object.keys(newThumbs).length > 0) {
					setThumbnails((prev) => ({ ...prev, ...newThumbs }));
				}
			}
		};
		loadThumbs();
		return () => { cancelled = true; };
	}, [assets, currentProjectId, Object.keys(thumbnails).length]);

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
				setScenePlan((prev: any) => {
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
		setScenePlan((prev: any) => {
			if (!prev) return prev;
			const updated = { ...prev, beats: prev.beats.map((b: any) => b.id === beatId ? { ...b, searchQuery: newQuery } : b) };
			autoSaveProjectRef.current("editing", { scenePlan: updated });
			if (currentProjectId) window.api.saveScenePlan(currentProjectId, updated).catch(console.error);
			return updated;
		});
	}, [currentProjectId]);

	const handleToggleOverlay = useCallback((beatId: string) => {
		setScenePlan((prev: any) => {
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

	return {
		assets, setAssets, thumbnails, setThumbnails,
		reDownloadingBeat, setReDownloadingBeat,
		downloadingBeats, setDownloadingBeats,
		beatStatuses, setBeatStatuses,
		assetValidation, setAssetValidation,
		checkingAssets, setCheckingAssets,
		beatTextSegments, setBeatTextSegments,
		subscribeHintBeatIds, setSubscribeHintBeatIds,
		handleReDownloadBeat, handleSaveSearch, handleToggleOverlay,
		handleCheckAllAssets, handleCleanAssets,
	};
}
