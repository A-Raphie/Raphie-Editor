---
tags: [utilities]
---

# Logger

**File**: `src/utils/logger.ts`

Structured logging with severity levels and file output.

## Usage

```typescript
const logger = new Logger('ScenePlanner')
logger.info('Starting scene planning...')
logger.warn('Retrying LLM call', { attempt: 2 })
logger.error('Failed to download', { error: err.message })
```

## Output

- **Console**: Color-coded by level (info=blue, warn=yellow, error=red)
- **File**: Appends to `output/logs/pipeline.log` with timestamps

## Levels

| Level | Method | Purpose |
|-------|--------|---------|
| debug | `logger.debug()` | Verbose diagnostic info |
| info | `logger.info()` | Normal progress messages |
| warn | `logger.warn()` | Recoverable issues |
| error | `logger.error()` | Failures |

Each logger instance is namespaced (e.g., `[ScenePlanner]`, `[Renderer]`) for filtering.

See also: [[Log Viewer]], [[Orchestrator]]
