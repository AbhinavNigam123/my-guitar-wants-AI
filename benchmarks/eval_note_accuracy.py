"""Granular transcription accuracy metrics for the real-recording harness.

Separate from eval_transcribe.py (which checks structural bounds against the
manifest). This module computes onset P/R/F1, MIDI pitch P/R/F1, ghost-note
rate, missed-note rate, and harmonic/octave error rates using a bipartite
matching strategy consistent with the GuitarSet F50 evaluation convention.

Terminology
-----------
ground_truth : list of {"onsetMs": int, "endMs": int, "midi": int}
    The hand-annotated or deterministically-generated reference events.

raw_events : list of {"onsetMs": int|float, "midi": int, "amplitude": float}
    The backend transcription output (rawEvents field from transcribe_file).

A *true positive* (TP) is a detected event whose onset falls within
ONSET_TOLERANCE_MS of an unmatched ground-truth event (greedy nearest-first).
A *false positive* (FP / ghost note) is a detected event with no matching
ground-truth event.
A *false negative* (FN / missed note) is a ground-truth event with no
matching detected event.

Pitch match: after onset matching, a pair is a MIDI true positive only if
the detected MIDI equals the ground-truth MIDI exactly. Octave errors
(|diff| == 12) and harmonic errors (diff in {12, 19, 24}) are tracked
separately as sub-types of MIDI error.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any


ONSET_TOLERANCE_MS: float = 50.0
HARMONIC_INTERVALS: frozenset[int] = frozenset({12, 19, 24})


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class NoteAccuracyMetrics:
    """All metrics for a single fixture."""

    fixture_id: str
    category: str = "unknown"

    # Onset detection (onset matching within ONSET_TOLERANCE_MS)
    onset_precision: float = 0.0
    onset_recall: float = 0.0
    onset_f1: float = 0.0

    # MIDI pitch accuracy (conditional on onset match)
    midi_precision: float = 0.0   # TP_midi / total_detected_matched
    midi_recall: float = 0.0      # TP_midi / total_gt_matched
    midi_f1: float = 0.0

    # Error type breakdown (fractions of onset-matched pairs)
    octave_error_rate: float = 0.0    # |detected_midi - gt_midi| == 12
    harmonic_error_rate: float = 0.0  # detected is overtone of gt (+12/+19/+24)

    # Absolute counts
    true_positives: int = 0        # onset matches
    false_positives: int = 0       # ghost notes
    false_negatives: int = 0       # missed notes
    midi_correct: int = 0          # onset-matched pairs with exact MIDI

    # Rates
    ghost_note_rate: float = 0.0   # FP / total_detected
    missed_note_rate: float = 0.0  # FN / total_gt

    total_detected: int = 0
    total_gt: int = 0


@dataclass
class AggregateMetrics:
    """Micro-averaged metrics over a set of fixtures."""

    fixture_count: int = 0
    total_gt: int = 0
    total_detected: int = 0
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    midi_correct: int = 0

    onset_precision: float = 0.0
    onset_recall: float = 0.0
    onset_f1: float = 0.0
    midi_precision: float = 0.0
    midi_recall: float = 0.0
    midi_f1: float = 0.0
    octave_error_rate: float = 0.0
    harmonic_error_rate: float = 0.0
    ghost_note_rate: float = 0.0
    missed_note_rate: float = 0.0

    # Per-category breakdown: {category: AggregateMetrics-as-dict}
    by_category: dict[str, dict[str, Any]] = field(default_factory=dict)


# ── Core matching ─────────────────────────────────────────────────────────────


def _match_events(
    gt_onsets: list[float],
    det_onsets: list[float],
    tolerance_ms: float,
) -> list[tuple[int, int]]:
    """Greedy bipartite matching of detected onsets to ground-truth onsets.

    Returns a list of (gt_index, det_index) pairs.  Each index appears at
    most once.  Pairs are selected in order of increasing time distance so
    that the closest candidates are matched first.
    """
    candidates: list[tuple[float, int, int]] = []
    for gi, g in enumerate(gt_onsets):
        for di, d in enumerate(det_onsets):
            diff = abs(g - d)
            if diff <= tolerance_ms:
                candidates.append((diff, gi, di))

    candidates.sort()
    matched_gt: set[int] = set()
    matched_det: set[int] = set()
    pairs: list[tuple[int, int]] = []

    for _, gi, di in candidates:
        if gi not in matched_gt and di not in matched_det:
            pairs.append((gi, di))
            matched_gt.add(gi)
            matched_det.add(di)

    return pairs


def _is_harmonic_error(gt_midi: int, det_midi: int) -> bool:
    """True if detected MIDI is a common overtone of the ground-truth fundamental."""
    diff = det_midi - gt_midi
    return diff in HARMONIC_INTERVALS


def _is_octave_error(gt_midi: int, det_midi: int) -> bool:
    return abs(det_midi - gt_midi) == 12


def _f1(precision: float, recall: float) -> float:
    denom = precision + recall
    return 2.0 * precision * recall / denom if denom > 0 else 0.0


# ── Public API ────────────────────────────────────────────────────────────────


def compute_metrics(
    fixture_id: str,
    ground_truth: list[dict],
    raw_events: list[dict],
    onset_tolerance_ms: float = ONSET_TOLERANCE_MS,
    category: str = "unknown",
) -> NoteAccuracyMetrics:
    """Compute all note accuracy metrics for one fixture.

    Parameters
    ----------
    fixture_id:
        Identifier string for labelling the result.
    ground_truth:
        List of dicts with at minimum "onsetMs" and "midi" keys.
    raw_events:
        Backend rawEvents output; dicts with at minimum "onsetMs" and "midi".
    onset_tolerance_ms:
        Matching window.  Default 50 ms matches GuitarSet F50 convention.
    category:
        Fixture category tag (e.g. "isolated_notes", "open_chords").
    """
    m = NoteAccuracyMetrics(fixture_id=fixture_id, category=category)

    m.total_gt = len(ground_truth)
    m.total_detected = len(raw_events)

    if m.total_gt == 0 and m.total_detected == 0:
        return m

    gt_onsets = [float(e["onsetMs"]) for e in ground_truth]
    det_onsets = [float(e["onsetMs"]) for e in raw_events]

    pairs = _match_events(gt_onsets, det_onsets, onset_tolerance_ms)
    m.true_positives = len(pairs)
    m.false_positives = m.total_detected - m.true_positives
    m.false_negatives = m.total_gt - m.true_positives

    # Onset rates
    m.onset_precision = m.true_positives / m.total_detected if m.total_detected else 0.0
    m.onset_recall = m.true_positives / m.total_gt if m.total_gt else 0.0
    m.onset_f1 = _f1(m.onset_precision, m.onset_recall)

    m.ghost_note_rate = m.false_positives / m.total_detected if m.total_detected else 0.0
    m.missed_note_rate = m.false_negatives / m.total_gt if m.total_gt else 0.0

    # MIDI accuracy over matched pairs
    octave_errors = 0
    harmonic_errors = 0

    for gi, di in pairs:
        gt_midi = int(ground_truth[gi]["midi"])
        det_midi = int(raw_events[di]["midi"])
        if det_midi == gt_midi:
            m.midi_correct += 1
        if _is_octave_error(gt_midi, det_midi):
            octave_errors += 1
        if _is_harmonic_error(gt_midi, det_midi):
            harmonic_errors += 1

    n_matched = m.true_positives
    m.midi_precision = m.midi_correct / m.total_detected if m.total_detected else 0.0
    m.midi_recall = m.midi_correct / m.total_gt if m.total_gt else 0.0
    m.midi_f1 = _f1(m.midi_precision, m.midi_recall)

    if n_matched:
        m.octave_error_rate = octave_errors / n_matched
        m.harmonic_error_rate = harmonic_errors / n_matched

    return m


def _aggregate_simple(all_metrics: list[NoteAccuracyMetrics]) -> AggregateMetrics:
    """Micro-average without per-category breakdown (avoids infinite recursion)."""
    agg = AggregateMetrics(fixture_count=len(all_metrics))
    if not all_metrics:
        return agg

    for m in all_metrics:
        agg.total_gt += m.total_gt
        agg.total_detected += m.total_detected
        agg.true_positives += m.true_positives
        agg.false_positives += m.false_positives
        agg.false_negatives += m.false_negatives
        agg.midi_correct += m.midi_correct

    agg.onset_precision = agg.true_positives / agg.total_detected if agg.total_detected else 0.0
    agg.onset_recall = agg.true_positives / agg.total_gt if agg.total_gt else 0.0
    agg.onset_f1 = _f1(agg.onset_precision, agg.onset_recall)

    agg.midi_precision = agg.midi_correct / agg.total_detected if agg.total_detected else 0.0
    agg.midi_recall = agg.midi_correct / agg.total_gt if agg.total_gt else 0.0
    agg.midi_f1 = _f1(agg.midi_precision, agg.midi_recall)

    agg.ghost_note_rate = agg.false_positives / agg.total_detected if agg.total_detected else 0.0
    agg.missed_note_rate = agg.false_negatives / agg.total_gt if agg.total_gt else 0.0

    total_matched = agg.true_positives
    if total_matched:
        octave_sum = sum(m.octave_error_rate * m.true_positives for m in all_metrics)
        harmonic_sum = sum(m.harmonic_error_rate * m.true_positives for m in all_metrics)
        agg.octave_error_rate = octave_sum / total_matched
        agg.harmonic_error_rate = harmonic_sum / total_matched

    return agg


def aggregate_metrics(
    all_metrics: list[NoteAccuracyMetrics],
) -> AggregateMetrics:
    """Micro-average metrics over all fixtures with per-category breakdown."""
    agg = _aggregate_simple(all_metrics)

    # Per-category breakdown (uses simple aggregation to avoid recursion)
    categories: dict[str, list[NoteAccuracyMetrics]] = {}
    for m in all_metrics:
        categories.setdefault(m.category, []).append(m)

    for cat, cat_metrics in sorted(categories.items()):
        cat_agg = _aggregate_simple(cat_metrics)
        agg.by_category[cat] = {
            k: v
            for k, v in asdict(cat_agg).items()
            if k != "by_category"
        }

    return agg


def check_expect(metrics: NoteAccuracyMetrics, expect: dict) -> list[str]:
    """Return failure strings for any violated thresholds in the expect dict."""
    failures: list[str] = []

    def _check_min(key: str, attr: str) -> None:
        threshold = expect.get(key)
        if threshold is None:
            return
        actual = getattr(metrics, attr, None)
        if actual is not None and actual < threshold:
            failures.append(f"{key} {actual:.3f} < {threshold}")

    def _check_max(key: str, attr: str) -> None:
        threshold = expect.get(key)
        if threshold is None:
            return
        actual = getattr(metrics, attr, None)
        if actual is not None and actual > threshold:
            failures.append(f"{key} {actual:.3f} > {threshold}")

    _check_min("minOnsetPrecision", "onset_precision")
    _check_min("minOnsetRecall", "onset_recall")
    _check_min("minOnsetF1", "onset_f1")
    _check_min("minMidiPrecision", "midi_precision")
    _check_min("minMidiRecall", "midi_recall")
    _check_min("minMidiF1", "midi_f1")
    _check_max("maxGhostRate", "ghost_note_rate")
    _check_max("maxMissedRate", "missed_note_rate")
    _check_max("maxOctaveErrorRate", "octave_error_rate")
    _check_max("maxHarmonicErrorRate", "harmonic_error_rate")

    return failures
