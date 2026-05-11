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
| Concurrency | number (1-20) | 4 |
| FPS | number (24-60) | 30 |
| Download Resolution | dropdown | 1080p |
| Timeout | number (30-300 sec) | 90 |

## Props

```typescript
{
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  onClose: () => void
}
```

See also: [[Model Selector]], [[Configuration]]
