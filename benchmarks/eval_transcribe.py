"""Score transcribe_file output against manifest expectations."""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def _chord_clusters(notes: list[dict]) -> int:
    by_slot: dict[tuple[int, float], int] = defaultdict(int)
    for n in notes:
        key = (int(n["measure"]), round(float(n["beat"]) * 4) / 4)
        by_slot[key] += 1
    return sum(1 for c in by_slot.values() if c >= 2)


def _technique_counts(notes: list[dict]) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for n in notes:
        t = n.get("technique")
        if t:
            out[str(t)] += 1
    return dict(out)


def _ghost_ratio(result: dict) -> float:
    """Heuristic: notes with very low confidence vs median."""
    notes = result.get("tabNotes") or []
    if len(notes) < 2:
        return 0.0
    confs = [float(n.get("confidence") or 0) for n in notes]
    med = sorted(confs)[len(confs) // 2]
    if med <= 0:
        return 0.0
    weak = sum(1 for c in confs if c < med * 0.45)
    return weak / len(notes)


def evaluate_result(result: dict, expect: dict[str, Any]) -> list[str]:
    """Return list of failure messages (empty = pass)."""
    failures: list[str] = []
    notes = result.get("tabNotes") or []
    count = len(notes)

    if "noteCountMin" in expect and count < expect["noteCountMin"]:
        failures.append(f"noteCount {count} < min {expect['noteCountMin']}")
    if "noteCountMax" in expect and count > expect["noteCountMax"]:
        failures.append(f"noteCount {count} > max {expect['noteCountMax']}")

    if notes:
        max_fret = max(int(n["fret"]) for n in notes)
        if "maxFret" in expect and max_fret > expect["maxFret"]:
            failures.append(f"maxFret {max_fret} > {expect['maxFret']}")

    tech = _technique_counts(notes)
    slides = tech.get("slide", 0)
    if "slideCountMax" in expect and slides > expect["slideCountMax"]:
        failures.append(f"slideCount {slides} > max {expect['slideCountMax']}")

    clusters = _chord_clusters(notes)
    if "chordClustersMin" in expect and clusters < expect["chordClustersMin"]:
        failures.append(f"chordClusters {clusters} < min {expect['chordClustersMin']}")

    ratio = _ghost_ratio(result)
    if "ghostRatioMax" in expect and ratio > expect["ghostRatioMax"]:
        failures.append(f"ghostRatio {ratio:.2f} > max {expect['ghostRatioMax']}")

    return failures
