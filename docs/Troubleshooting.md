---
tags: [troubleshooting]
---

# Troubleshooting

All issues encountered and fixed during development.

## Rendering Issues

### ENOTDIR: not a directory, chmod
**Cause**: Remotion's `makeFileExecutableIfItIsNot()` calls `fs.chmodSync()` on compositor binary paths that resolve inside `app.asar`.
**Fix**: Monkey-patch `fs.chmodSync` in [[Main Process]] to catch ENOTDIR errors. Compositor binaries pre-copied to `resources/mac-arm64/remotion-bin/` at build time.

### spawn ENOTDIR
**Cause**: `child_process.spawn()` called with compositor binary path inside asar archive.
**Fix**: Copy compositor binaries to resources dir at build time, pass `binariesDirectory` to Remotion's `selectComposition()` and `renderMedia()`. See [[Renderer]].

### ENOENT: no such file or directory, mkdir '/.remotion'
**Cause**: `process.cwd()` is `/` in packaged app. Remotion's browser download resolves cache to `/.remotion` which is not writable.
**Fix**: Temporarily `process.chdir(os.homedir())` during `ensureBrowser()` call, pass `browserExecutable` to all Remotion calls. See [[Renderer]].

### 404 for asset files
**Cause**: Remotion renders in Chrome — can't access local filesystem paths. Assets need to be served via HTTP from the webpack dev server.
**Fix**: Create symlinks in the Remotion public dir (`assets/`) pointing to output/VO/music files. Use `/public/` URL prefix. See [[Renderer]].

### durationInFrames must be an integer
**Cause**: VO duration has fractional seconds (e.g., 31.067s × 30fps = 932.01 frames).
**Fix**: `Math.round(durationSeconds * 30)` in [[Remotion Root]].

### Module not found: react/package.json (Invalid package)
**Cause**: `process.chdir()` to home directory broke `findRemotionRoot()` which resolves modules relative to cwd.
**Fix**: Don't change cwd globally. Only temporarily for `ensureBrowser()`. See [[Renderer]].

## Cancel/Continue Issues

### RAM spikes to 16GB on cancel+continue
**Cause**: `cancel()` only set a boolean flag — in-flight FFmpeg processes kept running. New render started alongside old ones → 2x processes.
**Fix**: `cancel()` now calls `AbortController.abort()` which kills all spawned FFmpeg processes via `child.kill("SIGTERM")`.

### Progress resets to 12/79 after continue
**Cause**: `Promise.all(promises)` — if any promise rejects (from cancel killing a process), the whole batch fails and `saveManifest` never runs. With concurrency=50, up to 49 beats lost per cancel.
**Fix**: Switched to `Promise.allSettled(promises)` — saves manifest with whatever finished. Reduced concurrency default to 12 for more frequent saves.

### Continue button never appeared
**Cause**: UI checked `renderSegments.completed` but IPC handler returns `completed` (a number), not `completedSegments` (an array).
**Fix**: Changed all UI checks to use `renderSegments.completed > 0`.

### Progress counter hijacked by old render
**Cause**: Progress filter used `if (activePid && activePid !== currentProjectId)` — when `activePid` was null after Stop, old events passed through and overwrote new render progress.
**Fix**: Changed to `if (activePid !== currentProjectIdRef.current)` — blocks ALL events when IDs don't match.

## Quality Checker Issues

### "provider error" - all beats auto-accepted
**Cause (Gemini)**: `response_format: { type: "json_object" }` not supported with image inputs for Gemini via OpenRouter.
**Fix**: Removed `response_format` from `chatWithImages()`. Added regex JSON extraction in `sanitizeJsonResponse()`.

**Cause (GPT-4.1-nano)**: Model is text-only, no vision support. Every image call returns 400.
**Fix**: Use vision-capable models only (Gemini 2.5 Flash Lite, GPT-4o Mini).

**Cause (root cause)**: Quality checker was sending raw video files (.mp4) as base64 with MIME type `image/jpeg` to vision models.
**Fix**: Extract a single frame from video clips via ffmpeg before sending to LLM. See [[Quality Checker]].

## Packaging Issues

### App crashes on launch ("quit unexpectedly")
**Cause**: Electron Framework missing from `Frameworks/` directory.
**Fix**: Full rebuild cycle needed: `npm run build:electron` → `npx electron-builder --mac --dir` → fresh copy to `/Applications/`.

### Text not selectable in app
**Cause**: Two layers blocking selection: (1) global `user-select: none !important` in CSS, (2) Tailwind `select-none` on root div in [[App Component]].
**Fix**: Removed both. All text now selectable by default.

## Rebuild Cycle
```bash
npm run build:electron && npx electron-builder --mac --dir
pkill -f "Raphie's Editor"; sleep 1
rm -rf "/Applications/Raphie's Editor.app"
cp -R "dist/mac-arm64/Raphie's Editor.app" /Applications/
open "/Applications/Raphie's Editor.app"
```

Or use the shortcut:
```bash
npm run update:app
```
