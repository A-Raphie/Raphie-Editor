import React, { useRef, useEffect } from "react";

interface PlanningViewProps {
	scriptName: string | null;
	logs: string[];
	error: string | null;
	onRetry: () => void;
}

export default function PlanningView({ scriptName, logs, error, onRetry }: PlanningViewProps) {
	const logsEndRef = useRef<HTMLDivElement>(null);
	const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
	const isRetrying = lastLog?.includes("retrying") ?? false;
	const recentLogs = logs.slice(-20);

	useEffect(() => {
		logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [logs.length]);

	if (error) {
		return (
			<div className="flex-1 flex items-center justify-center p-12">
				<div className="w-full max-w-lg text-center">
					<div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto mb-5">
						<span className="text-3xl">⚠️</span>
					</div>
					<h2 className="text-xl font-bold text-zinc-100 mb-2">Preview Failed</h2>
					<p className="text-zinc-400 text-sm mb-8 max-w-md mx-auto leading-relaxed">{error}</p>
					<button className="px-8 py-3 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 rounded-xl text-sm font-semibold text-zinc-900 shadow-lg hover:shadow-xl transition-all" onClick={onRetry}>Try Again</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="flex-shrink-0 flex items-center justify-center pt-12 pb-6 px-8">
				<div className="max-w-lg w-full text-center">
					<div className="w-20 h-20 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-6">
						<span className="text-4xl">🎬</span>
					</div>
					<h2 className="text-xl font-bold text-zinc-100 mb-2">Generating Scene Plan</h2>
					{scriptName && <p className="text-zinc-500 text-sm mb-8 font-medium">{scriptName}</p>}
					<div className="h-2 bg-zinc-800 rounded-full overflow-hidden mb-5 shadow-inner">
						<div
							className={`h-full rounded-full transition-all duration-1000 ${isRetrying ? "bg-gradient-to-r from-yellow-600 to-yellow-400" : "bg-gradient-to-r from-amber-500 to-cyan-400 animate-pulse"}`}
							style={{ width: isRetrying ? "40%" : "60%" }}
						/>
					</div>
					{lastLog && <p className={`text-xs font-mono ${isRetrying ? "text-yellow-400" : "text-zinc-400"}`}>{lastLog}</p>}
					{!lastLog && <p className="text-zinc-600 text-xs">This may take 30-60 seconds depending on script length</p>}
				</div>
			</div>
			{recentLogs.length > 1 && (
				<div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8">
					<div className="max-w-lg mx-auto bg-zinc-900/80 border border-zinc-800 rounded-lg p-3">
						{recentLogs.map((line, i) => (
							<div key={i} className={`text-[11px] font-mono leading-relaxed truncate ${line.includes("WARNING") || line.includes("⚠") ? "text-yellow-500" : line.includes("ERROR") ? "text-red-400" : "text-zinc-500"}`}>{line}</div>
						))}
						<div ref={logsEndRef} />
					</div>
				</div>
			)}
		</div>
	);
}
