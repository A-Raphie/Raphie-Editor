# M - State

## App.tsx State Management (`src-electron/renderer/src/App.tsx`)

All state lives in App.tsx (no Redux/Zustand). 986 lines total.

---

## useState Hooks (37 hooks)

### Core State
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `settings` | `AppSettings \| null` | `null` | App-wide settings, loaded on mount |
| `view` | `string` | `"input"` | Current view: input, planning, editor, rendering, complete, projects, queue |
| `currentProjectId` | `string \| null` | `null` | Active project ID |
| `selectedResolution` | `number` | `1080` | Render resolution, resets to 1080 per session |

### Input Files
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `scriptPath` | `string \| null` | `null` | Script file path |
| `scriptLength` | `number` | `0` | Script character count |
| `srtPath` | `string \| null` | `null` | SRT subtitles file path |
| `voPath` | `string \| null` | `null` | Voiceover audio path |
| `musicPath` | `string \| null` | `null` | Background music path |

### Scene Plan
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `scenePlan` | `any` | `null` | Current ScenePlan object |
| `selectedBeatId` | `string \| null` | `null` | Selected beat in editor |
| `subscribeHintBeatIds` | `Set<string>` | `new Set()` | Beats containing "subscribe" keyword |
| `regenerating` | `boolean` | `false` | True while regenerating scene plan |

### Pipeline / Rendering
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `progress` | `PipelineProgress \| null` | `null` | Current render progress |
| `logs` | `string[]` | `[]` | Pipeline log messages |
| `outputPath` | `string \| null` | `null` | Rendered video output path |
| `error` | `ErrorInfo \| null` | `null` | Current error modal state |
| `renderingError` | `string \| null` | `null` | Error shown during rendering view |
| `pipelineStateInfo` | `PipelineStateInfo \| null` | `null` | Full pipeline state for resume |
| `confirm` | `ConfirmInfo \| null` | `null` | Confirm modal state |

### Assets
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `assets` | `Record<string, string>` | `{}` | beatId → asset file path |
| `thumbnails` | `Record<string, string>` | `{}` | beatId → thumbnail data URL |
| `beatStatuses` | `Record<string, BeatStatus>` | `{}` | beatId → download status |
| `assetValidation` | `Record<string, AssetValidation>` | `{}` | beatId → validation result |
| `checkingAssets` | `boolean` | `false` | True while validating assets |

### Re-download
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `reDownloadingBeat` | `string \| null` | `null` | Beat currently being re-downloaded |
| `downloadingBeats` | `string[]` | `[]` | All beats currently downloading |

### Candidate Picker
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `beatCandidates` | `Record<string, any[]>` | `{}` | beatId → search results |
| `selectedCandidateIndex` | `Record<string, number>` | `{}` | beatId → selected candidate index |
| `previewingAll` | `boolean` | `false` | True during "Preview All" search |
| `downloadingCandidateBeat` | `string \| null` | `null` | Beat downloading via candidate picker |

### Text Segments
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `beatTextSegments` | `Record<string, string>` | `{}` | beatId → script/SRT text for that time range |

### Batch Queue
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `batchQueue` | `BatchQueueItem[]` | `[]` | Queue items for batch rendering |
| `batchCurrentIndex` | `number` | `-1` | Current item being processed |

### UI State
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `showSettings` | `boolean` | `false` | Settings modal visibility |
| `showResumePicker` | `boolean` | `false` | Resume picker modal |
| `resumeOptions` | `any[]` | `[]` | Projects available for resume |
| `projects` | `SavedProject[]` | `[]` | All saved projects |

---

## useRef Hooks (7 refs)
| Ref | Purpose |
|-----|---------|
| `logsEndRef` | Auto-scroll log container |
| `viewRef` | Current view for closures |
| `scenePlanRef` | Current scene plan for closures |
| `openSettingsRef` | Open settings callback for closures |
| `autoSaveProjectRef` | Auto-save callback (avoids circular deps) |
| `pendingPlanProjectIdRef` | Project ID awaiting plan generation |
| `currentProjectIdRef` | Current project ID for IPC event filtering |
| `activePipelineProjectIdRef` | Pipeline project ID for progress filtering |

---

## useEffect Hooks (5)

1. **Mount**: Load settings + projects via `window.api`
2. **Logs scroll**: Auto-scroll to bottom when logs change
3. **Thumbnail loading**: Load thumbnails for all assets, debounced by asset map changes
4. **Subscribe detection**: Scan beat text segments for subscribe keywords → populate `subscribeHintBeatIds`
5. **Beat text segments**: Fetch script/SRT text for each beat's time range

---

## IPC Event Listeners (registered in single useEffect)
- `onProgress` → `setProgress`
- `onComplete` → set output path, view="complete", auto-save
- `onError` → translate error, show modal or rendering error
- `onScenePlanReady` → set scene plan, view="editor", save project
- `onLog` → append to logs array
- `onAssetDownloaded` → merge into assets map
- `onBeatStatus` → update beat download statuses

All listeners filter by `activePipelineProjectIdRef` to avoid cross-project pollution.

---

## Key Handlers

| Handler | Purpose |
|---------|---------|
| `handlePreview()` | Generate scene plan via `previewScenePlan` IPC |
| `handleRegenerate()` | Re-generate plan, clean old assets |
| `handleRenderVideo(mode)` | Check missing assets, then render via IPC |
| `handleReDownloadBeat(beatId, query)` | Re-download single beat asset |
| `handleSaveSearch(beatId, query)` | Save search query to beat, persist plan |
| `handleToggleOverlay(beatId)` | Toggle subscribe_cta overlay on beat |
| `handleCheckAllAssets()` | Validate all assets exist and are healthy |
| `handlePreviewAll()` | Search candidates for all beats in parallel |
| `handleDownloadAllSelected()` | Download selected candidates for all beats |
| `handleOpenProject(project)` | Load project, restore all state |
| `handleNewProject()` | Reset all state to defaults |
| `autoSaveProject(status, extra)` | Save/update current project |

---

## View Routing

| View | Condition | Shown |
|------|-----------|-------|
| `"input"` | default | `DropZone` |
| `"projects"` | user clicks Projects | `ProjectsView` |
| `"queue"` | user clicks Queue | Batch queue inline |
| `"planning"` | generating plan, no plan yet | `PlanningView` |
| `"editor"` | plan ready | BeatTimeline + BeatEditor |
| `"rendering"` | rendering in progress | Progress UI |
| `"complete"` | render done | Editor with completion bar |

Settings modal overlays everything when `showSettings` is true.

---

## Local Interfaces

```ts
interface ErrorInfo { title: string; message: string; actionLabel?: string; onAction?: () => void; }
interface ConfirmInfo { title: string; message: string; confirmLabel: string; onConfirm: () => void; }
interface BatchQueueItem { id, scriptPath, voPath, musicPath?, status, outputPath? }
interface BeatStatus { status: string; downloadPercent?: number; error?: string; errorDetails?: string; }
interface AssetValidation { valid: boolean; reason?: string; hasAsset?: boolean; }
```
