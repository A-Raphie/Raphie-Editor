---
tags: [remotion]
---

# Video Clip

**File**: `src/remotion/components/VideoClip.tsx`

Plays a video clip with configurable speed, effects, and freeze frames.

## Props

```typescript
{
  src: string           // Video URL (/public/_render_output/...)
  speed: number         // 0.5-0.75 (always slowed)
  effect: ClipEffect    // "none" | "time_ramp" | "reverse_forward" | "freeze_zoom"
  freezeFrameAt?: number
  duration: number
}
```

## Effects

| Effect | Description |
|--------|-------------|
| `none` | Normal playback at reduced speed |
| `time_ramp` | Speed ramps from slow → fast → slow |
| `reverse_forward` | Plays forward then reverses |
| `freeze_zoom` | Freezes at `freezeFrameAt` with zoom |

## Speed Control

Uses Remotion's `useVideoConfig()` and `interpolate()` to control playback rate. Clips always played at reduced speed (0.5-0.75x).

See also: [[Documentary]], [[Data Model]]
