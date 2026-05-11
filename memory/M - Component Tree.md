# M - Component Tree

## Component Hierarchy

```
App.tsx (root — all state lives here)
├── Sidebar
│   └── Navigation buttons: New, Projects, Queue, Settings
├── main (flex-1)
│   ├── [view="input"]      → DropZone
│   ├── [view="projects"]   → ProjectsView
│   ├── [view="queue"]      → Inline batch queue UI
│   ├── [view="planning"]   → PlanningView
│   ├── [view="editor"]     → Editor layout
│   │   ├── ModelSelector
│   │   ├── Toolbar (render, preview, check, clean, regenerate buttons)
│   │   ├── Asset validation summary
│   │   ├── BeatTimeline
│   │   └── BeatEditor (if beat selected)
│   │       └── CandidatePicker
│   ├── [view="rendering"]  → Progress UI / error with Continue Render
│   └── [view="complete"]   → Editor + completion bar
├── Settings (modal overlay)
├── ErrorModal (modal overlay)
├── ConfirmModal (modal overlay)
└── Resume picker (inline modal)
```

---

## Components Detail

### Sidebar (`Sidebar.tsx`, 61 lines)
**Props:** `view, onNew, onProjects, onQueue, onSettings`
- Fixed width `w-60`, dark sidebar with app logo
- Nav buttons highlight based on current `view`

### DropZone (`DropZone.tsx`, 126 lines)
**Props:** `scriptPath, voPath, musicPath, srtPath, onFilesSelected, onPreview, canPreview`
- File input rows for script/SRT, voiceover, music
- Uses `window.api.selectFiles()` for file dialogs
- Auto-detects file type by extension
- `SCRIPT_EXTENSIONS`: .txt, .md, .docx, .pdf, .rtf
- `SRT_EXTENSIONS`: .srt
- `AUDIO_EXTENSIONS`: .mp3, .wav, .m4a, .aac, .ogg, .flac

### ProjectsView (`ProjectsView.tsx`)
**Props:** `projects, onOpen, onRename, onDelete, onNew, onAddToQueue`
- Lists all saved projects with status badges
- Context actions: open, rename, delete, add to batch queue

### PlanningView (`PlanningView.tsx`)
**Props:** `scriptName, logs, error, onRetry`
- Flex layout with scrollable log panel
- Shows during scene plan generation

### ModelSelector (`ModelSelector.tsx`)
**Props:** `settings, onChange`
- Dropdown for planner model (6 models: gemma-3-4b-it, deepseek-v4-flash, etc.) with /hr cost labels
- Dropdown for checker model (4 models) with /hr cost labels
- Cost shown inline in dropdown options
- Inline in editor toolbar

### BeatTimeline (`BeatTimeline.tsx`, 209 lines)
**Props:** `beats, selectedBeatId, onSelectBeat, assets, thumbnails, beatStatuses, assetValidation, subscribeHintBeatIds, beatCandidates, selectedCandidateIndex`
- Horizontal scrollable beat strip
- Each beat shows: thumbnail, type badge, status indicator
- Click to select → opens BeatEditor
- Shows candidate thumbnails if searched
- Color-coded: clips=blue, images=purple, overlays=subtle indicator
- Subscribe hint beats highlighted when keyword detected

### BeatEditor (`BeatEditor.tsx`, 196 lines)
**Props:** `beat, thumbnail, assetPath, onReDownload, onSaveSearch, onToggleOverlay, onSearchBeat, onSelectCandidate, onDownloadCandidate, isReDownloading, beatStatus, subscribeHint, candidates, selectedCandidateIndex, scriptSegment`
- Bottom panel when a beat is selected
- Shows: thumbnail preview, search query editor, asset path
- Re-download button with new query
- Subscribe overlay toggle
- Script segment text display
- Embeds **CandidatePicker** for searching/downloading alternative assets

### CandidatePicker (`CandidatePicker.tsx`, 101 lines)
**Props:** `candidates, selectedIndex, onSelect, onDownload, isDownloading, hasAsset`
- Grid of candidate thumbnails from stock API search
- Video preview on hover (plays inline)
- Select → download flow
- Shows currently selected candidate highlighted

### Settings (`Settings.tsx`, 330 lines)
**Props:** `settings, onSave, onClose`
- Modal with 3 tabs: General, API, Advanced
- General: clip/image percent, resolution, concurrency, FPS, **Quality Check on Preview toggle** (checkbox, default ON)
- API: OpenRouter key, Pexels key, Pixabay key, model selectors with /hr pricing
- Advanced: hook duration, clip durations, quality threshold, segment length, search query rules, scene planner rules, content rules, vignette, color grade, forbidden words, generic fallbacks, cleanup settings, parallel segments
- Validates clip% + image% = 100

### ErrorModal (`ErrorModal.tsx`)
**Props:** `title, message, actionLabel, onAction, onDismiss`
- Generic error display with optional action button

### ConfirmModal (`ConfirmModal.tsx`)
**Props:** `title, message, confirmLabel, onConfirm, onCancel`
- Confirmation dialog for destructive actions

### ProgressBar (`ProgressBar.tsx`)
- Standalone progress bar component (used in batch queue)

### LogViewer (`LogViewer.tsx`)
- Standalone log viewer component

### Remotion Components (`src/remotion/`)
- **Documentary.tsx** — Main composition, `transitionDuration ?? 0` safety, overlay `<Sequence>` with hardcoded 180 frames
- **GraphicOverlay.tsx** — Subscribe overlay, `<OffthreadVideo>` without `muted`, uses `staticFile("vfx/subscribe.mp4")`
- **VideoClip.tsx**, **ImageSlide.tsx** — Beat renderers
- **Transition.tsx** — Transition effects
- **LowerThird.tsx** — Title card / lower third overlay

---

## Data Flow

```
User Input (DropZone)
  → App.tsx state (scriptPath, voPath, srtPath, musicPath)
  → handlePreview()
    → window.api.previewScenePlan() IPC
    → main process: scenePlanner.planScenes()
    → IPC SCENE_PLAN_READY event
    → App.tsx: setScenePlan(), setView("editor")

Editor (BeatTimeline + BeatEditor)
  → User edits search query → handleSaveSearch()
  → User clicks Preview → handlePreviewAll()
    → window.api.searchBeatCandidates() IPC for each beat
    → BeatTimeline shows candidate thumbnails
  → User clicks Download → handleDownloadAllSelected()
    → window.api.downloadSelectedCandidate() IPC
    → assets map updated → BeatTimeline updates thumbnails

Render
  → handleRenderVideo()
    → window.api.getPipelineState() (check assets)
    → window.api.renderVideo() IPC
    → main process: orchestrator.run() → assetSourcer → qualityChecker → renderer
    → IPC PIPELINE_PROGRESS events → progress bar
    → IPC PIPELINE_COMPLETE → setView("complete")
```

---

## IPC Communication Pattern

All renderer → main calls go through `window.api.*` (exposed by preload):
- **Request/Response**: `await window.api.previewScenePlan(...)` 
- **Events** (main → renderer): `window.api.onProgress(cb)`, `window.api.onComplete(cb)`, etc.
- **Filtering**: All event handlers check `activePipelineProjectIdRef` to avoid cross-project pollution
