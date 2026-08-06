"""Thin adapter wrapping hf_midi_transcription (GAPS guitar model).

Returns a dict structurally compatible with transcribe_file() so that
run_gaps_experiment.py can feed both models into the same eval_note_accuracy
metrics without touching production code.

IMPORTANT LIMITATIONS
---------------------
* hf_midi_transcription is optimised for MONOPHONIC guitar playing.
  Chord recall will be poor by design — the model was not trained for
  simultaneous multi-note detection.
* Weights (~95 MB) are downloaded automatically from Hugging Face Hub on
  first use (cached at %USERPROFILE%\\.cache\\huggingface\\hub\\).
* License: MIT (https://github.com/xavriley/hf_midi_transcription).
* This module MUST NOT be imported from app/services/transcribe.py or any
  production path.  It exists solely for benchmarking.

Usage
-----
    from benchmarks.gaps_adapter import transcribe_with_gaps, is_available
    result = transcribe_with_gaps("path/to/audio.wav", bpm=120)
    raw_events = result["rawEvents"]
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path
from typing import Any

# ── Optional import gate ──────────────────────────────────────────────────────

try:
    from hf_midi_transcription import MidiTranscriptionModel as _MTM  # type: ignore[import]
    import pretty_midi  # type: ignore[import]
    _GAPS_AVAILABLE = True
except ImportError:
    _GAPS_AVAILABLE = False

# Lazily loaded singleton — avoids re-downloading / re-initialising per fixture
_model: Any = None


def is_available() -> bool:
    """Return True if hf_midi_transcription and pretty_midi are importable."""
    return _GAPS_AVAILABLE


def _get_model() -> Any:
    """Return the cached GAPS guitar model, initialising it on first call.

    Downloads the guitar checkpoint (~95 MB) from xavriley/midi-transcription-models
    via huggingface_hub.hf_hub_download (bypasses hf_midi_transcription's internal
    download path which prints non-ASCII checkmarks that crash Windows cp1252 stdout).
    """
    global _model
    if _model is not None:
        return _model
    if not _GAPS_AVAILABLE:
        raise RuntimeError(
            "hf_midi_transcription is not installed (benchmark-only optional dep).\n"
            "  pip install torch --index-url https://download.pytorch.org/whl/cpu\n"
            "  pip install -r benchmarks/requirements-gaps.txt"
        )
    # Pre-download via huggingface_hub directly to avoid hf_midi_transcription's
    # internal print-then-fail path on Windows (the package prints '✓' which
    # cp1252 cannot encode, causing it to mis-report a download failure).
    try:
        from huggingface_hub import hf_hub_download  # type: ignore[import]
        checkpoint_path = hf_hub_download(
            repo_id="xavriley/midi-transcription-models",
            filename="guitar-gaps.pth",
        )
    except Exception as exc:
        raise RuntimeError(
            f"Could not download guitar-gaps.pth from xavriley/midi-transcription-models: {exc}"
        ) from exc

    _model = _MTM(instrument="guitar", device="cpu", checkpoint_path=checkpoint_path)
    return _model


def transcribe_with_gaps(
    wav_path: str | Path,
    bpm: float = 120.0,
    beats_per_measure: int = 4,
) -> dict:
    """Run the GAPS guitar model and return a transcribe_file()-compatible dict.

    Only rawEvents, bpm, beatsPerMeasure, noteCount, durationMs, and settings
    are populated.  tabNotes is empty because GAPS provides no string/fret
    assignment.

    Parameters
    ----------
    wav_path:
        Path to the input WAV file.
    bpm:
        Song BPM (passed through to the result dict; not used for inference).
    beats_per_measure:
        Passed through unchanged.

    Returns
    -------
    dict with at minimum "rawEvents", "bpm", "beatsPerMeasure", "noteCount",
    "durationMs", "tabNotes", "totalMeasures", and "settings".
    """
    model = _get_model()

    fd, midi_out = tempfile.mkstemp(suffix=".gaps.mid")
    os.close(fd)

    t0 = time.perf_counter()
    try:
        model.transcribe(str(wav_path), midi_out)
        inference_ms = int((time.perf_counter() - t0) * 1000)

        pm = pretty_midi.PrettyMIDI(midi_out)

        raw_events: list[dict] = []
        for instrument in pm.instruments:
            for note in instrument.notes:
                raw_events.append(
                    {
                        "onsetMs": int(round(note.start * 1000)),
                        "endMs": int(round(note.end * 1000)),
                        "midi": int(note.pitch),
                        # Use MIDI velocity as amplitude proxy (0–127 → 0–1)
                        "amplitude": round(note.velocity / 127.0, 3),
                    }
                )

        raw_events.sort(key=lambda e: e["onsetMs"])
        duration_ms = max((e["endMs"] for e in raw_events), default=0)

        return {
            "bpm": bpm,
            "beatsPerMeasure": beats_per_measure,
            "noteCount": len(raw_events),
            "tabNotes": [],   # no string/fret from GAPS
            "rawEvents": raw_events,
            "totalMeasures": 0,
            "durationMs": duration_ms,
            "settings": {
                "model": "gaps",
                "instrument": "guitar",
                "device": "cpu",
                "inferenceMs": inference_ms,
            },
        }
    finally:
        try:
            os.unlink(midi_out)
        except OSError:
            pass
