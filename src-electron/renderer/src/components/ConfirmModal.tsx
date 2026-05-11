import React from "react";

interface ConfirmModalProps {
	title: string;
	message: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export default function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {
	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
			<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
				<h3 className="text-lg font-semibold text-zinc-200 mb-2">{title}</h3>
				<p className="text-sm text-zinc-400 mb-6">{message}</p>
				<div className="flex gap-3 justify-end">
					<button onClick={onCancel} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-medium text-zinc-300">Cancel</button>
					<button onClick={onConfirm} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-sm font-medium">{confirmLabel}</button>
				</div>
			</div>
		</div>
	);
}
