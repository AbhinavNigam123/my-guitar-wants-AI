# Real Recording Protocol

This document describes how to record and annotate real guitar fixtures for the transcription benchmark (`real_recording_manifest.json`).

## Equipment

- Acoustic or electric guitar in standard tuning (E A D G B e)
- Laptop with built-in microphone **or** USB microphone — the same microphone path used during actual practice sessions
- No amp modelling, effects, or EQ unless the fixture explicitly calls for it
- Quiet room (< 40 dBSPL ambient noise for non-noise fixtures)

## Recording in the browser

1. Open the Songsterr practice page in a browser tab.
2. Start a recording session at BPM 120 (or the fixture's specified BPM).
3. Play the notes described in the fixture's `recordingProtocol` field.
4. Export or save the recorded WAV from the browser session, or use a screen recorder to capture the audio.
5. Save the file to `benchmarks/fixtures/real/<fixture_id_without_real_>.wav`.

Alternatively, record directly in Audacity or any DAW that captures your browser microphone input at 44100 Hz or 22050 Hz mono.

## Annotating ground truth

Each WAV must have a companion JSON file with this structure:

```json
{
  "groundTruth": [
    { "onsetMs": 312, "endMs": 750, "midi": 40 },
    { "onsetMs": 1105, "endMs": 1520, "midi": 40 }
  ],
  "recordingConditions": "laptop mic, 20cm distance, quiet bedroom",
  "guitar": "acoustic steel-string",
  "notes": "any relevant notes about the take"
}
```

### How to find onset times

1. Open the WAV in **Audacity** (free).
2. Select the waveform view and zoom in on each attack transient.
3. Click the onset transient (the sharp rise at the beginning of each note) and read the position from the timeline in milliseconds.
4. Record the time when the amplitude first clearly rises above the noise floor, not the peak.
5. For `endMs`, use the time when the note decays below the noise floor (or the next onset, whichever comes first).

### MIDI note values

| String | Open note | MIDI |
|--------|-----------|------|
| 6 (low E) | E2 | 40 |
| 5 (A) | A2 | 45 |
| 4 (D) | D3 | 50 |
| 3 (G) | G3 | 55 |
| 2 (B) | B3 | 59 |
| 1 (high e) | E4 | 64 |

For fretted notes: MIDI = open_midi + fret_number.

### Onset annotation tolerance

Aim for ±5ms accuracy. The harness uses a ±50ms matching window (GuitarSet F50 convention), so ±20ms is acceptable in practice.

## Running the harness

After placing the WAV and JSON, run:

```bash
npm run harness:real
```

To save results as the corrected-Basic-Pitch baseline (after the normalization fix):

```bash
npm run harness:real:baseline
```

## Adding a new fixture

1. Record and annotate the WAV.
2. Add an entry to `real_recording_manifest.json` with `"optional": false` when the recording is validated.
3. Run the harness; if the fixture fails, check that annotations are accurate and the recording quality is adequate.
4. Commit both the WAV and the annotation JSON.

## What the harness measures

For each fixture the harness computes:

| Metric | Description |
|--------|-------------|
| `onsetPrecision` | Detected onsets that match a GT onset / total detected |
| `onsetRecall` | GT onsets that were detected / total GT |
| `onsetF1` | Harmonic mean of precision and recall |
| `midiPrecision` | Onset-matched pairs where MIDI is correct / total matched detected |
| `midiRecall` | Onset-matched pairs where MIDI is correct / total matched GT |
| `octaveErrorRate` | Matched pairs where MIDI differs by exactly ±12 / total matched |
| `harmonicErrorRate` | Matched pairs where detected MIDI is an overtone (+12/+19/+24 st) of GT |
| `ghostNoteRate` | Detected events with no GT match / total detected |
| `missedNoteRate` | GT events with no detected match / total GT |

All onset matching uses ±50ms tolerance, consistent with the GuitarSet F50 benchmark convention.
