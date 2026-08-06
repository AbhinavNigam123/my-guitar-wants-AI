/**
 * practice-timeline.ts
 *
 * Single source of truth for coach / playback / transcription time alignment.
 *
 * Convention: performance time 0 ms = the first beat of the coached phrase
 * (session.startMeasure, beat 1) at the moment recording begins — after any
 * count-in, which is not captured in the MediaRecorder stream.
 *
 * Transcription onsets from the backend are relative to the *trimmed* WAV fed
 * to basic-pitch. When coach preprocessing trims leading silence, we restore
 * absolute recording time by adding trimStartMs back to detected onsets.
 */

import type { TabNote } from "@/types/music";

export interface AudioPreprocessStats {
  enabled?: boolean;
  trimStartMs?: number;
  trimmedMs?: number;
  sampleRate?: number;
}

export interface PracticeTimeline {
  /** Tempo used for beat↔ms conversion (must match count-in + cursor + coach). */
  bpm: number;
  beatsPerMeasure: number;
  /** Absolute beat index where the coached phrase begins (0 = song start). */
  phraseStartBeat: number;
  /**
   * Milliseconds removed from the start of the uploaded WAV before transcription.
   * Detected onsets are shifted earlier by this amount and must be restored.
   */
  trimStartMs: number;
}

export interface RawCoachEvent {
  onsetMs: number;
  endMs: number;
  midi: number;
  amplitude: number;
}

export function msPerBeat(bpm: number): number {
  return 60000 / Math.max(40, bpm);
}

/** Absolute beat position of a tab note from the start of the song. */
export function noteAbsoluteBeat(note: TabNote, beatsPerMeasure: number): number {
  return (note.measure - 1) * beatsPerMeasure + (note.beat - 1);
}

/**
 * Expected onset in performance-time ms (recording t=0 at phrase downbeat).
 * Matches the formula used by coach-analysis groupExpectedNotes.
 */
export function expectedOnsetMs(
  note: TabNote,
  timeline: Pick<PracticeTimeline, "bpm" | "beatsPerMeasure" | "phraseStartBeat">,
): number {
  const absBeat = noteAbsoluteBeat(note, timeline.beatsPerMeasure);
  const phraseRelativeBeat = absBeat - timeline.phraseStartBeat;
  return Math.round(phraseRelativeBeat * msPerBeat(timeline.bpm));
}

export function beatToMs(beat: number, bpm: number): number {
  return beat * msPerBeat(bpm);
}

export function msToBeat(ms: number, bpm: number): number {
  return ms / msPerBeat(bpm);
}

/** Recording elapsed ms → absolute beat for the green cursor during coach capture. */
export function recordingElapsedToBeat(
  elapsedMs: number,
  timeline: Pick<PracticeTimeline, "bpm" | "phraseStartBeat">,
): number {
  return timeline.phraseStartBeat + msToBeat(elapsedMs, timeline.bpm);
}

export function buildPracticeTimeline(params: {
  bpm: number;
  beatsPerMeasure: number;
  startMeasure: number;
  audioPreprocess?: AudioPreprocessStats | null;
}): PracticeTimeline {
  const trimStartMs = Math.max(0, Math.round(params.audioPreprocess?.trimStartMs ?? 0));
  return {
    bpm: params.bpm,
    beatsPerMeasure: params.beatsPerMeasure,
    phraseStartBeat: (params.startMeasure - 1) * params.beatsPerMeasure,
    trimStartMs,
  };
}

/**
 * Restore detected onsets to the same recording-time origin as expectedOnsetMs.
 */
export function restoreDetectedOnsets(
  events: RawCoachEvent[],
  timeline: Pick<PracticeTimeline, "trimStartMs">,
): RawCoachEvent[] {
  const shift = timeline.trimStartMs;
  if (shift <= 0) return events;
  return events.map(e => ({
    ...e,
    onsetMs: e.onsetMs + shift,
    endMs: e.endMs + shift,
  }));
}

/** Generate synthetic events aligned exactly to the practice timeline (harness / calibration). */
export function synthesizePerfectPerformanceEvents(
  notes: TabNote[],
  timeline: PracticeTimeline,
): RawCoachEvent[] {
  const OPEN: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
  const byBeat = new Map<string, TabNote[]>();
  for (const note of notes) {
    const key = `${note.measure}:${note.beat}`;
    const group = byBeat.get(key) ?? [];
    group.push(note);
    byBeat.set(key, group);
  }

  const events: RawCoachEvent[] = [];
  for (const group of byBeat.values()) {
    const onsetMs = expectedOnsetMs(group[0], timeline);
    for (const note of group) {
      events.push({
        onsetMs,
        endMs: onsetMs + Math.round(note.durationBeats * msPerBeat(timeline.bpm)),
        midi: (OPEN[note.string] ?? 64) + note.fret,
        amplitude: 0.85,
      });
    }
  }
  return events.sort((a, b) => a.onsetMs - b.onsetMs);
}

export interface TimingDiagnostic {
  noteId: string;
  measure: number;
  beat: number;
  expectedMs: number;
  detectedMs: number | null;
  offsetMs: number | null;
}

/** Log-friendly breakdown when sync harness fails. */
export function buildTimingDiagnostics(
  notes: TabNote[],
  detected: RawCoachEvent[],
  timeline: PracticeTimeline,
  alignments: { tabNoteId: string; timingOffsetMs: number; status: string }[],
): TimingDiagnostic[] {
  const restored = restoreDetectedOnsets(detected, timeline);
  const alignmentByNote = new Map(alignments.map(a => [a.tabNoteId, a]));

  return notes.map(note => {
    const expected = expectedOnsetMs(note, timeline);
    const alignment = alignmentByNote.get(note.id);
    const nearest = restored.reduce<{ d: RawCoachEvent | null; dist: number }>(
      (best, e) => {
        const dist = Math.abs(e.onsetMs - expected);
        return dist < best.dist ? { d: e, dist } : best;
      },
      { d: null, dist: Infinity },
    );
    return {
      noteId: note.id,
      measure: note.measure,
      beat: note.beat,
      expectedMs: expected,
      detectedMs: nearest.d?.onsetMs ?? null,
      offsetMs: alignment?.timingOffsetMs ?? null,
    };
  });
}
