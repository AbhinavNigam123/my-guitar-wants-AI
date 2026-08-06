"use client";

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import type { TabNote, NoteStatus } from "@/types/music";
import type { ChordShape, MeasureHarmony, TheoryOverlayToggles } from "@/lib/theory-analysis";
import type { PlayedTakeNote } from "@/lib/played-take-lane";
import MiniFretboard from "@/components/practice/MiniFretboard";
import { computeScaleFrets } from "@/lib/theory-analysis";

// Songsterr color tokens — resolved via --ss-* CSS vars (light/dark)
const TAB = {
  strings:   "var(--ss-tab-strings)",
  measure:   "var(--ss-tab-measure)",
  tuning:    "var(--ss-tab-tuning)",
  rhythm:    "var(--ss-tab-rhythm)",
  signature: "var(--ss-tab-signature)",
  marker:    "var(--ss-tab-marker)",
  technique: "var(--ss-tab-technique)",
  rest:      "var(--ss-text-muted)",
};

const STAFF_BG      = "var(--ss-surface)";
const TAB_SIDE_PAD  = 56;
const STRING_H      = 15;
const STAFF_H       = 6 * STRING_H;
const STAFF_LEFT    = 32;
const FIRST_STAFF_LEFT = 70;
const TUNING_X      = 10;
const SIG_CENTER_X  = 45;
const PAD_TOP       = 30;
const RHYTHM_GAP    = 13;
const STEM_LEN      = 18;
const RHYTHM_EDGE_BEATS = 0.25;
const RHYTHM_H      = RHYTHM_GAP + STEM_LEN + 12;
const ROW_H         = PAD_TOP + STAFF_H + RHYTHM_H;
const ROW_GAP       = 28;
const MIN_MEASURE_W = 250;
const PLAYED_TAKE_GAP = 8;

const STRING_LABELS = ["E", "B", "G", "D", "A", "E"];

export const NOTE_STYLE: Record<NoteStatus, { text: string; band: string }> = {
  unplayed:   { text: "var(--ss-tab-note)", band: STAFF_BG },
  correct:    { text: "var(--note-correct)",  band: "var(--note-correct-band)" },
  early:      { text: "var(--note-early)",    band: "var(--note-early-band)" },
  late:       { text: "var(--note-late)",     band: "var(--note-late-band)" },
  missed:     { text: "var(--note-missed)",   band: "var(--note-missed-band)" },
  wrong_note: { text: "var(--note-wrong)",    band: "var(--note-wrong-band)" },
};

export const LEGEND_ITEMS: [NoteStatus, string][] = [
  ["correct", "Correct"],
  ["early",   "Early"],
  ["late",    "Late"],
  ["missed",  "Missed"],
  ["wrong_note", "Wrong"],
];

function stringY(s: number): number {
  return (s - 1) * STRING_H + STRING_H / 2;
}

/** Interpolate score (0–1) through red → yellow → green. */
function scoreToColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  if (s >= 0.6) {
    const t = (s - 0.6) / 0.4;
    return `rgb(${Math.round(234 + t * (34 - 234))},${Math.round(179 + t * (197 - 179))},${Math.round(8 + t * (94 - 8))})`;
  }
  const t = s / 0.6;
  return `rgb(${Math.round(239 + t * (234 - 239))},${Math.round(68 + t * (179 - 68))},${Math.round(68 + t * (8 - 68))})`;
}

function expandedChordName(chord: string, pitchClasses?: number[]): string {
  const simple = chord.match(/^([A-G](?:#|b)?)(m)?$/);
  if (simple) {
    const rootPc = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(simple[1]);
    const intervals = rootPc >= 0 && pitchClasses
      ? pitchClasses.map(pc => (pc - rootPc + 12) % 12)
      : [];
    const quality = simple[2] ? "minor" : "major";
    const seventh = intervals.includes(11) ? "maj7" : intervals.includes(10) ? "7" : "";
    const extension = intervals.includes(2)
      ? seventh === "maj7" ? "maj9" : seventh === "7" ? "9" : "add9"
      : intervals.includes(5)
        ? "add11"
        : intervals.includes(9)
          ? "add13"
          : seventh;
    return `${simple[1]} ${quality}${extension ? ` (${extension})` : ""}`;
  }
  const diminished = chord.match(/^([A-G](?:#|b)?)dim$/);
  if (diminished) return `${diminished[1]} diminished`;
  const augmented = chord.match(/^([A-G](?:#|b)?)aug$/);
  if (augmented) return `${augmented[1]} augmented`;
  return chord;
}

/** Beat-to-x within a row. The time signature has its own pre-measure gutter. */
function rowBeatX(
  miInRow: number,
  beat: number,
  measureW: number,
  staffLeft = STAFF_LEFT,
  beatsPerMeasure = 4,
): number {
  const frac = (beat - 1 + RHYTHM_EDGE_BEATS) / beatsPerMeasure;
  return staffLeft + miInRow * measureW + frac * measureW;
}

/** Inverse of rowBeatX — x pixel → beat within measure (1..5). */
function rowXToBeat(
  miInRow: number,
  x: number,
  measureW: number,
  staffLeft = STAFF_LEFT,
  beatsPerMeasure = 4,
): number {
  const left = staffLeft + miInRow * measureW;
  const frac = Math.max(0, Math.min(1, (x - left) / measureW));
  return Math.max(1, 1 + frac * beatsPerMeasure - RHYTHM_EDGE_BEATS);
}

function groupByMeasure(notes: TabNote[]) {
  const map = new Map<number, TabNote[]>();
  for (const n of notes) {
    if (!map.has(n.measure)) map.set(n.measure, []);
    map.get(n.measure)!.push(n);
  }
  return map;
}

/** Snap chord notes onto one beat (display + layout safety net). */
function normalizeChordBeats(notes: TabNote[]): TabNote[] {
  const out = notes.map(n => ({ ...n }));
  const CHORD_MS = 150;
  const BEAT_EPS = 0.26;

  for (const mNotes of groupByMeasure(out).values()) {
    const sorted = [...mNotes].sort((a, b) => {
      const oa = (a as TabNote & { onsetMs?: number }).onsetMs;
      const ob = (b as TabNote & { onsetMs?: number }).onsetMs;
      if (oa != null && ob != null) return oa - ob;
      return a.beat - b.beat;
    });

    let cluster: TabNote[] = [sorted[0]];
    const flush = () => {
      const minBeat = Math.min(...cluster.map(n => n.beat));
      cluster.forEach(n => { n.beat = minBeat; });
    };

    for (let i = 1; i < sorted.length; i++) {
      const prev = cluster[cluster.length - 1];
      const curr = sorted[i];
      const pOnset = (prev as TabNote & { onsetMs?: number }).onsetMs;
      const cOnset = (curr as TabNote & { onsetMs?: number }).onsetMs;
      const sameCluster =
        (pOnset != null && cOnset != null && cOnset - pOnset <= CHORD_MS) ||
        (curr.beat - prev.beat <= BEAT_EPS);

      if (sameCluster) cluster.push(curr);
      else { flush(); cluster = [curr]; }
    }
    flush();
  }
  return out;
}

/** Next note on the same string after *note* (by measure/beat). */
function nextOnString(notes: TabNote[], note: TabNote): TabNote | undefined {
  return notes
    .filter(n =>
      n.string === note.string &&
      (n.measure > note.measure || (n.measure === note.measure && n.beat > note.beat + 0.01)),
    )
    .sort((a, b) => a.measure - b.measure || a.beat - b.beat)[0];
}

type RestSlot = { beat: number; gapBeats: number };

function beatGroups(mNotes: TabNote[], beatsPerMeasure = 4): { beat: number; durationBeats: number }[] {
  const byBeat = new Map<number, TabNote[]>();
  for (const n of mNotes) {
    const key = Math.round(n.beat * 4) / 4;
    if (!byBeat.has(key)) byBeat.set(key, []);
    byBeat.get(key)!.push(n);
  }
  const sorted = [...byBeat.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([beat, grp]) => ({
      beat,
      durationBeats: Math.max(...grp.map(n => n.durationBeats)),
    }));

  // Defensive clamp: ensure no duration extends past the next attack or bar end.
  // This guards against messy transcribed sessions that pre-date backend gridify.
  for (let i = 0; i < sorted.length; i++) {
    const barRemaining = beatsPerMeasure - (sorted[i].beat - 1);
    const distToNext = i + 1 < sorted.length
      ? sorted[i + 1].beat - sorted[i].beat
      : barRemaining;
    sorted[i].durationBeats = Math.max(0.25, Math.min(sorted[i].durationBeats, distToNext, barRemaining));
  }
  return sorted;
}

/** Collect rest positions within a measure (leading, between, trailing). */
function findRests(mNotes: TabNote[], beatsPerMeasure: number): RestSlot[] {
  const groups = beatGroups(mNotes, beatsPerMeasure);
  if (groups.length === 0) return [{ beat: 1 + beatsPerMeasure / 2, gapBeats: beatsPerMeasure }];

  const rests: RestSlot[] = [];
  const MIN_GAP = 0.25;

  const leadGap = groups[0].beat - 1;
  if (leadGap >= MIN_GAP) {
    rests.push({ beat: 1 + leadGap / 2, gapBeats: leadGap });
  }

  for (let i = 0; i < groups.length - 1; i++) {
    const endBeat = groups[i].beat + groups[i].durationBeats;
    const gap = groups[i + 1].beat - endBeat;
    if (gap >= MIN_GAP) {
      rests.push({ beat: endBeat + gap / 2, gapBeats: gap });
    }
  }

  const last = groups[groups.length - 1];
  const tailGap = beatsPerMeasure + 1 - (last.beat + last.durationBeats);
  if (tailGap >= MIN_GAP) {
    rests.push({ beat: last.beat + last.durationBeats + tailGap / 2, gapBeats: tailGap });
  }

  return rests;
}

interface TabViewerProps {
  notes: TabNote[];
  bpm: number;
  currentMeasure?: number;
  /** Continuous beat position for smooth cursor (absolute from song start). */
  playbackBeat?: number;
  hasRecorded?: boolean;
  totalMeasures?: number;
  beatsPerMeasure?: number;
  editorMode?: boolean;
  selectedNoteId?: string | null;
  /** Highlight a loop region (1-indexed measure numbers). */
  loopMeasureRegion?: { startMeasure: number; endMeasure: number } | null;
  onSeek?: (absoluteBeat: number) => void;
  onNoteSelect?: (noteId: string) => void;
  onNoteContextMenu?: (noteId: string) => void;
  /** Called when user drag-selects a loop region on the tab. */
  onLoopRangeChange?: (start: number, end: number) => void;
  /** Clear the active loop selection (Esc / undo). */
  onClearLoop?: () => void;
  /**
   * Called after a drag-select when the user picks "Let Ring".
   * mode "all" = apply to every note in the range.
   * mode "pick" = enter interactive note-click mode (parent sets letRingPickRange).
   */
  onAddLetRing?: (startMeasure: number, endMeasure: number, mode: "all" | "pick") => void;
  /** When set, the tab is in let-ring pick mode for these measures. */
  letRingPickRange?: { start: number; end: number } | null;
  /** Called when the user clicks a note while in let-ring pick mode. */
  onLetRingNotePick?: (noteId: string) => void;
  /** Exit let-ring pick mode without applying. */
  onLetRingPickDone?: () => void;
  onOpenTheoryTab?: () => void;
  /** Theory overlay data + toggles (analysis layer stays external). */
  theoryMeasures?: MeasureHarmony[];
  theoryToggles?: TheoryOverlayToggles;
  /** Song key/mode for improv scale computation. */
  theoryKey?: string;
  theoryMode?: "major" | "minor";
  /** Recurring shapes used by the chord-shape popup. */
  theoryShapes?: { shape: ChordShape; measures: number[] }[];
  onMeasureTheoryClick?: (measure: number) => void;
  onHighlightMeasures?: (measures: number[]) => void;
  /** Optional played-take comparison lane (low-confidence events shown faint). */
  showPlayedTakeLane?: boolean;
  playedTakeNotes?: PlayedTakeNote[];
  hideGhostDetections?: boolean;
  onHideGhostDetectionsChange?: (hide: boolean) => void;
  onTogglePlayedTakeLane?: () => void;
  /** Measures to highlight (from Theory tab chord/shape click). */
  highlightedMeasures?: number[];
  /** When set, measures outside this range are dimmed (coach focus range). */
  activeMeasureRange?: { start: number; end: number } | null;
  /** Measures flagged as potential tempo shifts (from detectTempoFlags). */
  tempoFlags?: number[];
  /** Active tempo-correction prompt state. */
  tempoPrompt?: { measure: number; begin: number; end: number; suggestedBpm: number } | null;
  onTempoFlagClick?: (measure: number, maxMeasure: number) => void;
  onTempoPromptChange?: (prompt: { measure: number; begin: number; end: number; suggestedBpm: number } | null) => void;
  onTempoPromptApply?: (begin: number, end: number, newBpm: number) => void;
  /** Clear a false-positive tempo flag. */
  onTempoFlagDismiss?: (measure: number) => void;
  /** Measures flagged as having suspiciously sparse chord voicings. */
  chordFlags?: number[];
  /** Called when user clicks a chord flag icon. */
  onChordFlagClick?: (measure: number) => void;
  /** Per-measure accuracy scores (0–1 scale). Drives compact score markers. */
  measureScores?: Record<number, number>;
}

// Teardrop playback cursor — position driven by RAF, no layout animation
function TabCursor({ x, staffTop, staffH }: { x: number; staffTop: number; staffH: number }) {
  const W = 12, topR = 6.6;
  const bodyH  = staffH - topR;
  const totalH = staffH + 12;
  const path = [
    `M 0,${topR}`,
    `Q 0,0 ${W / 2},0 q ${W / 2},0 ${W / 2},${topR}`,
    `v ${bodyH}`,
    `c0,1.82,-0.49,3.59,-1.42,5.15 l-2.86,4.76`,
    `c-0.78,1.3,-2.65,1.3,-3.43,0 l-2.86,-4.76`,
    `c-0.93,-1.56,-1.43,-3.33,-1.43,-5.15`,
    `v -${bodyH}`,
  ].join(" ");
  return (
    <div
      style={{
        position: "absolute",
        left: x - W / 2,
        top: staffTop,
        width: W,
        height: totalH,
        zIndex: 10,
        pointerEvents: "none",
        willChange: "left",
      }}
    >
      <svg width={W} height={totalH} overflow="visible">
        <path d={path} fill="#238c35" opacity={0.25} transform="translate(0,1)" />
        <path d={path} fill="#238c35" />
        <circle cx={W / 2} cy={staffH + 3} r="2.8" fill="white" />
      </svg>
    </div>
  );
}

/** Rest glyph centered on the tab staff (between the strings). */
function StaffRestGlyph({ x, staffTop, gapBeats }: { x: number; staffTop: number; gapBeats: number }) {
  const c = TAB.rest;
  const cy = staffTop + STAFF_H / 2;

  if (gapBeats >= 3.5) {
    // Whole rest — bar below middle line
    return <rect x={x - 7} y={cy - 1} width={14} height={5} fill={c} rx={1} />;
  }
  if (gapBeats >= 1.75) {
    // Half rest — bar above middle line
    return <rect x={x - 7} y={cy - 6} width={14} height={5} fill={c} rx={1} />;
  }
  if (gapBeats >= 0.875) {
    // Quarter rest squiggle on staff
    return (
      <path
        d={`M ${x - 4},${cy - 6} l 6,0 l -5,6 l 5,5 l -3,5`}
        fill="none" stroke={c} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"
      />
    );
  }
  // Eighth rest
  return (
    <g>
      <circle cx={x - 1} cy={cy - 5} r={2.2} fill={c} />
      <path
        d={`M ${x - 1},${cy - 5} q 4,2 5,10`}
        fill="none" stroke={c} strokeWidth={1.3} strokeLinecap="round"
      />
    </g>
  );
}

/**
 * One Songsterr-style "let ring -------|" span per measure that has any letRing notes.
 * Arpeggios mark letRing on multiple strings — never emit per-string labels.
 */
function computeLetRingSpans(notes: TabNote[]): { measure: number; startBeat: number; endBeat: number }[] {
  const byMeasure = new Map<number, TabNote[]>();
  for (const n of notes) {
    if (!n.letRing) continue;
    if (!byMeasure.has(n.measure)) byMeasure.set(n.measure, []);
    byMeasure.get(n.measure)!.push(n);
  }
  const spans: { measure: number; startBeat: number; endBeat: number }[] = [];
  for (const [measure, mNotes] of byMeasure) {
    let startBeat = Infinity;
    let endBeat = 0;
    for (const n of mNotes) {
      startBeat = Math.min(startBeat, n.beat);
      endBeat = Math.max(endBeat, n.beat + n.durationBeats);
    }
    spans.push({ measure, startBeat, endBeat });
  }
  return spans.sort((a, b) => a.measure - b.measure);
}

export default function TabViewer({
  notes,
  bpm,
  currentMeasure,
  playbackBeat,
  hasRecorded,
  beatsPerMeasure = 4,
  editorMode,
  selectedNoteId,
  loopMeasureRegion = null,
  onSeek,
  onNoteSelect,
  onNoteContextMenu,
  onLoopRangeChange,
  onClearLoop,
  theoryMeasures,
  theoryToggles,
  theoryKey = "C",
  theoryMode = "major",
  theoryShapes = [],
  onMeasureTheoryClick,
  onHighlightMeasures,
  showPlayedTakeLane,
  playedTakeNotes,
  hideGhostDetections = true,
  onHideGhostDetectionsChange,
  onTogglePlayedTakeLane,
  highlightedMeasures,
  activeMeasureRange = null,
  tempoFlags = [],
  tempoPrompt = null,
  onTempoFlagClick,
  onTempoPromptChange,
  onTempoPromptApply,
  onTempoFlagDismiss,
  chordFlags = [],
  onChordFlagClick,
  measureScores = {},
  onAddLetRing,
  letRingPickRange = null,
  onLetRingNotePick,
  onLetRingPickDone,
  onOpenTheoryTab,
}: TabViewerProps) {
  // ── Loop drag-to-select state ────────────────────────────────────────────
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd]     = useState<number | null>(null);
  const wasDraggingRef = useRef(false);
  // Popup shown after drag-release: { startMeasure, endMeasure, x, y }
  const [dragMenu, setDragMenu] = useState<{
    startMeasure: number; endMeasure: number; x: number; y: number;
  } | null>(null);
  // Sub-step inside dragMenu: null | "letRingChoice"
  const [dragMenuStep, setDragMenuStep] = useState<"letRingChoice" | null>(null);
  // Chord / improv popovers (local — not lifted)
  const [chordPopover, setChordPopover] = useState<{
    measure: number; chord: string; roman: string; current: ChordShape | null;
    alternatives: { shape: ChordShape; measures: number[] }[];
    confidence: "high" | "medium" | "low";
    scaleLabel: string;
    showScale: boolean;
    showShapes: boolean;
  } | null>(null);
  const [inspectorPosition, setInspectorPosition] = useState<{ left: number; top: number } | null>(null);
  const [locatedMeasures, setLocatedMeasures] = useState<number[] | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const inspectorDragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);
  const previousHighlightsRef = useRef<number[]>([]);
  const [improvPopover, setImprovPopover] = useState<{
    measure: number; chord: string; scaleLabel: string;
  } | null>(null);

  const clearLocatedMeasures = useCallback(() => {
    if (!locatedMeasures) return;
    const displayedHighlights = highlightedMeasures ?? [];
    const inspectorStillOwnsHighlight = (
      displayedHighlights.length === locatedMeasures.length
      && displayedHighlights.every((measure, index) => measure === locatedMeasures[index])
    );
    onHighlightMeasures?.(
      inspectorStillOwnsHighlight ? previousHighlightsRef.current : displayedHighlights,
    );
    setLocatedMeasures(null);
    previousHighlightsRef.current = [];
  }, [highlightedMeasures, locatedMeasures, onHighlightMeasures]);

  const closeChordInspector = useCallback(() => {
    if (locatedMeasures) {
      const displayedHighlights = highlightedMeasures ?? [];
      const inspectorStillOwnsHighlight = (
        displayedHighlights.length === locatedMeasures.length
        && displayedHighlights.every((measure, index) => measure === locatedMeasures[index])
      );
      onHighlightMeasures?.(
        inspectorStillOwnsHighlight ? previousHighlightsRef.current : displayedHighlights,
      );
    }
    setLocatedMeasures(null);
    previousHighlightsRef.current = [];
    setChordPopover(null);
    setInspectorPosition(null);
    inspectorDragRef.current = null;
  }, [highlightedMeasures, locatedMeasures, onHighlightMeasures]);

  useEffect(() => {
    const handleUp = (ev: MouseEvent) => {
      if (dragStart !== null) {
        const s = Math.min(dragStart, dragEnd ?? dragStart);
        const e = Math.max(dragStart, dragEnd ?? dragStart);
        if (s < e) {
          wasDraggingRef.current = true;
          setDragMenu({ startMeasure: s, endMeasure: e, x: ev.clientX, y: ev.clientY });
          setDragMenuStep(null);
        }
        setDragStart(null);
        setDragEnd(null);
      }
    };
    document.addEventListener("mouseup", handleUp);
    return () => document.removeEventListener("mouseup", handleUp);
  }, [dragStart, dragEnd]);

  // Esc clears drag menu, pick mode, active loop, or theory popovers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (dragMenu) { setDragMenu(null); setDragMenuStep(null); return; }
      if (letRingPickRange) { onLetRingPickDone?.(); return; }
      if (chordPopover && locatedMeasures) {
        e.preventDefault();
        e.stopPropagation();
        clearLocatedMeasures();
        return;
      }
      if (chordPopover) {
        e.preventDefault();
        e.stopPropagation();
        closeChordInspector();
        return;
      }
      if (improvPopover) { setImprovPopover(null); return; }
      if (onClearLoop && loopMeasureRegion) onClearLoop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    onClearLoop,
    loopMeasureRegion,
    chordPopover,
    improvPopover,
    dragMenu,
    letRingPickRange,
    onLetRingPickDone,
    locatedMeasures,
    clearLocatedMeasures,
    closeChordInspector,
  ]);

  // Effective loop highlight: drag preview overrides committed region
  const loopHighlightStart = dragStart !== null
    ? Math.min(dragStart, dragEnd ?? dragStart)
    : loopMeasureRegion?.startMeasure ?? null;
  const loopHighlightEnd = dragStart !== null
    ? Math.max(dragStart, dragEnd ?? dragStart)
    : loopMeasureRegion?.endMeasure ?? null;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (w: number) => { if (w > 0) setContainerW(w); };
    update(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(entries => update(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!chordPopover || !inspectorPosition) return;
    const clampInspector = () => {
      const panel = inspectorRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setInspectorPosition(position => {
        if (!position) return position;
        const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, position.left));
        const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, position.top));
        return left === position.left && top === position.top ? position : { left, top };
      });
    };
    const frame = requestAnimationFrame(clampInspector);
    window.addEventListener("resize", clampInspector);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", clampInspector);
    };
  }, [chordPopover, inspectorPosition]);

  const displayNotes = useMemo(() => normalizeChordBeats(notes), [notes]);
  const byMeasure = useMemo(() => groupByMeasure(displayNotes), [displayNotes]);

  // Cut off at last note's measure — no trailing empty bars
  const measureNums = useMemo(() => {
    const keys = Array.from(byMeasure.keys()).sort((a, b) => a - b);
    if (keys.length === 0) return [1];
    const minM = keys[0];
    const maxM = keys[keys.length - 1];
    return Array.from({ length: maxM - minM + 1 }, (_, i) => i + minM);
  }, [byMeasure]);
  const maxMeasure = measureNums[measureNums.length - 1] ?? 1;

  const effectiveW  = Math.max(320, containerW || 800);
  const usableW     = effectiveW - FIRST_STAFF_LEFT;
  const measPerRow  = Math.max(1, Math.floor(usableW / MIN_MEASURE_W));
  const measureW    = usableW / measPerRow;

  const rows = useMemo<number[][]>(() => {
    const r: number[][] = [];
    for (let i = 0; i < measureNums.length; i += measPerRow) {
      r.push(measureNums.slice(i, i + measPerRow));
    }
    return r.length ? r : [[]];
  }, [measureNums, measPerRow]);

  type NotePos = { rowIndex: number; miInRow: number; x: number; y: number };
  const notePositions = useMemo<Map<string, NotePos>>(() => {
    const map = new Map<string, NotePos>();
    for (const note of displayNotes) {
      const rowIndex = rows.findIndex(r => r.includes(note.measure));
      if (rowIndex === -1) continue;
      const miInRow = rows[rowIndex].indexOf(note.measure);
      const staffLeft = rowIndex === 0 ? FIRST_STAFF_LEFT : STAFF_LEFT;
      map.set(note.id, {
        rowIndex,
        miInRow,
        x: rowBeatX(miInRow, note.beat, measureW, staffLeft, beatsPerMeasure),
        y: PAD_TOP + stringY(note.string),
      });
    }
    return map;
  }, [displayNotes, rows, measureW, beatsPerMeasure]);

  const playedNotePositions = useMemo<Map<string, NotePos>>(() => {
    const map = new Map<string, NotePos>();
    for (const note of playedTakeNotes ?? []) {
      const rowIndex = rows.findIndex(r => r.includes(note.measure));
      if (rowIndex === -1) continue;
      const miInRow = rows[rowIndex].indexOf(note.measure);
      const staffLeft = rowIndex === 0 ? FIRST_STAFF_LEFT : STAFF_LEFT;
      map.set(note.id, {
        rowIndex,
        miInRow,
        x: rowBeatX(miInRow, note.beat, measureW, staffLeft, beatsPerMeasure),
        y: 0,
      });
    }
    return map;
  }, [playedTakeNotes, rows, measureW, beatsPerMeasure]);

  const theoryStripVisible = Boolean(
    theoryMeasures?.length
    && theoryToggles
    && Object.values(theoryToggles).some(Boolean),
  );

  const openTheoryInspector = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const measure = Number(event.currentTarget.dataset.measure);
    const theory = theoryMeasures?.find(candidate => candidate.measure === measure);
    if (!theory) return;
    const displayedHighlights = highlightedMeasures ?? [];
    const inspectorStillOwnsHighlight = Boolean(
      locatedMeasures
      && displayedHighlights.length === locatedMeasures.length
      && displayedHighlights.every((value, index) => value === locatedMeasures[index])
    );
    const previousHighlights = inspectorStillOwnsHighlight
      ? previousHighlightsRef.current
      : displayedHighlights;
    const currentKey = theory.shape.positions.map(position => `${position.string}:${position.fret}`).join(",");
    const alternatives = theoryShapes
      .filter(result => {
        if (result.shape.label !== theory.chord) return false;
        const key = result.shape.positions.map(position => `${position.string}:${position.fret}`).join(",");
        return key !== currentKey;
      })
      .slice(0, 3);
    const anchor = event.currentTarget.getBoundingClientRect();
    const panelWidth = Math.min(360, window.innerWidth - 16);
    const estimatedHeight = 330;
    const spaceRight = window.innerWidth - anchor.right - 8;
    const left = spaceRight >= panelWidth
      ? anchor.right + 8
      : Math.max(8, anchor.left - panelWidth - 8);
    const top = Math.max(8, Math.min(window.innerHeight - estimatedHeight - 8, anchor.top));

    setImprovPopover(null);
    previousHighlightsRef.current = [...previousHighlights];
    setLocatedMeasures([measure]);
    onHighlightMeasures?.([measure]);
    setChordPopover({
      measure: theory.measure,
      chord: theory.chord,
      roman: theory.roman,
      current: theory.shape,
      alternatives,
      confidence: theory.confidence,
      scaleLabel: theory.improvScale,
      showScale: Boolean(theoryToggles?.improvGuides),
      showShapes: Boolean(theoryToggles?.fretboardPatterns),
    });
    setInspectorPosition({ left, top });
    onMeasureTheoryClick?.(theory.measure);
  }, [
    highlightedMeasures,
    locatedMeasures,
    onHighlightMeasures,
    onMeasureTheoryClick,
    theoryMeasures,
    theoryShapes,
    theoryToggles?.fretboardPatterns,
    theoryToggles?.improvGuides,
  ]);

  return (
    <div ref={containerRef} style={{ width: "100%", backgroundColor: STAFF_BG, boxSizing: "border-box", padding: `0 ${TAB_SIDE_PAD}px`, position: "relative" }}>
      {containerW > 0 && rows.map((rowMeasures, ri) => {
        const staffLeft = ri === 0 ? FIRST_STAFF_LEFT : STAFF_LEFT;
        const staffTop = PAD_TOP;
        const staffLineTop = staffTop + stringY(1);
        const staffLineBottom = staffTop + stringY(6);
        const stemTop  = staffTop + STAFF_H + RHYTHM_GAP;
        const beamY    = stemTop + STEM_LEN;
        const playedLaneTop = stemTop + STEM_LEN + PLAYED_TAKE_GAP + 6;
        const extraPlayedH = showPlayedTakeLane ? STAFF_H + PLAYED_TAKE_GAP + 14 : 0;
        const svgH     = ROW_H + extraPlayedH + (ri < rows.length - 1 ? ROW_GAP : 16);

        const rowNotes = displayNotes.filter(n => notePositions.get(n.id)?.rowIndex === ri);

        const absBeat = playbackBeat ?? (currentMeasure != null ? (currentMeasure - 1) * beatsPerMeasure : undefined);
        const cursorMeasure = absBeat != null ? Math.floor(absBeat / beatsPerMeasure) + 1 : undefined;
        const beatInMeasure = absBeat != null ? (absBeat % beatsPerMeasure) + 1 : 1 + beatsPerMeasure / 2;

        // Hide playback cursor while in let-ring pick mode — the moving bar is distracting
        const showCursor    = !letRingPickRange && cursorMeasure !== undefined && rowMeasures.includes(cursorMeasure);
        const cursorMiInRow = showCursor ? rowMeasures.indexOf(cursorMeasure!) : -1;
        const cursorX       = cursorMiInRow >= 0
          ? staffLeft + cursorMiInRow * measureW
            + ((beatInMeasure - 1 + RHYTHM_EDGE_BEATS) / beatsPerMeasure) * measureW
          : 0;

        const getMeasureAtX = (clientX: number, svg: SVGSVGElement): number | null => {
          const pt = svg.createSVGPoint();
          pt.x = clientX; pt.y = 0;
          const ctm = svg.getScreenCTM();
          if (!ctm) return null;
          const local = pt.matrixTransform(ctm.inverse());
          const relX = local.x - staffLeft;
          if (relX < 0) return null;
          const mi2 = Math.floor(relX / measureW);
          if (mi2 < 0 || mi2 >= rowMeasures.length) return null;
          return rowMeasures[mi2];
        };

        const handleStaffClick = (e: React.MouseEvent<SVGRectElement>) => {
          if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
          if (!onSeek) return;
          const svg = e.currentTarget.ownerSVGElement;
          if (!svg) return;
          const pt = svg.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const ctm = svg.getScreenCTM();
          if (!ctm) return;
          const local = pt.matrixTransform(ctm.inverse());
          const x = local.x;
          const relX = x - staffLeft;
          if (relX < 0) return;
          const mi = Math.floor(relX / measureW);
          if (mi < 0 || mi >= rowMeasures.length) return;
          const mNum = rowMeasures[mi];
          const beat = rowXToBeat(mi, x, measureW, staffLeft, beatsPerMeasure);
          const absolute = (mNum - 1) * beatsPerMeasure + (beat - 1);
          onSeek(absolute);
        };

        const handleLoopMouseDown = (e: React.MouseEvent<SVGRectElement>) => {
          if (!onLoopRangeChange) return;
          const svg = e.currentTarget.ownerSVGElement;
          if (!svg) return;
          const mNum = getMeasureAtX(e.clientX, svg);
          if (mNum !== null) { setDragStart(mNum); setDragEnd(mNum); }
        };

        const handleLoopMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
          if (dragStart === null || !onLoopRangeChange) return;
          if ((e.buttons & 1) === 0) return;
          const svg = e.currentTarget.ownerSVGElement;
          if (!svg) return;
          const mNum = getMeasureAtX(e.clientX, svg);
          if (mNum !== null) setDragEnd(mNum);
        };

        return (
          <div key={ri} style={{ position: "relative" }}>
            {theoryStripVisible && (
              <div
                aria-label={`Theory for measures ${rowMeasures[0]} through ${rowMeasures[rowMeasures.length - 1]}`}
                style={{
                  width: effectiveW,
                  height: 18,
                  display: "flex",
                  alignItems: "stretch",
                  boxSizing: "border-box",
                  marginBottom: 1,
                  overflow: "hidden",
                }}
              >
                {ri === 0 ? (
                  <div
                  aria-hidden="true"
                  style={{
                    width: staffLeft,
                    flex: "0 0 auto",
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: ri === 0 ? 7 : 4,
                    boxSizing: "border-box",
                    border: "1px solid rgba(202,138,4,0.52)",
                    borderRight: "none",
                    background: "linear-gradient(90deg, rgba(202,138,4,0.24), rgba(202,138,4,0.08))",
                    color: "#e0a93f",
                    fontSize: 7,
                    fontWeight: 900,
                    letterSpacing: "0.55px",
                  }}
                >
                    THEORY
                  </div>
                ) : (
                  <div aria-hidden="true" style={{ width: staffLeft, flex: "0 0 auto" }} />
                )}
                {rowMeasures.map((measure, measureIndex) => {
                  const theory = theoryMeasures?.find(candidate => candidate.measure === measure);
                  if (!theory) {
                    return (
                      <div
                        key={measure}
                        style={{
                          width: measureW,
                          flex: "0 0 auto",
                          borderLeft: "1px solid var(--ss-panel-border)",
                          borderRight: measureIndex === rowMeasures.length - 1
                            ? "1px solid var(--ss-panel-border)"
                            : "none",
                        }}
                      />
                    );
                  }
                  const showFallbackChord = !theoryToggles?.chordNames && !theoryToggles?.romanNumerals;
                  const parts = [
                    theoryToggles?.chordNames || showFallbackChord ? theory.chord : "",
                    theoryToggles?.romanNumerals ? theory.roman : "",
                  ].filter(Boolean);
                  const inspected = chordPopover?.measure === measure;
                  const current = currentMeasure === measure;
                  return (
                    <button
                      key={measure}
                      type="button"
                      data-measure={measure}
                      onClick={openTheoryInspector}
                      aria-pressed={inspected}
                      title={`Measure ${measure}: ${theory.chord}. Open theory inspector.`}
                      style={{
                        width: measureW,
                        minWidth: 0,
                        flex: "0 0 auto",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "0 7px",
                        boxSizing: "border-box",
                        borderTop: "1px solid var(--ss-panel-border)",
                        borderBottom: "1px solid var(--ss-panel-border)",
                        borderLeft: inspected
                          ? "2px solid var(--ss-accent)"
                          : "1px solid var(--ss-panel-border)",
                        borderRight: measureIndex === rowMeasures.length - 1
                          ? "1px solid var(--ss-panel-border)"
                          : "none",
                        outline: inspected
                          ? "1px solid var(--ss-accent)"
                          : current
                            ? "1px solid var(--ss-text-muted)"
                            : "none",
                        outlineOffset: -2,
                        background: inspected
                          ? "var(--ss-accent-soft)"
                          : measureIndex % 2 === 0
                            ? "rgba(202,138,4,0.055)"
                            : "rgba(155,143,215,0.055)",
                        color: "var(--ss-text-secondary)",
                        cursor: "pointer",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ flexShrink: 0, color: "#d79f36", fontSize: 8, fontWeight: 850 }}>
                        M{measure}
                      </span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "var(--ss-text-title)", fontSize: 9, fontWeight: 750 }}>
                        {parts.map((part, index) => index === 0 && (theoryToggles?.chordNames || showFallbackChord)
                          ? expandedChordName(part, theory.shape.pitchClasses)
                          : part).join(" · ")}
                      </span>
                      <span aria-hidden="true" style={{ marginLeft: "auto", flexShrink: 0, color: "#9b8fd7", fontSize: 7, fontWeight: 700 }}>
                        details ›
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <svg
              width={effectiveW}
              height={svgH}
              style={{ display: "block", overflow: "visible" }}
              fontFamily="-apple-system, system-ui, BlinkMacSystemFont, Arial, sans-serif"
            >
              {/* ── Theory highlight — measures highlighted from Theory tab chord/shape click ── */}
              {highlightedMeasures && highlightedMeasures.length > 0 && rowMeasures.map((mNum, mi) => {
                if (!highlightedMeasures.includes(mNum)) return null;
                return (
                  <rect
                    key={`hi-${mNum}`}
                    x={staffLeft + mi * measureW}
                    y={staffTop - 4}
                    width={measureW}
                    height={STAFF_H + 8}
                    fill="rgba(155,143,215,0.08)"
                    stroke="rgba(155,143,215,0.28)"
                    strokeWidth={1}
                    rx={2}
                    pointerEvents="none"
                  />
                );
              })}

              {/* ── Loop region highlight ── */}
              {loopHighlightStart !== null && loopHighlightEnd !== null && rowMeasures.map((mNum, mi) => {
                if (mNum < loopHighlightStart || mNum > loopHighlightEnd) return null;
                return (
                  <rect
                    key={`loop-hi-${mNum}`}
                    x={staffLeft + mi * measureW}
                    y={staffTop - 2}
                    width={measureW}
                    height={STAFF_H + 4}
                    fill="rgba(35,140,53,0.10)"
                    stroke="rgba(35,140,53,0.30)"
                    strokeWidth={mNum === loopHighlightStart || mNum === loopHighlightEnd ? 1.5 : 0}
                    strokeDasharray={mNum === loopHighlightStart ? "none" : "none"}
                    pointerEvents="none"
                  />
                );
              })}

              {/* ── Let-ring pick-mode: cyan outline on in-range measures ── */}
              {letRingPickRange && rowMeasures.map((mNum, mi) => {
                if (mNum < letRingPickRange.start || mNum > letRingPickRange.end) return null;
                return (
                  <rect
                    key={`lr-pick-${mNum}`}
                    x={staffLeft + mi * measureW + 1}
                    y={staffTop - 3}
                    width={measureW - 2}
                    height={STAFF_H + 6}
                    fill="rgba(56,189,248,0.06)"
                    stroke="rgba(56,189,248,0.45)"
                    strokeWidth={1.2}
                    strokeDasharray="5 3"
                    rx={2}
                    pointerEvents="none"
                  />
                );
              })}

              {/* ── Tempo (first row) — left of staff so it never collides with let ring ── */}
              {ri === 0 && (
                <text x={4} y={14} fill="#8a8a8a" fontSize={11} fontWeight={600}>
                  {Math.round(bpm)} BPM
                </text>
              )}

              {/* Staff gutter for tuning and time signature; it does not consume measure 1. */}
              {ri === 0 && STRING_LABELS.map((_, i) => (
                <line
                  key={`sig-line-${i}`}
                  x1={22}
                  y1={staffTop + stringY(i + 1)}
                  x2={staffLeft}
                  y2={staffTop + stringY(i + 1)}
                  stroke={TAB.strings}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {/* ── String lines ── */}
              {STRING_LABELS.map((_, i) => (
                <line
                  key={`sl-${ri}-${i}`}
                  x1={staffLeft} y1={staffTop + stringY(i + 1)}
                  x2={staffLeft + rowMeasures.length * measureW} y2={staffTop + stringY(i + 1)}
                  stroke={TAB.strings} strokeWidth={1} vectorEffect="non-scaling-stroke"
                />
              ))}

              {/* ── Measure bar lines ── */}
              {rowMeasures.map((mNum, mi) => {
                if (ri === 0 && mi === 0) return null;
                return (
                  <line
                    key={`bar-${ri}-${mi}`}
                    x1={staffLeft + mi * measureW} y1={staffLineTop}
                    x2={staffLeft + mi * measureW} y2={staffLineBottom}
                    stroke={mNum === cursorMeasure ? "#238c35" : TAB.measure}
                    strokeWidth={mNum === cursorMeasure ? 2 : 1}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              <line
                x1={staffLeft + rowMeasures.length * measureW} y1={staffLineTop}
                x2={staffLeft + rowMeasures.length * measureW} y2={staffLineBottom}
                stroke={TAB.measure} strokeWidth={1} vectorEffect="non-scaling-stroke"
              />

              {/* ── First-staff tuning + time signature draw over the staff lines ── */}
              {ri === 0 && (
                <>
                  {STRING_LABELS.map((label, i) => (
                    <text
                      key={`lbl-${ri}-${i}`}
                      x={TUNING_X}
                      y={staffTop + stringY(i + 1)}
                      fill={TAB.tuning}
                      fontSize={12}
                      fontWeight={400}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontFamily="-apple-system, system-ui, BlinkMacSystemFont, Arial, sans-serif"
                    >
                      {label}
                    </text>
                  ))}
                  <g>
                    <text
                      x={SIG_CENTER_X}
                      y={staffTop + STRING_H * 1.55}
                      fill={TAB.signature}
                      fontSize={52}
                      fontWeight={400}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontFamily="-apple-system, system-ui, BlinkMacSystemFont, Arial, sans-serif"
                    >{beatsPerMeasure}</text>
                    <text
                      x={SIG_CENTER_X}
                      y={staffTop + STRING_H * 4.15}
                      fill={TAB.signature}
                      fontSize={52}
                      fontWeight={400}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontFamily="-apple-system, system-ui, BlinkMacSystemFont, Arial, sans-serif"
                    >4</text>
                  </g>
                </>
              )}

              {/* Seek under notes in editor mode (click gaps between notes) */}
              {onSeek && editorMode && !letRingPickRange && (
                <rect
                  x={staffLeft}
                  y={staffTop}
                  width={rowMeasures.length * measureW}
                  height={STAFF_H}
                  fill="transparent"
                  style={{ cursor: dragStart !== null ? "crosshair" : "pointer" }}
                  onClick={handleStaffClick}
                  onMouseDown={handleLoopMouseDown}
                  onMouseMove={handleLoopMouseMove}
                />
              )}

              {/* ── Let ring spans — one label per measure (Songsterr style) ── */}
              {computeLetRingSpans(rowNotes).map(({ measure, startBeat, endBeat }) => {
                const miInRow = rowMeasures.indexOf(measure);
                if (miInRow < 0) return null;
                const cappedEnd = Math.min(endBeat, beatsPerMeasure + 1);
                const x1 = rowBeatX(miInRow, startBeat, measureW, staffLeft, beatsPerMeasure);
                const x2 = rowBeatX(miInRow, cappedEnd, measureW, staffLeft, beatsPerMeasure);
                // Sit below measure numbers; indent past the measure number so they don't collide
                const measureLeft = staffLeft + miInRow * measureW;
                const textX = Math.max(x1, measureLeft + 22);
                const y = staffTop - 8;
                const lineStart = textX + 44;
                if (x2 - lineStart < 8) return (
                  <g key={`lr-m${measure}`}>
                    <text x={textX} y={y - 2} fill="#8a8b8c" fontSize={10} fontWeight={700}>let ring</text>
                  </g>
                );
                return (
                  <g key={`lr-m${measure}`}>
                    <text x={textX} y={y - 2} fill="#8a8b8c" fontSize={10} fontWeight={700}>let ring</text>
                    <line x1={lineStart} y1={y} x2={x2 - 3} y2={y} stroke="#8a8b8c" strokeWidth={1} strokeDasharray="5 3" />
                    <line x1={x2 - 3} y1={y - 4} x2={x2 - 3} y2={y + 4} stroke="#8a8b8c" strokeWidth={1.2} />
                  </g>
                );
              })}

              {/* ── Rests on the tab staff ── */}
              {rowMeasures.flatMap((mNum, mi) => {
                const mNotes = byMeasure.get(mNum) ?? [];
                const rests = findRests(mNotes, beatsPerMeasure);
                return rests.map((r, ri2) => (
                  <StaffRestGlyph
                    key={`staff-rest-${ri}-${mNum}-${ri2}`}
                    x={rowBeatX(mi, r.beat, measureW, staffLeft, beatsPerMeasure)}
                    staffTop={staffTop}
                    gapBeats={r.gapBeats}
                  />
                ));
              })}

              {/* ── Rhythm lane (stems, flags, and beat-grouped beams) ── */}
              {rowMeasures.map((mNum, mi) => {
                const mNotes = (byMeasure.get(mNum) ?? []).sort((a, b) => a.beat - b.beat);

                // One stem column per unique beat position
                const beatCols = [...new Set(mNotes.map(n => Math.round(n.beat * 4) / 4))].sort((a, b) => a - b);
                type Col = { beat: number; x: number; dur: number };
                const cols: Col[] = beatCols.map((beat, colIdx) => {
                  const atBeat = mNotes.filter(n => Math.abs(n.beat - beat) < 0.06);
                  const rawDur = Math.max(...atBeat.map(n => n.durationBeats), 0.25);
                  // Defensive clamp: never overlap next attack or exceed bar
                  const barRemaining = beatsPerMeasure - (beat - 1);
                  const distToNext = colIdx + 1 < beatCols.length ? beatCols[colIdx + 1] - beat : barRemaining;
                  const dur = Math.max(0.25, Math.min(rawDur, distToNext, barRemaining));
                  return {
                    beat,
                    x: rowBeatX(mi, beat, measureW, staffLeft, beatsPerMeasure),
                    dur,
                  };
                });

                // Beam short values inside a beat so the pulse remains legible.
                const beamGroups: Col[][] = [];
                let group: Col[] = [];
                let groupBeat = -1;
                const flush = () => {
                  if (group.length >= 2) beamGroups.push(group);
                  group = [];
                  groupBeat = -1;
                };
                for (let i = 0; i < cols.length; i++) {
                  const c = cols[i];
                  const isShort = c.dur <= 0.6;
                  if (!isShort) { flush(); continue; }
                  const beatBucket = Math.floor(c.beat - 1 + 0.001);
                  if (group.length === 0) {
                    group = [c];
                    groupBeat = beatBucket;
                    continue;
                  }
                  const prev = group[group.length - 1];
                  if (beatBucket === groupBeat && c.beat - prev.beat <= 0.6) {
                    group.push(c);
                  } else {
                    flush();
                    group = [c];
                    groupBeat = beatBucket;
                  }
                }
                flush();
                const beamedXs = new Set(beamGroups.flatMap(g => g.map(c => c.x)));

                return (
                  <g key={`rhy-${ri}-${mNum}`}>
                    {cols.map((col, si) => {
                      const isSixteenth = col.dur <= 0.28;
                      const isEighth = col.dur <= 0.55;
                      const isWhole = col.dur >= 3.5;
                      const hasStem = !isWhole;
                      const isBeamed = beamedXs.has(col.x);
                      const hasFlag = hasStem && (isEighth || isSixteenth) && !isBeamed;
                      const nearestGrid = [0.25, 0.5, 1, 2, 4].reduce((a, b) =>
                        Math.abs(col.dur - a) < Math.abs(col.dur - b) ? a : b,
                      );
                      const isDotted = Math.abs(col.dur - nearestGrid * 1.5) < 0.08;
                      return (
                        <g key={`stem-${ri}-${mi}-${si}`}>
                          {hasStem && !isBeamed && (
                            <line
                              x1={col.x}
                              y1={stemTop}
                              x2={col.x}
                              y2={beamY}
                              stroke={TAB.rhythm}
                              strokeWidth={1.9}
                              strokeLinecap="butt"
                            />
                          )}
                          {hasFlag && (
                            <path
                              d={isSixteenth
                                ? `M ${col.x},${beamY} q 10,-5 6,12 M ${col.x},${beamY + 8} q 10,-5 6,12`
                                : `M ${col.x},${beamY} q 11,-5 6,14`}
                              fill="none" stroke={TAB.rhythm} strokeWidth={1.9} strokeLinecap="round"
                            />
                          )}
                          {isDotted && (
                            <circle cx={col.x + 7} cy={stemTop + 3} r={2} fill={TAB.rhythm} />
                          )}
                        </g>
                      );
                    })}
                    {beamGroups.map((g, bi) => {
                      const stems = g.map(c => `M ${c.x},${stemTop} V ${beamY}`).join(" ");
                      const beam = `M ${g[0].x},${beamY} H ${g[g.length - 1].x}`;
                      return (
                        <path
                          key={`beam-${ri}-${mi}-${bi}`}
                          d={`${stems} ${beam}`}
                          fill="none"
                          stroke={TAB.rhythm}
                          strokeWidth={1.9}
                          strokeLinecap="butt"
                          strokeLinejoin="miter"
                        />
                      );
                    })}
                    {/* Double beam for sixteenth groups */}
                    {beamGroups.map((g, bi) => {
                      if (!g.every(c => c.dur <= 0.28)) return null;
                      return (
                        <line
                          key={`beam2-${ri}-${mi}-${bi}`}
                          x1={g[0].x}
                          y1={beamY - 5}
                          x2={g[g.length - 1].x}
                          y2={beamY - 5}
                          stroke={TAB.rhythm}
                          strokeWidth={1.9}
                          strokeLinecap="butt"
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* ── Played-take comparison staff (6-string transcription lane) ── */}
              {showPlayedTakeLane && (playedTakeNotes?.length ?? 0) > 0 && (
                <g opacity={0.92}>
                  <text
                    x={TUNING_X}
                    y={playedLaneTop + STAFF_H / 2}
                    fill="#6d6d6d"
                    fontSize={9}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    you
                  </text>
                  <line
                    x1={staffLeft}
                    y1={playedLaneTop - 4}
                    x2={staffLeft + rowMeasures.length * measureW}
                    y2={playedLaneTop - 4}
                    stroke="#3c3b40"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                  {STRING_LABELS.map((_, i) => (
                    <line
                      key={`played-sl-${ri}-${i}`}
                      x1={staffLeft}
                      y1={playedLaneTop + stringY(i + 1)}
                      x2={staffLeft + rowMeasures.length * measureW}
                      y2={playedLaneTop + stringY(i + 1)}
                      stroke="#4a4a4e"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {rowMeasures.map((mNum, mi) => (
                    <line
                      key={`played-bar-${ri}-${mi}`}
                      x1={staffLeft + mi * measureW}
                      y1={playedLaneTop}
                      x2={staffLeft + mi * measureW}
                      y2={playedLaneTop + STAFF_H}
                      stroke="#4a4a4e"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {(playedTakeNotes ?? [])
                    .filter(n => rowMeasures.includes(n.measure))
                    .map(note => {
                      const pos = playedNotePositions.get(note.id);
                      if (!pos) return null;
                      const y = playedLaneTop + stringY(note.string);
                      const fill = note.uncertain ? "#6d6d6d" : note.isGhost ? "#7a7299" : "#6aa878";
                      const opacity = note.uncertain ? 0.35 : note.isGhost ? 0.4 : 0.65;
                      const label = String(note.fret);
                      const bandW = label.length >= 2 ? 16 : 12;
                      return (
                        <g key={`played-${note.id}`} opacity={opacity}>
                          <rect
                            x={pos.x - bandW / 2}
                            y={y - 7}
                            width={bandW}
                            height={14}
                            rx={2}
                            fill={note.uncertain ? "rgba(120,120,120,0.12)" : "rgba(35,140,53,0.12)"}
                          />
                          <text
                            x={pos.x}
                            y={y + 4}
                            fill={fill}
                            fontSize={11}
                            fontWeight={700}
                            textAnchor="middle"
                            fontStyle={note.uncertain ? "italic" : "normal"}
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}
                  <text
                    x={staffLeft + rowMeasures.length * measureW - 4}
                    y={playedLaneTop + STAFF_H + 10}
                    fill="#6d6d6d"
                    fontSize={8}
                    textAnchor="end"
                    fontStyle="italic"
                  >
                    transcription — approximate
                  </text>
                </g>
              )}

              {/* ── Fret numbers (bold, directly on strings) ── */}
              {rowNotes.map(note => {
                const pos    = notePositions.get(note.id)!;
                const inPickRange = letRingPickRange != null
                  && note.measure >= letRingPickRange.start
                  && note.measure <= letRingPickRange.end;
                const s      = inPickRange && note.letRing
                  ? { text: "#38bdf8", band: "rgba(56,189,248,0.20)" }
                  : NOTE_STYLE[note.status ?? "unplayed"];
                const label  = String(note.fret);
                const bandW  = label.length >= 2 ? 19 : 14;
                const status = note.status ?? "unplayed";
                const isSelected = editorMode && selectedNoteId === note.id;
                return (
                  <g
                    key={note.id}
                    data-tab-note="true"
                    style={{ cursor: inPickRange ? "pointer" : editorMode ? "pointer" : "context-menu" }}
                    onClick={inPickRange && onLetRingNotePick
                      ? (e) => { e.stopPropagation(); onLetRingNotePick(note.id); }
                      : editorMode && onNoteSelect
                        ? (e) => { e.stopPropagation(); onNoteSelect(note.id); }
                        : undefined}
                    onContextMenu={!inPickRange && onNoteContextMenu ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onNoteContextMenu(note.id);
                    } : undefined}
                  >
                    {isSelected && (
                      <rect
                        x={pos.x - bandW / 2 - 3} y={pos.y - 11}
                        width={bandW + 6} height={22}
                        rx={3}
                        fill="none"
                        stroke="#5376f0"
                        strokeWidth={2}
                      />
                    )}
                    <rect
                      x={pos.x - bandW / 2} y={pos.y - 8}
                      width={bandW} height={15}
                      rx={status === "unplayed" ? 0 : 2}
                      style={{ fill: s.band }}
                    />
                    <text
                      x={pos.x} y={pos.y + 0.5}
                      style={{ fill: s.text }}
                      fontSize={13.5} fontWeight={700}
                      fontFamily="-apple-system, system-ui, Arial, sans-serif"
                      textAnchor="middle" dominantBaseline="middle"
                    >
                      {label}
                    </text>

                    {/* Bend marker */}
                    {note.technique === "bend" && (() => {
                      const bx = pos.x + (bandW / 2) + 2;
                      const bendLabel = note.bendSemitones
                        ? (note.bendSemitones >= 1.8 ? "full" : note.bendSemitones >= 0.9 ? "1/2" : "1/4")
                        : "b";
                      return (
                        <g>
                          <path
                            d={`M ${bx},${pos.y - 8} C ${bx + 4},${pos.y - 14} ${bx + 8},${pos.y - 20} ${bx + 6},${pos.y - 22}`}
                            fill="none" stroke={TAB.technique} strokeWidth={1.4} strokeLinecap="round"
                          />
                          <path
                            d={`M ${bx + 3},${pos.y - 24} L ${bx + 7},${pos.y - 20} L ${bx + 10},${pos.y - 24}`}
                            fill="none" stroke={TAB.technique} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round"
                          />
                          <text x={bx + 6} y={pos.y - 26}
                            fill={TAB.technique} fontSize={8} fontWeight={600} textAnchor="middle"
                          >{bendLabel}</text>
                        </g>
                      );
                    })()}

                    {/* Vibrato marker */}
                    {note.technique === "vibrato" && (() => {
                      const wx = pos.x + (bandW / 2) + 2;
                      const wy = pos.y - 10;
                      const wavePath = `M ${wx},${wy} q 2.5,-4 5,0 t 5,0 t 5,0 t 5,0`;
                      return (
                        <path d={wavePath} fill="none"
                          stroke={TAB.technique} strokeWidth={1.2} strokeLinecap="round"
                        />
                      );
                    })()}
                  </g>
                );
              })}

              {/* ── Inter-note technique connectors (hammer / pull / slide) ── */}
              {rowNotes.map(note => {
                const tech = note.technique;
                if (tech !== "hammer" && tech !== "pull" && tech !== "slide") return null;
                const p1 = notePositions.get(note.id);
                if (!p1) return null;
                const next = nextOnString(rowNotes, note);
                if (!next) return null;
                const p2 = notePositions.get(next.id);
                if (!p2) return null;
                const mx   = (p1.x + p2.x) / 2;
                const arcY = Math.min(p1.y, p2.y) - 15;

                if (tech === "hammer" || tech === "pull") {
                  return (
                    <g key={`tech-${note.id}`}>
                      <path
                        d={`M ${p1.x + 7},${p1.y - 4} Q ${mx},${arcY} ${p2.x - 7},${p2.y - 4}`}
                        fill="none" stroke={TAB.technique} strokeWidth={1.3} strokeLinecap="round"
                      />
                      <text x={mx} y={arcY - 3} fill={TAB.technique}
                        fontSize={9} fontWeight={600} textAnchor="middle"
                      >
                        {tech === "hammer" ? "H" : "P"}
                      </text>
                    </g>
                  );
                }

                const ascending = next.fret > note.fret;
                const slideY1   = ascending ? p1.y + 3 : p1.y - 3;
                const slideY2   = ascending ? p2.y - 3 : p2.y + 3;
                return (
                  <g key={`tech-${note.id}`}>
                    <line
                      x1={p1.x + 8} y1={slideY1}
                      x2={p2.x - 8} y2={slideY2}
                      stroke={TAB.technique} strokeWidth={1.5} strokeLinecap="round"
                    />
                    <text x={mx} y={Math.min(slideY1, slideY2) - 4}
                      fill={TAB.technique} fontSize={10} fontWeight={700} textAnchor="middle"
                    >{ascending ? "/" : "\\"}</text>
                  </g>
                );
              })}

              {/* ── Coach active-range: preserve the focused notation and quietly dim the rest ── */}
              {activeMeasureRange && rowMeasures.map((mNum, mi) => {
                const inRange = mNum >= activeMeasureRange.start && mNum <= activeMeasureRange.end;
                if (inRange) return null;
                return (
                  <rect
                    key={`coach-range-${mNum}`}
                    x={staffLeft + mi * measureW}
                    y={0}
                    width={measureW}
                    height={ROW_H}
                    fill="var(--ss-surface)"
                    opacity={0.58}
                    pointerEvents="none"
                  />
                );
              })}

              {/* ── Measure numbers (just above staff, above let ring) ── */}
              {rowMeasures.map((mNum, mi) => {
                const mx = staffLeft + mi * measureW + 4;
                const active = mNum === cursorMeasure;
                const score = measureScores[mNum];
                const inCoachRange = !activeMeasureRange
                  || (mNum >= activeMeasureRange.start && mNum <= activeMeasureRange.end);
                const numY = staffTop - 3;
                const isTempo = tempoFlags.includes(mNum);
                const isChord = chordFlags.includes(mNum);
                return (
                  <g key={`mnum-${mNum}`}>
                    <rect
                      x={mx - 1}
                      y={numY - 10}
                      width={mNum >= 10 ? 16 : 11}
                      height={12}
                      rx={1.5}
                      fill="var(--ss-surface)"
                      opacity={0.9}
                      pointerEvents="none"
                    />
                    <text
                      x={mx}
                      y={numY}
                      fill={active ? "#60a5fa" : (measureScores[mNum] != null ? scoreToColor(measureScores[mNum]) : inCoachRange ? "var(--ss-text-title)" : "var(--ss-text-muted)")}
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="-apple-system, system-ui, Arial, sans-serif"
                      style={{ cursor: onMeasureTheoryClick ? "pointer" : "default" }}
                      onClick={onMeasureTheoryClick ? () => onMeasureTheoryClick(mNum) : undefined}
                    >
                      {mNum}
                    </text>
                    {score != null && (
                      <text
                        x={mx + (mNum >= 10 ? 17 : 12)}
                        y={numY}
                        fill="var(--ss-text-secondary)"
                        fontSize={9}
                        fontWeight={800}
                        fontFamily="-apple-system, system-ui, Arial, sans-serif"
                        pointerEvents="none"
                      >
                        <title>{`Measure ${mNum}: ${Math.round(score * 100)}% — ${score >= 0.85 ? "secure" : score >= 0.6 ? "developing" : "focus"}`}</title>
                        {score >= 0.85 ? "✓" : score >= 0.6 ? "–" : "!"}
                      </text>
                    )}
                    {/* Tempo flag icon */}
                    {isTempo && onTempoFlagClick && (
                      <g onClick={() => onTempoFlagClick(mNum, maxMeasure)} style={{ cursor: "pointer" }}>
                        <title>{`M${mNum}: possible tempo shift — tap to adjust`}</title>
                        <text
                          x={mx + (mNum >= 10 ? 18 : 13) + (score != null ? 12 : 0)}
                          y={numY}
                          fontSize={9}
                          fill="#f59e0b"
                        >
                          ♩?
                        </text>
                      </g>
                    )}
                    {/* Chord sparse flag icon */}
                    {isChord && onChordFlagClick && (
                      <g onClick={() => onChordFlagClick(mNum)} style={{ cursor: "pointer" }}>
                        <title>{`M${mNum}: chord may be incomplete — tap to fill`}</title>
                        <text
                          x={mx + (mNum >= 10 ? 18 : 13) + (score != null ? 12 : 0) + (isTempo ? 14 : 0)}
                          y={numY}
                          fontSize={9}
                          fill="#a78bfa"
                        >
                          ♪?
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Seek overlay on top when not in editor (click anywhere in measure). Disabled in pick mode so note <g>s receive clicks. */}
              {onSeek && !editorMode && !letRingPickRange && (
                <rect
                  x={staffLeft}
                  y={staffTop}
                  width={rowMeasures.length * measureW}
                  height={STAFF_H}
                  fill="transparent"
                  style={{ cursor: dragStart !== null ? "crosshair" : "pointer" }}
                  onClick={handleStaffClick}
                  onMouseDown={handleLoopMouseDown}
                  onMouseMove={handleLoopMouseMove}
                />
              )}
            </svg>

            {showCursor && (
              <TabCursor x={cursorX} staffTop={staffTop} staffH={STAFF_H} />
            )}
          </div>
        );
      })}

      {/* ── Tempo-correction popup (anchored near the flagged measure) ── */}
      {tempoPrompt && onTempoPromptChange && onTempoPromptApply && (
        <div
          style={{
            position: "sticky",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            width: "min(480px, 92vw)",
            background: "var(--ss-controls-surface, #2a2a2e)",
            border: "1px solid rgba(245,158,11,0.5)",
            borderRadius: 10,
            padding: "14px 16px 12px",
            boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>♩ Tempo change near M{tempoPrompt.measure}?</span>
            <button
              type="button"
              onClick={() => onTempoPromptChange(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--ss-text-muted)", fontSize: 16, lineHeight: 1 }}
              aria-label="Dismiss"
            >×</button>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--ss-text-muted)", lineHeight: 1.4 }}>
            This stretch sounds closer to{" "}
            <strong style={{ color: "#f59e0b" }}>{tempoPrompt.suggestedBpm} BPM</strong>
            {bpm > 0 && tempoPrompt.suggestedBpm !== bpm
              ? ` (song is ${Math.round(bpm)} BPM)`
              : ""}.
            Re-grid measures {tempoPrompt.begin}–{tempoPrompt.end} at that tempo?
          </p>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <label style={{ fontSize: 11, color: "var(--ss-text-muted)", flexShrink: 0 }}>From M</label>
            <input
              type="number" min={1} value={tempoPrompt.begin}
              onChange={e => onTempoPromptChange({ ...tempoPrompt, begin: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 52, padding: "4px 6px", borderRadius: 4, fontSize: 12, fontWeight: 700, border: "1px solid rgba(245,158,11,0.45)", background: "var(--ss-surface)", color: "var(--ss-text)", outline: "none" }}
            />
            <label style={{ fontSize: 11, color: "var(--ss-text-muted)", flexShrink: 0 }}>to M</label>
            <input
              type="number" min={1} value={tempoPrompt.end}
              onChange={e => onTempoPromptChange({ ...tempoPrompt, end: Math.max(tempoPrompt.begin, Number(e.target.value) || tempoPrompt.begin) })}
              style={{ width: 52, padding: "4px 6px", borderRadius: 4, fontSize: 12, fontWeight: 700, border: "1px solid rgba(245,158,11,0.45)", background: "var(--ss-surface)", color: "var(--ss-text)", outline: "none" }}
            />
            <label style={{ fontSize: 11, color: "var(--ss-text-muted)", flexShrink: 0 }}>BPM</label>
            <input
              type="number" min={20} max={300} value={tempoPrompt.suggestedBpm}
              onChange={e => onTempoPromptChange({ ...tempoPrompt, suggestedBpm: Math.max(20, Math.min(300, Number(e.target.value) || 120)) })}
              style={{ width: 60, padding: "4px 6px", borderRadius: 4, fontSize: 12, fontWeight: 700, border: "1px solid rgba(245,158,11,0.45)", background: "var(--ss-surface)", color: "var(--ss-text)", outline: "none" }}
            />
            <button
              type="button"
              onClick={() => onTempoPromptApply(tempoPrompt.begin, tempoPrompt.end, tempoPrompt.suggestedBpm)}
              style={{ padding: "5px 14px", borderRadius: 5, background: "#f59e0b", color: "#fff", fontWeight: 700, fontSize: 12, border: "none", cursor: "pointer" }}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                onTempoFlagDismiss?.(tempoPrompt.measure);
                onTempoPromptChange(null);
              }}
              style={{ padding: "5px 10px", borderRadius: 5, background: "transparent", color: "var(--ss-text-muted)", fontWeight: 600, fontSize: 12, border: "1px solid var(--ss-panel-border)", cursor: "pointer" }}
            >
              Not a tempo change
            </button>
          </div>
        </div>
      )}

      {/* ── Draggable theory inspector ── */}
      {chordPopover && inspectorPosition && (
        <div
          ref={inspectorRef}
          style={{
            position: "fixed",
            left: inspectorPosition.left,
            top: inspectorPosition.top,
            zIndex: 90,
            width: "min(360px, calc(100vw - 16px))",
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            background: "var(--ss-controls-surface, #2a2a2e)",
            border: "1px solid rgba(202,138,4,0.45)", borderRadius: 10,
            padding: "12px 14px", boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
          }}
        >
          <div
            onPointerDown={event => {
              if ((event.target as HTMLElement).closest("button")) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              inspectorDragRef.current = {
                pointerId: event.pointerId,
                dx: event.clientX - inspectorPosition.left,
                dy: event.clientY - inspectorPosition.top,
              };
            }}
            onPointerMove={event => {
              const drag = inspectorDragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              const panel = inspectorRef.current;
              if (!panel) return;
              const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - drag.dx));
              const top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, event.clientY - drag.dy));
              setInspectorPosition({ left, top });
            }}
            onPointerUp={event => {
              if (inspectorDragRef.current?.pointerId !== event.pointerId) return;
              inspectorDragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => {
              inspectorDragRef.current = null;
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "-4px -4px 10px",
              padding: "4px",
              cursor: "move",
              touchAction: "none",
              userSelect: "none",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: "#ca8a04" }}>
              {expandedChordName(chordPopover.chord, chordPopover.current?.pitchClasses)} · {chordPopover.roman} · M{chordPopover.measure}
            </span>
            <span style={{ fontSize: 9, color: "var(--ss-text-muted)", textTransform: "uppercase", letterSpacing: "0.35px" }}>
              {chordPopover.confidence} confidence
            </span>
            <button
              type="button"
              onPointerDown={event => event.stopPropagation()}
              onClick={closeChordInspector}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--ss-text-muted)", fontSize: 16 }}
              aria-label="Close theory inspector"
            >
              ×
            </button>
          </div>
          {chordPopover.current && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "8px", borderRadius: 6, background: "rgba(202,138,4,0.08)" }}>
              <MiniFretboard positions={chordPopover.current.positions} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ss-text-title)" }}>Written pattern</div>
                <div style={{ fontSize: 10, color: "var(--ss-text-muted)", lineHeight: 1.35 }}>
                  Every fret used in M{chordPopover.measure}; this is not necessarily one simultaneous chord grip.
                </div>
              </div>
            </div>
          )}
          {chordPopover.showScale && (
            <div style={{
              marginBottom: 10, padding: "7px 8px", borderRadius: 5,
              background: "rgba(155,143,215,0.08)", border: "1px solid rgba(155,143,215,0.22)",
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#9b8fd7", textTransform: "uppercase", letterSpacing: "0.35px" }}>
                Scale guide
              </div>
              <div style={{ marginTop: 2, fontSize: 10, color: "var(--ss-text-secondary)" }}>{chordPopover.scaleLabel}</div>
            </div>
          )}
          {chordPopover.showShapes && chordPopover.alternatives.length > 0 ? (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", marginBottom: 6 }}>
                Alternative shapes in this song
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {chordPopover.alternatives.map((alt, i) => {
                  const active = Boolean(
                    locatedMeasures
                    && locatedMeasures.length === alt.measures.length
                    && locatedMeasures.every((measure, index) => measure === alt.measures[index]),
                  );
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (active) {
                          clearLocatedMeasures();
                          return;
                        }
                        if (!locatedMeasures) {
                          previousHighlightsRef.current = [...(highlightedMeasures ?? [])];
                        }
                        setLocatedMeasures([...alt.measures]);
                        onHighlightMeasures?.(alt.measures);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "7px 8px",
                        borderRadius: 6,
                        background: active ? "var(--ss-accent-soft)" : "var(--ss-controls-btn, transparent)",
                        border: active ? "1px solid var(--ss-accent)" : "1px solid var(--ss-panel-border)",
                        boxShadow: active ? "inset 3px 0 0 var(--ss-accent)" : "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <MiniFretboard positions={alt.shape.positions} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#ca8a04" }}>{alt.shape.label}</div>
                        <div style={{ fontSize: 10, color: "var(--ss-text-muted)" }}>
                          {active ? "Clear location" : "Click to locate"} · M{alt.measures.slice(0, 5).join(", ")}{alt.measures.length > 5 ? "…" : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : chordPopover.showShapes ? (
            <p style={{ margin: 0, fontSize: 11, color: "var(--ss-text-muted)" }}>
              No alternate voicings of {chordPopover.chord} found elsewhere in this song.
            </p>
          ) : null}
          {onOpenTheoryTab && (
            <button
              type="button"
              onClick={onOpenTheoryTab}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "7px 9px",
                borderRadius: 5,
                border: "1px solid rgba(155,143,215,0.42)",
                background: "rgba(155,143,215,0.11)",
                color: "#b4a9ef",
                fontSize: 10,
                fontWeight: 750,
                cursor: "pointer",
              }}
            >
              Go to Theory tab for the full explanation →
            </button>
          )}
        </div>
      )}

      {/* ── Improv scale popup (click improv label) ── */}
      {improvPopover && (() => {
        const frets = computeScaleFrets(theoryKey, theoryMode, improvPopover.chord);
        return (
          <div
            style={{
              position: "sticky", bottom: 12, left: "50%", transform: "translateX(-50%)",
              zIndex: 60, width: "min(340px, 92vw)",
              background: "var(--ss-controls-surface, #2a2a2e)",
              border: "1px solid rgba(155,143,215,0.5)", borderRadius: 10,
              padding: "12px 14px", boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#9b8fd7" }}>
                Improv · M{improvPopover.measure}
              </span>
              <button type="button" onClick={() => setImprovPopover(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--ss-text-muted)", fontSize: 16 }}
                aria-label="Dismiss">×</button>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--ss-text-muted)", lineHeight: 1.4 }}>
              Over <strong style={{ color: "#ca8a04" }}>{improvPopover.chord}</strong> — {improvPopover.scaleLabel}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <MiniFretboard
                positions={frets}
                width={120}
                height={72}
                accent="#ca8a04"
                dimAccent="rgba(155,143,215,0.7)"
              />
              <div style={{ fontSize: 10, color: "var(--ss-text-muted)", lineHeight: 1.5 }}>
                <div><span style={{ color: "#ca8a04", fontWeight: 700 }}>●</span> Chord tones</div>
                <div><span style={{ color: "#9b8fd7", fontWeight: 700 }}>●</span> Scale tones</div>
                <div style={{ marginTop: 4 }}>Tap frets in this box over the chord.</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onHighlightMeasures?.([improvPopover.measure]);
                setImprovPopover(null);
              }}
              style={{
                width: "100%", fontSize: 11, fontWeight: 600, padding: "6px 8px", borderRadius: 5,
                border: "1px solid rgba(155,143,215,0.4)", background: "rgba(155,143,215,0.12)",
                color: "#9b8fd7", cursor: "pointer",
              }}
            >
              Highlight measure {improvPopover.measure}
            </button>
          </div>
        );
      })()}

      {/* ── Drag-select action popup ── */}
      {dragMenu && (
        <div
          style={{
            position: "fixed",
            left: dragMenu.x + 8,
            top: dragMenu.y + 8,
            zIndex: 80,
            minWidth: 160,
            background: "var(--ss-controls-surface, #2a2a2e)",
            border: "1px solid var(--ss-panel-border)",
            borderRadius: 8,
            boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
            padding: "6px",
          }}
          // Close on outside click
          onMouseDown={e => e.stopPropagation()}
        >
          {dragMenuStep === null ? (
            <>
              <p style={{ margin: "0 0 6px 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)" }}>
                M{dragMenu.startMeasure}–{dragMenu.endMeasure}
              </p>
              <button
                type="button"
                onClick={() => {
                  onLoopRangeChange?.(dragMenu.startMeasure, dragMenu.endMeasure);
                  setDragMenu(null);
                  setDragMenuStep(null);
                }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "7px 10px", borderRadius: 5, border: "none",
                  background: "transparent", color: "var(--ss-text)", fontSize: 13,
                  fontWeight: 600, cursor: "pointer",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--ss-controls-btn)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                Loop
              </button>
              {onAddLetRing && (
                <button
                  type="button"
                  onClick={() => setDragMenuStep("letRingChoice")}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 10px", borderRadius: 5, border: "none",
                    background: "transparent", color: "var(--ss-text)", fontSize: 13,
                    fontWeight: 600, cursor: "pointer",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--ss-controls-btn)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  Add let ring
                </button>
              )}
              <button
                type="button"
                onClick={() => { setDragMenu(null); setDragMenuStep(null); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "5px 10px", borderRadius: 5, border: "none",
                  background: "transparent", color: "var(--ss-text-muted)", fontSize: 11,
                  cursor: "pointer", marginTop: 2,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--ss-controls-btn)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 6px 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "#38bdf8" }}>
                Add let ring · M{dragMenu.startMeasure}–{dragMenu.endMeasure}
              </p>
              <button
                type="button"
                onClick={() => {
                  onAddLetRing?.(dragMenu.startMeasure, dragMenu.endMeasure, "all");
                  setDragMenu(null);
                  setDragMenuStep(null);
                }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "7px 10px", borderRadius: 5, border: "none",
                  background: "transparent", color: "var(--ss-text)", fontSize: 13,
                  fontWeight: 600, cursor: "pointer",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--ss-controls-btn)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                Whole measure
              </button>
              <button
                type="button"
                onClick={() => {
                  onAddLetRing?.(dragMenu.startMeasure, dragMenu.endMeasure, "pick");
                  setDragMenu(null);
                  setDragMenuStep(null);
                }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "7px 10px", borderRadius: 5, border: "none",
                  background: "transparent", color: "var(--ss-text)", fontSize: 13,
                  fontWeight: 600, cursor: "pointer",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--ss-controls-btn)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                Pick notes
              </button>
              <button
                type="button"
                onClick={() => setDragMenuStep(null)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "5px 10px", borderRadius: 5, border: "none",
                  background: "transparent", color: "var(--ss-text-muted)", fontSize: 11,
                  cursor: "pointer", marginTop: 2,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--ss-controls-btn)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                ← Back
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Let-ring pick-mode banner ── */}
      {letRingPickRange && (
        <div style={{
          position: "sticky", bottom: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 70, width: "fit-content", maxWidth: "92vw", whiteSpace: "nowrap",
          background: "var(--ss-controls-surface, #2a2a2e)",
          border: "1px solid rgba(56,189,248,0.5)",
          borderRadius: 8, padding: "10px 14px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 12, color: "#38bdf8", fontWeight: 700, flexShrink: 0 }}>Let ring</span>
          <span style={{ fontSize: 11, color: "var(--ss-text-muted)", flex: 1, lineHeight: 1.4 }}>
            Click notes in M{letRingPickRange.start}–{letRingPickRange.end} to toggle. Cyan = let ring on.
          </span>
          <button
            type="button"
            onClick={() => onLetRingPickDone?.()}
            style={{
              padding: "4px 12px", borderRadius: 4, border: "none",
              background: "rgba(56,189,248,0.18)", color: "#38bdf8",
              fontWeight: 700, fontSize: 11, cursor: "pointer", flexShrink: 0,
            }}
          >
            Done · Esc
          </button>
        </div>
      )}
    </div>
  );
}
