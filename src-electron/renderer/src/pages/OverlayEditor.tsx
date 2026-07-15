import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { ScenePlan, Beat, Section, SectionPlan } from "../../../pipeline/types/scenePlan";
import { useOverlayOverrides } from "../hooks/useOverlayOverrides";

export interface OverlayAssignment {
  id: string;
  type: "number_callout" | "item_banner" | "subscribe_cta";
  beatId: string;
  showAt: number;
  srtTime?: number;
  label: string;
  number?: number;
  enabled: boolean;
  beatStart: number;
  beatDuration: number;
  concatStart: number;
}

interface OverlayEditorProps {
  scenePlan: ScenePlan;
  sectionPlan: SectionPlan | null;
  projectId: string;
  beatTextSegments: Record<string, string>;
  onComplete: () => void;
  onBack: () => void;
}

function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function parseBannerText(text: string): { number: number; label: string; tagline: string } {
  const match = text.match(/^#?(\d+)\s+(.+?)\s*[—–-]\s*(.+)$/);
  if (match) {
    return { number: parseInt(match[1]), label: match[2].trim(), tagline: match[3].trim() };
  }
  const fallback = text.match(/^#?(\d+)\s+(.+)$/);
  return fallback
    ? { number: parseInt(fallback[1]), label: fallback[2].trim(), tagline: "" }
    : { number: 0, label: text, tagline: "" };
}

function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseTimeInput(str: string): number {
  const parts = str.trim().split(":");
  if (parts.length === 2) {
    const m = parseInt(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(str) || 0;
}

function isValidTimeInput(str: string): boolean {
  return /^\d+:\d{2}(\.\d+)?$/.test(str.trim());
}

function buildAssignments(
  scenePlan: ScenePlan,
  sectionPlan: SectionPlan | null,
  overrides: any
): { callouts: OverlayAssignment[]; ctas: OverlayAssignment[]; banners: OverlayAssignment[] } {
  const allBeats = scenePlan.beats.filter((b) => b.type === "clip" || b.type === "image");
  let concatTime = 0;
  const beatsWithConcat = allBeats.map((b) => {
    const beat = { ...b, concatStart: concatTime, concatEnd: concatTime + b.duration };
    concatTime += b.duration;
    return beat;
  });

  const callouts: OverlayAssignment[] = [];
  const ctas: OverlayAssignment[] = [];
  const banners: OverlayAssignment[] = [];

  for (const beat of scenePlan.beats) {
    if (beat.overlay?.type === "number_callout" && beat.overlay.number) {
      const targetBeat = beatsWithConcat.find((b) => b.id === beat.id);
      if (targetBeat) {
        // showAt is relative to beat.startTime (offset within the beat).
        // Reconstruct absolute SRT time for display: startTime + showAt.
        const srtTime = targetBeat.startTime + (beat.overlay.showAt || 0);
        callouts.push({
          id: `callout_${beat.overlay.number}`,
          type: "number_callout",
          beatId: beat.id,
          showAt: srtTime - targetBeat.startTime,
          srtTime,
          label: `#${beat.overlay.number}`,
          number: beat.overlay.number,
          enabled: true,
          beatStart: targetBeat.concatStart,
          beatDuration: targetBeat.duration,
          concatStart: targetBeat.concatStart,
        });
      }
    }
  }

  for (const beat of scenePlan.beats) {
    if (beat.overlay?.type === "subscribe_cta") {
      const targetBeat = beatsWithConcat.find((b) => b.id === beat.id);
      if (targetBeat) {
        ctas.push({
          id: `cta_${beat.id}`,
          type: "subscribe_cta",
          beatId: beat.id,
          showAt: 0,
          label: beat.overlay.label || "Subscribe to our channel!",
          enabled: true,
          beatStart: targetBeat.concatStart,
          beatDuration: targetBeat.duration,
          concatStart: targetBeat.concatStart,
        });
      }
    }
  }

  if (sectionPlan?.sections) {
    for (const section of sectionPlan.sections) {
      if (section.type !== "list") continue;
      const containingBeat = beatsWithConcat.find(
        (b) => b.startTime <= section.startTime && b.startTime + b.duration > section.startTime && b.overlay?.type !== "number_callout"
      );
      if (containingBeat) {
        const parsed = parseBannerText(section.bannerText || section.label || `Item ${section.number}`);
        banners.push({
          id: `banner_${section.number}`,
          type: "item_banner",
          beatId: containingBeat.id,
          showAt: 0,
          label: `#${parsed.number} ${titleCase(parsed.label)}${parsed.tagline ? ` — ${titleCase(parsed.tagline)}` : ""}`,
          number: parsed.number,
          enabled: true,
          beatStart: containingBeat.concatStart,
          beatDuration: containingBeat.duration,
          concatStart: containingBeat.concatStart,
        });
      }
    }
  }

  const applyOverridesToList = (list: OverlayAssignment[], overrides: any[], type: string) => {
    const result = list.map((item) => {
      const ov = overrides.find((o) => o.beatId === item.beatId && o.type === type);
      if (ov && ov.enabled !== false) {
        return { ...item, ...ov, enabled: ov.enabled ?? true };
      }
      if (ov && ov.enabled === false) {
        return { ...item, enabled: false };
      }
      return item;
    });
    // Add override items whose beatId doesn't exist in the section-generated list
    for (const ov of overrides) {
      if (ov.type !== type || ov.enabled === false) continue;
      if (result.some((item) => item.beatId === ov.beatId)) continue;
      const targetBeat = beatsWithConcat.find((b) => b.id === ov.beatId);
      if (targetBeat) {
        result.push({
          id: `${type}_${ov.beatId}`,
          type: type as any,
          beatId: ov.beatId,
          showAt: ov.showAt ?? 0,
          srtTime: ov.showAt ? targetBeat.startTime + ov.showAt : targetBeat.startTime,
          label: ov.label || "",
          number: ov.number,
          enabled: ov.enabled ?? true,
          beatStart: targetBeat.concatStart,
          beatDuration: targetBeat.duration,
          concatStart: targetBeat.concatStart,
        });
      }
    }
    return result;
  };

  return {
    callouts: applyOverridesToList(callouts, overrides?.callouts ?? [], "number_callout"),
    ctas: applyOverridesToList(ctas, overrides?.ctas ?? [], "subscribe_cta"),
    banners: applyOverridesToList(banners, overrides?.banners ?? [], "item_banner"),
  };
}

function getBeatLabel(b: { id: string; startTime: number; duration: number; concatStart: number }) {
  return `${b.id} (${formatTime(b.concatStart)})`;
}

export const OverlayEditor: React.FC<OverlayEditorProps> = ({
  scenePlan,
  sectionPlan,
  projectId,
  beatTextSegments,
  onComplete,
  onBack,
}) => {
  const { overrides, load, save } = useOverlayOverrides();
  const [assignments, setAssignments] = useState<{
    callouts: OverlayAssignment[];
    ctas: OverlayAssignment[];
    banners: OverlayAssignment[];
  }>({ callouts: [], ctas: [], banners: [] });
  const [beatsWithConcat, setBeatsWithConcat] = useState<any[]>([]);
  const [timeInputs, setTimeInputs] = useState<Record<string, string>>({});
  const [lastDeleted, setLastDeleted] = useState<{ item: OverlayAssignment; list: "callouts" | "ctas" | "banners" } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(0);
  const [showAutoDetectConfirm, setShowAutoDetectConfirm] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showBulkBanners, setShowBulkBanners] = useState(false);
  const [bulkBannerText, setBulkBannerText] = useState("");

  useEffect(() => {
    load(projectId);
    const allBeats = scenePlan.beats.filter((b) => b.type === "clip" || b.type === "image");
    let concatTime = 0;
    const bwc = allBeats.map((b) => {
      const beat = { ...b, concatStart: concatTime, concatEnd: concatTime + b.duration };
      concatTime += b.duration;
      return beat;
    });
    setBeatsWithConcat(bwc);
  }, [scenePlan, load, projectId]);

  useEffect(() => {
    if (!overrides && !sectionPlan) return;
    const merged = buildAssignments(scenePlan, sectionPlan, overrides);
    setAssignments(merged);
  }, [scenePlan, sectionPlan, overrides, beatsWithConcat]);

  const updateItem = useCallback((list: "callouts" | "ctas" | "banners", id: string, patch: Partial<OverlayAssignment>) => {
    setAssignments((prev) => ({
      ...prev,
      [list]: prev[list].map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
    setHasChanges(true);
  }, []);

  const deleteItem = useCallback((list: "callouts" | "ctas" | "banners", id: string) => {
    const item = assignments[list].find((a) => a.id === id);
    if (!item) return;
    setLastDeleted({ item, list });
    setAssignments((prev) => ({
      ...prev,
      [list]: prev[list].filter((a) => a.id !== id),
    }));
    setHasChanges(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoCountdown(30);
    const timer = setTimeout(() => {
      setLastDeleted(null);
      setUndoCountdown(0);
      undoTimerRef.current = null;
    }, 30000);
    undoTimerRef.current = timer;
  }, [assignments]);

  const undoDelete = useCallback(() => {
    if (!lastDeleted) return;
    setAssignments((prev) => ({
      ...prev,
      [lastDeleted.list]: [...prev[lastDeleted.list], lastDeleted.item],
    }));
    setLastDeleted(null);
    setUndoCountdown(0);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
  }, [lastDeleted]);

  useEffect(() => {
    if (undoCountdown <= 0) return;
    const interval = setInterval(() => {
      setUndoCountdown((prev) => {
        if (prev <= 1) {
          if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
          setLastDeleted(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [undoCountdown > 0]);

  const addCta = () => {
    const newId = `cta_new_${Date.now()}`;
    const newCta: OverlayAssignment = {
      id: newId,
      type: "subscribe_cta",
      beatId: beatsWithConcat[0]?.id || "",
      showAt: 0,
      label: "Subscribe to our channel!",
      enabled: true,
      beatStart: beatsWithConcat[0]?.concatStart || 0,
      beatDuration: beatsWithConcat[0]?.duration || 0,
      concatStart: beatsWithConcat[0]?.concatStart || 0,
    };
    setAssignments((prev) => ({ ...prev, ctas: [...prev.ctas, newCta] }));
    setHasChanges(true);
  };

  const addBanner = () => {
    const nextNum = assignments.banners.length + 1;
    const newId = `banner_new_${Date.now()}`;
    const newBanner: OverlayAssignment = {
      id: newId,
      type: "item_banner",
      beatId: beatsWithConcat[0]?.id || "",
      showAt: 0,
      label: `#${nextNum} Item ${nextNum}`,
      number: nextNum,
      enabled: true,
      beatStart: beatsWithConcat[0]?.concatStart || 0,
      beatDuration: beatsWithConcat[0]?.duration || 0,
      concatStart: beatsWithConcat[0]?.concatStart || 0,
    };
    setAssignments((prev) => ({ ...prev, banners: [...prev.banners, newBanner] }));
    setHasChanges(true);
  };

  const applyBulkBannerTimes = () => {
    const lines = bulkBannerText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setShowBulkBanners(false); return; }
    let lineIdx = 0;
    setAssignments((prev) => ({
      ...prev,
      banners: prev.banners.map((b) => {
        if (lineIdx >= lines.length) return b;
        const value = lines[lineIdx];
        lineIdx++;
        if (!isValidTimeInput(value)) return b;
        const absoluteTime = parseTimeInput(value);
        const beat = beatsWithConcat.find((bw) => bw.id === b.beatId);
        if (!beat) return b;
        const showAt = absoluteTime - beat.startTime;
        return { ...b, showAt };
      }),
    }));
    setShowBulkBanners(false);
    setBulkBannerText("");
    setHasChanges(true);
  };

  const handleTimeChange = useCallback((list: "callouts" | "ctas" | "banners", id: string, value: string) => {
    setTimeInputs((prev) => ({ ...prev, [id]: value }));
    setHasChanges(true);
    if (isValidTimeInput(value)) {
      const item = assignments[list].find((a) => a.id === id);
      if (item) {
        const beat = beatsWithConcat.find((b) => b.id === item.beatId);
        if (beat) {
          const absoluteTime = parseTimeInput(value);
          const showAt = absoluteTime - beat.startTime;
          updateItem(list, id, { showAt });
        }
      }
    }
  }, [assignments, beatsWithConcat, updateItem]);

  const getTimeDisplay = useCallback((item: OverlayAssignment): string => {
    const input = timeInputs[item.id];
    if (input !== undefined) return input;
    return formatTime(item.beatStart + item.showAt);
  }, [timeInputs]);

  const isTimeValid = useCallback((id: string): boolean => {
    const input = timeInputs[id];
    if (input === undefined) return true;
    return isValidTimeInput(input);
  }, [timeInputs]);

  const handleAutoDetect = () => {
    setShowAutoDetectConfirm(true);
  };

  const confirmAutoDetect = () => {
    const fresh = buildAssignments(scenePlan, sectionPlan, null);
    setAssignments(fresh);
    setShowAutoDetectConfirm(false);
    setTimeInputs({});
    setHasChanges(true);
  };

  const handleBack = useCallback(() => {
    if (hasChanges) {
      setShowUnsavedWarning(true);
    } else {
      onBack();
    }
  }, [hasChanges, onBack]);

  const handleSave = async () => {
    const overridesData = {
      projectId,
      callouts: assignments.callouts.map((a) => ({
        beatId: a.beatId,
        type: "number_callout" as const,
        showAt: a.showAt,
        label: a.label,
        number: a.number,
        enabled: true,
      })),
      banners: assignments.banners.map((a) => ({
        beatId: a.beatId,
        type: "item_banner" as const,
        showAt: a.showAt,
        label: a.label,
        enabled: true,
      })),
      ctas: assignments.ctas.map((a) => ({
        beatId: a.beatId,
        type: "subscribe_cta" as const,
        showAt: a.showAt,
        label: a.label,
        enabled: true,
      })),
      lastModified: Date.now(),
    };
    await save(overridesData);
    onComplete();
  };

  const beatOptions = useMemo(() =>
    beatsWithConcat
      .filter((b) => b.type === "clip" || b.type === "image")
      .map((b) => ({ value: b.id, label: getBeatLabel(b) })),
    [beatsWithConcat]
  );

  const activeCount = assignments.callouts.length + assignments.ctas.length + assignments.banners.length;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-xl border border-zinc-700 max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Overlay Editor</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {activeCount} overlays · Adjust timing and labels for each beat.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAutoDetect}
              className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
            >
              ↻ Auto-Detect
            </button>
            <button onClick={handleBack} className="text-zinc-500 hover:text-zinc-300 text-lg px-2">✕</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
          {/* NUMBER CALLOUTS */}
          {assignments.callouts.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 mb-2">
                NUMBER CALLOUTS <span className="text-zinc-600">({assignments.callouts.length})</span>
              </h3>
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[32px_160px_72px_1fr_24px] gap-2 px-3 py-1.5 bg-zinc-800/50 text-[10px] text-zinc-500 font-medium">
                  <span>#</span>
                  <span>Beat</span>
                  <span>Time</span>
                  <span>Label</span>
                  <span></span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {assignments.callouts.map((item) => {
                    const timeValid = isTimeValid(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`group grid grid-cols-[32px_160px_72px_1fr_24px] gap-2 items-center px-3 py-1 border-t border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${
                          lastDeleted?.item.id === item.id ? "bg-amber-500/5" : ""
                        }`}
                      >
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-center bg-red-500/20 text-red-300">
                          #{item.number ?? "?"}
                        </span>
                        <select
                          value={item.beatId}
                          onChange={(e) => {
                            const newBeat = beatsWithConcat.find((b) => b.id === e.target.value);
                            if (newBeat) {
                              updateItem("callouts", item.id, {
                                beatId: e.target.value,
                                beatStart: newBeat.concatStart,
                                beatDuration: newBeat.duration,
                                concatStart: newBeat.concatStart,
                              });
                            }
                          }}
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                        >
                          {beatOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={getTimeDisplay(item)}
                          onChange={(e) => handleTimeChange("callouts", item.id, e.target.value)}
                          className={`w-[72px] bg-zinc-800 border rounded px-2 py-0.5 text-[11px] text-zinc-200 tabular-nums focus:outline-none focus:border-amber-500 ${
                            !timeValid ? "border-red-500 text-red-400" : "border-zinc-700"
                          }`}
                          placeholder="0:00"
                        />
                        <span className="text-[11px] text-zinc-500 px-2 truncate min-w-0" title={beatTextSegments[item.beatId] ?? ""}>
                          {beatTextSegments[item.beatId] ?? "—"}
                        </span>
                        <button
                          onClick={() => deleteItem("callouts", item.id)}
                          className="p-0.5 rounded text-zinc-700 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* SUBSCRIBE CTA */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 mb-2">
              SUBSCRIBE CTA <span className="text-zinc-600">({assignments.ctas.length})</span>
            </h3>
            {assignments.ctas.length > 0 ? (
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[32px_160px_72px_1fr_24px] gap-2 px-3 py-1.5 bg-zinc-800/50 text-[10px] text-zinc-500 font-medium">
                  <span>#</span>
                  <span>Beat</span>
                  <span>Time</span>
                  <span>Label</span>
                  <span></span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {assignments.ctas.map((item) => {
                    const timeValid = isTimeValid(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`group grid grid-cols-[32px_160px_72px_1fr_24px] gap-2 items-center px-3 py-1 border-t border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${
                          lastDeleted?.item.id === item.id ? "bg-amber-500/5" : ""
                        }`}
                      >
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-center bg-blue-500/20 text-blue-300">
                          CTA
                        </span>
                        <select
                          value={item.beatId}
                          onChange={(e) => {
                            const newBeat = beatsWithConcat.find((b) => b.id === e.target.value);
                            if (newBeat) {
                              updateItem("ctas", item.id, {
                                beatId: e.target.value,
                                beatStart: newBeat.concatStart,
                                beatDuration: newBeat.duration,
                                concatStart: newBeat.concatStart,
                              });
                            }
                          }}
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                        >
                          {beatOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={getTimeDisplay(item)}
                          onChange={(e) => handleTimeChange("ctas", item.id, e.target.value)}
                          className={`w-[72px] bg-zinc-800 border rounded px-2 py-0.5 text-[11px] text-zinc-200 tabular-nums focus:outline-none focus:border-amber-500 ${
                            !timeValid ? "border-red-500 text-red-400" : "border-zinc-700"
                          }`}
                          placeholder="0:00"
                        />
                        <input
                          type="text"
                          value={item.label}
                          onChange={(e) => updateItem("ctas", item.id, { label: e.target.value })}
                          className="min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                        />
                        <button
                          onClick={() => deleteItem("ctas", item.id)}
                          className="p-0.5 rounded text-zinc-700 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-600 mb-2">No CTAs detected.</p>
            )}
            <button
              onClick={addCta}
              className="mt-2 text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
            >
              + Add CTA
            </button>
          </div>

          {/* ITEM BANNERS */}
          {assignments.banners.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 mb-2">
                ITEM BANNERS <span className="text-zinc-600">({assignments.banners.length})</span>
              </h3>
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[32px_160px_72px_1fr_24px] gap-2 px-3 py-1.5 bg-zinc-800/50 text-[10px] text-zinc-500 font-medium">
                  <span>#</span>
                  <span>Beat</span>
                  <span>Time</span>
                  <span>Label</span>
                  <span></span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {assignments.banners.map((item) => {
                    const timeValid = isTimeValid(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`group grid grid-cols-[32px_160px_72px_1fr_24px] gap-2 items-center px-3 py-1 border-t border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${
                          lastDeleted?.item.id === item.id ? "bg-amber-500/5" : ""
                        }`}
                      >
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-center bg-emerald-500/20 text-emerald-300">
                          {item.number ?? "?"}
                        </span>
                        <select
                          value={item.beatId}
                          onChange={(e) => {
                            const newBeat = beatsWithConcat.find((b) => b.id === e.target.value);
                            if (newBeat) {
                              updateItem("banners", item.id, {
                                beatId: e.target.value,
                                beatStart: newBeat.concatStart,
                                beatDuration: newBeat.duration,
                                concatStart: newBeat.concatStart,
                              });
                            }
                          }}
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                        >
                          {beatOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={getTimeDisplay(item)}
                          onChange={(e) => handleTimeChange("banners", item.id, e.target.value)}
                          className={`w-[72px] bg-zinc-800 border rounded px-2 py-0.5 text-[11px] text-zinc-200 tabular-nums focus:outline-none focus:border-amber-500 ${
                            !timeValid ? "border-red-500 text-red-400" : "border-zinc-700"
                          }`}
                          placeholder="0:00"
                        />
                        <input
                          type="text"
                          value={item.label}
                          onChange={(e) => updateItem("banners", item.id, { label: e.target.value })}
                          className="min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                        />
                        <button
                          onClick={() => deleteItem("banners", item.id)}
                          className="p-0.5 rounded text-zinc-700 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={addBanner}
                  className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                >
                  + Add Banner
                </button>
                <button
                  onClick={() => setShowBulkBanners(true)}
                  className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                >
                  + Bulk Edit Times
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {assignments.callouts.length === 0 && assignments.ctas.length === 0 && assignments.banners.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-8">
              No overlays detected. Click Auto-Detect to re-scan.
            </p>
          )}
        </div>

        {/* Undo bar */}
        {lastDeleted && (
          <div className="flex items-center gap-3 px-6 py-2 bg-amber-500/10 border-t border-amber-500/20">
            <span className="text-xs text-amber-400">
              Deleted {lastDeleted.item.label}
            </span>
            <button
              onClick={undoDelete}
              className="text-xs px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
            >
              ↩ Undo ({undoCountdown}s)
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
          <span className="text-xs text-zinc-500">
            {activeCount} overlays
            {assignments.callouts.length > 0 && <span className="text-red-400"> · {assignments.callouts.length} callouts</span>}
            {assignments.ctas.length > 0 && <span className="text-blue-400"> · {assignments.ctas.length} CTA</span>}
            {assignments.banners.length > 0 && <span className="text-emerald-400"> · {assignments.banners.length} banners</span>}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleBack}
              className="text-xs px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >← Back</button>
            <button
              onClick={handleSave}
              className="text-xs px-4 py-2 rounded-md bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-zinc-900 font-semibold transition-colors"
            >Apply & Continue ▶</button>
          </div>
        </div>
      </div>

      {/* Auto-detect confirmation */}
      {showAutoDetectConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setShowAutoDetectConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-zinc-100 mb-2">Reset Overlays?</h3>
            <p className="text-xs text-zinc-500 mb-4">
              This will reset all overlays to auto-detected values. Your manual edits will be lost.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAutoDetectConfirm(false)}
                className="text-xs px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAutoDetect}
                className="text-xs px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes warning */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setShowUnsavedWarning(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-zinc-100 mb-2">Unsaved Changes</h3>
            <p className="text-xs text-zinc-500 mb-4">
              You have unsaved overlay changes. Discard?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowUnsavedWarning(false)}
                className="text-xs px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                Keep Editing
              </button>
              <button
                onClick={() => { setShowUnsavedWarning(false); onBack(); }}
                className="text-xs px-4 py-2 rounded-md bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-400 font-semibold transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit banner times */}
      {showBulkBanners && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setShowBulkBanners(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-zinc-100 mb-2">Bulk Edit Banner Times</h3>
            <p className="text-xs text-zinc-500 mb-3">
              Paste banner start times, one per line. Line 1 = #1, line 2 = #2, etc.
              <br />Format: m:ss (e.g. 1:15, 3:27)
            </p>
            <textarea
              value={bulkBannerText}
              onChange={(e) => setBulkBannerText(e.target.value)}
              rows={12}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-amber-500 resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { setShowBulkBanners(false); setBulkBannerText(""); }}
                className="text-xs px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyBulkBannerTimes}
                className="text-xs px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
              >
                Apply to {assignments.banners.length} banners
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OverlayEditor;
