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
