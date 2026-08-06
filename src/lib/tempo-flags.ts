/**
 * Tempo soft-flag detection + range regrid, and chord-flag detection.
 *
 * Works on TabNote[] directly — onsetMs is available on TranscribedNote
 * (a superset of TabNote), but we use beat positions for pure-frontend regrid.
 */

import type { TabNote } from "@/types/music";
import type { MeasureHarmony, ChordShape } from "@/lib/theory-analysis";

export interface TempoFlagInfo {
  /** Measure where the suspected tempo change begins. */
  measure: number;
  /** Inclusive end of the off-tempo stretch (default Apply range). */
  endMeasure: number;
  /** Suggested BPM for the off-tempo region. */
  suggestedBpm: number;
}

function noteOnsetMs(n: TabNote, bpm: number, beatsPerMeasure: number): number {
  const stored = (n as { onsetMs?: number }).onsetMs;
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  return ((n.measure - 1) * beatsPerMeasure + (n.beat - 1)) * (60_000 / bpm);
}

/**
 * Detect sustained tempo shifts by comparing wall-clock measure spans
 * (first onset of M → first onset of M+1) against the expected span at
 * the global BPM.
 *
 * Only flags the *start* of contiguous off-tempo stretches so the UI
 * stays sparse (at most a couple of flags, never every measure).
 */
export function detectTempoFlagInfos(
  notes: TabNote[],
  bpm: number,
  beatsPerMeasure: number,
  {
    thresholdRatio = 0.18,
    minStretch = 3,
    maxFlags = 2,
  }: { thresholdRatio?: number; minStretch?: number; maxFlags?: number } = {},
): TempoFlagInfo[] {
  if (notes.length < 8 || bpm <= 0 || beatsPerMeasure <= 0) return [];

  // Require real onsetMs — derived beat→ms always matches global BPM and
  // would never produce a meaningful tempo-change signal.
  const withOnsets = notes.filter(n => typeof (n as { onsetMs?: number }).onsetMs === "number");
  if (withOnsets.length < 8) return [];

  const byMeasure = new Map<number, number[]>();
  for (const n of withOnsets) {
    if (!byMeasure.has(n.measure)) byMeasure.set(n.measure, []);
    byMeasure.get(n.measure)!.push(noteOnsetMs(n, bpm, beatsPerMeasure));
  }

  const measures = [...byMeasure.keys()].sort((a, b) => a - b);
  if (measures.length < minStretch + 1) return [];

  const expectedMs = beatsPerMeasure * (60_000 / bpm);

  // Per-measure local BPM from wall-clock span to the next measure's first attack
  const local: { measure: number; localBpm: number; ratio: number }[] = [];
  for (let i = 0; i < measures.length - 1; i++) {
    const m = measures[i];
    const next = measures[i + 1];
    // Only trust consecutive measure numbers (skip gaps / empty bars)
    if (next !== m + 1) continue;

    const firstThis = Math.min(...byMeasure.get(m)!);
    const firstNext = Math.min(...byMeasure.get(next)!);
    const span = firstNext - firstThis;
    if (span < expectedMs * 0.35) continue; // too short — likely quantize packing, not tempo

    const localBpm = bpm * (expectedMs / span);
    // Ignore absurd estimates (noise / sparse measures)
    if (localBpm < bpm * 0.55 || localBpm > bpm * 1.8) continue;

    const ratio = (localBpm - bpm) / bpm;
    local.push({ measure: m, localBpm, ratio });
  }

  if (local.length < minStretch) return [];

  // Find contiguous stretches where |ratio| stays above threshold in the same direction
  const flags: TempoFlagInfo[] = [];
  let i = 0;
  while (i < local.length && flags.length < maxFlags) {
    const start = local[i];
    if (Math.abs(start.ratio) < thresholdRatio) { i++; continue; }

    const dir = Math.sign(start.ratio);
    let j = i + 1;
    const bpms = [start.localBpm];
    while (
      j < local.length &&
      local[j].measure === local[j - 1].measure + 1 &&
      Math.sign(local[j].ratio) === dir &&
      Math.abs(local[j].ratio) >= thresholdRatio * 0.7
    ) {
      bpms.push(local[j].localBpm);
      j++;
    }

    const stretchLen = j - i;
    if (stretchLen >= minStretch) {
      const avgLocal = bpms.reduce((a, b) => a + b, 0) / bpms.length;
      const suggestedBpm = Math.round(avgLocal);
      // Only flag if the suggestion actually differs from global BPM
      if (Math.abs(suggestedBpm - bpm) >= Math.max(6, bpm * 0.08)) {
        flags.push({
          measure: start.measure,
          endMeasure: local[j - 1].measure,
          suggestedBpm,
        });
      }
    }
    i = Math.max(j, i + 1);
  }

  return flags;
}

/** Measure numbers only — for TabViewer flag icons. */
export function detectTempoFlags(
  notes: TabNote[],
  bpm: number,
  beatsPerMeasure: number,
): number[] {
  return detectTempoFlagInfos(notes, bpm, beatsPerMeasure).map(f => f.measure);
}

/**
 * Re-quantize notes in [beginMeasure, endMeasure] from oldBpm to newBpm.
 *
 * We scale onsetMs within the range and re-derive (measure, beat) from the
 * new BPM. Pitch/string/fret are untouched.
 *
 * If onsetMs is available (TranscribedNote), we use it directly; otherwise
 * we derive it from beat position using oldBpm.
 */
export function regridRange(
  notes: TabNote[],
  beginMeasure: number,
  endMeasure: number,
  oldBpm: number,
  newBpm: number,
  beatsPerMeasure: number,
): TabNote[] {
  const oldSecPerBeat = 60_000 / oldBpm;
  const newSecPerBeat = 60_000 / newBpm;

  // Anchor: onset of beginMeasure in ms (using oldBpm)
  const anchorMs = (beginMeasure - 1) * beatsPerMeasure * oldSecPerBeat;

  return notes.map(n => {
    if (n.measure < beginMeasure || n.measure > endMeasure) return n;

    const onsetMs =
      (n as { onsetMs?: number }).onsetMs
      ?? ((n.measure - 1) * beatsPerMeasure + (n.beat - 1)) * oldSecPerBeat;

    // Offset from anchor, re-scale to new BPM
    const offsetMs = onsetMs - anchorMs;
    const newOffsetMs = offsetMs * (oldBpm / newBpm);
    const newOnsetMs = anchorMs + newOffsetMs; // anchor stays fixed

    // Re-quantize to 16th-note grid at new BPM
    const totalBeats = newOnsetMs / newSecPerBeat;
    const GRID = 0.25;
    const quantized = Math.round(totalBeats / GRID) * GRID;
    const measure = Math.floor(quantized / beatsPerMeasure) + 1;
    const beat = (quantized % beatsPerMeasure) + 1.0;

    // Duration: scale proportionally
    const newDur = snapDisplay(n.durationBeats * (oldBpm / newBpm));

    return {
      ...n,
      measure,
      beat: Math.round(beat * 1000) / 1000,
      durationBeats: newDur,
    };
  });
}

const DISPLAY_GRID = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25];
function snapDisplay(dur: number): number {
  return DISPLAY_GRID.reduce((a, b) => Math.abs(a - dur) <= Math.abs(b - dur) ? a : b);
}

// ── Chord-confirm flag detection ──────────────────────────────────────────────

export interface ChordFlagInfo {
  measure: number;
  labeledChord: string;
  /** Shapes that could fill in the measure (from recurringShapes). */
  candidateShapes: ChordShape[];
}

/**
 * Detect measures where the transcribed note count is suspiciously low relative
 * to the theory-labeled chord.  Only flags measures where a fuller voicing is
 * available from the song's recurring shapes — keeping this rare.
 *
 * Returns at most `maxFlags` measures to avoid spam.
 */
export function detectChordFlags(
  notes: TabNote[],
  theoryMeasures: MeasureHarmony[],
  recurringShapes: { shape: ChordShape; measures: number[] }[],
  beatsPerMeasure: number,
  maxFlags = 4,
): ChordFlagInfo[] {
  if (theoryMeasures.length === 0 || recurringShapes.length === 0) return [];

  const byMeasure = new Map<number, TabNote[]>();
  for (const n of notes) {
    if (!byMeasure.has(n.measure)) byMeasure.set(n.measure, []);
    byMeasure.get(n.measure)!.push(n);
  }

  const flags: ChordFlagInfo[] = [];

  for (const mh of theoryMeasures) {
    if (!mh.chord || mh.chord === "?") continue;
    const mNotes = byMeasure.get(mh.measure) ?? [];
    // How many distinct pitch classes are present?
    const distinctPcs = new Set(mNotes.map(n => n.fret % 12)).size;

    // Find recurring shapes that label this chord
    const candidates = recurringShapes
      .filter(rs => rs.shape.label === mh.chord && !rs.measures.includes(mh.measure))
      .map(rs => rs.shape);

    if (candidates.length === 0) continue;

    // Flag if the measure has far fewer pitch classes than the best candidate shape
    const bestShapeNotes = candidates[0].positions.length;
    if (distinctPcs < Math.max(2, bestShapeNotes - 1) && mNotes.length < bestShapeNotes) {
      flags.push({ measure: mh.measure, labeledChord: mh.chord, candidateShapes: candidates.slice(0, 2) });
      if (flags.length >= maxFlags) break;
    }
  }

  return flags;
}

/**
 * Fill in missing notes for a measure from a chord shape.
 * Returns a new notes array with added notes for strings not already covered.
 */
export function fillMeasureFromShape(
  notes: TabNote[],
  measure: number,
  shape: ChordShape,
  beatsPerMeasure: number,
): TabNote[] {
  const measureNotes = notes.filter(n => n.measure === measure);
  const coveredStrings = new Set(measureNotes.map(n => n.string));

  // Place new notes on beat 1 of the measure
  const newNotes: TabNote[] = [];
  for (const pos of shape.positions) {
    if (!coveredStrings.has(pos.string)) {
      newNotes.push({
        id: `fill-${measure}-s${pos.string}f${pos.fret}-${Date.now()}`,
        measure,
        beat: 1,
        string: pos.string,
        fret: pos.fret,
        durationBeats: beatsPerMeasure,
      });
    }
  }

  if (newNotes.length === 0) return notes;
  return [...notes, ...newNotes].sort((a, b) =>
    a.measure !== b.measure ? a.measure - b.measure : a.beat !== b.beat ? a.beat - b.beat : a.string - b.string,
  );
}
