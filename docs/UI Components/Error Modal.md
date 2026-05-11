---
tags: [ui]
---

# Error Modal

**File**: `src-electron/renderer/src/components/ErrorModal.tsx`

Generic error display modal with optional action button.

## Props

```typescript
{
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
  onClose: () => void
}
```

## Features

- Error title and message text (selectable for copying)
- Optional action button (e.g., "Open Settings" for API key errors)
- Close/dismiss button

See also: [[App Component]]
