# M - Decisions

## Design Decisions

### Architecture
- **Electron + React + Remotion**: Three-process architecture (main, renderer, Remotion)
- **All state in App.tsx**: No Redux/Zustand — useState hooks only (37 hooks)
- **IPC for all main process calls**: 37 IPC channels, all exposed through preload
- **Pipeline state persisted to JSON**: Enables resume after crash/failure

### Pipeline
- **Execution order**: `enforceBodyDurations` → `enforceBeatDistribution` — distribution enforced last so merging doesn't destroy it
- **Beat distribution targets overall ratio**: All beats including hook, not just body
- **Merge type resolution**: Majority wins instead of mixed=always clip
- **Search query rules**: Explicit segment-level visual mapping with good/bad examples
- **Quality checker**: LLM vision model scores each asset 1-10, accepts if >= threshold AND relevant

### UI/UX
- **Resolution resets to 1080 per session**: `useState(1080)` — not persisted
- **Parallel segments**: Persisted in settings, default 1, range 1-3
- **Confirm modal for destructive actions**: Render, clean, regenerate, delete
- **Candidate picker**: Search → preview grid → select → download flow
- **Subscribe hint**: Auto-detects "subscribe" in script text, suggests overlay placement

### Data Model
- **SRT or script, not both**: `scriptPath` is optional when `srtPath` is provided
- **Voiceover is required**: Every project must have `voPath`
- **Scene plan is JSON**: Stored as both project field and separate file
- **Assets mapped by beat ID**: `AssetMapping = Record<beatId, filePath>`

---

## User Preferences

- User has exactly 16.00GB RAM — memory warning at `<= 16`
- User uses SRT files for some projects (not always scripts)
- User typically renders at 1080p
- User wants fast-paced hook editing (2-3s clips in hook)
- User wants configurable clip/image ratio (exposed in Settings as `clipPercent`/`imagePercent`)

---

## Environment

### Machine
- macOS, ARM64 (Apple Silicon)
- 16.00 GB RAM
- ffmpeg/ffprobe available in PATH

### Project
- Located at `/Users/raphie/Desktop/ai-video-editor/`
- No git repository
- Working copy (fallback) at `/Applications/Raphie's Editor copy.app`
- Deployed build at `/Applications/Raphie's Editor.app`

### Build & Deploy
```bash
npm run dev            # Electron dev mode
npm run build:dmg      # Build macOS DMG (produces dist/mac-arm64/)
# Deploy:
killall "Raphie's Editor" 2>/dev/null
rm -rf "/Applications/Raphie's Editor.app"
cp -R dist/mac-arm64/Raphie\'s\ Editor.app /Applications/
```

### Models
- Scene planner: `deepseek/deepseek-v4-flash`
- Quality checker: `google/gemini-2.5-flash-lite`
- Both "default" and "budget" tiers use the same models currently

### APIs
- OpenRouter (LLM)
- Pexels (stock video/images)
- Pixabay (stock video/images)

---

## Critical Notes

1. **No git history** — all source reconstructed from compiled JS in session 10-12
2. **Working copy is source of truth** — `/Applications/Raphie's Editor copy.app` compiled output was used for recovery
3. **Preload must match IPC handlers exactly** — missing channels cause blank screen
4. **`searchQueryRules` in settings overrides default** — changing `DEFAULT_SEARCH_QUERY_RULES` won't affect users who saved settings
5. **Resolution is NOT persisted** — intentionally resets to 1080 per session
