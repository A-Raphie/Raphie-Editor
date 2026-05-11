---
tags: [remotion]
---

# Motion Graphic

**File**: `src/remotion/components/MotionGraphic.tsx`

Programmatically generated animated sequence. No external assets required.

## Props

```typescript
{
  type: string       // Graphic type identifier
  duration: number
  text?: string      // Optional text overlay
}
```

## Supported Types

| Type | Description |
|------|-------------|
| `world_map` | Animated world map with location highlight |
| `timeline` | Animated timeline/graphic |
| `stat_card` | Statistic with counter animation |
| `diagram` | Simple diagram/flowchart |

All generated purely with React/CSS — no external files needed.

See also: [[Documentary]]
