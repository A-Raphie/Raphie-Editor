---
tags: [remotion]
---

# Transition

**File**: `src/remotion/components/Transition.tsx`

Wraps a beat component with an entrance transition. Part of Remotion's `<Sequence>` layering.

## Supported Transitions

| Type | Duration | Effect |
|------|----------|--------|
| `fade` | 0.5s | Opacity 0 → 1 |
| `slide_left` | 0.5s | Slides in from right |
| `slide_right` | 0.5s | Slides in from left |
| `slide_up` | 0.5s | Slides in from bottom |
| `slide_down` | 0.5s | Slides in from top |
| `zoom_in` | 0.5s | Scale 0 → 1 |
| `zoom_out` | 0.5s | Scale 2 → 1 |
| `wipe` | 0.5s | Horizontal wipe reveal |
| `dissolve` | 0.7s | Longer cross-dissolve |
| `none` | 0s | Instant cut |

## Timing

Transitions overlap the previous beat. `transitionOffset` is subtracted from `from` and added to `durationInFrames` to create the overlap window.

## Constraint

Never uses the same transition twice in a row. Enforced by [[Scene Planner]].

See also: [[Documentary]], [[Scene Planner]]
