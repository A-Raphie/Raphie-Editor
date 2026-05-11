---
tags: [pipeline, config]
---

# Configuration

Factory in `src/config.ts`. Creates `Config` object with sensible defaults.

## Model Tiers

| Tier | Scene Planner | Quality Checker | Cost/video |
|------|--------------|-----------------|------------|
| **default** | Claude Sonnet 4 | Gemini 2.5 Flash Lite | ~$0.19 |
| **budget** | Claude Haiku 4 | Gemini 2.5 Flash Lite | ~$0.05 |

UI overrides these via [[Settings]] component.

## Available Quality Checker Models

| Model | Vision? | Cost (in/out per 1M) |
|-------|---------|---------------------|
| Gemini 2.5 Flash Lite | Yes | $0.10 / $0.40 |
| GPT-4o Mini | Yes | $0.15 / $0.60 |
| Gemini 2.5 Flash | Yes | $0.60 / $2.50 |

## Config Fields

| Field | Default | Notes |
|-------|---------|-------|
| `fps` | 30 | Fixed for Remotion |
| `concurrency` | 4 | Parallel asset downloads |
| `downloadResolution` | 1080 | yt-dlp resolution |
| `downloadTimeout` | 90000ms | Per-download timeout |
| `outputDir` | `~/AI Video Editor/output` | Rendered videos |
| `clipsDir` | `~/AI Video Editor/output/clips` | Downloaded clips |
| `imagesDir` | `~/AI Video Editor/output/images` | Extracted images |
| `remotionEntryPath` | `src/remotion/index.ts` | Remotion entry |
| `remotionPublicDir` | `assets/` | Static file serving |
| `ffmpegPath` | Bundled or homebrew | ffmpeg binary |
| `ytDlpPath` | Bundled or homebrew | yt-dlp binary |

## Settings Persistence

Electron app saves to `~/Library/Application Support/ai-video-editor/settings.json`. Merged with defaults via `{ ...DEFAULT_SETTINGS, ...saved }`.

See also: [[Packaging]], [[Paths Service]], [[Settings]]
