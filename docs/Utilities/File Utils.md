---
tags: [utilities]
---

# File Utils

**File**: `src/utils/files.ts`

Common file system operations used across the pipeline.

## Functions

| Function | Purpose |
|----------|---------|
| `ensureDir(path)` | Create directory recursively if missing |
| `cleanDir(path)` | Remove all contents, keep directory |
| `fileExists(path)` | Check if file exists (sync) |
| `getFileSize(path)` | Returns size in bytes |
| `listFiles(dir, pattern?)` | List files with optional glob filter |
| `moveFile(src, dest)` | Move/rename file |
| `deleteFile(path)` | Delete with error suppression |
| `readJson(path)` | Read and parse JSON file |
| `writeJson(path, data)` | Write JSON with formatting |
| `isVideoFile(path)` | Check extension against video types |
| `isImageFile(path)` | Check extension against image types |

## Safety

- All delete operations use try/catch (never throw on missing files)
- Paths validated before operations
- Symlinks handled explicitly (not followed by default)

See also: [[Orchestrator]], [[Renderer]], [[Asset Sourcer]]
