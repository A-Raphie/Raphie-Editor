# File Map

## Pipeline Core (`src/`)
| File | Purpose |
|------|---------|
| `config.ts` | Config type + createConfig factory, parseCommaList utility |
| `index.ts` | Pipeline entry point |
| `pipeline/scenePlanner.ts` | Scene plan generation: planScenes, planScenesFromSrt, planScenesFromSrtChunked, enforceBodyDurations, enforceBeatDistribution, validateScenePlan, buildSystemPrompt, buildSrtSystemPrompt |
| `pipeline/orchestrator.ts` | Pipeline orchestration: run pipeline, source assets, render |
| `pipeline/assetSourcer.ts` | Pexels/Pixabay API calls, asset download |
| `pipeline/qualityChecker.ts` | Quality check via LLM |
| `pipeline/dedupChecker.ts` | Duplicate asset detection + re-download |
| `pipeline/renderer.ts` | Remotion rendering |
| `types/scenePlan.ts` | ScenePlan, Beat, BeatOverlay types |
| `utils/llm.ts` | OpenRouter client, chatCompletion |
| `utils/logger.ts` | Logger class |
| `utils/srtParser.ts` | SRT parsing, SrtSegment type |
| `utils/stockApi.ts` | Stock API helpers |
| `utils/fileParser.ts` | Script file parsing |
| `utils/fileManager.ts` | File management utilities |
| `remotion/` | Remotion compositions (Documentary, VideoClip, ImageSlide, etc.) |

## Electron Main (`src-electron/main/`)
| File | Purpose |
|------|---------|
| `index.ts` | App startup, window creation, cleanup service call |
| `ipc-handlers.ts` | All IPC handlers (30+ channels), settings, pipeline, assets, rendering |
| `services/paths.ts` | Path helpers: getProjectDir, getOutputDir, getTempDir, etc. |
| `services/projects.ts` | Project CRUD (list, save, delete, rename, get) |
| `services/cleanup.ts` | Periodic cleanup of old assets |

## Electron Renderer (`src-electron/renderer/src/`)
| File | Purpose |
|------|---------|
| `App.tsx` | Main app component (~1700 lines): all state, handlers, view routing |
| `main.tsx` | React entry point |
| `components/Sidebar.tsx` | Navigation sidebar |
| `components/DropZone.tsx` | File input (script/SRT/VO/music) |
| `components/BeatTimeline.tsx` | Beat grid with thumbnails, status, candidates |
| `components/BeatEditor.tsx` | Individual beat editing panel |
| `components/CandidatePicker.tsx` | Candidate thumbnail grid with video preview |
| `components/PlanningView.tsx` | Loading/progress view during scene plan generation |
| `components/ProjectsView.tsx` | Project list with rename/delete |
| `components/Settings.tsx` | Tabbed settings (API Keys, General, Advanced) |
| `components/ModelSelector.tsx` | Model dropdowns |
| `components/ErrorModal.tsx` | Error overlay |
| `components/ConfirmModal.tsx` | Confirm dialog |
| `index.css` | Tailwind styles |

## Shared (`src-electron/shared/`)
| File | Purpose |
|------|---------|
| `types.ts` | AppSettings, SavedProject, IPC_CHANNELS, CandidatePreview, PipelineStateInfo |
