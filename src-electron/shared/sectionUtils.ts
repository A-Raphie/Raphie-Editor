// Pure section-aware helpers shared with the renderer.
// Mirrors the canonical logic in src/types/scenePlan.ts (kept in sync) so the
// renderer can detect derailment without bundling the server-only scenePlanner.
// NOTE: these operate on plain Beat/Section/SectionPlan shapes (typed loosely
// here to avoid importing across the src/ build boundary).

interface SectionLike {
	id: string;
	type: string;
	label: string;
	startTime: number;
	endTime: number;
	searchContext?: string;
	number?: number;
}

interface BeatLike {
	startTime?: number;
	searchQuery?: string;
	[key: string]: any;
}

interface SectionPlanLike {
	sections: SectionLike[];
}

export function findSectionAt(time: number, sections: SectionLike[]): SectionLike | null {
	for (const s of sections) {
		if (time >= s.startTime && time < s.endTime) return s;
	}
	if (sections.length > 0 && time >= sections[sections.length - 1].endTime) {
		return sections[sections.length - 1];
	}
	return null;
}

export function isQueryDerailed(beat: BeatLike, section: SectionLike | null): boolean {
	if (!section?.searchContext || !beat.searchQuery) return false;
	return !beat.searchQuery.toLowerCase().includes(section.searchContext.toLowerCase());
}

export interface BeatDerailment {
	section: SectionLike | null;
	constrained: boolean;
	derailed: boolean;
}

export function beatDerailment(beat: BeatLike, sectionPlan: SectionPlanLike | null | undefined): BeatDerailment {
	const section = sectionPlan ? findSectionAt(beat.startTime ?? 0, sectionPlan.sections) : null;
	const constrained = !!(section && section.searchContext);
	return { section, constrained, derailed: constrained && isQueryDerailed(beat, section) };
}

export function sectionLabel(section: SectionLike): string {
	if (section.type === "hook") return "Hook";
	if (section.number) return `#${section.number} ${section.label}`;
	return section.label;
}
