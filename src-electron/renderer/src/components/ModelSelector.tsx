import React, { useEffect, useState } from "react";
import type { AppSettings } from "../../../shared/types";
import { PLANNER_MODELS, CHECKER_MODELS } from "../../../shared/types";

function uptimeColor(pct: number | null): string {
	if (pct === null) return "text-zinc-500";
	if (pct < 70) return "text-red-400";
	if (pct < 90) return "text-yellow-400";
	return "text-green-400";
}

interface ModelSelectorProps {
	settings: AppSettings;
	onChange: (settings: AppSettings) => void;
}

export default function ModelSelector({ settings, onChange }: ModelSelectorProps) {
	const [owlUptime, setOwlUptime] = useState<number | null>(null);

	useEffect(() => {
		if (typeof window !== "undefined" && window.api?.getModelUptime) {
			window.api.getModelUptime("openrouter/owl-alpha").then(setOwlUptime).catch(() => {});
		}
	}, []);

	const owlSelected = settings.scenePlannerModel === "openrouter/owl-alpha";
	const showWarning = owlSelected && owlUptime !== null && owlUptime < 70;

	return (
		<div className="flex items-center gap-4 pt-4">
			<span className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">Models</span>
			<div className="flex items-center gap-2">
				{showWarning && <span className="inline-block w-2 h-2 rounded-full bg-red-400 animate-pulse" title={`Owl Alpha uptime: ${owlUptime}%`} />}
				<label className="text-[10px] text-zinc-600">Planner</label>
				<select
					value={settings.scenePlannerModel}
					onChange={(e) => onChange({ ...settings, scenePlannerModel: e.target.value })}
					className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
				>
					{PLANNER_MODELS.map((m) => (
						<option key={m.value} value={m.value}>
							{m.label} ({m.cost}){m.value === "openrouter/owl-alpha" && owlUptime !== null ? ` \u2014 ${Math.round(owlUptime)}% uptime` : ""}
						</option>
					))}
				</select>
			</div>
			<div className="flex items-center gap-2">
				<label className="text-[10px] text-zinc-600">Checker</label>
				<select
					value={settings.qualityCheckerModel}
					onChange={(e) => onChange({ ...settings, qualityCheckerModel: e.target.value })}
					className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
				>
					{CHECKER_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label} ({m.cost})</option>)}
				</select>
			</div>
			{owlUptime !== null && (
				<span className={`text-[10px] ${uptimeColor(owlUptime)}`}>
					● {Math.round(owlUptime)}%
				</span>
			)}
		</div>
	);
}
