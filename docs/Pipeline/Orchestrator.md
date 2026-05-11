---
tags: [pipeline]
---

# Orchestrator

**File**: `src/pipeline/orchestrator.ts`

Master pipeline controller. Runs the 5-step pipeline with state persistence for resume.

## Key Exports

| Export | Description |
|--------|-------------|
| `Pipeline` class | Main controller with `run()`, `resume()`, callbacks |
| `PipelineProgressEvent` | Progress event interface: step, current, total, percent, message |

## Pipeline Steps

Progress is mapped to percentage ranges:
- `init` [0-5%] — Preflight checks (API key, files, binaries, dirs)
- `scene_planning` [5-25%] — → [[Scene Planner]]
- `asset_sourcing` [25-70%] — → [[Asset Sourcer]]
- `quality_check` [70-85%] — → [[Quality Checker]]
- `rendering` [85-100%] — → [[Renderer]]

## State Management

- Saves to `output/pipeline_state.json` after each step
- Tracks `completedSteps[]`, `assets`, `scenePlan` path, input paths
- Scene plan saved to `output/scene_plan.json`

## Resume Logic

- `run()` checks for existing failed state with matching scriptPath/voPath → auto-resumes
- `resume()` loads state, skips completed steps
- Failed beats get `title_card` fallback via `resolveFallbacks()`

## Dependencies
- All pipeline steps, [[LLM Client]], [[Asset Sourcer]], [[Logger]], [[File Utils]], [[Data Model]]

See also: [[Pipeline Flow]], [[Data Model]], [[Configuration]]
