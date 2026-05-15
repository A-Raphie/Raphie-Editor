---
tags: [ui]
---

# Settings

**File**: `src-electron/renderer/src/components/Settings.tsx`

Modal dialog for app settings. All fields persisted to disk on save.

## Settings Fields

| Field | Type | Default |
|-------|------|---------|
| OpenRouter API Key | password | "" |
| Scene Planner Model | dropdown | Claude Sonnet |
| Quality Checker Model | dropdown | Gemini 2.5 Flash Lite |
| Concurrency (downloads) | number (1-30) | 4 |
| Frame (render) | number (1-12) | 3 |
| FPS | number (24-60) | 30 |
| Download Resolution | dropdown | 1080p |
| Renderer | dropdown | "remotion" or "ffmpeg" |
| Quality Check on Preview | checkbox | true |

## Removed Fields

- **Timeout** — removed from UI, default set to 0 (no timeout)
- **Parallel Segments** — Remotion-only, hidden when FFmpeg renderer selected

## Props

```typescript
{
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  onClose: () => void
}
```

See also: [[Model Selector]], [[Configuration]]
