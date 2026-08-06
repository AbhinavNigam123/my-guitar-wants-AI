import type {
  AlignmentResult,
  CoachIssueCluster,
  CoachQuestion,
  CoachFinding,
  MeasureCoachResult,
  NoteStatus,
  PracticeAction,
  PracticeFeedback,
  PracticeFocus,
  PracticeMetrics,
  TabNote,
} from "../types/music";
import type { TranscriptionResult } from "./transcribe";
import type { MeasureHarmony } from "./theory-analysis";

const STANDARD_TUNING_BY_APP_STRING: Record<number, number> = {
  1: 64,
  2: 59,
  3: 55,
  4: 50,
  5: 45,
  6: 40,
};

type Confidence = "high" | "medium" | "low";

interface DetectedEvent {
  onsetMs: number;
  endMs?: number;
  midi: number;
  amplitude: number;
}

interface DetectedGroup {
  index: number;
  onsetMs: number;
  events: DetectedEvent[];
}

interface ExpectedGroup {
  index: number;
  measure: number;
  beat: number;
  onsetMs: number;
  notes: TabNote[];
  expectedMidi: Set<number>;
}

interface MatchedGroup {
  expected: ExpectedGroup;
  detected?: DetectedGroup;
  offsetMs: number;
  confidence: Confidence;
  ignoredArtifactCount: number;
  strongExtraCount: number;
}

interface AlignmentOperation {
  kind: "match" | "missed" | "extra";
  expected?: ExpectedGroup;
  detected?: DetectedGroup;
  cost: number;
}

interface MeasureScore {
  earned: number;
  possible: number;
  offsets: number[];
  issues: number;
}

export interface PracticeAnalysisResult {
  tabNotes: TabNote[];
  feedback: PracticeFeedback;
  metrics: PracticeMetrics;
}

export function analyzePracticeTake({
  expectedNotes,
  transcription,
  bpm,
  beatsPerMeasure = 4,
  recordingDurationMs,
  coachMeasureRange,
  theoryMeasures,
}: {
  expectedNotes: TabNote[];
  transcription: Pick<TranscriptionResult, "rawEvents" | "noteCount" | "settings">;
  bpm: number;
  beatsPerMeasure?: number;
  /** Duration of the actual recording — groups after this are left unplayed rather than marked missed. */
  recordingDurationMs?: number;
  /** Only score notes within this measure range; notes outside remain unplayed. */
  coachMeasureRange?: { start: number; end: number };
  /** Optional theory layer — enriches findings with chord-change context. */
  theoryMeasures?: MeasureHarmony[];
}): PracticeAnalysisResult {
  // Filter to only the notes the user intended to practice
  const activeNotes = coachMeasureRange
    ? expectedNotes.filter(n => n.measure >= coachMeasureRange.start && n.measure <= coachMeasureRange.end)
    : expectedNotes;

  // Recording t=0 = first beat of the coached range (or song start when unset)
  const phraseStartBeat = coachMeasureRange
    ? (coachMeasureRange.start - 1) * beatsPerMeasure
    : 0;

  const expectedGroups = groupExpectedNotes(activeNotes, bpm, beatsPerMeasure, phraseStartBeat);
  const detectedGroups = groupDetectedEvents(
    transcription.rawEvents.map((event) => ({
      onsetMs: event.onsetMs,
      endMs: event.endMs,
      midi: event.midi,
      amplitude: event.amplitude ?? 0.5,
    })),
  );
  let operations = alignGroups(expectedGroups, detectedGroups, bpm);
  const recordingCutoffMs = recordingDurationMs != null ? recordingDurationMs + 500 : Infinity;
  const initialMatchedGroups = matchedGroupsFromOperations(
    operations,
    expectedGroups,
    bpm,
    recordingCutoffMs,
  );
  const timingCalibration = estimateLatencyCalibration(initialMatchedGroups, expectedGroups);
  if (timingCalibration.correctionMs !== 0) {
    operations = alignGroups(
      expectedGroups,
      shiftDetectedGroups(detectedGroups, -timingCalibration.correctionMs),
      bpm,
    );
  }
  const scoreByMeasure = new Map<number, MeasureScore>();
  const alignments: AlignmentResult[] = [];
  const metricAlignments: AlignmentResult[] = [];
  const matchedGroups: MatchedGroup[] = [];
  const extraGroups: DetectedGroup[] = [];
  let scoredNoteCount = 0;

  // Pass 1 — build matched groups (before classifying timing)
  for (const operation of operations) {
    if (operation.kind === "extra" && operation.detected) {
      extraGroups.push(operation.detected);
      continue;
    }
    if (!operation.expected) continue;

    // If this group starts after the user stopped recording, leave its notes unplayed — don't penalise.
    if (operation.expected.onsetMs > recordingCutoffMs) continue;

    matchedGroups.push(buildMatchedGroup(operation.expected, operation.detected, expectedGroups, bpm));
  }

  // Strip systematic latency (mic lag / UI behind) when nearly every match shares the same offset
  // Pass 2: classify and score after the optional calibrated re-alignment.
  for (const matched of matchedGroups) {
    const statuses = classifyMatchedGroup(matched, bpm);
    const scoredMidi = new Set<number>();

    for (const note of matched.expected.notes) {
      const status = statuses.get(note.id) ?? "missed";
      const expectedMidi = tabNoteMidi(note);
      const detectedMidi = findDetectedMidiForNote(matched, expectedMidi);
      const alignment: AlignmentResult = {
        tabNoteId: note.id,
        status,
        timingOffsetMs: status === "missed" ? 0 : matched.offsetMs,
        expectedFrequency: midiToFrequency(expectedMidi),
        detectedFrequency: detectedMidi == null ? undefined : midiToFrequency(detectedMidi),
        confidence: matched.confidence,
      };
      alignments.push(alignment);
      if (!scoredMidi.has(expectedMidi)) {
        scoredMidi.add(expectedMidi);
        metricAlignments.push(alignment);
        addMeasureScore(scoreByMeasure, note.measure, status, matched.offsetMs);
        scoredNoteCount++;
      }
    }
  }

  const expectedCount = scoredNoteCount || 1;
  const earned = metricAlignments.reduce((sum, alignment) => sum + scoreForStatus(alignment.status), 0);
  const strongExtraCount = extraGroups.reduce((sum, group) => sum + countStrongEvents(group), 0);
  const matchedStrongExtras = matchedGroups.reduce((sum, group) => sum + group.strongExtraCount, 0);
  const extraPenalty = Math.min(expectedCount * 0.25, (strongExtraCount + matchedStrongExtras) * 0.18);
  const accuracyPercent = Math.max(0, Math.round(((earned - extraPenalty) / expectedCount) * 100));
  const timingOffsets = metricAlignments
    .filter((alignment) => alignment.status !== "missed" && alignment.status !== "wrong_note")
    .map((alignment) => Math.abs(alignment.timingOffsetMs));
  const timingDriftMs = timingOffsets.length
    ? Math.round(timingOffsets.reduce((sum, offset) => sum + offset, 0) / timingOffsets.length)
    : 0;
  const weakestMeasure = findWeakestMeasure(scoreByMeasure);
  const recommendedTempoBpm = recommendTempo(bpm, accuracyPercent, timingDriftMs);
  const measureResults = buildMeasureResults(metricAlignments, activeNotes);
  const pitchCoveragePercent = weightedMeasureAverage(measureResults, "pitchCoveragePercent");
  const findings = buildFindings({
    alignments,
    expectedNotes: activeNotes,
    matchedGroups,
    extraGroups,
    weakestMeasure,
    scoreByMeasure,
    transcription,
    theoryMeasures,
  });
  const practiceActions = buildPracticeActions({
    findings,
    weakestMeasure,
    recommendedTempoBpm,
    bpm,
  });
  const issueClusters = buildIssueClusters(findings, measureResults, theoryMeasures);
  const coachQuestions = buildCoachQuestions({
    accuracyPercent,
    timingDriftMs,
    pitchCoveragePercent,
    weakestMeasure,
    issueClusters,
    recommendedTempoBpm,
  });
  const feedback = buildFeedback({
    alignments,
    expectedNotes: activeNotes,
    weakestMeasure,
    accuracyPercent,
    timingDriftMs,
    recommendedTempoBpm,
    extraCount: strongExtraCount + matchedStrongExtras,
    findings,
    practiceActions,
    issueClusters,
    coachQuestions,
  });

  const alignmentById = new Map(alignments.map(a => [a.tabNoteId, a.status]));
  return {
    // All original notes: active ones get their status, outside-range notes stay unplayed
    tabNotes: expectedNotes.map((note) => ({
      ...note,
      status: alignmentById.get(note.id) ?? "unplayed",
    })),
    feedback,
    metrics: {
      accuracyPercent,
      timingDriftMs,
      inputLatencyCorrectionMs: timingCalibration.correctionMs,
      timingCalibrationSampleCount: timingCalibration.sampleCount,
      weakestMeasure,
      recommendedTempoBpm,
      currentTempoBpm: Math.round(bpm),
      pitchCoveragePercent,
      measureResults,
    },
  };
}

/**
 * Generates deterministic synthetic raw events from expected tab notes.
 * Used by the coach harness (benchmarks/run_coach_harness.mjs) as test data only.
 * Do NOT call this in the production coach flow — real transcription must always be used.
 */
export function buildFallbackCoachTranscription(
  expectedNotes: TabNote[],
  bpm: number,
  beatsPerMeasure = 4,
): Pick<TranscriptionResult, "rawEvents" | "noteCount"> {
  const msPerBeat = 60000 / bpm;
  const rawEvents = expectedNotes
    .filter((note, index) => index % 17 !== 0)
    .flatMap((note, index) => {
      const baseMs = ((note.measure - 1) * beatsPerMeasure + (note.beat - 1)) * msPerBeat;
      const drift = index % 11 === 0 ? 145 : index % 7 === 0 ? -90 : 18;
      const midi = tabNoteMidi(note) + (index % 23 === 0 ? 1 : 0);
      const events = [{
        onsetMs: Math.max(0, Math.round(baseMs + drift)),
        endMs: Math.max(0, Math.round(baseMs + drift + note.durationBeats * msPerBeat)),
        midi,
        amplitude: 0.82,
      }];
      if (index % 19 === 0) {
        events.push({
          onsetMs: Math.max(0, Math.round(baseMs + drift + 12)),
          endMs: Math.max(0, Math.round(baseMs + drift + 130)),
          midi: tabNoteMidi(note) + 12,
          amplitude: 0.18,
        });
      }
      return events;
    });

  return { rawEvents, noteCount: rawEvents.length };
}

function groupExpectedNotes(
  notes: TabNote[],
  bpm: number,
  beatsPerMeasure: number,
  phraseStartBeat = 0,
): ExpectedGroup[] {
  const msPerBeat = 60000 / bpm;
  const map = new Map<string, ExpectedGroup>();

  for (const note of notes) {
    const beatKey = Math.round(note.beat * 1000) / 1000;
    const key = `${note.measure}:${beatKey}`;
    const absBeat = (note.measure - 1) * beatsPerMeasure + (note.beat - 1);
    const onsetMs = Math.round((absBeat - phraseStartBeat) * msPerBeat);
    const group = map.get(key) ?? {
      index: 0,
      measure: note.measure,
      beat: note.beat,
      onsetMs,
      notes: [],
      expectedMidi: new Set<number>(),
    };
    group.notes.push(note);
    group.expectedMidi.add(tabNoteMidi(note));
    map.set(key, group);
  }

  return [...map.values()]
    .sort((a, b) => a.onsetMs - b.onsetMs)
    .map((group, index) => ({ ...group, index }));
}

function groupDetectedEvents(events: DetectedEvent[], windowMs = 85): DetectedGroup[] {
  const sorted = [...events].sort((a, b) => a.onsetMs - b.onsetMs);
  const groups: DetectedGroup[] = [];

  for (const event of sorted) {
    const last = groups[groups.length - 1];
    if (last && event.onsetMs - last.onsetMs <= windowMs) {
      last.events.push(event);
      last.onsetMs = Math.round(
        last.events.reduce((sum, member) => sum + member.onsetMs, 0) / last.events.length,
      );
    } else {
      groups.push({ index: groups.length, onsetMs: event.onsetMs, events: [event] });
    }
  }

  return groups;
}

function alignGroups(expected: ExpectedGroup[], detected: DetectedGroup[], bpm: number): AlignmentOperation[] {
  const rows = expected.length + 1;
  const cols = detected.length + 1;
  const costs = Array.from({ length: rows }, () => Array(cols).fill(Number.POSITIVE_INFINITY));
  const back = Array.from({ length: rows }, () => Array<AlignmentOperation | undefined>(cols).fill(undefined));
  costs[0][0] = 0;

  for (let i = 0; i <= expected.length; i++) {
    for (let j = 0; j <= detected.length; j++) {
      const base = costs[i][j];
      if (!Number.isFinite(base)) continue;

      if (i < expected.length) {
        relax(costs, back, i + 1, j, base + missedCost(expected[i]), {
          kind: "missed",
          expected: expected[i],
          cost: missedCost(expected[i]),
        });
      }

      if (j < detected.length) {
        const cost = extraCost(detected[j]);
        relax(costs, back, i, j + 1, base + cost, {
          kind: "extra",
          detected: detected[j],
          cost,
        });
      }

      if (i < expected.length && j < detected.length) {
        const cost = matchCost(expected[i], detected[j], expected, bpm);
        if (Number.isFinite(cost)) {
          relax(costs, back, i + 1, j + 1, base + cost, {
            kind: "match",
            expected: expected[i],
            detected: detected[j],
            cost,
          });
        }
      }
    }
  }

  const operations: AlignmentOperation[] = [];
  let i = expected.length;
  let j = detected.length;
  while (i > 0 || j > 0) {
    const operation = back[i][j];
    if (!operation) break;
    operations.push(operation);
    if (operation.kind === "match") {
      i -= 1;
      j -= 1;
    } else if (operation.kind === "missed") {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return operations.reverse();
}

function relax(
  costs: number[][],
  back: (AlignmentOperation | undefined)[][],
  i: number,
  j: number,
  candidate: number,
  operation: AlignmentOperation,
) {
  if (candidate < costs[i][j]) {
    costs[i][j] = candidate;
    back[i][j] = operation;
  }
}

function matchCost(expected: ExpectedGroup, detected: DetectedGroup, allExpected: ExpectedGroup[], bpm: number): number {
  const offset = detected.onsetMs - expected.onsetMs;
  const maxWindow = maxMatchWindowMs(bpm);
  if (Math.abs(offset) > maxWindow) return Number.POSITIVE_INFINITY;

  const evidence = eventEvidence(expected, detected, allExpected);
  const timingCost = Math.min(1.8, Math.abs(offset) / correctTimingWindowMs(bpm));
  const missedCount = expected.expectedMidi.size - evidence.exactHits.size;
  const missedPitchCost = missedCount * 1.25;
  const wrongCost = evidence.strongWrongEvents.length * 0.55;
  const artifactCredit = Math.min(0.3, evidence.ignoredArtifacts.length * 0.08);
  return timingCost + missedPitchCost + wrongCost - artifactCredit;
}

function missedCost(expected: ExpectedGroup): number {
  return expected.expectedMidi.size > 1 ? 2.7 : 2.25;
}

function extraCost(detected: DetectedGroup): number {
  return countStrongEvents(detected) > 0 ? 1.1 : 0.35;
}

function buildMatchedGroup(
  expected: ExpectedGroup,
  detected: DetectedGroup | undefined,
  allExpected: ExpectedGroup[],
  bpm: number,
): MatchedGroup {
  if (!detected) {
    return {
      expected,
      offsetMs: 0,
      confidence: "high",
      ignoredArtifactCount: 0,
      strongExtraCount: 0,
    };
  }

  const evidence = eventEvidence(expected, detected, allExpected);
  const offsetMs = Math.round(detected.onsetMs - expected.onsetMs);
  const matched: MatchedGroup = {
    expected,
    detected,
    offsetMs,
    confidence: "low",
    ignoredArtifactCount: evidence.ignoredArtifacts.length,
    strongExtraCount: evidence.strongWrongEvents.length,
  };
  matched.confidence = confidenceForMatch(matched, bpm);
  return matched;
}

/** Build the initial exact-pitch evidence set used for latency calibration. */
function matchedGroupsFromOperations(
  operations: AlignmentOperation[],
  expectedGroups: ExpectedGroup[],
  bpm: number,
  recordingCutoffMs: number,
): MatchedGroup[] {
  return operations
    .filter((operation) =>
      operation.expected != null && operation.expected.onsetMs <= recordingCutoffMs,
    )
    .map((operation) =>
      buildMatchedGroup(operation.expected!, operation.detected, expectedGroups, bpm),
    );
}

function shiftDetectedGroups(groups: DetectedGroup[], shiftMs: number): DetectedGroup[] {
  return groups.map((group) => ({
    ...group,
    onsetMs: group.onsetMs + shiftMs,
    events: group.events.map((event) => ({
      ...event,
      onsetMs: event.onsetMs + shiftMs,
      endMs: event.endMs == null ? undefined : event.endMs + shiftMs,
    })),
  }));
}

function estimateLatencyCalibration(
  matchedGroups: MatchedGroup[],
  allExpected: ExpectedGroup[],
): { correctionMs: number; sampleCount: number } {
  const candidates = matchedGroups.filter((group) => {
    if (!group.detected || Math.abs(group.offsetMs) > 180) return false;
    const evidence = eventEvidence(group.expected, group.detected, allExpected);
    if (
      evidence.exactHits.size !== group.expected.expectedMidi.size
      || evidence.strongWrongEvents.length > 0
      || evidence.ignoredArtifacts.length > 0
    ) {
      return false;
    }
    return group.detected.events.some((event) =>
      group.expected.expectedMidi.has(event.midi) && event.amplitude >= 0.22,
    );
  });

  const measureCount = new Set(candidates.map((group) => group.expected.measure)).size;
  if (candidates.length < 8 || measureCount < 3) {
    return { correctionMs: 0, sampleCount: candidates.length };
  }

  const offsets = candidates.map((group) => group.offsetMs).sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)];
  if (Math.abs(median) < 35 || Math.abs(median) > 180) {
    return { correctionMs: 0, sampleCount: candidates.length };
  }

  const cluster = candidates.filter((group) => Math.abs(group.offsetMs - median) <= 45);
  if (cluster.length / candidates.length < 0.6) {
    return { correctionMs: 0, sampleCount: candidates.length };
  }

  const clusterOffsets = cluster.map((group) => group.offsetMs).sort((a, b) => a - b);
  return {
    correctionMs: clusterOffsets[Math.floor(clusterOffsets.length / 2)],
    sampleCount: cluster.length,
  };
}

function confidenceForMatch(matched: MatchedGroup, bpm: number): Confidence {
  if (!matched.detected) return "high";
  const pitchCoverage = matched.expected.expectedMidi.size === 0
    ? 0
    : [...matched.expected.expectedMidi].filter((midi) =>
        matched.detected!.events.some((event) => event.midi === midi),
      ).length / matched.expected.expectedMidi.size;
  const timingAbs = Math.abs(matched.offsetMs);
  if (pitchCoverage === 1 && timingAbs <= correctTimingWindowMs(bpm)) return "high";
  if (pitchCoverage >= 0.5 && timingAbs <= severeTimingWindowMs(bpm)) return "medium";
  return "low";
}

function classifyMatchedGroup(matched: MatchedGroup, bpm: number): Map<string, NoteStatus> {
  const statusByNote = new Map<string, NoteStatus>();
  const expected = matched.expected;

  if (!matched.detected) {
    expected.notes.forEach((note) => statusByNote.set(note.id, "missed"));
    return statusByNote;
  }

  const detectedMidi = new Set(matched.detected.events.map((event) => event.midi));
  const timingStatus = timingStatusForOffset(matched.offsetMs, bpm);
  for (const note of expected.notes) {
    statusByNote.set(note.id, detectedMidi.has(tabNoteMidi(note)) ? timingStatus : "wrong_note");
  }

  return statusByNote;
}

function eventEvidence(expected: ExpectedGroup, detected: DetectedGroup, allExpected: ExpectedGroup[]) {
  const maxAmp = Math.max(...detected.events.map((event) => event.amplitude), 0.01);
  const localMidi = localExpectedMidi(expected.index, allExpected);
  const exactHits = new Set<number>();
  const ignoredArtifacts: DetectedEvent[] = [];
  const strongWrongEvents: DetectedEvent[] = [];

  for (const event of detected.events) {
    if (expected.expectedMidi.has(event.midi)) {
      exactHits.add(event.midi);
      continue;
    }
    if (isLikelyArtifact(event, expected.expectedMidi, maxAmp)) {
      ignoredArtifacts.push(event);
      continue;
    }
    if (!localMidi.has(event.midi) && event.amplitude < maxAmp * 0.72) {
      ignoredArtifacts.push(event);
      continue;
    }
    strongWrongEvents.push(event);
  }

  return { exactHits, ignoredArtifacts, strongWrongEvents };
}

function localExpectedMidi(index: number, groups: ExpectedGroup[]): Set<number> {
  const local = new Set<number>();
  for (let i = Math.max(0, index - 1); i <= Math.min(groups.length - 1, index + 1); i++) {
    groups[i].expectedMidi.forEach((midi) => local.add(midi));
  }
  return local;
}

function isLikelyArtifact(event: DetectedEvent, expectedMidi: Set<number>, maxAmp: number): boolean {
  if (event.amplitude >= maxAmp * 0.58) return false;
  for (const expected of expectedMidi) {
    const interval = Math.abs(event.midi - expected);
    if (interval === 12 || interval === 19 || interval === 24) return true;
  }
  return false;
}

function findDetectedMidiForNote(matched: MatchedGroup, expectedMidi: number): number | undefined {
  if (!matched.detected) return undefined;
  return matched.detected.events.find((event) => event.midi === expectedMidi)?.midi
    ?? matched.detected.events[0]?.midi;
}

function addMeasureScore(scores: Map<number, MeasureScore>, measure: number, status: NoteStatus, offsetMs: number) {
  const score = scores.get(measure) ?? { earned: 0, possible: 0, offsets: [], issues: 0 };
  score.earned += scoreForStatus(status);
  score.possible += 1;
  if (status !== "missed") score.offsets.push(Math.abs(offsetMs));
  if (status !== "correct") score.issues += 1;
  scores.set(measure, score);
}

function countStrongEvents(group: DetectedGroup): number {
  const maxAmp = Math.max(...group.events.map((event) => event.amplitude), 0.01);
  return group.events.filter((event) => event.amplitude >= Math.max(0.22, maxAmp * 0.55)).length;
}

function timingStatusForOffset(offsetMs: number, bpm: number): NoteStatus {
  const abs = Math.abs(offsetMs);
  const correct = correctTimingWindowMs(bpm);
  if (abs <= correct) return "correct";
  return offsetMs < 0 ? "early" : "late";
}

function correctTimingWindowMs(bpm: number): number {
  return Math.round(scaleTimingWindow(65, bpm));
}

function severeTimingWindowMs(bpm: number): number {
  return Math.round(scaleTimingWindow(135, bpm));
}

function maxMatchWindowMs(bpm: number): number {
  return Math.round(scaleTimingWindow(460, bpm));
}

function scaleTimingWindow(baseMs: number, bpm: number): number {
  const factor = Math.max(0.8, Math.min(1.35, 100 / Math.max(40, bpm)));
  return baseMs * factor;
}

function tabNoteMidi(note: TabNote): number {
  return (STANDARD_TUNING_BY_APP_STRING[note.string] ?? 64) + note.fret;
}

function midiToFrequency(midi: number): number {
  return Math.round(440 * 2 ** ((midi - 69) / 12) * 100) / 100;
}

function scoreForStatus(status: NoteStatus): number {
  switch (status) {
    case "correct":
      return 1;
    case "early":
    case "late":
      return 0.7;
    case "wrong_note":
      return 0.25;
    case "missed":
    case "unplayed":
      return 0;
  }
}

function findWeakestMeasure(scores: Map<number, MeasureScore>): number {
  let weakest = 1;
  let weakestScore = Number.POSITIVE_INFINITY;

  for (const [measure, score] of scores) {
    const pct = score.possible ? score.earned / score.possible : 0;
    const adjusted = pct - score.issues * 0.02;
    if (adjusted < weakestScore) {
      weakest = measure;
      weakestScore = adjusted;
    }
  }

  return weakest;
}

function recommendTempo(bpm: number, accuracyPercent: number, timingDriftMs: number): number {
  if (accuracyPercent >= 85 && timingDriftMs <= 75) return Math.round(bpm);
  if (accuracyPercent >= 70) return Math.max(45, Math.round(bpm * 0.85));
  return Math.max(45, Math.round(bpm * 0.7));
}

function buildMeasureResults(
  alignments: AlignmentResult[],
  expectedNotes: TabNote[],
): MeasureCoachResult[] {
  const noteById = new Map(expectedNotes.map((note) => [note.id, note]));
  const grouped = new Map<number, AlignmentResult[]>();
  for (const alignment of alignments) {
    const measure = noteById.get(alignment.tabNoteId)?.measure;
    if (measure == null) continue;
    const rows = grouped.get(measure) ?? [];
    rows.push(alignment);
    grouped.set(measure, rows);
  }

  return [...grouped.entries()].map(([measure, rows]) => {
    const timingRows = rows.filter(row => row.status !== "missed" && row.status !== "wrong_note");
    const covered = rows.filter(row =>
      row.status === "correct" || row.status === "early" || row.status === "late"
    ).length;
    const lowCount = rows.filter(row => row.confidence === "low").length;
    const highCount = rows.filter(row => row.confidence === "high").length;
    return {
      measure,
      accuracyPercent: Math.round(
        rows.reduce((sum, row) => sum + scoreForStatus(row.status), 0) / rows.length * 100,
      ),
      pitchCoveragePercent: Math.round(covered / rows.length * 100),
      timingDriftMs: timingRows.length
        ? Math.round(timingRows.reduce((sum, row) => sum + Math.abs(row.timingOffsetMs), 0) / timingRows.length)
        : 0,
      confidence: lowCount / rows.length >= 0.35
        ? "low"
        : highCount / rows.length >= 0.7 ? "high" : "medium",
      scoredNoteCount: rows.length,
    } satisfies MeasureCoachResult;
  }).sort((a, b) => a.measure - b.measure);
}

function weightedMeasureAverage(
  results: MeasureCoachResult[],
  key: "accuracyPercent" | "pitchCoveragePercent",
): number {
  const count = results.reduce((sum, result) => sum + result.scoredNoteCount, 0);
  if (count === 0) return 0;
  return Math.round(
    results.reduce((sum, result) => sum + result[key] * result.scoredNoteCount, 0) / count,
  );
}

function buildIssueClusters(
  findings: CoachFinding[],
  measureResults: MeasureCoachResult[],
  theoryMeasures?: MeasureHarmony[],
): CoachIssueCluster[] {
  const clusters: CoachIssueCluster[] = [];
  const detector = findings.filter(finding => finding.type === "detector_quality");
  const timing = findings.filter(finding => finding.type === "early" || finding.type === "late");
  const pitch = findings.filter(finding =>
    finding.type === "missed" || finding.type === "wrong_pitch" || finding.type === "extra"
  );
  const transitionMeasures = [...new Set(findings
    .filter(finding => finding.theoryHint)
    .map(finding => finding.measure))];

  if (detector.length > 0) {
    clusters.push({
      id: "detector-quality",
      type: "detector_quality",
      title: "Audio confidence",
      summary: detector[0].message,
      measures: [...new Set(detector.map(finding => finding.measure))],
      severity: detector.some(finding => finding.severity === "high") ? "high" : "medium",
      evidenceCount: detector.length,
    });
  }
  if (transitionMeasures.length > 0) {
    const chords = transitionMeasures
      .map(measure => theoryMeasures?.find(row => row.measure === measure)?.chord)
      .filter((chord): chord is string => Boolean(chord && chord !== "?"));
    clusters.push({
      id: "transitions",
      type: "transition",
      title: "Chord transitions",
      summary: chords.length
        ? `The change into ${[...new Set(chords)].slice(0, 2).join(" / ")} needs the cleanest landing.`
        : "The weakest pitch evidence is concentrated around a measure change.",
      measures: transitionMeasures,
      severity: "high",
      evidenceCount: transitionMeasures.length,
    });
  }
  if (timing.length > 0) {
    const measures = [...new Set(timing.map(finding => finding.measure))];
    const direction = timing.filter(finding => finding.type === "late").length >= timing.length / 2
      ? "late"
      : "early";
    clusters.push({
      id: "timing",
      type: "timing",
      title: direction === "late" ? "Late attacks" : "Early attacks",
      summary: `${timing.length} timing signal${timing.length === 1 ? "" : "s"} cluster in measure${measures.length === 1 ? "" : "s"} ${measures.join(", ")}.`,
      measures,
      severity: timing.some(finding => finding.severity === "high") ? "high" : "medium",
      evidenceCount: timing.length,
    });
  }
  if (pitch.length > 0) {
    const measures = [...new Set(pitch.map(finding => finding.measure))];
    const weakestCoverage = measureResults
      .filter(result => measures.includes(result.measure))
      .sort((a, b) => a.pitchCoveragePercent - b.pitchCoveragePercent)[0];
    clusters.push({
      id: "pitch-coverage",
      type: "pitch_coverage",
      title: "Pitch coverage",
      summary: weakestCoverage
        ? `Measure ${weakestCoverage.measure} supported ${weakestCoverage.pitchCoveragePercent}% of its expected pitches.`
        : "Some expected pitches were missing or replaced by different detected pitches.",
      measures,
      severity: pitch.some(finding => finding.severity === "high") ? "high" : "medium",
      evidenceCount: pitch.length,
    });
  }
  return clusters.slice(0, 3);
}

function buildCoachQuestions({
  accuracyPercent,
  timingDriftMs,
  pitchCoveragePercent,
  weakestMeasure,
  issueClusters,
  recommendedTempoBpm,
}: {
  accuracyPercent: number;
  timingDriftMs: number;
  pitchCoveragePercent: number;
  weakestMeasure: number;
  issueClusters: CoachIssueCluster[];
  recommendedTempoBpm: number;
}): CoachQuestion[] {
  const topIssue = issueClusters[0];
  return [
    {
      id: "why-score",
      question: "Why did I get this score?",
      answer: `The score comes from expected-note alignment. This take reached ${accuracyPercent}% accuracy, ${pitchCoveragePercent}% pitch coverage, and ${timingDriftMs}ms average timing drift.`,
    },
    {
      id: "practice-next",
      question: "What should I practice next?",
      answer: topIssue
        ? `${topIssue.title} is the clearest pattern. Start with measure ${topIssue.measures[0] ?? weakestMeasure} at ${recommendedTempoBpm} BPM.`
        : "Keep the full phrase steady, then raise the tempo only after another consistent take.",
    },
    {
      id: "string-certainty",
      question: "Does this know which string I played?",
      answer: "No. Colors show how detected pitch and timing aligned with each expected tab note; they do not claim which physical string produced the sound.",
    },
  ];
}

export function rankPracticeActions(
  actions: PracticeAction[],
  focus: PracticeFocus,
): PracticeAction[] {
  const rank = (action: PracticeAction) => {
    if (focus === "full") return action.measure == null ? 0 : 1;
    if (focus === "notes") return action.focus === "pitch" || action.focus === "notes" ? 0 : 1;
    if (focus === "timing") return action.focus === "timing" ? 0 : 1;
    return action.focus === "transitions" || action.measure != null ? 0 : 1;
  };
  return actions
    .map((action, index) => ({ action, index, rank: rank(action) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(row => row.action);
}

export interface PracticeComparison {
  verdict: "improved" | "mixed" | "repeat";
  accuracyDelta: number;
  timingDeltaMs: number;
  pitchCoverageDelta: number;
  weakestMeasureChanged: boolean;
}

export function comparePracticeMetrics(
  current: PracticeMetrics,
  previous?: PracticeMetrics | null,
): PracticeComparison | null {
  if (!previous) return null;
  const accuracyDelta = current.accuracyPercent - previous.accuracyPercent;
  const timingDeltaMs = current.timingDriftMs - previous.timingDriftMs;
  const pitchCoverageDelta =
    (current.pitchCoveragePercent ?? current.accuracyPercent)
    - (previous.pitchCoveragePercent ?? previous.accuracyPercent);
  const improvedSignals = [accuracyDelta >= 3, timingDeltaMs <= -10, pitchCoverageDelta >= 3].filter(Boolean).length;
  const regressedSignals = [accuracyDelta <= -3, timingDeltaMs >= 10, pitchCoverageDelta <= -3].filter(Boolean).length;
  return {
    verdict: improvedSignals >= 2 ? "improved" : regressedSignals >= 2 ? "repeat" : "mixed",
    accuracyDelta,
    timingDeltaMs,
    pitchCoverageDelta,
    weakestMeasureChanged: current.weakestMeasure !== previous.weakestMeasure,
  };
}

function buildFindings({
  alignments,
  expectedNotes,
  matchedGroups,
  extraGroups,
  weakestMeasure,
  scoreByMeasure,
  transcription,
  theoryMeasures,
}: {
  alignments: AlignmentResult[];
  expectedNotes: TabNote[];
  matchedGroups: MatchedGroup[];
  extraGroups: DetectedGroup[];
  weakestMeasure: number;
  scoreByMeasure: Map<number, MeasureScore>;
  transcription: Pick<TranscriptionResult, "rawEvents" | "noteCount" | "settings">;
  theoryMeasures?: MeasureHarmony[];
}): CoachFinding[] {
  const notesById = new Map(expectedNotes.map((note) => [note.id, note]));
  const findings: CoachFinding[] = [];
  const firstByStatus = (status: NoteStatus) => alignments.find((alignment) => alignment.status === status);

  const missed = firstByStatus("missed");
  const wrong = firstByStatus("wrong_note");
  const early = firstByStatus("early");
  const late = firstByStatus("late");
  const maxAmplitude = Math.max(...transcription.rawEvents.map((event) => event.amplitude ?? 0), 0);
  const lowConfidenceAlignments = alignments.filter((alignment) => alignment.confidence === "low").length;

  if (transcription.rawEvents.length === 0) {
    findings.push({
      type: "detector_quality",
      measure: 1,
      severity: "high",
      message: "No reliable note events were detected. Check input level and mic placement before trusting the take.",
    });
  } else if (maxAmplitude < 0.2) {
    findings.push({
      type: "detector_quality",
      measure: 1,
      severity: "medium",
      message: "The detector saw a quiet signal. Move closer to the mic or raise input gain for a cleaner read.",
    });
  } else if (alignments.length > 0 && lowConfidenceAlignments / alignments.length >= 0.35) {
    findings.push({
      type: "detector_quality",
      measure: weakestMeasure,
      severity: "medium",
      message: "Several notes matched with low confidence, so pitch-specific feedback may be less reliable on this take.",
    });
  }

  if (missed) {
    const note = notesById.get(missed.tabNoteId);
    if (note) {
      const theory = chordChangeHint(note, theoryMeasures);
      const message = theory
        ? `Missed the root of ${theory.chord} at measure ${note.measure}${theory.prevChord ? ` (chord change from ${theory.prevChord})` : ""}.`
        : `Expected note missing at measure ${note.measure}, beat ${note.beat}.`;
      findings.push({
        ...noteFinding("missed", note, "high", message),
        theoryHint: theory ? { chord: theory.chord, measure: note.measure } : undefined,
      });
    }
  }
  if (wrong) {
    const note = notesById.get(wrong.tabNoteId);
    if (note) {
      const theory = chordChangeHint(note, theoryMeasures);
      const message = theory
        ? `Pitch mismatch on ${theory.chord} at measure ${note.measure} — check the expected shape.`
        : `Pitch mismatch at measure ${note.measure}, beat ${note.beat} — check the expected note.`;
      findings.push({
        ...noteFinding("wrong_pitch", note, "high", message),
        theoryHint: theory ? { chord: theory.chord, measure: note.measure } : undefined,
      });
    }
  }
  if (early) {
    const note = notesById.get(early.tabNoteId);
    if (note) findings.push(noteFinding("early", note, "medium", `Attack is early at measure ${note.measure}, beat ${note.beat}.`));
  }
  if (late) {
    const note = notesById.get(late.tabNoteId);
    if (note) findings.push(noteFinding("late", note, "medium", `Attack is late at measure ${note.measure}, beat ${note.beat}.`));
  }

  const strongExtras = extraGroups.reduce((sum, group) => sum + countStrongEvents(group), 0)
    + matchedGroups.reduce((sum, group) => sum + group.strongExtraCount, 0);
  if (strongExtras > 0) {
    const measure = nearestMeasureForExtra(extraGroups[0], matchedGroups) ?? weakestMeasure;
    findings.push({
      type: "extra",
      measure,
      severity: strongExtras >= 3 ? "high" : "medium",
      message: `${strongExtras} extra detected event${strongExtras === 1 ? "" : "s"} did not belong to the expected tab.`,
    });
  }

  const weakest = scoreByMeasure.get(weakestMeasure);
  if (weakest && weakest.possible > 0 && weakest.earned / weakest.possible < 0.85) {
    const mh = theoryMeasures?.find(m => m.measure === weakestMeasure);
    findings.push({
      type: "weak_measure",
      measure: weakestMeasure,
      severity: weakest.earned / weakest.possible < 0.55 ? "high" : "medium",
      message: mh && mh.chord && mh.chord !== "?"
        ? `Measure ${weakestMeasure} (${mh.chord}) is the weakest section of this take.`
        : `Measure ${weakestMeasure} is the weakest section of this take.`,
      theoryHint: mh && mh.chord && mh.chord !== "?"
        ? { chord: mh.chord, measure: weakestMeasure }
        : undefined,
    });
  }

  return findings.slice(0, 6);
}

/** If a note sits on beat 1 of a measure whose chord differs from the previous measure, return chord-change context. */
function chordChangeHint(
  note: TabNote,
  theoryMeasures?: MeasureHarmony[],
): { chord: string; prevChord?: string } | null {
  if (!theoryMeasures || theoryMeasures.length === 0) return null;
  // Only enrich notes near the start of a measure (chord-change landing zone)
  if (note.beat > 1.5) return null;
  const current = theoryMeasures.find(m => m.measure === note.measure);
  if (!current || !current.chord || current.chord === "?") return null;
  const prev = theoryMeasures.find(m => m.measure === note.measure - 1);
  if (prev && prev.chord === current.chord) return null; // same chord — not a change
  return {
    chord: current.chord,
    prevChord: prev && prev.chord !== "?" ? prev.chord : undefined,
  };
}

function noteFinding(type: CoachFinding["type"], note: TabNote, severity: CoachFinding["severity"], message: string): CoachFinding {
  return { type, measure: note.measure, beat: note.beat, severity, message };
}

function nearestMeasureForExtra(extra: DetectedGroup | undefined, matchedGroups: MatchedGroup[]): number | undefined {
  if (!extra) return undefined;
  let best: MatchedGroup | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const group of matchedGroups) {
    const distance = Math.abs(group.expected.onsetMs - extra.onsetMs);
    if (distance < bestDistance) {
      best = group;
      bestDistance = distance;
    }
  }
  return best?.expected.measure;
}

function buildPracticeActions({
  findings,
  weakestMeasure,
  recommendedTempoBpm,
  bpm,
}: {
  findings: CoachFinding[];
  weakestMeasure: number;
  recommendedTempoBpm: number;
  bpm: number;
}): PracticeAction[] {
  const pitchFinding = findings.find((finding) => finding.type === "wrong_pitch" || finding.type === "missed");
  const timingFinding = findings.find((finding) => finding.type === "early" || finding.type === "late");
  const actions: PracticeAction[] = [
    {
      label: `Loop measure ${weakestMeasure}`,
      detail: `Repeat measure ${weakestMeasure} until every expected attack is present before running the full phrase.`,
      measure: weakestMeasure,
      targetBpm: recommendedTempoBpm,
      focus: (pitchFinding ? "pitch" : "timing") as "pitch" | "timing",
      availableActions: ["reference", "take", "compare", "loop", "slow", "record"],
    },
    {
      label: `Drop to ${recommendedTempoBpm} BPM`,
      detail: recommendedTempoBpm < Math.round(bpm)
        ? `Practice slower first; raise tempo only after timing drift stays under 75ms.`
        : `Keep this tempo and focus on cleaner note starts.`,
      targetBpm: recommendedTempoBpm,
      focus: "timing" as const,
      availableActions: ["reference", "loop", "slow", "record"],
    },
  ];

  // Third slot is only a real drill (loop a specific problem measure) — never generic advice
  if (pitchFinding?.measure != null) {
    actions.push({
      label: `Fix pitch — measure ${pitchFinding.measure}`,
      detail: pitchFinding.message,
      measure: pitchFinding.measure,
      targetBpm: recommendedTempoBpm,
      focus: "pitch",
      availableActions: ["reference", "take", "compare", "loop", "record"],
    });
  } else if (timingFinding?.measure != null) {
    actions.push({
      label: `Tighten measure ${timingFinding.measure}`,
      detail: timingFinding.message,
      measure: timingFinding.measure,
      targetBpm: recommendedTempoBpm,
      focus: "timing",
      availableActions: ["reference", "take", "compare", "loop", "slow", "record"],
    });
  }

  return actions;
}

function buildFeedback({
  alignments,
  expectedNotes,
  weakestMeasure,
  accuracyPercent,
  timingDriftMs,
  recommendedTempoBpm,
  extraCount,
  findings,
  practiceActions,
  issueClusters,
  coachQuestions,
}: {
  alignments: AlignmentResult[];
  expectedNotes: TabNote[];
  weakestMeasure: number;
  accuracyPercent: number;
  timingDriftMs: number;
  recommendedTempoBpm: number;
  extraCount: number;
  findings: CoachFinding[];
  practiceActions: PracticeAction[];
  issueClusters: CoachIssueCluster[];
  coachQuestions: CoachQuestion[];
}): PracticeFeedback {
  const byId = new Map(expectedNotes.map((note) => [note.id, note]));
  const missed = alignments.filter((alignment) => alignment.status === "missed");
  const wrong = alignments.filter((alignment) => alignment.status === "wrong_note");
  const early = alignments.filter((alignment) => alignment.status === "early");
  const late = alignments.filter((alignment) => alignment.status === "late");
  const firstIssue = [...missed, ...wrong, ...late, ...early][0];
  const firstIssueNote = firstIssue ? byId.get(firstIssue.tabNoteId) : undefined;
  const issueLocation = firstIssueNote
    ? `measure ${firstIssueNote.measure}, beat ${firstIssueNote.beat}`
    : `measure ${weakestMeasure}`;

  const tips = [
    practiceActions[0]?.detail ?? `Loop measure ${weakestMeasure} at ${recommendedTempoBpm} BPM.`,
    missed.length
      ? `${missed.length} expected note${missed.length === 1 ? "" : "s"} did not appear in the take. Start by isolating ${issueLocation}.`
      : `Your pitch coverage is mostly there; focus on placing attacks closer to the grid.`,
    wrong.length
      ? `${wrong.length} note${wrong.length === 1 ? "" : "s"} landed on a different pitch. Check the fretting shape before speeding up.`
      : `Keep the fretting shape stable and listen for even string-to-string balance.`,
  ];

  if (extraCount > 0) {
    tips.push(
      `${extraCount} extra sound${extraCount === 1 ? "" : "s"} got picked up that aren’t in the tab (string noise or leftover ringing). Lightly mute between chord changes.`,
    );
  }

  const causalInsight = buildCausalInsight({ alignments, byId: new Map(expectedNotes.map(n => [n.id, n])), weakestMeasure, late, early, missed });

  return {
    overallComment:
      accuracyPercent >= 85
        ? `Strong take. The known-tab alignment is confident, with average timing drift around ${timingDriftMs}ms.`
        : causalInsight ?? `The main practice target is ${issueLocation}. The known-tab alignment scored ${accuracyPercent}% with ${timingDriftMs}ms average timing drift.`,
    tips,
    alignments,
    findings,
    practiceActions,
    issueClusters,
    coachQuestions,
    generatedAt: Date.now(),
  };
}

/** Detect structural timing causes and return a human "why" sentence, or null. */
function buildCausalInsight({
  alignments,
  byId,
  weakestMeasure,
  late,
  early,
  missed,
}: {
  alignments: AlignmentResult[];
  byId: Map<string, TabNote>;
  weakestMeasure: number;
  late: AlignmentResult[];
  early: AlignmentResult[];
  missed: AlignmentResult[];
}): string | null {
  if (alignments.length === 0) return null;

  // Check if late notes cluster at beat 1 of a measure → chord change issue
  const lateAtDownbeat = late.filter(a => {
    const n = byId.get(a.tabNoteId);
    return n && n.beat <= 1.1;
  });
  if (lateAtDownbeat.length >= 2 && lateAtDownbeat.length >= late.length * 0.6) {
    const ms = [...new Set(lateAtDownbeat.map(a => byId.get(a.tabNoteId)?.measure).filter(Boolean))];
    return `Late on beat 1 of measure${ms.length > 1 ? "s" : ""} ${ms.join(", ")} — the chord change into those bars is being rushed. Isolate the transition two beats before.`;
  }

  // Check if multiple consecutive late notes in the same measure → the whole measure drags
  const lateMeasureCounts = new Map<number, number>();
  for (const a of late) {
    const n = byId.get(a.tabNoteId);
    if (n) lateMeasureCounts.set(n.measure, (lateMeasureCounts.get(n.measure) ?? 0) + 1);
  }
  const draggingMeasure = [...lateMeasureCounts.entries()].find(([, count]) => count >= 3);
  if (draggingMeasure) {
    return `Measure ${draggingMeasure[0]} is dragging throughout — the pulse is drifting on that bar. Practice it with a metronome click on beats 1 and 3.`;
  }

  // Check for early notes right after a string jump (position change)
  if (early.length >= 2) {
    const earlyNotes = early.map(a => byId.get(a.tabNoteId)).filter(Boolean) as TabNote[];
    const stringJumps = earlyNotes.filter((n, i) => {
      if (i === 0) return false;
      return Math.abs(n.string - earlyNotes[i - 1].string) >= 2;
    });
    if (stringJumps.length >= 1) {
      return `${early.length} early attacks — happening after string jumps. Slow down and exaggerate the position shift before striking.`;
    }
    return `${early.length} notes came in early — try tapping your foot on the beat and waiting for it before striking.`;
  }

  // Default fall-through: missed + wrong
  if (missed.length > 0) {
    const n = byId.get(missed[0].tabNoteId);
    return `${missed.length} expected note${missed.length === 1 ? "" : "s"} missing — the clearest gap is${n ? ` at measure ${n.measure}, beat ${n.beat}` : ` in measure ${weakestMeasure}`}. Loop that section slowly.`;
  }

  return null;
}
