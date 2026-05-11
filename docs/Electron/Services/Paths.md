---
tags: [electron]
---

# Paths Service

**File**: `src-electron/main/services/paths.ts`

Resolves all binary and directory paths. Handles packaged vs development mode.

## Binary Resolution

`getBinaryPath(name)` checks in order:
1. **Packaged**: `process.resourcesPath/{mac|mac-arm64}/{name}`
2. **Homebrew**: `/opt/homebrew/bin/{name}` (Apple Silicon)
3. **Intel**: `/usr/local/bin/{name}`
4. **Fallback**: bare `name` (relies on PATH)

## Directory Structure

| Function | Packaged Path | Dev Path |
|----------|--------------|----------|
| `getProjectRoot()` | `~/AI Video Editor` | repo root |
| `getOutputDir()` | `{root}/output` | `{root}/output` |
| `getTempDir()` | `{root}/output/temp` | `{root}/output/temp` |
| `getClipsDir()` | `{root}/output/clips` | `{root}/output/clips` |
| `getImagesDir()` | `{root}/output/images` | `{root}/output/images` |
| `getLogDir()` | `{root}/output/logs` | `{root}/output/logs` |
| `getAssetsDir()` | `{root}/assets` | `{root}/assets` |
| `getInputDir()` | `{root}/input` | `{root}/input` |
| `getSettingsPath()` | `~/Library/Application Support/ai-video-editor/settings.json` | same |

## Remotion Paths

| Function | Purpose |
|----------|---------|
| `getRemotionEntryPath()` | `src/remotion/index.ts` via asar.unpacked |
| `getRemotionPublicDir()` | `assets/` via asar.unpacked |
| `getAppSourceBase()` | asar.unpacked in packaged mode, repo root in dev |

See also: [[Main Process]], [[Packaging]], [[Configuration]]
