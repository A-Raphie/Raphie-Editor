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
pkill -f "AI Video Editor"; sleep 1
rm -rf "/Applications/AI Video Editor.app"
cp -R "dist/mac-arm64/AI Video Editor.app" /Applications/
open "/Applications/AI Video Editor.app"
```
