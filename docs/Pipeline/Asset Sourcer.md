---
tags: [pipeline, download]
---

# Asset Sourcer

**File**: `src/pipeline/assetSourcer.ts`

Downloads video clips and images for each beat using yt-dlp, with LLM-guided window/frame selection.

## Key Export

`sourceAllAssets(beats, config, logger, existingAssets, onBeatProgress)` → `{ assets, failed }`

## Clip Process (per beat, batched by concurrency)

1. `searchAndDownload` from YouTube via [[yt-dlp Wrapper]]
   - Tries 3 time-section windows at progressively lower resolutions
2. `selectBestWindow`: extracts keyframes every 6s, sends to LLM vision to pick best 6s window
3. `trimClip` the selected window via ffmpeg
4. Validates trimmed clip duration > 1s
5. Retries with different search index on failure (up to `maxRetries`)
6. Deletes source video after successful trim

## Image Process

1. Download short clip via yt-dlp
2. Extract keyframes every 2s via [[yt-dlp Wrapper]]
3. Send frames to LLM vision to pick best one
4. Keep selected frame, delete video + other frames

## Fallback

Failed beats are tracked in `failed` map with `{ reason }`. [[Orchestrator]] maps these to `title_card` fallbacks.

## Dependencies
- [[yt-dlp Wrapper]], [[LLM Client]], [[File Manager]], [[Data Model]], [[Configuration]]

See also: [[Orchestrator]], [[Quality Checker]], [[Pipeline Flow]]
