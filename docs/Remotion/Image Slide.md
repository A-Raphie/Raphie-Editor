---
tags: [remotion]
---

# Image Slide

**File**: `src/remotion/components/ImageSlide.tsx`

Displays an image with Ken Burns animation (zoom/pan over duration).

## Props

```typescript
{
  src: string               // Image URL
  animation: ImageAnimation // Animation type
  duration: number          // Duration in seconds
}
```

## Animation Types

| Animation | Effect |
|-----------|--------|
| `zoom_in` | Scale 1.0 → 1.3 over duration |
| `zoom_out` | Scale 1.3 → 1.0 |
| `pan_lr` | Pan left to right with slight zoom |
| `pan_rl` | Pan right to left |
| `pan_tb` | Pan top to bottom |
| `pan_bt` | Pan bottom to top |
| `drift` | Slow diagonal drift with zoom |

All images are always animated (never static). Uses Remotion's `interpolate()` for smooth motion.

See also: [[Documentary]], [[Data Model]]
