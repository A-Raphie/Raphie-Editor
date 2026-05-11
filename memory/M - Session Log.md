# M - Session Log

## Session 13 (Current — Memory Files)

### Completed
- Created `memory/` directory at `/Users/raphie/Desktop/ai-video-editor/memory/`
- Created `AGENTS.md` with memory map, reading order, key paths, critical notes
- Created memory files:
  - `M - Architecture.md` — Stack, build commands, three-process architecture
  - `M - File Map.md` — Every source file with purpose
  - `M - Types.md` — All shared types, pipeline types, config types
  - `M - State.md` — App.tsx useState hooks, effects, handlers, view routing
  - `M - Component Tree.md` — Component hierarchy, props, data flow
  - `M - Pipeline.md` — Orchestrator, renderer, asset sourcer, quality checker
  - `M - Bugs and Fixes.md` — Known issues, fixed issues, session history
  - `M - Decisions.md` — Design decisions, user preferences, environment

---

## Session 11-12 (Project Recovery Phase 2)

### Completed
- Reconstructed all 13 renderer components from working copy's compiled bundle:
  - App.tsx, Sidebar, DropZone, PlanningView, ProjectsView, ModelSelector
  - BeatTimeline, BeatEditor, BeatEditor, CandidatePicker, Settings
  - ErrorModal, ConfirmModal, ProgressBar, LogViewer
- Reconstructed 7 main process files:
  - main/index.ts, main/ipc-handlers.ts, preload/index.ts
  - shared/types.ts, remotion/index.ts
- Rewrote preload with correct parameter signatures (matching working copy)
- Build succeeded: `npm run build:dmg` produces clean DMG
- Verified: all component names match working copy (including `CandidatePicker`)
- Renderer bundle only 45 lines different (structural ordering, zero feature differences)
- Deployed to `/Applications/Raphie's Editor.app`

### Key Learning
- Preload must expose ALL 30+ IPC channels — missing 13 channels caused blank screen
- Parameter order in preload must exactly match what ipcMain handlers expect
- `app.asar` compiled output was the source of truth for recovery

---

## Session 10 (Fixes + Disaster)

### Completed Fixes
1. Memory warning `< 16` → `<= 16` (user has exactly 16GB)
2. Double `?t=` bug in BeatTimeline.tsx thumbnail URLs
3. PlanningView.tsx rewrite — flex layout with scrollable log panel
4. Regenerating overlay in App.tsx made scrollable (`max-h-64 overflow-y-auto`, `logs.slice(-20)`, auto-scroll via `logsEndRef`)
5. Execution order swap: `enforceBodyDurations` FIRST, `enforceBeatDistribution` LAST
6. Merge logic: `resolveType()` uses majority type instead of "mixed=always clip"
7. Body clip min/max durations now apply to BOTH clips AND images
8. Rewrote `DEFAULT_SEARCH_QUERY_RULES` with segment-level visual mapping
9. Stride-based spreading for type conversions in `enforceBeatDistribution`
10. Overall ratio accounting fixed in `enforceBeatDistribution`

### Disaster
- Project source accidentally deleted during this session
- Recovery began: extracted all source from compiled JS in `app.asar` of deployed app

### Key Learning
- Execution order is critical: body durations before beat distribution
- Distribution targets OVERALL ratio, not just body beats
- Bresenham's algorithm planned for beat interleaving but not yet implemented

---

## Earlier Sessions (Pre-10)

Not tracked. Key context from earlier sessions:
- App was built as Electron + React + Remotion documentary video editor
- Pipeline: script/SRT → scene plan → asset sourcing → quality check → render
- Added Pexels + Pixabay stock API integration
- Added quality checker with LLM vision model
- Added candidate picker for manual asset selection
- Added batch queue for multiple projects
- Added subscribe overlay detection and placement
