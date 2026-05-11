---
tags: [remotion]
---

# Documentary

**File**: `src/remotion/compositions/Documentary.tsx`

Main Remotion composition. Renders all beats as sequenced layers with transitions, plus VO and music audio.

## Props

```typescript
{
  scenePlan: ScenePlan
  assets: AssetMapping    // beatId → URL path
  voPath?: string         // VO audio URL
  musicPath?: string      // Background music URL
}
```

## Render Structure

```
<AbsoluteFill>
  <Sequence> per beat:
    <Transition type={beat.transitionIn}>
      <BeatContent beat={beat} assets={assets} />
    </Transition>
  </Sequence>
  
  <Audio src={voPath} volume={1} />
  <Audio src={musicPath} volume={0.15} />
</AbsoluteFill>
```

## BeatContent Routing

| beat.type | Component | Condition |
|-----------|-----------|-----------|
| `clip` | [[Video Clip]] | if asset exists, else [[Title Card]] |
| `image` | [[Image Slide]] | if asset exists, else [[Title Card]] |
| `title_card` | [[Title Card]] | always |
| `lower_third` | [[Lower Third]] | always |
| `motion_graphic` | [[Motion Graphic]] | always |

## Timing

- `from = Math.floor(beat.startTime * fps) - transitionOffset`
- `durationInFrames = Math.floor(beat.duration * fps) + transitionOffset`

See also: [[Remotion Root]], [[Data Model]]
