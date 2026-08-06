#!/usr/bin/env python3
"""Songsterr eval harness — fast, deterministic, zero LLM tokens.

Usage (from repo root):
  python benchmarks/run_harness.py           # unit + synthetic ML checks
  python benchmarks/run_harness.py --fast    # unit tests only (~3s)
  python benchmarks/run_harness.py --full    # include optional user clips

Agents: run this BEFORE iterating on transcribe.py. Read benchmarks/results/latest.json
or the one-line PASS/FAIL summary — do not re-explore the whole pipeline blind.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
BENCH = ROOT / "benchmarks"
RESULTS_DIR = BENCH / "results"
MANIFEST_PATH = BENCH / "manifest.json"


def _load_transcribe():
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    from app.services.transcribe import transcribe_file  # noqa: WPS433

    return transcribe_file


def run_unit_tests() -> dict:
    t0 = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, str(BACKEND / "test_quant.py")],
        cwd=str(BACKEND),
        capture_output=True,
        text=True,
    )
    ms = int((time.perf_counter() - t0) * 1000)
    out = proc.stdout + proc.stderr
    passed = failed = 0
    for line in out.splitlines():
        if line.startswith("PASS"):
            passed += 1
        elif line.startswith("FAIL"):
            failed += 1
    if passed == 0 and failed == 0 and proc.returncode != 0:
        failed = 1
    return {
        "ok": proc.returncode == 0 and failed == 0,
        "passed": passed,
        "failed": failed,
        "ms": ms,
        "exitCode": proc.returncode,
        "tail": out.strip().splitlines()[-3:],
    }


def run_fixture_suite(include_optional: bool) -> dict:
    from benchmarks.eval_transcribe import evaluate_result
    from benchmarks.generate_fixtures import ensure_fixture

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    transcribe_file = _load_transcribe()

    results: list[dict] = []
    skipped = 0
    t0 = time.perf_counter()

    for fx in manifest.get("fixtures", []):
        fx_id = fx["id"]
        rel = fx["path"]
        path = BENCH / rel
        optional = bool(fx.get("optional"))

        if fx.get("generate"):
            try:
                ensure_fixture(path, fx["generate"])
            except Exception as exc:
                results.append({"id": fx_id, "ok": False, "error": str(exc)})
                continue
        elif not path.exists():
            if optional:
                skipped += 1
                continue
            results.append({"id": fx_id, "ok": False, "skipped": optional, "error": "file missing"})
            continue

        bpm = float(fx.get("bpm") or manifest.get("defaults", {}).get("bpm", 120))
        beats = int(fx.get("beatsPerMeasure") or manifest.get("defaults", {}).get("beatsPerMeasure", 4))

        try:
            result = transcribe_file(str(path), bpm=bpm, beats_per_measure=beats)
            failures = evaluate_result(result, fx.get("expect") or {})
            entry = {
                "id": fx_id,
                "ok": len(failures) == 0,
                "noteCount": result.get("noteCount"),
                "failures": failures,
            }
            if not entry["ok"]:
                entry["sampleNotes"] = result.get("tabNotes", [])[:5]
            results.append(entry)
        except Exception as exc:
            results.append({"id": fx_id, "ok": False, "error": str(exc)})

    ms = int((time.perf_counter() - t0) * 1000)
    failed = [r for r in results if not r.get("ok")]
    return {
        "ok": len(failed) == 0,
        "passed": sum(1 for r in results if r.get("ok")),
        "failed": len(failed),
        "skipped": skipped,
        "ms": ms,
        "fixtures": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Songsterr eval harness (no LLM)")
    parser.add_argument("--fast", action="store_true", help="Unit tests only")
    parser.add_argument("--full", action="store_true", help="Include optional user clips")
    args = parser.parse_args()

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    report: dict = {
        "ok": True,
        "runAt": datetime.now(timezone.utc).isoformat(),
        "mode": "fast" if args.fast else ("full" if args.full else "default"),
        "tiers": {},
    }

    unit = run_unit_tests()
    report["tiers"]["unit"] = unit
    if not unit["ok"]:
        report["ok"] = False

    if not args.fast:
        ml = run_fixture_suite(include_optional=args.full)
        report["tiers"]["fixtures"] = ml
        if not ml["ok"]:
            report["ok"] = False

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    latest = RESULTS_DIR / "latest.json"
    latest.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if report["ok"]:
        u = unit
        if args.fast:
            summary = f"HARNESS PASS — unit {u['passed']} tests ({u['ms']}ms)"
        else:
            fx = report["tiers"].get("fixtures", {})
            summary = (
                f"HARNESS PASS — unit {u['passed']} ({u['ms']}ms), "
                f"fixtures {fx.get('passed', 0)}/{fx.get('passed', 0) + fx.get('failed', 0)} "
                f"({fx.get('ms', 0)}ms)"
            )
        print(summary)
        print(f"Report: {latest.relative_to(ROOT)}")
        return 0

    parts = ["HARNESS FAIL"]
    if not unit["ok"]:
        parts.append(f"unit failed ({unit.get('failed', '?')} tests)")
    fx = report["tiers"].get("fixtures")
    if fx and not fx.get("ok"):
        ids = [f["id"] for f in fx.get("fixtures", []) if not f.get("ok")]
        parts.append(f"fixtures: {', '.join(ids)}")
    print(" — ".join(parts))
    print(f"Report: {latest.relative_to(ROOT)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
