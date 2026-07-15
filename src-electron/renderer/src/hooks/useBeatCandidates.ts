import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { beatDerailment, sectionLabel, findSectionAt } from "../../../shared/sectionUtils";

/**
 * Check if a PEXELS candidate's tags or URL slug contain any of the query's
 * core words. Pixabay candidates have real tags and are always relevant, so
 * this only filters Pexels (whose search is loose — returns squirrels for
 * "walnuts", drinking glasses for "nuts", etc.).
 */
function pexelsCandidateMatchesQuery(candidate: any, query: string): boolean {
	if (!query) return true;
	if (candidate?.source !== "pexels") return true; // Only filter Pexels
	const queryWords = query.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
	if (queryWords.length === 0) return true;
	const tagStr = (candidate?.tags ?? "").toLowerCase();
	const slug = (candidate?.pageUrl ?? candidate?.url ?? "").toLowerCase();
	const allText = `${tagStr} ${slug}`;
	const stem = (w: string) => w.replace(/(ing|ed|s)$/, "");
	const textStems = allText.split(/[^a-z]+/).map(stem);
	return queryWords.some((w) => textStems.includes(stem(w)));
}

interface UseBeatCandidatesDeps {
	currentProjectId: string | null;
	currentProjectIdRef: React.MutableRefObject<string | null>;
	scenePlan: any;
	settings: any;
	sectionPlan?: any;
	setScenePlan?: (v: any | ((prev: any) => any)) => void;
	assets: Record<string, string>;
	beatCandidates: Record<string, any[]>;
	setBeatCandidates: (v: Record<string, any[]> | ((prev: Record<string, any[]>) => Record<string, any[]>)) => void;
	selectedCandidateIndex: Record<string, number>;
	setSelectedCandidateIndex: (v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
	setBeatStatuses: (v: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void;
	setAssets: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
	setThumbnails: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
	setError: (v: { title: string; message: string } | null) => void;
}

export function useBeatCandidates(deps: UseBeatCandidatesDeps) {
	const {
		currentProjectId, currentProjectIdRef, scenePlan, settings, sectionPlan, setScenePlan,
		assets,
		beatCandidates, setBeatCandidates,
		selectedCandidateIndex, setSelectedCandidateIndex,
		setBeatStatuses, setAssets, setThumbnails, setError,
	} = deps;

	const [previewingAll, setPreviewingAll] = useState(false);
	const [downloadingCandidateBeat, setDownloadingCandidateBeat] = useState<string | null>(null);
	const [rateLimits, setRateLimits] = useState<{ pexelsRemaining: number; pixabayRemaining: number } | undefined>();

	// Live quota poll: refresh every 5s so the display ticks down as you search
	// and back up when the 1-hour window resets. No network cost (in-memory read).
	useEffect(() => {
		const poll = async () => {
			try { setRateLimits(await window.api.getRateLimits()); } catch {}
		};
		poll();
		const interval = setInterval(poll, 5000);
		return () => clearInterval(interval);
	}, []);
	const [imageConversionTotal, setImageConversionTotal] = useState(0);
	const [imageConversionDone, setImageConversionDone] = useState(0);
	const [queryAtSearch, setQueryAtSearch] = useState<Record<string, string>>({});
	const [previewProgress, setPreviewProgress] = useState<{ done: number; total: number; sections?: { label: string; done: number; total: number }[] } | null>(null);
	const beatCandidatesRef = useRef(beatCandidates);
	beatCandidatesRef.current = beatCandidates;

	useEffect(() => {
		setImageConversionTotal(0);
		setImageConversionDone(0);
	}, [currentProjectId]);

	const handleSearchBeat = useCallback(async (beatId: string, query: string) => {
		if (!currentProjectId || !scenePlan || !query.trim()) return;
		const beat = scenePlan.beats.find((b: any) => b.id === beatId);
		if (!beat) return;
		const pid = currentProjectId;
		setBeatStatuses((prev) => ({ ...prev, [beatId]: { status: "searching" } }));
		// Clear old candidates so stale results don't show.
		setBeatCandidates((prev) => { const next = { ...prev }; delete next[beatId]; return next; });
		try {
			// Single-beat Preview: search WITHOUT exclude list. The user is
			// manually inspecting one beat — show all Pixabay results first.
			// The dedup swap in Preview All handles cross-beat uniqueness.
			const result = await window.api.searchBeatCandidates(beatId, query, beat.type, pid, undefined);
			if (currentProjectIdRef.current !== pid) return;
			let candidates = Array.isArray(result) ? result : result?.candidates ?? [];
			if (!Array.isArray(result) && result?.rateLimits) setRateLimits(result.rateLimits);
			// Fallback: if 0 results, try the base section context.
			const baseCtx = beat.sectionContext;
			if (candidates.length === 0 && baseCtx && baseCtx.toLowerCase() !== query.toLowerCase()) {
				const ctxResult = await window.api.searchBeatCandidates(beatId, baseCtx, beat.type, pid, undefined);
				if (currentProjectIdRef.current !== pid) return;
				candidates = Array.isArray(ctxResult) ? ctxResult : ctxResult?.candidates ?? [];
			}
			// Ensure Pixabay results come first.
			candidates.sort((a: any, b: any) => (a.source === "pixabay" ? 0 : 1) - (b.source === "pixabay" ? 0 : 1));
			setBeatCandidates((prev) => ({ ...prev, [beatId]: candidates }));
			setQueryAtSearch((prev) => ({ ...prev, [beatId]: query }));
			if (candidates.length > 0 && selectedCandidateIndex[beatId] === undefined) setSelectedCandidateIndex((prev) => ({ ...prev, [beatId]: 0 }));
			setBeatStatuses((prev) => { const next = { ...prev }; delete next[beatId]; return next; });
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setBeatStatuses((prev) => ({ ...prev, [beatId]: { status: "failed", error: "search_failed", errorDetails: err.message } }));
			setError?.({ title: "Search Failed", message: `Beat ${beatId}: ${err.message}` });
		}
	}, [currentProjectId, scenePlan]);

	const [repreviewingSectionId, setRepreviewingSectionId] = useState<string | null>(null);
	const [imageHashes, setImageHashes] = useState<Record<string, string>>({});

	const handlePreviewSection = useCallback(async (sectionId: string) => {
		if (!currentProjectId || !scenePlan || !sectionPlan) return;
		const pid = currentProjectId;

		// Find all clip/image beats in this section.
		const sectionBeats = scenePlan.beats.filter((b: any) => {
			if (b.type !== "clip" && b.type !== "image") return false;
			const d = beatDerailment(b, sectionPlan);
			return d.section?.id === sectionId;
		});
		if (sectionBeats.length === 0) return;

		setRepreviewingSectionId(sectionId);

		// Clear old candidates AND selectedCandidateIndex for all beats in this
		// section. Stale indices point at old (duplicate) candidates.
		const cleared = { ...beatCandidatesRef.current };
		for (const b of sectionBeats) delete cleared[b.id];
		beatCandidatesRef.current = cleared;
		setBeatCandidates(cleared);
		setSelectedCandidateIndex((prev) => {
			const next = { ...prev };
			for (const b of sectionBeats) delete next[b.id];
			return next;
		});

		// Build a fresh seenUrls/seenThumbs from OTHER sections' beats (so
		// candidates already assigned elsewhere are excluded).
		const seenUrls = new Set<string>();
		const seenThumbs = new Set<string>();
		for (const [bid, cands] of Object.entries(beatCandidatesRef.current)) {
			const idx = selectedCandidateIndex[bid] ?? 0;
			if (cands?.[idx]?.url) seenUrls.add(cands[idx].url);
			if (cands?.[idx]?.thumbnailUrl) seenThumbs.add(cands[idx].thumbnailUrl);
		}

		// Set searching status for all beats in the section.
		for (const b of sectionBeats) {
			setBeatStatuses((prev) => ({ ...prev, [b.id]: { status: "searching" } }));
		}

		const concurrency = settings?.previewConcurrency ?? 10;
		const beatOrder: string[] = [];

		try {
			const batchResults = await searchBatch(sectionBeats, pid, concurrency, seenUrls, beatOrder, 50, seenThumbs);

			// DEDUP SWAP: check for URL collisions among this section's beats and
			// swap any duplicates to an unused candidate in their list. Uses the
			// LOCAL batchResults (returned by searchBatch) instead of the ref to
			// avoid the stale-state race condition.
			if (currentProjectIdRef.current === pid) {
				const urlToBeats = new Map<string, string[]>();
				for (const bid of Object.keys(batchResults)) {
					const cands = batchResults[bid];
					if (!cands?.length) continue;
					const url = cands[0]?.url;
					if (!url) continue;
					const group = urlToBeats.get(url) ?? [];
					group.push(bid);
					urlToBeats.set(url, group);
				}
				const swaps: Record<string, number> = {};
				for (const [, beats] of urlToBeats) {
					if (beats.length <= 1) continue;
					// Build usedUrls from ALL beats (section results + other sections' ref).
					const usedUrls = new Set<string>();
					for (const [otherBid, otherCands] of Object.entries(beatCandidatesRef.current)) {
						const otherIdx = selectedCandidateIndex[otherBid] ?? 0;
						if (otherCands?.[otherIdx]?.url) usedUrls.add(otherCands[otherIdx].url);
					}
					for (let j = 1; j < beats.length; j++) {
						const bid = beats[j];
						const cands = batchResults[bid];
						if (!cands) continue;
						const newIdx = cands.findIndex((c: any, idx: number) =>
							idx !== 0 && !usedUrls.has(c.url)
						);
						if (newIdx >= 0) {
							swaps[bid] = newIdx;
							usedUrls.add(cands[newIdx].url);
						}
					}
				}
				if (Object.keys(swaps).length > 0) {
					setSelectedCandidateIndex((prev) => ({ ...prev, ...swaps }));
				}
			}
		} finally {
			if (currentProjectIdRef.current === pid) {
				for (const b of sectionBeats) {
					setBeatStatuses((prev) => { const next = { ...prev }; delete next[b.id]; return next; });
				}
				setRepreviewingSectionId(null);
			}
		}
	}, [currentProjectId, scenePlan, sectionPlan, settings, selectedCandidateIndex]);

	const computeImageHash = useCallback((thumbnailUrl: string): Promise<string> => {
		return new Promise((resolve) => {
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.onload = () => {
				const canvas = document.createElement("canvas");
				canvas.width = 8;
				canvas.height = 8;
				const ctx = canvas.getContext("2d")!;
				ctx.drawImage(img, 0, 0, 8, 8);
				const data = ctx.getImageData(0, 0, 8, 8).data;
				const gray: number[] = [];
				for (let i = 0; i < data.length; i += 4) {
					gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
				}
				const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
				const hash = gray.map(g => g >= avg ? "1" : "0").join("");
				resolve(hash);
			};
			img.onerror = () => resolve("");
			img.src = thumbnailUrl;
		});
	}, []);

	const searchBatch = useCallback(async (
		beats: any[],
		pid: string,
		concurrency: number,
		seenUrls: Set<string>,
		beatOrder: string[],
		lookback: number,
		seenThumbs?: Set<string>
	): Promise<Record<string, any[]>> => {
		const allBatchResults: Record<string, any[]> = {};
		for (let i = 0; i < beats.length; i += concurrency) {
			if (currentProjectIdRef.current !== pid) return;
			const batch = beats.slice(i, i + concurrency);
			const batchResults: Record<string, any[]> = {};
			const excludeList = Array.from(seenUrls);

			await Promise.allSettled(batch.map(async (beat: any) => {
				setBeatStatuses((prev) => ({ ...prev, [beat.id]: { status: "searching" } }));
				try {
					const result = await window.api.searchBeatCandidates(beat.id, beat.searchQuery, beat.type, pid, excludeList);
					if (currentProjectIdRef.current !== pid) return;
					const candidates = Array.isArray(result) ? result : result?.candidates ?? [];
					if (!Array.isArray(result) && result?.rateLimits) setRateLimits(result.rateLimits);
					batchResults[beat.id] = candidates;
					setBeatStatuses((prev) => { const next = { ...prev }; delete next[beat.id]; return next; });
				} catch {
					if (currentProjectIdRef.current !== pid) return;
					setBeatStatuses((prev) => ({ ...prev, [beat.id]: { status: "failed" } }));
				}
			}));

			for (const beat of batch) {
				const cands = batchResults[beat.id];
				if (!cands || cands.length === 0) continue;
				beatOrder.push(beat.id);
				// Bias selection toward an unseen candidate WITHOUT pruning the
				// stored list — keep the full pool so the post-search swap pass
				// has alternates to swap to. Prefer a candidate whose URL AND
				// thumbnail are both unseen (catches same-video-different-resolution
				// duplicates). Fall back to unseen-URL-only.
				const unseen = seenThumbs
					? cands.find((c: any) => !seenUrls.has(c.url) && !seenThumbs.has(c.thumbnailUrl))
						|| cands.find((c: any) => !seenUrls.has(c.url))
					: cands.find((c: any) => !seenUrls.has(c.url));
				if (unseen) {
					seenUrls.add(unseen.url);
					if (seenThumbs && unseen.thumbnailUrl) seenThumbs.add(unseen.thumbnailUrl);
					batchResults[beat.id] = [unseen, ...cands.filter((c: any) => c.url !== unseen.url)];
				}
			}

			const lookbackStart = Math.max(0, beatOrder.length - lookback);
			const lookbackIds = beatOrder.slice(lookbackStart);
			const lookbackUrls = new Set<string>();
			for (const bid of lookbackIds) {
				const idx = selectedCandidateIndex[bid] ?? 0;
				const cands = batchResults[bid] ?? beatCandidatesRef.current[bid];
				if (cands?.[idx]?.url) lookbackUrls.add(cands[idx].url);
			}

			for (const beatId of Object.keys(batchResults)) {
				const cands = batchResults[beatId];
				if (!cands || cands.length === 0) continue;
				// Bias selection away from recently-used URLs WITHOUT pruning —
				// move the first non-colliding candidate to index 0, keep the rest.
				const nonColliding = cands.find((c: any) => !lookbackUrls.has(c.url));
				if (nonColliding && nonColliding.url !== cands[0]?.url) {
					batchResults[beatId] = [nonColliding, ...cands.filter((c: any) => c.url !== nonColliding.url)];
				}
			}

		for (const [beatId, candidates] of Object.entries(batchResults)) {
			// DON'T re-sort here — the dedup assignment loop above already placed
			// the unseen candidate at index 0. Re-sorting would undo that work.
			// Update BOTH React state AND the ref directly so callers reading the
			// ref immediately after await get fresh data (no stale-read race).
			beatCandidatesRef.current = { ...beatCandidatesRef.current, [beatId]: candidates };
			setBeatCandidates((prev) => ({ ...prev, [beatId]: candidates }));
			if (candidates.length > 0 && selectedCandidateIndex[beatId] === undefined) {
				setSelectedCandidateIndex((prev) => ({ ...prev, [beatId]: 0 }));
			}
			allBatchResults[beatId] = candidates;
		}

			if (i + concurrency < beats.length) {
				await new Promise(r => setTimeout(r, 1500));
			}
		}
		return allBatchResults;
	}, [selectedCandidateIndex]);

	const handlePreviewAll = useCallback(async () => {
		if (!currentProjectId || !scenePlan) return;
		const pid = currentProjectId;
		setPreviewingAll(true);
		setPreviewProgress({ done: 0, total: 0 });
		try {
		// Auto-fix derailed beats before searching: any assetable beat whose
		// searchQuery doesn't contain its section context is reset to that
		// context, and its stale candidates/query cache are cleared so it
		// re-searches with the corrected query. Compute the fixed snapshot
		// synchronously so this run uses corrected queries immediately.
		let planForSearch = scenePlan;
		const fixedBeatIds: string[] = [];
		if (sectionPlan && setScenePlan) {
			let changed = false;
			const beats = scenePlan.beats.map((b: any) => {
				if (b.type !== "clip" && b.type !== "image") return b;
				const d = beatDerailment(b, sectionPlan);
				if (d.derailed && d.section?.searchContext) {
					// Skip beats the user manually edited — if the query doesn't
					// contain the section context, the user customized it.
					if (b.searchQuery && !b.searchQuery.toLowerCase().includes(d.section.searchContext.toLowerCase())) {
						return b;
					}
					changed = true;
					fixedBeatIds.push(b.id);
					return { ...b, searchQuery: d.section.searchContext };
				}
				return b;
			});
			if (changed) {
				planForSearch = { ...scenePlan, beats };
				setScenePlan(planForSearch);
				setBeatCandidates((prev) => {
					const next = { ...prev };
					for (const bid of fixedBeatIds) delete next[bid];
					return next;
				});
				setQueryAtSearch((prev) => {
					const next = { ...prev };
					for (const bid of fixedBeatIds) delete next[bid];
					return next;
				});
			}
		}
		setBeatStatuses({});
		const assetableBeats = planForSearch.beats.filter((b: any) => (b.type === "clip" || b.type === "image") && b.searchQuery);
		let remaining = assetableBeats.filter((b: any) => {
			const cands = beatCandidatesRef.current[b.id];
			const hasCands = cands && cands.length > 0;
			const queryChanged = queryAtSearch[b.id] !== undefined && queryAtSearch[b.id] !== b.searchQuery;
			return !hasCands || queryChanged;
		});
		setPreviewProgress({ done: 0, total: remaining.length });
		const concurrency = settings?.previewConcurrency ?? 10;
		const LOOKBACK = 50;
		const seenUrls = new Set<string>();
		const seenThumbs = new Set<string>();

		for (const [bid, cands] of Object.entries(beatCandidatesRef.current)) {
			const idx = selectedCandidateIndex[bid] ?? 0;
			if (cands?.[idx]?.url) seenUrls.add(cands[idx].url);
			if (cands?.[idx]?.thumbnailUrl) seenThumbs.add(cands[idx].thumbnailUrl);
		}

		const beatOrder: string[] = [];

		// SECTION-AWARE SEARCH SHARING: group beats by their search query, search
		// ONCE per query, then distribute distinct candidates across all beats in
		// that group. This reduces ~477 API calls to ~22 (one per section).
		const underserved: any[] = [];
		// Track each underserved beat's group pool so the last-resort fallback
		// (below) can assign the least-repeated candidate if re-search fails.
		const underservedPools = new Map<string, any[]>();
		{
			const groups = new Map<string, any[]>();
			for (const beat of remaining) {
				const key = (beat.searchQuery ?? "").toLowerCase().trim();
				if (!key) { underserved.push(beat); continue; }
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key)!.push(beat);
			}
		let processed = 0;
		for (const [queryKey, groupBeats] of groups) {
			if (currentProjectIdRef.current !== pid) { setPreviewingAll(false); return; }
			// Split by type so clips get video candidates and images get image candidates.
			// Two API calls per section instead of one, but correct results for both types.
			const clipBeats = groupBeats.filter((b) => b.type !== "image");
			const imageBeats = groupBeats.filter((b) => b.type === "image");

			// Process clips then images, each with its own search pool.
			for (const [typeBeats, beatType] of [[clipBeats, "clip"], [imageBeats, "image"]] as [any[], string][]) {
				if (typeBeats.length === 0) continue;
				if (currentProjectIdRef.current !== pid) { setPreviewingAll(false); return; }

				const firstBeat = typeBeats[0];
				let pool: any[] = [];
				try {
					const result = await window.api.searchBeatCandidates(firstBeat.id, firstBeat.searchQuery, beatType, pid, undefined);
					if (currentProjectIdRef.current !== pid) { setPreviewingAll(false); return; }
					pool = Array.isArray(result) ? result : result?.candidates ?? [];
				} catch {}
				// Sort Pixabay first.
				pool.sort((a: any, b: any) => (a.source === "pixabay" ? 0 : 1) - (b.source === "pixabay" ? 0 : 1));

				if (pool.length === 0) {
					// No results — all beats of this type are underserved.
					underserved.push(...typeBeats);
				} else {
					// Distribute: each beat gets a different candidate at index 0.
					// Skip Pexels candidates whose tags/slug don't match the query
					// (prevents "assorted nuts" or "squirrel" for a "walnuts" beat).
					// Pixabay candidates always pass (they have real tags).
					const relevantPool: any[] = [];
					const irrelevantPool: any[] = [];
					for (const c of pool) {
						if (pexelsCandidateMatchesQuery(c, queryKey)) {
							relevantPool.push(c);
						} else {
							irrelevantPool.push(c);
						}
					}
					// Use relevant candidates first; fall back to irrelevant only if
					// we run out (better a loose match than no candidate).
					const distributable = relevantPool.length > 0 ? relevantPool : pool;

					for (let i = 0; i < typeBeats.length; i++) {
						const beat = typeBeats[i];
						if (i < distributable.length) {
							// This beat gets a unique candidate.
							beatOrder.push(beat.id);
							const assigned = distributable[i];
							const reordered = [assigned, ...distributable.filter((_: any, j: number) => j !== i)];
							// Append irrelevant candidates at the end as fallback options.
							if (relevantPool.length > 0) reordered.push(...irrelevantPool);
							beatCandidatesRef.current = { ...beatCandidatesRef.current, [beat.id]: reordered };
							setBeatCandidates((prev) => ({ ...prev, [beat.id]: reordered }));
							if (selectedCandidateIndex[beat.id] === undefined) setSelectedCandidateIndex((prev) => ({ ...prev, [beat.id]: 0 }));
							if (assigned?.url) seenUrls.add(assigned.url);
							if (assigned?.thumbnailUrl) seenThumbs.add(assigned.thumbnailUrl);
							setQueryAtSearch((prev) => ({ ...prev, [beat.id]: beat.searchQuery }));
						} else {
							// Pool exhausted — send to underserved for re-search.
							underservedPools.set(beat.id, distributable);
							underserved.push(beat);
						}
					}
				}
			}
			processed += groupBeats.length;
			setPreviewProgress((prev) => prev ? { done: processed, total: remaining.length } : null);
		}
		}

		// Search underserved beats individually (pool was too small or empty).
		if (underserved.length > 0) {
			await searchBatch(underserved, pid, concurrency, seenUrls, beatOrder, LOOKBACK, seenThumbs);
		}
		setPreviewProgress((prev) => prev ? { done: prev.total, total: prev.total } : null);

		// LAST-RESORT FALLBACK: for underserved beats that still have no
		// candidates after re-search, assign the LEAST-REPEATED candidate from
		// their group's pool. This is better than leaving the beat empty — the
		// user sees a warning flag and can manually replace it. We pick the
		// candidate whose URL appears the fewest times across all beats'
		// current selections to minimize visible duplication.
		for (const beat of underserved) {
			const existing = beatCandidatesRef.current[beat.id];
			if (existing && existing.length > 0) continue; // searchBatch found something
			const pool = underservedPools.get(beat.id);
			if (!pool || pool.length === 0) continue;

			// Count how many times each pool candidate's URL is already selected.
			const urlCounts = new Map<string, number>();
			for (const [bid, cands] of Object.entries(beatCandidatesRef.current)) {
				const idx = selectedCandidateIndex[bid] ?? 0;
				if (cands?.[idx]?.url) {
					urlCounts.set(cands[idx].url, (urlCounts.get(cands[idx].url) ?? 0) + 1);
				}
			}
			// Pick the least-repeated candidate.
			let best = pool[0];
			let bestCount = Infinity;
			for (const c of pool) {
				const count = urlCounts.get(c.url) ?? 0;
				if (count < bestCount) { bestCount = count; best = c; }
			}
			const reordered = [best, ...pool.filter((c: any) => c.url !== best.url)];
			beatCandidatesRef.current = { ...beatCandidatesRef.current, [beat.id]: reordered };
			setBeatCandidates((prev) => ({ ...prev, [beat.id]: reordered }));
			setSelectedCandidateIndex((prev) => ({ ...prev, [beat.id]: 0 }));
			setBeatStatuses((prev) => ({ ...prev, [beat.id]: { status: "dupe-fallback" } }));
		}

		// Set queryAtSearch for underserved beats (distributed beats already set above).
		for (const b of underserved) {
			setQueryAtSearch((prev) => ({ ...prev, [b.id]: b.searchQuery }));
		}

		const MAX_RETRIES = 2;
		const RETRY_DELAY_MS = 2000;
		const queryCache = new Map<string, string>();
		const triedQueries = new Map<string, Set<string>>();
		const originalWords = new Map<string, string[]>();
		const wordIdx = new Map<string, number>();
		for (const b of assetableBeats) {
			queryCache.set(b.id, b.searchQuery);
			triedQueries.set(b.id, new Set([b.searchQuery]));
			originalWords.set(b.id, b.searchQuery.split(/\s+/).filter(Boolean));
			wordIdx.set(b.id, 0);
		}
		for (let retry = 1; retry <= MAX_RETRIES; retry++) {
			if (currentProjectIdRef.current !== pid) { setPreviewingAll(false); return; }
			const emptyBeats = assetableBeats.filter((b: any) => {
				const cands = beatCandidatesRef.current[b.id];
				return !cands || cands.length === 0;
			});
			if (emptyBeats.length === 0) break;
			const shortened = emptyBeats.map((b: any) => {
				if (retry === 1 && b.sectionContext && b.searchQuery !== b.sectionContext) {
					queryCache.set(b.id, b.sectionContext);
					return { ...b, searchQuery: b.sectionContext };
				}
				const q = queryCache.get(b.id) ?? b.searchQuery;
				const words = q.split(/\s+/).filter(Boolean);
				if (words.length > 1) {
					const newQ = words.slice(0, -1).join(" ");
					queryCache.set(b.id, newQ);
					return { ...b, searchQuery: newQ };
				}
				const origWords = originalWords.get(b.id) ?? [];
				let idx = wordIdx.get(b.id) ?? 0;
				while (idx < origWords.length) {
					const wordQuery = origWords[idx];
					idx++;
					wordIdx.set(b.id, idx);
					if (wordQuery.length > 2) {
						queryCache.set(b.id, wordQuery);
						return { ...b, searchQuery: wordQuery };
					}
				}
				return b;
			}).filter((b: any) => {
				const tried = triedQueries.get(b.id);
				if (tried?.has(b.searchQuery)) return false;
				tried?.add(b.searchQuery);
				return true;
			});
			if (shortened.length === 0) break;
			await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
			if (currentProjectIdRef.current !== pid) { setPreviewingAll(false); return; }
			// On the last retry, drop the exclude list so empty beats get a final
			// chance without dedup blocking them (better to have a dupe than nothing).
			const retrySeenUrls = retry === MAX_RETRIES ? new Set<string>() : seenUrls;
			await searchBatch(shortened, pid, concurrency, retrySeenUrls, beatOrder, LOOKBACK, seenThumbs);
		}

		if (currentProjectIdRef.current !== pid) { setPreviewingAll(false); return; }

		const allCandidates = beatCandidatesRef.current;
		const urlToBeats = new Map<string, string[]>();
		for (const [bid, cands] of Object.entries(allCandidates)) {
			const idx = selectedCandidateIndex[bid] ?? 0;
			if (cands?.[idx]?.url) {
				const url = cands[idx].url;
				const group = urlToBeats.get(url) ?? [];
				group.push(bid);
				urlToBeats.set(url, group);
			}
		}

		const swaps: Record<string, number> = {};
		for (const [url, beats] of urlToBeats) {
			if (beats.length <= 1) continue;
			for (let j = 1; j < beats.length; j++) {
				const bid = beats[j];
				const cands = allCandidates[bid];
				if (!cands) continue;
				const usedUrls = new Set<string>();
				for (const [otherBid, otherCands] of Object.entries(allCandidates)) {
					if (otherBid === bid) continue;
					const otherIdx = selectedCandidateIndex[otherBid] ?? 0;
					if (otherCands?.[otherIdx]?.url) usedUrls.add(otherCands[otherIdx].url);
				}
				const newIdx = cands.findIndex((c: any, idx: number) => idx !== (selectedCandidateIndex[bid] ?? 0) && !usedUrls.has(c.url));
				if (newIdx >= 0) {
					swaps[bid] = newIdx;
				}
			}
		}

		if (Object.keys(swaps).length > 0) {
			setSelectedCandidateIndex((prev) => ({ ...prev, ...swaps }));
		}

		if (currentProjectIdRef.current !== pid) { setPreviewingAll(false); return; }

		const mergedSwaps = { ...swaps };
		const MAX_HASH_ROUNDS = 5;
		let finalHashes: Record<string, string> = {};

		for (let round = 0; round < MAX_HASH_ROUNDS; round++) {
			const hashes: Record<string, string> = {};
			for (const beat of assetableBeats) {
				const cands = beatCandidatesRef.current[beat.id];
				if (!cands || cands.length === 0) continue;
				const idx = (mergedSwaps[beat.id] !== undefined ? mergedSwaps[beat.id] : selectedCandidateIndex[beat.id]) ?? 0;
				const cand = cands[idx];
				if (cand?.thumbnailUrl) {
					const hash = await computeImageHash(cand.thumbnailUrl);
					if (hash) hashes[beat.id] = hash;
				}
			}

			const hashMap = new Map<string, string[]>();
			for (const [bid, hash] of Object.entries(hashes)) {
				if (!hash) continue;
				const group = hashMap.get(hash) ?? [];
				group.push(bid);
				hashMap.set(hash, group);
			}

			const roundSwaps: Record<string, number> = {};
			// Build usedUrls + usedThumbs from ALL assetable beats' current
			// selections (not just the collision group), so a swap won't pick a
			// candidate whose URL or thumbnail is already used by ANY beat.
			const usedUrls = new Set<string>();
			const usedThumbs = new Set<string>();
			for (const b of assetableBeats) {
				const otherBid = b.id;
				const otherIdx = (roundSwaps[otherBid] !== undefined ? roundSwaps[otherBid] : mergedSwaps[otherBid] !== undefined ? mergedSwaps[otherBid] : selectedCandidateIndex[otherBid]) ?? 0;
				const otherCands = beatCandidatesRef.current[otherBid];
				if (otherCands?.[otherIdx]?.url) usedUrls.add(otherCands[otherIdx].url);
				if (otherCands?.[otherIdx]?.thumbnailUrl) usedThumbs.add(otherCands[otherIdx].thumbnailUrl);
			}
			for (const [, dups] of hashMap) {
				if (dups.length <= 1) continue;
				for (let j = 1; j < dups.length; j++) {
					const bid = dups[j];
					const cands = beatCandidatesRef.current[bid];
					if (!cands) continue;
					const currentIdx = (mergedSwaps[bid] !== undefined ? mergedSwaps[bid] : selectedCandidateIndex[bid]) ?? 0;
					// Skip the current selection AND any candidate whose URL or
					// thumbnail is already used by another beat (avoids moving
					// from one perceptual collision into another).
					const newIdx = cands.findIndex((c: any, idx: number) =>
						idx !== currentIdx &&
						!usedUrls.has(c.url) &&
						!usedThumbs.has(c.thumbnailUrl)
					);
					if (newIdx >= 0) {
						roundSwaps[bid] = newIdx;
						// Reserve the swapped-to URL + thumbnail so later beats in
						// this round don't pick the same one.
						usedUrls.add(cands[newIdx].url);
						if (cands[newIdx].thumbnailUrl) usedThumbs.add(cands[newIdx].thumbnailUrl);
					}
				}
			}

			finalHashes = hashes;
			if (Object.keys(roundSwaps).length === 0) break;
			Object.assign(mergedSwaps, roundSwaps);
		}

		if (Object.keys(mergedSwaps).length > 0) {
			setSelectedCandidateIndex((prev) => ({ ...prev, ...mergedSwaps }));
		}

		setImageHashes(finalHashes);

		// DEDUP AUTO-REPREVIEW: re-search beats that are still duplicates after
		// the swap passes, so the user doesn't have to manually Preview each one.
		{
			const dupBeatIds = new Set<string>();
			const urlToBeats = new Map<string, string[]>();
			for (const b of assetableBeats) {
				const cands = beatCandidatesRef.current[b.id];
				if (!cands?.length) continue;
				const idx = (mergedSwaps[b.id] !== undefined ? mergedSwaps[b.id] : selectedCandidateIndex[b.id]) ?? 0;
				const url = cands[idx]?.url;
				if (!url) continue;
				const group = urlToBeats.get(url) ?? [];
				group.push(b.id);
				urlToBeats.set(url, group);
			}
			for (const [, group] of urlToBeats) {
				if (group.length > 1) for (const id of group) dupBeatIds.add(id);
			}
			if (dupBeatIds.size > 0 && currentProjectIdRef.current === pid) {
				// Add their URLs to seenUrls so the re-search avoids them.
				for (const id of dupBeatIds) {
					const cands = beatCandidatesRef.current[id];
					const idx = (mergedSwaps[id] !== undefined ? mergedSwaps[id] : selectedCandidateIndex[id]) ?? 0;
					if (cands?.[idx]?.url) seenUrls.add(cands[idx].url);
				}
				// Reset selectedCandidateIndex for dup beats so searchBatch's
				// fresh candidates (with unseen URLs at index 0) get picked up.
				setSelectedCandidateIndex((prev) => {
					const next = { ...prev };
					for (const id of dupBeatIds) delete next[id];
					return next;
				});
				const dupBeats = assetableBeats.filter((b: any) => dupBeatIds.has(b.id));
				// Clear their old candidates so they get re-searched.
				const cleared = { ...beatCandidatesRef.current };
				for (const b of dupBeats) delete cleared[b.id];
				beatCandidatesRef.current = cleared;
				setBeatCandidates(cleared);
				await searchBatch(dupBeats, pid, concurrency, seenUrls, beatOrder, LOOKBACK, seenThumbs);
				// If any dup beats are STILL empty (all results excluded), retry
				// once with an empty exclude list — better a dupe than nothing.
				const stillDup = dupBeats.filter((b: any) => !beatCandidatesRef.current[b.id]?.length);
				if (stillDup.length > 0) {
					await searchBatch(stillDup, pid, concurrency, new Set<string>(), [], LOOKBACK);
				}
			}
		}

		const stillEmpty = assetableBeats.filter((b: any) => {
			const cands = beatCandidatesRef.current[b.id];
			return !cands || cands.length === 0;
		});
		if (stillEmpty.length > 0 && currentProjectIdRef.current === pid) {
			const names = stillEmpty.slice(0, 5).map((b: any) => b.searchQuery).join(", ");
			const rl = rateLimits ? ` (Pexels: ${rateLimits.pexelsRemaining} left, Pixabay: ${rateLimits.pixabayRemaining} left)` : "";
			setError({ title: `${stillEmpty.length} beats had no results`, message: `Queries: ${names}${stillEmpty.length > 5 ? ` and ${stillEmpty.length - 5} more` : ""}. Click Preview to retry.${rl}` });
		}
		} finally {
			if (currentProjectIdRef.current === pid) {
				setPreviewingAll(false);
				setPreviewProgress(null);
			}
		}
	}, [currentProjectId, scenePlan, settings, sectionPlan, setScenePlan, selectedCandidateIndex, searchBatch, computeImageHash, queryAtSearch]);

	const handleSelectCandidate = useCallback((beatId: string, index: number) => {
		setSelectedCandidateIndex((prev) => ({ ...prev, [beatId]: index }));
		const cands = beatCandidatesRef.current[beatId];
		if (cands?.[index]?.thumbnailUrl) {
			computeImageHash(cands[index].thumbnailUrl).then(hash => {
				if (hash) setImageHashes((prev) => ({ ...prev, [beatId]: hash }));
			});
		}
	}, [computeImageHash]);

	const handleDownloadCandidate = useCallback(async (beatId: string, index: number) => {
		if (!currentProjectId) return;
		const candidates = beatCandidates[beatId];
		if (!candidates || !candidates[index]) return;
		const pid = currentProjectId;
		setDownloadingCandidateBeat(beatId);
		const beat = scenePlan?.beats?.find((b: any) => b.id === beatId);
		const cand = candidates[index];
		const isImageCandidate = cand?.type === "image";
		const ANIMATIONS = ["zoom_in", "zoom_out", "pan_lr", "pan_rl", "pan_tb", "pan_bt", "zoom_in_tl", "zoom_in_tr", "zoom_in_bl", "zoom_in_br"];
		// If the candidate is an image (even on a clip beat), treat it as an image
		// download so it gets prerendered to MP4 with Ken Burns animation.
		const isImageDownload = beat?.type === "image" || isImageCandidate;
		const beatMeta = isImageDownload
			? { duration: beat?.duration ?? 5, imageAnimation: beat?.imageAnimation ?? ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)], startTime: beat?.startTime }
			: undefined;
		try {
			const result = await window.api.downloadSelectedCandidate(beatId, cand, pid, beatMeta);
			if (currentProjectIdRef.current !== pid) return;
			if (result.path) {
				setAssets((prev) => ({ ...prev, [beatId]: result.path }));
				if (result.thumbnail) setThumbnails((prev) => ({ ...prev, [beatId]: result.thumbnail }));
				if (beatMeta) {
					setImageConversionTotal((prev) => Math.max(prev, 1));
					setImageConversionDone((prev) => prev + 1);
				}
				// Beat type follows the downloaded candidate type.
				const candidateType = isImageCandidate ? "image" : "clip";
				if (beat?.type && beat.type !== candidateType) {
					setScenePlan((prev: any) => {
						if (!prev) return prev;
						const updated = {
							...prev,
							beats: prev.beats.map((b: any) => b.id === beatId
								? candidateType === "image"
									? { ...b, type: "image", imageAnimation: beatMeta?.imageAnimation ?? "zoom_in" }
									: { ...b, type: "clip", imageAnimation: undefined }
								: b
							),
						};
						if (pid) window.api.saveScenePlan(pid, updated).catch(() => {});
						return updated;
					});
				}
			}
		} catch (err: any) {
			if (currentProjectIdRef.current !== pid) return;
			setError({ title: "Download Failed", message: err.message });
		}
		if (currentProjectIdRef.current === pid) setDownloadingCandidateBeat(null);
	}, [currentProjectId, beatCandidates, scenePlan]);

	const [downloadingAll, setDownloadingAll] = useState(false);

	const handleDownloadAllSelected = useCallback(async () => {
		if (!currentProjectId || !scenePlan || downloadingAll) return;
		const pid = currentProjectId;
		setDownloadingAll(true);
		const toDownload = scenePlan.beats.filter((b: any) => b.type === "clip" || b.type === "image").filter((b: any) => beatCandidates[b.id]?.length && !assets[b.id]);
		const imageBeatCount = toDownload.filter((b: any) => b.type === "image").length;
		if (imageBeatCount > 0) {
			setImageConversionTotal(imageBeatCount);
			setImageConversionDone(0);
		}
		const concurrency = settings?.concurrency ?? 4;
		const maxRetries = 3;

		const downloadBatch = async (batch: any[], getIdx: (beatId: string) => number) => {
			const failed: any[] = [];
			const ANIMATIONS = ["zoom_in", "zoom_out", "pan_lr", "pan_rl", "pan_tb", "pan_bt", "zoom_in_tl", "zoom_in_tr", "zoom_in_bl", "zoom_in_br"];
			await Promise.allSettled(batch.map(async (beat: any) => {
				const idx = getIdx(beat.id);
				const candidates = beatCandidates[beat.id];
				if (!candidates?.[idx]) { failed.push(beat); return; }
				const cand = candidates[idx];
				// Handle image candidates on clip beats (from image-fallback).
				const isImageCandidate = cand?.type === "image";
				const isImageDownload = beat.type === "image" || isImageCandidate;
				const beatMeta = isImageDownload
					? { duration: beat.duration ?? 5, imageAnimation: beat.imageAnimation ?? ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)], startTime: beat.startTime }
					: undefined;
				try {
					const result = await window.api.downloadSelectedCandidate(beat.id, cand, pid, beatMeta);
					if (currentProjectIdRef.current !== pid) return;
					if (result.path) {
						setAssets((prev) => ({ ...prev, [beat.id]: result.path }));
						if (result.thumbnail) setThumbnails((prev) => ({ ...prev, [beat.id]: result.thumbnail }));
						if (beatMeta) setImageConversionDone((prev) => prev + 1);
						// Beat type follows the downloaded candidate type.
						const candidateType = isImageCandidate ? "image" : "clip";
						if (beat.type && beat.type !== candidateType) {
							setScenePlan((prev: any) => {
								if (!prev) return prev;
								return { ...prev, beats: prev.beats.map((b: any) => b.id === beat.id
									? candidateType === "image"
										? { ...b, type: "image", imageAnimation: beatMeta?.imageAnimation ?? "zoom_in" }
										: { ...b, type: "clip", imageAnimation: undefined }
									: b) };
							});
						}
					} else {
						failed.push(beat);
					}
				} catch {
					failed.push(beat);
				}
			}));
			return failed;
		};

		const allFailed: any[] = [];

		try {
			for (let i = 0; i < toDownload.length; i += concurrency) {
				if (currentProjectIdRef.current !== pid) { setDownloadingAll(false); return; }
				const batch = toDownload.slice(i, i + concurrency);
				let failed = await downloadBatch(batch, (beatId) => selectedCandidateIndex[beatId] ?? 0);

				for (let retry = 1; retry <= maxRetries && failed.length > 0; retry++) {
					if (currentProjectIdRef.current !== pid) { setDownloadingAll(false); return; }
					await new Promise(r => setTimeout(r, 2000 * retry));
					const retryFailed = await downloadBatch(failed, (beatId) => {
						const base = selectedCandidateIndex[beatId] ?? 0;
						const candidates = beatCandidates[beatId];
						if (!candidates || candidates.length === 0) return base;
						return (base + retry) % candidates.length;
					});
					failed = retryFailed;
				}

				if (failed.length > 0) {
					allFailed.push(...failed);
				}
			}

			if (allFailed.length > 0 && currentProjectIdRef.current === pid) {
				const names = allFailed.slice(0, 5).map((b: any) => b.searchQuery).join(", ");
				const more = allFailed.length > 5 ? ` and ${allFailed.length - 5} more` : "";
				setError({ title: `${allFailed.length} Download${allFailed.length > 1 ? "s" : ""} Failed`, message: `Failed: ${names}${more}. Click Download to retry.` });
			}
		} finally {
			if (currentProjectIdRef.current === pid) setDownloadingAll(false);
		}
	}, [currentProjectId, scenePlan, beatCandidates, selectedCandidateIndex, assets, downloadingAll, settings]);

	// Live per-section progress during Preview All: for each section, how many
	// assetable beats now have at least one candidate vs. the section total.
	const previewSectionProgress = useMemo(() => {
		if (!previewingAll || !scenePlan || !sectionPlan?.sections) return null;
		const assetable = scenePlan.beats.filter((b: any) => (b.type === "clip" || b.type === "image") && b.searchQuery);
		return sectionPlan.sections.map((section: any) => {
			const inSection = assetable.filter((b: any) => findSectionAt(b.startTime ?? 0, sectionPlan.sections)?.id === section.id);
			const done = inSection.filter((b: any) => beatCandidatesRef.current[b.id]?.length > 0).length;
			return { label: sectionLabel(section), done, total: inSection.length };
		}).filter((s: any) => s.total > 0);
	}, [previewingAll, scenePlan, sectionPlan, beatCandidates]);

	return {
		beatCandidates, setBeatCandidates,
		selectedCandidateIndex, setSelectedCandidateIndex,
		previewingAll, setPreviewingAll,
		downloadingCandidateBeat, setDownloadingCandidateBeat,
		rateLimits, imageHashes,
		imageConversionTotal, imageConversionDone,
		downloadingAll,
		previewProgress, previewSectionProgress,
		repreviewingSectionId,
		handleSearchBeat, handlePreviewAll, handlePreviewSection, handleSelectCandidate,
		handleDownloadCandidate, handleDownloadAllSelected,
	};
}
