import { useState, useCallback } from "react";
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

	const addToQueue = useCallback((project: SavedProject) => {
		setBatchQueue((q) => [...q, { id: project.id, scriptPath: project.scriptPath ?? "", voPath: project.voPath, musicPath: project.musicPath, srtPath: project.srtPath, status: "pending" }]);
	}, []);

	const removeFromQueue = useCallback((idx: number) => {
		setBatchQueue((q) => q.filter((_, i) => i !== idx));
	}, []);

	const handleStartBatchQueue = useCallback(async (startIndex = 0) => {
		if (batchQueue.length === 0) return;
		setBatchCurrentIndex(startIndex);
		setView("rendering");
		for (let i = startIndex; i < batchQueue.length; i++) {
			if (batchQueue[i].status === "completed") continue;
			const item = batchQueue[i];
			activePipelineProjectIdRef.current = item.id;
			setBatchQueue((q) => q.map((it, idx) => idx === i ? { ...it, status: "running", progress: null, errorMessage: undefined } : it));
			setBatchCurrentIndex(i);
			setLogs([]);
			setError(null);
			setRenderingError(null);
			try {
				const output = await window.api.runPipeline({ scriptPath: item.scriptPath, voPath: item.voPath, musicPath: item.musicPath, srtPath: item.srtPath, projectId: item.id });
				setBatchQueue((q) => q.map((it, idx) => idx === i ? { ...it, status: "completed", outputPath: output, progress: null } : it));
			} catch (err: any) {
				setBatchQueue((q) => q.map((it, idx) => idx === i ? { ...it, status: "failed", errorMessage: err?.message || String(err), progress: null } : it));
			}
		}
		setBatchCurrentIndex(-1);
	}, [batchQueue, activePipelineProjectIdRef, setView, setLogs, setError, setRenderingError]);

	return { batchQueue, setBatchQueue, batchCurrentIndex, addToQueue, removeFromQueue, handleStartBatchQueue };
}
