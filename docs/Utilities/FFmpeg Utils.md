---
tags: [utilities]
---

# FFmpeg Utils

**File**: `src/utils/ffmpeg.ts`

Wrapper around ffmpeg/ffprobe for video processing operations.

## Functions

| Function | Purpose |
|----------|---------|
| `getVideoDuration(path)` | Returns duration in seconds via ffprobe |
| `getVideoResolution(path)` | Returns `{ width, height }` via ffprobe |
| `trimVideo(input, output, start, duration)` | Cuts a segment from a video |
| `extractFrame(input, output, timestamp)` | Extracts a single frame at given time |
| `concatVideos(inputs, output)` | Concatenates multiple video files |
| `convertToMp3(input, output)` | Converts audio to MP3 format |

## Binary Resolution

Uses ffmpeg/ffprobe paths from [[Paths Service]] or [[Configuration]]. In packaged mode, resolves from `resources/mac-arm64/`.

See also: [[Asset Sourcer]], [[Renderer]], [[Quality Checker]]
