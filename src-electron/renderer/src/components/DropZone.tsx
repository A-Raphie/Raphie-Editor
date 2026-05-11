import React, { useState, useCallback } from "react";

const SCRIPT_EXTENSIONS = [".txt", ".md", ".docx", ".pdf", ".rtf"];
const SRT_EXTENSIONS = [".srt"];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];

function getExtension(filename: string): string {
	const idx = filename.toLowerCase().lastIndexOf(".");
	return idx >= 0 ? filename.toLowerCase().substring(idx) : "";
}

interface FileRowProps {
	label: string;
	icon: string;
	value: string | null;
	placeholder: string;
	onBrowse: () => void;
	accepted: boolean;
}

function FileRow({ label, icon, value, placeholder, onBrowse, accepted }: FileRowProps) {
	return (
		<div className={`flex items-center gap-4 bg-zinc-800/50 border rounded-xl px-5 py-4 transition-all shadow-sm ${accepted ? "border-emerald-500/50 bg-emerald-500/5" : "border-zinc-700/50 hover:border-zinc-600 hover:shadow-md"}`}>
			<div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accepted ? "bg-emerald-500/20" : "bg-zinc-700/50"}`}>
				<span className={`text-lg ${accepted ? "text-emerald-400" : "text-zinc-500"}`}>{accepted ? "✓" : icon}</span>
			</div>
			<div className="flex-1 min-w-0">
				<span className={`text-[10px] font-semibold uppercase tracking-wide block ${accepted ? "text-emerald-400" : "text-zinc-500"}`}>{label}</span>
				<span className={`text-sm truncate block ${accepted ? "text-zinc-200" : "text-zinc-500"}`}>{value ? value.split("/").pop() : placeholder}</span>
			</div>
			<button
				onClick={onBrowse}
				className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-all ${accepted ? "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"}`}
			>
				Browse
			</button>
		</div>
	);
}

interface DropZoneProps {
	scriptPath: string | null;
	voPath: string | null;
	musicPath: string | null;
	srtPath: string | null;
	onFilesSelected: (files: Record<string, string>) => void;
	onPreview: () => void;
	canPreview: boolean;
}

export default function DropZone({ scriptPath, voPath, musicPath, srtPath, onFilesSelected, onPreview, canPreview }: DropZoneProps) {
	const [dragging, setDragging] = useState(false);

	const handleDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		setDragging(false);
		const files: Record<string, string> = {};
		for (const f of Array.from(e.dataTransfer.files)) {
			const ext = getExtension(f.name);
			let filePath = "";
			try {
				filePath = await window.api.getPathForFile(f);
			} catch {
				continue;
			}
			if (!filePath) continue;
			if (SRT_EXTENSIONS.includes(ext)) files.srt = filePath;
			else if (SCRIPT_EXTENSIONS.includes(ext)) files.script = filePath;
			else if (AUDIO_EXTENSIONS.includes(ext)) {
				if (!files.vo) files.vo = filePath;
				else files.music = filePath;
			}
		}
		onFilesSelected(files);
	}, [onFilesSelected]);

	const handleBrowseSrt = useCallback(async () => {
		const paths = await window.api.selectFiles({ filters: [{ name: "Subtitles", extensions: ["srt"] }, { name: "All Files", extensions: ["*"] }] });
		if (paths?.[0]) onFilesSelected({ srt: paths[0] });
	}, [onFilesSelected]);

	const handleBrowseScript = useCallback(async () => {
		const paths = await window.api.selectFiles({ filters: [{ name: "Documents", extensions: ["txt", "md", "docx", "pdf", "rtf"] }, { name: "All Files", extensions: ["*"] }] });
		if (paths?.[0]) onFilesSelected({ script: paths[0] });
	}, [onFilesSelected]);

	const handleBrowseVO = useCallback(async () => {
		const paths = await window.api.selectFiles({ filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }] });
		if (paths?.[0]) onFilesSelected({ vo: paths[0] });
	}, [onFilesSelected]);

	const handleBrowseMusic = useCallback(async () => {
		const paths = await window.api.selectFiles({ filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a"] }] });
		if (paths?.[0]) onFilesSelected({ music: paths[0] });
	}, [onFilesSelected]);

	return (
		<div className="flex-1 flex flex-col items-center justify-center p-8">
			<div
				className={`w-full max-w-xl border-2 border-dashed rounded-2xl p-14 text-center transition-all duration-200 ${dragging ? "border-amber-500 bg-amber-500/10 scale-[1.02] shadow-lg shadow-amber-500/10" : "border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/30"}`}
				style={{ minHeight: "280px" }}
				onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
				onDragLeave={() => setDragging(false)}
				onDrop={handleDrop}
			>
				<div className="text-6xl mb-5">🎬</div>
				<h2 className="text-xl font-semibold text-zinc-200 mb-2">Drop your files here</h2>
				<p className="text-zinc-500 text-sm mb-2">Drop subtitles (.srt) or script (.txt, .docx) and voiceover (.mp3, .wav)</p>
				<p className="text-zinc-600 text-xs">or use the buttons below to browse</p>
			</div>
			<div className="w-full max-w-xl mt-8 space-y-3">
				<FileRow label="SRT Subtitles (preferred)" icon="💬" value={srtPath} placeholder="No SRT file selected" onBrowse={handleBrowseSrt} accepted={!!srtPath} />
				<FileRow label="Script (alternative)" icon="📄" value={scriptPath} placeholder="No script selected" onBrowse={handleBrowseScript} accepted={!!scriptPath} />
				<FileRow label="Voiceover" icon="🎤" value={voPath} placeholder="No voiceover selected" onBrowse={handleBrowseVO} accepted={!!voPath} />
				<FileRow label="Background Music" icon="🎵" value={musicPath} placeholder="No music selected (optional)" onBrowse={handleBrowseMusic} accepted={!!musicPath} />
			</div>
			<button
				onClick={onPreview}
				disabled={!canPreview}
				className={`mt-8 px-10 py-3.5 rounded-xl font-semibold text-sm transition-all shadow-lg hover:shadow-xl ${canPreview ? "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}
			>
				✨ Preview Scene Plan
			</button>
		</div>
	);
}
