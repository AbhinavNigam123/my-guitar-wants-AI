# Stage 2 pitch-only Coach report

Official configuration: `coach_clean` only. The diagnostic sweep was not used
to select results. Both source WebMs remain unchanged; the harness evaluates
cached 22.05 kHz mono WAV decodes and passes all 193 canonical Stairway notes
through the backend expected-note prior.

| Fixture | Accuracy | Correct | Early | Late | Missed | Wrong | Extras | Mean timing drift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Corrected synth, baseline | 78% | 159 | 0 | 3 | 4 | 27 | 96 | 12 ms |
| Corrected synth, Stage 2 | 78% | 162 | 0 | 4 | 3 | 24 | 108 | 13 ms |
| Human take, baseline | 63% | 78 | 17 | 58 | 11 | 29 | 86 | 95 ms |
| Human take, Stage 2 | 65% | 82 | 15 | 63 | 4 | 29 | 100 | 94 ms |

The synth retains the same headline accuracy while converting three prior
wrong-note results to correct and reducing misses by one. The human fixture is
diagnostic only; its genuine errors were not relabeled or tuned toward 100%.

The extras increase is a reporting correction, not a new detector regression:
the baseline synchronized raw detections to the cleaned rendered tab and
discarded 18 synth and 31 human raw events. Stage 2 preserves detector MIDI
through notation cleanup, so those events remain visible as evidence and can be
reported as extras instead of silently disappearing. This means the literal
baseline requirement of no increase in reported extras is not met; restoring
that number would conflict with the Stage 2 requirements to preserve wrong-note
evidence and never synthesize or rewrite events during tab synchronization.

Machine-readable inputs:

- Frozen baseline: `benchmarks/baselines/coach-audio-pre-pitch-only.json`
- Latest result: `benchmarks/results/latest-coach.json`
