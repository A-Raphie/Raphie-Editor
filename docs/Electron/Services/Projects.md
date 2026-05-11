---
tags: [electron]
---

# Projects Service

**File**: `src-electron/main/services/projects.ts`

CRUD operations for saved projects. Persists to `~/Library/Application Support/ai-video-editor/projects.json`.

## Functions

| Function | Description |
|----------|-------------|
| `listProjects()` | Returns all saved projects |
| `getProject(id)` | Get single project by ID |
| `saveProject(data)` | Create or update project (generates ID if new) |
| `deleteProject(id)` | Remove project |
| `renameProject(id, name)` | Update project name |

## Project Schema

```typescript
SavedProject {
  id: string              // UUID
  name: string            // Display name
  scriptPath: string
  voPath: string
  musicPath?: string
  scenePlan?: ScenePlan   // Last known scene plan
  createdAt: string       // ISO date
  updatedAt: string       // ISO date
}
```

See also: [[IPC Handlers]], [[Data Model]]
