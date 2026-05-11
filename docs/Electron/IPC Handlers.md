---
tags: [electron]
---

# IPC Handlers

**File**: `src-electron/main/ipc-handlers.ts`

All IPC channel handlers bridging the React UI and the pipeline core.

## Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `GET_SETTINGS` | renderer → main | Load settings from disk |
| `SAVE_SETTINGS` | renderer → main | Persist settings to disk |
| `SELECT_FILES` | renderer → main | Open native file dialog |
| `RUN_PIPELINE` | renderer → main | Full pipeline run (checks for resumable state first) |
| `PREVIEW_SCENE_PLAN` | renderer → main | Generate scene plan without full run |
| `RESUME_PIPELINE` | renderer → main | Resume from saved state |
| `CANCEL_PIPELINE` | renderer → main | Cancel running pipeline |
| `PIPELINE_LOG` | main → renderer | Real-time log messages |
| `PIPELINE_PROGRESS` | main → renderer | Progress events |
| `PIPELINE_COMPLETE` | main → renderer | Pipeline finished with output path |
| `PIPELINE_ERROR` | main → renderer | Pipeline failed (sends full stack trace) |
| `SCENE_PLAN_READY` | main → renderer | Scene plan preview result |
| `OPEN_IN_FINDER` | renderer → main | Reveal file in Finder |
| `LIST_PROJECTS` | renderer → main | List saved projects |
| `GET_PROJECT` | renderer → main | Get single project |
| `SAVE_PROJECT` | renderer → main | Create/update project |
| `DELETE_PROJECT` | renderer → main | Delete project |
| `RENAME_PROJECT` | renderer → main | Rename project |

## Error Handling

Errors send `err.stack || err.message` to renderer for full diagnostics.

## Dependencies
- [[Orchestrator]], [[Scene Planner]], [[Paths Service]], [[Projects Service]], [[Configuration]]
