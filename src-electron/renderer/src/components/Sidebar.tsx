import React from "react";

interface SidebarProps {
	view: string;
	onNew: () => void;
	onProjects: () => void;
	onQueue: () => void;
	onSettings: () => void;
}

export default function Sidebar({ view, onNew, onProjects, onQueue, onSettings }: SidebarProps) {
	return (
		<div className="w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col">
			<div className="pt-8 pb-4 px-4 border-b border-zinc-800/50">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg">
						<span className="text-lg">🎬</span>
					</div>
					<div>
						<h1 className="text-base font-bold text-zinc-100 tracking-tight">Raphie's Editor</h1>
						<p className="text-[10px] text-zinc-500 uppercase tracking-wider">Documentary Pipeline</p>
					</div>
				</div>
			</div>
			<nav className="flex-1 p-3 space-y-1">
				<div className="text-[10px] uppercase tracking-wider text-zinc-600 px-3 mb-2 mt-2">Navigation</div>
				<button
					onClick={onNew}
					className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-all ${view === "input" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"}`}
				>
					<span className="text-base w-5 text-center">+</span>
					<span className="font-medium">New Project</span>
				</button>
				<button
					onClick={onProjects}
					className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-all ${view === "projects" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"}`}
				>
					<span className="text-base w-5 text-center">📁</span>
					<span className="font-medium">Projects</span>
				</button>
				<button
					onClick={onQueue}
					className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-all ${view === "queue" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"}`}
				>
					<span className="text-base w-5 text-center">📋</span>
						<span className="font-medium">Queue</span>
				</button>
				<div className="pt-4 pb-1">
					<div className="text-[10px] uppercase tracking-wider text-zinc-600 px-3">Settings</div>
				</div>
				<button
					onClick={onSettings}
					className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 flex items-center gap-2.5 transition-all"
				>
					<span className="text-base w-5 text-center">⚙</span>
					<span className="font-medium">Settings</span>
				</button>
			</nav>
		</div>
	);
}
