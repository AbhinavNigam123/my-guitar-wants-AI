"""Tempo detection helpers for uploaded guitar recordings."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

import numpy as np


MIN_BPM = 40.0
MAX_BPM = 240.0
MIN_DURATION_S = 4.0
DEFAULT_SR = 22050
HOP_LENGTH = 512


@dataclass
class BpmDetection:
    bpm: float | None
    confidence: float
    beatCount: int
    durationMs: int
    candidates: list[float] = None  # type: ignore[assignment]
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if data["candidates"] is None:
            data["candidates"] = []
        return data


def tempo_candidates(bpm: float | None) -> list[float]:
    """Return musically useful half/double alternatives in display order."""
    if bpm is None or bpm <= 0:
        return []

    options: list[float] = []
    for candidate in (bpm / 2.0, bpm, bpm * 2.0):
        if MIN_BPM <= candidate <= MAX_BPM and all(abs(candidate - item) > 0.5 for item in options):
            options.append(round(float(candidate), 1))
    return options


def _coerce_tempo(value: object) -> float:
    arr = np.asarray(value, dtype=float).reshape(-1)
    if arr.size == 0 or not np.isfinite(arr[0]):
        return 0.0
    return float(arr[0])


def _candidate_bpms(base_tempo: float) -> list[float]:
    candidates: list[float] = []
    for factor in (0.25, 0.5, 1.0, 2.0, 4.0):
        bpm = base_tempo * factor
        while bpm < MIN_BPM:
            bpm *= 2.0
        while bpm > MAX_BPM:
            bpm /= 2.0
        if MIN_BPM <= bpm <= MAX_BPM and all(abs(bpm - c) > 0.5 for c in candidates):
            candidates.append(float(bpm))
    return candidates


def _refine_bpm(onset_env: np.ndarray, sr: int, bpm: float) -> tuple[float, float, int]:
    best_bpm = bpm
    best_score = 0.0
    best_count = 0
    lo = max(MIN_BPM, bpm * 0.96)
    hi = min(MAX_BPM, bpm * 1.04)
    for candidate in np.linspace(lo, hi, num=33):
        score, count = _best_periodic_score(onset_env, sr, float(candidate))
        if (score * np.sqrt(max(count, 1)), score) > (best_score * np.sqrt(max(best_count, 1)), best_score):
            best_bpm = float(candidate)
            best_score = score
            best_count = count
    return best_bpm, best_score, best_count


def _best_periodic_score(onset_env: np.ndarray, sr: int, bpm: float) -> tuple[float, int]:
    if bpm <= 0 or onset_env.size == 0:
        return 0.0, 0

    env = np.asarray(onset_env, dtype=float)
    peak = float(np.max(env))
    if peak <= 1e-9:
        return 0.0, 0
    env = env / peak

    period_frames = (60.0 / bpm) * sr / HOP_LENGTH
    if period_frames < 1.0:
        return 0.0, 0

    search_offsets = np.linspace(0.0, period_frames, num=min(24, max(4, int(period_frames))), endpoint=False)
    best_score = 0.0
    best_count = 0

    for offset in search_offsets:
        frames = np.arange(offset, env.size, period_frames)
        idxs = np.rint(frames).astype(int)
        idxs = idxs[(idxs >= 0) & (idxs < env.size)]
        if idxs.size < 3:
            continue

        local_scores: list[float] = []
        for idx in idxs:
            lo = max(0, idx - 2)
            hi = min(env.size, idx + 3)
            local_scores.append(float(np.max(env[lo:hi])))

        values = np.asarray(local_scores, dtype=float)
        active = values[values >= 0.08]
        if active.size < 3:
            continue

        coverage = min(1.0, active.size / max(4.0, idxs.size * 0.55))
        score = float(np.mean(active) * coverage)
        if score > best_score:
            best_score = score
            best_count = int(active.size)

    return best_score, best_count


def detect_bpm(path: str) -> dict[str, Any]:
    """Detect tempo, correcting common half/double-time estimates.

    Returns a serializable dict. ``bpm`` is ``None`` when the clip is too short,
    too quiet, or does not have enough periodic onset evidence.
    """
    import librosa

    y, sr = librosa.load(path, sr=DEFAULT_SR, mono=True)
    duration_s = float(librosa.get_duration(y=y, sr=sr))
    duration_ms = int(round(duration_s * 1000))

    if duration_s < MIN_DURATION_S:
        return BpmDetection(
            bpm=None,
            confidence=0.0,
            beatCount=0,
            durationMs=duration_ms,
            candidates=[],
            reason="Clip is too short for reliable BPM detection.",
        ).to_dict()

    if y.size == 0 or float(np.max(np.abs(y))) < 1e-4:
        return BpmDetection(
            bpm=None,
            confidence=0.0,
            beatCount=0,
            durationMs=duration_ms,
            candidates=[],
            reason="Recording is too quiet for BPM detection.",
        ).to_dict()

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=HOP_LENGTH,
        trim=False,
    )
    base_tempo = _coerce_tempo(tempo)
    if base_tempo <= 0:
        return BpmDetection(
            bpm=None,
            confidence=0.0,
            beatCount=0,
            durationMs=duration_ms,
            candidates=[],
            reason="No stable beat was detected.",
        ).to_dict()

    scored = [
        (score, beat_count, refined_bpm)
        for bpm in _candidate_bpms(base_tempo)
        for refined_bpm, score, beat_count in [_refine_bpm(onset_env, sr, bpm)]
    ]
    scored = [item for item in scored if item[1] >= 3]
    if not scored:
        return BpmDetection(
            bpm=None,
            confidence=0.0,
            beatCount=int(len(beat_frames)),
            durationMs=duration_ms,
            candidates=[],
            reason="Not enough periodic attacks for BPM detection.",
        ).to_dict()

    score, beat_count, bpm = max(scored, key=lambda item: (item[0] * np.sqrt(item[1]), item[0]))
    confidence = round(min(0.99, score), 3)
    if confidence < 0.18 or beat_count < 4:
        return BpmDetection(
            bpm=None,
            confidence=confidence,
            beatCount=int(beat_count),
            durationMs=duration_ms,
            candidates=[],
            reason="Beat confidence is too low for auto tempo.",
        ).to_dict()

    detected_bpm = round(float(np.clip(bpm, MIN_BPM, MAX_BPM)), 1)
    return BpmDetection(
        bpm=detected_bpm,
        confidence=confidence,
        beatCount=int(beat_count),
        candidates=tempo_candidates(detected_bpm),
        durationMs=duration_ms,
    ).to_dict()
