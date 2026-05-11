---
tags: [ui]
---

# Log Viewer

**File**: `src-electron/renderer/src/components/LogViewer.tsx`

Scrolling real-time log display during pipeline execution.

## Features

- Auto-scrolls to bottom on new entries
- Timestamped log lines
- Text is selectable (for copying error messages)
- Color-coded: errors in red, warnings in yellow

## Props

```typescript
{
  logs: string[]
}
```

See also: [[App Component]], [[Logger]]
