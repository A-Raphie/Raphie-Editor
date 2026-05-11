---
tags: [pipeline, llm]
---

# Scene Planner

**File**: `src/pipeline/scenePlanner.ts`

Uses an LLM to convert script text + VO duration into a [[Data Model|ScenePlan]] with timed visual beats.

## Key Export

`planScenes(script, voDurationSeconds, config, logger)` → `ScenePlan`

## Process

1. Sends system prompt (documentary scene planner rules) + user prompt (script + duration) to LLM
2. Parses JSON response into `ScenePlan`
3. Validates structure (title, beats, fps=30, durations, required fields per beat type)
4. Retries up to 3 times on invalid output

## LLM Prompt Rules

- ~90% clips, ~3% images, ~7% motion graphics
- Clips always slowed (0.5-0.75x speed)
- Images always animated (Ken Burns)
- Transitions: 10 types, never same twice in a row
- Search queries must be specific and descriptive for stock API search
- Hook (first ~60s): 2-3s clips with fast cuts
- Body clips: 6s each

## Dependencies
- [[LLM Client]] (`chatCompletion`), [[Data Model]], [[Configuration]], [[Logger]]

See also: [[Orchestrator]], [[Pipeline Flow]]
