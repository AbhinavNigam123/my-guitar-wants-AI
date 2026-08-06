#!/usr/bin/env python3
"""Decode a WebM/Opus fixture to deterministic mono 22.05 kHz PCM WAV."""

from __future__ import annotations

import argparse
from pathlib import Path

import av
import numpy as np
import soundfile as sf


def normalize(source: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=22050)
    chunks: list[np.ndarray] = []
    with av.open(str(source)) as container:
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().reshape(-1).astype(np.float32))
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().reshape(-1).astype(np.float32))
    if not chunks:
        raise RuntimeError(f"No audio decoded from {source}")
    sf.write(str(output), np.concatenate(chunks), 22050, subtype="PCM_16")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    normalize(args.source, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
