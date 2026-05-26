# M - Bugs and Fixes

## Known Issues (Open)

### Beat type clustering (Priority: Medium)
- **Problem**: Even with 40/60 clip/image ratio, types cluster — e.g., all clips in first half, all images in second half
- **Current approach**: Stride-based spreading converts types at even intervals
- **Planned fix**: Implement Bresenham's algorithm for optimal interleaving
- **Location**: `src/pipeline/scenePlanner.ts` → `enforceBeatDistribution()`

### Search query rules may not take effect
- **Problem**: `DEFAULT_SEARCH_QUERY_RULES` is hardcoded in `ipc-handlers.ts` as fallback, but saved settings override it. New default rules won't apply to existing users who have old rules saved.
- **Workaround**: User must manually clear the search query rules field in Settings
- **Location**: `src-electron/main/ipc-handlers.ts`

### Candidate thumbnails not persisted
- **Problem**: Candidate search results and thumbnails are lost on app restart
- **Status**: Discussed, deferred for now
- **Impact**: User must re-search candidates after reopening a project

### No git history
- **Problem**: Project was accidentally deleted in session 10, no git repo existed
- **Status**: FIXED in session 16 — git repo initialized, initial commit `f14b5f5`

---

## Fixed Issues

### Uptime feature showed misleading 100% (Session 20)
- **Bug**: OpenRouter `uptime_last_5m` API metric always returned ~100% even when real reliability was ~92%. The API measures endpoint health checks, not actual request success rate.
- **Fix**: Removed entire uptime feature — `uptimeColor`, `owlUptime` state, warning dot, badge from ModelSelector; `GET_MODEL_UPTIME` handler from ipc-handlers; `getModelUptime` from preload; `GET_MODEL_UPTIME` from IPC_CHANNELS.
- **Files**: `src-electron/renderer/src/components/ModelSelector.tsx`, `src-electron/main/ipc-handlers.ts`, `src-electron/preload/index.ts`, `src-electron/shared/types.ts`

### Model lists drifting between Settings and ModelSelector (Session 20)
- **Bug**: Model options were hardcoded separately in `ModelSelector.tsx` (arrays) and `Settings.tsx` (HTML `<option>` tags). Adding a model to one but not the other caused drift.
- **Fix**: Consolidated `PLANNER_MODELS` and `CHECKER_MODELS` into `shared/types.ts` with `ModelOption` type. Both components import from single source.
- **Files**: `src-electron/shared/types.ts`, `src-electron/renderer/src/components/ModelSelector.tsx`, `src-electron/renderer/src/components/Settings.tsx`

### Manual quality checker mode missing (Session 20)
- **Bug**: Users could not choose to skip automated quality checking; adding a UI-only `None` option would have caused the pipeline to call OpenRouter with model ID `none`.
- **Fix**: Added `None (Manual Review)` to checker model selectors, allowed `none` in settings validation, bypassed preview thumbnail checks, bypassed full pipeline quality checks, and accepted asset-sourcing candidates without thumbnail AI checks in manual mode.
- **Files**: `src-electron/renderer/src/components/ModelSelector.tsx`, `src-electron/renderer/src/components/Settings.tsx`, `src-electron/main/ipc-handlers.ts`, `src/pipeline/qualityChecker.ts`, `src/pipeline/orchestrator.ts`, `src/pipeline/assetSourcer.ts`

### Beat durations destroyed by scaleToAudioDuration (Session 17)
- **Bug**: `scaleToAudioDuration()` ran AFTER `enforceBodyDurations()`, scaling all beats proportionally and destroying the 3-5s constraints. Hook section had zero code enforcement.
- **Symptoms**: Beats were 0.1-0.4s instead of 3-5s (e.g., beat_021: 0.1755s, beat_022: 0.1826s)
- **Fix**: Added `enforceHookDurations()` function (same merge/split logic as body). Reordered execution: `scaleToAudioDuration` → `enforceHookDurations` → `enforceBodyDurations` → `enforceBeatDistribution`. Applied in all 3 planning paths.
- **File**: `src/pipeline/scenePlanner.ts`

### Memory warning threshold (Session 10)
- **Bug**: Memory warning showed `< 16` but user has exactly 16.00GB
- **Fix**: Changed to `<= 16` in `App.tsx`
- **File**: `src-electron/renderer/src/App.tsx`

### Double `?t=` in BeatTimeline (Session 10)
- **Bug**: Thumbnail URLs had double `?t=` query parameter
- **Fix**: Removed duplicate parameter concatenation
- **File**: `src-electron/renderer/src/components/BeatTimeline.tsx`

### Regenerating overlay not scrollable (Session 10)
- **Bug**: Log output in regenerating overlay was cut off
- **Fix**: Added `max-h-64 overflow-y-auto`, `logs.slice(-20)`, `logsEndRef` for auto-scroll
- **File**: `src-electron/renderer/src/App.tsx`

### Wrong execution order (Session 10)
- **Bug**: `enforceBeatDistribution` ran before `enforceBodyDurations`, so merging destroyed distribution
- **Fix**: Swapped — `enforceBodyDurations` runs FIRST, `enforceBeatDistribution` runs LAST
- **File**: `src/pipeline/scenePlanner.ts`

### Merge type resolution (Session 10)
- **Bug**: Merged beats always became "clip" when types mixed
- **Fix**: `resolveType()` now uses majority type instead of defaulting to clip
- **File**: `src/pipeline/scenePlanner.ts`

### Body clip durations not applied to images (Session 10)
- **Bug**: `bodyClipMin`/`bodyClipMax` only applied to clips, not images
- **Fix**: Duration enforcement now applies to both clips AND images in body section
- **File**: `src/pipeline/scenePlanner.ts`

### Preload missing IPC channels (Session 10)
- **Bug**: 13 IPC channels were missing from preload, causing blank screen
- **Fix**: Rewrote `preload/index.ts` with all 30+ channels and correct parameter signatures
- **File**: `src-electron/preload/index.ts`

### PlanningView layout (Session 10)
- **Bug**: Planning view had no scrollable log panel
- **Fix**: Rewrote with flex layout and scrollable log panel
- **File**: `src-electron/renderer/src/components/PlanningView.tsx`

### Hardcoded segment length (Session 16)
- **Bug**: `renderer.ts` used hardcoded `SEGMENT_LENGTH=900` instead of `config.segmentLength` from settings
- **Fix**: Removed constant, replaced all uses with `config.segmentLength ?? 900`
- **File**: `src/pipeline/renderer.ts`

---

## Session History

### Session 16
- Replaced hardcoded SEGMENT_LENGTH with config.segmentLength from settings
- Initialized git repo, initial commit with full project baseline

### Session 15
- Added quality check toggle for Preview, updated model pricing to /hr format
- Added google/gemma-3-4b-it planner model

### Session 14
- Added renderOnly()/renderNew() methods, fixed NaN crash, overlay audio amix fix
- Switched renderer to combineChunks(audioFiles:[]) + ffmpeg muxing

### Session 10 (earliest tracked)
- Fixed memory warning, double `?t=`, PlanningView layout, regenerating overlay scroll
- Swapped execution order (body durations → beat distribution)
- Fixed merge type resolution (majority wins)
- Fixed body clip durations to apply to images too
- Rewrote search query rules with segment-level visual mapping
- **DISASTER**: Project accidentally deleted during this session
- Began recovery from compiled JS in deployed app

### Session 11-12
- Continued project recovery (Phase 2)
- Reconstructed all 13 renderer components + 7 main process files
- Rewrote preload with correct parameter signatures
- Build succeeded, verified component names match working copy
- Deployed to `/Applications/Raphie's Editor.app`

### Session 13
- Created `memory/` directory with documentation files
- Created `AGENTS.md` with reading order for new sessions
- Completed: Architecture, File Map, Types, State, Component Tree, Pipeline memory files
