---
tags: [architecture]
---

# Architecture

Two modes: **CLI** (`src/index.ts`) and **Electron app** (`src-electron/`). Both share the same pipeline core (`src/pipeline/`).

## System Layers

```mermaid
graph LR
    subgraph "Electron Layer"
        UI[React UI] --> |IPC| PRE[Preload Bridge]
        PRE --> |ipcMain| MAIN[Main Process]
    end
    
    subgraph "Pipeline Layer"
        MAIN --> |import| ORCH[Orchestrator]
        ORCH --> SP[Scene Planner]
        ORCH --> AS[Asset Sourcer]
        ORCH --> QC[Quality Checker]
        ORCH --> REN[Renderer]
    end
    
    subgraph "External"
        SP --> |OpenRouter| LLM[LLM APIs]
        QC --> |OpenRouter| LLM
        AS --> |yt-dlp| YT[YouTube]
        REN --> |Remotion| CHROME[Headless Chrome]
        AS --> |ffmpeg| FS[Filesystem]
        REN --> |ffmpeg| FS
    end
```

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| Shared pipeline core | CLI and Electron use identical code |
| State persistence | `pipeline_state.json` enables resume from any failed step |
| Symlink-based asset serving | Avoids copying large video files into webpack bundle |
| Compositor binaries in resources | Bypasses asar read issues with native binaries |
| Monkey-patched `fs.chmodSync` | Handles asar virtual paths in packaged app |
| `process.chdir` for browser download | Remotion's `ensureBrowser` resolves cache dir from cwd |

## Data Flow

```
Script.txt + VO.mp3
  → Scene Planner (LLM) → ScenePlan (JSON)
  → Asset Sourcer (yt-dlp + LLM) → AssetMapping {beatId: filePath}
  → Quality Checker (vision LLM) → accepted/rejected lists
  → Renderer (Remotion) → output.mp4
```

See also: [[Pipeline Flow]], [[Data Model]], [[Packaging]]
