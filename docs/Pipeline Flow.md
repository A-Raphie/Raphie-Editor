---
tags: [pipeline]
---

# Pipeline Flow

5-step pipeline controlled by [[Orchestrator]]. Each step is tracked in `pipeline_state.json` for resume.

```mermaid
graph TD
    INIT[init 0-5%] --> SP[scene_planning 5-25%]
    SP --> AS[asset_sourcing 25-70%]
    AS --> QC[quality_check 70-85%]
    QC --> REN[rendering 85-100%]
    REN --> DONE[complete]
    
    SP -.-> |failed| SAVE1[save state]
    AS -.-> |failed| SAVE2[save state]
    QC -.-> |failed| SAVE3[save state]
    REN -.-> |failed| SAVE4[save state]
```

## Steps

| Step | Input | Output | Tool |
|------|-------|--------|------|
| **init** | scriptPath, voPath | Preflight checks | fs, yt-dlp, ffmpeg |
| **scene_planning** | Script text + VO duration | `ScenePlan` JSON | LLM via [[LLM Client]] |
| **asset_sourcing** | Beat search queries | `AssetMapping` {beatId: filePath} | [[yt-dlp Wrapper]] + LLM vision |
| **quality_check** | Downloaded assets | accepted/rejected lists | LLM vision ([[Quality Checker]]) |
| **rendering** | ScenePlan + assets + VO | Final .mp4 | [[Renderer]] (Remotion) |

## State Persistence

After each step completes, state is saved to `output/pipeline_state.json`:
- `completedSteps[]` — which steps succeeded
- `assets` — downloaded file paths
- `scenePlan` — path to saved scene plan JSON
- `scriptPath`, `voPath`, `musicPath` — original input paths

On resume ([[Orchestrator]]), completed steps are skipped.

See also: [[Orchestrator]], [[Data Model]], [[Configuration]]
