import React, { useState } from "react";
import type { SavedProject } from "../../../shared/types";

function statusBadgeColor(status: string): string {
	switch (status) {
		case "complete": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
		case "rendering": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
		case "editing": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
		case "planning": return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
		case "error": return "bg-red-500/20 text-red-400 border-red-500/30";
		default: return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
	}
}

function statusLabel(status: string): string {
	switch (status) {
		case "complete": return "Complete";
		case "rendering": return "Rendering";
		case "editing": return "Editing";
		case "planning": return "Planning";
		case "error": return "Error";
		default: return status;
	}
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	const diffMs = new Date().getTime() - d.getTime();
	const diffMin = Math.floor(diffMs / 60000);
	if (diffMin < 1) return "Just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHrs = Math.floor(diffMin / 60);
	if (diffHrs < 24) return `${diffHrs}h ago`;
	const diffDays = Math.floor(diffHrs / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return d.toLocaleDateString();
}

interface ProjectCardProps {
	project: SavedProject;
	onOpen: (project: SavedProject) => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
	onAddToQueue?: (project: SavedProject) => void;
}

function ProjectCard({ project, onOpen, onRename, onDelete, onAddToQueue }: ProjectCardProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(project.name);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const scriptName = project.scriptPath?.split("/").pop() || project.srtPath?.split("/").pop() || "Untitled";

	const handleRename = () => {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== project.name) onRename(project.id, trimmed);
		setEditing(false);
	};

	return (
		<div className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-800/80 hover:shadow-lg transition-all duration-200 group">
			<div className="flex items-start justify-between mb-4">
				<div className="flex-1 min-w-0 mr-3">
					{editing ? (
						<input
							className="bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-zinc-100 w-full outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onBlur={handleRename}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleRename();
								if (e.key === "Escape") { setEditing(false); setDraft(project.name); }
							}}
							autoFocus
						/>
					) : (
						<h3 className="text-base font-semibold text-zinc-200 truncate cursor-pointer hover:text-white transition-colors" onDoubleClick={() => setEditing(true)} title="Double-click to rename">{project.name}</h3>
					)}
					<p className="text-xs text-zinc-500 mt-1.5 truncate">{scriptName}</p>
				</div>
				<span className={`text-[10px] uppercase tracking-wider font-medium px-2.5 py-1 rounded-md border ${statusBadgeColor(project.status)}`}>{statusLabel(project.status)}</span>
			</div>
			<div className="flex items-center justify-between">
				<span className="text-xs text-zinc-600">{formatDate(project.updatedAt)}</span>
				<div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
					<button className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-medium transition-colors" onClick={() => setEditing(true)}>Rename</button>
					{confirmDelete ? (
						<div className="flex gap-1">
							<button className="px-2.5 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-red-100 font-medium transition-colors" onClick={() => { onDelete(project.id); setConfirmDelete(false); }}>Confirm</button>
							<button className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors" onClick={() => setConfirmDelete(false)}>Cancel</button>
						</div>
					) : (
						<button className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-red-600 text-zinc-400 hover:text-red-100 font-medium transition-colors" onClick={() => setConfirmDelete(true)}>Delete</button>
					)}
					<button className="px-3 py-1.5 text-xs rounded-lg bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black font-semibold transition-all shadow-sm hover:shadow-md" onClick={() => onOpen(project)}>Open</button>
					{onAddToQueue && <button className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-medium transition-colors" onClick={() => onAddToQueue(project)}>+ Queue</button>}
				</div>
			</div>
		</div>
	);
}

interface ProjectsViewProps {
	projects: SavedProject[];
	onOpen: (project: SavedProject) => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
	onNew: () => void;
	onAddToQueue?: (project: SavedProject) => void;
}

export default function ProjectsView({ projects, onOpen, onRename, onDelete, onNew, onAddToQueue }: ProjectsViewProps) {
	return (
		<div className="flex-1 overflow-y-auto p-6">
			<div className="max-w-5xl mx-auto">
				<div className="flex items-center justify-between mb-8">
					<div className="flex items-center gap-4">
						<h2 className="text-2xl font-bold text-zinc-100 tracking-tight">Projects</h2>
						<span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-800/80 px-3 py-1.5 rounded-full border border-zinc-700/50">
							{projects.length} project{projects.length !== 1 ? "s" : ""}
						</span>
					</div>
					<button className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-lg text-sm font-semibold transition-all shadow-lg hover:shadow-xl" onClick={onNew}>+ New Project</button>
				</div>
				{projects.length === 0 ? (
					<div className="text-center py-24">
						<div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
							<span className="text-5xl opacity-40">📁</span>
						</div>
						<p className="text-zinc-400 text-base mb-2 font-medium">No projects yet</p>
						<p className="text-zinc-600 text-sm mb-1">Create a new project to get started</p>
						<p className="text-zinc-700 text-xs">Drop a script in the input screen to begin</p>
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
						{projects.map((p) => <ProjectCard key={p.id} project={p} onOpen={onOpen} onRename={onRename} onDelete={onDelete} onAddToQueue={onAddToQueue} />)}
					</div>
				)}
			</div>
		</div>
	);
}
