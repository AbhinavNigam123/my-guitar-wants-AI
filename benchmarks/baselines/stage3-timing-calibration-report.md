# Stage 3 timing calibration report

Official configuration: `coach_clean`. Stage 2 results are the before values;
no per-fixture preset was selected.

| Fixture | Timing drift | Fixed correction | Samples | Late | Missed | Wrong | Accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Corrected synth, Stage 2 | 13 ms | n/a | n/a | 4 | 3 | 24 | 78% |
| Corrected synth, Stage 3 | 7 ms | -84 ms | 56 | 1 | 0 | 27 | 79% |
| Human take, Stage 2 | 94 ms | n/a | n/a | 63 | 4 | 29 | 65% |
| Human take, Stage 3 | 95 ms | 0 ms | 70 eligible | 57 | 4 | 28 | 67% |

The synth control exposes a stable 84 ms early timestamp bias in the exported
WebM/detector path. Calibration removes that fixed origin error and leaves 7 ms
mean residual drift. Its combined missing-or-wrong pitch total remains 27.

The human fixture does not satisfy the required 60% timing cluster, so no fixed
offset is removed. The wider correct window reduces widespread `late` labels
without erasing the take's residual 95 ms timing variation or genuine pitch
errors.

The end-to-end latency integration fixture contains 12 exact attacks across
three measures. Its detected 116 ms delay is corrected to 3 ms residual drift
and 100% accuracy.

Machine-readable results:

- `benchmarks/results/latest-coach.json`
- `benchmarks/results/latest-coach-sync-integration.json`
