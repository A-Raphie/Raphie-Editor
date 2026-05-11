---
tags: [ui]
---

# Progress Bar

**File**: `src-electron/renderer/src/components/ProgressBar.tsx`

Visual progress indicator during rendering. Shows percentage and step message.

## Props

```typescript
{
  progress: PipelineProgress  // step, current, total, percent, message
}
```

## Visual

- Gradient blue progress bar (blue-600 → blue-400)
- Smooth CSS transition on width changes
- Percentage text display
- Step message below bar

See also: [[App Component]], [[Orchestrator]]
