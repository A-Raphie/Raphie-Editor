---
tags: [remotion]
---

# Title Card

**File**: `src/remotion/components/TitleCard.tsx`

Full-screen text card with animated background. Used for scene breaks, chapter titles, and fallback when assets are missing.

## Props

```typescript
{
  text: string       // Main title text
  subtitle?: string  // Optional subtitle
  duration: number   // Duration in seconds
}
```

## Visual

- Dark gradient background (gray-900 → gray-800)
- Large centered title text (white)
- Fade-in animation over first 0.5s
- Optional subtitle in smaller text below

See also: [[Documentary]]
