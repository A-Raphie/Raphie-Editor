import { useState, useCallback, useRef, useEffect } from "react";
import type { PipelineProgress, SavedProject } from "../../shared/types";

export interface BatchQueueItem {
	id: string;
	scriptPath: string;
	voPath: string;
	musicPath?: string;
	srtPath?: string;
	status: "pending" | "running" | "completed" | "failed";
	outputPath?: string;
	progress?: PipelineProgress | null;
	errorMessage?: string;
}

interface UseBatchQueueDeps {
	activePipelineProjectIdRef: React.MutableRefObject<string | null>;
	setView: (v: string) => void;
	setLogs: (v: string[]) => void;
	setError: (v: { title: string; message: string; actionLabel?: string; onAction?: () => void } | null) => void;
	setRenderingError: (v: string | null) => void;
}

export function useBatchQueue(deps: UseBatchQueueDeps) {
	const { activePipelineProjectIdRef, setView, setLogs, setError, setRenderingError } = deps;
	const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
	const [batchCurrentIndex, setBatchCurrentIndex] = useState(-1);

	// Live ref so the running loop reads current state (add/remove mid-run safe).
	const batchQueueRef = useRef<BatchQueueItem[]>([]);
	useEffect(() => { batchQueueRef.current = batchQueue; }, [batchQueue]);

	// Stop flag — checked at the top of each loop iteration.
	const stopRequestedRef = useRef(false);
	// Guards against re-entrancy.
	const runningRef = useRef(false);

	const addToQueue = useCallback((project: SavedProject): boolean => {
		// Require a scene plan — sourceAllAssets throws "No scene plan found" without one.
		if (!project.scenePlan?.beats?.length) return false;
		setBatchQueue((q) => {
			if (q.some((it) => it.id === project.id)) return q; // dedupe by project id
			return [...q, { id: project.id, scriptPath: project.scriptPath ?? "", voPath: project.voPath, musicPath: project.musicPath, srtPath: project.srtPath, status: "pending" }];
		});
		return true;
	}, []);

	const removeFromQueue = useCallback((idx: number) => {
		setBatchQueue((q) => q.filter((_, i) => i !== idx));
	}, []);

	const updateItemById = useCallback((id: string, patch: Partial<BatchQueueItem>) => {
		setBatchQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
	}, []);

	// Start (or resume from a given item id) the batch queue. Items added after
	// the run begins are NOT processed this run — they wait for the next Start.
	const handleStartBatchQueue = useCallback(async (startFromId?: string) => {
		if (runningRef.current) return;
		const queue = batchQueueRef.current;
		if (queue.length === 0) return;

		// Snapshot the ordered list of IDs to process this run.
		const startIndex = startFromId
			? Math.max(0, queue.findIndex((it) => it.id === startFromId))
			: 0;
		const planIds = queue.slice(startIndex)
			.filter((it) => it.status !== "completed")
			.map((it) => it.id);
		if (planIds.length === 0) return;

		runningRef.current = true;
		stopRequestedRef.current = false;
		setView("queue");

		try {
			for (const id of planIds) {
				if (stopRequestedRef.current) break;
				// Read live state so removals/mutations between iterations are respected.
				const live = batchQueueRef.current.find((it) => it.id === id);
				if (!live || live.status === "completed") continue;

				activePipelineProjectIdRef.current = live.id;
				const liveIdx = batchQueueRef.current.findIndex((it) => it.id === id);
				setBatchCurrentIndex(liveIdx);
				setBatchQueue((q) => q.map((it, idx) => idx === liveIdx ? { ...it, status: "running", progress: null, errorMessage: undefined } : it));
				setLogs([]);
				setError(null);
				setRenderingError(null);

				try {
					// Source (Preview + Download) all beats for this project. Fully
					// self-contained on the main side — reads the project's scenePlan
					// from disk and writes assets to its own dirs. Setting
					// activePipelineProjectIdRef above ensures the open project's UI
					// doesn't receive this project's BEAT_STATUS/log events.
					await window.api.sourceAllAssets(live.id);
					if (stopRequestedRef.current) {
						// Stopped mid-item: mark back to pending so it's re-runnable.
						updateItemById(id, { status: "pending", progress: null });
					} else {
						updateItemById(id, { status: "completed", progress: null });
					}
				} catch (err: any) {
					if (stopRequestedRef.current) {
						updateItemById(id, { status: "pending", progress: null });
					} else {
						updateItemById(id, { status: "failed", errorMessage: err?.message || String(err), progress: null });
					}
				}
			}
		} finally {
			setBatchCurrentIndex(-1);
			activePipelineProjectIdRef.current = null;
			runningRef.current = false;
			stopRequestedRef.current = false;
		}
	}, [activePipelineProjectIdRef, setView, setLogs, setError, setRenderingError, updateItemById]);

	// Stop the running queue: cancel the in-flight pipeline AND halt the loop.
	const handleStopBatchQueue = useCallback(() => {
		stopRequestedRef.current = true;
		window.api.cancelPipeline().catch(() => {});
	}, []);

	return {
		batchQueue, setBatchQueue, batchCurrentIndex,
		addToQueue, removeFromQueue,
		handleStartBatchQueue, handleStopBatchQueue,
	};
}
