---
tags: [home]
---

# AI Video Editor

Autonomous documentary video pipeline. Takes a script + voiceover audio, uses LLMs to plan visual beats, sources video/image assets via yt-dlp, quality-checks them via vision LLMs, and renders the final 1080p video using Remotion.

Available as both a **CLI tool** and an **Electron Mac desktop app**.

## Architecture

```mermaid
graph TD
    User[User Input] --> |script + VO| CLI[CLI / Electron App]
    CLI --> SP[Scene Planner]
    SP --> |ScenePlan| AS[Asset Sourcer]
    AS --> |clips + images| QC[Quality Checker]
    QC --> |accepted assets| REN[Remotion Renderer]
    REN --> MP4[Final .mp4]
    
    SP --> |LLM call| LLM[OpenRouter API]
    AS --> |yt-dlp| YT[YouTube]
    AS --> |LLM vision| LLM
    QC --> |LLM vision| LLM
    REN --> |Chrome headless| REM[Remotion/webpack]
```

## Explore

### Core
- [[Architecture]] - System design deep dive
- [[Pipeline Flow]] - Step-by-step pipeline with progress mapping
- [[Data Model]] - All TypeScript types and interfaces
- [[Configuration]] - Config system, model tiers, settings
- [[Troubleshooting]] - Known issues and fixes

### Pipeline Steps
- [[Orchestrator]] - Master pipeline controller
- [[Scene Planner]] - LLM scene plan generation
- [[Asset Sourcer]] - yt-dlp download + LLM window selection
- [[Quality Checker]] - Vision LLM asset validation
- [[Renderer]] - Remotion bundle + render

### Electron App
- [[Main Process]] - App lifecycle, patches
- [[IPC Handlers]] - All IPC channels + flow
- [[Preload Bridge]] - Context bridge API
- [[Paths Service]] - Binary + directory resolution
- [[Projects Service]] - Project CRUD persistence
- [[Packaging]] - electron-builder, asar, resources

### UI Components
- [[App Component]] - Root component, state, error handling
- [[Sidebar]] - Navigation
- [[DropZone]] - File input
- [[Model Selector]] - Model dropdowns
- [[Beat Timeline]] - Beat visualization
- [[Beat Editor]] - Beat property editing
- [[Settings]] - Settings modal
- [[Log Viewer]] - Real-time logs
- [[Planning View]] - Scene plan preview
- [[Projects View]] - Project management
- [[Error Modal]] - Error display
- [[Progress Bar]] - Render progress

### Remotion Components
- [[Remotion Root]] - Composition registration
- [[Documentary]] - Main composition
- [[Video Clip]] - Clip playback with effects
- [[Image Slide]] - Ken Burns animation
- [[Title Card]] - Title cards
- [[Lower Third]] - Overlay text
- [[Motion Graphic]] - Animated graphics
- [[Transition]] - 10 transition types

### Utilities
- [[LLM Client]] - OpenRouter + retry logic
- [[yt-dlp Wrapper]] - Download, trim, extract
- [[File Parser]] - Multi-format script parsing
- [[File Manager]] - FS utilities
- [[Logger]] - Timestamped logging
