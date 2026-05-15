---
tags: [ui]
---

# App Component

**File**: `src-electron/renderer/src/App.tsx`

Root React component. Manages all application state and view routing.

## Views

| View | Description |
|------|-------------|
| `input` | Script/VO/music file selection |
| `editor` | Beat timeline + editor after scene plan |
| `rendering` | Progress bar during rendering with session timer |
| `complete` | Output video display with total elapsed time |
| `projects` | Saved projects list |

## State

| State | Type | Purpose |
|-------|------|---------|
| `settings` | `AppSettings \| null` | Current settings |
| `scenePlan` | `ScenePlan \| null` | Generated scene plan |
| `progress` | `PipelineProgress \| null` | Current render progress |
| `logs` | `string[]` | Real-time pipeline logs |
| `renderingError` | `string \| null` | Render error (shown in rendering view) |
| `error` | `ErrorInfo \| null` | Generic error modal |
| `renderElapsed` | `string` | Current session elapsed time |
| `previousElapsed` | `string` | Previous session elapsed time (continue mode) |
| `sessionTimes` | `number[]` | Array of elapsed times from each cancelled session |
| `isRenderingRef` | `MutableRef<boolean>` | Lock to prevent concurrent renders |

## Cancel/Continue UI

- **Stop button** — calls `cancelPipeline()`, switches to editor view
- **Continue Render button** — appears when `renderSegments.completed > 0`, calls `handleRenderVideo("continue")`
- **New Render button** — appears alongside Continue, calls `handleRenderVideo("render")`
- **Session timer** — shows "Prev: 90s | Now: 5.5s" with expandable dropdown for per-session breakdown

## Render Lock

- `isRenderingRef` prevents starting a new render while one is in progress
- Cleared by `unsubComplete` (success/cancel) or `unsubError` (failure)
- `handleStop` does NOT clear the lock — only the pipeline completion handlers do

## Progress Filter

- Progress events filtered by `activePipelineProjectIdRef.current`
- Uses strict equality (`!==`) — blocks ALL events when project IDs don't match (including null)
- Prevents old render's progress from overwriting new render's progress

## Key Callbacks

- `handleGenerate()` — Starts pipeline (auto-resumes if previous state exists)
- `handleResume()` — Resume from sidebar button
- `handleRenderVideo(mode)` — Start render with mode: "render" (new) or "continue" (resume)
- `handleStop()` — Cancel pipeline, switch to editor
- `handleBackToEditor()` — Return to editor from error screen

## Error Handling

`translateError(raw)` converts raw error strings to user-friendly messages. Renderer errors (enotdir, spawn, esbuild) show raw stack traces for debugging.

## Dependencies
- All [[UI Components|UI components]], [[Preload Bridge]], [[Configuration]]
