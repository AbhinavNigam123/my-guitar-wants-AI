import {
  analyzePracticeTake,
  buildFallbackCoachTranscription,
  comparePracticeMetrics,
  rankPracticeActions,
} from "../src/lib/coach-analysis.ts";
import { deriveMeasureMastery } from "../src/lib/practice-store.ts";
import { STAIRWAY_TAB_NOTES } from "../src/lib/stairway-tab-data.ts";
import { noteAbsBeat, playableDurationSec } from "../src/lib/synth-schedule.ts";

const BPM = 120;
const BEATS = 4;
const OPEN = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

const ms = (measure, beat, bpm = BPM) => ((measure - 1) * BEATS + (beat - 1)) * (60000 / bpm);
const midi = (string, fret) => (OPEN[string] ?? 64) + fret;

const EXPECTED = [
  { id: "n1", measure: 1, beat: 1, string: 4, fret: 2, durationBeats: 0.5 },
  { id: "n2", measure: 1, beat: 2, string: 3, fret: 0, durationBeats: 0.5 },
  { id: "n3", measure: 1, beat: 3, string: 2, fret: 1, durationBeats: 0.5 },
  { id: "n4", measure: 1, beat: 4, string: 1, fret: 0, durationBeats: 0.5 },
  { id: "n5", measure: 2, beat: 1, string: 1, fret: 3, durationBeats: 1 },
  { id: "n6", measure: 2, beat: 1, string: 2, fret: 3, durationBeats: 1 },
];

const failures = [];

function runCase(name, expectedNotes, rawEvents, expectedStatuses, options = {}) {
  const result = analyzePracticeTake({
    expectedNotes,
    bpm: options.bpm ?? BPM,
    beatsPerMeasure: options.beatsPerMeasure ?? BEATS,
    transcription: { noteCount: rawEvents.length, rawEvents },
  });
  const statuses = new Map(result.feedback.alignments.map((alignment) => [alignment.tabNoteId, alignment.status]));
  for (const [id, status] of Object.entries(expectedStatuses)) {
    if (statuses.get(id) !== status) {
      failures.push(`${name}/${id}: expected ${status}, got ${statuses.get(id)}`);
    }
  }
  if (options.expectFindings !== false && (!result.feedback.findings || result.feedback.findings.length === 0)) {
    failures.push(`${name}: expected structured findings`);
  }
  if (!result.feedback.practiceActions || result.feedback.practiceActions.length < 2 || result.feedback.practiceActions.length > 3) {
    failures.push(`${name}: expected 2–3 practice actions, got ${result.feedback.practiceActions?.length ?? 0}`);
  }
  if (!result.metrics.measureResults || result.metrics.measureResults.length === 0) {
    failures.push(`${name}: expected measure-first Coach results`);
  }
  if (result.metrics.pitchCoveragePercent == null) {
    failures.push(`${name}: expected aggregate pitch coverage`);
  }
  if (!result.feedback.coachQuestions || result.feedback.coachQuestions.length < 2) {
    failures.push(`${name}: expected deterministic Coach questions`);
  }
  if (
    options.expectedLatencyCorrectionMs != null
    && result.metrics.inputLatencyCorrectionMs !== options.expectedLatencyCorrectionMs
  ) {
    failures.push(
      `${name}: expected latency correction ${options.expectedLatencyCorrectionMs}ms, got ${result.metrics.inputLatencyCorrectionMs}ms`,
    );
  }
  if (
    options.maxTimingDriftMs != null
    && result.metrics.timingDriftMs > options.maxTimingDriftMs
  ) {
    failures.push(
      `${name}: expected timing drift <=${options.maxTimingDriftMs}ms, got ${result.metrics.timingDriftMs}ms`,
    );
  }
  return result;
}

const baselineResult = runCase("baseline-statuses", EXPECTED, [
  { onsetMs: ms(1, 1) + 10, endMs: ms(1, 1) + 200, midi: midi(4, 2), amplitude: 0.8 },
  { onsetMs: ms(1, 2) - 90, endMs: ms(1, 2) + 100, midi: midi(3, 0), amplitude: 0.8 },
  { onsetMs: ms(1, 3) + 145, endMs: ms(1, 3) + 300, midi: midi(2, 1), amplitude: 0.8 },
  { onsetMs: ms(1, 4) + 20, endMs: ms(1, 4) + 180, midi: midi(1, 1), amplitude: 0.8 },
  { onsetMs: ms(2, 1) + 15, endMs: ms(2, 1) + 450, midi: midi(1, 3), amplitude: 0.8 },
], {
  n1: "correct",
  n2: "early",
  n3: "late",
  n4: "wrong_note",
  n5: "correct",
  n6: "wrong_note",
});
const baselineM1 = baselineResult.metrics.measureResults?.find(row => row.measure === 1);
if (!baselineM1 || baselineM1.scoredNoteCount !== 4) {
  failures.push(`baseline-statuses: expected four scored attacks in measure 1, got ${baselineM1?.scoredNoteCount ?? 0}`);
}
if (baselineM1 && (baselineM1.pitchCoveragePercent < 70 || baselineM1.pitchCoveragePercent > 80)) {
  failures.push(`baseline-statuses: expected 75% pitch coverage in measure 1, got ${baselineM1.pitchCoveragePercent}%`);
}
if (!baselineResult.feedback.issueClusters?.some(cluster => cluster.type === "timing")) {
  failures.push("baseline-statuses: expected a grouped timing issue");
}

runCase("strummed-chord", EXPECTED.slice(4), [
  { onsetMs: ms(2, 1) + 0, endMs: ms(2, 1) + 500, midi: midi(1, 3), amplitude: 0.76 },
  { onsetMs: ms(2, 1) + 55, endMs: ms(2, 1) + 520, midi: midi(2, 3), amplitude: 0.72 },
], {
  n5: "correct",
  n6: "correct",
}, { expectFindings: false });

runCase("quiet-note-plus-harmonic", [EXPECTED[0]], [
  { onsetMs: ms(1, 1) + 12, endMs: ms(1, 1) + 200, midi: midi(4, 2), amplitude: 0.24 },
  { onsetMs: ms(1, 1) + 19, endMs: ms(1, 1) + 160, midi: midi(4, 2) + 12, amplitude: 0.09 },
], {
  n1: "correct",
}, { expectFindings: false });

runCase("same-pitch-alternate-string", [
  { id: "alt", measure: 1, beat: 1, string: 2, fret: 5, durationBeats: 0.5 },
], [
  { onsetMs: 8, endMs: 220, midi: midi(3, 9), amplitude: 0.8 },
], {
  alt: "correct",
}, { expectFindings: false });

const unisonResult = runCase("same-onset-unison-scores-once", [
  { id: "u1", measure: 1, beat: 1, string: 1, fret: 0, durationBeats: 0.5 },
  { id: "u2", measure: 1, beat: 1, string: 2, fret: 5, durationBeats: 0.5 },
], [
  { onsetMs: 5, endMs: 220, midi: 64, amplitude: 0.8 },
], {
  u1: "correct",
  u2: "correct",
}, { expectFindings: false });
if (unisonResult.metrics.accuracyPercent !== 100) {
  failures.push(`same-onset-unison-scores-once: expected 100 accuracy, got ${unisonResult.metrics.accuracyPercent}`);
}

runCase("skipped-group-recovers", EXPECTED.slice(0, 4), [
  { onsetMs: ms(1, 1) + 8, endMs: ms(1, 1) + 200, midi: midi(4, 2), amplitude: 0.8 },
  { onsetMs: ms(1, 3) + 10, endMs: ms(1, 3) + 200, midi: midi(2, 1), amplitude: 0.8 },
  { onsetMs: ms(1, 4) + 10, endMs: ms(1, 4) + 200, midi: midi(1, 0), amplitude: 0.8 },
], {
  n1: "correct",
  n2: "missed",
  n3: "correct",
  n4: "correct",
});

// Constant ~120ms lag on every note → strip as systematic latency, not "everything late"
const CALIBRATION_NOTES = Array.from({ length: 12 }, (_, index) => ({
  id: `cal-${index}`,
  measure: Math.floor(index / 4) + 1,
  beat: (index % 4) + 1,
  string: 1,
  fret: index % 5,
  durationBeats: 0.5,
}));

function calibrationEvents(offsets, midiTransform = value => value) {
  return CALIBRATION_NOTES.map((note, index) => {
    const onsetMs = ms(note.measure, note.beat) + offsets[index];
    return {
      onsetMs,
      endMs: onsetMs + 240,
      midi: midiTransform(midi(note.string, note.fret), index),
      amplitude: 0.8,
    };
  });
}

runCase(
  "systematic-latency-120ms",
  CALIBRATION_NOTES,
  calibrationEvents(Array(12).fill(120)),
  Object.fromEntries(CALIBRATION_NOTES.map(note => [note.id, "correct"])),
  { expectFindings: false, expectedLatencyCorrectionMs: 120, maxTimingDriftMs: 1 },
);

runCase(
  "systematic-latency-with-jitter",
  CALIBRATION_NOTES,
  calibrationEvents([108, 115, 122, 128, 111, 119, 125, 132, 110, 117, 124, 130]),
  {},
  { expectFindings: false, expectedLatencyCorrectionMs: 122, maxTimingDriftMs: 8 },
);

runCase(
  "gradual-drift-is-not-calibrated",
  CALIBRATION_NOTES,
  calibrationEvents([0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176]),
  {},
  { expectFindings: false, expectedLatencyCorrectionMs: 0 },
);

runCase(
  "scattered-errors-are-not-calibrated",
  CALIBRATION_NOTES,
  calibrationEvents([-165, -130, -95, -60, -25, 10, 45, 80, 115, 145, 165, 180]),
  {},
  { expectFindings: false, expectedLatencyCorrectionMs: 0 },
);

runCase(
  "wrong-and-octave-events-cannot-calibrate",
  CALIBRATION_NOTES,
  calibrationEvents(
    Array(12).fill(120),
    (value, index) => index < 6 ? value : value + (index % 2 ? 1 : 12),
  ),
  {},
  { expectFindings: false, expectedLatencyCorrectionMs: 0 },
);

runCase(
  "latency-over-cap-is-rejected",
  CALIBRATION_NOTES,
  calibrationEvents(Array(12).fill(190)),
  {},
  { expectFindings: false, expectedLatencyCorrectionMs: 0 },
);

const CALIBRATION_SINGLES = CALIBRATION_NOTES.filter((_, index) =>
  index < 7 || index === 8,
);
const PARTIAL_CHORD_NOTES = [
  { id: "partial-a1", measure: 3, beat: 2, string: 1, fret: 0, durationBeats: 0.5 },
  { id: "partial-a2", measure: 3, beat: 2, string: 2, fret: 1, durationBeats: 0.5 },
  { id: "partial-b1", measure: 3, beat: 3, string: 1, fret: 3, durationBeats: 0.5 },
  { id: "partial-b2", measure: 3, beat: 3, string: 2, fret: 3, durationBeats: 0.5 },
];
const partialChordExpected = [...CALIBRATION_SINGLES, ...PARTIAL_CHORD_NOTES];
const partialChordEvents = [
  ...CALIBRATION_SINGLES.map(note => {
    const onsetMs = ms(note.measure, note.beat) + 120;
    return { onsetMs, endMs: onsetMs + 240, midi: midi(note.string, note.fret), amplitude: 0.8 };
  }),
  ...PARTIAL_CHORD_NOTES.filter(note => note.id.endsWith("1")).map(note => {
    const onsetMs = ms(note.measure, note.beat) + 120;
    return { onsetMs, endMs: onsetMs + 240, midi: midi(note.string, note.fret), amplitude: 0.8 };
  }),
];
runCase(
  "partial-chords-do-not-drive-calibration",
  partialChordExpected,
  partialChordEvents,
  {},
  { expectFindings: false, expectedLatencyCorrectionMs: 120 },
);

const stairwaySubset = STAIRWAY_TAB_NOTES
  .map((note, index) => ({ ...note, id: `s${index}` }));
const stairwayRaw = stairwaySubset
  .filter((_, index) => index !== 9)
  .flatMap((note, index) => {
    const base = ms(note.measure, note.beat, 71);
    const events = [{
      onsetMs: Math.round(base + (index % 6 === 0 ? 105 : 14)),
      endMs: Math.round(base + 300),
      midi: midi(note.string, note.fret),
      amplitude: 0.7,
    }];
    if (index % 13 === 0) {
      events.push({
        onsetMs: Math.round(base + 18),
        endMs: Math.round(base + 180),
        midi: midi(note.string, note.fret) + 12,
        amplitude: 0.12,
      });
    }
    return events;
  });
const stairwayResult = runCase("stairway-all-strings-fixture", stairwaySubset, stairwayRaw, {
  s0: "late",
}, { bpm: 71 });

const fallback = buildFallbackCoachTranscription(EXPECTED, BPM, BEATS);
if (fallback.rawEvents.length === 0) failures.push("fallback produced no events");
if (stairwayResult.metrics.weakestMeasure < 1) failures.push("stairway fixture produced invalid weakest measure");

assertCanonicalNote(10, 2, 3, 1);
assertCanonicalNote(12, 1, 1, 2);
assertCanonicalNote(14, 2, 3, 1);

const stairwaySecondsPerBeat = 60 / 71;
for (const note of STAIRWAY_TAB_NOTES) {
  const noteBeat = noteAbsBeat(note, BEATS);
  const next = STAIRWAY_TAB_NOTES
    .filter(candidate =>
      candidate.string === note.string
      && noteAbsBeat(candidate, BEATS) > noteBeat + 0.001,
    )
    .sort((a, b) => noteAbsBeat(a, BEATS) - noteAbsBeat(b, BEATS))[0];
  if (!next) continue;
  const duration = playableDurationSec(note, STAIRWAY_TAB_NOTES, BEATS, stairwaySecondsPerBeat);
  const gap = (noteAbsBeat(next, BEATS) - noteBeat) * stairwaySecondsPerBeat;
  if (duration > gap + 0.001) {
    failures.push(`synth schedule overlap: ${note.id} rings into ${next.id} on string ${note.string}`);
  }
}

const focusedActions = rankPracticeActions([
  { label: "Tempo", detail: "Timing", focus: "timing" },
  { label: "Notes", detail: "Pitch", focus: "pitch", measure: 2 },
  { label: "Transition", detail: "Change", focus: "transitions", measure: 3 },
], "notes");
if (focusedActions[0]?.label !== "Notes") {
  failures.push(`focus ordering: expected Notes first, got ${focusedActions[0]?.label ?? "none"}`);
}

const comparison = comparePracticeMetrics(
  {
    accuracyPercent: 86,
    timingDriftMs: 55,
    pitchCoveragePercent: 90,
    weakestMeasure: 3,
    recommendedTempoBpm: 90,
    currentTempoBpm: 90,
  },
  {
    accuracyPercent: 78,
    timingDriftMs: 82,
    pitchCoveragePercent: 80,
    weakestMeasure: 2,
    recommendedTempoBpm: 80,
    currentTempoBpm: 90,
  },
);
if (comparison?.verdict !== "improved" || !comparison.weakestMeasureChanged) {
  failures.push(`take comparison: expected improved with changed weak measure, got ${JSON.stringify(comparison)}`);
}

const masterySessions = [0, 1, 2].map(index => ({
  id: `mastery-${index}`,
  songTitle: "Harness",
  artist: "Harness",
  bpm: 90,
  beatsPerMeasure: 4,
  createdAt: 3000 - index,
  durationMs: 1000,
  accuracyPercent: 92,
  timingDriftMs: 60,
  weakestMeasure: 1,
  recommendedTempoBpm: 90,
  measureAccuracy: [{ measure: 1, accuracy: 92 }],
  measureResults: [{
    measure: 1,
    accuracyPercent: 92,
    pitchCoveragePercent: 90,
    timingDriftMs: 60,
    confidence: "high",
    scoredNoteCount: 4,
  }],
  coachedRange: { start: 1, end: 1 },
  hasAudio: false,
}));
const mastery = deriveMeasureMastery(masterySessions).find(row => row.measure === 1);
if (mastery?.level !== "mastered") {
  failures.push(`measure mastery: expected mastered, got ${mastery?.level ?? "none"}`);
}

if (failures.length > 0) {
  console.log(`HARNESS FAIL - coach (${failures.length} failures)`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  process.exit(1);
}

console.log(`HARNESS PASS - coach DP alignment scenarios (${stairwaySubset.length} Stairway all-string notes)`);

function assertCanonicalNote(measure, string, beat, fret) {
  const notes = STAIRWAY_TAB_NOTES.filter(note =>
    note.measure === measure
    && note.string === string
    && Math.abs(note.beat - beat) < 0.001,
  );
  if (notes.length !== 1 || notes[0].fret !== fret || notes[0].technique != null) {
    failures.push(
      `canonical m${measure} beat ${beat} string ${string}: expected fret ${fret} only, got ${
        notes.map(note => `${note.fret}${note.technique ? `/${note.technique}` : ""}`).join(",") || "none"
      }`,
    );
  }
}
