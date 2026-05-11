---
tags: [pipeline, remotion]
---

# Renderer

**File**: `src/pipeline/renderer.ts`

Bundles the Remotion project, renders video in segments, then muxes audio via ffmpeg. Handles all packaged-app compatibility issues.

## Key Exports

- `renderVideo(scenePlan, assets, config, logger, voPath?, musicPath?, onProgress?)` → `outputPath` — Simple single-render (legacy)
- `renderVideoSegments(scenePlan, assets, config, logger, voPath?, musicPath?, existingState?, callbacks?)` → `{ outputPath, segmentState }` — Segment rendering with resume

## Segment Rendering Process

1. **Browser setup**: Download Chrome via `ensureBrowser()` (temporarily chdir to `~` for writable cache dir)
2. **Asset preparation**: Copy assets into Remotion public dir, including VFX overlay
3. **Bundling**: Webpack bundles the Remotion project via `bundle()`
4. **Composition selection**: `selectComposition()` resolves the Documentary composition
5. **Segment rendering**: Each segment rendered via `renderMedia({ muted: true })` to temp directory
6. **Video combine**: `combineChunks(audioFiles: [])` merges video segments (no audio)
7. **Audio muxing**: ffmpeg adds VO, music, and overlay audio to final video

## Audio Muxing Pipeline

1. Combine video segments → temp video (no audio)
2. Build ffmpeg command with VO, music inputs
3. Extract overlay audio from VFX file if overlay beats exist
4. Mix overlay audio into VO via `amix(inputs=2, normalize=0)` filter
5. Fallback on mux failure: simple `-map` approach without overlay

## Segment Resume

- `RenderSegmentState` tracks completed segment indices
- On resume, skips already-completed segments
- State persisted by [[Orchestrator]] callbacks

## Segment Render Callbacks

```ts
interface SegmentRenderCallbacks {
  onSegmentProgress?: (segIndex, totalSegments, frameProgress) => void;
  onSegmentComplete?: (segIndex) => void;
  onSegmentsInit?: (info: { totalSegments, segmentLength, segmentDir }) => void;
}
```

## Packaged App Fixes

| Issue | Fix |
|-------|-----|
| Compositor binaries in asar | Pre-copied to `resources/mac-arm64/remotion-bin/`, passed via `binariesDirectory` |
| Browser download to `/` | Temp `process.chdir(os.homedir())` during `ensureBrowser()` |
| Assets not served | Files copied into public dir for Remotion HTTP server |
| `chmodSync` on asar paths | Monkey-patched in [[Main Process]] |
| Missing favicon.ico | `ensureBundlerFavicon()` creates dummy |

## Dependencies
- `@remotion/bundler`, `@remotion/renderer`, [[Configuration]], [[Logger]]

See also: [[Orchestrator]], [[Remotion Root]], [[Troubleshooting]], [[Packaging]]
