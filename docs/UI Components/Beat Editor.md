---
tags: [ui]
---

# Beat Editor

**File**: `src-electron/renderer/src/components/BeatEditor.tsx`

Edit properties of a selected beat (search query, speed, effects, transitions).

## Props

```typescript
{
  beat: Beat
  onUpdate: (beat: Beat) => void
}
```

## Editable Fields

| Field | Beat Types | Control |
|-------|-----------|---------|
| searchQuery | clip, image | Text input |
| clipSpeed | clip | Number input |
| clipEffect | clip | Dropdown |
| imageAnimation | image | Dropdown |
| transitionIn | all | Dropdown |
| text / subtitle | title_card, lower_third | Text input |

See also: [[Beat Timeline]], [[App Component]]
