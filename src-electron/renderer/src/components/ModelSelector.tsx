import React from "react";
import type { AppSettings } from "../../../shared/types";
import { PLANNER_MODELS, CHECKER_MODELS } from "../../../shared/types";

interface ModelSelectorProps {
	settings: AppSettings;
	onChange: (settings: AppSettings) => void;
}

export default function ModelSelector({ settings, onChange }: ModelSelectorProps) {
	return (
		<div className="flex items-center gap-4 pt-4">
			<span className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">Models</span>
			<div className="flex items-center gap-2">
				<label className="text-[10px] text-zinc-600">Planner</label>
				<select
					value={settings.scenePlannerModel}
					onChange={(e) => onChange({ ...settings, scenePlannerModel: e.target.value })}
					className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
				>
					{PLANNER_MODELS.map((m) => (
						<option key={m.value} value={m.value}>
							{m.label} ({m.cost})
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
		</div>
	);
}
