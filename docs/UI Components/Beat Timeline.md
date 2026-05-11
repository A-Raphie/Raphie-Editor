---
tags: [ui]
---

# Beat Timeline

**File**: `src-electron/renderer/src/components/BeatTimeline.tsx`

Visual timeline of scene plan beats. Horizontal strip showing beat types, durations, and transitions.

## Props

```typescript
{
  beats: Beat[]
  selectedBeatId: string | null
  onSelectBeat: (id: string) => void
}
```

## Visual Encoding

- Color-coded by beat type (clip=blue, image=green, title_card=gray, etc.)
- Width proportional to duration
- Transition indicators between beats
- Selected beat highlight

See also: [[App Component]], [[Beat Editor]], [[Data Model]]
