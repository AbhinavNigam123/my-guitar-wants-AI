/**
 * Coach timing synchronization harness.
 *
 * Validates that a theoretically perfect performance — events generated from
 * the same timeline as expected-note onsets — yields near-zero timing drift
 * after the production alignment path (including trim restoration).
 */
import { analyzePracticeTake } from "../src/lib/coach-analysis.ts";
import {
  buildPracticeTimeline,
  buildTimingDiagnostics,
  expectedOnsetMs,
  restoreDetectedOnsets,
  synthesizePerfectPerformanceEvents,
} from "../src/lib/practice-timeline.ts";
import { STAIRWAY_TAB_NOTES } from "../src/lib/stairway-tab-data.ts";

const BPM_VALUES = [60, 71, 120];
const DRIFT_TOLERANCE_MS = 25;
const ACCURACY_MIN = 95;

const failures = [];

const EXPECTED_SYNTH = [
  { id: "n1", measure: 1, beat: 1, string: 4, fret: 2, durationBeats: 0.5 },
  { id: "n2", measure: 1, beat: 2, string: 3, fret: 0, durationBeats: 0.5 },
  { id: "n3", measure: 1, beat: 3, string: 2, fret: 1, durationBeats: 0.5 },
  { id: "n4", measure: 1, beat: 4, string: 1, fret: 0, durationBeats: 0.5 },
  { id: "n5", measure: 2, beat: 1, string: 1, fret: 3, durationBeats: 1 },
  { id: "n6", measure: 2, beat: 1, string: 2, fret: 3, durationBeats: 1 },
];

function assertPerfectCase(name, notes, bpm, beatsPerMeasure, leadingSilenceMs = 0) {
  const timeline = buildPracticeTimeline({
    bpm,
    beatsPerMeasure,
    startMeasure: 1,
    audioPreprocess: { enabled: true, trimStartMs: leadingSilenceMs },
  });

  const performanceEvents = synthesizePerfectPerformanceEvents(notes, timeline);
  // Backend reports onsets on the trimmed WAV (leading silence removed).
  const trimmedEvents = performanceEvents.map(e => ({
    ...e,
    onsetMs: e.onsetMs - leadingSilenceMs,
    endMs: e.endMs - leadingSilenceMs,
  }));
  const restored = restoreDetectedOnsets(trimmedEvents, timeline);

  const result = analyzePracticeTake({
    expectedNotes: notes,
    transcription: { noteCount: restored.length, rawEvents: restored },
    bpm,
    beatsPerMeasure,
  });

  const earlyLate = result.feedback.alignments.filter(
    a => a.status === "early" || a.status === "late",
  );
  const wrong = result.feedback.alignments.filter(a => a.status === "wrong_note");
  const missed = result.feedback.alignments.filter(a => a.status === "missed");

  if (result.metrics.timingDriftMs > DRIFT_TOLERANCE_MS) {
    failures.push(`${name}: timingDriftMs=${result.metrics.timingDriftMs} (max ${DRIFT_TOLERANCE_MS})`);
    const diag = buildTimingDiagnostics(notes, trimmedEvents, timeline, result.feedback.alignments);
    for (const row of diag.slice(0, 8)) {
      failures.push(
        `  ${row.noteId} m${row.measure} b${row.beat}: expected=${row.expectedMs}ms detected=${row.detectedMs} offset=${row.offsetMs}`,
      );
    }
  }
  if (result.metrics.accuracyPercent < ACCURACY_MIN) {
    failures.push(`${name}: accuracy=${result.metrics.accuracyPercent}% (min ${ACCURACY_MIN})`);
  }
  if (earlyLate.length > 0) {
    failures.push(`${name}: ${earlyLate.length} early/late classifications on perfect input`);
  }
  if (wrong.length > 0) {
    failures.push(`${name}: ${wrong.length} wrong_note on perfect input`);
  }
  if (missed.length > 0) {
    failures.push(`${name}: ${missed.length} missed on perfect input`);
  }
}

for (const bpm of BPM_VALUES) {
  assertPerfectCase(`synthetic-perfect/${bpm}bpm`, EXPECTED_SYNTH, bpm, 4);
}

const stairwaySlice = STAIRWAY_TAB_NOTES.filter(n => n.measure <= 2 && n.string !== 4).slice(0, 16);
assertPerfectCase("stairway-perfect/71bpm", stairwaySlice, 71, 4);

for (const leadingSilenceMs of [0, 50, 120, 308]) {
  // Skip beat-1-at-0 notes when trim would clip them; use beats 2+ (onset ≥ one beat).
  const trimSafeNotes = EXPECTED_SYNTH.filter(n => !(n.measure === 1 && n.beat === 1));
  assertPerfectCase(`trim-restore/${leadingSilenceMs}ms`, trimSafeNotes, 71, 4, leadingSilenceMs);
}

const phraseNotes = EXPECTED_SYNTH.filter(n => n.measure >= 2);
const phraseTimeline = buildPracticeTimeline({
  bpm: 71,
  beatsPerMeasure: 4,
  startMeasure: 2,
  audioPreprocess: { trimStartMs: 0 },
});
const phraseEvents = synthesizePerfectPerformanceEvents(phraseNotes, {
  ...phraseTimeline,
  phraseStartBeat: 4,
});
const phraseResult = analyzePracticeTake({
  expectedNotes: phraseNotes,
  transcription: { noteCount: phraseEvents.length, rawEvents: phraseEvents },
  bpm: 71,
  beatsPerMeasure: 4,
});
const n5expected = expectedOnsetMs(phraseNotes[0], phraseTimeline);
if (phraseEvents[0].onsetMs !== n5expected) {
  failures.push(`phrase-offset: first event ${phraseEvents[0].onsetMs} !== expected ${n5expected}`);
}
if (phraseResult.metrics.timingDriftMs > DRIFT_TOLERANCE_MS) {
  failures.push(`phrase-offset: drift=${phraseResult.metrics.timingDriftMs}`);
}

if (failures.length > 0) {
  console.log(`HARNESS FAIL - coach sync (${failures.length} failures)`);
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(1);
}

console.log(
  `HARNESS PASS - coach sync: perfect performance drift ≤${DRIFT_TOLERANCE_MS}ms ` +
  `across ${BPM_VALUES.length} BPM values + trim offsets + phrase slice`,
);
