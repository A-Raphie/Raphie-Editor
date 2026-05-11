# Raphie's Editor — AI Context

Electron + React + Remotion app that generates documentary-style videos from scripts/SRT + voiceover.

## Build Commands
```
npm run dev            # Electron dev mode
npm run build:dmg      # Build macOS DMG
```

## Memory Map
This project has an Obsidian-compatible memory map at `memory/` for AI context:

| File | Content |
|------|---------|
| `memory/M - Architecture.md` | Stack, build commands, three-process architecture, data flow |
| `memory/M - File Map.md` | Every source file with purpose, exports, line numbers |
| `memory/M - Types.md` | All shared types, pipeline types, config types, cross-references |
| `memory/M - State.md` | All App.tsx useState hooks, effects, handlers, view routing |
| `memory/M - Component Tree.md` | Component hierarchy, props, data flow |
| `memory/M - Pipeline.md` | Orchestrator, renderer, asset sourcer, quality checker details |
| `memory/M - Bugs and Fixes.md` | Known bugs, session history |
| `memory/M - Decisions.md` | Design decisions, user preferences, environment info |
| `memory/M - Session Log.md` | Running log of changes per session |

## Reading Order for New Sessions
1. `memory/M - Architecture.md` — high-level overview
2. `memory/M - Session Log.md` — what was done recently
3. `memory/M - Bugs and Fixes.md` — known issues
4. Then read specific memory files as needed for the task

## Key Paths
- Source: `src-electron/` (Electron app), `src/` (pipeline core)
- Shared types: `src-electron/shared/types.ts`
- Pipeline types: `src/types/scenePlan.ts`
- Main app component: `src-electron/renderer/src/App.tsx`
- IPC handlers: `src-electron/main/ipc-handlers.ts`

## Critical Notes
- Project was accidentally deleted in session 10 and fully reconstructed from compiled JS in the deployed app
- All source files were extracted from `app.asar` compiled output — they are faithful to the working app but were not hand-written
- No git history exists — treat the current source as the source of truth
- The `memory/` directory was recreated from session context — may have gaps
