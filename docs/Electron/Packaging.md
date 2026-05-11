---
tags: [electron, packaging]
---

# Packaging

**File**: `electron-builder.yml`

electron-builder configuration for macOS DMG packaging.

## Build Pipeline

```
npm run build:electron     # electron-vite build (main + preload + renderer)
npx electron-builder --mac --dir   # Package to dist/mac-arm64/
```

## Key Config

| Setting | Value |
|---------|-------|
| `asar` | true — all code in single archive |
| `target` | DMG for arm64 |
| `extraResources` | `resources/mac/`, `resources/mac-arm64/` (ffmpeg, remotion-bin, vfx) |
| `identity` | null — unsigned (development) |

## asarUnpack

These packages are extracted from the asar to `app.asar.unpacked/`:
- `@remotion/**` — native binaries and bundler
- `sharp/**` — image processing native module
- `webpack/**` — used by Remotion bundler
- `esbuild/**`, `@esbuild/**` — build tool native binary
- `src/**` — Remotion source components

## Bundled Resources

```
resources/mac-arm64/
├── ffmpeg          # ~110MB ffmpeg binary
├── ffprobe         # ~30MB ffprobe binary
├── yt_dlp_bundle/  # yt-dlp Python bundle (legacy, not actively used)
└── remotion-bin/   # Remotion compositor binaries (~16MB)
    ├── remotion        # Rust compositor
    ├── ffmpeg          # Remotion's ffmpeg
    ├── ffprobe         # Remotion's ffprobe
    └── *.dylib         # Shared libraries
```

Note: `assets/vfx/` is bundled to `vfx/` in Resources for the subscribe overlay.

## Rebuild Cycle

Must fully rebuild after code changes. See [[Troubleshooting]].

See also: [[Main Process]], [[Paths Service]], [[Renderer]], [[Troubleshooting]]
