"""Quick end-to-end test for the new transcribe_file pipeline (DP + techniques)."""
import json, tempfile, os
import numpy as np
import soundfile as sf
from app.services.transcribe import transcribe_file

sr = 22050
t = np.linspace(0, 0.5, int(sr * 0.5), endpoint=False)
silence = np.zeros(int(sr * 0.1))
sig = np.concatenate([
    np.sin(2 * np.pi * 110 * t) * 0.5,       # A2  MIDI 45 → str 5 fret 0
    silence,
    np.sin(2 * np.pi * 220 * t) * 0.5,       # A3  MIDI 57 → str 3 fret 2
    silence,
    np.sin(2 * np.pi * 329.63 * t) * 0.5,    # E4  MIDI 64 → str 1 fret 0
])

tmp = tempfile.mktemp(suffix=".wav")
sf.write(tmp, sig, sr)

result = transcribe_file(tmp, bpm=120.0)
os.unlink(tmp)

print(f"noteCount: {result['noteCount']}")
for n in result["tabNotes"]:
    print(f"  measure={n['measure']} beat={n['beat']:.2f} "
          f"str={n['string']} fret={n['fret']} "
          f"dur={n['durationBeats']} tech={n['technique']}")

assert result["noteCount"] > 0, "No notes returned"
fields = result["tabNotes"][0].keys()
assert "technique"     in fields, "technique field missing"
assert "bendSemitones" in fields, "bendSemitones field missing"
assert "durationBeats" in fields, "durationBeats field missing"
assert "totalMeasures" in result, "totalMeasures missing from response"
assert "durationMs"    in result, "durationMs missing from response"
assert result["totalMeasures"] >= 1, f"totalMeasures={result['totalMeasures']}"
assert result["durationMs"]    >= 0, f"durationMs={result['durationMs']}"

# Verify beats are quantized to 0.25 grid
for n in result["tabNotes"]:
    b = n["beat"] - 1.0  # convert to 0-indexed
    assert abs(round(b / 0.25) * 0.25 - b) < 0.01, \
        f"Beat {n['beat']} not on 0.25 grid"

print(f"totalMeasures={result['totalMeasures']}, durationMs={result['durationMs']}")
print("\nE2E TEST PASSED")
