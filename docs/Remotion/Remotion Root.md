---
tags: [remotion]
---

# Remotion Root

**File**: `src/remotion/Root.tsx`

Registers the Documentary composition with Remotion. Sets up default props and dynamic metadata.

## Composition Config

| Prop | Value |
|------|-------|
| `id` | `"Documentary"` |
| `fps` | 30 |
| `width` | 1920 |
| `height` | 1080 |
| `defaultProps` | Empty scene plan, no assets |

## Dynamic Metadata

`calculateMetadata` overrides `durationInFrames` based on the scene plan's `totalDurationSeconds`:
```
durationInFrames = Math.round(totalDurationSeconds * 30)
```

The `Math.round` ensures integer frame count (fixes fractional VO durations like 31.067s).

## Components

- [[Documentary]] — Main composition component

See also: [[Renderer]], [[Data Model]]
