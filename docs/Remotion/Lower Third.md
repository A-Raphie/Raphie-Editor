---
tags: [remotion]
---

# Lower Third

**File**: `src/remotion/components/LowerThird.tsx`

Animated text overlay in the lower portion of the frame. Used for labels, names, and context.

## Props

```typescript
{
  text: string       // Main label text
  subtitle?: string  // Secondary text
  duration: number
}
```

## Visual

- Semi-transparent dark bar in lower third
- White text with slide-in animation from left
- Fades out in last 0.5s of duration

See also: [[Documentary]]
