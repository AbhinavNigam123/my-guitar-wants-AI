# Transcription eval harness

Deterministic checks — **no LLM tokens**. Run locally before asking an agent to debug transcription.

## Commands

```bash
npm run harness:fast   # unit tests only (~10s)
npm run harness        # unit + synthetic ONNX clips (~20s)
npm run harness:full   # also runs optional user clips in manifest
```

Uses `backend/.venv311` Python when invoked via npm from repo root.

## Output

- One-line `HARNESS PASS` / `HARNESS FAIL` on stdout
- Full report: `benchmarks/results/latest.json` (gitignored)

Agents should read the report instead of re-exploring `transcribe.py` from scratch.

## Add your clips

1. Drop WAV/WebM under `fixtures/user/`
2. Copy the `user_clip_template` entry in `manifest.json`, set `"optional": false`
3. Tune `expect` bounds (`noteCountMin`, `chordClustersMin`, `slideCountMax`, `maxFret`, …)
4. Run `npm run harness:full`

Synthetic WAVs are generated on first run (`generate_fixtures.py`); real clips are the long-term regression signal.

For AI Coach validation while the guitar is missing a D string, start with user
clips from phrases that do not require string 4. Keep D-string coverage in
synthetic coach harness cases until real recordings are possible.
