---
tags: [pipeline, remotion]
---

# Renderer

**File**: `src/pipeline/renderer.ts`

Bundles the Remotion project and renders the final video. Handles all packaged-app compatibility issues.

## Key Export

`renderVideo(scenePlan, assets, config, logger, voPath?, musicPath?, onRenderProgress?)` → `outputPath`

## Process

1. **Browser setup**: Download Chrome via `ensureBrowser()` (temporarily chdir to `~` for writable cache dir)
2. **Asset preparation**: Create symlinks in Remotion public dir pointing to output/, VO, music files
3. **Bundling**: Webpack bundles the Remotion project via `bundle()`
4. **Composition selection**: `selectComposition()` resolves the Documentary composition
5. **Rendering**: `renderMedia()` renders to h264 .mp4

## Packaged App Fixes

| Issue | Fix |
|-------|-----|
| Compositor binaries in asar | Pre-copied to `resources/mac-arm64/remotion-bin/`, passed via `binariesDirectory` |
| Browser download to `/` | Temp `process.chdir(os.homedir())` during `ensureBrowser()` |
| Assets not served | Symlinks in public dir (`assets/_render_output` → output dir) |
| `chmodSync` on asar paths | Monkey-patched in [[Main Process]] |
| Missing favicon.ico | `ensureBundlerFavicon()` creates dummy |

## URL Conversion

Asset paths are converted from absolute paths to `/public/_render_output/...` URLs for Remotion's HTTP server. VO/music get individual symlinks.

## Dependencies
- `@remotion/bundler`, `@remotion/renderer`, [[Configuration]], [[Logger]]

See also: [[Orchestrator]], [[Remotion Root]], [[Troubleshooting]], [[Packaging]]
