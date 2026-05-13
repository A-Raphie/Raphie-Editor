import React, { useState } from "react";
import type { AppSettings } from "../../../shared/types";

const inputCls = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all";
const labelCls = "block text-[10px] text-zinc-400 uppercase tracking-wider font-semibold mb-1.5";

interface SettingsProps {
	settings: AppSettings;
	onSave: (settings: AppSettings) => void;
	onClose: () => void;
}

export default function Settings({ settings, onSave, onClose }: SettingsProps) {
	const [tab, setTab] = useState<"api" | "general" | "advanced">("general");
	const [form, setForm] = useState<AppSettings>({ ...settings });
	const [clipInput, setClipInput] = useState(String(settings.clipPercent ?? 70));
	const [imageInput, setImageInput] = useState(String(settings.imagePercent ?? 30));
	const [apiKeysText, setApiKeysText] = useState((settings.openrouterApiKeys ?? []).join("\n"));

	const handleSubmit = () => {
		const cp = parseInt(clipInput) || 70;
		const ip = parseInt(imageInput) || 30;
		if (cp + ip !== 100) return;
		const keys = apiKeysText.split(/[\n,]/).map((k: string) => k.trim()).filter((k: string) => k.length > 0);
		onSave({ ...form, clipPercent: cp, imagePercent: ip, openrouterApiKeys: keys });
	};

	const percentValid = (parseInt(clipInput) || 70) + (parseInt(imageInput) || 30) === 100;

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
			<div className="bg-zinc-900 rounded-xl w-[600px] max-h-[85vh] border border-zinc-700 flex flex-col">
				<form className="flex flex-col flex-1 min-h-0">
					<div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
						<h2 className="text-lg font-bold text-zinc-100">Settings</h2>
						<button type="button" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">×</button>
					</div>

					<div className="flex border-b border-zinc-800 px-2">
						<button type="button" onClick={() => setTab("api")} className={`flex-1 px-5 py-3 text-sm font-medium transition-colors ${tab === "api" ? "text-amber-400 border-b-2 border-amber-400 bg-amber-400/5" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"}`}>API Keys</button>
						<button type="button" onClick={() => setTab("general")} className={`flex-1 px-5 py-3 text-sm font-medium transition-colors ${tab === "general" ? "text-amber-400 border-b-2 border-amber-400 bg-amber-400/5" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"}`}>General</button>
						<button type="button" onClick={() => setTab("advanced")} className={`flex-1 px-5 py-3 text-sm font-medium transition-colors ${tab === "advanced" ? "text-amber-400 border-b-2 border-amber-400 bg-amber-400/5" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"}`}>Advanced</button>
					</div>

					<div className="flex-1 overflow-y-auto px-5 pt-6 space-y-4">
						{tab === "api" && (
							<>
								<div>
									<label className={labelCls}>OpenRouter API Keys</label>
									<p className="text-[10px] text-zinc-600 mb-1">One key per line or comma-separated. More keys = faster chunk planning (2 concurrent per key)</p>
									<textarea
										value={apiKeysText}
										onChange={(e) => setApiKeysText(e.target.value)}
										rows={6}
										className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-amber-500 resize-y"
										placeholder={"sk-or-v1-...\nsk-or-v1-...\nsk-or-v1-..."}
									/>
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className={labelCls}>Pexels API Key</label>
										<input type="password" value={form.pexelsApiKey ?? ""} onChange={(e) => setForm({ ...form, pexelsApiKey: e.target.value })} className={inputCls} placeholder="pexels.com/api" />
									</div>
									<div>
										<label className={labelCls}>Pixabay API Key</label>
										<input type="password" value={form.pixabayApiKey ?? ""} onChange={(e) => setForm({ ...form, pixabayApiKey: e.target.value })} className={inputCls} placeholder="pixabay.com/api/docs" />
									</div>
								</div>
							</>
						)}

						{tab === "general" && (
							<>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className={labelCls}>Scene Planner Model</label>
										<select value={form.scenePlannerModel} onChange={(e) => setForm({ ...form, scenePlannerModel: e.target.value })} className={inputCls}>
											<option value="anthropic/claude-sonnet-4">Claude Sonnet 4 (~$3.00/hr)</option>
											<option value="anthropic/claude-haiku-4.5">Claude Haiku 4.5 (~$1.00/hr)</option>
											<option value="deepseek/deepseek-v4-flash">DeepSeek V4 Flash (~$0.08/hr)</option>
											<option value="qwen/qwen3-235b-a22b-2507">Qwen3 235B 2507 (~$0.03/hr)</option>
											<option value="google/gemma-3-4b-it">Gemma 3 4B (~$0.02/hr)</option>
											<option value="openrouter/owl-alpha">Owl Alpha (free)</option>
										</select>
									</div>
									<div>
										<label className={labelCls}>Quality Checker Model</label>
										<select value={form.qualityCheckerModel} onChange={(e) => setForm({ ...form, qualityCheckerModel: e.target.value })} className={inputCls}>
											<option value="google/gemini-2.5-flash">Gemini 2.5 Flash (~$3.30/hr)</option>
											<option value="openai/gpt-4o-mini">GPT-4o Mini (~$0.75/hr)</option>
											<option value="google/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (~$0.40/hr)</option>
											<option value="google/gemma-3-4b-it">Gemma 3 4B (~$0.08/hr)</option>
										</select>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<input type="checkbox" checked={form.enableQualityCheckOnPreview ?? true} onChange={(e) => setForm({ ...form, enableQualityCheckOnPreview: e.target.checked })} className="accent-blue-500" />
									<label className={labelCls}>Quality Check on Preview</label>
								</div>
								<div>
									<label className={labelCls}>Concurrency</label>
									<div className="grid grid-cols-4 gap-2 items-end">
										<div>
											<label className="block text-[10px] text-zinc-500 mb-1">Download</label>
											<input type="number" min={1} max={20} value={form.concurrency} onChange={(e) => setForm({ ...form, concurrency: parseInt(e.target.value) || 4 })} className={inputCls} />
										</div>
										<div>
											<label className="block text-[10px] text-zinc-500 mb-1">Preview</label>
											<input type="number" min={1} max={30} value={form.previewConcurrency ?? 10} onChange={(e) => setForm({ ...form, previewConcurrency: Math.min(30, Math.max(1, parseInt(e.target.value) || 10)) })} className={inputCls} />
										</div>
										<div>
											<label className="block text-[10px] text-zinc-500 mb-1">Frame</label>
											<input type="number" min={1} max={8} value={form.renderConcurrency ?? 3} onChange={(e) => setForm({ ...form, renderConcurrency: Math.min(8, Math.max(1, parseInt(e.target.value) || 3)) })} className={inputCls} />
										</div>
										<div>
											<label className={labelCls}>FPS</label>
											<select value={form.fps} onChange={(e) => setForm({ ...form, fps: parseInt(e.target.value) || 30 })} className={inputCls}>
												<option value={24}>24 fps</option>
												<option value={30}>30 fps</option>
												<option value={60}>60 fps</option>
											</select>
										</div>
									</div>
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className={labelCls}>Timeout (sec)</label>
										<input type="number" min={30} max={300} value={form.downloadTimeout ?? 90} onChange={(e) => setForm({ ...form, downloadTimeout: parseInt(e.target.value) || 90 })} className={inputCls} />
									</div>
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className={labelCls}>Video Codec</label>
										<select value={form.videoCodec ?? "h265"} onChange={(e) => setForm({ ...form, videoCodec: e.target.value })} className={inputCls}>
											<option value="h265">H.265 (HEVC, smaller)</option>
											<option value="h264">H.264 (more compatible)</option>
										</select>
									</div>
									<div>
										<label className={labelCls}>Segment Length</label>
										<select value={form.segmentLength ?? 900} onChange={(e) => setForm({ ...form, segmentLength: parseInt(e.target.value) })} className={inputCls}>
											<option value={0}>No Segments (single pass)</option>
											<option value={300}>10 seconds</option>
											<option value={900}>30 seconds</option>
											<option value={1800}>1 minute</option>
											<option value={3600}>2 minutes</option>
											<option value={9000}>5 minutes</option>
											<option value={18000}>10 minutes</option>
										</select>
									</div>
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className={labelCls}>Search Depth</label>
										<p className="text-[10px] text-zinc-600 mb-1">How many stock photos/videos to preview per beat. 5 is fast, 15 is thorough.</p>
										<input type="number" min={1} max={30} value={form.maxThumbnailsPerQuery ?? 5} onChange={(e) => setForm({ ...form, maxThumbnailsPerQuery: parseInt(e.target.value) || 5 })} className={inputCls} />
									</div>
									<div>
										<label className={labelCls}>Parallel Segments</label>
										<p className="text-[10px] text-zinc-600 mb-1">1-3. Higher values render faster but use more memory. Recommended: 1</p>
										<input type="number" min={1} max={3} value={form.parallelSegments ?? 1} onChange={(e) => setForm({ ...form, parallelSegments: Math.min(3, Math.max(1, parseInt(e.target.value) || 1)) })} className={inputCls} />
									</div>
								</div>
								<div>
									<label className={labelCls}>Beat Distribution (must sum to 100%)</label>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<label className="block text-xs text-zinc-500 mb-1">Clips %</label>
											<input
												type="text"
												inputMode="numeric"
												value={clipInput}
												onChange={(e) => setClipInput(e.target.value.replace(/[^0-9]/g, ""))}
												onBlur={() => {
													const n = parseInt(clipInput) || 70;
													setClipInput(String(n));
													setForm({ ...form, clipPercent: n });
												}}
												className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none ${!percentValid ? "border-red-500" : "border-zinc-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"}`}
											/>
										</div>
										<div>
											<label className="block text-xs text-zinc-500 mb-1">Images %</label>
											<input
												type="text"
												inputMode="numeric"
												value={imageInput}
												onChange={(e) => setImageInput(e.target.value.replace(/[^0-9]/g, ""))}
												onBlur={() => {
													const n = parseInt(imageInput) || 30;
													setImageInput(String(n));
													setForm({ ...form, imagePercent: n });
												}}
												className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none ${!percentValid ? "border-red-500" : "border-zinc-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"}`}
											/>
										</div>
									</div>
									{!percentValid && (
										<p className="text-red-400 text-xs mt-1">
											Clips + Images = {(parseInt(clipInput) || 70) + (parseInt(imageInput) || 30)}% (must be 100%)
										</p>
									)}
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className={labelCls}>Hook Duration (seconds)</label>
										<p className="text-[10px] text-zinc-600 mb-1">Fast-paced section at the start of the video</p>
										<input type="number" min={10} max={120} value={form.hookDuration ?? 60} onChange={(e) => setForm({ ...form, hookDuration: parseInt(e.target.value) || 60 })} className={inputCls} />
									</div>
									<div>
										<label className={labelCls}>Subscribe Overlay Size (%)</label>
										<p className="text-[10px] text-zinc-600 mb-1">Size of the Subscribe overlay</p>
										<input type="number" min={5} max={100} value={form.subscribeOverlaySize ?? 30} onChange={(e) => setForm({ ...form, subscribeOverlaySize: parseInt(e.target.value) || 30 })} className={inputCls} />
									</div>
								</div>
								<div>
									<label className={labelCls}>Clip Durations (seconds)</label>
									<div className="grid grid-cols-2 gap-4">
										<div>
											<label className="block text-xs text-zinc-500 mb-1">Hook (min - max)</label>
											<div className="flex items-center gap-2">
												<input type="number" min={1} max={10} value={form.hookClipMin ?? 2} onChange={(e) => setForm({ ...form, hookClipMin: parseInt(e.target.value) || 2 })} className={inputCls} />
												<span className="text-zinc-500">-</span>
												<input type="number" min={1} max={10} value={form.hookClipMax ?? 3} onChange={(e) => setForm({ ...form, hookClipMax: parseInt(e.target.value) || 3 })} className={inputCls} />
											</div>
										</div>
										<div>
											<label className="block text-xs text-zinc-500 mb-1">Body after Hook (min - max)</label>
											<div className="flex items-center gap-2">
												<input type="number" min={1} max={15} value={form.bodyClipMin ?? 5} onChange={(e) => setForm({ ...form, bodyClipMin: parseInt(e.target.value) || 5 })} className={inputCls} />
												<span className="text-zinc-500">-</span>
												<input type="number" min={1} max={15} value={form.bodyClipMax ?? 6} onChange={(e) => setForm({ ...form, bodyClipMax: parseInt(e.target.value) || 6 })} className={inputCls} />
											</div>
										</div>
									</div>
								</div>
								<div className="border-t border-zinc-800 pt-3">
									<h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Visual & Audio</h4>
									<div className="space-y-4">
										<div className="grid grid-cols-2 gap-4">
											<div>
												<label className={labelCls}>Parallel Segments</label>
												<p className="text-[10px] text-zinc-600 mb-1">1-3. Higher values render faster but use more memory. Recommended: 1</p>
												<input type="number" min={1} max={3} value={form.parallelSegments ?? 1} onChange={(e) => setForm({ ...form, parallelSegments: Math.min(3, Math.max(1, parseInt(e.target.value) || 1)) })} className={inputCls} />
											</div>
											<div>
												<label className={labelCls}>SRT Chunk Size</label>
												<p className="text-[10px] text-zinc-600 mb-1">Segments per LLM chunk. 25 default, 40 = fewer requests, 15 = more granular</p>
												<input type="number" min={5} max={80} value={form.srtChunkSize ?? 25} onChange={(e) => setForm({ ...form, srtChunkSize: parseInt(e.target.value) || 25 })} className={inputCls} />
											</div>
										</div>
										<div className="grid grid-cols-2 gap-4">
											<div>
												<label className={labelCls}>Chunk Delay (sec)</label>
												<p className="text-[10px] text-zinc-600 mb-1">Delay between batch requests</p>
												<input type="number" min={0} max={30} step={0.5} value={(form.srtChunkDelayMs ?? 0) / 1000} onChange={(e) => setForm({ ...form, srtChunkDelayMs: Math.round((parseFloat(e.target.value) || 0) * 1000) })} className={inputCls} />
											</div>
											<div>
												<label className={labelCls}>Quality Score Threshold</label>
												<p className="text-[10px] text-zinc-600 mb-1">Minimum score (1-10) for accepting stock footage</p>
												<input type="number" min={1} max={10} value={form.qualityScoreThreshold ?? 5} onChange={(e) => setForm({ ...form, qualityScoreThreshold: parseInt(e.target.value) || 5 })} className={inputCls} />
											</div>
										</div>
										<div className="grid grid-cols-3 gap-4">
											<label className="flex items-center gap-2 cursor-pointer">
												<input type="checkbox" checked={form.enableVignette ?? true} onChange={(e) => setForm({ ...form, enableVignette: e.target.checked })} className="rounded border-zinc-600 bg-zinc-800" />
												<span className="text-sm text-zinc-300">Vignette</span>
											</label>
											<label className="flex items-center gap-2 cursor-pointer">
												<input type="checkbox" checked={form.enableColorGrade ?? true} onChange={(e) => setForm({ ...form, enableColorGrade: e.target.checked })} className="rounded border-zinc-600 bg-zinc-800" />
												<span className="text-sm text-zinc-300">Color Grade</span>
											</label>
											<label className="flex items-center gap-2 cursor-pointer">
												<input type="checkbox" checked={form.cleanupAfterRender ?? true} onChange={(e) => setForm({ ...form, cleanupAfterRender: e.target.checked })} className="rounded border-zinc-600 bg-zinc-800" />
												<span className="text-sm text-zinc-300">Cleanup Files</span>
											</label>
										</div>
										<div className="mt-3 flex items-center gap-3">
											<span className="text-xs text-zinc-400 whitespace-nowrap">Auto-delete clips/images after</span>
											<input type="number" min={0} max={365} value={form.cleanupAfterDays ?? 0} onChange={(e) => setForm({ ...form, cleanupAfterDays: Math.max(0, parseInt(e.target.value) || 0) })} className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-zinc-200 text-center focus:outline-none focus:border-amber-500" />
											<span className="text-xs text-zinc-400">days (0 = immediate after render)</span>
										</div>
									</div>
								</div>
							</>
						)}

						{tab === "advanced" && (
							<>
								<div className="pt-1">
									<h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Scene Planner</h4>
									<div className="space-y-4">
										<div>
											<label className={labelCls}>Content Rules</label>
											<p className="text-[10px] text-zinc-600 mb-1">What kind of content this documentary covers. Tells the AI what search queries to generate.</p>
											<textarea value={form.contentRules ?? ""} onChange={(e) => setForm({ ...form, contentRules: e.target.value })} className={`${inputCls} h-20 resize-y font-mono text-[11px] leading-relaxed`} placeholder="e.g. This is a PLANT/BOTANICAL documentary..." />
										</div>
										<div>
											<label className={labelCls}>Search Query Rules</label>
											<p className="text-[10px] text-zinc-600 mb-1">Rules for how the AI translates script phrases into stock footage queries.</p>
											<textarea value={form.searchQueryRules ?? ""} onChange={(e) => setForm({ ...form, searchQueryRules: e.target.value })} className={`${inputCls} h-48 resize-y font-mono text-[11px] leading-relaxed`} placeholder="Rules for translating script to stock footage queries..." />
										</div>
										<div>
											<label className={labelCls}>Scene Planner Rules</label>
											<p className="text-[10px] text-zinc-600 mb-1">Appended as ADDITIONAL RULES to the scene planner prompt.</p>
											<textarea value={form.scenePlannerRules ?? ""} onChange={(e) => setForm({ ...form, scenePlannerRules: e.target.value })} className={`${inputCls} h-24 resize-y`} placeholder="Leave empty for default rules" />
										</div>
									</div>
								</div>
								<div className="border-t border-zinc-800 pt-4">
									<h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Quality Checker</h4>
									<div className="space-y-4">
										<div>
											<label className={labelCls}>Quality Check Prompt</label>
											<p className="text-[10px] text-zinc-600 mb-1">Vision AI prompt for evaluating assets. Must produce JSON with: accept, reason, score, is_relevant, is_blurry</p>
											<textarea value={form.qualityCheckPrompt ?? ""} onChange={(e) => setForm({ ...form, qualityCheckPrompt: e.target.value })} className={`${inputCls} h-32 resize-y font-mono text-[11px] leading-relaxed`} placeholder="Leave empty for default quality check prompt" />
										</div>
										<div>
											<label className={labelCls}>Accepted Contexts</label>
											<p className="text-[10px] text-zinc-600 mb-1">Comma-separated niche-related terms that are always acceptable</p>
											<textarea
												value={(form.acceptedContexts ?? []).join(", ")}
												onChange={(e) => setForm({ ...form, acceptedContexts: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
												className={`${inputCls} h-16 resize-y`}
												placeholder="plants, seeds, roots, herbs, flowers, trees, farming..."
											/>
										</div>
									</div>
								</div>
								<div className="border-t border-zinc-800 pt-4">
									<h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Asset Processing</h4>
									<div className="space-y-4">
										<div className="grid grid-cols-2 gap-4">
											<div>
												<label className={labelCls}>Forbidden Words</label>
												<p className="text-[10px] text-zinc-600 mb-1">Search queries matching these get replaced (comma-separated)</p>
												<textarea value={form.forbiddenWords ?? ""} onChange={(e) => setForm({ ...form, forbiddenWords: e.target.value })} className={`${inputCls} h-16 resize-y`} placeholder="subscribe, like, subscribe button, like button, cta" />
											</div>
											<div>
												<label className={labelCls}>Generic Fallbacks</label>
												<p className="text-[10px] text-zinc-600 mb-1">Used when a forbidden query has no neighbor to borrow from (comma-separated)</p>
												<textarea value={form.genericFallbacks ?? ""} onChange={(e) => setForm({ ...form, genericFallbacks: e.target.value })} className={`${inputCls} h-16 resize-y`} placeholder="nature, garden, landscape, outdoor" />
											</div>
										</div>
									</div>
								</div>
							</>
						)}
					</div>

					<div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
						<button type="button" onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all">Cancel</button>
						<button type="button" onClick={handleSubmit} disabled={!percentValid} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${percentValid ? "bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black shadow-lg hover:shadow-xl" : "bg-zinc-800 text-zinc-500 cursor-not-allowed"}`}>Save Settings</button>
					</div>
				</form>
			</div>
		</div>
	);
}
