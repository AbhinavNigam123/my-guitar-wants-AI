# Practice Coach backend

FastAPI service that turns recorded audio into guitar tab using
[basic-pitch](https://github.com/spotify/basic-pitch) (ONNX runtime, no TensorFlow).

## Setup (already done once)

Uses **Python 3.11** (basic-pitch can't build on 3.12+). The venv lives in
`.venv311`. To recreate:

```powershell
py -3.11 -m venv .venv311
.\.venv311\Scripts\python.exe -m pip install -r requirements.txt
```

## Run the server

```powershell
.\.venv311\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

- `GET  /health`     → `{ "status": "ok" }`
- `POST /transcribe` → multipart form: `file` (WAV/audio), `bpm` (float), and
  optional `quality_mode` (`fast` by default or slower two-pass `accurate`). Returns
  `{ bpm, noteCount, tabNotes[], rawEvents[] }`.

The frontend (`src/lib/transcribe.ts`) decodes the mic recording to WAV in the
browser and POSTs it here. Override the API base with
`NEXT_PUBLIC_TRANSCRIBE_API` if not on `http://localhost:8000`.

## Smoke test

```powershell
.\.venv311\Scripts\python.exe smoke_test.py
```

## Notes

- Blind uploads run Basic Pitch plus a shared guitar cleanup that rewrites
  `rawEvents` and `tabNotes` together (impossible spans, octave ghosts,
  technique gates).
- Coach/practice takes may send `expected_notes` (JSON array of
  `{measure,beat,string,fret}` or `{onsetMs,midi}`). The expected-tab prior
  octave-corrects matches, drops phantoms, and never invents missing notes so
  the AI coach can still score misses / wrong notes. See
  `apply_expected_tab_prior` in `app/services/transcribe.py`.
- ONNX is used deliberately (TensorFlow was removed) to keep RAM ~1.5GB lower.
- WebM/Opus is converted to WAV client-side so no ffmpeg is needed server-side.
