import { useState, useCallback } from "react";

interface UseBeatCandidatesDeps {
	currentProjectId: string | null;
	currentProjectIdRef: React.MutableRefObject<string | null>;
	scenePlan: any;
	settings: any;
	assets: Record<string, string>;
	setBeatStatuses: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
	setAssets: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
	setThumbnails: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
	setError: (v: { title: string; message: string } | null) => void;
	selectedCandidateIndex: Record<string, number>;
	beatCandidates: Record<string, any[]>;
}

export function useBeatCandidates(deps: UseBeatCandidatesDeps) {
	const {
		currentProjectId, currentProjectIdRef, scenePlan, settings, assets,
		setBeatStatuses, setAssets, setThumbnails, setError,
	} = deps;

	const [beatCandidates, setBeatCandidates] = useState<Record<string, any[]>>({});
	const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<Record<string, number>>({});
	const [previewingAll, setPreviewingAll] = useState(false);
	const [downloadingCandidateBeat, setDownloadingCandidateBeat] = useState<string | null>(null);

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

	return {
		beatCandidates, setBeatCandidates,
		selectedCandidateIndex, setSelectedCandidateIndex,
		previewingAll, setPreviewingAll,
		downloadingCandidateBeat, setDownloadingCandidateBeat,
		handleSearchBeat, handlePreviewAll, handleSelectCandidate,
		handleDownloadCandidate, handleDownloadAllSelected,
	};
}
