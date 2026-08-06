"""Audio -> note events -> guitar tab inference.

Pipeline:
  1. Load audio (WAV from the browser or any soundfile-readable format).
  2. Run basic-pitch (ONNX) with tuned thresholds for guitar.
  3. Shared guitar cleanup on events (filter, false-polyphony collapse,
     chord grouping, unplayable-span prune including 2-note clusters,
     octave ghost strip / MIDI rewrite) so rawEvents and tab share one stream.
  4. Optional expected-tab prior for coach/practice takes.
  5. Position-aware Viterbi DP to assign (string, fret) across the sequence.
  6. Technique detection with strict bend/vibrato/slide/hammer gates.
  7. Tab playability pass, then sync rawEvents to surviving tab notes.
  8. Onset quantization (16th-note grid) + duration quantization.
"""

from __future__ import annotations

import itertools
import math
import os
import tempfile
import time
from dataclasses import dataclass, asdict, field
from typing import Optional

import numpy as np

# ── Guitar standard tuning ────────────────────────────────────────────────────
OPEN_STRING_MIDI: dict[int, int] = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}
MAX_FRET = 22
# Hard ceiling for *written* tab. Fret 12 and above are blocked and remapped to
# a lower-fret fingering on another string (or octave-down when required).
MAX_TAB_FRET = 11


# ── Rhythmic grids ────────────────────────────────────────────────────────────
ONSET_GRID = 0.25  # 16th-note quantization

RHYTHMIC_VALUES = [4.0, 3.0, 2.0, 1.5, 1.0, 0.75, 0.5, 0.375, 0.25, 0.125]


def preprocess_audio_for_basic_pitch(path: str, compress: bool = False) -> tuple[str, dict]:
    """Create a normalized temp WAV for detection while leaving upload untouched."""
    import soundfile as sf

    data, sr = sf.read(path, always_2d=True)
    if data.size == 0:
        return path, {"enabled": False, "reason": "empty"}

    mono = np.mean(data.astype(np.float32), axis=1)
    original_samples = int(mono.size)
    peak_before = float(np.max(np.abs(mono))) if mono.size else 0.0
    rms_before = float(np.sqrt(np.mean(mono * mono))) if mono.size else 0.0

    if peak_before <= 1e-7:
        return path, {
            "enabled": False,
            "reason": "silent",
            "peakBefore": round(peak_before, 5),
            "rmsBefore": round(rms_before, 5),
        }

    threshold = max(0.006, peak_before * 0.025)
    active = np.flatnonzero(np.abs(mono) >= threshold)
    trimmed_samples = 0
    trim_start_ms = 0.0
    if active.size > 0:
        pad = int(sr * 0.05)
        start = max(0, int(active[0]) - pad)
        end = min(mono.size, int(active[-1]) + pad + 1)
        trimmed_samples = max(0, original_samples - (end - start))
        trim_start_ms = (start / sr) * 1000.0
        mono = mono[start:end]

    mono = _high_pass_filter(mono, sr)
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    rms = float(np.sqrt(np.mean(mono * mono))) if mono.size else 0.0
    gain = 1.0
    if peak > 1e-7:
        peak_gain = 0.96 / peak
        rms_gain = 0.12 / rms if rms > 1e-7 else peak_gain
        gain = min(peak_gain, rms_gain, 8.0)
        mono = np.clip(mono * gain, -1.0, 1.0)
    if compress and mono.size:
        threshold_level = 0.18
        ratio = 3.0
        magnitude = np.abs(mono)
        compressed = np.where(
            magnitude <= threshold_level,
            magnitude,
            threshold_level + (magnitude - threshold_level) / ratio,
        )
        mono = np.sign(mono) * compressed
        compressed_peak = float(np.max(np.abs(mono)))
        if compressed_peak > 1e-7:
            mono = np.clip(mono * (0.96 / compressed_peak), -1.0, 1.0)

    fd, out_path = tempfile.mkstemp(suffix=".coach.wav")
    os.close(fd)
    sf.write(out_path, mono, sr)
    peak_after = float(np.max(np.abs(mono))) if mono.size else 0.0
    rms_after = float(np.sqrt(np.mean(mono * mono))) if mono.size else 0.0
    return out_path, {
        "enabled": True,
        "sampleRate": int(sr),
        "trimStartMs": round(trim_start_ms, 1),
        "trimmedMs": round((trimmed_samples / sr) * 1000, 1),
        "gain": round(gain, 3),
        "peakBefore": round(peak_before, 5),
        "rmsBefore": round(rms_before, 5),
        "peakAfter": round(peak_after, 5),
        "rmsAfter": round(rms_after, 5),
        "compression": bool(compress),
    }


def _high_pass_filter(samples: np.ndarray, sr: int, cutoff_hz: float = 70.0) -> np.ndarray:
    if samples.size < 2:
        return samples
    rc = 1.0 / (2.0 * math.pi * cutoff_hz)
    dt = 1.0 / float(sr)
    alpha = rc / (rc + dt)
    out = np.empty_like(samples)
    out[0] = samples[0]
    for i in range(1, samples.size):
        out[i] = alpha * (out[i - 1] + samples[i] - samples[i - 1])
    return out


@dataclass
class TabNoteOut:
    id: str
    measure: int
    beat: float
    string: int
    fret: int
    durationBeats: float
    midi: int
    onsetMs: int
    confidence: float
    technique: Optional[str] = field(default=None)
    bendSemitones: Optional[float] = field(default=None)


# ── Chord grouping ────────────────────────────────────────────────────────────

# Default chord window, capped to avoid merging sequential melody as chords.
CHORD_WINDOW_MS = 120.0


def chord_window_ms_for_bpm(bpm: float) -> float:
    """Notes within a capped half-beat strum window can share one onset."""
    half_beat_s = (60.0 / max(bpm, 40)) * 0.5
    return min(120.0, half_beat_s * 1000.0)


def filter_events(
    events: list,
    min_amplitude_ratio: float = 0.18,
    min_absolute_amplitude: float = 0.12,
) -> list:
    """Drop low-confidence note events after basic-pitch prediction."""
    if not events:
        return events

    max_amp = max((float(e[3]) if len(e) > 3 else 0.0) for e in events)
    if max_amp <= 0:
        return events

    threshold = max(min_absolute_amplitude, max_amp * max(0.0, min_amplitude_ratio))
    return [e for e in events if (float(e[3]) if len(e) > 3 else 0.0) >= threshold]


def _event_amp(event) -> float:
    return float(event[3]) if len(event) > 3 else 0.0


def _event_midi(event) -> int:
    return int(round(float(event[2])))


def _event_duration_ms(event) -> float:
    return max(0.0, (float(event[1]) - float(event[0])) * 1000.0)


def _with_cluster_onset(event, onset_s: float):
    ev_list = list(event)
    ev_list[0] = onset_s
    return tuple(ev_list)


def _shift_event_time(event, shift_ms: float):
    if shift_ms == 0:
        return event
    shifted = list(event)
    shift_s = shift_ms / 1000.0
    shifted[0] = float(shifted[0]) + shift_s
    shifted[1] = float(shifted[1]) + shift_s
    return tuple(shifted)


def _with_event_midi(event, midi: int):
    ev_list = list(event)
    ev_list[2] = float(int(midi))
    return tuple(ev_list)


def merge_detection_passes(
    primary_events: list,
    sensitive_events: list,
    duplicate_window_ms: float = 70.0,
) -> tuple[list, dict]:
    """Add conservative sensitive-pass evidence without rewriting primary MIDI."""
    merged = list(primary_events)
    sensitive_events = coalesce_same_midi_fragments(sensitive_events)
    rescued = 0
    rejected_duplicates = 0
    rejected_artifacts = 0

    for event in sorted(sensitive_events, key=lambda item: (float(item[0]), -_event_amp(item))):
        midi = _event_midi(event)
        onset_ms = float(event[0]) * 1000.0
        amp = _event_amp(event)
        if _event_duration_ms(event) < 30.0 or amp < 0.20:
            rejected_artifacts += 1
            continue

        nearby = [
            existing
            for existing in merged
            if (
                abs(float(existing[0]) * 1000.0 - onset_ms) <= duplicate_window_ms
                or (
                    float(event[0]) <= float(existing[1]) + duplicate_window_ms / 1000.0
                    and float(existing[0]) <= float(event[1]) + duplicate_window_ms / 1000.0
                )
            )
        ]
        duplicate = any(
            _event_midi(existing) == midi
            and (
                abs(float(existing[0]) * 1000.0 - onset_ms) <= duplicate_window_ms
                or (
                    float(event[0]) <= float(existing[1]) + duplicate_window_ms / 1000.0
                    and float(existing[0]) <= float(event[1]) + duplicate_window_ms / 1000.0
                )
            )
            for existing in merged
        )
        if duplicate:
            rejected_duplicates += 1
            continue

        harmonic_of_stronger = any(
            abs(_event_midi(existing) - midi) in (12, 19, 24)
            and _event_amp(existing) >= amp * 1.25
            for existing in nearby
        )
        if harmonic_of_stronger:
            rejected_artifacts += 1
            continue

        merged.append(event)
        rescued += 1

    return sorted(merged, key=lambda item: float(item[0])), {
        "rescuedEvents": rescued,
        "rejectedSensitiveDuplicates": rejected_duplicates,
        "rejectedSensitiveArtifacts": rejected_artifacts,
    }


def coalesce_same_midi_fragments(events: list, gap_ms: float = 80.0) -> list:
    """Join sensitive-pass frame fragments into one physical attack per pitch."""
    by_midi: dict[int, list] = {}
    for event in events:
        by_midi.setdefault(_event_midi(event), []).append(event)

    output: list = []
    for midi_events in by_midi.values():
        current = None
        for event in sorted(midi_events, key=lambda item: float(item[0])):
            if current is None:
                current = event
                continue
            gap = (float(event[0]) - float(current[1])) * 1000.0
            if gap <= gap_ms:
                merged_event = list(current)
                merged_event[1] = max(float(current[1]), float(event[1]))
                if len(merged_event) > 3:
                    merged_event[3] = max(_event_amp(current), _event_amp(event))
                current = tuple(merged_event)
            else:
                output.append(current)
                current = event
        if current is not None:
            output.append(current)
    return sorted(output, key=lambda item: float(item[0]))


def _maybe_octave_correct_event(event):
    """Rewrite MIDI down an octave when Basic Pitch placed the note too high."""
    midi = _event_midi(event)
    amp = _event_amp(event)
    cands = _candidates(midi)
    if not cands:
        for oct_down in (12, 24):
            if _candidates(midi - oct_down):
                return _with_event_midi(event, midi - oct_down), True
        return event, False

    min_fret = min(fret for _, fret in cands)
    if min_fret > 15:
        if _candidates(midi - 12):
            return _with_event_midi(event, midi - 12), True
    elif min_fret >= MAX_TAB_FRET and amp <= 0.55:
        down = _candidates(midi - 12)
        if down and min(f for _, f in down) <= MAX_TAB_FRET:
            return _with_event_midi(event, midi - 12), True
    return event, False


def _strip_octave_ghosts(cluster: list) -> list:
    """Drop quiet octave/fifth harmonics that ride along a louder fundamental."""
    unique, _ = _collapse_duplicate_midis(cluster)
    if len(unique) < 2:
        return unique

    ordered = sorted(unique, key=_event_amp, reverse=True)
    removed: set[int] = set()
    for i, ev in enumerate(ordered):
        if i in removed:
            continue
        root = _event_midi(ev)
        root_amp = _event_amp(ev)
        for j in range(i + 1, len(ordered)):
            if j in removed:
                continue
            other = ordered[j]
            interval = abs(_event_midi(other) - root)
            other_amp = _event_amp(other)
            if interval in (12, 24) and other_amp < root_amp * 0.72:
                removed.add(j)
            elif interval in (7, 19) and other_amp < root_amp * 0.42:
                removed.add(j)

    kept = [ev for i, ev in enumerate(ordered) if i not in removed]
    return kept if kept else [ordered[0]]


def _collapse_duplicate_midis(cluster: list) -> tuple[list, int]:
    by_midi: dict[int, object] = {}
    collapsed = 0
    for event in cluster:
        midi = _event_midi(event)
        existing = by_midi.get(midi)
        if existing is None or _event_amp(event) > _event_amp(existing):
            if existing is not None:
                collapsed += 1
            by_midi[midi] = event
        else:
            collapsed += 1
    return list(by_midi.values()), collapsed


def _overtone_score(fundamental: int, event) -> float:
    interval = abs(_event_midi(event) - fundamental)
    if interval == 0:
        return 0.0
    if interval in (12, 24):
        return 1.0
    if interval in (7, 19):
        return 0.75
    if interval in (5, 17):
        return 0.45
    return -1.0


def _is_likely_single_note_artifact(cluster: list) -> object | None:
    if len(cluster) < 2:
        return None

    unique, _ = _collapse_duplicate_midis(cluster)
    if len(unique) == 1:
        return unique[0]

    fundamentals = sorted(unique, key=lambda e: (_event_midi(e), -_event_amp(e)))
    best_event = None
    best_score = -1.0
    total_amp = sum(_event_amp(e) for e in unique) or 1.0

    for candidate in fundamentals:
        root = _event_midi(candidate)
        explained_amp = _event_amp(candidate)
        penalties = 0
        for event in unique:
            if event is candidate:
                continue
            score = _overtone_score(root, event)
            if score < 0:
                penalties += 1
            else:
                explained_amp += _event_amp(event) * score
        explanation = explained_amp / total_amp - penalties * 0.30
        if explanation > best_score:
            best_score = explanation
            best_event = candidate

    if best_event is None:
        return None

    root_amp = _event_amp(best_event)
    max_amp = max(_event_amp(e) for e in unique)
    root_is_supported = root_amp >= max_amp * 0.30
    has_clear_overtone = any(
        abs(_event_midi(event) - _event_midi(best_event)) in (5, 7, 12, 17, 19, 24)
        for event in unique
        if event is not best_event
    )
    # More aggressive: collapse when overtones explain most of the energy
    if best_score >= 0.50 and root_is_supported and (has_clear_overtone or best_score >= 0.72):
        return best_event
    return None


def _dominant_single_note_candidate(cluster: list) -> object | None:
    """Return a dominant note when a same-attack cluster is probably one pluck.

    Policy: only collapse aggressively when the cluster is unplayable/scattered.
    Playable chords with comparable tones are preserved; for playable clusters
    we only collapse on clear single-source dominance (a little tighter than
    the original thresholds, not aggressive).
    """
    unique, _ = _collapse_duplicate_midis(cluster)
    if len(unique) < 2:
        return unique[0] if unique else None

    ordered = sorted(unique, key=_event_amp, reverse=True)
    top = ordered[0]
    second = ordered[1]
    top_amp = _event_amp(top)
    total_amp = sum(_event_amp(e) for e in ordered) or 1.0
    comparable = [e for e in ordered if _event_amp(e) >= top_amp * 0.65]
    top_share = top_amp / total_amp
    dominance_ratio = top_amp / max(_event_amp(second), 1e-6)
    onset_span_ms = (max(float(e[0]) for e in ordered) - min(float(e[0]) for e in ordered)) * 1000.0
    other_durations = [_event_duration_ms(e) for e in ordered if e is not top]
    median_other_duration = float(np.median(other_durations)) if other_durations else 0.0
    top_duration = _event_duration_ms(top)
    short_ghosts = median_other_duration <= 0.0 or top_duration >= median_other_duration * 1.20
    harmonic_followers = sum(
        1 for e in ordered
        if e is not top and _overtone_score(_event_midi(top), e) > 0
    )

    playable_as_chord = _is_playable_chord_events(unique)

    # Unplayable / scattered: collapse when one note clearly carries the energy
    if not playable_as_chord:
        if top_share >= 0.42 and dominance_ratio >= 1.40:
            return top
        return None

    # Playable chord: only collapse on strong single-source dominance
    if len(comparable) >= 2:
        return None

    if dominance_ratio >= 2.10 and top_share >= 0.50:
        return top

    # More sensitive single-pluck path: very tight, weaker byproducts around
    # one sustained note are usually detector polyphony, not a played chord.
    if (
        onset_span_ms <= 18.0
        and top_share >= 0.46
        and dominance_ratio >= 1.55
        and short_ghosts
        and harmonic_followers >= 1
    ):
        return top

    return None


def _dominant_tab_note_candidate(notes: list[TabNoteOut]) -> TabNoteOut | None:
    """Collapse tab clusters only when unplayable, or on strong single-source dominance."""
    if len(notes) < 2:
        return None

    ordered = sorted(notes, key=lambda n: n.confidence, reverse=True)
    top = ordered[0]
    second = ordered[1]
    top_conf = top.confidence
    total_conf = sum(max(0.0, n.confidence) for n in ordered) or 1.0
    comparable = [n for n in ordered if n.confidence >= top_conf * 0.65]
    playable = _is_playable_tab_chord(notes)

    if not playable:
        if top_conf / total_conf >= 0.42 and top_conf / max(second.confidence, 1e-6) >= 1.40:
            return top
        return None

    if len(comparable) >= 2:
        return None

    if top_conf / max(second.confidence, 1e-6) >= 2.15 and top_conf / total_conf >= 0.50:
        return top
    return None


def collapse_false_polyphony(events: list, window_ms: float = 35.0) -> tuple[list, dict]:
    """Conservatively collapse same-attack duplicate/overtone artifacts."""
    if not events:
        return events, {"collapsedEvents": 0, "artifactClusters": 0, "dominantSingleClusters": 0}

    sorted_ev = sorted(events, key=lambda e: float(e[0]))
    clusters: list[list] = [[sorted_ev[0]]]
    for event in sorted_ev[1:]:
        if (float(event[0]) - float(clusters[-1][0][0])) * 1000.0 <= window_ms:
            clusters[-1].append(event)
        else:
            clusters.append([event])

    output = []
    collapsed_events = 0
    artifact_clusters = 0
    dominant_single_clusters = 0
    for cluster in clusters:
        if len(cluster) == 1:
            output.extend(cluster)
            continue

        duplicate_collapsed, duplicate_count = _collapse_duplicate_midis(cluster)
        candidate = _is_likely_single_note_artifact(duplicate_collapsed)
        reason = "artifact"
        if candidate is None:
            candidate = _dominant_single_note_candidate(duplicate_collapsed)
            reason = "dominant"
        if candidate is not None:
            if reason == "dominant":
                dominant_single_clusters += 1
            else:
                artifact_clusters += 1
            collapsed_events += len(cluster) - 1
            onset = float(np.median([float(e[0]) for e in cluster]))
            output.append(_with_cluster_onset(candidate, onset))
            continue

        collapsed_events += duplicate_count
        output.extend(duplicate_collapsed)

    return sorted(output, key=lambda e: float(e[0])), {
        "collapsedEvents": collapsed_events,
        "artifactClusters": artifact_clusters,
        "dominantSingleClusters": dominant_single_clusters,
    }


def group_chords(events: list, window_ms: float = CHORD_WINDOW_MS) -> list:
    """Cluster near-simultaneous onsets to the same onset time.

    Uses anchor clustering: each note joins only when its onset is within
    *window_ms* of the cluster start. This keeps slow melodic chains from
    collapsing into one chord. Clusters are unified only when they look like
    true polyphony or near-simultaneous attacks.
    """
    if not events:
        return events

    sorted_ev = sorted(events, key=lambda e: float(e[0]))
    clusters: list[list] = [[sorted_ev[0]]]

    for ev in sorted_ev[1:]:
        prev_onset_ms = float(clusters[-1][0][0]) * 1000.0
        curr_onset_ms = float(ev[0]) * 1000.0
        if curr_onset_ms - prev_onset_ms <= window_ms:
            clusters[-1].append(ev)
        else:
            clusters.append([ev])

    result = []
    for cl in clusters:
        distinct_pitches = {int(round(float(e[2]))) for e in cl}
        span_ms = (max(float(e[0]) for e in cl) - min(float(e[0]) for e in cl)) * 1000.0
        should_merge = len(cl) >= 2 and (len(distinct_pitches) >= 2 or span_ms <= 40.0)
        if not should_merge:
            result.extend(cl)
            continue
        median_onset = float(np.median([float(e[0]) for e in cl]))
        for ev in cl:
            ev_list = list(ev)
            ev_list[0] = median_onset
            result.append(tuple(ev_list))

    return sorted(result, key=lambda e: float(e[0]))


def merge_tab_beats(notes: list[TabNoteOut], window_ms: float = CHORD_WINDOW_MS) -> None:
    """Post-quantize pass: force notes in the same strum cluster onto one beat.

    Even after onset grouping + grid snap, floating-point or grid rounding can
    leave chord notes on adjacent 16ths. Cluster by onsetMs and unify beat.
    """
    if len(notes) < 2:
        return

    sorted_notes = sorted(notes, key=lambda n: (n.measure, n.beat, n.onsetMs))
    clusters: list[list[TabNoteOut]] = [[sorted_notes[0]]]

    for n in sorted_notes[1:]:
        prev = clusters[-1][0]
        if abs(n.onsetMs - prev.onsetMs) <= window_ms:
            clusters[-1].append(n)
        else:
            clusters.append([n])

    for cl in clusters:
        if len(cl) < 2:
            continue
        if len({n.midi for n in cl}) < 2 and max(n.onsetMs for n in cl) - min(n.onsetMs for n in cl) > 40:
            continue
        # Use earliest quantized beat in the cluster (most natural downbeat)
        ref = min(cl, key=lambda n: (n.measure, n.beat))
        for n in cl:
            n.measure = ref.measure
            n.beat = ref.beat


# ── Measure-level rhythm gridify ─────────────────────────────────────────────

# Display-stable rhythmic vocabulary (beats): prefer these over raw quantised
# values so TabViewer produces clean stems without sub-16th rest storms.
_DISPLAY_GRID = [4.0, 3.0, 2.0, 1.5, 1.0, 0.75, 0.5, 0.375, 0.25]
_MIN_DISPLAY_DUR = 0.25  # 16th — never shorter for display


def _snap_to_display_grid(dur: float) -> float:
    """Snap *dur* to the nearest display-stable rhythmic value."""
    return min(_DISPLAY_GRID, key=lambda v: abs(v - dur))


def gridify_measure_rhythm(notes: list[TabNoteOut], beats_per_measure: int = 4) -> None:
    """Tile durations so they fill the bar without overlap or sub-16th gaps.

    Algorithm (in-place):
      1. Group by (measure, beat) — already merged by merge_tab_beats.
      2. For each attack, set durationBeats = distance to next attack (or bar
         end), capped at bar length; snap to nearest display-stable value.
      3. If the resulting duration is less than _MIN_DISPLAY_DUR, promote to it.
      4. Never touch pitch/string/fret/onsetMs.
    """
    # Collect unique attack positions per measure
    from collections import defaultdict
    by_measure: dict[int, list[float]] = defaultdict(list)
    for n in notes:
        by_measure[n.measure].append(n.beat)

    # Deduplicate and sort
    attack_map: dict[int, list[float]] = {
        m: sorted(set(round(b, 3) for b in beats))
        for m, beats in by_measure.items()
    }

    # Build duration map: measure → beat → durationBeats
    dur_map: dict[tuple[int, float], float] = {}
    for m, attacks in attack_map.items():
        for i, beat in enumerate(attacks):
            remaining = float(beats_per_measure) - (beat - 1.0)
            if i + 1 < len(attacks):
                raw_gap = attacks[i + 1] - beat
            else:
                raw_gap = remaining
            # Clamp to bar boundary
            gap = max(_MIN_DISPLAY_DUR, min(raw_gap, remaining))
            dur_map[(m, round(beat, 3))] = _snap_to_display_grid(gap)

    # Apply
    for n in notes:
        key = (n.measure, round(n.beat, 3))
        if key in dur_map:
            n.durationBeats = dur_map[key]


# ── String / fret helpers ─────────────────────────────────────────────────────

def _candidates(midi: int, max_fret: int = MAX_TAB_FRET) -> list[tuple[int, int]]:
    """All (string, fret) placements for *midi* with fret in [0, max_fret]."""
    result = []
    for string, open_midi in OPEN_STRING_MIDI.items():
        fret = midi - open_midi
        if 0 <= fret <= max_fret:
            result.append((string, fret))
    return result


def _midi_for_fingering(string: int, fret: int) -> int:
    return OPEN_STRING_MIDI[string] + fret


def _pick_fingering_under_cap(
    midi: int,
    *,
    preferred_string: int | None = None,
    neighbor_center: float | None = None,
    blocked_strings: set[int] | None = None,
) -> tuple[int, int, int]:
    """Choose a human fingering with fret <= MAX_TAB_FRET.

    Strategy:
      1. Same pitch on any string under the written-tab cap (prefer next higher-pitched
         string = lower string index, and frets near *neighbor_center*).
      2. If the pitch cannot fit under the cap, drop octaves until it can.

    Returns (string, fret, effective_midi).
    """
    blocked = blocked_strings or set()
    effective = int(midi)
    for _ in range(4):
        cands = [
            (s, f) for s, f in _candidates(effective, max_fret=MAX_TAB_FRET)
            if s not in blocked
        ]
        if cands:
            def score(sf: tuple[int, int]) -> tuple:
                s, f = sf
                # Prefer frets near the local hand position
                neigh = abs(f - neighbor_center) if neighbor_center is not None else 0.0
                # Prefer staying on the previous/preferred string
                same = 0 if preferred_string is not None and s == preferred_string else 1
                # Prefer adjacent "next" string toward the nut/higher pitch
                # (string index decreases → same pitch at lower fret)
                toward_high = abs(s - (preferred_string - 1)) if preferred_string and preferred_string > 1 else abs(s - 1)
                return (neigh, same, f, toward_high, s)

            string, fret = min(cands, key=score)
            return string, fret, effective
        effective -= 12

    # Absolute fallback: open high E
    return 1, 0, OPEN_STRING_MIDI[1]


def _fret_prior(fret: int) -> float:
    """Nonlinear cost biasing toward open/first-position human fingerings.

    Guitarists strongly prefer frets 0–5 for melody and open chords. Mild
    linear priors let the DP wander toward the octave fret whenever a shape bonus or
    transition gap allows it — that produces "sounds right, looks wrong" tab.
    """
    if fret <= 0:
        return 0.0
    if fret <= 5:
        return fret * 0.35
    if fret <= 7:
        return 1.75 + (fret - 5) * 0.9
    if fret <= MAX_TAB_FRET:
        return 3.55 + (fret - 7) * 1.6
    # Should not appear in tab candidates; keep steep for safety
    return 20.0 + (fret - MAX_TAB_FRET) * 4.0


def _string_emit_cost(string: int, fret: int) -> float:
    """Extra emission bias for idiomatic single-note / chord fingerings."""
    cost = _fret_prior(fret)
    # Soft preference for open strings when available (human default).
    if fret == 0:
        cost -= 1.20
    # Mild mid-neck string preference for fretted notes in first position —
    # avoid parking everything on string 1 or 6 when a middle string is lower.
    if 1 <= fret <= 5 and string in (2, 3, 4):
        cost -= 0.15
    # High frets on low strings are especially unidiomatic for melody.
    if fret >= 12 and string >= 5:
        cost += 1.2
    # Hard taboo zone — should be filtered out, but punish if leaked
    if fret > MAX_TAB_FRET:
        cost += 50.0
    return cost


def _candidate_set_for_event(event) -> list[tuple[int, int]]:
    """Candidate fingerings for an event — never above MAX_TAB_FRET."""
    midi = int(round(float(event[2])))
    amp = float(event[3]) if len(event) > 3 else 0.0

    cands = _candidates(midi, max_fret=MAX_TAB_FRET)
    if not cands:
        # Pitch only fits above the tab cap — offer octave-down placements
        for oct_down in (12, 24):
            cands = _candidates(midi - oct_down, max_fret=MAX_TAB_FRET)
            if cands:
                break
    elif cands:
        min_fret = min(fret for _, fret in cands)
        # Also offer octave-down when the only in-cap placements are still high.
        if min_fret >= MAX_TAB_FRET:
            octave_cands = _candidates(midi - 12, max_fret=MAX_TAB_FRET)
            if octave_cands:
                cands = octave_cands + cands
        elif min_fret > 7 and amp <= 0.65:
            octave_cands = _candidates(midi - 12, max_fret=MAX_TAB_FRET)
            if octave_cands and min(f for _, f in octave_cands) <= 7:
                cands = octave_cands + cands

    cands = sorted(set(cands), key=lambda sf: (_string_emit_cost(sf[0], sf[1]), sf[0]))
    return cands or [(1, 0)]


def _low_position_fingering_for_melody(
    midi: int,
    *,
    preferred_string: int | None = None,
    neighbor_center: float | None = None,
) -> tuple[int, int] | None:
    """Return a same-pitch or octave-shifted low-position melody fingering."""
    choices: list[tuple[int, int, int]] = []
    for octave_penalty, trial_midi in ((0, midi), (2, midi - 12), (3, midi + 12)):
        if trial_midi < 40 or trial_midi > 88:
            continue
        for string, fret in _candidates(trial_midi, max_fret=4):
            choices.append((octave_penalty, string, fret))

    if not choices:
        return None

    def score(choice: tuple[int, int, int]) -> tuple[float, int, int, int]:
        octave_penalty, string, fret = choice
        neigh = abs(fret - neighbor_center) if neighbor_center is not None else 0.0
        same = 0 if preferred_string is not None and string == preferred_string else 1
        open_bonus = -2 if fret == 0 else 0
        return (octave_penalty + neigh * 0.35 + fret * 0.12, same, open_bonus, string)

    _oct, string, fret = min(choices, key=score)
    return string, fret


def clamp_events_to_max_tab_fret(events: list) -> tuple[list, dict]:
    """Rewrite event MIDI so every note has a fingering at fret <= MAX_TAB_FRET.

    Uses local neighborhood (prev/next event amplitudes as weak position prior)
    only for choosing among legal octave-corrected pitches — never invents
    notes. Returns (events, stats).
    """
    if not events:
        return events, {"clampedEvents": 0, "octaveDroppedEvents": 0}

    ordered = sorted(enumerate(events), key=lambda pair: float(pair[1][0]))
    output = list(events)
    clamped = 0
    octave_dropped = 0

    for pos, (orig_i, event) in enumerate(ordered):
        midi = _event_midi(event)
        # Neighbor center from already-clamped previous note if available
        neighbor_center = None
        if pos > 0:
            prev_ev = output[ordered[pos - 1][0]]
            prev_cands = _candidates(_event_midi(prev_ev), max_fret=MAX_TAB_FRET)
            if prev_cands:
                neighbor_center = float(min(f for _, f in prev_cands))

        cands = _candidates(midi, max_fret=MAX_TAB_FRET)
        if cands:
            # Already placeable under the cap — keep MIDI
            continue

        string, fret, effective = _pick_fingering_under_cap(
            midi,
            neighbor_center=neighbor_center,
        )
        if effective != midi:
            output[orig_i] = _with_event_midi(event, effective)
            octave_dropped += 1
            clamped += 1
        elif fret > MAX_TAB_FRET:
            # Should not happen
            output[orig_i] = _with_event_midi(event, _midi_for_fingering(string, fret))
            clamped += 1

    return output, {"clampedEvents": clamped, "octaveDroppedEvents": octave_dropped}


def clamp_fingerings_to_max_tab_fret(
    pairs: list[tuple[int, int]],
    events: list,
) -> tuple[list[tuple[int, int]], list, dict]:
    """Post-DP: remap any fret > MAX_TAB_FRET using neighbors + next-string rule.

    Also rewrites event MIDI when the remap requires an octave drop so tab and
    rawEvents stay consistent.
    """
    if not pairs:
        return pairs, events, {"remappedFingerings": 0}

    out_pairs = list(pairs)
    out_events = list(events)
    remapped = 0

    for i, (string, fret) in enumerate(out_pairs):
        if fret <= MAX_TAB_FRET and 1 <= string <= 6:
            # Ensure midi matches fingering
            expected_midi = _midi_for_fingering(string, fret)
            if _event_midi(out_events[i]) != expected_midi:
                # Prefer keeping fingering; snap event midi to it when within
                # an octave (DP may have chosen octave-down candidate).
                if abs(_event_midi(out_events[i]) - expected_midi) % 12 == 0:
                    out_events[i] = _with_event_midi(out_events[i], expected_midi)
            continue

        # Neighbor hand position from surrounding in-cap frets
        neighbor_frets = []
        if i > 0 and out_pairs[i - 1][1] <= MAX_TAB_FRET:
            neighbor_frets.append(out_pairs[i - 1][1])
        if i + 1 < len(out_pairs) and pairs[i + 1][1] <= MAX_TAB_FRET:
            neighbor_frets.append(pairs[i + 1][1])
        neighbor_center = float(np.median(neighbor_frets)) if neighbor_frets else None
        preferred = out_pairs[i - 1][0] if i > 0 else string

        midi = _event_midi(out_events[i])
        # If current assignment is high, try same MIDI on a higher-pitched string first
        new_s, new_f, effective = _pick_fingering_under_cap(
            midi,
            preferred_string=preferred,
            neighbor_center=neighbor_center,
        )
        out_pairs[i] = (new_s, new_f)
        if effective != midi:
            out_events[i] = _with_event_midi(out_events[i], effective)
        remapped += 1

    return out_pairs, out_events, {"remappedFingerings": remapped}


def remap_fingerings_preserve_midi(
    pairs: list[tuple[int, int]],
    events: list,
) -> tuple[list[tuple[int, int]], list, dict]:
    """Remap under the tab cap without changing detector MIDI."""
    output_pairs: list[tuple[int, int]] = []
    output_events: list = []
    omitted = 0
    remapped = 0
    previous: tuple[int, int] | None = None
    used_at_onset: dict[int, set[int]] = {}

    for pair, event in zip(pairs, events):
        onset_key = int(round(float(event[0]) * 1000.0))
        used_strings = used_at_onset.setdefault(onset_key, set())
        candidates = [
            candidate
            for candidate in _candidates(_event_midi(event), max_fret=MAX_TAB_FRET)
            if candidate[0] not in used_strings
        ]
        if not candidates:
            omitted += 1
            continue

        def score(candidate: tuple[int, int]) -> tuple[float, int, int]:
            string, fret = candidate
            continuity = 0.0
            if previous is not None:
                continuity = abs(fret - previous[1]) * 0.8 + abs(string - previous[0]) * 0.45
            return continuity + fret * 0.08, fret, string

        chosen = min(candidates, key=score)
        output_pairs.append(chosen)
        output_events.append(event)
        used_strings.add(chosen[0])
        if chosen != pair:
            remapped += 1
        previous = chosen

    return output_pairs, output_events, {
        "remappedFingerings": remapped,
        "omittedUnrenderableEvents": omitted,
    }


def _suppress_sudden_high_register_voicings(
    pairs: list[tuple[int, int]],
    events: list,
) -> tuple[list[tuple[int, int]], list, dict]:
    """Rewrite isolated high-position slots into lower octave-equivalent shapes."""
    if len(pairs) < 2 or len(pairs) != len(events):
        return pairs, events, {"registerRemappedSlots": 0, "registerOctaveDroppedEvents": 0}

    slots = _build_time_slots(events, chord_window_s=0.005)
    if len(slots) < 2:
        return pairs, events, {"registerRemappedSlots": 0, "registerOctaveDroppedEvents": 0}

    out_pairs = list(pairs)
    out_events = list(events)
    remapped_slots = 0
    octave_drops = 0

    def slot_voicing(slot: list[tuple[int, object]]) -> list[tuple[int, int]]:
        return [out_pairs[orig_i] for orig_i, _ in slot]

    def slot_center(slot: list[tuple[int, object]]) -> float:
        return _position_center(slot_voicing(slot))

    def slot_median_midi(slot: list[tuple[int, object]]) -> float:
        return float(np.median([_event_midi(out_events[orig_i]) for orig_i, _ in slot]))

    for slot_i, slot in enumerate(slots):
        voicing = slot_voicing(slot)
        if not voicing:
            continue

        strings = [s for s, _ in voicing]
        frets = [f for _, f in voicing]
        current_center = _position_center(voicing)
        current_midi = slot_median_midi(slot)
        high_top_voicing = (
            len(slot) >= 2
            and current_center >= 6.0
            and max(frets) >= 7
            and min(strings) <= 2
            and max(strings) <= 3
        )

        neighbor_slots = []
        if slot_i > 0:
            neighbor_slots.append(slots[slot_i - 1])
        if slot_i + 1 < len(slots):
            neighbor_slots.append(slots[slot_i + 1])
        if not neighbor_slots or not high_top_voicing:
            continue

        context_center = float(np.median([slot_center(s) for s in neighbor_slots]))
        context_midi = float(np.median([slot_median_midi(s) for s in neighbor_slots]))
        if not (current_center - context_center >= 3.0 or current_midi - context_midi >= 9.0):
            continue

        per_note_options: list[list[tuple[int, int, int, int]]] = []
        for orig_i, _ev in slot:
            midi = _event_midi(out_events[orig_i])
            options: list[tuple[int, int, int, int]] = []
            seen: set[tuple[int, int, int]] = set()
            for shift in (0, -12, -24):
                trial_midi = midi + shift
                if trial_midi < 40 or trial_midi > 88:
                    continue
                for string, fret in _candidates(trial_midi, max_fret=MAX_TAB_FRET):
                    key = (string, fret, trial_midi)
                    if key in seen:
                        continue
                    seen.add(key)
                    options.append((string, fret, trial_midi, shift))
            if not options:
                per_note_options = []
                break
            per_note_options.append(options)
        if not per_note_options:
            continue

        best: tuple[float, list[tuple[int, int]], list[int], list[int]] | None = None
        for combo in itertools.product(*per_note_options):
            trial_voicing = [(s, f) for s, f, _midi, _shift in combo]
            if not _voicing_is_playable(trial_voicing):
                continue
            trial_strings = {s for s, _ in trial_voicing}
            trial_center = _position_center(trial_voicing)
            _style, bonus = _match_known_shape(trial_voicing)
            shift_count = sum(1 for _s, _f, _midi, shift in combo if shift < 0)
            top_string_penalty = 4.0 if min(trial_strings) <= 1 else 0.0
            bass_detour_penalty = 3.0 if max(trial_strings) >= 5 else 0.0
            string_span_penalty = max(0, max(trial_strings) - min(trial_strings) - 2) * 1.5
            middle_string_bonus = 0.0
            if trial_strings == {2, 3, 4}:
                middle_string_bonus = 4.5
            elif min(trial_strings) >= 2 and max(trial_strings) <= 4:
                middle_string_bonus = 1.5
            elif min(trial_strings) >= 2 and max(trial_strings) <= 5:
                middle_string_bonus = 0.8

            score = (
                sum(_string_emit_cost(s, f) for s, f in trial_voicing)
                - bonus
                + shift_count * 0.35
                + abs(trial_center - context_center) * 0.9
                + top_string_penalty
                + bass_detour_penalty
                + string_span_penalty
                - middle_string_bonus
            )
            if trial_center >= current_center - 0.5:
                score += 4.0
            if trial_center <= current_center - 2.0:
                score -= 1.2

            trial_midis = [midi for _s, _f, midi, _shift in combo]
            shifts = [shift for _s, _f, _midi, shift in combo]
            if best is None or score < best[0]:
                best = (score, trial_voicing, trial_midis, shifts)

        if best is None:
            continue

        _score, trial_voicing, trial_midis, shifts = best
        trial_center = _position_center(trial_voicing)
        if trial_center > current_center - 1.5 or trial_center > context_center + 4.5:
            continue

        for (orig_i, _ev), pair, midi, shift in zip(slot, trial_voicing, trial_midis, shifts):
            out_pairs[orig_i] = pair
            if midi != _event_midi(out_events[orig_i]):
                out_events[orig_i] = _with_event_midi(out_events[orig_i], midi)
            if shift < 0:
                octave_drops += abs(shift) // 12
        remapped_slots += 1

    return out_pairs, out_events, {
        "registerRemappedSlots": remapped_slots,
        "registerOctaveDroppedEvents": octave_drops,
    }


# ── Guitar ergonomics: CAGED shape library ────────────────────────────────────

# Style tags for voicing categories (used in transition continuity bonus)
_STYLE_POWER  = "power"
_STYLE_OPEN   = "open"
_STYLE_BARRE  = "barre"
_STYLE_OCTAVE = "octave"
_STYLE_JAZZ   = "jazz"
_STYLE_OTHER  = "other"

# Movable shape templates: frozenset of (string, fret_offset) for FRETTED notes
# only, where fret_offset is relative to the minimum fretted fret in the voicing.
# Open strings are excluded from the fretted pattern.
# Format: (pattern, style, bonus, min_root_fret, max_root_fret)
_MOVABLE_SHAPES: list[tuple[frozenset, str, float, int, int]] = [
    # ── E-shape barre chords (root on string 6) ──────────────────────────────
    (frozenset({(6,0),(5,2),(4,2),(3,1),(2,0),(1,0)}), _STYLE_BARRE, 2.0, 1, 17),  # major
    (frozenset({(6,0),(5,2),(4,2),(3,0),(2,0),(1,0)}), _STYLE_BARRE, 2.0, 1, 17),  # minor
    (frozenset({(6,0),(5,2),(4,0),(3,1),(2,0),(1,0)}), _STYLE_BARRE, 1.8, 1, 17),  # dom7
    (frozenset({(6,0),(5,2),(4,2),(3,2),(2,0),(1,0)}), _STYLE_BARRE, 1.8, 1, 17),  # maj7
    (frozenset({(6,0),(5,2),(4,2),(3,2),(2,1),(1,0)}), _STYLE_BARRE, 1.6, 1, 17),  # m7
    (frozenset({(6,0),(5,2),(4,2),(3,3),(2,0),(1,0)}), _STYLE_BARRE, 1.4, 1, 17),  # sus4
    (frozenset({(6,0),(5,2),(4,2),(3,1),(2,0)}),       _STYLE_BARRE, 1.5, 1, 17),  # major 5-str
    (frozenset({(6,0),(5,2),(4,2),(3,0),(2,0)}),       _STYLE_BARRE, 1.5, 1, 17),  # minor 5-str

    # ── A-shape barre chords (root on string 5) ──────────────────────────────
    (frozenset({(5,0),(4,2),(3,2),(2,2),(1,0)}), _STYLE_BARRE, 2.0, 1, 17),  # major
    (frozenset({(5,0),(4,2),(3,2),(2,1),(1,0)}), _STYLE_BARRE, 2.0, 1, 17),  # minor
    (frozenset({(5,0),(4,2),(3,2),(2,0),(1,0)}), _STYLE_BARRE, 1.8, 1, 17),  # dom7
    (frozenset({(5,0),(4,2),(3,2),(2,3),(1,0)}), _STYLE_BARRE, 1.6, 1, 17),  # maj7
    (frozenset({(5,0),(4,2),(3,2),(2,1)}),       _STYLE_BARRE, 1.4, 1, 17),  # minor no 1st
    (frozenset({(5,0),(4,2),(3,2),(2,2)}),       _STYLE_BARRE, 1.4, 1, 17),  # major no 1st
    (frozenset({(5,0),(4,2),(3,2),(2,3)}),       _STYLE_BARRE, 1.4, 1, 17),  # sus4 no 1st

    # ── C-shape movable (root on string 5) ──────────────────────────────────
    (frozenset({(5,0),(4,2),(3,1),(2,1),(1,0)}), _STYLE_BARRE, 1.3, 1, 17),
    (frozenset({(5,0),(4,2),(3,1),(1,0)}),       _STYLE_BARRE, 1.0, 1, 17),

    # ── D-shape movable (root on string 4, top 4 strings) ───────────────────
    (frozenset({(4,0),(3,2),(2,3),(1,2)}), _STYLE_BARRE, 1.5, 1, 17),  # major
    (frozenset({(4,0),(3,2),(2,3),(1,1)}), _STYLE_BARRE, 1.5, 1, 17),  # minor
    (frozenset({(4,0),(3,1),(2,2),(1,2)}), _STYLE_BARRE, 1.3, 1, 17),  # dom7
    (frozenset({(4,0),(3,2),(2,2),(1,2)}), _STYLE_BARRE, 1.3, 1, 17),  # maj7

    # ── Power chords — 2-note (root + 5th) ──────────────────────────────────
    (frozenset({(6,0),(5,2)}), _STYLE_POWER, 1.8, 0, 22),
    (frozenset({(5,0),(4,2)}), _STYLE_POWER, 1.8, 0, 22),
    (frozenset({(4,0),(3,2)}), _STYLE_POWER, 1.8, 0, 22),
    (frozenset({(3,0),(2,2)}), _STYLE_POWER, 1.6, 0, 22),

    # ── Power chords — 3-note (root + 5th + octave) ──────────────────────────
    (frozenset({(6,0),(5,2),(4,2)}), _STYLE_POWER, 2.0, 0, 22),
    (frozenset({(5,0),(4,2),(3,2)}), _STYLE_POWER, 2.0, 0, 22),
    (frozenset({(4,0),(3,2),(2,2)}), _STYLE_POWER, 2.0, 0, 22),

    # ── Octave shapes (2 strings apart, fret differences 2 or 3) ────────────
    # String pair (6,4) and (5,3): +10 MIDI semitones → fret_diff = 2 for octave
    (frozenset({(6,0),(4,2)}), _STYLE_OCTAVE, 1.5, 0, 22),
    (frozenset({(5,0),(3,2)}), _STYLE_OCTAVE, 1.5, 0, 22),
    # String pair (4,2) and (3,1): +9 MIDI semitones → fret_diff = 3 for octave
    (frozenset({(4,0),(2,3)}), _STYLE_OCTAVE, 1.5, 0, 22),
    (frozenset({(3,0),(1,3)}), _STYLE_OCTAVE, 1.5, 0, 22),

    # ── Jazz / drop-2 voicings (non-adjacent strings) ───────────────────────
    (frozenset({(6,0),(4,1),(3,2),(2,2)}), _STYLE_JAZZ, 1.2, 1, 15),  # drop-2 maj7
    (frozenset({(6,0),(4,1),(3,1),(2,2)}), _STYLE_JAZZ, 1.2, 1, 15),  # drop-2 m7
    (frozenset({(6,0),(4,1),(3,2),(2,1)}), _STYLE_JAZZ, 1.2, 1, 15),  # drop-2 dom7
    (frozenset({(5,0),(3,1),(2,2),(1,2)}), _STYLE_JAZZ, 1.2, 1, 15),  # drop-2 on 5-2
    (frozenset({(5,0),(3,1),(2,1),(1,2)}), _STYLE_JAZZ, 1.2, 1, 15),  # drop-2 m7 on 5-2

    # ── Sus / extended ───────────────────────────────────────────────────────
    (frozenset({(6,0),(5,2),(4,2),(3,2),(2,0),(1,0)}), _STYLE_BARRE, 1.4, 1, 17),  # E sus2
    (frozenset({(5,0),(4,2),(3,4),(2,2),(1,0)}),       _STYLE_BARRE, 1.2, 0, 17),  # sus2

    # ── Hendrix / 7#9 compact shapes ────────────────────────────────────────
    (frozenset({(5,0),(4,2),(3,2),(2,3),(1,2)}), _STYLE_JAZZ, 1.2, 1, 15),
    (frozenset({(4,0),(3,2),(2,3),(1,2)}),       _STYLE_JAZZ, 1.2, 1, 15),
]

# Open chord shapes: absolute (string, fret) frozensets including open strings.
# Format: (frozenset_of_(string,fret), style, bonus, name)
_OPEN_SHAPES: list[tuple[frozenset, str, float, str]] = [
    # Am = x02210
    (frozenset({(5,0),(4,2),(3,2),(2,1),(1,0)}), _STYLE_OPEN, 2.5, "Am"),
    # A  = x02220
    (frozenset({(5,0),(4,2),(3,2),(2,2),(1,0)}), _STYLE_OPEN, 2.5, "A"),
    # A7 = x02020
    (frozenset({(5,0),(4,2),(3,0),(2,2),(1,0)}), _STYLE_OPEN, 2.0, "A7"),
    # Asus4 = x02230
    (frozenset({(5,0),(4,2),(3,2),(2,3),(1,0)}), _STYLE_OPEN, 1.8, "Asus4"),
    # Asus2 = x02200
    (frozenset({(5,0),(4,2),(3,2),(2,0),(1,0)}), _STYLE_OPEN, 1.8, "Asus2"),

    # D  = xx0232
    (frozenset({(4,0),(3,2),(2,3),(1,2)}), _STYLE_OPEN, 2.5, "D"),
    # Dm = xx0231
    (frozenset({(4,0),(3,2),(2,3),(1,1)}), _STYLE_OPEN, 2.5, "Dm"),
    # D7 = xx0212
    (frozenset({(4,0),(3,2),(2,1),(1,2)}), _STYLE_OPEN, 2.0, "D7"),
    # Dsus4 = xx0233
    (frozenset({(4,0),(3,2),(2,3),(1,3)}), _STYLE_OPEN, 1.8, "Dsus4"),

    # E  = 022100
    (frozenset({(6,0),(5,2),(4,2),(3,1),(2,0),(1,0)}), _STYLE_OPEN, 2.5, "E"),
    # Em = 022000
    (frozenset({(6,0),(5,2),(4,2),(3,0),(2,0),(1,0)}), _STYLE_OPEN, 2.5, "Em"),
    # E7 = 020100
    (frozenset({(6,0),(5,2),(4,0),(3,1),(2,0),(1,0)}), _STYLE_OPEN, 2.0, "E7"),
    # Em7 = 022030
    (frozenset({(6,0),(5,2),(4,2),(3,0),(2,3),(1,0)}), _STYLE_OPEN, 1.8, "Em7"),

    # G  = 320003
    (frozenset({(6,3),(5,2),(4,0),(3,0),(2,0),(1,3)}), _STYLE_OPEN, 2.5, "G"),
    # G alt = 320033
    (frozenset({(6,3),(5,2),(4,0),(3,0),(2,3),(1,3)}), _STYLE_OPEN, 2.0, "G_alt"),
    # G7 = 320001
    (frozenset({(6,3),(5,2),(4,0),(3,0),(2,0),(1,1)}), _STYLE_OPEN, 1.8, "G7"),

    # C  = x32010
    (frozenset({(5,3),(4,2),(3,0),(2,1),(1,0)}), _STYLE_OPEN, 2.5, "C"),
    # Cmaj7 = x32000
    (frozenset({(5,3),(4,2),(3,0),(2,0),(1,0)}), _STYLE_OPEN, 2.0, "Cmaj7"),
    # Cadd9 = x32030 (approx)
    (frozenset({(5,3),(4,2),(3,0),(2,3),(1,0)}), _STYLE_OPEN, 1.8, "Cadd9"),

    # B7 = x21202
    (frozenset({(5,2),(4,1),(3,2),(2,0),(1,2)}), _STYLE_OPEN, 2.0, "B7"),
    # Bm = x24432 (common partial barre)
    (frozenset({(5,2),(4,4),(3,4),(2,3),(1,2)}), _STYLE_OPEN, 1.8, "Bm"),

    # F  = 133211 (barre at 1)
    (frozenset({(6,1),(5,3),(4,3),(3,2),(2,1),(1,1)}), _STYLE_BARRE, 2.5, "F"),
    # Fmaj7 mini = xx3210
    (frozenset({(4,3),(3,2),(2,1),(1,0)}),             _STYLE_BARRE, 1.5, "Fmaj7_mini"),
]


def _max_span_at_position(min_fret: int, has_open_strings: bool) -> int:
    """Maximum fret span for a chord at the given neck position.

    Keep this tight — scattered frets with opens (e.g. x,14,2,0,x,3) are the
    main "sounds right, looks inhuman" failure mode.
    """
    if min_fret >= 10:
        return 4 if has_open_strings else 5
    # First position: 4 frets max; with opens still only 4 (C/G/Am fit in 0–3)
    return 4


def _is_scattered_voicing(voicing: list[tuple[int, int]]) -> bool:
    """True for inhuman "random fret" shapes that aren't a known chord form."""
    if len(voicing) < 2:
        return False
    fretted = sorted(f for _, f in voicing if f > 0)
    if not fretted:
        return False
    has_opens = any(f == 0 for _, f in voicing)
    span = fretted[-1] - fretted[0]
    max_f = fretted[-1]
    min_f = fretted[0]

    # Open strings mixed with frets above first-position → almost never human
    # unless it matches a known open/barre shape.
    if has_opens and max_f > 5:
        _style, bonus = _match_known_shape(voicing)
        if bonus < 1.8:
            return True

    # Large span relative to position
    if span > _max_span_at_position(min_f, has_opens):
        return True

    # Internal holes in fretted frets (e.g. 2 and 14 with nothing between)
    for a, b in zip(fretted, fretted[1:]):
        if b - a > 4:
            return True

    # Non-contiguous string skip with wide frets (x on middle, frets on edges)
    strings = sorted(s for s, _ in voicing)
    if len(strings) >= 3 and strings[-1] - strings[0] + 1 > len(strings) + 1:
        if span >= 3 and max_f >= 7:
            return True

    return False


def _match_known_shape(voicing: list[tuple[int, int]]) -> tuple[str, float]:
    """Match a voicing against the CAGED shape library.

    Returns (style_tag, bonus) where bonus is subtracted from emission cost.
    A bonus of 0.0 means no recognised shape — voicing is still allowed.
    Matching is two-stage:
      1. Absolute position check against open chord templates.
      2. Normalised fretted-note check against movable barre/power templates.
    """
    if not voicing:
        return _STYLE_OTHER, 0.0

    fretted = [(s, f) for s, f in voicing if f > 0]

    # --- 1. Open chord absolute match ------------------------------------------
    abs_pattern = frozenset(voicing)
    best_style  = _STYLE_OTHER
    best_bonus  = 0.0
    for template, style, bonus, _name in _OPEN_SHAPES:
        overlap = len(abs_pattern & template)
        if overlap == 0:
            continue
        # Exact template match (or voicing is a subset missing at most one tone)
        if abs_pattern == template:
            scaled = bonus + 2.0  # strong boost for exact open shapes
        elif overlap >= len(template) - 1 and len(abs_pattern) <= len(template):
            # Near-complete open shape (e.g. Am without high E)
            scaled = bonus * 1.15
        elif overlap >= max(3, len(template) - 1) and len(abs_pattern) == overlap:
            # Voicing is a clean subset of an open shape
            scaled = bonus * (overlap / len(template)) * 1.05
        else:
            continue
        if scaled > best_bonus:
            best_style = style
            best_bonus = scaled
    if best_bonus > 0.0:
        return best_style, best_bonus

    if not fretted:
        return _STYLE_OPEN, 1.0  # all-open voicing

    # --- 2. Movable shape match (fretted notes normalised) ----------------------
    min_fret = min(f for _, f in fretted)
    norm     = frozenset((s, f - min_fret) for s, f in fretted)

    for template, style, bonus, min_rf, max_rf in _MOVABLE_SHAPES:
        if not (min_rf <= min_fret <= max_rf):
            continue
        overlap = len(norm & template)
        if overlap == 0:
            continue
        if overlap == len(template) == len(norm):
            exact_bonus = bonus + (0.8 if min_fret <= 5 else 0.2)
            if exact_bonus > best_bonus:
                best_style = style
                best_bonus = exact_bonus
        elif overlap >= 3 and len(template) >= 3:
            coverage = overlap / len(template)
            if coverage >= 0.80:
                scaled = bonus * coverage * 0.9
                if scaled > best_bonus:
                    best_style = style
                    best_bonus = scaled

    return best_style, best_bonus


def _voicing_is_playable(voicing: list[tuple[int, int]]) -> bool:
    """True when a (string, fret) list could be fretted by one hand."""
    if len(voicing) < 2:
        return all(0 <= f <= MAX_TAB_FRET and 1 <= s <= 6 for s, f in voicing)
    strings = [s for s, _ in voicing]
    if len(set(strings)) != len(strings):
        return False
    if any(f > MAX_TAB_FRET or f < 0 or s < 1 or s > 6 for s, f in voicing):
        return False
    if _is_scattered_voicing(voicing):
        return False
    fretted = [f for _, f in voicing if f > 0]
    if not fretted:
        return True
    span = max(fretted) - min(fretted)
    min_fret = min(fretted)
    has_opens = any(f == 0 for _, f in voicing)
    return span <= _max_span_at_position(min_fret, has_opens)


def _diversify_voicings(
    scored: list[tuple[list[tuple[int, int]], float, str]],
    max_voicings: int,
) -> list[tuple[list[tuple[int, int]], float, str]]:
    """Keep top voicings while preserving open/mid/high position diversity."""
    if len(scored) <= max_voicings:
        return scored

    buckets: dict[int, list[tuple[list[tuple[int, int]], float, str]]] = {}
    for item in scored:
        center = _position_center(item[0])
        # Bucket by ~3-fret regions so first-position options survive truncation
        key = int(center // 3)
        buckets.setdefault(key, []).append(item)

    selected: list[tuple[list[tuple[int, int]], float, str]] = []
    seen: set[tuple[tuple[int, int], ...]] = set()
    # Round-robin across position buckets (prefer lower neck first)
    for key in sorted(buckets.keys()):
        for item in buckets[key][: max(2, max_voicings // max(len(buckets), 1))]:
            sig = tuple(item[0])
            if sig in seen:
                continue
            seen.add(sig)
            selected.append(item)
            if len(selected) >= max_voicings:
                selected.sort(key=lambda x: x[1])
                return selected

    # Fill remaining with globally cheapest unused voicings
    for item in scored:
        sig = tuple(item[0])
        if sig in seen:
            continue
        seen.add(sig)
        selected.append(item)
        if len(selected) >= max_voicings:
            break
    selected.sort(key=lambda x: x[1])
    return selected


def _repair_tab_note_position(note: TabNoteOut) -> bool:
    """Repair invalid string/fret assignments from MIDI; return False if impossible."""
    if 1 <= note.string <= 6 and 0 <= note.fret <= MAX_TAB_FRET:
        # Keep midi consistent with fingering
        note.midi = _midi_for_fingering(note.string, note.fret)
        return True

    if 1 <= note.string <= 6 and note.fret >= 12:
        octave_fret = note.fret
        while octave_fret >= 12:
            octave_fret -= 12
        if 0 <= octave_fret <= MAX_TAB_FRET:
            note.fret = octave_fret
            note.midi = _midi_for_fingering(note.string, note.fret)
            return True

    string, fret, effective = _pick_fingering_under_cap(
        note.midi,
        preferred_string=note.string if 1 <= note.string <= 6 else None,
    )
    note.string = string
    note.fret = fret
    note.midi = effective
    return True


def _is_playable_tab_chord(notes: list[TabNoteOut]) -> bool:
    if len(notes) < 2:
        return all(_repair_tab_note_position(n) for n in notes)

    if len({n.string for n in notes}) != len(notes):
        return False
    if any(n.string < 1 or n.string > 6 or n.fret < 0 or n.fret > MAX_TAB_FRET for n in notes):
        return False

    voicing = [(n.string, n.fret) for n in notes]
    if _is_scattered_voicing(voicing):
        return False

    fretted = [n.fret for n in notes if n.fret > 0]
    if not fretted:
        return True

    span       = max(fretted) - min(fretted)
    open_count = sum(1 for n in notes if n.fret == 0)
    max_fret   = max(fretted)
    min_fret   = min(fretted)
    if max_fret > MAX_TAB_FRET:
        return False
    if span > _max_span_at_position(min_fret, open_count > 0):
        return False

    pitch_classes = [n.midi % 12 for n in notes]
    duplicate_pitch_classes = len(pitch_classes) - len(set(pitch_classes))
    if duplicate_pitch_classes >= 2 and len(notes) <= 4:
        return False

    strings = sorted(n.string for n in notes)
    if len(notes) >= 3 and strings[-1] - strings[0] >= 5 and span >= 4 and open_count == 0:
        return False

    return True


def _is_conventional_voicing(voicing: list[tuple[int, int]]) -> bool:
    """True when the voicing is playable and looks like a real chord shape."""
    if not _voicing_is_playable(voicing):
        return False
    if len(voicing) < 2:
        return True
    _style, bonus = _match_known_shape(voicing)
    if bonus >= 1.5:
        return True
    # Compact power/double-stop without library hit still counts as conventional
    fretted = [f for _, f in voicing if f > 0]
    if len(voicing) == 2 and fretted and max(fretted) - min(fretted) <= 3:
        return True
    return False


def _remap_outlier_frets_in_tab_chord(notes: list[TabNoteOut]) -> list[TabNoteOut]:
    """Pull high/outlier frets toward a conventional low-neck shape.

    Conflict policy (C then A):
      1. Prefer remapping onto the next free string (fret may be a bit higher,
         still <= MAX_TAB_FRET) when the resulting chord is conventional/playable.
      2. If no free-string remap yields a human chord shape, drop the outlier.
    """
    if len(notes) < 2 or _is_playable_tab_chord(notes):
        return notes

    working = [TabNoteOut(**{**asdict(n)}) for n in notes]
    low_frets = [n.fret for n in working if 0 < n.fret <= 5]
    opens = [n.fret for n in working if n.fret == 0]
    if low_frets:
        center = float(np.median(low_frets))
    elif opens:
        center = 2.0
    else:
        fretted = [n.fret for n in working if n.fret > 0]
        center = float(min(fretted)) if fretted else 3.0

    ordered = sorted(working, key=lambda n: n.fret, reverse=True)
    kept: list[TabNoteOut] = []
    used_strings: set[int] = set()

    # Seed with notes already in the low cluster
    for n in sorted(working, key=lambda x: (x.fret, x.string)):
        if n.fret <= max(5, int(center) + 2):
            kept.append(n)
            used_strings.add(n.string)

    for n in ordered:
        if any(k.id == n.id for k in kept):
            continue
        if n.fret <= max(5, int(center) + 2):
            if n.string not in used_strings:
                kept.append(n)
                used_strings.add(n.string)
            continue

        # Try same pitch first; octave-shifted placements must fit the shape.
        candidates: list[tuple[int, int, int]] = []
        for trial_midi in (n.midi, n.midi - 12, n.midi + 12):
            if trial_midi < 40 or trial_midi > 88:
                continue
            for s, f in _candidates(trial_midi, max_fret=MAX_TAB_FRET):
                if s in used_strings:
                    continue
                candidates.append((s, f, trial_midi))

        best_placement = None
        best_score = 1e18
        for s, f, midi in candidates:
            trial_notes = list(kept)
            trial = TabNoteOut(**{**asdict(n)})
            trial.string, trial.fret, trial.midi = s, f, midi
            trial_notes.append(trial)
            voicing = [(x.string, x.fret) for x in trial_notes]
            if not _voicing_is_playable(voicing):
                continue
            # Prefer conventional shapes; reject still-scattered placements
            conventional = _is_conventional_voicing(voicing)
            shape_bonus = _match_known_shape(voicing)[1]
            pitch_shifted = midi != n.midi
            # Score: prefer known shapes, frets near hand center, lower frets
            score = (
                (0.0 if conventional else 8.0)
                - shape_bonus
                + abs(f - center) * 0.6
                + f * 0.15
                + (2.0 if pitch_shifted else 0.0)
            )
            if score < best_score:
                best_score = score
                best_placement = (s, f, midi, conventional, pitch_shifted, shape_bonus)

        if best_placement is not None:
            s, f, midi, conventional, pitch_shifted, shape_bonus = best_placement
            same_pitch_ok = not pitch_shifted and (conventional or best_score < 6.0)
            octave_matches_chord = any(k.midi % 12 == midi % 12 for k in kept)
            octave_shape_ok = pitch_shifted and (
                conventional or shape_bonus >= 1.5 or (f <= 5 and octave_matches_chord)
            )
            if not (same_pitch_ok or octave_shape_ok):
                continue
            n.string, n.fret, n.midi = s, f, midi
            kept.append(n)
            used_strings.add(s)
            continue

        # A: no human remap — drop the outlier
        continue

    if not kept:
        return [max(notes, key=lambda n: n.confidence)]
    if _is_playable_tab_chord(kept):
        return sorted(kept, key=lambda n: (n.measure, n.beat, n.string))
    return _best_playable_tab_subset(kept)


def _reassign_tab_chord(notes: list[TabNoteOut]) -> list[TabNoteOut]:
    """Try to re-voice an impossible tab chord by re-running voicing enumeration.

    Builds synthetic events from the TabNotes' MIDI pitches and calls
    _enumerate_voicings() to find a valid (string, fret) assignment.  If a
    valid voicing is found the notes are updated in-place and returned.
    Returns the original list unchanged if no valid reassignment exists.
    """
    if _is_playable_tab_chord(notes):
        return notes

    # Build minimal event tuples: (onset, end, midi, confidence)
    synthetic = [
        (float(n.onsetMs) / 1000.0, float(n.onsetMs + 500) / 1000.0,
         float(n.midi), n.confidence)
        for n in notes
    ]
    voicings = _enumerate_voicings(synthetic)
    if not voicings:
        return notes

    best_voicing, _emit, _style = voicings[0]
    shifted = False
    for note, (string, fret) in zip(notes, best_voicing):
        written_midi = _midi_for_fingering(string, fret)
        if written_midi == note.midi:
            continue
        if abs(written_midi - note.midi) % 12 != 0:
            return notes
        shifted = True

    if shifted:
        style, bonus = _match_known_shape(best_voicing)
        if not _is_conventional_voicing(best_voicing) and bonus < 1.5:
            return notes

    # Apply the voicing to the notes sorted by string (same order as voicing)
    for note, (string, fret) in zip(notes, best_voicing):
        note.string = string
        note.fret   = fret
        note.midi   = _midi_for_fingering(string, fret)
    return notes


def _best_playable_tab_subset(notes: list[TabNoteOut]) -> list[TabNoteOut]:
    if _is_playable_tab_chord(notes):
        return notes

    ordered = sorted(notes, key=lambda n: (n.confidence, -n.fret), reverse=True)

    from itertools import combinations

    max_size = min(len(ordered) - 1, 5)
    for size in range(max_size, 1, -1):
        best: list[TabNoteOut] = []
        best_score = -1.0
        for subset in combinations(ordered, size):
            subset_list = list(subset)
            if not _is_playable_tab_chord(subset_list):
                continue
            score = sum(n.confidence for n in subset_list) - 0.03 * sum(n.fret for n in subset_list)
            if score > best_score:
                best = subset_list
                best_score = score
        if best:
            return sorted(best, key=lambda n: (n.measure, n.beat, n.string))

    return [ordered[0]] if ordered else []


def _dedupe_same_string_tab_notes(notes: list[TabNoteOut]) -> tuple[list[TabNoteOut], int]:
    """Keep one same-beat note per string so tab never renders stacked frets."""
    by_string: dict[int, list[TabNoteOut]] = {}
    for note in notes:
        by_string.setdefault(note.string, []).append(note)

    output: list[TabNoteOut] = []
    removed = 0
    for string_notes in by_string.values():
        if len(string_notes) == 1:
            output.append(string_notes[0])
            continue

        def score(note: TabNoteOut) -> float:
            low_fret_bonus = max(0, 7 - note.fret) * 0.035
            open_bonus = 0.20 if note.fret == 0 else 0.0
            high_penalty = 0.18 if note.fret >= 8 else 0.0
            return note.confidence + low_fret_bonus + open_bonus - high_penalty

        output.append(max(string_notes, key=score))
        removed += len(string_notes) - 1

    return sorted(output, key=lambda n: (n.measure, n.beat, n.string, n.fret)), removed


def simplify_unplayable_tab_chords(
    notes: list[TabNoteOut],
    window_ms: float = 40.0,
) -> tuple[list[TabNoteOut], dict]:
    """Final fretboard sanity pass after DP/string assignment.

    Earlier passes reason from MIDI events. This pass sees the actual tab shape,
    so it can remove impossible outputs such as fret 27 or huge same-attack
    clusters that no hand can play.
    """
    if not notes:
        return notes, {"simplifiedTabClusters": 0, "removedTabNotes": 0, "dominantTabSingleClusters": 0}

    repaired_or_valid: list[TabNoteOut] = []
    removed = 0
    for note in notes:
        if _repair_tab_note_position(note):
            repaired_or_valid.append(note)
        else:
            removed += 1

    if not repaired_or_valid:
        return [], {"simplifiedTabClusters": 0, "removedTabNotes": removed, "dominantTabSingleClusters": 0}

    ordered = sorted(repaired_or_valid, key=lambda n: (n.measure, n.beat, n.onsetMs, n.string))
    clusters: list[list[TabNoteOut]] = [[ordered[0]]]
    for note in ordered[1:]:
        head = clusters[-1][0]
        # Same quantized beat = one chord on the page (critical: merge_tab_beats
        # can unify onsets onto one beat after an earlier cleanup pass).
        same_grid = note.measure == head.measure and abs(note.beat - head.beat) <= 0.01
        same_attack = abs(note.onsetMs - head.onsetMs) <= max(window_ms, 80.0)
        if same_grid or same_attack:
            clusters[-1].append(note)
        else:
            clusters.append([note])

    simplified = 0
    dominant_single = 0
    output: list[TabNoteOut] = []
    for cluster in clusters:
        by_midi: dict[int, TabNoteOut] = {}
        for note in cluster:
            existing = by_midi.get(note.midi)
            if existing is None or note.confidence > existing.confidence:
                if existing is not None:
                    removed += 1
                by_midi[note.midi] = note
            else:
                removed += 1

        deduped = list(by_midi.values())
        deduped, same_string_removed = _dedupe_same_string_tab_notes(deduped)
        if same_string_removed:
            removed += same_string_removed
            simplified += 1

        dominant = _dominant_tab_note_candidate(deduped)
        if dominant is not None:
            dominant_single += 1
            removed += len(deduped) - 1
            output.append(dominant)
            continue

        if _is_playable_tab_chord(deduped):
            output.extend(deduped)
            continue

        # First try reassignment: revoice the chord using the shape dictionary.
        reassigned = _reassign_tab_chord(list(deduped))
        if _is_playable_tab_chord(reassigned):
            simplified += 1
            output.extend(reassigned)
            continue

        # Remap high outliers into the low-neck cluster (drop on string conflict)
        remapped = _remap_outlier_frets_in_tab_chord(list(deduped))
        if len(remapped) < len(deduped) or not _is_playable_tab_chord(deduped):
            if _is_playable_tab_chord(remapped):
                simplified += 1
                removed += len(deduped) - len(remapped)
                output.extend(remapped)
                continue

        # Fallback: prune to the largest playable subset
        subset = _best_playable_tab_subset(deduped)
        if len(subset) < len(deduped):
            simplified += 1
            removed += len(deduped) - len(subset)
        output.extend(subset)

    return sorted(output, key=lambda n: (n.measure, n.beat, n.string, n.fret)), {
        "simplifiedTabClusters": simplified,
        "removedTabNotes": removed,
        "dominantTabSingleClusters": dominant_single,
    }


def _is_playable_chord_events(events: list) -> bool:
    if len(events) < 2:
        return True

    cands = [_candidate_set_for_event(event) for event in events]

    def search(i: int, used_strings: set[int], frets: list[int], strings: list[int]) -> bool:
        if i == len(cands):
            voicing = list(zip(strings, frets))
            return _voicing_is_playable(voicing)

        for string, fret in cands[i]:
            if string in used_strings:
                continue
            if fret > MAX_TAB_FRET:
                continue
            next_frets = frets + [fret]
            fretted = [f for f in next_frets if f > 0]
            if fretted and max(fretted) - min(fretted) > 4:
                continue
            if search(i + 1, used_strings | {string}, next_frets, strings + [string]):
                return True
        return False

    return search(0, set(), [], [])


def _best_playable_subset(events: list) -> list:
    if _is_playable_chord_events(events):
        return events

    ordered = sorted(events, key=lambda e: _event_amp(e), reverse=True)
    best: list = []
    best_amp = -1.0

    from itertools import combinations

    for size in range(min(len(ordered) - 1, 5), 1, -1):
        for subset in combinations(ordered, size):
            subset_list = list(subset)
            if not _is_playable_chord_events(subset_list):
                continue
            amp = sum(_event_amp(e) for e in subset_list)
            if size > len(best) or (size == len(best) and amp > best_amp):
                best = subset_list
                best_amp = amp
        if best:
            return sorted(best, key=lambda e: float(e[0]))

    return [ordered[0]]


def _repair_event_cluster(cluster: list) -> tuple[list, int, int]:
    """Octave-correct, strip ghosts, and prune unplayable same-attack clusters.

    Returns (repaired_events, removed_count, simplified_flag 0/1).
    """
    if len(cluster) == 1:
        corrected, _ = _maybe_octave_correct_event(cluster[0])
        return [corrected], 0, 0

    corrected = []
    for event in cluster:
        ev, _ = _maybe_octave_correct_event(event)
        corrected.append(ev)

    stripped = _strip_octave_ghosts(corrected)
    removed = len(cluster) - len(stripped)

    if len(stripped) < 2 or _is_playable_chord_events(stripped):
        simplified = 1 if removed > 0 and len(stripped) < len(cluster) else 0
        return sorted(stripped, key=lambda e: float(e[0])), removed, simplified

    # Dominant single when the cluster is still unplayable
    dominant = _dominant_single_note_candidate(stripped)
    if dominant is not None:
        return [dominant], len(cluster) - 1, 1

    subset = _best_playable_subset(stripped)
    removed += len(stripped) - len(subset)
    simplified = 1 if len(subset) < len(cluster) else 0
    return sorted(subset, key=lambda e: float(e[0])), removed, simplified


def simplify_unplayable_chords(events: list, window_ms: float = 40.0) -> tuple[list, dict]:
    """Prune impossible same-attack clusters (including 2-note spans) and rewrite MIDI."""
    if not events:
        return events, {"simplifiedClusters": 0, "removedEvents": 0, "octaveCorrectedEvents": 0}

    sorted_ev = sorted(events, key=lambda e: float(e[0]))
    clusters: list[list] = [[sorted_ev[0]]]
    for event in sorted_ev[1:]:
        if abs(float(event[0]) - float(clusters[-1][0][0])) * 1000.0 <= window_ms:
            clusters[-1].append(event)
        else:
            clusters.append([event])

    output = []
    simplified = 0
    removed = 0
    octave_corrected = 0
    for cluster in clusters:
        before_midis = [_event_midi(e) for e in cluster]
        repaired, cluster_removed, cluster_simplified = _repair_event_cluster(cluster)
        after_midis = [_event_midi(e) for e in repaired]
        # Count MIDI rewrites that kept a note but changed pitch
        if len(repaired) == len(cluster):
            octave_corrected += sum(
                1 for a, b in zip(sorted(before_midis), sorted(after_midis)) if a != b
            )
        else:
            # Approximate: any surviving note whose midi wasn't in the original set as-is
            before_set = set(before_midis)
            for midi in after_midis:
                if midi not in before_set and (midi + 12) in before_set:
                    octave_corrected += 1
        removed += cluster_removed
        simplified += cluster_simplified
        output.extend(repaired)

    return sorted(output, key=lambda e: float(e[0])), {
        "simplifiedClusters": simplified,
        "removedEvents": removed,
        "octaveCorrectedEvents": octave_corrected,
    }


def dp_string_fret(events: list) -> list[tuple[int, int]]:
    """Viterbi path minimising hand movement across the note sequence."""
    if not events:
        return []

    n = len(events)
    cands = [_candidate_set_for_event(e) for e in events]

    INF = 1e9
    dp   = [[INF] * len(c) for c in cands]
    prev = [[-1]  * len(c) for c in cands]

    for j, (_, f) in enumerate(cands[0]):
        dp[0][j] = _fret_prior(f)

    for i in range(1, n):
        for j, (s2, f2) in enumerate(cands[i]):
            for k, (s1, f1) in enumerate(cands[i - 1]):
                movement = abs(f2 - f1) + (0.5 if s2 != s1 else 0.0)
                cost = dp[i - 1][k] + movement + _fret_prior(f2)
                if cost < dp[i][j]:
                    dp[i][j] = cost
                    prev[i][j] = k

    result: list[tuple[int, int]] = [None] * n  # type: ignore[list-item]
    last = int(np.argmin(dp[-1]))
    result[-1] = cands[-1][last]
    for i in range(n - 2, -1, -1):
        last = prev[i + 1][last]
        result[i] = cands[i][last]

    return result


# ── Chord-aware DP: time slots, voicing enumeration, transition cost ──────────

def _build_time_slots(
    events: list,
    chord_window_s: float = 0.120,
) -> list[list[tuple[int, object]]]:
    """Group events into time slots by onset time.

    Uses the same anchor-clustering logic as group_chords(): a note joins
    the current slot when its onset is within *chord_window_s* of the slot
    anchor.  This must match the window used by group_chords() so that notes
    already unified to a median onset end up in the same slot, while genuine
    melody notes separated by more than the chord window form separate slots.
    """
    if not events:
        return []

    indexed = sorted(enumerate(events), key=lambda x: float(x[1][0]))
    slots: list[list[tuple[int, object]]] = []
    current: list[tuple[int, object]] = [indexed[0]]
    anchor = float(indexed[0][1][0])

    for orig_idx, ev in indexed[1:]:
        onset = float(ev[0])
        if onset - anchor <= chord_window_s:
            current.append((orig_idx, ev))
        else:
            slots.append(current)
            current = [(orig_idx, ev)]
            anchor  = onset

    slots.append(current)
    return slots


_MAX_VOICINGS_PER_SLOT = 60


def _enumerate_voicings(
    slot_events: list,
    max_voicings: int = _MAX_VOICINGS_PER_SLOT,
) -> list[tuple[list[tuple[int, int]], float, str]]:
    """Enumerate valid voicings for a time slot.

    For a single-note slot each candidate string/fret pair is its own voicing.
    For a chord slot the Cartesian product of per-note candidates is filtered by
    playability constraints (unique strings, position-dependent fret span) and
    scored by emission cost − shape bonus.

    Returns list of (voicing, emission_cost, style_tag) sorted ascending by cost.
    voicing[i] gives the (string, fret) assigned to slot_events[i].
    """
    n     = len(slot_events)
    cands: list[list[tuple[int, int]]] = [_candidate_set_for_event(ev) for ev in slot_events]

    if n == 1:
        result: list[tuple[list[tuple[int, int]], float, str]] = []
        has_open_candidate = any(f == 0 for _, f in cands[0])
        for s, f in cands[0]:
            emit         = _string_emit_cost(s, f)
            if has_open_candidate and f > 0:
                emit += 1.35
            style, bonus = _match_known_shape([(s, f)])
            result.append(([(s, f)], emit - bonus, style))
        result.sort(key=lambda x: x[1])
        return result[:max_voicings]

    midis = [_event_midi(ev) for ev in slot_events]
    result: list[tuple[list[tuple[int, int]], float, str]] = []

    for combo in itertools.product(*cands):
        strings = [s for s, _ in combo]
        frets   = [f for _, f in combo]

        if len(set(strings)) != n:
            continue

        fretted_frets = [f for f in frets if f > 0]
        if fretted_frets:
            min_fret   = min(fretted_frets)
            max_fret_v = max(fretted_frets)
            has_opens  = any(f == 0 for f in frets)
            span       = max_fret_v - min_fret
            if span > _max_span_at_position(min_fret, has_opens):
                continue
            # Human tab rarely frets multi-note chords above 12
            if max_fret_v > 12:
                continue

        pcs     = [m % 12 for m in midis]
        dup_pcs = len(pcs) - len(set(pcs))
        if dup_pcs >= 2 and n <= 4:
            continue

        voicing = list(combo)
        emit = sum(_string_emit_cost(s, f) for s, f in voicing)
        str_span = max(strings) - min(strings)
        if str_span > n:
            emit += 0.35 * (str_span - n)
        style, bonus = _match_known_shape(voicing)
        # Strongly prefer conventional shapes / opens over scattered frets
        if bonus < 0.5 and n >= 3:
            emit += 2.5
        elif bonus < 1.0 and n >= 2:
            emit += 1.0
        if _is_scattered_voicing(voicing):
            continue
        result.append((voicing, emit - bonus, style))

    if not result:
        # No full playable voicing. Search largest playable subset, then try to
        # place leftovers on free strings. Never emit duplicate-string voicings.
        amp_order = sorted(
            range(n),
            key=lambda i: (
                _event_amp(slot_events[i]),
                -min(_string_emit_cost(s, f) for s, f in cands[i]),
            ),
            reverse=True,
        )
        for size in range(min(n, 5), 0, -1):
            for kept in itertools.combinations(amp_order, size):
                kept_list = list(kept)
                kept_cands = [cands[i] for i in kept_list]
                for combo in itertools.product(*kept_cands):
                    if len({s for s, _ in combo}) != size:
                        continue
                    if not _voicing_is_playable(list(combo)):
                        continue
                    full: list[tuple[int, int] | None] = [None] * n
                    used_strings: set[int] = set()
                    for idx, sf in zip(kept_list, combo):
                        full[idx] = sf
                        used_strings.add(sf[0])
                    ok = True
                    for i in range(n):
                        if full[i] is not None:
                            continue
                        placed = False
                        for s, f in cands[i]:
                            if s in used_strings:
                                continue
                            trial = [sf for sf in full if sf is not None] + [(s, f)]
                            if _voicing_is_playable(trial):
                                full[i] = (s, f)
                                used_strings.add(s)
                                placed = True
                                break
                        if not placed:
                            ok = False
                            break
                    if not ok or any(sf is None for sf in full):
                        continue
                    voicing = [sf for sf in full if sf is not None]  # type: ignore[misc]
                    if len(voicing) != n or not _voicing_is_playable(voicing):
                        continue
                    drop_penalty = 1.8 * (n - size)
                    emit = sum(_string_emit_cost(s, f) for s, f in voicing) + drop_penalty
                    style, bonus = _match_known_shape(voicing)
                    result.append((voicing, emit - bonus, style))
            if result:
                break

        if not result:
            # Absolute fallback: greedy unique-string placement by amplitude.
            full_list: list[tuple[int, int]] = [(1, 0)] * n
            used: set[int] = set()
            for i in amp_order:
                placed = False
                for s, f in cands[i]:
                    if s in used:
                        continue
                    full_list[i] = (s, f)
                    used.add(s)
                    placed = True
                    break
                if placed:
                    continue
                for s in range(1, 7):
                    if s in used:
                        continue
                    fret = midis[i] - OPEN_STRING_MIDI[s]
                    if 0 <= fret <= MAX_TAB_FRET:
                        full_list[i] = (s, fret)
                        used.add(s)
                        placed = True
                        break
                if not placed:
                    for s in range(1, 7):
                        if s not in used:
                            full_list[i] = (s, 0)
                            used.add(s)
                            break
            # Guarantee unique strings
            claimed: dict[int, int] = {}
            for i, (s, f) in enumerate(full_list):
                if s not in claimed:
                    claimed[s] = i
                    continue
                for ns in range(1, 7):
                    if ns in claimed:
                        continue
                    fret = midis[i] - OPEN_STRING_MIDI[ns]
                    if 0 <= fret <= MAX_TAB_FRET:
                        full_list[i] = (ns, fret)
                        claimed[ns] = i
                        break
            emit = sum(_string_emit_cost(s, f) for s, f in full_list) + 10.0
            result = [(full_list, emit, _STYLE_OTHER)]

    result.sort(key=lambda x: x[1])
    return _diversify_voicings(result, max_voicings)


def _position_center(voicing: list[tuple[int, int]]) -> float:
    """Median fret of fretted notes; 0.0 for an all-open voicing."""
    fretted = [f for _, f in voicing if f > 0]
    if not fretted:
        return 0.0
    return float(np.median(fretted))


def _transition_cost(
    v1: list[tuple[int, int]],
    v2: list[tuple[int, int]],
    time_gap_ms: float,
    style1: str,
    style2: str,
) -> float:
    """Cost of moving from voicing v1 to voicing v2 within time_gap_ms.

    Combines:
    - Piecewise movement cost based on position-center shift
    - Time-budget feasibility (steep penalty for biomechanically impossible jumps)
    - Style continuity bonus for power/barre/open sequences
    - Same-string / adjacent-string preference for melody
    """
    c1    = _position_center(v1)
    c2    = _position_center(v2)
    shift = abs(c2 - c1)

    # Piecewise movement cost — steeper than before so tab stays local
    if shift <= 2:
        move_cost = shift * 0.7
    elif shift <= 5:
        move_cost = 1.4 + (shift - 2) * 1.8
    elif shift <= 9:
        move_cost = 6.8 + (shift - 5) * 3.0
    else:
        move_cost = 18.8 + (shift - 9) * 5.0

    # Time-budget feasibility — never fully disable continuity. Even with a
    # full beat of time, large neck jumps are unidiomatic for human tab.
    if time_gap_ms < 80:
        comfortable, max_possible = 2.0, 3.0
    elif time_gap_ms < 200:
        comfortable, max_possible = 4.0, 6.0
    elif time_gap_ms < 400:
        comfortable, max_possible = 7.0, 10.0
    elif time_gap_ms < 900:
        comfortable, max_possible = 9.0, 12.0
    else:
        # Ample time: still prefer staying nearby (soft floor)
        comfortable, max_possible = 10.0, 14.0

    if shift > max_possible:
        move_cost += (shift - max_possible) * 10.0
    elif shift > comfortable:
        move_cost += (shift - comfortable) * 2.8

    # Soft continuity floor: large jumps always cost something
    if shift >= 8:
        move_cost += 1.5

    # Style continuity bonus
    if style1 == style2 and style1 in (_STYLE_POWER, _STYLE_BARRE):
        move_cost -= 0.6
    elif style1 == style2 == _STYLE_OPEN:
        move_cost -= 0.7
    elif style1 == style2 == _STYLE_OCTAVE:
        move_cost -= 0.3

    # Single-note melody: prefer same/adjacent string and low fret continuity
    if len(v1) == 1 and len(v2) == 1:
        s1, f1 = v1[0]
        s2, f2 = v2[0]
        string_jump = abs(s2 - s1)
        fret_diff = abs(f2 - f1)
        if s1 == s2:
            move_cost -= 0.85  # stay on string — human default for scales
            if 1 <= fret_diff <= 5 and 40 <= time_gap_ms <= 280:
                move_cost -= 0.35  # natural same-string legato / stepwise
            elif fret_diff > 7 and time_gap_ms < 250:
                move_cost += 4.0  # implausible rapid slide
        elif string_jump == 1:
            move_cost -= 0.35  # adjacent string is still idiomatic
            if fret_diff >= 5:
                move_cost += 0.6
        else:
            move_cost += 0.45 * string_jump  # leaping across the neck
            if fret_diff >= 4 and time_gap_ms < 350:
                move_cost += 1.2

    return max(0.0, move_cost)


_REVERSAL_JUMP_THRESHOLD = 8  # fret jump that triggers reversal detection


def _smooth_reversals(
    slots: list[list[tuple[int, object]]],
    best: list[tuple[list[tuple[int, int]], float, str]],
    all_voicings: list[list[tuple[list[tuple[int, int]], float, str]]],
) -> list[tuple[list[tuple[int, int]], float, str]]:
    """Post-DP pass: detect and smooth A→B→C position reversals.

    A reversal is when the hand jumps far in one direction then immediately
    jumps far back, producing a physically implausible zigzag.  For each
    middle slot that is isolated far from both its neighbours we try to find a
    voicing closer to their midpoint (within a 4-point emission-cost budget).
    """
    if len(best) < 3:
        return best

    result = list(best)

    for i in range(1, len(result) - 1):
        c_prev = _position_center(result[i - 1][0])
        c_curr = _position_center(result[i][0])
        c_next = _position_center(result[i + 1][0])

        jump_in  = abs(c_curr - c_prev)
        jump_out = abs(c_next - c_curr)
        direct   = abs(c_next - c_prev)

        if not (jump_in >= _REVERSAL_JUMP_THRESHOLD
                and jump_out >= _REVERSAL_JUMP_THRESHOLD
                and direct <= 5):
            continue

        target    = (c_prev + c_next) / 2.0
        curr_dist = abs(c_curr - target)
        best_alt  = result[i]
        best_dist = curr_dist

        for v, emit, style in all_voicings[i]:
            dist = abs(_position_center(v) - target)
            if dist < best_dist and emit <= result[i][1] + 4.0:
                best_alt  = (v, emit, style)
                best_dist = dist

        result[i] = best_alt

    return result


def _sanitize_low_position_melody(events: list, pairs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Rewrite isolated high frets in otherwise low-position single-note phrases."""
    if len(pairs) < 2:
        return pairs

    onset_counts: dict[int, int] = {}
    for event in events:
        key = int(round(float(event[0]) * 1000.0))
        onset_counts[key] = onset_counts.get(key, 0) + 1

    out = list(pairs)
    for i, (string, fret) in enumerate(list(out)):
        if fret < 5:
            continue

        onset_key = int(round(float(events[i][0]) * 1000.0))
        if onset_counts.get(onset_key, 0) > 1:
            continue

        open_candidates = [(s, f) for s, f in _candidates(_event_midi(events[i]), max_fret=0)]
        if open_candidates:
            out[i] = open_candidates[0]
            continue

        neighbor_frets = []
        if i > 0:
            neighbor_frets.append(out[i - 1][1])
        if i + 1 < len(out):
            neighbor_frets.append(out[i + 1][1])
        if neighbor_frets and all(f >= 4 for f in neighbor_frets):
            continue

        # Ban spike-and-return shapes like 4 -> 14 -> 4 on the same string.
        same_string_spike = (
            0 < i < len(out) - 1
            and out[i - 1][0] == string
            and out[i + 1][0] == string
            and out[i - 1][1] <= 4
            and out[i + 1][1] <= 4
            and fret - max(out[i - 1][1], out[i + 1][1]) >= 6
        )

        if fret < 8 and not same_string_spike and neighbor_frets and all(f >= 4 for f in neighbor_frets):
            continue

        neighbor_center = float(np.median(neighbor_frets)) if neighbor_frets else 0.0
        preferred = out[i - 1][0] if i > 0 else (out[i + 1][0] if i + 1 < len(out) else string)
        low = _low_position_fingering_for_melody(
            _event_midi(events[i]),
            preferred_string=preferred,
            neighbor_center=neighbor_center,
        )
        if low is not None:
            out[i] = low

    return out


def dp_chord_aware(events: list, bpm: float = 120.0) -> list[tuple[int, int]]:
    """Chord-aware Viterbi DP for string/fret assignment.

    Unlike dp_string_fret() which processes notes sequentially, this function
    groups simultaneous notes (chord groups from group_chords()) into time slots
    and finds the optimal *voicing* for each slot jointly — ensuring chord tones
    land on a physically consistent hand position and that transitions between
    positions respect biomechanical speed constraints.
    """
    if not events:
        return []

    # Use a tight window — group_chords has already unified chord notes to the
    # same median onset. We only need enough tolerance for floating-point
    # representation of that median (a few ms at most).
    # A wider window risks collapsing sequential melody notes into one slot.
    slots    = _build_time_slots(events, chord_window_s=0.005)
    n_slots  = len(slots)

    all_voicings: list[list[tuple[list[tuple[int, int]], float, str]]] = []
    for slot in slots:
        all_voicings.append(_enumerate_voicings([ev for _, ev in slot]))

    INF  = 1e9
    dp   = [[INF] * len(vs) for vs in all_voicings]
    prev = [[-1]   * len(vs) for vs in all_voicings]

    # Initialise first slot
    for j, (_v, emit, _style) in enumerate(all_voicings[0]):
        dp[0][j] = emit

    # Forward pass
    for i in range(1, n_slots):
        t1     = float(slots[i - 1][0][1][0])
        t2     = float(slots[i][0][1][0])
        gap_ms = max(0.0, (t2 - t1) * 1000.0)

        for j, (v2, emit2, style2) in enumerate(all_voicings[i]):
            for k, (v1, _e1, style1) in enumerate(all_voicings[i - 1]):
                if dp[i - 1][k] >= INF:
                    continue
                trans = _transition_cost(v1, v2, gap_ms, style1, style2)
                cost  = dp[i - 1][k] + emit2 + trans
                if cost < dp[i][j]:
                    dp[i][j]   = cost
                    prev[i][j] = k

    # Backtrack
    best_path: list[tuple[list[tuple[int, int]], float, str]] = [None] * n_slots  # type: ignore[list-item]
    last_j        = int(np.argmin(dp[-1]))
    best_path[-1] = all_voicings[-1][last_j]
    for i in range(n_slots - 2, -1, -1):
        last_j        = prev[i + 1][last_j]
        best_path[i]  = all_voicings[i][last_j]

    # Post-DP reversal smoothing
    best_path = _smooth_reversals(slots, best_path, all_voicings)

    # Map voicing assignments back to original event indices
    result_map: dict[int, tuple[int, int]] = {}
    for slot, (voicing, _emit, _style) in zip(slots, best_path):
        for note_pos, (orig_idx, ev) in enumerate(slot):
            if note_pos < len(voicing):
                result_map[orig_idx] = voicing[note_pos]
            else:
                cands = _candidate_set_for_event(ev)
                result_map[orig_idx] = cands[0] if cands else (1, 0)

    pairs = [result_map.get(i, (1, 0)) for i in range(len(events))]
    pairs = _sanitize_low_position_melody(events, pairs)
    # Hard block illegal written-tab frets inside DP result (event MIDI sync is done by caller)
    for i, (string, fret) in enumerate(pairs):
        if fret <= MAX_TAB_FRET and 1 <= string <= 6:
            continue
        neighbor_frets = []
        if i > 0 and pairs[i - 1][1] <= MAX_TAB_FRET:
            neighbor_frets.append(pairs[i - 1][1])
        if i + 1 < len(pairs) and pairs[i + 1][1] <= MAX_TAB_FRET:
            neighbor_frets.append(pairs[i + 1][1])
        neighbor_center = float(np.median(neighbor_frets)) if neighbor_frets else None
        preferred = pairs[i - 1][0] if i > 0 else string
        new_s, new_f, _eff = _pick_fingering_under_cap(
            _event_midi(events[i]),
            preferred_string=preferred,
            neighbor_center=neighbor_center,
        )
        pairs[i] = (new_s, new_f)
    return pairs


# ── Technique detection ───────────────────────────────────────────────────────

def _bins_to_semitones(pitch_bends) -> np.ndarray:
    return np.asarray(pitch_bends, dtype=float) / 3.0


def _is_monotonic_glide(bends_st: np.ndarray, min_semitones: float = 2.0) -> bool:
    """True when pitch moves mostly in one direction by at least *min_semitones*."""
    if len(bends_st) < 10:
        return False
    net = float(bends_st[-1] - bends_st[0])
    if abs(net) < min_semitones:
        return False
    diffs = np.diff(bends_st)
    if net > 0:
        same_dir = int(np.sum(diffs > 0.06))
    else:
        same_dir = int(np.sum(diffs < -0.06))
    return same_dir / max(len(diffs), 1) >= 0.78


def _classify_bends(pitch_bends, duration_ms: float | None = None) -> tuple[Optional[str], Optional[float]]:
    """Infer bend / vibrato from per-note pitch-bend bins.

  In-note slides are *not* tagged here — basic-pitch pitch jitter causes
  false positives. Slides are detected only between consecutive notes.
    """
    if pitch_bends is None or len(pitch_bends) < 5:
        return None, None

    bends_st = _bins_to_semitones(pitch_bends)

    start_val = float(np.mean(bends_st[: max(1, len(bends_st) // 4)]))
    end_val   = float(np.mean(bends_st[-max(1, len(bends_st) // 4) :]))
    net_rise  = end_val - start_val
    std       = float(np.std(bends_st))

    centered       = bends_st - float(np.mean(bends_st))
    zero_crossings = int(np.sum(np.diff(np.sign(centered + 1e-9)) != 0))

    # Vibrato: oscillation around centre, minimal net drift
    peak_to_peak = float(np.max(bends_st) - np.min(bends_st))
    if (
        (duration_ms is None or duration_ms >= 220.0)
        and std > 0.35
        and peak_to_peak >= 1.2
        and zero_crossings >= 5
        and abs(net_rise) < 0.40
    ):
        return "vibrato", None

    # Bend: clear rise then hold (tail is flat). Require stronger evidence than
    # Basic Pitch pitch jitter typically produces on sustained fretted notes.
    if duration_ms is not None and duration_ms < 140.0:
        return None, None
    tail = bends_st[-max(3, len(bends_st) // 3):]
    tail_std = float(np.std(tail))
    if abs(net_rise) >= 0.75 and tail_std < 0.16 and peak_to_peak >= 0.7:
        return "bend", round(abs(net_rise), 1)

    return None, None


def _reconcile_to_string(n1: TabNoteOut, n2: TabNoteOut) -> bool:
    """Snap n2 onto n1's string if the pitch fits. Returns True on success."""
    expected_fret = n2.midi - OPEN_STRING_MIDI.get(n1.string, n1.fret)
    if 0 <= expected_fret <= MAX_TAB_FRET:
        n2.string = n1.string
        n2.fret = expected_fret
        return True
    return False


def _reconcile_to_string_if_group_stays_playable(
    n1: TabNoteOut,
    n2: TabNoteOut,
    target_group: list[TabNoteOut],
) -> bool:
    """Snap n2 to n1's string only when its attack group remains human."""
    original = (n2.string, n2.fret)
    if not _reconcile_to_string(n1, n2):
        return False
    if len(target_group) < 2 or _is_playable_tab_chord(target_group):
        return True
    n2.string, n2.fret = original
    return False


def _attack_groups(notes: list[TabNoteOut], window_ms: float = 40.0) -> list[list[TabNoteOut]]:
    """Cluster notes that share the same pick/strum attack."""
    if not notes:
        return []
    ordered = sorted(notes, key=lambda n: (n.onsetMs, n.midi))
    groups: list[list[TabNoteOut]] = [[ordered[0]]]
    for n in ordered[1:]:
        if n.onsetMs - groups[-1][0].onsetMs <= window_ms:
            groups[-1].append(n)
        else:
            groups.append([n])
    return groups


def _group_rep(group: list[TabNoteOut]) -> TabNoteOut:
    """Loudest note in an attack cluster — represents that strum for legato logic."""
    return max(group, key=lambda n: n.confidence)


def _is_slide_pair(
    n1: TabNoteOut,
    n2: TabNoteOut,
    gap_ms: float,
    sec_per_beat: float,
    n1_pitch_bends=None,
) -> bool:
    """Two-note slide: already on the same string, connected legato, fret changes.

    Normal eighth notes at 120 BPM are ~250ms apart — those are separate picks,
    not slides. Only tag tight legato connections with clear pitch motion.
    """
    if n1.string != n2.string:
        return False

    interval = abs(n2.midi - n1.midi)
    fret_change = abs(n2.fret - n1.fret)
    if interval < 1 or fret_change < 1 or fret_change != interval:
        return False

    # Slides beyond 7 frets without clear glide evidence are usually DP noise.
    if fret_change > 7:
        return False

    n1_dur_ms = n1.durationBeats * sec_per_beat * 1000
    overlap_ms = (n1.onsetMs + n1_dur_ms) - n2.onsetMs
    eighth_ms = sec_per_beat * 500.0  # half beat in ms

    has_glide = False
    if n1_pitch_bends is not None:
        bends_st = _bins_to_semitones(n1_pitch_bends)
        has_glide = _is_monotonic_glide(bends_st, min_semitones=max(1.5, interval * 0.55))

    # Strong sustain overlap: next note starts while previous is still ringing.
    if overlap_ms > 45 and gap_ms <= eighth_ms * 0.95:
        if has_glide or overlap_ms > 80 or (gap_ms <= 220 and fret_change <= 4):
            return True

    # Anything near a normal picked subdivision without overlap/glide is not a slide.
    if gap_ms >= min(160.0, eighth_ms * 0.55):
        return False

    if gap_ms <= 100 and has_glide:
        return True

    # Tight shift slide only with very short gap and small fret change
    if 15 <= gap_ms <= 70 and fret_change <= 5:
        return True

    return False


def detect_techniques_pitch_based(
    notes: list[TabNoteOut],
    bpm: float,
    pitch_bends_by_id: Optional[dict[str, object]] = None,
) -> None:
    """Detect hammer-on, pull-off, slide between successive *attacks* (not chord tones)."""
    sec_per_beat = 60.0 / bpm
    groups = _attack_groups(notes)
    if len(groups) < 2:
        return

    reps = [_group_rep(g) for g in groups]
    eighth_ms = sec_per_beat * 500.0

    for i in range(len(reps) - 1):
        n1 = reps[i]
        n2 = reps[i + 1]

        if n1.technique in ("bend", "vibrato"):
            continue

        gap_ms = n2.onsetMs - n1.onsetMs
        interval = n2.midi - n1.midi
        abs_iv = abs(interval)

        # Hammer / pull: tight legato, small interval. Cap well below an eighth
        # so normal picked melody is not mis-tagged.
        hammer_gap_max = min(110.0, eighth_ms * 0.40)
        if gap_ms <= hammer_gap_max and 1 <= abs_iv <= 3:
            if n1.string == n2.string or _reconcile_to_string_if_group_stays_playable(n1, n2, groups[i + 1]):
                n1.technique = "hammer" if interval > 0 else "pull"
            continue

        n1_bends = pitch_bends_by_id.get(n1.id) if pitch_bends_by_id else None
        if n1.string != n2.string:
            _reconcile_to_string_if_group_stays_playable(n1, n2, groups[i + 1])
        if _is_slide_pair(n1, n2, gap_ms, sec_per_beat, n1_bends):
            n1.technique = "slide"


# ── Timing helpers ────────────────────────────────────────────────────────────

def quantize_onset(
    total_beats: float,
    beats_per_measure: int = 4,
    grid: float = ONSET_GRID,
) -> tuple[int, float]:
    """Snap absolute beat position to the 16th-note grid, return (measure, beat)."""
    quantized = round(total_beats / grid) * grid
    measure   = int(quantized // beats_per_measure) + 1
    beat      = (quantized % beats_per_measure) + 1.0
    return measure, beat


def quantize_duration(dur: float) -> float:
    return min(RHYTHMIC_VALUES, key=lambda v: abs(v - dur))


def events_to_tab(
    note_events,
    string_fret_pairs: list[tuple[int, int]],
    techniques: list[tuple[Optional[str], Optional[float]]],
    bpm: float,
    beats_per_measure: int = 4,
) -> list[TabNoteOut]:
    sec_per_beat = 60.0 / bpm
    out: list[TabNoteOut] = []
    events_sorted = sorted(note_events, key=lambda e: float(e[0]))

    for idx, ev in enumerate(events_sorted):
        start_s = float(ev[0])
        end_s   = float(ev[1])
        pitch   = int(round(float(ev[2])))
        amp     = float(ev[3]) if len(ev) > 3 else 0.0

        string, fret      = string_fret_pairs[idx]
        # Tab midi must match the written fingering (cap may have remapped)
        if 1 <= string <= 6 and 0 <= fret <= MAX_TAB_FRET:
            pitch = _midi_for_fingering(string, fret)
        total_beats       = start_s / sec_per_beat
        measure, beat     = quantize_onset(total_beats, beats_per_measure)
        dur_raw           = max(0.125, (end_s - start_s) / sec_per_beat)
        dur_beats         = quantize_duration(dur_raw)
        tech, bend_st     = techniques[idx]

        out.append(TabNoteOut(
            id=f"t{idx}",
            measure=measure,
            beat=round(beat, 3),
            string=string,
            fret=fret,
            durationBeats=dur_beats,
            midi=pitch,
            onsetMs=int(round(start_s * 1000)),
            confidence=round(amp, 3),
            technique=tech,
            bendSemitones=bend_st,
        ))

    return out


# ── Expected-tab corrector (coach / practice prior) ───────────────────────────

def _expected_note_midi(note: dict) -> int | None:
    if note.get("midi") is not None:
        return int(round(float(note["midi"])))
    string = note.get("string")
    fret = note.get("fret")
    if string is None or fret is None:
        return None
    open_midi = OPEN_STRING_MIDI.get(int(string))
    if open_midi is None:
        return None
    return int(open_midi) + int(fret)


def _expected_note_onset_ms(
    note: dict,
    bpm: float,
    beats_per_measure: int,
) -> int | None:
    if note.get("onsetMs") is not None:
        return int(round(float(note["onsetMs"])))
    measure = note.get("measure")
    beat = note.get("beat")
    if measure is None or beat is None:
        return None
    sec_per_beat = 60.0 / max(bpm, 40.0)
    total_beats = (int(measure) - 1) * beats_per_measure + (float(beat) - 1.0)
    return int(round(total_beats * sec_per_beat * 1000.0))


def _normalize_expected_notes(
    expected_notes: list[dict] | None,
    bpm: float,
    beats_per_measure: int,
) -> list[dict]:
    if not expected_notes:
        return []
    normalized: list[dict] = []
    for note in expected_notes:
        midi = _expected_note_midi(note)
        onset_ms = _expected_note_onset_ms(note, bpm, beats_per_measure)
        if midi is None or onset_ms is None:
            continue
        entry = {
            "onsetMs": onset_ms,
            "midi": midi,
            "string": note.get("string"),
            "fret": note.get("fret"),
            "amplitude": float(note.get("confidence") or note.get("amplitude") or 0.8),
        }
        if entry["string"] is not None:
            entry["string"] = int(entry["string"])
        if entry["fret"] is not None:
            entry["fret"] = int(entry["fret"])
        normalized.append(entry)
    return sorted(normalized, key=lambda n: (n["onsetMs"], n["midi"]))


def apply_expected_tab_prior(
    events: list,
    expected_notes: list[dict] | None,
    bpm: float,
    beats_per_measure: int = 4,
    window_ms: float | None = None,
) -> tuple[list, dict]:
    """Constrain detections toward a known tab without inventing missing notes.

    - Octave-correct detections that match an expected pitch ±12.
    - Drop phantom extras with no nearby expected pitch.
    - Keep clear wrong notes near an expected slot (coach wrong_note fuel).
    - Never synthesize events for unmatched expected notes (coach must see misses).
    """
    expected_notes_normalized = _normalize_expected_notes(expected_notes, bpm, beats_per_measure)
    expected_by_pitch_slot: dict[tuple[int, int], dict] = {}
    for exp in expected_notes_normalized:
        expected_by_pitch_slot.setdefault((exp["onsetMs"], exp["midi"]), exp)
    expected = sorted(expected_by_pitch_slot.values(), key=lambda n: (n["onsetMs"], n["midi"]))
    stats = {
        "expectedNotes": len(expected_notes_normalized),
        "expectedPitchSlots": len(expected),
        "matchedEvents": 0,
        "octaveCorrectedEvents": 0,
        "droppedPhantoms": 0,
        "keptWrongNotes": 0,
        "applied": bool(expected),
    }
    if not expected or not events:
        return events, stats

    if window_ms is None:
        window_ms = max(90.0, (60_000.0 / max(bpm, 40.0)) * 0.45)

    used_expected: set[int] = set()
    kept: list = []

    for event in sorted(events, key=lambda e: (float(e[0]), -_event_amp(e))):
        onset_ms = int(round(float(event[0]) * 1000))
        midi = _event_midi(event)
        amp = _event_amp(event)

        nearby = [
            (i, exp)
            for i, exp in enumerate(expected)
            if i not in used_expected and abs(exp["onsetMs"] - onset_ms) <= window_ms
        ]
        if not nearby:
            # No expected slot nearby — phantom unless it's a strong isolated note
            # far from the phrase; still drop weak extras.
            if amp < 0.55:
                stats["droppedPhantoms"] += 1
                continue
            # Strong note with no prior: keep (possible improvisation / wrong phrase)
            kept.append(event)
            stats["keptWrongNotes"] += 1
            continue

        exact = [(i, exp) for i, exp in nearby if exp["midi"] == midi]
        octave = [
            (i, exp) for i, exp in nearby
            if abs(exp["midi"] - midi) == 12
        ]

        if exact:
            i, exp = min(exact, key=lambda pair: (abs(pair[1]["onsetMs"] - onset_ms), -amp))
            used_expected.add(i)
            stats["matchedEvents"] += 1
            # Preserve the detector event; exact MIDI equality is the match.
            kept.append(event)
            continue

        if octave:
            i, exp = min(octave, key=lambda pair: (abs(pair[1]["onsetMs"] - onset_ms), -amp))
            used_expected.add(i)
            stats["octaveCorrectedEvents"] += 1
            stats["matchedEvents"] += 1
            kept.append(_with_event_midi(event, exp["midi"]))
            continue

        # Nearby expected slot(s) but wrong pitch — keep as wrong_note evidence
        # if amplitude is competitive; otherwise treat as phantom harmonic.
        nearest_amp = max(exp["amplitude"] for _, exp in nearby)
        if amp >= 0.35 and amp >= nearest_amp * 0.35:
            kept.append(event)
            stats["keptWrongNotes"] += 1
        else:
            stats["droppedPhantoms"] += 1

    return sorted(kept, key=lambda e: float(e[0])), stats


def prefer_expected_fingerings(
    notes: list[TabNoteOut],
    expected_notes: list[dict] | None,
    bpm: float,
    beats_per_measure: int = 4,
    window_ms: float | None = None,
) -> list[TabNoteOut]:
    """When MIDI matches expected, prefer the expected string/fret fingering."""
    expected = _normalize_expected_notes(expected_notes, bpm, beats_per_measure)
    if not expected or not notes:
        return notes

    if window_ms is None:
        window_ms = max(90.0, (60_000.0 / max(bpm, 40.0)) * 0.45)

    used: set[int] = set()
    for note in notes:
        candidates = [
            (i, exp)
            for i, exp in enumerate(expected)
            if i not in used
            and abs(exp["onsetMs"] - note.onsetMs) <= window_ms
            and abs(exp["midi"] - note.midi) <= 1
            and exp.get("string") is not None
            and exp.get("fret") is not None
        ]
        if not candidates:
            continue
        i, exp = min(candidates, key=lambda pair: abs(pair[1]["onsetMs"] - note.onsetMs))
        used.add(i)
        note.string = int(exp["string"])
        note.fret = int(exp["fret"])
        note.midi = int(exp["midi"])
    return notes


def sync_raw_events_to_tab_notes(
    events: list,
    tab_notes: list[TabNoteOut],
    window_ms: float = 45.0,
) -> list:
    """Keep rawEvents in lockstep with surviving tab notes (onset + MIDI)."""
    if not tab_notes:
        return []
    if not events:
        return []

    remaining = list(events)
    synced: list = []
    for note in sorted(tab_notes, key=lambda n: (n.onsetMs, n.midi)):
        best_i = -1
        best_score = 1e18
        for i, event in enumerate(remaining):
            onset_ms = int(round(float(event[0]) * 1000))
            midi = _event_midi(event)
            dt = abs(onset_ms - note.onsetMs)
            if dt > window_ms:
                continue
            dm = abs(midi - note.midi)
            if dm > 1 and dm not in (11, 12, 13):
                continue
            score = dt + dm * 5.0
            if score < best_score:
                best_score = score
                best_i = i
        if best_i < 0:
            # Reconstruct a minimal event so coach still sees the tab pitch
            onset_s = note.onsetMs / 1000.0
            end_s = onset_s + max(0.08, note.durationBeats * 0.25)
            synced.append((onset_s, end_s, float(note.midi), float(note.confidence)))
            continue
        event = remaining.pop(best_i)
        if _event_midi(event) != note.midi:
            event = _with_event_midi(event, note.midi)
        synced.append(event)
    return synced


def events_to_raw_dicts(events: list) -> list[dict]:
    return [
        {
            "onsetMs":   int(round(float(e[0]) * 1000)),
            "endMs":     int(round(float(e[1]) * 1000)),
            "midi":      int(round(float(e[2]))),
            "amplitude": round(float(e[3]), 3) if len(e) > 3 else 0.0,
        }
        for e in events
    ]


# ── ONNX model (load once — reloading each request was the slowdown) ─────────

_model_instance = None


def _get_model():
    """Return a cached basic-pitch Model; loading ONNX takes several seconds."""
    global _model_instance
    if _model_instance is None:
        from basic_pitch.inference import Model
        _model_instance = Model(_onnx_model_path())
    return _model_instance


def preload_model() -> None:
    """Warm the ONNX session at server startup."""
    _get_model()


def _onnx_model_path():
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    return build_icassp_2022_model_path(FilenameSuffix.onnx)


# ── Main entry point ──────────────────────────────────────────────────────────

def transcribe_file(
    path: str,
    bpm: float = 120.0,
    beats_per_measure: int = 4,
    onset_threshold: float = 0.38,
    frame_threshold: float = 0.28,
    min_note_len_ms: float = 0.0,
    min_amplitude_ratio: float = 0.22,
    preprocess_audio: bool = False,
    expected_notes: list[dict] | None = None,
    quality_mode: str = "fast",
    sensitive_compression: bool = False,
) -> dict:
    """Run basic-pitch on *path* and return tab notes + raw events.

    Args:
        onset_threshold: lower = more notes detected (default 0.5 in basic-pitch).
        frame_threshold: lower = longer sustained notes kept.
        min_note_len_ms: minimum note duration in ms; <= 0 uses a BPM-scaled default.
        expected_notes: optional known-tab prior for coach/practice takes.
    """
    import soundfile as sf
    from basic_pitch.inference import predict

    transcription_started = time.perf_counter()
    quality_mode = "accurate" if quality_mode == "accurate" else "fast"
    beats_per_measure = int(max(2, min(12, beats_per_measure)))
    detection_path = path
    sensitive_detection_path = path
    preprocess_stats = {"enabled": False}

    try:
        info = sf.info(path)
        duration_s = info.duration
    except Exception:
        duration_s = 0.0

    if preprocess_audio:
        detection_path, preprocess_stats = preprocess_audio_for_basic_pitch(path)

    effective_min_note_len_ms = (
        max(45.0, (60000.0 / max(bpm, 40.0)) * 0.15)
        if min_note_len_ms <= 0
        else min_note_len_ms
    )

    try:
        model_output, midi_data, note_events = predict(
            detection_path,
            _get_model(),
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=int(effective_min_note_len_ms),
            minimum_frequency=80.0,   # guitar low E
            maximum_frequency=1320.0, # guitar high e, 20th fret
            multiple_pitch_bends=True,
        )
        accurate_trim_ms = (
            float(preprocess_stats.get("trimStartMs") or 0.0)
            if quality_mode == "accurate"
            else 0.0
        )
        primary_events = [
            _shift_event_time(event, accurate_trim_ms)
            for event in note_events
        ]
        primary_filtered = filter_events(
            primary_events,
            min_amplitude_ratio=min_amplitude_ratio,
        )
        sensitive_filtered: list = []
        merge_stats = {
            "rescuedEvents": 0,
            "rejectedSensitiveDuplicates": 0,
            "rejectedSensitiveArtifacts": 0,
        }
        if quality_mode == "accurate":
            if sensitive_compression:
                sensitive_detection_path, _ = preprocess_audio_for_basic_pitch(path, compress=True)
            else:
                sensitive_detection_path = detection_path
            _, _, sensitive_note_events = predict(
                sensitive_detection_path,
                _get_model(),
                onset_threshold=0.24,
                frame_threshold=0.18,
                minimum_note_length=30,
                minimum_frequency=80.0,
                maximum_frequency=1320.0,
                multiple_pitch_bends=True,
            )
            sensitive_events = [
                _shift_event_time(event, accurate_trim_ms)
                for event in sensitive_note_events
            ]
            sensitive_filtered = filter_events(
                sensitive_events,
                min_amplitude_ratio=0.08,
                min_absolute_amplitude=0.08,
            )
            events_filtered, merge_stats = merge_detection_passes(
                primary_filtered,
                sensitive_filtered,
            )
        else:
            events_filtered = primary_filtered
    finally:
        if detection_path != path:
            try:
                os.remove(detection_path)
            except OSError:
                pass
        if sensitive_detection_path not in (path, detection_path):
            try:
                os.remove(sensitive_detection_path)
            except OSError:
                pass

    events_collapsed, collapse_stats = collapse_false_polyphony(events_filtered)

    # ── 1. Chord grouping (before DP so chords share one onset) ──────────────
    chord_ms = chord_window_ms_for_bpm(bpm)
    events_grouped = group_chords(events_collapsed, window_ms=chord_ms)
    events_grouped, chord_stats = simplify_unplayable_chords(events_grouped)
    detector_evidence_events = list(events_grouped)
    if quality_mode == "accurate":
        tab_cap_stats = {"clampedEvents": 0, "octaveDroppedEvents": 0}
    else:
        events_grouped, tab_cap_stats = clamp_events_to_max_tab_fret(events_grouped)

    # ── 1b. Expected-tab prior (coach): rewrite/drop events before DP ─────────
    expected_stats = {
        "expectedNotes": 0,
        "expectedPitchSlots": 0,
        "matchedEvents": 0,
        "octaveCorrectedEvents": 0,
        "droppedPhantoms": 0,
        "keptWrongNotes": 0,
        "applied": False,
    }
    if expected_notes:
        events_grouped, expected_stats = apply_expected_tab_prior(
            events_grouped,
            expected_notes,
            bpm=bpm,
            beats_per_measure=beats_per_measure,
        )
        # Re-clamp after prior in case expected notes referenced high frets
        events_grouped, post_prior_cap = clamp_events_to_max_tab_fret(events_grouped)
        tab_cap_stats = {
            "clampedEvents": tab_cap_stats["clampedEvents"] + post_prior_cap["clampedEvents"],
            "octaveDroppedEvents": (
                tab_cap_stats["octaveDroppedEvents"] + post_prior_cap["octaveDroppedEvents"]
            ),
        }

    # ── 2. String/fret DP (chord-aware group Viterbi) ────────────────────────
    string_fret_pairs = dp_chord_aware(events_grouped, bpm=bpm)
    if quality_mode == "accurate":
        register_stats = {"remappedSlots": 0, "octaveDroppedEvents": 0}
        string_fret_pairs, events_grouped, remap_stats = remap_fingerings_preserve_midi(
            string_fret_pairs,
            events_grouped,
        )
    else:
        string_fret_pairs, events_grouped, register_stats = _suppress_sudden_high_register_voicings(
            string_fret_pairs,
            events_grouped,
        )
        string_fret_pairs, events_grouped, remap_stats = clamp_fingerings_to_max_tab_fret(
            string_fret_pairs,
            events_grouped,
        )

    # ── 3. Bend / vibrato from pitch-bend bins ────────────────────────────────
    techniques: list[tuple[Optional[str], Optional[float]]] = []
    for ev in events_grouped:
        pitch_bends = ev[4] if len(ev) > 4 else None
        duration_ms = max(0.0, (float(ev[1]) - float(ev[0])) * 1000.0)
        techniques.append(_classify_bends(pitch_bends, duration_ms=duration_ms))

    # ── 4. Build tab notes ────────────────────────────────────────────────────
    tab_notes = events_to_tab(
        events_grouped,
        string_fret_pairs,
        techniques,
        bpm=bpm,
        beats_per_measure=beats_per_measure,
    )
    layout_source_midi = {note.id: note.midi for note in tab_notes}
    merge_tab_beats(tab_notes, window_ms=chord_ms)
    pitch_bends_by_id = {
        note.id: (ev[4] if len(ev) > 4 else None)
        for note, ev in zip(tab_notes, events_grouped)
    }
    # Beat-merge can place independently-cleaned notes onto the same grid
    # slot — re-run playability on same-(measure,beat) clusters after merge.
    tab_notes, tab_chord_stats = simplify_unplayable_tab_chords(tab_notes)
    merge_tab_beats(tab_notes, window_ms=chord_ms)
    tab_notes, tab_chord_stats2 = simplify_unplayable_tab_chords(tab_notes)
    # Tile durations across each measure so display rests/stems are clean
    gridify_measure_rhythm(tab_notes, beats_per_measure=beats_per_measure)
    tab_chord_stats = {
        "simplifiedTabClusters": (
            tab_chord_stats["simplifiedTabClusters"] + tab_chord_stats2["simplifiedTabClusters"]
        ),
        "removedTabNotes": tab_chord_stats["removedTabNotes"] + tab_chord_stats2["removedTabNotes"],
        "dominantTabSingleClusters": (
            tab_chord_stats["dominantTabSingleClusters"]
            + tab_chord_stats2["dominantTabSingleClusters"]
        ),
    }

    if expected_notes:
        tab_notes = prefer_expected_fingerings(
            tab_notes,
            expected_notes,
            bpm=bpm,
            beats_per_measure=beats_per_measure,
        )
        # Expected prior must still obey the hard fret ceiling
        for note in tab_notes:
            if note.fret > MAX_TAB_FRET:
                s, f, midi = _pick_fingering_under_cap(
                    note.midi,
                    preferred_string=note.string,
                    neighbor_center=float(note.fret),
                )
                note.string, note.fret, note.midi = s, f, midi
        tab_notes, post_expected = simplify_unplayable_tab_chords(tab_notes)
        tab_chord_stats = {
            "simplifiedTabClusters": (
                tab_chord_stats["simplifiedTabClusters"] + post_expected["simplifiedTabClusters"]
            ),
            "removedTabNotes": tab_chord_stats["removedTabNotes"] + post_expected["removedTabNotes"],
            "dominantTabSingleClusters": (
                tab_chord_stats["dominantTabSingleClusters"]
                + post_expected["dominantTabSingleClusters"]
            ),
        }
    # ── 5. Hammer / pull / slide (pitch-based, reconciles strings) ───────────
    detect_techniques_pitch_based(tab_notes, bpm=bpm, pitch_bends_by_id=pitch_bends_by_id)
    tab_notes, post_technique = simplify_unplayable_tab_chords(tab_notes)
    tab_chord_stats = {
        "simplifiedTabClusters": (
            tab_chord_stats["simplifiedTabClusters"] + post_technique["simplifiedTabClusters"]
        ),
        "removedTabNotes": tab_chord_stats["removedTabNotes"] + post_technique["removedTabNotes"],
        "dominantTabSingleClusters": (
            tab_chord_stats["dominantTabSingleClusters"]
            + post_technique["dominantTabSingleClusters"]
        ),
    }
    layout_midi_omissions = 0
    if quality_mode == "accurate":
        preserved_notes: list[TabNoteOut] = []
        for note in tab_notes:
            source_midi = layout_source_midi.get(note.id)
            written_midi = OPEN_STRING_MIDI.get(note.string, -1000) + note.fret
            if source_midi is None or note.midi != source_midi or written_midi != source_midi:
                layout_midi_omissions += 1
                continue
            preserved_notes.append(note)
        tab_notes = preserved_notes

    # ── 5b. Keep rawEvents in lockstep with surviving tab notes ──────────────
    if expected_notes or quality_mode == "accurate":
        raw = events_to_raw_dicts(
            events_grouped if expected_notes else detector_evidence_events,
        )
    else:
        synced_events = sync_raw_events_to_tab_notes(events_grouped, tab_notes)
        raw = events_to_raw_dicts(synced_events)

    # ── 6. Recording metadata ─────────────────────────────────────────────────
    sec_per_beat  = 60.0 / bpm
    notes_max_m   = max((n.measure for n in tab_notes), default=1)
    audio_measures = math.ceil(duration_s / (sec_per_beat * beats_per_measure)) if duration_s > 0 else notes_max_m
    total_measures = max(notes_max_m, audio_measures)

    return {
        "bpm":           bpm,
        "beatsPerMeasure": beats_per_measure,
        "noteCount":     len(tab_notes),
        "tabNotes":      [asdict(n) for n in tab_notes],
        "rawEvents":     raw,
        "totalMeasures": total_measures,
        "durationMs":    int(round(duration_s * 1000)),
        "settings": {
            "onsetThreshold": onset_threshold,
            "frameThreshold": frame_threshold,
            "minNoteLenMs": round(effective_min_note_len_ms, 1),
            "minAmplitudeRatio": min_amplitude_ratio,
            "audioPreprocess": preprocess_stats,
            "qualityMode": quality_mode,
            "inferencePasses": 2 if quality_mode == "accurate" else 1,
            "primaryEventCount": len(primary_filtered),
            "sensitiveEventCount": len(sensitive_filtered),
            "rescuedEventCount": merge_stats["rescuedEvents"],
            "rejectedSensitiveDuplicates": merge_stats["rejectedSensitiveDuplicates"],
            "rejectedSensitiveArtifacts": merge_stats["rejectedSensitiveArtifacts"],
            "sensitiveCompression": bool(sensitive_compression and quality_mode == "accurate"),
            "layoutMidiOmissions": layout_midi_omissions,
            "omittedUnrenderableEvents": remap_stats.get("omittedUnrenderableEvents", 0),
            "transcriptionRuntimeMs": int(round((time.perf_counter() - transcription_started) * 1000)),
            "chordWindowMs": round(chord_ms, 1),
            "beatsPerMeasure": beats_per_measure,
            "collapsedEvents": collapse_stats["collapsedEvents"],
            "artifactClusters": collapse_stats["artifactClusters"],
            "dominantSingleClusters": collapse_stats["dominantSingleClusters"],
            "simplifiedChordClusters": chord_stats["simplifiedClusters"],
            "removedChordEvents": chord_stats["removedEvents"],
            "octaveCorrectedEvents": chord_stats.get("octaveCorrectedEvents", 0),
            "simplifiedTabClusters": tab_chord_stats["simplifiedTabClusters"],
            "removedTabNotes": tab_chord_stats["removedTabNotes"],
            "dominantTabSingleClusters": tab_chord_stats["dominantTabSingleClusters"],
            "expectedTabPrior": expected_stats,
            "maxTabFret": MAX_TAB_FRET,
            "tabFretClampedEvents": tab_cap_stats.get("clampedEvents", 0),
            "tabFretOctaveDrops": tab_cap_stats.get("octaveDroppedEvents", 0),
            "tabFretRemappedFingerings": remap_stats.get("remappedFingerings", 0),
            "registerRemappedSlots": register_stats.get("registerRemappedSlots", 0),
            "registerOctaveDrops": register_stats.get("registerOctaveDroppedEvents", 0),
        },
    }
