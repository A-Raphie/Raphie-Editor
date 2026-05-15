# Raphie's Editor

Autonomous documentary-style video pipeline. Takes a script/SRT + voiceover audio, uses LLMs to plan visual beats, sources video/image assets via Pexels/Pixabay APIs, quality-checks them via vision LLMs, and renders the final video using either **Remotion** or **FFmpeg**.

Available as a **macOS desktop app** (Electron).

## Download

[Download v1.0.0 DMG](https://github.com/A-Raphie/Raphie-Editor/releases/tag/v1.0.0) — macOS ARM64

## Features

- **Dual renderer** — Remotion (Chrome-based) or FFmpeg (faster, no Chrome needed)
- **Cancel & continue** — Stop rendering at any time, resume from where you left off with session time tracking
- **LLM query translation** — When stock searches fail, an LLM rewrites queries into photographer-friendly terms
- **Session time tracking** — See cumulative render time across multiple sessions with per-session breakdown
- **Quality checking** — Vision LLM validates assets match the scene plan
- **Candidate picker** — Choose from multiple stock search results per beat
- **VFX overlays** — Subscribe CTA overlay with audio mixing
- **10 Ken Burns animations** — Zoom, pan, and dramatic directions for images
- **Batch rendering** — Queue multiple projects
- **Resume from failure** — Pipeline state persists, pick up where you left off

## Quick Start

```bash
# Clone
git clone https://github.com/A-Raphie/Raphie-Editor.git
cd Raphie-Editor

# Install dependencies
npm install

# Run dev mode
npm run dev

# Build DMG
npm run build:dmg
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App shell | Electron 41 |
| UI | React 19 + Tailwind CSS |
| Pipeline | TypeScript (shared `src/`) |
| Remotion renderer | Remotion 4.0 + Chrome headless |
| FFmpeg renderer | Native FFmpeg (spawn) |
| LLMs | OpenRouter API (Claude, Gemini, GPT) |
| Stock APIs | Pexels + Pixabay |
| Packaging | electron-builder + asar |

## Architecture

```
Script/SRT + VO.mp3
  → Scene Planner (LLM) → ScenePlan (JSON)
  → Asset Sourcer (Pexels/Pixabay) → AssetMapping {beatId: filePath}
  → Quality Checker (vision LLM) → accepted/rejected
  → Renderer (Remotion or FFmpeg) → output.mp4
```

## Project Structure

```
src-electron/          # Electron app
  main/                # Main process (IPC handlers, app lifecycle)
  renderer/            # React UI (App.tsx, components)
  preload/             # Context bridge
  shared/              # Shared types
src/                   # Pipeline core (shared)
  pipeline/            # Orchestrator, renderers, asset sourcer, etc.
  utils/               # LLM client, stock API, logger
  types/               # TypeScript types
  config.ts            # Configuration defaults
memory/                # AI context memory map
docs/                  # Obsidian documentation vault
```

## License

ISC
