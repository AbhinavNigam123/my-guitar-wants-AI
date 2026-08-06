/**
 * theory-analysis.ts
 *
 * Harmonic / structural analysis layer — independent of SVG rendering.
 * Consumes tab notes; produces chord progression, Roman numerals, shapes, motifs.
 */

import type { TabNote } from "@/types/music";

const OPEN_MIDI: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const ROMAN_MAJOR = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;
const ROMAN_MINOR = ["i", "ii", "III", "iv", "v", "VI", "VII"] as const;

export interface TheoryOverlayToggles {
  chordNames: boolean;
  romanNumerals: boolean;
  fretboardPatterns: boolean;
  improvGuides: boolean;
}

export const DEFAULT_THEORY_TOGGLES: TheoryOverlayToggles = {
  chordNames: false,
  romanNumerals: false,
  fretboardPatterns: false,
  improvGuides: false,
};

export interface ChordShape {
  /** Sorted string:fret pairs */
  positions: { string: number; fret: number }[];
  /** Pitch classes present (0-11) */
  pitchClasses: number[];
  label: string;
}

export interface MeasureHarmony {
  measure: number;
  /** Primary chord symbol for the measure (most frequent beat-level chord). */
  chord: string;
  roman: string;
  /** Beat-level chord changes within the measure. */
  beats: { beat: number; chord: string; roman: string; shape: ChordShape }[];
  /** Suggested scale/mode for improvisation over this measure. */
  improvScale: string;
  /** Measure-wide fingering evidence used for chord and shape inspection. */
  shape: ChordShape;
  /** Confidence in the deterministic chord inference from the written tab. */
  confidence: "high" | "medium" | "low";
}

export interface RecurringMotif {
  label: string;
  /** Measure numbers where this pattern appears. */
  measures: number[];
  description: string;
}

export interface ProgressionPattern {
  label: string;
  /** Roman numeral sequence, e.g. "i – VII – VI – V" */
  numerals: string;
  measures: number[];
}

export interface SongTheoryAnalysis {
  key: string;
  mode: "major" | "minor";
  measures: MeasureHarmony[];
  recurringShapes: { shape: ChordShape; measures: number[] }[];
  motifs: RecurringMotif[];
  progressions: ProgressionPattern[];
  /** Sections where inferred local key diverges from song key. */
  keyChanges: { measure: number; key: string; mode: "major" | "minor"; label: string }[];
  /** Shape/progression reused at a different pitch level. */
  transposedSections: { label: string; measures: number[]; description: string }[];
}

export interface MeasureTheoryContext {
  measure: number;
  chord: string;
  roman: string;
  function: string;
  /** Alternative voicings of the same chord found elsewhere in the song. */
  alternativeVoicings: { shape: ChordShape; measures: number[] }[];
  relatedMeasures: number[];
  improvScale: string;
  modeNotes: string;
  confidence: "high" | "medium" | "low";
}

function tabNoteMidi(note: TabNote): number {
  return (OPEN_MIDI[note.string] ?? 64) + note.fret;
}

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function noteNameFromPc(pc: number): string {
  return NOTE_NAMES[pc];
}

/** Infer key from pitch-class histogram (Krumhansl-lite). */
export function inferKey(notes: TabNote[]): { key: string; mode: "major" | "minor" } {
  const hist = new Array(12).fill(0);
  for (const n of notes) {
    hist[pitchClass(tabNoteMidi(n))]++;
  }
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  let bestKey = "A";
  let bestMode: "major" | "minor" = "minor";
  let bestScore = -Infinity;

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [["major", MAJOR_PROFILE], ["minor", MINOR_PROFILE]] as const) {
      let score = 0;
      for (let i = 0; i < 12; i++) {
        score += hist[i] * profile[(i - tonic + 12) % 12];
      }
      if (score > bestScore) {
        bestScore = score;
        bestKey = NOTE_NAMES[tonic];
        bestMode = mode;
      }
    }
  }
  return { key: bestKey, mode: bestMode };
}

function chordLabelFromPcs(pcs: number[]): string {
  const sorted = [...new Set(pcs)].sort((a, b) => a - b);
  if (sorted.length === 0) return "?";
  const root = sorted[0];
  const rootName = noteNameFromPc(root);
  const intervals = sorted.map(pc => (pc - root + 12) % 12);

  const has = (i: number) => intervals.includes(i);
  if (sorted.length === 1) return rootName;
  if (has(3) && has(7)) return `${rootName}m`;
  if (has(4) && has(7)) return rootName;
  if (has(3) && has(6)) return `${rootName}dim`;
  if (has(4) && has(7) && has(11)) return `${rootName}maj7`;
  if (has(3) && has(7) && has(10)) return `${rootName}m7`;
  if (has(4) && has(7) && has(10)) return `${rootName}7`;
  if (has(3)) return `${rootName}m`;
  if (has(4)) return rootName;
  return rootName;
}

function buildShape(notes: TabNote[], label?: string): ChordShape {
  const positions = [...new Map(
    notes.map(n => [`${n.string}:${n.fret}`, { string: n.string, fret: n.fret }]),
  ).values()]
    .sort((a, b) => a.string - b.string);
  const pitchClasses = [...new Set(notes.map(n => pitchClass(tabNoteMidi(n))))].sort((a, b) => a - b);
  return {
    positions,
    pitchClasses,
    label: label ?? chordLabelFromPcs(pitchClasses),
  };
}

function inferMeasureChord(notes: TabNote[]): {
  label: string;
  confidence: "high" | "medium" | "low";
} {
  if (notes.length === 0) return { label: "?", confidence: "low" };

  const weights = new Array<number>(12).fill(0);
  for (const note of notes) {
    weights[pitchClass(tabNoteMidi(note))] += Math.max(0.25, note.durationBeats);
  }
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const templates = [
    { suffix: "", intervals: [0, 4, 7] },
    { suffix: "m", intervals: [0, 3, 7] },
    { suffix: "dim", intervals: [0, 3, 6] },
  ] as const;

  let best = { root: 0, suffix: "", intervals: [0, 4, 7] as readonly number[], score: -Infinity };
  for (let root = 0; root < 12; root++) {
    for (const template of templates) {
      const chordPcs = template.intervals.map(interval => (root + interval) % 12);
      const present = chordPcs.filter(pc => weights[pc] > 0).length;
      const chordWeight = chordPcs.reduce((sum, pc) => sum + weights[pc], 0);
      const missingPenalty = (3 - present) * totalWeight * 0.42;
      const rootBonus = weights[root] * 0.3;
      const score = chordWeight + rootBonus - missingPenalty;
      if (score > best.score) best = { root, suffix: template.suffix, intervals: template.intervals, score };
    }
  }

  const chordPcs = best.intervals.map(interval => (best.root + interval) % 12);
  const present = chordPcs.filter(pc => weights[pc] > 0).length;
  const supportedWeight = chordPcs.reduce((sum, pc) => sum + weights[pc], 0);
  const support = supportedWeight / totalWeight;
  const confidence = present === 3 && support >= 0.72
    ? "high"
    : present === 3 || (present >= 2 && support >= 0.58)
      ? "medium"
      : "low";

  if (present < 2) {
    const strongestPc = weights.indexOf(Math.max(...weights));
    return { label: noteNameFromPc(strongestPc), confidence: "low" };
  }
  return { label: `${noteNameFromPc(best.root)}${best.suffix}`, confidence };
}

function romanForChord(chord: string, key: string, mode: "major" | "minor"): string {
  const rootName = chord.replace(/(maj7|m7|7|m|dim|aug).*/, "").replace(/[^A-G#]/g, "");
  const rootPc = NOTE_NAMES.indexOf(rootName as typeof NOTE_NAMES[number]);
  if (rootPc < 0) return "?";
  const keyPc = NOTE_NAMES.indexOf(key as typeof NOTE_NAMES[number]);
  const degree = (rootPc - keyPc + 12) % 12;
  const degreeMap = mode === "major"
    ? [0, -1, 1, -1, 2, 3, -1, 4, -1, 5, -1, 6]
    : [0, -1, 1, 2, -1, 3, -1, 4, 5, -1, 6, -1];
  const idx = degreeMap[degree];
  if (idx < 0) return "chrom.";
  const table = mode === "major" ? ROMAN_MAJOR : ROMAN_MINOR;
  let roman: string = table[idx] ?? "?";
  const isMinorChord = chord.includes("m") && !chord.includes("maj") && !chord.includes("dim");
  if (chord.includes("dim")) roman = `${roman.toLowerCase()}°`;
  else roman = isMinorChord ? roman.toLowerCase() : roman.toUpperCase();
  if (chord.includes("7")) roman += "7";
  return roman;
}

function harmonicFunction(roman: string): string {
  if (roman.startsWith("i") || roman.startsWith("I")) return "Tonic";
  if (roman.startsWith("V") || roman.startsWith("v")) return "Dominant";
  if (roman.startsWith("IV") || roman.startsWith("iv")) return "Subdominant";
  if (roman.includes("VI") || roman.includes("vi")) return "Submediant";
  if (roman.includes("VII") || roman.includes("vii")) return "Leading / subtonic";
  if (roman.includes("III") || roman.includes("iii")) return "Mediant";
  if (roman.includes("II") || roman.includes("ii")) return "Supertonic";
  return "Chromatic / passing";
}

function improvScaleFor(chord: string, key: string, mode: "major" | "minor"): string {
  if (chord.includes("m") && !chord.includes("maj")) {
    const root = chord.replace(/m.*/, "");
    return `${root} natural minor / pentatonic`;
  }
  if (mode === "minor" && (chord.startsWith("A") || key === "A")) {
    return "A minor pentatonic · A Aeolian";
  }
  return `${key} ${mode} · relative pentatonic`;
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const OPEN_STRING_PC: Record<number, number> = {
  1: 4,  // E
  2: 11, // B
  3: 7,  // G
  4: 2,  // D
  5: 9,  // A
  6: 4,  // E
};

function parseChordRootPc(chord: string): number | null {
  const rootName = chord.replace(/(maj7|m7|7|m|dim|aug).*/, "").replace(/[^A-G#]/g, "");
  const idx = NOTE_NAMES.indexOf(rootName as typeof NOTE_NAMES[number]);
  return idx >= 0 ? idx : null;
}

/**
 * Map a scale (and chord tones) onto standard-tuning frets 0–12.
 * Chord tones are marked `isChordTone: true` for stronger visual emphasis.
 */
export function computeScaleFrets(
  key: string,
  mode: "major" | "minor",
  chord: string,
  maxFret = 12,
): { string: number; fret: number; isChordTone: boolean }[] {
  const keyPc = NOTE_NAMES.indexOf(key as typeof NOTE_NAMES[number]);
  const tonic = keyPc >= 0 ? keyPc : 0;
  const steps = mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  const scalePcs = new Set(steps.map(s => (tonic + s) % 12));

  // Prefer chord-local scale when the chord is minor and differs from song key
  const chordRoot = parseChordRootPc(chord);
  const chordIsMinor = chord.includes("m") && !chord.includes("maj");
  let activeScale = scalePcs;
  if (chordRoot != null && chordIsMinor) {
    activeScale = new Set(MINOR_STEPS.map(s => (chordRoot + s) % 12));
  } else if (chordRoot != null && !chordIsMinor) {
    activeScale = new Set(MAJOR_STEPS.map(s => (chordRoot + s) % 12));
  }

  // Triad chord tones: root, third, fifth
  const chordPcs = new Set<number>();
  if (chordRoot != null) {
    chordPcs.add(chordRoot);
    chordPcs.add((chordRoot + (chordIsMinor ? 3 : 4)) % 12);
    chordPcs.add((chordRoot + 7) % 12);
  }

  const out: { string: number; fret: number; isChordTone: boolean }[] = [];
  // Prefer a compact box: frets 0–5 or around chord root position
  const boxStart = 0;
  const boxEnd = Math.min(maxFret, 5);
  for (let string = 1; string <= 6; string++) {
    const openPc = OPEN_STRING_PC[string];
    for (let fret = boxStart; fret <= boxEnd; fret++) {
      const pc = (openPc + fret) % 12;
      if (!activeScale.has(pc)) continue;
      out.push({ string, fret, isChordTone: chordPcs.has(pc) });
    }
  }
  // Cap density so the mini board stays readable
  return out.slice(0, 18);
}

function groupNotesByMeasureBeat(notes: TabNote[]): Map<string, TabNote[]> {
  const map = new Map<string, TabNote[]>();
  for (const n of notes) {
    const key = `${n.measure}:${n.beat}`;
    const g = map.get(key) ?? [];
    g.push(n);
    map.set(key, g);
  }
  return map;
}

export function analyzeSongTheory(notes: TabNote[]): SongTheoryAnalysis {
  const { key, mode } = inferKey(notes);
  const byMB = groupNotesByMeasureBeat(notes);
  const measureNums = [...new Set(notes.map(n => n.measure))].sort((a, b) => a - b);

  const measures: MeasureHarmony[] = [];
  const shapeIndex = new Map<string, { shape: ChordShape; measures: Set<number> }>();

  for (const m of measureNums) {
    const measureNotes = notes.filter(note => note.measure === m);
    const chordInference = inferMeasureChord(measureNotes);
    const measureShape = buildShape(measureNotes, chordInference.label);
    const beatEntries = [...byMB.entries()]
      .filter(([k]) => Number(k.split(":")[0]) === m)
      .sort((a, b) => Number(a[0].split(":")[1]) - Number(b[0].split(":")[1]));

    const beats = beatEntries.map(([k, group]) => {
      const beat = Number(k.split(":")[1]);
      const shape = buildShape(group);
      const chord = shape.label;
      const roman = romanForChord(chord, key, mode);
      return { beat, chord, roman, shape };
    });

    const primaryChord = chordInference.label;
    const shapeKey = measureShape.positions.map(p => `${p.string}:${p.fret}`).join(",");
    const shapeEntry = shapeIndex.get(shapeKey) ?? { shape: measureShape, measures: new Set() };
    shapeEntry.measures.add(m);
    shapeIndex.set(shapeKey, shapeEntry);

    measures.push({
      measure: m,
      chord: primaryChord,
      roman: romanForChord(primaryChord, key, mode),
      beats,
      improvScale: improvScaleFor(primaryChord, key, mode),
      shape: measureShape,
      confidence: chordInference.confidence,
    });
  }

  const recurringShapes = [...shapeIndex.values()]
    .filter(e => e.measures.size >= 2)
    .map(e => ({ shape: e.shape, measures: [...e.measures].sort((a, b) => a - b) }));

  // Detect repeated 2-measure roman progressions
  const progressions: ProgressionPattern[] = [];
  for (let i = 0; i < measures.length - 1; i++) {
    const pair = `${measures[i].roman} – ${measures[i + 1].roman}`;
    const matches = measures.filter((_, idx) =>
      idx < measures.length - 1 &&
      `${measures[idx].roman} – ${measures[idx + 1].roman}` === pair,
    );
    if (matches.length >= 2 && !progressions.some(p => p.numerals === pair)) {
      progressions.push({
        label: `Recurring ${pair}`,
        numerals: pair,
        measures: matches.map(m => m.measure),
      });
    }
  }

  const motifs: RecurringMotif[] = recurringShapes.slice(0, 4).map((rs, i) => ({
    label: `Shape ${rs.shape.label} (${i + 1})`,
    measures: rs.measures,
    description: `Fret pattern ${rs.shape.positions.map(p => `${p.string}:${p.fret}`).join(" ")} appears in ${rs.measures.length} measures.`,
  }));

  const keyChanges = detectKeyChanges(notes, key, mode);
  const transposedSections = detectTransposedSections(recurringShapes, measures);

  return { key, mode, measures, recurringShapes, motifs, progressions, keyChanges, transposedSections };
}

function detectKeyChanges(
  notes: TabNote[],
  globalKey: string,
  globalMode: "major" | "minor",
): SongTheoryAnalysis["keyChanges"] {
  const measureNums = [...new Set(notes.map(n => n.measure))].sort((a, b) => a - b);
  const window = 4;
  const changes: SongTheoryAnalysis["keyChanges"] = [];
  for (let i = 0; i < measureNums.length; i += window) {
    const slice = measureNums.slice(i, i + window);
    const sliceNotes = notes.filter(n => slice.includes(n.measure));
    if (sliceNotes.length < 3) continue;
    const local = inferKey(sliceNotes);
    if (local.key !== globalKey || local.mode !== globalMode) {
      changes.push({
        measure: slice[0],
        key: local.key,
        mode: local.mode,
        label: `Modal shift toward ${local.key} ${local.mode} (M${slice[0]}–M${slice[slice.length - 1]})`,
      });
    }
  }
  return changes;
}

function detectTransposedSections(
  recurringShapes: { shape: ChordShape; measures: number[] }[],
  measures: MeasureHarmony[],
): SongTheoryAnalysis["transposedSections"] {
  const sections: SongTheoryAnalysis["transposedSections"] = [];
  const byPattern = new Map<string, { rootPc: number; measures: number[] }[]>();

  for (const mh of measures) {
    for (const b of mh.beats) {
      const patternKey = b.shape.positions.map(p => `${p.string}:${p.fret}`).sort().join("|");
      const rootPc = b.shape.pitchClasses[0] ?? 0;
      const entries = byPattern.get(patternKey) ?? [];
      const existing = entries.find(e => e.rootPc === rootPc);
      if (existing) existing.measures.push(mh.measure);
      else entries.push({ rootPc, measures: [mh.measure] });
      byPattern.set(patternKey, entries);
    }
  }

  for (const [pattern, groups] of byPattern) {
    if (groups.length < 2) continue;
    const sorted = groups.sort((a, b) => a.rootPc - b.rootPc);
    sections.push({
      label: `Transposed shape (${sorted[0].rootPc !== sorted[1].rootPc ? "±" + ((sorted[1].rootPc - sorted[0].rootPc + 12) % 12) + " semitones" : "repeat"})`,
      measures: [...new Set(groups.flatMap(g => g.measures))].sort((a, b) => a - b),
      description: `Same fretboard pattern (${pattern.replace(/\|/g, " ")}) at different harmonic positions.`,
    });
  }

  void recurringShapes;
  return sections.slice(0, 6);
}

export function getMeasureTheoryContext(
  analysis: SongTheoryAnalysis,
  measure: number,
): MeasureTheoryContext | null {
  const mh = analysis.measures.find(m => m.measure === measure);
  if (!mh) return null;

  const relatedMeasures = analysis.recurringShapes
    .filter(rs => rs.measures.includes(measure))
    .flatMap(rs => rs.measures)
    .filter(m => m !== measure);

  const currentKey = mh.shape.positions.map(p => `${p.string}:${p.fret}`).join(",");
  const alternativeVoicings = analysis.recurringShapes
    .filter(rs => {
      if (rs.shape.label !== mh.chord) return false;
      const key = rs.shape.positions.map(p => `${p.string}:${p.fret}`).join(",");
      return key !== currentKey;
    })
    .slice(0, 3);

  return {
    measure,
    chord: mh.chord,
    roman: mh.roman,
    function: harmonicFunction(mh.roman),
    alternativeVoicings,
    relatedMeasures: [...new Set(relatedMeasures)].sort((a, b) => a - b),
    improvScale: mh.improvScale,
    modeNotes: `${analysis.key} ${analysis.mode}`,
    confidence: mh.confidence,
  };
}
