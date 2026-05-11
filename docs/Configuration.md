---
tags: [pipeline, config]
---

# Configuration

Factory in `src/config.ts`. Creates `Config` object with sensible defaults.

## Model Selection

6 planner models and 4 checker models available in dropdown. Costs displayed as "/hr" using benchmarks (75 planner chunks/hr, 3,000 checker calls/hr).

Planner models include `google/gemma-3-4b-it` (~$0.02/hr) as the cheapest option.

UI overrides these via [[Settings]] component.

## Config Fields

| Field | Default | Notes |
|-------|---------|-------|
| `fps` | 30 | Fixed for Remotion |
| `concurrency` | 4 | Parallel asset downloads |
| `downloadResolution` | 2160 | Pexels/Pixabay download resolution |
| `downloadTimeout` | 90000ms | Per-download timeout |
| `segmentLength` | 900 frames | Segment duration for rendering (~30s at 30fps), configurable in settings |
| `parallelSegments` | 1 | Parallel render segments (range 1-3) |
| `previewResolution` | 1080 | Preview render resolution |
| `outputDir` | `~/AI Video Editor/output` | Rendered videos |
| `clipsDir` | `~/AI Video Editor/output/clips` | Downloaded clips |
| `imagesDir` | `~/AI Video Editor/output/images` | Downloaded images |
| `remotionEntryPath` | `src/remotion/index.ts` | Remotion entry |
| `remotionPublicDir` | `assets/` | Static file serving |
| `ffmpegPath` | Bundled or homebrew | ffmpeg binary |
| `vfxPath` | `assets/vfx/subscribe.mp4` | Subscribe overlay video |

## Settings Persistence

Electron app saves to `~/Library/Application Support/ai-video-editor/settings.json`. Merged with defaults via `{ ...DEFAULT_SETTINGS, ...saved }`.

See also: [[Packaging]], [[Paths Service]], [[Settings]]
