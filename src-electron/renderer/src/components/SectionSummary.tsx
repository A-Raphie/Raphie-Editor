import React, { useMemo } from "react";
import { beatDerailment, sectionLabel } from "../../../shared/sectionUtils";

interface SectionSummaryProps {
	sectionPlan: any;
	beats: any[];
	assets: Record<string, string>;
	onSelectBeat: (id: string) => void;
	onRepreviewSection?: (sectionId: string) => void;
	repreviewingSectionId?: string | null;
}

interface SectionStat {
	section: any;
	total: number;
	ready: number;
	derailed: number;
	firstBeatId: string | null;
}

export default function SectionSummary({ sectionPlan, beats, assets, onSelectBeat, onRepreviewSection, repreviewingSectionId }: SectionSummaryProps) {
	const stats = useMemo<SectionStat[]>(() => {
		if (!sectionPlan?.sections) return [];
		return sectionPlan.sections.map((section: any) => {
			const inSection = beats.filter((b) => {
				const d = beatDerailment(b, sectionPlan);
				return d.section?.id === section.id && (b.type === "clip" || b.type === "image");
			});
			const derailed = inSection.filter((b) => beatDerailment(b, sectionPlan).derailed).length;
			const ready = inSection.filter((b) => assets[b.id]).length;
			return {
				section,
				total: inSection.length,
				ready,
				derailed,
				firstBeatId: inSection[0]?.id ?? null,
			};
		});
	}, [sectionPlan, beats, assets]);

	if (stats.length === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-1.5 px-1 py-1.5">
			{stats.map(({ section, total, ready, derailed, firstBeatId }) => {
				const complete = total > 0 && ready === total && derailed === 0;
				const hasIssue = derailed > 0 || (total > 0 && ready < total);
				return (
					<div
						key={section.id}
						onClick={() => firstBeatId && onSelectBeat(firstBeatId)}
						title={
							total === 0
								? `${sectionLabel(section)} — no beats`
								: `${sectionLabel(section)} — ${ready}/${total} ready${derailed > 0 ? `, ${derailed} derailed` : ""}`
						}
						className={`group flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-all ${
							!firstBeatId
								? "bg-zinc-900 text-zinc-600 border-zinc-800 cursor-default"
								: complete
								? "bg-emerald-950/50 text-emerald-300 border-emerald-500/30 hover:border-emerald-500/60 cursor-pointer"
								: hasIssue
								? "bg-rose-950/40 text-rose-300 border-rose-500/30 hover:border-rose-500/60 cursor-pointer"
								: "bg-zinc-800 text-zinc-300 border-zinc-700 hover:border-zinc-600 cursor-pointer"
						}`}
					>
						<span className="text-zinc-400 group-hover:text-current">{sectionLabel(section)}</span>
						{total > 0 ? (
							<span className="flex items-center gap-0.5">
								<span className={`tabular-nums px-1 rounded ${ready === total ? "text-emerald-400" : "text-zinc-400"}`}>
									{ready}/{total}
								</span>
								{derailed > 0 && (
									<span className="tabular-nums text-rose-400" title={`${derailed} derailed`}>⚠{derailed}</span>
								)}
								{complete && <span className="text-emerald-400">✓</span>}
							</span>
						) : (
							<span className="text-zinc-600">—</span>
						)}
						{onRepreviewSection && total > 0 && (
							<button
								onClick={(e) => { e.stopPropagation(); onRepreviewSection(section.id); }}
								disabled={repreviewingSectionId === section.id}
								title="Re-search this section"
								className={`ml-0.5 text-zinc-500 hover:text-amber-400 text-xs px-0.5 ${repreviewingSectionId === section.id ? "animate-spin cursor-wait" : ""}`}
							>↻</button>
						)}
					</div>
				);
			})}
		</div>
	);
}
