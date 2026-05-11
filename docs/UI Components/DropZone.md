---
tags: [ui]
---

# DropZone

**File**: `src-electron/renderer/src/components/DropZone.tsx`

Drag-and-drop file input with native file dialog fallback.

## Props

```typescript
{
  label: string
  accept: string      // File type filter (e.g., ".mp3,.wav")
  value: string | null   // Current file path
  onChange: (path: string) => void
  optional?: boolean     // Show "(optional)" label
}
```

## Features

- Drag-and-drop zone with visual feedback
- Click to open native file dialog
- Shows selected filename
- Clear button to remove selection

See also: [[App Component]]
