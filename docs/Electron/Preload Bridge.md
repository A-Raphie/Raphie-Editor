---
tags: [electron]
---

# Preload Bridge

**File**: `src-electron/preload/index.ts`

Context bridge exposing a typed `window.api` object to the renderer process.

## Exposed API

```typescript
window.api = {
  getSettings(): Promise<AppSettings>
  saveSettings(settings): Promise<boolean>
  selectFiles(options): Promise<string[] | null>
  runPipeline(args): Promise<string>
  previewScenePlan(scriptPath, voPath): Promise<ScenePlan>
  resumePipeline(): Promise<string>
  cancelPipeline(): Promise<boolean>
  openInFinder(filePath): Promise<void>
  onPipelineLog(callback): () => void
  onPipelineProgress(callback): () => void
  onPipelineComplete(callback): () => void
  onPipelineError(callback): () => void
  onScenePlanReady(callback): () => void
  listProjects(): Promise<SavedProject[]>
  getProject(id): Promise<SavedProject>
  saveProject(data): Promise<SavedProject>
  deleteProject(id): Promise<boolean>
  renameProject(id, name): Promise<SavedProject>
}
```

## Type Definitions

Shared types in `src-electron/shared/types.ts`: `AppSettings`, `RunPipelineArgs`, `PipelineProgress`, `SavedProject`, `IPC_CHANNELS`.

## Security

- `contextIsolation: true` — renderer cannot access Node.js directly
- `nodeIntegration: false` — no require() in renderer
- All IPC through typed `contextBridge.exposeInMainWorld()`

See also: [[IPC Handlers]], [[Main Process]]
