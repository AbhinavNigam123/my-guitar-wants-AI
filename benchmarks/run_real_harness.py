#!/usr/bin/env python3
"""Real-recording and annotated-synthetic transcription benchmark harness.

Computes onset P/R/F1, MIDI pitch P/R/F1, ghost-note rate, missed-note rate,
octave error rate, and harmonic error rate for every fixture in
real_recording_manifest.json.

Usage (from repo root):
  python benchmarks/run_real_harness.py               # run all required fixtures
  python benchmarks/run_real_harness.py --full        # include optional fixtures
  python benchmarks/run_real_harness.py --save-baseline  # also write baseline file

The --save-baseline flag saves results to
  benchmarks/results/baseline-bp-corrected.json

This file documents the corrected-Basic-Pitch performance after the
frontend double-normalization was removed (Phase 1 of the quality plan).
It is the reference point for comparing future model improvements.

Agents: run `npm run harness:real` before and after changing transcribe.py.
Read benchmarks/results/latest-real.json for a one-line PASS/FAIL summary.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
BENCH = ROOT / "benchmarks"
RESULTS_DIR = BENCH / "results"
MANIFEST_PATH = BENCH / "real_recording_manifest.json"

for _p in (str(ROOT), str(BACKEND)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from benchmarks.eval_note_accuracy import (  # noqa: E402
    NoteAccuracyMetrics,
    aggregate_metrics,
    check_expect,
    compute_metrics,
)
from benchmarks.generate_fixtures import (  # noqa: E402
    ANNOTATED_GENERATORS,
    ensure_annotated_fixture,
)
from app.services.transcribe import transcribe_file  # noqa: E402


def _load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _resolve_preset(fx: dict, defaults: dict) -> dict:
    return fx.get("preset") or defaults.get("preset") or {
        "onset": 0.40,
        "frame": 0.28,
        "minNoteMs": 45.0,
        "minAmpRatio": 0.18,
        "preprocess": True,
    }


def _run_fixture(
    fx: dict,
    defaults: dict,
    quality_mode: str,
    sensitive_compression: bool,
) -> tuple[NoteAccuracyMetrics | None, dict]:
    """Run one fixture and return (metrics | None, result_entry)."""
    fx_id = fx["id"]
    wav_path = BENCH / fx["path"]
    ann_path = BENCH / fx["annotation"]
    category = fx.get("category", "unknown")

    # Generate synthetic fixture if a generator is specified
    if gen := fx.get("generate_annotated"):
        try:
            ensure_annotated_fixture(wav_path, ann_path, gen)
        except Exception as exc:
            return None, {"id": fx_id, "ok": False, "error": f"generation failed: {exc}"}

    if not wav_path.exists():
        return None, {"id": fx_id, "ok": False, "error": "wav file missing", "optional": fx.get("optional", False)}

    if not ann_path.exists():
        return None, {"id": fx_id, "ok": False, "error": "annotation file missing", "optional": fx.get("optional", False)}

    annotation = json.loads(ann_path.read_text(encoding="utf-8"))
    ground_truth = annotation.get("groundTruth", [])
    if not ground_truth:
        return None, {"id": fx_id, "ok": False, "error": "empty groundTruth in annotation"}

    bpm = float(fx.get("bpm") or defaults.get("bpm", 120))
    beats = int(fx.get("beatsPerMeasure") or defaults.get("beatsPerMeasure", 4))
    preset = _resolve_preset(fx, defaults)

    t0 = time.perf_counter()
    try:
        result = transcribe_file(
            str(wav_path),
            bpm=bpm,
            beats_per_measure=beats,
            onset_threshold=float(preset.get("onset", 0.40)),
            frame_threshold=float(preset.get("frame", 0.28)),
            min_note_len_ms=float(preset.get("minNoteMs", 45.0)),
            min_amplitude_ratio=float(preset.get("minAmpRatio", 0.18)),
            preprocess_audio=bool(preset.get("preprocess", True)),
            quality_mode=quality_mode,
            sensitive_compression=sensitive_compression,
        )
    except Exception as exc:
        return None, {"id": fx_id, "ok": False, "error": f"transcription failed: {exc}"}

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    raw_events = result.get("rawEvents", [])
    tab_notes = result.get("tabNotes", [])
    open_midi = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}
    midi_layout_violations = sum(
        1
        for note in tab_notes
        if open_midi.get(int(note.get("string", 0)), -1000) + int(note.get("fret", 0))
        != int(note.get("midi", -999))
    )
    chord_strings: dict[tuple[int, float], list[int]] = {}
    for note in tab_notes:
        key = (int(note.get("measure", 1)), float(note.get("beat", 1)))
        chord_strings.setdefault(key, []).append(int(note.get("string", 0)))
    duplicate_string_slots = sum(
        1 for strings in chord_strings.values() if len(strings) != len(set(strings))
    )

    metrics = compute_metrics(
        fixture_id=fx_id,
        ground_truth=ground_truth,
        raw_events=raw_events,
        category=category,
    )

    # Check per-fixture thresholds
    expect_failures = check_expect(metrics, fx.get("expect") or {})

    entry: dict = {
        "id": fx_id,
        "ok": len(expect_failures) == 0,
        "category": category,
        "transcriptionMs": elapsed_ms,
        "groundTruthCount": metrics.total_gt,
        "detectedCount": metrics.total_detected,
        "settings": result.get("settings", {}),
        "layout": {
            "midiViolations": midi_layout_violations,
            "duplicateStringSlots": duplicate_string_slots,
            "maxFret": max((int(note.get("fret", 0)) for note in tab_notes), default=0),
        },
        "metrics": asdict(metrics),
    }
    if quality_mode == "accurate":
        if midi_layout_violations:
            expect_failures.append(f"layout MIDI violations: {midi_layout_violations}")
        if duplicate_string_slots:
            expect_failures.append(f"duplicate-string slots: {duplicate_string_slots}")
        if entry["layout"]["maxFret"] > 11:
            expect_failures.append(f"max fret {entry['layout']['maxFret']} > 11")
        entry["ok"] = len(expect_failures) == 0
        if expect_failures:
            entry["expectFailures"] = expect_failures
    if expect_failures:
        entry["expectFailures"] = expect_failures

    return metrics, entry


def main() -> int:
    parser = argparse.ArgumentParser(description="Real-recording transcription harness")
    parser.add_argument("--full", action="store_true", help="Include optional fixtures")
    parser.add_argument(
        "--quality-mode",
        choices=("fast", "accurate"),
        default="fast",
        help="Transcription quality path to evaluate",
    )
    parser.add_argument(
        "--sensitive-compression",
        action="store_true",
        help="Evaluate light compression on the accurate sensitive pass",
    )
    parser.add_argument(
        "--save-baseline",
        action="store_true",
        help="Also save as baseline-bp-corrected.json (the corrected-Basic-Pitch reference)",
    )
    args = parser.parse_args()

    manifest = _load_manifest()
    defaults = manifest.get("defaults", {})
    all_metrics: list[NoteAccuracyMetrics] = []
    hard_failures: list[str] = []
    results: list[dict] = []
    skipped = 0

    t_start = time.perf_counter()

    for fx in manifest.get("fixtures", []):
        optional = bool(fx.get("optional", False))

        # Skip optional fixtures unless --full
        if optional and not args.full:
            skipped += 1
            continue

        metrics, entry = _run_fixture(
            fx,
            defaults,
            quality_mode=args.quality_mode,
            sensitive_compression=args.sensitive_compression,
        )

        if not entry["ok"]:
            if not optional:
                hard_failures.append(fx["id"])
            entry.setdefault("optional", optional)

        if metrics is not None:
            all_metrics.append(metrics)

        results.append(entry)

    elapsed_ms = int((time.perf_counter() - t_start) * 1000)
    aggregate = aggregate_metrics(all_metrics)

    passed = sum(1 for r in results if r["ok"])
    total = len(results)

    report = {
        "ok": len(hard_failures) == 0,
        "runAt": datetime.now(timezone.utc).isoformat(),
        "mode": "full" if args.full else "required",
        "elapsedMs": elapsed_ms,
        "model": "basic_pitch",
        "qualityMode": args.quality_mode,
        "sensitiveCompression": args.sensitive_compression,
        "preset": "coach_clean",
        "normalizationFix": "frontend_normalization_removed",
        "passed": passed,
        "failed": total - passed,
        "skipped": skipped,
        "aggregate": asdict(aggregate),
        "fixtures": results,
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = "-compressed" if args.sensitive_compression else ""
    latest = RESULTS_DIR / f"latest-real-{args.quality_mode}{suffix}.json"
    latest.write_text(json.dumps(report, indent=2), encoding="utf-8")
    (RESULTS_DIR / "latest-real.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    if args.save_baseline:
        baseline = RESULTS_DIR / "baseline-bp-corrected.json"
        baseline.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Baseline saved: {baseline.relative_to(ROOT)}")

    # Print compact summary
    agg = aggregate
    summary_parts = [
        f"onset F1={agg.onset_f1:.3f}",
        f"MIDI F1={agg.midi_f1:.3f}",
        f"ghost={agg.ghost_note_rate:.3f}",
        f"missed={agg.missed_note_rate:.3f}",
        f"octave_err={agg.octave_error_rate:.3f}",
        f"harmonic_err={agg.harmonic_error_rate:.3f}",
    ]
    summary_line = "  ".join(summary_parts)

    if hard_failures:
        print(f"HARNESS FAIL — real ({len(hard_failures)} required fixtures failed)")
        for fid in hard_failures:
            entry = next((r for r in results if r["id"] == fid), {})
            msg = entry.get("error") or str(entry.get("expectFailures", ""))
            print(f"  FAIL {fid}: {msg}")
        print(f"  {summary_line}")
        print(f"  Report: {latest.relative_to(ROOT)}")
        return 1

    print(
        f"HARNESS PASS — real {passed}/{total} fixtures"
        + (f" ({skipped} optional skipped)" if skipped else "")
    )
    print(f"  {summary_line}")
    print(f"  Report: {latest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
