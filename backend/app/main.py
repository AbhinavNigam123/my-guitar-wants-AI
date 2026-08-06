"""FastAPI app exposing audio -> tab transcription.

Run (from the backend/ folder):
    .venv311\\Scripts\\python.exe -m uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import os
import tempfile
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.services.transcribe import transcribe_file, preload_model
from app.services.bpm_detect import detect_bpm as detect_bpm_file

app = FastAPI(title="Songsterr Practice Coach API", version="0.1.0")

@app.on_event("startup")
def _warm_model() -> None:
    preload_model()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _parse_expected_notes(raw: Optional[str]) -> list[dict] | None:
    """Parse optional expected_notes JSON from the multipart form."""
    if raw is None or not str(raw).strip():
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid expected_notes JSON: {exc}") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="expected_notes must be a JSON array")
    notes: list[dict] = []
    for item in parsed:
        if isinstance(item, dict):
            notes.append(item)
    return notes or None


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    bpm: float = Form(120.0),
    detect_bpm: bool = Form(False),
    beats_per_measure: int = Form(4),
    onset_threshold: float = Form(0.38),
    frame_threshold: float = Form(0.28),
    min_note_len_ms: float = Form(0.0),
    min_amplitude_ratio: float = Form(0.18),
    coach_preset: bool = Form(False),
    expected_notes: Optional[str] = Form(None),
    quality_mode: str = Form("fast"),
) -> dict:
    """Accept an audio upload, return inferred tab + raw note events.

    Optional tuning knobs (all have sensible guitar defaults):
      onset_threshold  – lower catches quieter notes (basic-pitch default 0.5)
      frame_threshold  – lower keeps longer sustained notes
      min_note_len_ms  – drop notes shorter than this (ms)
      expected_notes   – JSON array of known-tab notes for coach prior
    """
    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    tmp_path = None
    try:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty upload")

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        bpm_detection = None
        effective_bpm = float(round(bpm))
        if detect_bpm:
            bpm_detection = detect_bpm_file(tmp_path)
            detected = bpm_detection.get("bpm")
            if detected is None:
                reason = bpm_detection.get("reason") or "Auto BPM detection failed."
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": reason,
                        "bpmDetection": bpm_detection,
                    },
                )
            effective_bpm = float(round(float(detected)))

        if quality_mode not in ("fast", "accurate"):
            raise HTTPException(status_code=400, detail="quality_mode must be 'fast' or 'accurate'")

        if coach_preset:
            quality_mode = "fast"
            onset_threshold = 0.40
            frame_threshold = 0.28
            min_amplitude_ratio = 0.18
            min_note_len_ms = 45.0

        parsed_expected = _parse_expected_notes(expected_notes)

        result = transcribe_file(
            tmp_path,
            bpm=effective_bpm,
            beats_per_measure=beats_per_measure,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            min_note_len_ms=min_note_len_ms,
            min_amplitude_ratio=min_amplitude_ratio,
            preprocess_audio=coach_preset or quality_mode == "accurate",
            expected_notes=parsed_expected,
            quality_mode=quality_mode,
        )
        if coach_preset:
            result.setdefault("settings", {})["coachPreset"] = True
            result.setdefault("settings", {})["coachPresetName"] = "coach_clean"
        if bpm_detection:
            result["detectedBpm"] = round(float(bpm_detection["bpm"]))
            result["bpmConfidence"] = bpm_detection["confidence"]
            result["bpmCandidates"] = bpm_detection.get("candidates", [])
            result["bpmDetection"] = bpm_detection
        return result
    except HTTPException:
        raise
    except Exception as exc:  # surface transcription errors as 500 with message
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
