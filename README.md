# AI Guitar Practice Coach

Record yourself playing a tab, get note-by-note feedback, and practice with a responsive tab player.

This is an independent open-source project: a Next.js practice studio plus a FastAPI transcription service. The UI is inspired by popular online tab players; it is **not affiliated with** Songsterr, Guitar Pro, or any other commercial product.

## Features

- **Tab practice studio** — SVG tab viewer with playback, speed control, measure looping, and dark/light themes
- **AI Coach** — aligns your take to the expected tab, scores pitch/timing, and surfaces concrete findings (early, late, missed, wrong note)
- **Audio transcription** — mic or file upload → guitar tab notes via [Basic Pitch](https://github.com/spotify/basic-pitch) (ONNX)
- **Technique hints** — bends, hammers, slides, and related cues from the transcription pipeline
- **Harnesses** — regression suites for coach alignment and transcription quality (`npm run harness:*`)

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Playback / theory | Web Audio synth scheduling, tonal helpers |
| Backend | FastAPI, Basic Pitch (ONNX), librosa, NumPy |
| State | Zustand |

## Quick start

### Frontend

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and go to the practice page.

### Transcription backend

Requires **Python 3.11** (Basic Pitch does not install cleanly on newer Pythons).

```powershell
cd backend
py -3.11 -m venv .venv311
.\.venv311\Scripts\python.exe -m pip install -r requirements.txt
.\.venv311\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Optional: set `NEXT_PUBLIC_TRANSCRIBE_API` if the API is not at `http://localhost:8000`.

See [backend/README.md](backend/README.md) for endpoint details.

## Project layout

```
src/                  Next.js app (practice studio, coach UI, tab viewer)
backend/app/          FastAPI transcription service
benchmarks/           Coach + transcription harnesses and fixtures
docs/                 Technical notes (model feasibility, etc.)
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Frontend dev server |
| `npm run build` | Type-check + production build |
| `npm run harness:coach` | Coach alignment unit harness |
| `npm run harness:fast` | Fast transcription unit tests |
| `npm run harness` | Fuller transcription harness |

## License / affiliation

Personal / educational project. Not affiliated with, endorsed by, or connected to Songsterr, Arobas Music, Spotify, or any employer. Songsterr is a trademark of its respective owners; any visual similarity is for learning and experimentation only.
