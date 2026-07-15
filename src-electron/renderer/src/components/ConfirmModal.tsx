import React, { useEffect, useRef } from "react";

interface ConfirmModalProps {
	title: string;
	message: React.ReactNode;
	confirmLabel: string;
	onConfirm: (inputValue?: string) => void;
	onCancel: () => void;
	inputLabel?: string;
	inputValue?: string;
	onInputChange?: (value: string) => void;
	isListicle?: boolean;
	onListicleChange?: (v: boolean) => void;
	showListicle?: boolean;
}

export default function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, inputLabel, inputValue, onInputChange, isListicle, onListicleChange, showListicle }: ConfirmModalProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const hasInput = !!inputLabel;
	const inputEmpty = hasInput && (!inputValue || !inputValue.trim());

	useEffect(() => {
		if (hasInput && inputRef.current) {
			inputRef.current.focus();
		}
	}, [hasInput]);

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
			<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
				<h3 className="text-lg font-semibold text-zinc-200 mb-2">{title}</h3>
				<div className="text-sm text-zinc-400 mb-4">{message}</div>
				{hasInput && (
					<div className="mb-4">
						<label className="block text-xs font-medium text-zinc-500 mb-1.5">{inputLabel}</label>
						<input
							ref={inputRef}
							type="text"
							value={inputValue ?? ""}
							onChange={(e) => onInputChange?.(e.target.value)}
							placeholder="Enter video name"
							className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 transition-colors"
						/>
						{inputValue?.trim() && (
							<div className="text-[11px] text-zinc-500 mt-1.5 pl-0.5">→ {inputValue.trim().replace(/\s+/g, "_")}.mp4</div>
						)}
					</div>
				)}
				{showListicle && onListicleChange && (
					<label className="flex items-center gap-2 text-xs text-zinc-400 mt-2 mb-2 cursor-pointer select-none">
						<input type="checkbox" checked={!!isListicle} onChange={(e) => onListicleChange(e.target.checked)} className="accent-amber-500" />
						Listicle Video (generate section plan first)
					</label>
				)}
				<div className="flex gap-3 justify-end">
					<button onClick={onCancel} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-medium text-zinc-300">Cancel</button>
					<button
						onClick={() => onConfirm(inputValue)}
						disabled={inputEmpty}
						className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${inputEmpty ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" : "bg-amber-500 hover:bg-amber-400 text-black"}`}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
