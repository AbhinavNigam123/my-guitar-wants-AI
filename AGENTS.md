<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:transcription-harness -->
# Transcription harness (run before backend changes)

When editing `backend/app/services/transcribe.py`, heuristics, or `/transcribe`:

1. Run `npm run harness:fast` (~3s, no ONNX) or `npm run harness` (unit + synthetic clips).
2. Read the one-line summary or `benchmarks/results/latest.json` — do **not** re-read the whole pipeline or spawn browser/LLM eval loops.
3. After changing heuristics, run full harness before claiming a fix.

Add real mic clips under `benchmarks/fixtures/user/`, register in `benchmarks/manifest.json`, set `"optional": false` when ready.
<!-- END:transcription-harness -->

<!-- BEGIN:agent-harness -->
# Agent Harness

## Task routing

Identify your task domain before reading files. Three domains with hard boundaries:

| Domain | Scope | Runs on |
|--------|-------|---------|
| **AI Coach** | Alignment DP, scoring, findings, coaching text, Studio UI | Frontend only |
| **Backend Transcription** | Basic Pitch pipeline, quantization, technique detection, chord grouping | Python/FastAPI only |
| **Tab Playback / Rendering** | Synth playback, SVG tab renderer, measure looping, playback speed, music theory / chord shapes | Frontend only |

> Coach analysis runs **entirely** on the frontend in `src/lib/coach-analysis.ts`. Do **not** add backend endpoints for coach logic.
> The active coach UI is `src/components/practice/StudioDashboard.tsx`. Do **not** wire legacy panels (see stale files below).

---

## Minimal file maps

Read **only** the files listed for your domain. Ignore the rest unless explicitly needed.

### AI Coach tasks

| File | Lines | What you need from it |
|------|-------|-----------------------|
| `src/lib/coach-analysis.ts` | 750 | `PracticeAnalysisResult`, `analyzePracticeTake()`, `buildFallbackCoachTranscription()` — the full alignment + scoring pipeline |
| `src/types/music.ts` | 110 | All domain types: `TabNote`, `AlignmentResult`, `CoachFinding`, `PracticeAction`, `PracticeFeedback`, `PracticeMetrics`, `NoteStatus` |
| `src/components/practice/StudioDashboard.tsx` | 880 | Active coach UI: Record / AI Coach / Metrics tabs, score ring, findings display |
| `src/app/practice/page.tsx` | 886 | Read **only** the `handleRecordingComplete` handler and its coach wiring; skip editor/transcribe sections |
| `benchmarks/run_coach_harness.mjs` | — | Canonical test cases: expected `NoteStatus` for synthetic takes |
| `AI_COACH_CODEX_CONTEXT.md` | — | Product direction and framing — **read once** at the start of an AI Coach task; skip during narrow implementation |

### Backend Transcription tasks

_(Existing transcription-harness block above governs workflow. File map below is for reference.)_

| File | Lines | What you need from it |
|------|-------|-----------------------|
| `backend/app/services/transcribe.py` | 1104 | `transcribe_file()` main entry; pipeline stages as named functions |
| `backend/app/services/bpm_detect.py` | — | `detect_bpm()` — librosa-based tempo detection |
| `backend/test_quant.py` | 399 | 33 unit tests for heuristics; invoked by harness |
| `benchmarks/manifest.json` | — | Fixture registry: `expect` bounds per clip |

### Tab Playback / Rendering tasks

| File | Lines | What you need from it |
|------|-------|-----------------------|
| `src/components/practice/TabViewer.tsx` | 804 | SVG tab renderer; `TabViewerProps` (notes, bpm, playbackBeat, onSeek, editorMode, …); coach status color bands |
| `src/hooks/usePlayback.ts` | 320 | `usePlayback(notes, bpm, beatsPerMeasure)` → `UsePlaybackResult` (isPlaying, playbackBeat, seekTo, togglePlay, changeSource, setRecordingBlob) |
| `src/components/practice/PlayerControls.tsx` | 395 | `PlayerControlsProps` (bpm, isPlaying, source, canPlayOriginal, editorMode, onPlayPause, onSourceChange, onEditorToggle) |
| `src/types/music.ts` | 110 | `TabNote`, `Technique`, `NoteStatus` |
| `src/lib/stairway-tab-data.ts` | ~60 | `STAIRWAY_TAB_NOTES: TabNote[]`, `STAIRWAY_SONG_METRICS`, `buildStairwaySession()` — sample practice tab |

---

## Validation commands by task type

| Domain | Fast check | Full check |
|--------|-----------|-----------|
| AI Coach | `npm run harness:coach` (~4s, DP alignment unit tests) | `npm run harness:coach-audio` |
| Backend Transcription | `npm run harness:fast` (~20s, unit tests only) | `npm run harness` → `npm run harness:full` |
| Tab Playback / Rendering | `npm run build` (TypeScript type gate) | `npm run build` then `npm run lint` |
| Any frontend change | `npm run build` | `npm run build` then `npm run lint` |

There are **no** frontend unit tests (`src/` has no test files). `npm run build` is the primary type-safety gate for all frontend changes.

---

## Stale and oversized files — skip unless explicitly needed

| File | Why to skip |
|------|------------|
| `src/components/practice/PracticeCoachPanel.tsx` | Legacy; not imported anywhere. Superseded by `StudioDashboard`. |
| `src/components/practice/FeedbackPanel.tsx` | Legacy; not imported anywhere. |
| `src/components/practice/MetricsPanel.tsx` | Legacy; not imported anywhere. |
| `src/lib/mock-practice-data.ts` | Smoke on the Water mocks; practice page uses `stairway-tab-data.ts`. |
| `src/app/metrics/page.tsx` | Standalone mock dashboard; not connected to live sessions. |
| `backend/.venv311/` | Python virtualenv — never read. |

Agents entering mid-session: use the domain file maps above. Do not re-read transcription backend files unless the task explicitly touches `/transcribe` or `transcribe.py`.
<!-- END:agent-harness -->
