import { useState } from "react";
import type { AppSettings, SectionPlanTemplate } from "../../../shared/types";

interface Section {
	id: string;
	type: string;
	label: string;
	startTime: number;
	endTime: number;
	searchContext: string;
	bannerText?: string;
	number?: number;
	inferred?: boolean;
	sourceSnippet?: string;
}

interface SectionPlanModalProps {
	sections: Section[];
	onGenerate: (sections: Section[]) => void;
	onCancel: (sections: Section[]) => void;
	onRescan?: () => void;
	onRegenerateSection?: (sectionId: string) => Promise<Section[] | null>;
	settings?: AppSettings | null;
	onSaveSettings?: (s: AppSettings) => void;
}

function fmtTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${String(s).padStart(2, "0")}`;
}

function parseTime(str: string): number {
	const parts = str.trim().split(":");
	if (parts.length === 2) {
		return parseInt(parts[0]) * 60 + parseInt(parts[1]);
	}
	return parseFloat(str) || 0;
}

function extractSuggestions(snippet: string): string[] {
	if (!snippet) return [];
	const words = snippet.split(/\s+/);
	const caps = words.filter(w => /^[A-Z][a-z]{2,}/.test(w) && w.length > 2);
	const unique = [...new Set(caps.map(w => w.toLowerCase()))];
	return unique.slice(0, 5);
}

// For inferred (gap-filled) rows with no snippet, suggest words pulled from
// the nearest detected neighbors' labels/snippets.
function extractInferredSuggestions(section: Section, allSections: Section[]): string[] {
	const idx = allSections.findIndex(s => s.id === section.id);
	if (idx < 0) return [];
	const neighbors: string[] = [];
	for (let d = 1; d <= 3; d++) {
		for (const j of [idx - d, idx + d]) {
			const n = allSections[j];
			if (n && !n.inferred) neighbors.push(n.label, n.sourceSnippet ?? "");
		}
	}
	const words = new Set<string>();
	for (const text of neighbors) {
		for (const w of extractSuggestions(text)) words.add(w);
	}
	return [...words].slice(0, 5);
}

export default function SectionPlanModal({ sections: initialSections, onGenerate, onCancel, onRescan, onRegenerateSection, settings, onSaveSettings }: SectionPlanModalProps) {
	const [sections, setSections] = useState<Section[]>(initialSections);
	const [savedFlash, setSavedFlash] = useState<string | null>(null);
	const [showBulkEdit, setShowBulkEdit] = useState(false);
	const [bulkText, setBulkText] = useState("");
	const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [showTemplateMenu, setShowTemplateMenu] = useState(false);
	const [templateName, setTemplateName] = useState("");

	const flashSaved = (id: string) => {
		setSavedFlash(id);
		setTimeout(() => setSavedFlash(null), 800);
	};

	const applyBulkEdit = () => {
		const lines = bulkText.split("\n").map(l => l.trim().replace(/^\d+[\.\):]\s*/, "")).filter(Boolean);
		if (lines.length === 0) { setShowBulkEdit(false); return; }
		let lineIdx = 0;
		setSections((prev) => prev.map((s) => {
			if (s.type !== "list") return s;
			if (lineIdx >= lines.length) return s;
			const ctx = lines[lineIdx].toLowerCase();
			lineIdx++;
			return { ...s, searchContext: ctx, label: lines[lineIdx - 1] };
		}));
		setShowBulkEdit(false);
		setBulkText("");
	};

	const [showBulkBanners, setShowBulkBanners] = useState(false);
	const [bulkBannerText, setBulkBannerText] = useState("");

	const titleCase = (s: string) => s.split(/\s+/).map(w => w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

	const applyBulkBanners = () => {
		const lines = bulkBannerText.split("\n").map(l => l.trim()).filter(Boolean);
		if (lines.length === 0) { setShowBulkBanners(false); return; }
		let lineIdx = 0;
		setSections((prev) => prev.map((s) => {
			if (s.type !== "list") return s;
			if (lineIdx >= lines.length) return s;
			const text = titleCase(lines[lineIdx]);
			lineIdx++;
			return { ...s, bannerText: text };
		}));
		setShowBulkBanners(false);
		setBulkBannerText("");
	};

	const updateSection = (id: string, field: keyof Section, value: any) => {
		setSections((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
		flashSaved(id);
	};

	const removeSection = (id: string) => {
		setSections((prev) => prev.filter((s) => s.id !== id));
	};

	const addSection = () => {
		const lastEnd = sections.length > 0 ? sections[sections.length - 1].endTime : 0;
		setSections((prev) => [
			...prev,
			{
				id: `section_${Date.now()}`,
				type: "list",
				label: "",
				startTime: lastEnd,
				endTime: lastEnd + 180,
				searchContext: "",
			},
		]);
	};

	const handleExport = async () => {
		const lines = sections.map((s) => {
			const label = s.type === "hook" ? "Hook" : s.type === "ending" ? "Ending" : `#${s.number ?? "?"} ${s.label}`.trim();
			const ctx = s.searchContext ? ` — ${s.searchContext}` : "";
			return `${label} [${fmtTime(s.startTime)}–${fmtTime(s.endTime)}]${ctx}`;
		}).join("\n");
		try {
			await navigator.clipboard.writeText(lines);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch { /* clipboard may be unavailable */ }
	};

	const handleRegenerate = async (sectionId: string) => {
		if (!onRegenerateSection) return;
		setRegeneratingId(sectionId);
		try {
			const freshSections = await onRegenerateSection(sectionId);
			if (freshSections) {
				const target = sections.find(s => s.id === sectionId);
				// Match by number/id against the fresh scan, merge just this one section.
				const match = target
					? freshSections.find(fs =>
						(target.number !== undefined && fs.number === target.number) || fs.id === target.id)
					: null;
				if (match && target) {
					setSections((prev) => prev.map(s => (s.id === sectionId
						? { ...s, label: match.label || s.label, searchContext: match.searchContext || s.searchContext, sourceSnippet: match.sourceSnippet ?? s.sourceSnippet, inferred: false }
						: s)));
				}
			}
		} finally {
			setRegeneratingId(null);
		}
	};

	const templates: SectionPlanTemplate[] = settings?.sectionTemplates ?? [];

	const saveTemplate = () => {
		const name = templateName.trim();
		if (!name || !onSaveSettings || !settings) return;
		const tpl: SectionPlanTemplate = {
			id: `tpl_${Date.now()}`,
			name,
			sections: sections
				.filter(s => s.type === "list")
				.map(s => ({ type: s.type, label: s.label, searchContext: s.searchContext, number: s.number })),
		};
		onSaveSettings({ ...settings, sectionTemplates: [...templates, tpl] });
		setTemplateName("");
		setShowTemplateMenu(false);
	};

	const loadTemplate = (tpl: SectionPlanTemplate) => {
		setSections((prev) => {
			const listIdxs = prev.map((s, i) => s.type === "list" ? i : -1).filter(i => i >= 0);
			return prev.map((s, i) => {
				if (s.type !== "list") return s;
				const localIdx = listIdxs.indexOf(i);
				const t = tpl.sections[localIdx];
				if (!t) return s;
				return { ...s, label: t.label || s.label, searchContext: t.searchContext ?? s.searchContext };
			});
		});
		setShowTemplateMenu(false);
	};

	const deleteTemplate = (id: string) => {
		if (!onSaveSettings || !settings) return;
		onSaveSettings({ ...settings, sectionTemplates: templates.filter(t => t.id !== id) });
	};

	const detectedCount = sections.filter(s => s.type === "list" && !s.inferred).length;
	const inferredCount = sections.filter(s => s.inferred).length;
	const listCount = sections.filter(s => s.type === "list").length;

	const duplicateContexts = new Set<string>();
	const contextMap: Record<string, number> = {};
	for (const s of sections) {
		if (!s.searchContext) continue;
		const key = s.searchContext.toLowerCase().trim();
		contextMap[key] = (contextMap[key] ?? 0) + 1;
		if (contextMap[key] > 1) duplicateContexts.add(key);
	}

	return (
		<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
			<div className="bg-zinc-900 rounded-xl border border-zinc-700 max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
				<div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
					<div>
						<h2 className="text-base font-semibold text-zinc-100">Section Plan</h2>
						<p className="text-xs text-zinc-500 mt-0.5">
							Edit timestamps and search context. Each beat will be constrained to its section's search context.
						</p>
					</div>
					<div className="flex items-center gap-2">
						{onRescan && (
							<button onClick={onRescan} className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">
								Rescan SRT
							</button>
						)}
						<button
							onClick={handleExport}
							className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
							title="Copy section plan to clipboard"
						>
							{copied ? <span className="text-emerald-400">✓ Copied</span> : "⧉ Export"}
						</button>
						<div className="relative">
							<button
								onClick={() => setShowTemplateMenu(!showTemplateMenu)}
								className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
							>
								☰ Templates
							</button>
							{showTemplateMenu && (
								<div className="absolute right-0 top-full mt-1 w-64 bg-zinc-800 border border-zinc-600 rounded-md shadow-xl z-10 p-2">
									{templates.length === 0 ? (
										<p className="text-[11px] text-zinc-500 px-1 py-1">No saved templates yet.</p>
									) : (
										templates.map(t => (
											<div key={t.id} className="flex items-center gap-1 group">
												<button onClick={() => loadTemplate(t)} className="flex-1 text-left text-xs px-2 py-1.5 rounded hover:bg-zinc-700 text-zinc-300">
													{t.name} <span className="text-zinc-600">({t.sections.length})</span>
												</button>
												<button onClick={() => deleteTemplate(t.id)} className="text-zinc-600 hover:text-red-400 text-xs px-1 opacity-0 group-hover:opacity-100">✕</button>
											</div>
										))
									)}
									<div className="border-t border-zinc-700 mt-1 pt-2">
										<p className="text-[10px] text-zinc-500 px-1 mb-1">Save current list items as template:</p>
										<div className="flex gap-1">
											<input
												type="text"
												value={templateName}
												onChange={(e) => setTemplateName(e.target.value)}
												onKeyDown={(e) => { if (e.key === "Enter") saveTemplate(); }}
												placeholder="Template name…"
												className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
											/>
											<button
												onClick={saveTemplate}
												disabled={!templateName.trim()}
												className="text-xs px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:bg-zinc-700 disabled:text-zinc-500"
											>Save</button>
										</div>
									</div>
								</div>
							)}
						</div>
						<button onClick={() => onCancel(sections)} className="text-zinc-500 hover:text-zinc-300 text-lg px-2">✕</button>
					</div>
				</div>

				<div className="flex-1 overflow-auto px-6 py-4">
					<div className="space-y-1">
						{sections.map((s) => {
							const isDup = s.searchContext && duplicateContexts.has(s.searchContext.toLowerCase().trim());
							const suggestions = s.inferred
								? extractInferredSuggestions(s, sections)
								: extractSuggestions(s.sourceSnippet ?? "");
							return (
								<div key={s.id} className="border-b border-zinc-800/50 pb-2 mb-2">
									<div className="flex items-center gap-2">
										<span className={`px-2 py-1 rounded text-[10px] font-bold min-w-[60px] text-center ${
											s.type === "hook" ? "bg-amber-500/20 text-amber-300" :
											s.type === "ending" ? "bg-blue-500/20 text-blue-300" :
											s.inferred ? "bg-orange-500/20 text-orange-300" :
											"bg-emerald-500/20 text-emerald-300"
										}`}>
											{s.type === "hook" ? "Hook" : s.type === "ending" ? "Ending" : `#${s.number ?? "?"}${s.inferred ? " ⚠" : ""}`}
										</span>
										<input
											type="text"
											value={fmtTime(s.startTime)}
											onChange={(e) => updateSection(s.id, "startTime", parseTime(e.target.value))}
											onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
											className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 tabular-nums focus:outline-none focus:border-amber-500"
										/>
										<span className="text-zinc-600 text-xs">→</span>
										<input
											type="text"
											value={fmtTime(s.endTime)}
											onChange={(e) => updateSection(s.id, "endTime", parseTime(e.target.value))}
											onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
											className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 tabular-nums focus:outline-none focus:border-amber-500"
										/>
										<input
											type="text"
											value={s.searchContext}
											onChange={(e) => updateSection(s.id, "searchContext", e.target.value)}
											onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); flashSaved(s.id); } }}
											placeholder={s.inferred ? "Search..." : "Search context"}
											className={`w-32 shrink-0 bg-zinc-800 border rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 ${
												isDup ? "border-red-500/50" : s.searchContext ? "border-zinc-700" : "border-amber-500/30"
											}`}
										/>
										{s.type === "list" && (
											<input
												type="text"
												value={s.bannerText ?? ""}
												onChange={(e) => updateSection(s.id, "bannerText", e.target.value)}
												onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); flashSaved(s.id); } }}
												placeholder={`#${s.number ?? "?"} ${s.label || "Item"}...`}
												className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
											/>
										)}
										{savedFlash === s.id && <span className="text-emerald-400 text-xs">✓</span>}
										{onRegenerateSection && s.type === "list" && (
											<button
												onClick={() => handleRegenerate(s.id)}
												disabled={regeneratingId === s.id}
												title="Re-detect this section's label/context from the SRT"
												className={`text-zinc-600 hover:text-amber-400 text-sm px-1 ${regeneratingId === s.id ? "animate-spin cursor-wait" : ""}`}
											>↻</button>
										)}
										<button onClick={() => removeSection(s.id)} className="text-zinc-600 hover:text-red-400 text-sm px-1">✕</button>
									</div>
									{s.sourceSnippet ? (
										<p className="text-[10px] text-zinc-600 italic mt-1 ml-[68px] truncate">📃 {s.sourceSnippet}</p>
									) : s.inferred ? (
										<p className="text-[10px] text-orange-500/70 italic mt-1 ml-[68px]">⚠ Inferred — not directly found in SRT</p>
									) : null}
									{isDup && (
										<p className="text-[10px] text-red-400 mt-1 ml-[68px]">⚠ Duplicate search context</p>
									)}
									{suggestions.length > 0 && !s.searchContext && (
										<div className="flex gap-1 mt-1 ml-[68px] flex-wrap">
											<span className="text-[9px] text-zinc-600">Quick-fill:</span>
											{suggestions.map(word => (
												<button
													key={word}
													onClick={() => updateSection(s.id, "searchContext", word)}
													className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700"
												>
													{word}
												</button>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>

					<div className="flex gap-2 mt-3">
					<button
						onClick={addSection}
						className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
					>+ Add Section</button>
					<button
						onClick={() => setShowBulkEdit(true)}
						className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
					>Bulk Edit Context</button>
					<button
						onClick={() => setShowBulkBanners(true)}
						className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
					>Bulk Edit Banners</button>
				</div>

					{sections.filter((s) => !s.searchContext && s.type === "list").length > 0 && (
						<p className="mt-3 text-xs text-amber-400">
							⚠ {sections.filter((s) => !s.searchContext && s.type === "list").length} section(s) have empty search context.
						</p>
					)}
				</div>

				<div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
					<span className="text-xs text-zinc-500">
						{sections.length} sections · {listCount} list items
						{inferredCount > 0 && <span className="text-orange-400"> · {inferredCount} inferred</span>}
						{detectedCount > 0 && <span className="text-emerald-400"> · {detectedCount} detected</span>}
					</span>
					<div className="flex gap-2">
						<button
							onClick={() => onCancel(sections)}
							className="text-xs px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
						>Cancel</button>
						<button
							onClick={() => onGenerate(sections)}
							className="text-xs px-4 py-2 rounded-md bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-zinc-900 font-semibold transition-colors"
						>Generate Scene Plan</button>
					</div>
				</div>
			</div>

			{showBulkEdit && (
				<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
					<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-lg w-full">
						<h3 className="text-base font-semibold text-zinc-100 mb-2">Bulk Edit Search Context</h3>
						<p className="text-xs text-zinc-500 mb-3">
							Paste item names, one per line. Line 1 fills #1, line 2 fills #2, etc.
							<br />Numbers are stripped automatically: "1. Avgolemono" → "avgolemono"
						</p>
						<textarea
							value={bulkText}
							onChange={(e) => setBulkText(e.target.value)}
							placeholder={"Avgolemono\nPho\nBorscht\nTom Kha Gai\nMinestrone\n..."}
							rows={12}
							className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-amber-500 resize-none"
							autoFocus
						/>
						<div className="flex justify-end gap-2 mt-3">
							<button
								onClick={() => { setShowBulkEdit(false); setBulkText(""); }}
								className="text-xs px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
							>Cancel</button>
							<button
								onClick={applyBulkEdit}
								className="text-xs px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
							>Apply to {sections.filter(s => s.type === "list").length} items</button>
						</div>
					</div>
				</div>
				)}

				{showBulkBanners && (
					<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
						<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-lg w-full">
							<h3 className="text-base font-semibold text-zinc-100 mb-2">Bulk Edit Banner Text</h3>
							<p className="text-xs text-zinc-500 mb-3">
								Paste banner text, one per line. Line 1 = #1, line 2 = #2, etc.
								<br />First letter of each word is auto-capitalized.
							</p>
							<textarea
								value={bulkBannerText}
								onChange={(e) => setBulkBannerText(e.target.value)}
								placeholder={"#1 Extra Virgin Olive Oil — Heart Health Champion\n#2 Greek Yogurt — The Protein Powerhouse\n#3 Horta — The Wild Green Detox\n..."}
								rows={12}
								className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-amber-500 resize-none"
								autoFocus
							/>
							<div className="flex justify-end gap-2 mt-3">
								<button
									onClick={() => { setShowBulkBanners(false); setBulkBannerText(""); }}
									className="text-xs px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
								>Cancel</button>
								<button
									onClick={applyBulkBanners}
									className="text-xs px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
								>Apply to {sections.filter(s => s.type === "list").length} items</button>
							</div>
						</div>
					</div>
				)}
			</div>
		);
}
