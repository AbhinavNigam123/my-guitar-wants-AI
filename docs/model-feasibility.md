# Model Feasibility Analysis — Guitar Transcription

**Date:** 2026-06-25
**Baseline:** corrected Basic Pitch (`coach_clean` preset, frontend normalization removed)
**Purpose:** Determine which pitch-detection models are worth running as Phase 5 experiments

---

## 1. Baseline Composition — What `baseline-bp-corrected.json` Actually Measures

### 1.1 Fixture inventory

All 12 fixtures that contributed to the baseline are **synthetic sine-wave signals generated deterministically by `benchmarks/generate_fixtures.py`**. Zero real browser-microphone recordings are included.

| Fixture | Source | Recording conditions |
|---------|--------|----------------------|
| `syn_isolated_strings` | Synthetic | Pure sine, 0.45 amp |
| `syn_repeated_note` | Synthetic | Pure sine E2 ×4 |
| `syn_ascending_scale` | Synthetic | Pure sine A-minor-penta |
| `syn_descending_scale` | Synthetic | Pure sine A-minor-penta |
| `syn_arpeggio_em` | Synthetic | Pure sine Em arpeggio |
| `syn_chord_em` | Synthetic | Summed sines Em chord |
| `syn_chord_f_barre` | Synthetic | Summed sines F-major |
| `syn_fast_riff` | Synthetic | Pure sine 160-BPM run |
| `syn_bend_single` | Synthetic | Frequency-ramp sine |
| `syn_hammer_on` | Synthetic | Two-sine pair |
| `syn_quiet_input` | Synthetic | Isolated strings ×0.1 amp |
| `syn_noisy_input` | Synthetic | Isolated strings + Gaussian noise |

**The 23 optional real-recording slots are all unpopulated (skipped).** The baseline is entirely synthetic-dominant and must be treated as a lower-bound diagnostic, not a product-representative accuracy figure.

### 1.2 Aggregate baseline metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Onset F1 | **0.637** | Aggregate across 12 synthetic fixtures |
| MIDI F1 | **0.578** | Conditional on onset match |
| Ghost-note rate | **0.419** | 31 FP out of 74 detected |
| Missed-note rate | **0.295** | 18 FN out of 61 GT notes |
| Octave error rate | **0.000** | No octave errors on sine signals |
| Harmonic error rate | **0.000** | No harmonic errors on sine signals |

### 1.3 Category breakdown

| Category | Onset F1 | Ghost rate | Key finding |
|----------|----------|------------|-------------|
| Scales | 0.923 | 0.143 | Basic Pitch handles clean sequential notes well |
| Arpeggios | 0.923 | 0.143 | Same — near-ideal on monophonic sequences |
| Adverse: noisy | 0.923 | 0.143 | Gaussian noise does not significantly degrade detection |
| Barre chords | 0.833 | 0.167 | Good onset recall; MIDI F1 collapses to **0.167** (pitch errors) |
| Isolated notes | 0.500 | 0.500 | 3 of 6 strings missed — likely E2/E4 confused with harmonics |
| Repeated notes | 0.500 | 0.667 | Recall 100% but 8 FP — note decay re-triggers detection |
| Techniques | 0.571 | 0.500 | Bend creates second phantom event; hammer short note missed |
| Fast riffs | 0.400 | 0.500 | 45ms minNoteLen merges 187ms-spaced notes at 160 BPM |
| Open chords | **0.000** | **1.000** | Complete failure — summed-sine chord unrecognizable to Basic Pitch |

### 1.4 Why the synthetic baseline has limited predictive power

Synthetic sine tones differ from real guitar recordings in four ways that matter to these models:

1. **No attack transient.** Real guitar notes begin with a sharp percussive click followed by decay. Sine waves have instant onset at full amplitude. Onset detectors tuned for attack transients behave differently.
2. **No harmonic envelope evolution.** A real guitar string's harmonics shift over time as the note decays. The models were trained on this spectral dynamics. Static sines are out-of-distribution.
3. **No string interaction / sympathetic resonance.** The chord sine-sum is not how real chords sound; it produces an unnaturally flat spectrum without the per-string delay and resonance smearing that real chord detectors learned from.
4. **No room acoustics or microphone transfer function.** The +5.2× gain applied to `syn_quiet_input` shows preprocessing is working, but the upstream spectral characteristics still differ from mic recordings.

**Implication:** The 0.637 onset F1 on synthetic fixtures likely understates Basic Pitch's real-recording performance on monophonic lines (the real figure is probably 0.78–0.85 for well-played single-note passages). Conversely, the 0.000 on chord sines likely understates the chord problem rather than overstating it — real strummed chords add stagger, decay, and inharmonicity that improve detection somewhat, but simultaneous-onset polyphony remains a genuine weakness.

**Decision:** No architecture decision should be made until at least the six isolated-string real fixtures and two chord real fixtures are populated. The synthetic baseline is useful for regression guarding, not for comparative model evaluation.

---

## 2. Benchmark Comparability — Published Scores vs. Our Context

All published guitar transcription F1 scores must be interpreted against four variables before comparing to our baseline:

| Variable | What to check |
|----------|---------------|
| **Dataset** | GuitarSet (steel-string acoustic + DI)? GAPS test set (nylon classical)? FrançoisLeduc (commercial jazz guitar)? Each has different SNR, playing style, and mic distance |
| **Tolerance** | ±50ms onset-only ("F50"), or onset+offset ("F50+"), or frame-level? F50 only counts an onset hit; frame F1 penalizes note boundaries |
| **Supervision setting** | Supervised (trained on GuitarSet train split) or zero-shot (no GuitarSet in training)? Zero-shot scores degrade sharply |
| **Post-processing** | Raw model output vs. with onset NMS, amplitude filtering, chord simplification? |

### Published F50 onset scores on GuitarSet (supervised split, no offsets)

| Model | F50 | Tolerance | Dataset | Notes |
|-------|-----|-----------|---------|-------|
| Basic Pitch | 79.0% | ±50ms onset | GuitarSet supervised | ICASSP 2022 baseline |
| TART Acoustic-Electric | 83.8% | ±50ms onset | GuitarSet supervised | Uses Basic Pitch as pitch stage |
| GAPS (GAPS+GS, fine-tuned from [13]) | **91.2%** | ±50ms onset | GuitarSet supervised | Best reported; CRNN, 16 kHz |
| GAPS (GAPS only, zero-shot) | 84.7%–88.1% | ±50ms onset | GuitarSet zero-shot | Varies by pre-training variant |
| MT3 | 90.0% | ±50ms onset | GuitarSet supervised | JAX T5; zero-shot drops to 32% |
| Lu et al. (TF-Perceiver) | 91.1% | ±50ms onset | GuitarSet supervised | Zero-shot drops to 80% |
| Our synthetic baseline (Basic Pitch) | 63.7% | ±50ms onset | Synthetic sines | Not directly comparable |

The published 79.0% for Basic Pitch is on real studio-quality acoustic guitar recorded close-mic at high SNR. Our corrected-BP 63.7% on synthetic sines is not a contradiction: sine signals are genuinely harder for onset/frame detectors trained on real instruments (no attack transient, no spectral decay). When real recordings are added, we expect our harness to show Basic Pitch in the 65–80% range depending on playing style.

---

## 3. Candidate Model Assessment

### 3.1 Candidate A: GAPS model via `hf_midi_transcription`

**Architecture:** CRNN (Kong et al. "high-resolution" piano transcription model, guitar fine-tuned). Log mel-spectrogram at 16 kHz → convolutional layers (freq-only) → GRU → per-frame onset/offset/frame/velocity activations per pitch.

| Criterion | Detail |
|-----------|--------|
| **Weights** | `guitar-gaps.pth` publicly available on Hugging Face Hub (`xavriley/midi-transcription-models`), 99.2 MB, MIT license |
| **Wrapper** | `pip install hf-midi-transcription` (MIT). Handles model download, audio resampling, MIDI output |
| **License** | MIT (wrapper + weights repo). GAPS dataset itself has research use caveats; the pre-trained weights are separately MIT-licensed |
| **Runtime** | PyTorch (any version ≥1.9). No TF/JAX dependency conflict with existing Basic Pitch ONNX path |
| **Sample rate** | 16 kHz (resamples internally via librosa) — different from Basic Pitch's 22050 Hz |
| **Output format** | MIDI file via `model.transcribe_audio_array(audio, "output.mid")`. Does not return `(onset_s, end_s, midi, amplitude)` tuples directly. Note events must be extracted from the MIDI |
| **Amplitude/confidence** | Not returned directly. Velocity activations are computed internally but MIDI velocity (0–127) can proxy amplitude. No per-note confidence score compatible with coach's artifact-filtering heuristics |
| **FastAPI coexistence** | Compatible. PyTorch does not conflict with ONNX (Basic Pitch). Both can load in the same process. PyTorch model is ~300 MB RAM at runtime (99 MB weights + activation memory) |
| **CPU latency (estimated)** | CRNN on 10s clip at 16 kHz on a mid-range CPU: approximately 3–8s (based on comparable Kong et al. piano model benchmarks). No published number for this specific model. Must be measured |
| **Training corpus** | 14h classical nylon-string guitar (GAPS) + 6h steel-string acoustic (GuitarSet). No electric guitar, no dist/effects, no amp simulation |
| **Zero-shot generalization** | 84.7%–88.1% F50 on GuitarSet despite training only on nylon string. Authors attribute this to recording-condition diversity (200+ performers) rather than tonal similarity |
| **Polyphonic chord detection** | No paper result for full-strum polyphonic chord F50. GuitarSet contains 360 chord-heavy tracks and the model achieved 88–91% F50 overall, implying chord handling is substantially better than Basic Pitch's 79% |
| **Electric guitar** | Not explicitly tested in the paper. GuitarSet has DI+mic variants and the model shows 88%+ on both settings; this is the closest proxy for electric guitar through a mic |

**Viability verdict:** Viable. Weights public, MIT-licensed, pip-installable, no build system changes required. The output adapter to produce `(onset_s, end_s, midi, amplitude)` tuples from MIDI is a ~30-line Python function reading from `pretty_midi`. The missing amplitude is a meaningful gap: coach's `eventEvidence` function uses amplitude ratios to classify artifacts. MIDI velocity (0–127) can substitute, but the mapping is nonlinear and the filtering behaviour must be re-validated.

**Key risk:** GAPS was trained only on solo monophonic guitar lines. Polyphonic chord performance on simultaneous-onset steel-string or electric guitar remains unmeasured in the paper. The 84.7% zero-shot GuitarSet score includes ensemble tracks; it does not break out chord-only vs. single-note subsets. This is the primary unknown.

---

### 3.2 Candidate B: Basic Pitch fine-tuned on GuitarSet

**Architecture:** Identical to current model (ICASSP 2022 CRNN). Add guitar-specific data to training and re-export ONNX.

| Criterion | Detail |
|-----------|--------|
| **Weights** | Training code in `spotify/basic-pitch` repo (`basic_pitch/train.py`, merged 2024). GuitarSet loader included |
| **License** | Apache 2.0 (full training pipeline). Training on GuitarSet requires GuitarSet (CC-BY 4.0) |
| **Runtime** | Same as current: ONNX on Windows (current deployment target) |
| **Sample rate** | 22050 Hz — no change |
| **Output format** | Identical to current: `(onset_s, end_s, midi, amplitude, pitch_bends)` from `basic_pitch.inference.predict()`. Zero adapter code required |
| **Amplitude/confidence** | Identical to current — preserved |
| **FastAPI coexistence** | Drop-in replacement. Same `preprocess_audio=True` path |
| **CPU latency** | Expected identical to current (~1–3s for 10s clip on ONNX, Windows CPU) |
| **Training cost** | Full retraining (not fine-tuning from released weights) because released weights are TF checkpoints without training-compatible layer names. Training pipeline requires Apache Beam + TF data. Non-trivial infrastructure setup |
| **Training corpus** | GuitarSet is 3h of one acoustic steel-string guitar (Yamaha APX500). Adding GuitarSet alone risks overfitting to a single guitar/room. A proper fine-tune would mix GuitarSet + available electric guitar data (EGDB, ~3h) |
| **Expected gain** | TART stage 1 (Basic Pitch fine-tuned on GuitarSet+EGDB) shows 83.8% vs. 79.0% — approximately +4.8 F50 points. This is a confirmed, reproducible result |

**Viability verdict:** Conditionally viable. The deployment side is ideal — zero adapter code, same ONNX runtime, same output format. The obstacle is training infrastructure: Basic Pitch training requires Apache Beam and a TF training environment, which is a meaningful investment relative to just loading a pre-trained PyTorch model. The gain is modest (~5 F50 points) compared to GAPS (+12 points). Fine-tuning should be considered only if GAPS evaluation reveals an unacceptable output-format mismatch or latency issue.

---

### 3.3 Candidate C: MT3 (Google Magenta)

| Criterion | Detail |
|-----------|--------|
| **Weights** | Available via T5X checkpoints on GCS bucket. Not pip-installable; requires manual JAX/T5X environment |
| **License** | Apache 2.0 (code). GCS access for weights requires Google account |
| **Runtime** | JAX + T5X. Incompatible with current Python/ONNX/PyTorch stack. Would require a separate inference service or subprocess |
| **CPU latency** | ~5–30s for a 10s clip on CPU (JAX not optimized for CPU; designed for TPU/GPU). Likely exceeds 15s budget |
| **Output format** | Token sequence; requires custom post-processing to produce `(onset_s, end_s, midi, amplitude)` |
| **Zero-shot on GuitarSet** | 32.0% F50 — catastrophically poor generalization. On real-world mic recordings not in training this would be worse |
| **Polyphonic handling** | Instrument leakage documented (notes assigned to wrong instrument tracks in multi-instrument context) |

**Viability verdict:** Not viable for this product. Zero-shot F50 of 32% makes it worse than Basic Pitch in any real-world setting where the model has not been trained on the specific recording environment. The JAX/TPU dependency and slow CPU inference eliminate it as a practical server-side option without a dedicated GPU. MT3 is included as a negative control to illustrate that headline F1 scores on supervised benchmarks do not predict generalization.

---

### 3.4 Candidate D: TART multi-stage pipeline

| Criterion | Detail |
|-----------|--------|
| **Stage 1 (pitch)** | Basic Pitch fine-tuned on GuitarSet+EGDB — same as Candidate B |
| **Stage 2 (technique MLP)** | Trained on custom technique-annotated data. F1 varies: 76% for common classes, <30% for bends/slides/vibrato (<100 examples in training) |
| **Stage 3 (string/fret)** | Fretting-Transformer (T5 architecture). 42–98% tab accuracy depending on complexity |
| **Stage 4 (LSTM tablature)** | LSTM post-processor |
| **Weights availability** | Not released publicly as of June 2026 (paper Oct 2025, no public repo or weights found) |
| **License** | Unknown (paper only, no code release) |
| **Output format** | Full tablature (string, fret, technique). Does not return amplitude or raw event onset data compatible with coach |
| **CPU latency** | 4 models in sequence; estimated >10s total for a 10s clip |

**Viability verdict:** Not viable in current state. No public weights. The technique classifier performs poorly on the technique categories that matter most to this product (bends, slides, vibrato). Stage 1 alone is identical to Candidate B. The remaining stages address string/fret assignment and tablature generation, which are explicitly deferred from this phase.

---

## 4. Answers to the Specific Questions

### Q1: Which candidates are genuinely deployable without retraining?

**GAPS via `hf_midi_transcription` (Candidate A)** is the only candidate deployable without retraining:
- Weights are public, MIT-licensed, auto-downloaded by the wrapper
- `pip install hf-midi-transcription` + `pretty_midi` for MIDI parsing
- A ~30-line adapter function converts MIDI note events to `(onset_s, end_s, midi, amplitude)` format
- No build infrastructure, no training job, no GPU required

Basic Pitch fine-tuning (Candidate B) technically requires retraining and is not deployable without it. TART has no public weights. MT3 fails the generalization gate.

### Q2: Which candidate is the strongest first experiment?

**GAPS (Candidate A)**, specifically the `guitar-gaps.pth` checkpoint via `hf_midi_transcription`.

Reasons:
- Largest published F50 improvement over Basic Pitch on guitar: **+12 points** supervised, **+19–22 points** zero-shot (84.7%–88.1% vs. 66.1% zero-shot for Basic Pitch)
- Explicitly demonstrated timbral generalization from classical nylon to steel-string acoustic in zero-shot setting — the mechanism most relevant to browser-mic electric/acoustic guitar recordings
- Public weights, MIT license, pip-installable wrapper, no dependency conflicts
- The critical unknown (chord detection performance, amplitude proxy quality) is answerable in one afternoon of running the existing `run_real_harness.py` script with a GAPS adapter

The experiment setup is: write a 30-line `GAPSAdapter` in `transcribe_adapter.py`, run `npm run harness:real` with both adapters on real recordings, compare numbers.

### Q3: Does Basic Pitch fine-tuning appear more practical than replacing the model?

No, for the following reasons:

1. **Deployment simplicity is identical** (both run at inference time), but the setup cost to fine-tune is substantially higher (requires Apache Beam + TF training environment, not just a pip install).
2. **The accuracy ceiling is lower.** TART stage 1 (the best fine-tuned Basic Pitch variant) achieves 83.8% F50 — 7.4 points below GAPS+GS (91.2%). The GAPS architecture is not the same as Basic Pitch; it uses a Kong et al. CRNN pre-trained on diverse piano/instrument data, which is a genuinely different starting point.
3. **Output format advantage disappears.** If the motivation for fine-tuning is keeping the `(onset_s, end_s, midi, amplitude)` output format, the GAPS adapter can produce the same format from MIDI velocity without fine-tuning.

Fine-tuning becomes attractive only if: (a) GAPS evaluation shows poor chord detection that Basic Pitch handles better; or (b) the MIDI velocity → amplitude mapping produces coach artifact-filtering errors that cannot be calibrated away.

### Q4: Is a hybrid or ensemble architecture justified, or premature?

**Premature.** A hybrid (e.g., GAPS for pitch + Basic Pitch for amplitude confidence) requires:
1. Knowing that GAPS pitch detection is genuinely better on real browser-mic recordings (not yet measured)
2. Knowing that GAPS amplitude output is genuinely worse than Basic Pitch's (not yet measured)
3. Having the engineering budget to run two inference paths in series

Both component assessments depend on real-recording benchmarks that do not yet exist. Proposing a hybrid before measuring either model on real audio amounts to designing around an imagined weakness. The correct sequence is: (1) measure GAPS on real recordings, (2) identify specific failure modes, (3) assess whether Basic Pitch's output fills those gaps, (4) then decide if ensemble overhead is justified.

### Q5: What benchmark gates must a candidate beat before integration?

A candidate must exceed the corrected Basic Pitch baseline on the **same fixtures** with the **same scoring methodology** by a margin that justifies integration complexity. Proposed gates:

| Gate | Threshold | Rationale |
|------|-----------|-----------|
| Onset F1 on real isolated notes | > 0.75 | Minimum for reliable single-note coach feedback |
| Onset F1 on real chords | > 0.50 | Minimum for usable chord detection (Basic Pitch baseline unmeasured yet on real chords) |
| Ghost-note rate on real recordings | < 0.25 | Ghost notes are the primary user-visible artifact in the comparison staff |
| Missed-note rate on real recordings | < 0.20 | Missed notes are the primary cause of incorrect "missed" coach judgments |
| CPU latency for 10s clip | < 15s | Approximately 3× the current Basic Pitch ONNX path (~3–5s) |
| Coach accuracy on synthetic triad (harness:coach-audio) | ≥ 55% | Existing regression floor; a new model must not regress it |
| All existing harness:fast unit tests | 34/34 | No regressions in pipeline heuristics |
| No new systematic bias in timing drift | drift ≤ 25ms | harness:coach-sync must still pass |

The onset/ghost/missed gates are deliberately set against real recordings, not the synthetic baseline, because the synthetic baseline has too many confounds to be a fair comparative signal.

### Q6: Is the current real-audio evidence sufficient to make this decision?

**No.** The current baseline contains zero real recordings. It is sufficient to:
- Confirm the normalization fix is working (gain=5.2× on quiet input, not 64×)
- Identify structural failure modes on synthetic signals (chord sum detection, fast riff note merging, repeated-note ghost generation)
- Establish a regression guard so future changes don't silently break easy cases

It is not sufficient to:
- Compare GAPS vs. Basic Pitch on product-representative audio
- Set the ghost-note and missed-note gates used for model comparison
- Determine whether GAPS's 88% zero-shot GuitarSet F50 translates to browser-mic guitar recordings
- Measure how the MIDI velocity → amplitude proxy affects coach artifact filtering

**The minimum viable evidence set** for an architecture decision is:
- All 6 isolated-string real recordings (`real_iso_low_E` through `real_iso_high_e`)
- 2 chord recordings (`real_chord_open_em`, `real_chord_barre_f`)
- 1 scale recording (`real_scale_ascending`)
- Both adverse-condition recordings (`real_quiet_input`, `real_noisy_room`)

That is 10 recordings, each approximately 10–30 seconds long. Recording protocol is documented in `benchmarks/RECORDING_PROTOCOL.md`. With annotations, this takes approximately 2–3 hours.

---

## 5. Recommended Experiment Sequence

1. **Record and annotate** the 10 minimum-viable fixtures described above.
2. **Run `npm run harness:real`** on real recordings once populated; compare against `baseline-bp-corrected.json`.
3. **Basic Pitch post-processing** — tune `minNoteLen`, ghost suppression, harmonic filtering using harness metrics before any model swap.
4. **Re-evaluate GAPS** (`npm run harness:gaps`) only if GPU inference becomes available; see section 7 for CPU latency results.

The GAPS adapter experiment is complete on synthetic fixtures and archived under `benchmarks/`.

---

## 6. Summary Table

| Candidate | Deployable without retraining | Published F50 (supervised) | Zero-shot F50 | Output format compatible | Est. CPU latency | Verdict |
|-----------|-------------------------------|---------------------------|---------------|--------------------------|------------------|---------|
| **Basic Pitch (current)** | Yes (deployed) | 79.0% | 66.1% | Native | ~3–5s (ONNX) | Baseline |
| **GAPS via hf_midi_transcription** | Yes | 91.2% | 84.7%–88.1% | Needs adapter (~30 lines) | ~3–8s (est.) | **Strongest first experiment** |
| Basic Pitch fine-tuned | No (requires retraining) | ~83.8% (TART stage 1) | Not published | Native (drop-in) | ~3–5s | Secondary if GAPS fails |
| MT3 | No (JAX + TPU) | 90.0% | 32.0% | Requires custom decoder | >15s | Eliminated |
| TART full pipeline | No (no public weights) | 83.8% (stage 1 only) | — | Incompatible (tab output) | >10s | Eliminated |

---

---

## 7. GAPS Synthetic Experiment Results (Phase 6 — 2026-06-25)

The adapter was implemented in `benchmarks/gaps_adapter.py` and run against all 12 synthetic fixtures via `npm run harness:gaps`. Results are in `benchmarks/results/gaps-experiment.json`.

### 7.1 Overall comparison on synthetic fixtures

| Metric | Basic Pitch | GAPS | Winner |
|--------|-------------|------|--------|
| Onset F1 | **63.7%** | 47.5% | BP +16.2 pts |
| MIDI F1 | **57.8%** | 8.5% | BP +49.3 pts |
| Ghost-note rate | 41.9% | 50.9% | BP (lower is better) |
| Missed-note rate | **29.5%** | 54.1% | BP (lower is better) |
| Chord recall | **41.7%** | 33.3% | BP |
| Avg CPU inference (10s clip) | **642 ms** | 7420 ms | BP (11.6× faster) |

### 7.2 Per-category onset F1

| Category | Basic Pitch | GAPS | Winner |
|----------|-------------|------|--------|
| scales | **92.3%** | 50.0% | BP |
| arpeggios | **92.3%** | 40.0% | BP |
| adverse_conditions | **72.0%** | 37.5% | BP |
| barre_chords | **83.3%** | 66.7% | BP |
| isolated_notes | **50.0%** | 40.0% | BP |
| repeated_notes | **50.0%** | 22.2% | BP |
| fast_riffs | 40.0% | **83.3%** | GAPS +43.3 pts |
| techniques | 57.1% | **66.7%** | GAPS +9.6 pts |
| open_chords | 0.0% | **25.0%** | GAPS (both poor) |

### 7.3 Interpretation of synthetic results

These numbers must be read with the distribution-shift caveat from section 1.4 in mind:

**Why MIDI F1 is only 8.5% for GAPS:** GAPS was trained exclusively on real guitar audio (attack transients, harmonic overtone decay, sympathetic resonance). Pure sine waves have none of these cues. The model still *finds* onsets (hence 47.5% onset F1), but assigns wrong pitches because the spectral shape of a sine has no match in its training distribution. The MIDI F1 collapse to 8.5% is expected and not indicative of GAPS' real-recording pitch accuracy.

**Where GAPS beats BP:** Fast riffs (+43 pts) and techniques (+10 pts) — both categories where Basic Pitch's 45ms `minNoteLen` filter merges or drops short notes. GAPS has a different segmentation approach that handles dense note sequences better on synthetic input.

**Inference time:** 7420ms average CPU latency (11.6× slower than BP's 642ms ONNX). This is the single biggest deployment blocker. On a 30-second browser recording the raw inference would be ~22 seconds, well above the 15s gate defined in section 4.5. The Kong et al. CRNN architecture was not designed for low-latency CPU inference; it processes audio in 10-second overlapping segments and uses a GRU layer that cannot be parallelised.

### 7.4 Updated deployment verdict for GAPS

| Criterion | Status |
|-----------|--------|
| Public weights | Yes — `guitar-gaps.pth` (~95 MB, HF Hub) |
| License | MIT |
| CPU support | Yes (PyTorch CPU) |
| Output → rawEvents | Yes — adapter converts MIDI velocity to amplitude proxy |
| Windows install | Yes — requires `git+github install`; not on PyPI |
| Model loads correctly | Yes — singleton loads once, ~12s init on CPU |
| **Synthetic onset F1** | **Below Basic Pitch on all categories except fast_riffs and techniques** |
| **CPU inference latency** | **7420ms — exceeds 15s gate for 30s recordings; FAILS gate** |
| **MIDI F1 on synthetic** | **8.5% — not meaningful (distribution shift)** |

**Conclusion from measured data:** GAPS does not meet the CPU latency gate (15s for a 10s clip; a 30s recording would take ~22s). Inference latency alone disqualifies it as a production replacement on CPU-only backend hardware.

The fast_riffs and techniques improvements are real signals worth preserving. If GAPS is pursued further it should be on GPU hardware or with ONNX export of the CRNN (possible but not attempted here).

### 7.5 Revised recommendation

The synthetic experiment confirms that **real recordings remain the prerequisite** — the GAPS MIDI accuracy cannot be assessed from sine signals. However, the measured 7.4s CPU latency is a hard constraint independent of recording quality:

1. **Immediate path (no model change):** Post-processing improvements to Basic Pitch that target the identified failure modes (fast riff merging via reduced `minNoteLen`, repeated-note ghost suppression via note-decay window filtering). These are pure heuristic changes requiring no new model weights.
2. **If GPU inference becomes available:** Re-evaluate GAPS on real recordings. GPU latency for this CRNN on a T4 is estimated <500ms, which would pass the gate.
3. **If CPU-only constraint is permanent:** Evaluate Basic Pitch fine-tuning (TART stage-1 approach, +4.8 F50 pts) as the latency-safe improvement path.

*Updated 2026-06-25. Architecture decision remains deferred until either real recordings are available (for MIDI accuracy) or GPU inference is provisioned (for latency).*
