#!/usr/bin/env python3
"""Transcribe one fixture and emit JSON for JS coach harnesses."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.services.transcribe import transcribe_file  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe a harness fixture")
    parser.add_argument("--path", required=True)
    parser.add_argument("--bpm", type=float, required=True)
    parser.add_argument("--beats", type=int, default=4)
    parser.add_argument("--onset", type=float, default=0.30)
    parser.add_argument("--frame", type=float, default=0.22)
    parser.add_argument("--min-note-ms", type=float, default=35.0)
    parser.add_argument("--min-amp-ratio", type=float, default=0.12)
    parser.add_argument("--preprocess", action="store_true")
    parser.add_argument("--expected-notes-json")
    args = parser.parse_args()
    expected_notes = None
    if args.expected_notes_json:
        expected_notes = json.loads(Path(args.expected_notes_json).read_text(encoding="utf-8"))

    result = transcribe_file(
        args.path,
        bpm=args.bpm,
        beats_per_measure=args.beats,
        onset_threshold=args.onset,
        frame_threshold=args.frame,
        min_note_len_ms=args.min_note_ms,
        min_amplitude_ratio=args.min_amp_ratio,
        preprocess_audio=args.preprocess,
        expected_notes=expected_notes,
    )
    result.setdefault("settings", {})["coachPreset"] = True
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
