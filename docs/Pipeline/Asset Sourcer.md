---
tags: [pipeline, download]
---

# Asset Sourcer

**File**: `src/pipeline/assetSourcer.ts`

Downloads video clips and images for each beat using Pexels and Pixabay stock APIs, with parallel downloading, fallback queries, and LLM query translation.

## Key Exports

- `sourceAllAssets(beats, config, logger, existingAssets, onBeatProgress)` → `{ assets, failed }`
- `sourceBeatsParallel(beats, config, logger, existingAssets, onBeatProgress)` — uses `config.concurrency`
- `sourceBeatWithThumbnails(beat, config, logger)` — sequential with thumbnail checking

## Clip Process (per beat, batched by concurrency)

1. `searchAndDownloadVideo(query, config, logger, onProgress)` — search Pexels/Pixabay, download best match
2. Validates downloaded clip duration
3. Retries with fallback query on failure (up to `maxRetries`)
4. Uses generic fallbacks from config (e.g., "nature", "garden", "landscape") if original query fails

## Image Process

1. `searchAndDownloadImage(query, config, logger)` — search Pexels/Pixabay photos
2. Download and save image
3. Retries with fallback query on failure

## LLM Query Translation

When a stock search returns zero results:
1. Calls LLM (via OpenRouter) to translate the query into photographer-friendly terms
2. Uses `QUERY_TRANSLATOR_PROMPT` — instructs LLM to output 3 concrete, tag-like queries
3. Retries each translated query until results are found
4. Example: "biblical healing tradition" → ["herbs mortar", "dried herbs", "tea pouring"]

## Download Retry

- `downloadFile` wraps `downloadSingle` with exponential backoff
- Up to 5 attempts: 1s, 2s, 4s, 8s, 16s delays
- Abort signal respected — doesn't retry if aborted

## Fallback Strategy

1. Try original search query
2. On zero results, translate query via LLM and retry
3. On failure, try generic fallbacks from config
4. Failed beats tracked in `failed` map with `{ reason }`

## Dependencies
- [[LLM Client]], [[File Utils]], [[Data Model]], [[Configuration]]

See also: [[Orchestrator]], [[Quality Checker]], [[Pipeline Flow]]
