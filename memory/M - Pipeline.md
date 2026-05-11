# M - Pipeline

## Pipeline Architecture

The pipeline is a 5-step sequential process managed by `orchestrator.ts`:

```
init (0-5%) → scene_planning (5-25%) → asset_sourcing (25-70%) → quality_check (70-85%) → rendering (85-100%)
```

Progress percentages are mapped via `STEP_RANGES` in orchestrator.

---

## Orchestrator (`src/pipeline/orchestrator.ts`, 708 lines)

### Pipeline Class
- Constructor takes `Config`, creates `Logger`
- State serialized to `pipeline_state.json` in output dir
- Scene plan saved to `scene_plan.json`

### Entry Points
1. **`run(scriptPath, voPath, musicPath?, scenePlanOverride?, srtPath?)`** — Full pipeline (note: RUN_PIPELINE doesn't pass srtPath; only RENDER_VIDEO passes it)
2. **`resume()`** — Resume from saved state (re-sources missing assets)
3. **`runWithScenePlan(scriptPath, voPath, musicPath, plan)`** — Skip planning, use existing plan
4. **`rerunWithExistingPlan(scriptPath, voPath, musicPath, planPath)`** — Re-source assets with existing plan
5. **`renderOnly(outputDir)`** — Read pipeline state from disk, verify assets, then render with segment combining + ffmpeg audio muxing
6. **`renderNew(scenePlan, assets, config, outputDir, voPath, musicPath)`** — Render with a new/modified plan without re-running the full pipeline

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

### SRT Chunk Planning
- `SRT_CHUNK_SIZE=25` (reduced from 40 for 2+ hour video reliability — fewer tokens = fewer 502 errors)
- `SRT_CHUNK_CONCURRENCY=2` (reduced from 3 — reduces 502/provider errors on OpenRouter)
- `max_tokens: 4096` on scene planner calls — prevents output truncation
- `validateScenePlan()` validates `startTime` and `duration` fields

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

## Renderer (`src/pipeline/renderer.ts`, ~470 lines)

### `renderVideoSegments(scenePlan, assets, config, logger, voPath?, musicPath?, existingState?, callbacks?)`
- Bundles Remotion entry point
- Selects composition
- Renders in segments (uses `config.segmentLength` from settings, default 900 frames = 30s at 30fps)
- Combines segments with Remotion's `combineChunks(audioFiles: [])` — no audio in combine step
- All audio (VO, music, overlay) muxed via ffmpeg after video combine

### Muted Rendering Architecture
- `renderMedia({ muted: true })` — Remotion renders video-only segments
- Audio must be muxed via ffmpeg after segment combine
- This is because Remotion's audio handling was unreliable for complex mixes

### Segment Rendering
- Each segment is rendered independently to a temp directory (`segmentDir`)
- State (`RenderSegmentState`) tracks completed segments for resume capability
- Continues from last completed segment on resume
- Segment length reads from `config.segmentLength ?? 900` (no longer hardcoded)

### Segment Render Callbacks
```ts
interface SegmentRenderCallbacks {
  onSegmentProgress?: (segIndex, totalSegments, frameProgress) => void;
  onSegmentComplete?: (segIndex) => void;
  onSegmentsInit?: (info: { totalSegments, segmentLength, segmentDir }) => void;
}
```

### Overlay Audio Mixing
- Overlay beats filtered by `overlay?.type === "subscribe_cta"`
- Overlay audio extracted from VFX file (`config.vfxPath`) via `ffmpeg -vn -acodec aac`
- For each overlay beat: audio delayed with `adelay` filter to match beat's `showAt` time
- Mixed into VO track with `amix(inputs=2, normalize=0)`
- Multiple overlays supported via chained `adelay`+`amix`
- ffmpeg fallback on mux failure: simple `-map` approach without overlay mixing

### Audio Muxing Pipeline
1. Combine video segments → temp video (no audio)
2. Build ffmpeg command: `-i tempVideo [-i voPath] [-i musicPath]`
3. Extract overlay audio from VFX file if overlay beats exist
4. If overlay audio: use `amix` filter to mix overlay into VO
5. If mux fails: fallback to simple `-map` approach (video + VO + music, no overlay)
6. Clean up temp files and segment directory

### Output
- Final video: H.265 or H.264 (configurable)
- Resolution: 480p, 720p, or 1080p (user-selected per render)
- Audio: voiceover + music + overlay audio (single stream, mixed via ffmpeg)

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
- `chatCompletion()` — Text-only LLM calls with `max_tokens: 4096`, defensive `choices` check with raw response logging
- `chatWithImages()` — Vision LLM calls with `response_format: { type: "json_object" }`, defensive `choices` check

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
