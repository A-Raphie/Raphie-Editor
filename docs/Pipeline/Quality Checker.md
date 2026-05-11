---
tags: [pipeline, llm]
---

# Quality Checker

**File**: `src/pipeline/qualityChecker.ts`

Validates downloaded assets using a vision LLM. Checks relevance, quality, watermarks, and text overlays.

## Key Export

`qualityCheckAssets(beats, assets, config, logger)` → `{ accepted: AssetMapping, rejected: string[] }`

## Process (per beat, batched by 5)

1. If asset is a video file (.mp4/.webm), extract a single frame via ffmpeg (`-ss 0.5 -frames:v 1`)
2. Convert frame/image to base64
3. Send to vision LLM with quality check prompt
4. Parse JSON response: `{ accept: boolean, reason: string, score: 1-10 }`
5. Accept if score >= 6

## Error Handling

| Error | Action |
|-------|--------|
| HTTP 400 / "Provider returned error" | Auto-accept (provider-side issue, not asset quality) |
| Other errors | Reject the asset |

## Quality Check Criteria

1. Is the image relevant to the search context?
2. Is resolution/quality acceptable for 1080p?
3. Watermarks or text overlays? (NOT acceptable)
4. Subject clearly visible and in focus?
5. Any inappropriate content?

## Dependencies
- [[LLM Client]] (`chatWithImages`), [[File Manager]], [[Data Model]], [[Configuration]]

See also: [[Orchestrator]], [[Asset Sourcer]], [[Troubleshooting]]
