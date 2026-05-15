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
| `fps` | 30 | Fixed for rendering |
| `concurrency` | 4 | Parallel asset downloads |
| `downloadResolution` | 2160 | Pexels/Pixabay download resolution |
| `downloadTimeout` | 0 (disabled) | Per-download timeout (0 = no timeout) |
| `segmentLength` | 900 frames | Segment duration for rendering (~30s at 30fps), configurable in settings |
| `parallelSegments` | 1 | Parallel render segments (Remotion only, range 1-3) |
| `renderConcurrency` | 3 | Parallel FFmpeg processes (range 1-12) |
| `previewResolution` | 1080 | Preview render resolution |
| `renderer` | "remotion" | Renderer backend: "remotion" or "ffmpeg" |
| `enableColorGrade` | false | Apply color grading in FFmpeg renderer |
| `enableVignette` | false | Apply vignette effect in FFmpeg renderer |
| `enableQualityCheckOnPreview` | true | Run quality check on preview asset searches |
| `outputDir` | `~/AI Video Editor/output` | Rendered videos |
| `clipsDir` | `~/AI Video Editor/output/clips` | Downloaded clips |
| `imagesDir` | `~/AI Video Editor/output/images` | Downloaded images |
| `remotionEntryPath` | `src/remotion/index.ts` | Remotion entry |
| `remotionPublicDir` | `assets/` | Static file serving |
| `ffmpegPath` | Bundled or homebrew | FFmpeg binary |
| `vfxPath` | `assets/vfx/subscribe.mp4` | Subscribe overlay video |

## Settings Persistence

Electron app saves to `~/Library/Application Support/ai-video-editor/settings.json`. Merged with defaults via `{ ...DEFAULT_SETTINGS, ...saved }`.

See also: [[Packaging]], [[Paths Service]], [[Settings]]
