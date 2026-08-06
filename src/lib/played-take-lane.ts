/**
 * Maps coach transcription output onto the expected tab timeline for the
 * played-take comparison staff (full 6-string mini tab per row).
 */

import type { TabNote } from "@/types/music";
import { msPerBeat } from "@/lib/practice-timeline";

const OPEN_MIDI: Record<number, number> = {
  1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40,
};

export interface TranscribedTakeNote {
  id?: string;
  measure?: number;
  beat?: number;
  string: number;
  fret: number;
  durationBeats?: number;
  onsetMs?: number;
  confidence?: number;
}

export interface PlayedTakeNote extends TabNote {
  confidence: number;
  isGhost: boolean;
  uncertain: boolean;
}

function tabNoteMidi(note: Pick<TabNote, "string" | "fret">): number {
  return (OPEN_MIDI[note.string] ?? 64) + note.fret;
}

function onsetToMeasureBeat(
  onsetMs: number,
  phraseStartBeat: number,
  bpm: number,
  beatsPerMeasure: number,
): { measure: number; beat: number } {
  const absBeat = phraseStartBeat + onsetMs / msPerBeat(bpm);
  const measure = Math.floor(absBeat / beatsPerMeasure) + 1;
  const beat = (absBeat % beatsPerMeasure) + 1;
  return { measure, beat: Math.round(beat * 4) / 4 };
}

function isGhostNote(
  note: Pick<TabNote, "string" | "fret" | "measure" | "beat">,
  expectedNotes: TabNote[],
  bpm: number,
  beatsPerMeasure: number,
): boolean {
  const windowMs = msPerBeat(bpm) * 0.55;
  const noteMs = ((note.measure - 1) * beatsPerMeasure + (note.beat - 1)) * msPerBeat(bpm);
  const midi = tabNoteMidi(note);
  for (const expected of expectedNotes) {
    const expectedMs = ((expected.measure - 1) * beatsPerMeasure + (expected.beat - 1)) * msPerBeat(bpm);
    if (Math.abs(expectedMs - noteMs) > windowMs) continue;
    if (Math.abs(tabNoteMidi(expected) - midi) <= 1) return false;
  }
  return true;
}

/**
 * Place transcribed tab notes on the song timeline using restored onset times.
 * Falls back to backend measure/beat when onsetMs is missing.
 */
export function mapTranscribedTakeToTab(
  transcribed: TranscribedTakeNote[],
  expectedNotes: TabNote[],
  params: {
    bpm: number;
    beatsPerMeasure: number;
    phraseStartBeat: number;
    hideGhosts?: boolean;
  },
): PlayedTakeNote[] {
  const { bpm, beatsPerMeasure, phraseStartBeat, hideGhosts = true } = params;
  const notes: PlayedTakeNote[] = [];

  for (let i = 0; i < transcribed.length; i++) {
    const raw = transcribed[i];
    const timing = raw.onsetMs != null
      ? onsetToMeasureBeat(raw.onsetMs, phraseStartBeat, bpm, beatsPerMeasure)
      : { measure: raw.measure ?? 1, beat: raw.beat ?? 1 };

    const note: PlayedTakeNote = {
      id: raw.id ?? `played-${i}`,
      measure: timing.measure,
      beat: timing.beat,
      string: raw.string,
      fret: raw.fret,
      durationBeats: raw.durationBeats ?? 0.5,
      confidence: raw.confidence ?? 0.5,
      isGhost: false,
      uncertain: false,
    };

    note.isGhost = isGhostNote(note, expectedNotes, bpm, beatsPerMeasure);
    note.uncertain = note.confidence < 0.4 || note.isGhost;
    if (hideGhosts && note.isGhost) continue;
    notes.push(note);
  }

  return notes;
}
