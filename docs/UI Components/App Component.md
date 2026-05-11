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
| `rendering` | Progress bar during rendering |
| `complete` | Output video display |
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

## Error Handling

`translateError(raw)` converts raw error strings to user-friendly messages. Renderer errors (enotdir, spawn, esbuild) show raw stack traces for debugging.

## Key Callbacks

- `handleGenerate()` — Starts pipeline (auto-resumes if previous state exists)
- `handleResume()` — Resume from sidebar button
- `handleRetryRender()` — Resume button on error screen (calls `resumePipeline`)
- `handleBackToEditor()` — Return to editor from error screen

## Dependencies
- All [[UI Components|UI components]], [[Preload Bridge]], [[Configuration]]
