import { useState, useCallback, useEffect, useRef } from "react";

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
	setBeatCandidates: (v: Record<string, any[]> | ((prev: Record<string, any[]>) => Record<string, any[]>)) => void;
	setSelectedCandidateIndex: (v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
}

export function useAssets(deps: UseAssetsDeps) {
	const {
		currentProjectId, currentProjectIdRef, scenePlan, scriptPath, voPath, srtPath,
		autoSaveProjectRef, setScenePlan, setError, setBeatCandidates, setSelectedCandidateIndex,
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
	const dismissedCtaRef = useRef<Set<string>>(new Set());
	const hasAutoAppliedCtaRef = useRef(false);

	const planKey = `${scenePlan?.title}-${scenePlan?.beats?.length}`;
	useEffect(() => { dismissedCtaRef.current = new Set(); hasAutoAppliedCtaRef.current = false; }, [planKey]);

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
		if (!scenePlan || subscribeHintBeatIds.size === 0) return;
		// Only auto-apply CTAs once per plan load. After that, overlays come
		// only from the Overlay Editor's saved overrides — this prevents
		// re-adding CTAs that the user intentionally moved or deleted.
		if (hasAutoAppliedCtaRef.current) return;
		const toApply = scenePlan.beats.filter((b: any) =>
			(b.type === "clip" || b.type === "image") && subscribeHintBeatIds.has(b.id) && !b.overlay && !dismissedCtaRef.current.has(b.id)
		);
		if (toApply.length === 0) return;
		hasAutoAppliedCtaRef.current = true;
		setScenePlan((prev: any) => {
			if (!prev) return prev;
			let changed = false;
			const updated = {
				...prev,
				beats: prev.beats.map((b: any) => {
					if ((b.type === "clip" || b.type === "image") && subscribeHintBeatIds.has(b.id) && !b.overlay && !dismissedCtaRef.current.has(b.id)) {
						changed = true;
						return { ...b, overlay: { type: "subscribe_cta", showAt: 0, hideAt: 1 } };
					}
					return b;
				}),
			};
			if (!changed) return prev;
			autoSaveProjectRef.current("editing", { scenePlan: updated });
			if (currentProjectId) window.api.saveScenePlan(currentProjectId, updated).catch(console.error);
			return updated;
		});
	}, [scenePlan, subscribeHintBeatIds, currentProjectId]);

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
		const beatType = scenePlan?.beats.find((b: any) => b.id === beatId)?.type ?? "clip";
		setDownloadingBeats((prev) => [...prev, beatId]);
		try {
			// Auto-retry: the backend search can return {path: null} when
			// rate-limited or temporarily empty. Retry up to 3 times with
			// backoff so a single Replace click usually succeeds.
			let result: any = null;
			for (let attempt = 0; attempt < 3; attempt++) {
				result = await window.api.reDownloadBeat(beatId, newQuery, beatType, pid);
				if (currentProjectIdRef.current !== pid) return;
				if (result?.path) break;
				if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
			}
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
			} else {
				const detail = result?.errorDetails || result?.error || "No stock assets found for this query.";
				setError({ title: "Replace Failed", message: detail });
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
		setBeatCandidates((prev) => { const next = { ...prev }; delete next[beatId]; return next; });
		setSelectedCandidateIndex((prev) => { const next = { ...prev }; delete next[beatId]; return next; });
	}, [currentProjectId, setBeatCandidates, setSelectedCandidateIndex]);

	const handleToggleOverlay = useCallback((beatId: string) => {
		setScenePlan((prev: any) => {
			if (!prev) return prev;
			const beat = prev.beats.find((b: any) => b.id === beatId);
			if (beat?.overlay) {
				dismissedCtaRef.current.add(beatId);
			} else {
				dismissedCtaRef.current.delete(beatId);
			}
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
			const staleIds = Object.entries(results).filter(([, v]) => !v.valid).map(([id]) => id);
			if (staleIds.length > 0) {
				setAssets((prev) => {
					const next = { ...prev };
					for (const id of staleIds) delete next[id];
					return next;
				});
				setThumbnails((prev) => {
					const next = { ...prev };
					for (const id of staleIds) delete next[id];
					return next;
				});
			}
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
