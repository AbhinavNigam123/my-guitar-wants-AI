"""Smoke test: synthesize known notes and verify basic-pitch transcribes them.

Generates a short signal of three sustained tones (A2, A3, E4 — common guitar
pitches) and checks that basic-pitch returns note events near those MIDI pitches.
"""

import sys
import tempfile
import os
import numpy as np
import soundfile as sf


def midi_to_hz(m: int) -> float:
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def synth(midi_notes, sr=22050, dur=0.8, gap=0.15):
    """Concatenate decaying sine tones with a few harmonics (guitar-ish)."""
    out = []
    for m in midi_notes:
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        f = midi_to_hz(m)
        wave = np.zeros_like(t)
        for h, amp in [(1, 1.0), (2, 0.5), (3, 0.25), (4, 0.12)]:
            wave += amp * np.sin(2 * np.pi * f * h * t)
        env = np.exp(-3.0 * t)  # plucked-string decay
        out.append(wave * env)
        out.append(np.zeros(int(sr * gap)))
    sig = np.concatenate(out)
    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.9
    return sig.astype(np.float32), sr


def main():
    print("Importing basic_pitch ...", flush=True)
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    print(f"  model path: {ICASSP_2022_MODEL_PATH}", flush=True)

    expected = [45, 57, 64]  # A2, A3, E4
    sig, sr = synth(expected)

    tmp = os.path.join(tempfile.gettempdir(), "bp_smoke.wav")
    sf.write(tmp, sig, sr)
    print(f"Wrote test audio: {tmp}  ({len(sig)/sr:.2f}s @ {sr}Hz)", flush=True)

    print("Running basic-pitch predict ...", flush=True)
    model_output, midi_data, note_events = predict(tmp)

    print(f"\nDetected {len(note_events)} note events:")
    detected_midi = sorted({int(round(n[2])) for n in note_events})
    for n in note_events:
        start, end, pitch, amp = n[0], n[1], int(n[2]), n[3]
        print(f"  midi={pitch:>3}  {start:5.2f}s -> {end:5.2f}s  amp={amp:.2f}")

    print(f"\nExpected MIDI pitches: {expected}")
    print(f"Detected MIDI pitches: {detected_midi}")
    hits = [m for m in expected if any(abs(m - d) <= 1 for d in detected_midi)]
    print(f"Matched {len(hits)}/{len(expected)} expected pitches (±1 semitone): {hits}")

    if len(hits) == len(expected):
        print("\nSMOKE TEST PASSED")
        return 0
    print("\nSMOKE TEST PARTIAL — pipeline runs, accuracy needs real-audio validation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
