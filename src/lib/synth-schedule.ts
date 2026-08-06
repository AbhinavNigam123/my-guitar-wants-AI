import type { TabNote } from "@/types/music";

export function noteAbsBeat(note: TabNote, beatsPerMeasure: number): number {
  return (note.measure - 1) * beatsPerMeasure + (note.beat - 1);
}

function naturalDurationSec(note: TabNote, secPerBeat: number): number {
  const written = note.durationBeats * secPerBeat;
  if (note.letRing) return Math.max(written, 3.0);
  return Math.max(written, 0.35) + 0.75;
}

/** Resolve synth sustain without allowing two attacks on one physical string to overlap. */
export function playableDurationSec(
  note: TabNote,
  notes: TabNote[],
  beatsPerMeasure: number,
  secPerBeat: number,
): number {
  const noteBeat = noteAbsBeat(note, beatsPerMeasure);
  const nextSameStringBeat = notes
    .filter((candidate) =>
      candidate.string === note.string
      && noteAbsBeat(candidate, beatsPerMeasure) > noteBeat + 0.001,
    )
    .reduce(
      (next, candidate) => Math.min(next, noteAbsBeat(candidate, beatsPerMeasure)),
      Number.POSITIVE_INFINITY,
    );
  const naturalDuration = naturalDurationSec(note, secPerBeat);
  if (!Number.isFinite(nextSameStringBeat)) return naturalDuration;
  return Math.max(0.06, Math.min(naturalDuration, (nextSameStringBeat - noteBeat) * secPerBeat));
}
