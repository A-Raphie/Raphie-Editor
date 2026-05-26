# M - Session Log

## Session 20 (Current)

### Completed
- Added `None (Manual Review)` option for the quality checker model in quick model selector and settings
- Added `none` to valid checker model settings so it persists instead of migrating back to default
- Skipped automated pipeline quality checking when checker is `none`, passing sourced assets through for manual review
- Skipped preview thumbnail AI checks when checker is `none`, returning candidates directly for manual selection
- Made asset sourcing accept candidates without thumbnail AI checks in manual review mode

### Files Changed
- `src-electron/renderer/src/components/ModelSelector.tsx`: Added checker `None (Manual Review)` option
- `src-electron/renderer/src/components/Settings.tsx`: Added checker `None (Manual Review)` option
- `src-electron/main/ipc-handlers.ts`: Added valid model support and preview bypass for `none`
- `src/pipeline/qualityChecker.ts`: Added no-op acceptance path for `none`
- `src/pipeline/orchestrator.ts`: Added quality-check step skip for `none`
- `src/pipeline/assetSourcer.ts`: Added manual-review candidate acceptance path while keeping query translation functional

---

## Session 17

### Completed
- Fixed beat durations being destroyed by `scaleToAudioDuration()` running after enforcement
- Added `enforceHookDurations()` function to enforce hook clip min/max durations (was previously only in LLM prompt)
- Reordered pipeline execution: `scaleToAudioDuration` → `enforceHookDurations` → `enforceBodyDurations` → `enforceBeatDistribution`
- Applied fix in all 3 planning paths: `planScenes()`, `planScenesFromSrt()`, `planScenesFromSrtChunked()`

### Files Changed
- `src/pipeline/scenePlanner.ts`: Added `enforceHookDurations()`, reordered execution in 3 paths

---

## Session 16

### Completed
- Replaced hardcoded `SEGMENT_LENGTH=900` constant in `renderer.ts` with `config.segmentLength` (reads from settings, defaults to 900)
- Updated orchestrator fallback from `900` to `this.config.segmentLength ?? 900` for consistency
- Initialized git repo with `.gitignore` (added `out/` and `.DS_Store`)
- Initial commit: `f14b5f5` — full project baseline

### Files Changed
- `src/pipeline/renderer.ts`: Removed `const SEGMENT_LENGTH = 900`, replaced all 5 uses with `config.segmentLength ?? 900`
- `src/pipeline/orchestrator.ts`: Line 445 fallback now `this.config.segmentLength ?? 900`
- `.gitignore`: Added `out/` and `.DS_Store`

---

## Session 15

### Completed
- Updated model pricing labels in Settings.tsx to `/hr` format with accurate pricing
- Added `google/gemma-3-4b-it` to Planner model dropdown (~$0.02/hr)
- Added `enableQualityCheckOnPreview: true` to `DEFAULT_SETTINGS` in ipc-handlers.ts
- Added "Quality Check on Preview" checkbox toggle in Settings.tsx
- Updated SEARCH_BEAT_CANDIDATES handler: when toggle OFF, all candidates pass through unchecked

---

## Session 14

### Completed
- Added `renderOnly()` and `renderNew()` methods to Pipeline class
- Fixed NaN `from` prop crash (transitionDuration, startTime, duration safety defaults)
- Replaced subscribe overlay video with user's CapCut file
- Fixed overlay audio: renderer uses ffmpeg `amix` to mix overlay audio into VO track
- Renderer switched to `combineChunks(audioFiles:[])` + ffmpeg muxing
- Fixed concurrency: Preview and Re-download use `settings?.concurrency ?? 4`
- `llm.ts`: Added defensive `choices` check, `max_tokens: 4096`, `response_format: json_object`
- `scenePlanner.ts`: SRT_CHUNK_SIZE reduced 40→25, SRT_CHUNK_CONCURRENCY reduced 3→2

---

## Session 13 (Memory Files)

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
