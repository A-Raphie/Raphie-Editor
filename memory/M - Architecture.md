# Architecture

## Stack
- **Electron** (electron-vite) — main process + renderer + preload
- **React 19** — UI framework
- **Remotion** — video rendering (compositions, bundling, rendering)
- **Vite + Rolldown** — bundler
- **TypeScript** — all source files

## Three-Process Architecture
1. **Main Process** (`src-electron/main/`) — Node.js, IPC handlers, pipeline orchestration, file system access
2. **Renderer Process** (`src-electron/renderer/`) — React UI, communicates via `window.api.*` IPC calls
3. **Preload** (`src-electron/preload/`) — Bridge between main and renderer via `contextBridge`

## Data Flow
1. User selects script/SRT + voiceover in renderer
2. Renderer calls `window.api.previewScenePlan()` → main process
3. Main process calls `scenePlanner.planScenes()` or `planScenesFromSrt()` → LLM via OpenRouter
4. LLM returns JSON scene plan → post-processed (enforceBodyDurations, enforceBeatDistribution, etc.)
5. Scene plan sent back to renderer → user edits in beat editor
6. User triggers asset sourcing → main downloads from Pexels/Pixabay
7. User triggers render → Remotion renders video segments → stitched into final MP4

## Build Output
- `npm run build:dmg` → `dist/mac-arm64/Raphie's Editor.app` + DMG
- Renderer bundled to `out/renderer/`
- Main process bundled to `out/main/` (each module separate)
- Preload bundled to `out/preload/`
- Remotion bundled separately at render time

## Key Config
- `electron-builder.yml` — macOS app build config
- `electron.vite.config.ts` — Vite config for main/renderer/preload
- `src/config.ts` — pipeline config (clip/image %, durations, search rules, etc.)
