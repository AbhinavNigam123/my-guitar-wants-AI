"""Generate deterministic WAV fixtures for the harness (no LLM, no uploads).

Two fixture types:
  - Simple generators (GENERATORS dict): return np.ndarray only; used by the
    original transcription and coach-audio harnesses.
  - Annotated generators (ANNOTATED_GENERATORS dict): return (np.ndarray,
    list[dict]) where the list is the ground-truth annotation
    [{onsetMs, endMs, midi}, ...]; used by the real-recording harness.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

SR = 22050


def _tone(freq: float, duration_s: float, amp: float = 0.45) -> np.ndarray:
    n = int(SR * duration_s)
    t = np.linspace(0, duration_s, n, endpoint=False)
    return np.sin(2 * math.pi * freq * t) * amp


def _silence(duration_s: float) -> np.ndarray:
    return np.zeros(int(SR * duration_s))


def _freq_ramp(start_freq: float, end_freq: float, duration_s: float, amp: float = 0.45) -> np.ndarray:
    """Phase-accumulation ramp between two frequencies — simulates a bend or slide."""
    n = int(SR * duration_s)
    freqs = np.linspace(start_freq, end_freq, n)
    phase = np.cumsum(2.0 * math.pi * freqs / SR)
    return np.sin(phase) * amp


def triad_sequence() -> np.ndarray:
    """Three picked notes: A2, A3, E4 — same idea as backend/e2e_test.py."""
    note = 0.45
    gap = 0.12
    return np.concatenate([
        _tone(110.0, 0.45, note),
        _silence(gap),
        _tone(220.0, 0.45, note),
        _silence(gap),
        _tone(329.63, 0.45, note),
        _silence(0.2),
    ])


def strum_chord() -> np.ndarray:
    """Simultaneous E-minor-ish triad + short gap + second strum."""
    dur = 0.55
    gap = 0.35
    e2, g2, b2 = 82.41, 98.0, 123.47
    chord1 = _tone(e2, dur, 0.35) + _tone(g2, dur, 0.32) + _tone(b2, dur, 0.30)
    chord2 = _tone(e2, dur, 0.35) + _tone(g2, dur, 0.32) + _tone(b2, dur, 0.30)
    return np.concatenate([chord1, _silence(gap), chord2, _silence(0.15)])


def _midi_hz(midi: int) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def coach_sync_grid(leading_silence_ms: float = 308.0, bpm: float = 71.0) -> np.ndarray:
    """
    Beat-grid tones for coach timing calibration (beats 2–5 of phrase).
    Leading silence simulates mic latency / count-in bleed before first note.
    """
    open_midi = {4: 50, 3: 55, 2: 59, 1: 64}
    # beat index from phrase downbeat (beat 1 = 0 ms)
    sequence = [(1, 4, 2), (2, 3, 0), (3, 2, 1), (4, 1, 0)]
    ms_per_beat = 60000.0 / bpm
    note_dur = 0.38
    tail_gap = 0.06
    segments: list[np.ndarray] = []
    if leading_silence_ms > 0:
        segments.append(_silence(leading_silence_ms / 1000.0))
    for beat_idx, string_num, fret in sequence:
        onset_ms = beat_idx * ms_per_beat
        target_s = (leading_silence_ms + onset_ms) / 1000.0
        total_s = sum(s.size for s in segments) / SR
        pad_s = max(0.0, target_s - total_s)
        if pad_s > 0:
            segments.append(_silence(pad_s))
        midi = open_midi[string_num] + fret
        segments.append(_tone(_midi_hz(midi), note_dur, 0.52))
        segments.append(_silence(tail_gap))
    segments.append(_silence(0.15))
    return np.concatenate(segments)


def coach_latency_grid(leading_silence_ms: float = 120.0, bpm: float = 71.0) -> np.ndarray:
    """Twelve exact beat-grid attacks across three measures for Coach calibration."""
    sequence = [(index, 64 + (index % 5)) for index in range(12)]
    ms_per_beat = 60000.0 / bpm
    note_dur = 0.30
    segments: list[np.ndarray] = [_silence(leading_silence_ms / 1000.0)]
    for beat_idx, midi in sequence:
        target_s = (leading_silence_ms + beat_idx * ms_per_beat) / 1000.0
        total_s = sum(segment.size for segment in segments) / SR
        if target_s > total_s:
            segments.append(_silence(target_s - total_s))
        segments.append(_tone(_midi_hz(midi), note_dur, 0.52))
    segments.append(_silence(0.15))
    return np.concatenate(segments)


GENERATORS = {
    "triad_sequence": triad_sequence,
    "strum_chord": strum_chord,
    "coach_sync_grid": lambda: coach_sync_grid(308.0, 71.0),
    "coach_sync_grid_no_silence": lambda: coach_sync_grid(0.0, 71.0),
    "coach_latency_grid": lambda: coach_latency_grid(120.0, 71.0),
}


def ensure_fixture(path: Path, generator: str) -> Path:
    fn = GENERATORS.get(generator)
    if fn is None:
        raise ValueError(f"Unknown generator: {generator}")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        sf.write(str(path), fn(), SR)
    return path


# ── Annotated fixture generators ──────────────────────────────────────────────
# Each function returns (audio: np.ndarray, ground_truth: list[dict]).
# Ground-truth entries: {onsetMs: int, endMs: int, midi: int}
# Onset times are derived from the exact segment layout so they are
# deterministic and can be used directly for P/R/F1 scoring.


def isolated_string_notes() -> tuple[np.ndarray, list[dict]]:
    """One open-string note per string, E2 → E4, 500 ms each with 300 ms gaps.

    Tests onset precision and MIDI accuracy across the full guitar range
    and all six strings in isolation.
    """
    open_midis = [40, 45, 50, 55, 59, 64]  # E2, A2, D3, G3, B3, E4
    lead = 0.10
    note_dur = 0.50
    gap = 0.30

    segments: list[np.ndarray] = [_silence(lead)]
    ground_truth: list[dict] = []
    t = lead

    for i, midi in enumerate(open_midis):
        ground_truth.append({
            "onsetMs": round(t * 1000),
            "endMs": round((t + note_dur) * 1000),
            "midi": midi,
        })
        segments.append(_tone(_midi_hz(midi), note_dur))
        t += note_dur
        if i < len(open_midis) - 1:
            segments.append(_silence(gap))
            t += gap

    segments.append(_silence(0.20))
    return np.concatenate(segments), ground_truth


def repeated_single_note() -> tuple[np.ndarray, list[dict]]:
    """E2 (open low E) repeated four times, 400 ms each with 200 ms gaps.

    Tests onset re-trigger detection — whether the detector cleanly
    separates repeated strikes of the same pitch.
    """
    midi = 40  # E2
    freq = _midi_hz(midi)
    lead = 0.05
    note_dur = 0.40
    gap = 0.20
    count = 4

    segments: list[np.ndarray] = [_silence(lead)]
    ground_truth: list[dict] = []
    t = lead

    for i in range(count):
        ground_truth.append({
            "onsetMs": round(t * 1000),
            "endMs": round((t + note_dur) * 1000),
            "midi": midi,
        })
        segments.append(_tone(freq, note_dur))
        t += note_dur
        if i < count - 1:
            segments.append(_silence(gap))
            t += gap

    segments.append(_silence(0.20))
    return np.concatenate(segments), ground_truth


def ascending_scale_am_penta() -> tuple[np.ndarray, list[dict]]:
    """A minor pentatonic ascending: A2, C3, D3, E3, G3, A3.

    Tests sequential note separation and MIDI accuracy across a realistic
    single-string scale passage.
    """
    midis = [45, 48, 50, 52, 55, 57]
    lead = 0.05
    note_dur = 0.35
    gap = 0.10

    segments: list[np.ndarray] = [_silence(lead)]
    ground_truth: list[dict] = []
    t = lead

    for i, midi in enumerate(midis):
        ground_truth.append({
            "onsetMs": round(t * 1000),
            "endMs": round((t + note_dur) * 1000),
            "midi": midi,
        })
        segments.append(_tone(_midi_hz(midi), note_dur))
        t += note_dur
        if i < len(midis) - 1:
            segments.append(_silence(gap))
            t += gap

    segments.append(_silence(0.20))
    return np.concatenate(segments), ground_truth


def descending_scale_am_penta() -> tuple[np.ndarray, list[dict]]:
    """A minor pentatonic descending: A3 → A2."""
    midis = [57, 55, 52, 50, 48, 45]
    lead = 0.05
    note_dur = 0.35
    gap = 0.10

    segments: list[np.ndarray] = [_silence(lead)]
    ground_truth: list[dict] = []
    t = lead

    for i, midi in enumerate(midis):
        ground_truth.append({
            "onsetMs": round(t * 1000),
            "endMs": round((t + note_dur) * 1000),
            "midi": midi,
        })
        segments.append(_tone(_midi_hz(midi), note_dur))
        t += note_dur
        if i < len(midis) - 1:
            segments.append(_silence(gap))
            t += gap

    segments.append(_silence(0.20))
    return np.concatenate(segments), ground_truth


def arpeggio_em() -> tuple[np.ndarray, list[dict]]:
    """E minor arpeggio ascending: E2, B2, E3, G3, B3, E4 (350 ms each).

    Notes overlap in decay like a real arpeggio; each synthetic note is
    independent so onset detection is unambiguous.
    """
    midis = [40, 47, 52, 55, 59, 64]
    lead = 0.05
    note_dur = 0.35
    gap = 0.10

    segments: list[np.ndarray] = [_silence(lead)]
    ground_truth: list[dict] = []
    t = lead

    for i, midi in enumerate(midis):
        ground_truth.append({
            "onsetMs": round(t * 1000),
            "endMs": round((t + note_dur) * 1000),
            "midi": midi,
        })
        segments.append(_tone(_midi_hz(midi), note_dur))
        t += note_dur
        if i < len(midis) - 1:
            segments.append(_silence(gap))
            t += gap

    segments.append(_silence(0.20))
    return np.concatenate(segments), ground_truth


def open_chord_em() -> tuple[np.ndarray, list[dict]]:
    """E minor open chord: all six strings struck simultaneously.

    Tests polyphonic onset detection — all six notes should be detected
    within ±50 ms of each other.
    """
    # E2, B2, E3, G3, B3, E4 — standard Em voicing
    midis = [40, 47, 52, 55, 59, 64]
    lead = 0.10
    note_dur = 0.80

    # Sum all tones simultaneously
    chord = sum(_tone(_midi_hz(m), note_dur, amp=0.18) for m in midis)
    onset_ms = round(lead * 1000)
    end_ms = round((lead + note_dur) * 1000)
    ground_truth = [
        {"onsetMs": onset_ms, "endMs": end_ms, "midi": m} for m in midis
    ]

    audio = np.concatenate([_silence(lead), chord, _silence(0.20)])
    return audio, ground_truth


def barre_chord_f() -> tuple[np.ndarray, list[dict]]:
    """F major barre chord (fret 1): F2, C3, F3, A3, C4, F4.

    Tests polyphonic detection at higher frets where harmonics are denser
    and string interaction is more pronounced.
    """
    # str6 fret1=F2(41), str5 fret3=C3(48), str4 fret3=F3(53),
    # str3 fret2=A3(57), str2 fret1=C4(60), str1 fret1=F4(65)
    midis = [41, 48, 53, 57, 60, 65]
    lead = 0.10
    note_dur = 0.80

    chord = sum(_tone(_midi_hz(m), note_dur, amp=0.18) for m in midis)
    onset_ms = round(lead * 1000)
    end_ms = round((lead + note_dur) * 1000)
    ground_truth = [
        {"onsetMs": onset_ms, "endMs": end_ms, "midi": m} for m in midis
    ]

    audio = np.concatenate([_silence(lead), chord, _silence(0.20)])
    return audio, ground_truth


def fast_riff_pentatonic() -> tuple[np.ndarray, list[dict]]:
    """E minor pentatonic riff at 160 BPM (8th notes, ~187.5 ms apart).

    Tests onset separation at fast tempos where inter-note gaps are short
    and Basic Pitch's minimum-note-length filter may merge adjacent notes.
    """
    # E2, G2, A2, B2, E3, G3 — simple pentatonic run
    midis = [40, 43, 45, 47, 52, 55]
    bpm = 160.0
    eighth_ms = (60000.0 / bpm) / 2.0  # ~187.5 ms
    lead = 0.05
    note_dur = 0.14
    gap = (eighth_ms / 1000.0) - note_dur  # remaining time after note

    segments: list[np.ndarray] = [_silence(lead)]
    ground_truth: list[dict] = []
    t = lead

    for i, midi in enumerate(midis):
        ground_truth.append({
            "onsetMs": round(t * 1000),
            "endMs": round((t + note_dur) * 1000),
            "midi": midi,
        })
        segments.append(_tone(_midi_hz(midi), note_dur))
        t += note_dur
        if i < len(midis) - 1:
            segments.append(_silence(gap))
            t += gap

    segments.append(_silence(0.20))
    return np.concatenate(segments), ground_truth


def bend_single() -> tuple[np.ndarray, list[dict]]:
    """Single whole-step bend: E3 → F#3 (MIDI 52 → 54) over 0.4 s.

    Tests whether pitch detection tracks the ramp and whether Basic Pitch
    returns the starting pitch (onset), ending pitch, or something else.
    Ground truth uses the starting MIDI since the note onset is at E3.
    """
    start_midi = 52  # E3
    start_freq = _midi_hz(start_midi)
    end_freq = _midi_hz(54)  # F#3 — whole step up
    lead = 0.10
    note_dur = 0.40

    audio = np.concatenate([
        _silence(lead),
        _freq_ramp(start_freq, end_freq, note_dur),
        _silence(0.20),
    ])
    ground_truth = [{
        "onsetMs": round(lead * 1000),
        "endMs": round((lead + note_dur) * 1000),
        "midi": start_midi,
    }]
    return audio, ground_truth


def hammer_on_pair() -> tuple[np.ndarray, list[dict]]:
    """Hammer-on: E3 (fret 2 D-string) at full attack, then G3 (fret 5) at low amp.

    The second note has lower amplitude (30% of first) to simulate a
    hammer-on where the second note is not re-struck with the pick.
    """
    midi_fretted = 52   # E3 — picked
    midi_hammered = 55  # G3 — hammered on
    lead = 0.10
    dur_fretted = 0.08  # 80 ms — short, as expected before hammer
    gap = 0.01          # 10 ms between pick release and hammer
    dur_hammered = 0.35

    audio = np.concatenate([
        _silence(lead),
        _tone(_midi_hz(midi_fretted), dur_fretted, amp=0.50),
        _silence(gap),
        _tone(_midi_hz(midi_hammered), dur_hammered, amp=0.18),
        _silence(0.20),
    ])
    t = lead
    ground_truth = [
        {"onsetMs": round(t * 1000), "endMs": round((t + dur_fretted) * 1000), "midi": midi_fretted},
    ]
    t += dur_fretted + gap
    ground_truth.append(
        {"onsetMs": round(t * 1000), "endMs": round((t + dur_hammered) * 1000), "midi": midi_hammered}
    )
    return audio, ground_truth


def quiet_isolated_strings() -> tuple[np.ndarray, list[dict]]:
    """Same as isolated_string_notes but at 1/10 amplitude (peak ~0.045).

    Tests whether the backend normalization pass correctly amplifies quiet
    input and whether Basic Pitch still detects the notes after the gain boost.
    Exposes any remaining double-normalization issues with real-world quiet recordings.
    """
    audio, ground_truth = isolated_string_notes()
    return audio * 0.10, ground_truth


def noisy_isolated_strings() -> tuple[np.ndarray, list[dict]]:
    """Isolated string notes with Gaussian background noise (std=0.025, ~-32 dBFS).

    Simulates a laptop microphone in a room with moderate ambient noise
    (keyboard, ventilation, room tone). SNR is approximately 15 dB.
    """
    rng = np.random.default_rng(seed=42)
    audio, ground_truth = isolated_string_notes()
    noise = rng.normal(0.0, 0.025, size=audio.shape).astype(np.float32)
    return np.clip(audio + noise, -1.0, 1.0), ground_truth


# Registry of annotated generators (WAV + ground-truth JSON).
ANNOTATED_GENERATORS: dict[str, Callable[[], tuple[np.ndarray, list[dict]]]] = {
    "isolated_string_notes": isolated_string_notes,
    "repeated_single_note": repeated_single_note,
    "ascending_scale_am_penta": ascending_scale_am_penta,
    "descending_scale_am_penta": descending_scale_am_penta,
    "arpeggio_em": arpeggio_em,
    "open_chord_em": open_chord_em,
    "barre_chord_f": barre_chord_f,
    "fast_riff_pentatonic": fast_riff_pentatonic,
    "bend_single": bend_single,
    "hammer_on_pair": hammer_on_pair,
    "quiet_isolated_strings": quiet_isolated_strings,
    "noisy_isolated_strings": noisy_isolated_strings,
}


def ensure_annotated_fixture(
    wav_path: Path,
    annotation_path: Path,
    generator: str,
) -> Path:
    """Generate the WAV and companion annotation JSON if either is missing."""
    fn = ANNOTATED_GENERATORS.get(generator)
    if fn is None:
        raise ValueError(f"Unknown annotated generator: {generator!r}")

    wav_path.parent.mkdir(parents=True, exist_ok=True)
    annotation_path.parent.mkdir(parents=True, exist_ok=True)

    if not wav_path.exists() or not annotation_path.exists():
        audio, ground_truth = fn()
        sf.write(str(wav_path), audio.astype(np.float32), SR)
        annotation_path.write_text(
            json.dumps(
                {
                    "generator": generator,
                    "sampleRate": SR,
                    "recordingConditions": "synthetic",
                    "groundTruth": ground_truth,
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    return wav_path
