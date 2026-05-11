---
tags: [ui]
---

# Model Selector

**File**: `src-electron/renderer/src/components/ModelSelector.tsx`

Header bar dropdowns for selecting scene planner and quality checker models.

## Planner Models

| Model | ID | Cost |
|-------|----|------|
| Claude Sonnet | `anthropic/claude-sonnet-4` | ~$0.19/vid |
| Claude Haiku | `anthropic/claude-haiku-4` | ~$0.05/vid |
| DeepSeek V3 | `deepseek/deepseek-chat-v3-0324` | ~$0.02/vid |

## Checker Models

| Model | ID | Cost |
|-------|----|------|
| Gemini 2.5 Flash Lite (default) | `google/gemini-2.5-flash-lite` | ~$0.06/vid |
| GPT-4o Mini | `openai/gpt-4o-mini` | ~$0.10/vid |
| Gemini 2.5 Flash | `google/gemini-2.5-flash` | ~$0.21/vid |

## Props

```typescript
{
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}
```

See also: [[Settings]], [[Configuration]]
