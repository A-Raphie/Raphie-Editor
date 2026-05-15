---
tags: [pipeline]
---

# Orchestrator

**File**: `src/pipeline/orchestrator.ts`

Master pipeline controller. Runs the 5-step pipeline with state persistence for resume. Supports cancel/continue with FFmpeg renderer.

## Key Exports

| Export | Description |
|--------|-------------|
| `Pipeline` class | Main controller with `run()`, `resume()`, `cancel()`, `renderOnly()`, `renderNew()` |
| `PipelineProgressEvent` | Progress event interface: step, current, total, percent, message |

## Pipeline Steps

Progress is mapped to percentage ranges:
- `init` [0-5%] — Preflight checks (API key, files, binaries, dirs)
- `scene_planning` [5-25%] — → [[Scene Planner]]
- `asset_sourcing` [25-70%] — → [[Asset Sourcer]]
- `quality_check` [70-85%] — → [[Quality Checker]]
- `rendering` [85-100%] — → [[Renderer]] or [[FFmpeg Renderer]]

## State Management

- Saves to `output/pipeline_state.json` after each step
- Tracks `completedSteps[]`, `assets`, `scenePlan` path, input paths
- Scene plan saved to `output/scene_plan.json`
- `renderSegments` includes `elapsedMs` and `sessionTimes[]` for FFmpeg resume

## Cancel/Continue

### Cancel
- `cancel()` sets `cancelled = true` and calls `abortController.abort()`
- For FFmpeg renderer: kills all in-flight `spawn` processes via `SIGTERM`
- For Remotion renderer: sets flag checked at phase boundaries

### Continue
- `renderOnly(voPath?, musicPath?)` — reads state from disk, resumes from last checkpoint
- `renderNew(voPath?, musicPath?)` — clears segment directory, starts fresh
- Both pass `AbortSignal` to FFmpeg renderer for process killing

### Resume Logic
- `run()` checks for existing failed state with matching scriptPath/voPath → auto-resumes
- `resume()` loads state, skips completed steps
- Failed beats get fallback via `resolveFallbacks()`

## FFmpeg Renderer Integration

When `useFFmpeg` is true:
- `onPercent` callback maps to `PipelineProgressEvent`
- `onPhaseComplete` saves `renderPhase` ("beats" | "concat" | "overlay" | "mux") to state
- `isCancelled` callback checks `this.cancelled` flag
- `abortSignal` created via `createAbortSignal()` for process killing
- `previousElapsedMs` and `sessionTimes` passed from existing state

## Dependencies
- All pipeline steps, [[LLM Client]], [[Asset Sourcer]], [[Logger]], [[File Utils]], [[Data Model]]

See also: [[Pipeline Flow]], [[Data Model]], [[Configuration]], [[FFmpeg Renderer]]
