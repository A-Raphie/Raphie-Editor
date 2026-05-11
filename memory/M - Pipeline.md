# M - Pipeline

## Pipeline Architecture

The pipeline is a 5-step sequential process managed by `orchestrator.ts`:

```
init (0-5%) → scene_planning (5-25%) → asset_sourcing (25-70%) → quality_check (70-85%) → rendering (85-100%)
```

Progress percentages are mapped via `STEP_RANGES` in orchestrator.

---

## Orchestrator (`src/pipeline/orchestrator.ts`, 601 lines)

### Pipeline Class
- Constructor takes `Config`, creates `Logger`
- State serialized to `pipeline_state.json` in output dir
- Scene plan saved to `scene_plan.json`

### Entry Points
1. **`run(scriptPath, voPath, musicPath?, scenePlanOverride?)`** — Full pipeline
2. **`resume()`** — Resume from saved state (re-sources missing assets)
3. **`runWithScenePlan(scriptPath, voPath, musicPath, plan)`** — Skip planning, use existing plan
4. **`rerunWithExistingPlan(scriptPath, voPath, musicPath, planPath)`** — Re-source assets with existing plan

### Step Flow
1. **init**: Parse script/SRT, get audio duration, validate inputs
2. **scene_planning**: Call `planScenes()` or use existing plan, then `sanitizeScenePlan()`, then `addSubscribeOverlays()`
3. **asset_sourcing**: Call `sourceAllAssets()` — downloads clips/images from Pexels/Pixabay
4. **quality_check**: Call `qualityCheckAssets()` — LLM-based visual quality verification
5. **rendering**: Call `renderVideoSegments()` — Remotion renders segments, then combines

### Resume Logic
- Reads `pipeline_state.json` for completed steps
- Skips already-completed steps
- Re-downloads failed/missing assets
- Can resume rendering from last completed segment

### State Persistence
```ts
PipelineState {
  runId, status, currentStep, completedSteps,
  totalBeats, completedBeats[], failedBeats{},
  scenePlan (JSON string), assets (AssetMapping),
  scriptPath, voPath, musicPath,
  renderSegments (RenderSegmentState | null)
}
```

---

## Scene Planner (`src/pipeline/scenePlanner.ts`, 785 lines)

### Main Functions
- **`planScenes(script, voDuration, config)`** — Generates ScenePlan via LLM
- **`planScenesFromSrtChunked(srtSegments, voDuration, config)`** — Chunked SRT planning
- **`addSubscribeOverlays(plan, script)`** — Detects "subscribe" keyword, adds overlay
- **`buildSystemPrompt(...)`** — Constructs LLM system prompt with rules

### Post-Processing Pipeline (execution order matters!)
1. `enforceBodyDurations(plan, config)` — Enforces min/max clip durations for hook and body
2. `mergeShortBeats(plan, threshold)` — Merges beats shorter than threshold
3. `enforceBeatDistribution(plan, clipPercent, imagePercent)` — Enforces overall clip/image ratio
4. Stride-based spreading for type conversions (avoids clustering)

### Key: Execution Order
**`enforceBodyDurations` runs FIRST, `enforceBeatDistribution` runs LAST**
This ensures duration enforcement doesn't destroy the distribution, and the final distribution is the enforced one.

### Beat Distribution Algorithm
- Targets **overall** ratio (all beats including hook)
- Uses majority-based type resolution in merge: `resolveType()` picks most common type
- Stride-based spreading: converts types at even intervals to avoid clustering
- Known issue: still clusters — Bresenham's algorithm planned but not implemented

### Search Query Rules
- `DEFAULT_SEARCH_QUERY_RULES` in `ipc-handlers.ts` — hardcoded default with segment-level visual mapping
- Saved settings override default; new rules may not take effect without clearing the field
- Rules include good/bad examples for each video segment type

### Count-Up Detection
- `detectCountUpMode(script)` — Detects "Number X, [label]" patterns
- When detected, adds count-up specific rules to the prompt

---

## Asset Sourcer (`src/pipeline/assetSourcer.ts`, 329 lines)

### `sourceAllAssets(beats, config, logger, existingAssets, onBeatProgress)`
- Separates clip beats and image beats
- Sources clips first, then images
- ETA calculation based on average time per beat
- Returns `{ assets: AssetMapping, failed: Record<string, reason> }`

### Download Functions
- `searchAndDownloadVideo(query, config, logger, onProgress)` — From `stockApi.ts`
- `searchAndDownloadImage(query, config, logger)` — From `stockApi.ts`
- Parallel downloading with concurrency control
- Retry logic with fallback queries (generic terms from config)

### Fallback Strategy
1. Try original search query
2. On failure, try generic fallbacks from config (e.g., "nature", "garden", "landscape")
3. Mark as failed after all retries exhausted

---

## Quality Checker (`src/pipeline/qualityChecker.ts`, 178 lines)

### `qualityCheckAssets(beats, assets, config, logger)`
- For each asset: extract frame (video) or use image directly
- Send to LLM (vision model) with quality prompt
- Score 1-10, accept if score >= threshold AND plant-related
- Rejects trigger re-download with fallback query

### Quality Result
```ts
interface QualityResult {
  beatId: string;
  accepted: boolean;
  score: number;
  reason: string;
}
```

### Frame Extraction
- Uses ffmpeg to extract frame at 0.5s for video files
- Converts to base64 for LLM vision API

---

## Renderer (`src/pipeline/renderer.ts`, 360 lines)

### `renderVideoSegments(scenePlan, assets, config, logger, onProgress, state)`
- Bundles Remotion entry point
- Selects composition
- Renders in segments (configurable `segmentLength`, default 900 frames = 30s at 30fps)
- Supports parallel segment rendering (`parallelSegments` 1-3)
- Combines segments with Remotion's `combineChunks()`

### Segment Rendering
- Each segment is rendered independently to a temp directory
- State tracks completed segments for resume capability
- Continues from last completed segment on resume

### Output
- Final video: H.265 or H.264 (configurable)
- Resolution: 480p, 720p, or 1080p (user-selected per render)
- Audio: voiceover + music at configured volume

### Remotion Integration
- Entry: `src/remotion/index.ts`
- Public dir: `assets/` (for file:// URL access)
- Compositor binary: from `@remotion/compositor-darwin-arm64` or bundled in resources
- Browser: auto-downloaded by Remotion (downloads in `os.homedir()`)

---

## Supporting Modules

### `src/utils/stockApi.ts`
- Pexels API: `searchVideos()`, `searchPhotos()`
- Pixabay API: `searchVideos()`, `searchImages()`
- Download functions with progress callbacks
- `getAudioDuration()` via ffprobe

### `src/utils/llm.ts`
- `createOpenRouterClient()` — OpenRouter API client
- `chatCompletion()` — Text-only LLM calls
- `chatWithImages()` — Vision LLM calls (for quality checker)

### `src/utils/srtParser.ts`
- `parseSrt(srtContent)` → `SrtSegment[]`
- `srtSegmentsToScriptText(segments)` → plain text
- `SrtSegment { index, startTime, endTime, text }`

### `src/utils/fileParser.ts`
- `parseFile(path)` — Reads script files (.txt, .md, .docx, .pdf, .rtf)

### `src/utils/fileManager.ts`
- `ensureDir()`, `deleteFile()`, `cleanDir()`
- `fileToBase64()`, `getMimeType()`

### `src/utils/logger.ts`
- Logs to file in output/logs/
- Callback-based: `onLog` for real-time IPC forwarding
