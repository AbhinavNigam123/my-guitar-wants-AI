#!/usr/bin/env python3
"""Side-by-side Basic Pitch vs GAPS experiment on the synthetic fixture suite.

Runs both models on every required (and optionally all) fixture in
real_recording_manifest.json, then compares onset F1, MIDI F1, ghost rate,
missed rate, chord recall (open_chords + barre_chords categories), and
per-model inference time.

Results are written to:
  benchmarks/results/gaps-experiment.json    — full per-fixture data
  benchmarks/results/gaps-experiment.txt     — human-readable summary

Usage (from repo root):
  python benchmarks/run_gaps_experiment.py             # required fixtures only
  python benchmarks/run_gaps_experiment.py --full      # include optional real fixtures

GAPS limitation:  the underlying model is optimised for MONOPHONIC guitar.
Chord recall will be low by design.  This experiment measures the gap so
the model-feasibility decision can be made on measured data.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

# Force UTF-8 stdout/stderr on Windows so hf_midi_transcription's checkmark
# characters don't trigger a UnicodeEncodeError through cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]

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
    compute_metrics,
)
from benchmarks.gaps_adapter import is_available as gaps_available  # noqa: E402
from benchmarks.gaps_adapter import transcribe_with_gaps  # noqa: E402
from benchmarks.generate_fixtures import ensure_annotated_fixture  # noqa: E402
from app.services.transcribe import transcribe_file  # noqa: E402


# ── Helpers ───────────────────────────────────────────────────────────────────


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


def _run_basic_pitch(fx: dict, defaults: dict) -> tuple[list[dict], int, dict]:
    """Return (raw_events, inference_ms, settings)."""
    wav_path = BENCH / fx["path"]
    bpm = float(fx.get("bpm") or defaults.get("bpm", 120))
    beats = int(fx.get("beatsPerMeasure") or defaults.get("beatsPerMeasure", 4))
    preset = _resolve_preset(fx, defaults)

    t0 = time.perf_counter()
    result = transcribe_file(
        str(wav_path),
        bpm=bpm,
        beats_per_measure=beats,
        onset_threshold=float(preset.get("onset", 0.40)),
        frame_threshold=float(preset.get("frame", 0.28)),
        min_note_len_ms=float(preset.get("minNoteMs", 45.0)),
        min_amplitude_ratio=float(preset.get("minAmpRatio", 0.18)),
        preprocess_audio=bool(preset.get("preprocess", True)),
    )
    inference_ms = int((time.perf_counter() - t0) * 1000)
    return result.get("rawEvents", []), inference_ms, result.get("settings", {})


def _run_gaps(fx: dict, defaults: dict) -> tuple[list[dict], int, dict]:
    """Return (raw_events, inference_ms, settings)."""
    wav_path = BENCH / fx["path"]
    bpm = float(fx.get("bpm") or defaults.get("bpm", 120))
    beats = int(fx.get("beatsPerMeasure") or defaults.get("beatsPerMeasure", 4))

    t0 = time.perf_counter()
    result = transcribe_with_gaps(str(wav_path), bpm=bpm, beats_per_measure=beats)
    inference_ms = int((time.perf_counter() - t0) * 1000)
    return result.get("rawEvents", []), inference_ms, result.get("settings", {})


def _chord_recall(
    metrics_list: list[NoteAccuracyMetrics],
) -> float | None:
    """Onset recall across open_chords and barre_chords categories."""
    chord_cats = {"open_chords", "barre_chords"}
    chord_m = [m for m in metrics_list if m.category in chord_cats]
    if not chord_m:
        return None
    tp = sum(m.true_positives for m in chord_m)
    gt = sum(m.total_gt for m in chord_m)
    return tp / gt if gt else 0.0


# ── Summary printer ───────────────────────────────────────────────────────────


def _fmt(v: float | None, pct: bool = True) -> str:
    if v is None:
        return "  n/a "
    if pct:
        return f"{v * 100:6.1f}%"
    return f"{v:6.1f}"


def _print_comparison(
    bp_all: list[NoteAccuracyMetrics],
    gaps_all: list[NoteAccuracyMetrics],
    bp_ms: list[int],
    gaps_ms: list[int],
    *,
    label: str = "ALL",
    file=None,
) -> None:
    def _out(s: str) -> None:
        # Use ascii-safe output for Windows console compatibility
        safe = s.encode("ascii", "replace").decode("ascii")
        print(safe, file=file)

    bp_agg = aggregate_metrics(bp_all)
    gaps_agg = aggregate_metrics(gaps_all)
    bp_chord = _chord_recall(bp_all)
    gaps_chord = _chord_recall(gaps_all)
    bp_avg_ms = sum(bp_ms) / len(bp_ms) if bp_ms else 0.0
    gaps_avg_ms = sum(gaps_ms) / len(gaps_ms) if gaps_ms else 0.0

    _out(f"\n{'-' * 62}")
    _out(f"  {label}  ({len(bp_all)} fixtures)")
    _out(f"{'-' * 62}")
    _out(f"  {'Metric':<24}  {'BasicPitch':>10}  {'GAPS':>10}")
    _out(f"  {'-' * 24}  {'-' * 10}  {'-' * 10}")
    _out(f"  {'Onset F1':<24}  {_fmt(bp_agg.onset_f1):>10}  {_fmt(gaps_agg.onset_f1):>10}")
    _out(f"  {'MIDI F1':<24}  {_fmt(bp_agg.midi_f1):>10}  {_fmt(gaps_agg.midi_f1):>10}")
    _out(f"  {'Ghost-note rate':<24}  {_fmt(bp_agg.ghost_note_rate):>10}  {_fmt(gaps_agg.ghost_note_rate):>10}")
    _out(f"  {'Missed-note rate':<24}  {_fmt(bp_agg.missed_note_rate):>10}  {_fmt(gaps_agg.missed_note_rate):>10}")
    _out(f"  {'Chord recall':<24}  {_fmt(bp_chord):>10}  {_fmt(gaps_chord):>10}")
    _out(f"  {'Avg inference (ms)':<24}  {bp_avg_ms:>10.0f}  {gaps_avg_ms:>10.0f}")
    _out(f"{'-' * 62}")

    # Per-category breakdown
    categories = sorted(set(m.category for m in bp_all + gaps_all))
    if categories:
        _out(f"\n  Per-category onset F1:")
        _out(f"  {'Category':<26}  {'BasicPitch':>10}  {'GAPS':>10}")
        _out(f"  {'-' * 26}  {'-' * 10}  {'-' * 10}")
        for cat in categories:
            bp_cat = [m for m in bp_all if m.category == cat]
            g_cat = [m for m in gaps_all if m.category == cat]
            bp_cat_agg = aggregate_metrics(bp_cat)
            g_cat_agg = aggregate_metrics(g_cat)
            _out(
                f"  {cat:<26}  {_fmt(bp_cat_agg.onset_f1):>10}"
                f"  {_fmt(g_cat_agg.onset_f1):>10}"
            )


# ── Per-fixture table ─────────────────────────────────────────────────────────


def _print_fixture_table(
    fixture_results: list[dict],
    file=None,
) -> None:
    def _out(s: str) -> None:
        print(s, file=file)

    _out(f"\n  {'Fixture':<32}  {'BP onset F1':>12}  {'GAPS onset F1':>13}")
    _out(f"  {'-' * 32}  {'-' * 12}  {'-' * 13}")
    for fr in fixture_results:
        fx_id = fr["id"][:32]
        bp_f1 = fr.get("basicPitch", {}).get("onsetF1")
        g_f1 = fr.get("gaps", {}).get("onsetF1")
        bp_str = f"{bp_f1 * 100:6.1f}%" if bp_f1 is not None else "  error "
        g_str = f"{g_f1 * 100:6.1f}%" if g_f1 is not None else "  error "
        _out(f"  {fx_id:<32}  {bp_str:>12}  {g_str:>13}")


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Basic Pitch vs GAPS experiment")
    parser.add_argument("--full", action="store_true", help="Include optional real-recording fixtures")
    args = parser.parse_args()

    if not gaps_available():
        print(
            "GAPS adapter unavailable: hf_midi_transcription is not installed.\n"
            "  pip install torch --index-url https://download.pytorch.org/whl/cpu\n"
            "  pip install -r benchmarks/requirements-gaps.txt"
        )
        return 1

    manifest = _load_manifest()
    defaults = manifest.get("defaults", {})

    print("Loading GAPS guitar model (first run downloads ~95 MB weights) …")

    bp_all_metrics: list[NoteAccuracyMetrics] = []
    gaps_all_metrics: list[NoteAccuracyMetrics] = []
    syn_bp: list[NoteAccuracyMetrics] = []
    syn_gaps: list[NoteAccuracyMetrics] = []
    real_bp: list[NoteAccuracyMetrics] = []
    real_gaps: list[NoteAccuracyMetrics] = []

    bp_times: list[int] = []
    gaps_times: list[int] = []

    fixture_results: list[dict] = []
    errors: list[str] = []

    for fx in manifest.get("fixtures", []):
        optional = bool(fx.get("optional", False))
        if optional and not args.full:
            continue

        fx_id = fx["id"]
        wav_path = BENCH / fx["path"]
        ann_path = BENCH / fx["annotation"]
        category = fx.get("category", "unknown")
        is_real = fx_id.startswith("real_")

        # Generate synthetic fixture if needed
        if gen := fx.get("generate_annotated"):
            try:
                ensure_annotated_fixture(wav_path, ann_path, gen)
            except Exception as exc:
                errors.append(f"{fx_id}: generation failed: {exc}")
                continue

        if not wav_path.exists():
            if not optional:
                errors.append(f"{fx_id}: WAV missing")
            continue

        if not ann_path.exists():
            if not optional:
                errors.append(f"{fx_id}: annotation missing")
            continue

        annotation = json.loads(ann_path.read_text(encoding="utf-8"))
        ground_truth = annotation.get("groundTruth", [])
        if not ground_truth:
            errors.append(f"{fx_id}: empty groundTruth")
            continue

        fr: dict = {"id": fx_id, "category": category}

        # ── Basic Pitch ───────────────────────────────────────────────────────
        try:
            bp_events, bp_ms, _bp_settings = _run_basic_pitch(fx, defaults)
            bp_metrics = compute_metrics(fx_id, ground_truth, bp_events, category=category)
            bp_all_metrics.append(bp_metrics)
            bp_times.append(bp_ms)
            fr["basicPitch"] = {
                "onsetF1": round(bp_metrics.onset_f1, 4),
                "midiF1": round(bp_metrics.midi_f1, 4),
                "ghostRate": round(bp_metrics.ghost_note_rate, 4),
                "missedRate": round(bp_metrics.missed_note_rate, 4),
                "inferenceMs": bp_ms,
            }
            if is_real:
                real_bp.append(bp_metrics)
            else:
                syn_bp.append(bp_metrics)
        except Exception as exc:
            fr["basicPitch"] = {"error": str(exc)}
            errors.append(f"{fx_id}/bp: {exc}")

        # ── GAPS ─────────────────────────────────────────────────────────────
        try:
            gaps_events, g_ms, _g_settings = _run_gaps(fx, defaults)
            g_metrics = compute_metrics(fx_id, ground_truth, gaps_events, category=category)
            gaps_all_metrics.append(g_metrics)
            gaps_times.append(g_ms)
            fr["gaps"] = {
                "onsetF1": round(g_metrics.onset_f1, 4),
                "midiF1": round(g_metrics.midi_f1, 4),
                "ghostRate": round(g_metrics.ghost_note_rate, 4),
                "missedRate": round(g_metrics.missed_note_rate, 4),
                "inferenceMs": g_ms,
            }
            if is_real:
                real_gaps.append(g_metrics)
            else:
                syn_gaps.append(g_metrics)
        except Exception as exc:
            err_msg = str(exc)
            fr["gaps"] = {"error": err_msg}
            errors.append(f"{fx_id}/gaps: {err_msg}")
            print(f"  GAPS error on {fx_id}: {err_msg}")

        fixture_results.append(fr)
        print(
            f"  {fx_id:<35}  bp={fr.get('basicPitch', {}).get('onsetF1', 'err'):.3f}"
            f"  gaps={fr.get('gaps', {}).get('onsetF1', 'err'):.3f}"
            if "onsetF1" in fr.get("basicPitch", {}) and "onsetF1" in fr.get("gaps", {})
            else f"  {fx_id}: error"
        )

    # ── Build report ──────────────────────────────────────────────────────────

    bp_agg = aggregate_metrics(bp_all_metrics)
    gaps_agg = aggregate_metrics(gaps_all_metrics)

    report = {
        "ok": len(errors) == 0,
        "runAt": datetime.now(timezone.utc).isoformat(),
        "mode": "full" if args.full else "required",
        "gapsPackage": "hf_midi_transcription (github.com/xavriley/hf_midi_transcription)",
        "gapsLicense": "MIT",
        "gapsModelRepo": "xavriley/midi-transcription-models",
        "gapsLimitation": "monophonic_only",
        "errors": errors,
        "aggregate": {
            "basicPitch": asdict(bp_agg),
            "gaps": asdict(gaps_agg),
        },
        "synthetic": {
            "basicPitch": asdict(aggregate_metrics(syn_bp)) if syn_bp else None,
            "gaps": asdict(aggregate_metrics(syn_gaps)) if syn_gaps else None,
        },
        "real": {
            "basicPitch": asdict(aggregate_metrics(real_bp)) if real_bp else None,
            "gaps": asdict(aggregate_metrics(real_gaps)) if real_gaps else None,
        },
        "fixtures": fixture_results,
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_json = RESULTS_DIR / "gaps-experiment.json"
    out_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    # ── Console + text summary ────────────────────────────────────────────────
    out_txt = RESULTS_DIR / "gaps-experiment.txt"

    buf = io.StringIO()

    def _tee(s: str) -> None:
        safe = s.encode("ascii", "replace").decode("ascii")
        print(safe)
        print(safe, file=buf)

    _tee(f"\nGAPS EXPERIMENT — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    _tee(f"Model: hf_midi_transcription (guitar, CPU)  |  MIT license  |  monophonic")
    _tee(f"Fixtures: {len(fixture_results)} run  |  {len(errors)} errors")

    _print_fixture_table(fixture_results, file=buf)
    _print_fixture_table(fixture_results)

    _print_comparison(bp_all_metrics, gaps_all_metrics, bp_times, gaps_times, label="OVERALL", file=buf)
    _print_comparison(bp_all_metrics, gaps_all_metrics, bp_times, gaps_times, label="OVERALL")

    if syn_bp or syn_gaps:
        _print_comparison(syn_bp, syn_gaps, bp_times, gaps_times, label="SYNTHETIC", file=buf)
        _print_comparison(syn_bp, syn_gaps, bp_times, gaps_times, label="SYNTHETIC")

    if real_bp or real_gaps:
        _print_comparison(real_bp, real_gaps, [], [], label="REAL RECORDINGS", file=buf)
        _print_comparison(real_bp, real_gaps, [], [], label="REAL RECORDINGS")

    if errors:
        _tee(f"\nErrors ({len(errors)}):")
        for e in errors:
            _tee(f"  {e}")

    _tee(f"\nReports:")
    _tee(f"  {out_json.relative_to(ROOT)}")
    _tee(f"  {out_txt.relative_to(ROOT)}")

    out_txt.write_text(buf.getvalue(), encoding="utf-8")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
