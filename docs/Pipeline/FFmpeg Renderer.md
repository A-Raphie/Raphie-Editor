---
tags: [pipeline, ffmpeg]
---

# FFmpeg Renderer

**File**: `src/pipeline/ffmpeg-renderer.ts`

Native FFmpeg renderer that renders beat segments without Chrome. Faster than Remotion, supports cancel/continue with session time tracking.

## Key Exports

- `renderVideoSegmentsFFmpeg(scenePlan, assets, config, logger, voPath?, musicPath?, existingState?, callbacks?)` → `{ outputPath, segmentState }`

## Architecture

### Beat Rendering
1. Each beat rendered as individual `.mp4` segment via `spawn(ffmpeg)`
2. Clips: scaled + cropped to fill frame, looped if shorter than duration
3. Images: Ken Burns animation via `zoompan` filter (14 directions)
4. Missing assets: black frame placeholder

### Batch Processing
- Beats processed in batches of `renderConcurrency` (default 12)
- `Promise.allSettled` used — progress saved even if some processes are cancelled
- Manifest saved after each batch with completed beat paths + elapsed time

### Concatenation
- Beats grouped by transition type (xfade groups vs hard cuts)
- xfade groups processed in sub-batches of 15 to avoid filter graph complexity
- Sub-batches concatenated via ffmpeg concat demuxer

### VFX Overlays
- Video split into segments: with-overlay and without-overlay
- Overlay segments: ffmpeg `overlay` filter with fade in/out
- Non-overlay segments: stream copy (no re-encode)
- Segments concatenated after overlay application

### Audio Muxing
- VO, music (at 30% volume), and overlay audio mixed via `amix`
- Fallback: VO-only mux if full mix fails

## Cancel/Continue Support

### Process Killing
- `runFFmpeg` uses `spawn` instead of `execFile`
- Each spawned process tracked and killed via `child.kill("SIGTERM")` on `AbortSignal`
- `cancel()` calls `AbortController.abort()` → kills all in-flight processes immediately

### Progress Preservation
- `Promise.allSettled` saves manifest with whatever beats finished in the batch
- Manifest uses atomic writes (`.tmp` → `rename`) to prevent corruption
- `completedBeats` initialized from manifest on resume

### Session Time Tracking
- `elapsedMs` saved to manifest after each batch
- `sessionTimes[]` accumulates elapsed time from each cancelled session
- On continue, UI shows: "Prev: 90s | Now: 5.5s" with expandable per-session breakdown

## FFmpegRenderCallbacks

```ts
interface FFmpegRenderCallbacks {
  onSegmentProgress?: (segmentIndex, totalSegments, frameProgress) => void;
  onSegmentComplete?: (segmentIndex) => void;
  onSegmentsInit?: (info: { totalSegments, segmentLength, segmentDir, previousElapsedMs?, sessionTimes? }) => void;
  onPercent?: (percent, message) => void;
  onPhaseComplete?: (phase: "beats" | "concat" | "overlay" | "mux", segmentDir, elapsedMs?) => void;
  isCancelled?: () => boolean;
  abortSignal?: AbortSignal;
  previousElapsedMs?: number;
  sessionTimes?: number[];
}
```

## Render Manifest

Stored in `segmentDir/render_manifest.json`:

```json
{
  "completedBeats": { "0": "/path/to/beat_001.mp4", "1": "..." },
  "elapsedMs": 43000,
  "sessionTimes": [30000, 30000, 30000]
}
```

## Configuration

| Setting | Default | Notes |
|---------|---------|-------|
| `renderConcurrency` | 3 | Parallel FFmpeg processes (1-12) |
| `fps` | 30 | Output frame rate |
| `enableColorGrade` | false | Subtle color grading filter |
| `enableVignette` | false | Vignette effect filter |
| `crf` | 23 | Video quality (lower = better) |
| `preset` | ultrafast | Encoding speed |

## Dependencies
- `child_process.spawn`, [[Configuration]], [[Logger]]

See also: [[Orchestrator]], [[Renderer]], [[Pipeline Flow]], [[Troubleshooting]]
