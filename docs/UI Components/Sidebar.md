---
tags: [ui]
---

# Sidebar

**File**: `src-electron/renderer/src/components/Sidebar.tsx`

Left navigation sidebar with action buttons.

## Actions

| Button | Condition | Action |
|--------|-----------|--------|
| New | Always | Reset to input view |
| Projects | Always | Show projects list |
| Resume | Always | Resume from last failed state |
| Settings | Always | Open settings modal |
| Generate | `canGenerate` (has script + VO + API key) | Start pipeline |

## Props

```typescript
{
  view: AppView
  onNew: () => void
  onProjects: () => void
  onResume: () => void
  onSettings: () => void
  onGenerate: () => void
  canGenerate: boolean
}
```

See also: [[App Component]]
