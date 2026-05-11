---
tags: [electron]
---

# Main Process

**File**: `src-electron/main/index.ts`

Electron main process. Handles app lifecycle, packaged-app patches, and window management.

## Packaged-App Patches

| Patch | Purpose |
|-------|---------|
| `fs.chmodSync` monkey-patch | Catches ENOTDIR errors from asar virtual paths |
| `ESBUILD_BINARY_PATH` | Points esbuild to unpacked binary in asar |

## Window Config

- 1280×860, min 1024×700
- `titleBarStyle: "hiddenInset"` (macOS native traffic lights)
- Dark background (`#09090b`)
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`

## Lifecycle

- `whenReady` → `createWindow()` + `registerIpcHandlers()`
- `activate` (macOS) → recreate window if none exist
- `window-all-closed` → don't quit on macOS

## Dependencies
- [[IPC Handlers]], [[Paths Service]], `electron`
