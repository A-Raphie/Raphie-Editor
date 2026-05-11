---
tags: [ui]
---

# Projects View

**File**: `src-electron/renderer/src/components/ProjectsView.tsx`

List and manage saved projects. Each project stores script/VO/music paths and last scene plan.

## Features

- List of saved projects with names and dates
- Click to load project (restores script/VO/music paths and scene plan)
- Delete individual projects
- Rename projects

## Props

```typescript
{
  onOpenProject: (project: SavedProject) => void
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, name: string) => void
}
```

See also: [[Projects Service]], [[App Component]]
