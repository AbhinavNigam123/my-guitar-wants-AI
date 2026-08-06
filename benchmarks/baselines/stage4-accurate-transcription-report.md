# Stage 4 accurate transcription report

The optional `accurate` mode was evaluated against the frozen fast-mode result
on 12 required annotated fixtures. Coach continues to use its independent
`coach_clean` preset.

| Metric | Fast | Accurate |
| --- | ---: | ---: |
| Onset precision | 0.577 | 0.735 |
| Onset recall | 0.672 | 0.902 |
| Onset F1 | 0.621 | 0.809 |
| MIDI precision | 0.535 | 0.680 |
| MIDI recall | 0.623 | 0.836 |
| MIDI F1 | 0.576 | 0.750 |
| Ghost-note rate | 0.423 | 0.267 |
| Missed-note rate | 0.328 | 0.098 |
| Octave error rate | 0.024 | 0.000 |
| Harmonic error rate | 0.024 | 0.000 |
| Aggregate fixture runtime | 10.7 s | 14.2 s |

Accurate mode rescued four conservative events across the suite. Every required
fixture passed. Its rendered tab had zero MIDI/string-fret invariant violations,
zero duplicate-string chord slots, and a maximum written fret of 10.

The compression experiment reached MIDI F1 0.765, only 0.015 above the
uncompressed accurate result. Because this is below the locked +0.02 threshold,
compression is not enabled in the product path.

The fast result remains byte-for-behavior compatible and retains its existing
known F-barre guard failure at 0.50 onset recall versus the historical 0.55
threshold. Accurate mode passes all 12 required annotated fixtures.

Machine-readable reports:

- `benchmarks/results/baseline-bp-corrected.json`
- `benchmarks/results/latest-real-fast.json`
- `benchmarks/results/latest-real-accurate.json`
- `benchmarks/results/latest-real-accurate-compressed.json`
