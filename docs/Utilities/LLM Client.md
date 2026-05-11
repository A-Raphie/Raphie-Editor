---
tags: [utilities]
---

# LLM Client

**File**: `src/utils/llm.ts`

Unified client for OpenRouter API calls. Handles JSON parsing, retries, and image inputs.

## Functions

### `chatCompletion(messages, options?)`

Text-only chat completion. Returns parsed JSON object.
- Sends `max_tokens: 4096` by default to prevent truncation
- Defensive `choices` check with raw response logging

### `chatWithImages(messages, images, options?)`

Chat with image attachments (for quality checker).
- Sends `response_format: { type: "json_object" }`
- Defensive `choices` check with raw response logging

### `sanitizeJsonResponse(text)`

Extracts JSON from LLM response text:
1. Try direct `JSON.parse()`
2. Regex extract `{...}` block
3. Strip markdown code fences
4. Throw if no valid JSON found

## Retry Logic

- Configurable `maxRetries` (default 5)
- Exponential backoff
- Retries on rate limits (429), server errors (5xx), parse failures

See also: [[Scene Planner]], [[Quality Checker]], [[Configuration]]
