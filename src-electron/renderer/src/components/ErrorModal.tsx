import React from "react";

interface ErrorModalProps {
	title?: string;
	message: string;
	onDismiss: () => void;
	actionLabel?: string;
	onAction?: () => void;
}

export default function ErrorModal({ title = "Error", message, onDismiss, actionLabel, onAction }: ErrorModalProps) {
	return (
		<div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onDismiss}>
			<div className="bg-zinc-900 rounded-xl w-[440px] border border-zinc-700/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
				<div className="p-6">
					<div className="flex items-center gap-4 mb-4">
						<div className="w-12 h-12 rounded-xl bg-red-500/15 flex items-center justify-center">
							<span className="text-2xl">⚠️</span>
						</div>
						<h3 className="text-lg font-bold text-zinc-100">{title}</h3>
					</div>
					<p className="text-sm text-zinc-300 leading-relaxed ml-16">{message}</p>
				</div>
				<div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-800/50 bg-zinc-900/50">
					<button onClick={onDismiss} className="px-5 py-2.5 rounded-xl text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all">Dismiss</button>
					{actionLabel && onAction && (
						<button onClick={onAction} className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 rounded-xl text-sm font-semibold text-zinc-900 shadow-lg hover:shadow-xl transition-all">{actionLabel}</button>
					)}
				</div>
			</div>
		</div>
	);
}
