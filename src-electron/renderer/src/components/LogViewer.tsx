import React, { useRef, useEffect, useState, useCallback } from "react";

interface LogViewerProps {
  logs: string[];
}

const MIN_HEIGHT = 128;
const MAX_HEIGHT_RATIO = 0.6;

function getLineColor(line: string): string {
  if (line.includes("ERROR") || line.includes(" failed:")) return "text-red-400";
  if (line.includes("WARNING") || line.includes("Retrying")) return "text-yellow-500";
  if (line.includes("from pexels")) return "text-green-400";
  if (line.includes("from pixabay")) return "text-purple-400";
  if (line.includes("trying") || line.includes("no results")) return "text-cyan-400";
  if (line.includes("downloading") && line.includes("%")) return "text-blue-400";
  if (line.includes("done —")) return "text-emerald-400";
  if (line.includes("Asset") && line.includes("complete")) return "text-zinc-300";
  return "text-zinc-400";
}

export default function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(192);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    setAutoScroll(atBottom);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
  }, [height]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(window.innerHeight * MAX_HEIGHT_RATIO, dragStartHeight.current + delta));
      setHeight(Math.round(newHeight));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const jumpToBottom = useCallback(() => {
    setAutoScroll(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  return (
    <div ref={containerRef} className="border-t border-zinc-800 bg-zinc-950 flex flex-col" style={{ height }}>
      <div
        className={`h-2 cursor-row-resize flex items-center justify-center hover:bg-zinc-800 transition-colors ${isDragging ? "bg-zinc-800" : ""}`}
        onMouseDown={handleMouseDown}
      >
        <div className="w-8 h-0.5 rounded-full bg-zinc-600" />
      </div>
      <div className="px-3 py-1 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Log</span>
        <span className="text-[10px] text-zinc-600">{logs.length} entries</span>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} className="h-full overflow-y-auto p-3 font-mono text-xs space-y-0.5" onScroll={handleScroll}>
          {logs.length === 0 && (
            <div className="text-zinc-600">Waiting for pipeline output...</div>
          )}
          {logs.map((line, i) => (
            <div key={i} className={getLineColor(line)}>
              {line}
            </div>
          ))}
        </div>
        {!autoScroll && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-2 right-3 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[10px] text-zinc-300 border border-zinc-700 transition-colors"
          >
            ↓ Bottom
          </button>
        )}
      </div>
    </div>
  );
}
