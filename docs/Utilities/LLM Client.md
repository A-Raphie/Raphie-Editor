---
tags: [utilities]
---

# LLM Client

**File**: `src/utils/llm.ts`

Unified client for OpenRouter API calls. Handles JSON parsing, retries, and image inputs.

## Functions

### `chat(messages, options?)`

Text-only chat completion. Returns parsed JSON object.

### `chatWithImages(messages, images, options?)`

Chat with image attachments (for quality checker). No `response_format` — Gemini doesn't support it with images.

### `sanitizeJsonResponse(text)`

Extracts JSON from LLM response text:
1. Try direct `JSON.parse()`
2. Regex extract `{...}` block
3. Strip markdown code fences
4. Throw if no valid JSON found

## Retry Logic

- Configurable `maxRetries` (default 3)
- Exponential backoff: 1s, 2s, 4s
- Retries on rate limits (429), server errors (5xx), parse failures
- Accept on 400 provider errors (quality check)

## Options

```typescript
{
  model: string
  temperature?: number
  maxTokens?: number
  maxRetries?: number
  responseFormat?: { type: "json_object" }
}
```

See also: [[Scene Planner]], [[Quality Checker]], [[Configuration]]
