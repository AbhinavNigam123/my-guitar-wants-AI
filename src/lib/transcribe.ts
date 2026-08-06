import type { TabNote } from "@/types/music";

const API_BASE =
  process.env.NEXT_PUBLIC_TRANSCRIBE_API ?? "http://localhost:8000";

export interface TranscribedNote extends TabNote {
  midi: number;
  onsetMs: number;
  confidence: number;
}

export interface TranscriptionResult {
  bpm: number;
  beatsPerMeasure?: number;
  detectedBpm?: number;
  bpmConfidence?: number;
  bpmCandidates?: number[];
  bpmDetection?: {
    bpm: number | null;
    confidence: number;
    beatCount: number;
    durationMs: number;
    candidates?: number[];
    reason?: string | null;
  };
  noteCount: number;
  tabNotes: TranscribedNote[];
  rawEvents: {
    onsetMs: number;
    endMs: number;
    midi: number;
    amplitude: number;
  }[];
  totalMeasures?: number;
  durationMs?: number;
  settings?: {
    onsetThreshold: number;
    frameThreshold: number;
    minNoteLenMs: number;
    minAmplitudeRatio: number;
    audioPreprocess?: {
      enabled: boolean;
      reason?: string;
      sampleRate?: number;
      trimmedMs?: number;
      trimStartMs?: number;
      gain?: number;
      peakBefore?: number;
      rmsBefore?: number;
      peakAfter?: number;
      rmsAfter?: number;
    };
    chordWindowMs: number;
    collapsedEvents?: number;
    artifactClusters?: number;
    dominantSingleClusters?: number;
    simplifiedChordClusters?: number;
    removedChordEvents?: number;
    dominantTabSingleClusters?: number;
    removedTabNotes?: number;
    simplifiedTabClusters?: number;
    beatsPerMeasure?: number;
    coachPreset?: boolean;
    coachPresetName?: string;
    qualityMode?: "fast" | "accurate";
    inferencePasses?: number;
    primaryEventCount?: number;
    sensitiveEventCount?: number;
    rescuedEventCount?: number;
    transcriptionRuntimeMs?: number;
    layoutMidiOmissions?: number;
    omittedUnrenderableEvents?: number;
  };
}

export interface ExpectedNotePayload {
  onsetMs?: number;
  measure?: number;
  beat?: number;
  midi?: number;
  string?: number;
  fret?: number;
  confidence?: number;
}

export interface TranscribeOptions {
  detectBpm?: boolean;
  beatsPerMeasure?: number;
  onsetThreshold?: number;
  frameThreshold?: number;
  minNoteLenMs?: number;
  minAmplitudeRatio?: number;
  coachPreset?: boolean;
  qualityMode?: "fast" | "accurate";
  /** Known-tab prior for coach/practice takes (sent as expected_notes JSON). */
  expectedNotes?: ExpectedNotePayload[];
}

/**
 * Decode an arbitrary audio Blob (e.g. MediaRecorder WebM/Opus) and re-encode
 * it as a 16-bit mono PCM WAV. This sidesteps the need for ffmpeg on the
 * backend — basic-pitch / soundfile read WAV natively.
 */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return encodeWavMono(audioBuffer);
  } finally {
    ctx.close();
  }
}

function encodeWavMono(audioBuffer: AudioBuffer): Blob {
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;

  // Downmix to mono — normalization is intentionally omitted here.
  // The backend's preprocess_audio_for_basic_pitch() applies a single,
  // controlled normalization pass (gain-cap 8×, peak target 0.96, RMS target
  // 0.12). Normalizing here too would create a double-amplification path
  // that could boost quiet recordings by up to 64× total.
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/** Group raw onset events within a 70ms window into "chord events". */
function clusterOnsets(rawEvents: TranscriptionResult["rawEvents"], windowMs = 70): { onsetMs: number; count: number }[] {
  if (!rawEvents.length) return [];
  const sorted = [...rawEvents].sort((a, b) => a.onsetMs - b.onsetMs);
  const clusters: { onsetMs: number; count: number }[] = [];
  let clusterStart = sorted[0].onsetMs;
  let members: number[] = [sorted[0].onsetMs];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].onsetMs - clusterStart <= windowMs) {
      members.push(sorted[i].onsetMs);
    } else {
      clusters.push({
        onsetMs: Math.round(members.reduce((a, b) => a + b, 0) / members.length),
        count: members.length,
      });
      clusterStart = sorted[i].onsetMs;
      members = [sorted[i].onsetMs];
    }
  }
  clusters.push({
    onsetMs: Math.round(members.reduce((a, b) => a + b, 0) / members.length),
    count: members.length,
  });
  return clusters;
}

/**
 * Merge rhythm-pass timing onto pass-1 notes.
 *
 * - Only notes in `selectedMeasures` are re-timed.
 * - Notes outside selectedMeasures keep pass-1 timing unchanged.
 * - Rhythm onsets are zipped by order onto pass-1 chord groups in the
 *   selected measures. Polyphony is validated per pair.
 * - Returns updated notes and an optional error string.
 */
export function mergeRhythm(
  pass1Notes: TabNote[],
  rhythmResult: TranscriptionResult,
  selectedMeasures: number[],
  bpm: number,
  beatsPerMeasure = 4,
): { notes: TabNote[]; error?: string } {
  if (!selectedMeasures.length) return { notes: pass1Notes };

  const selSet = new Set(selectedMeasures);
  const secPerBeat = 60 / bpm;

  // Group pass-1 notes in selected measures into chord events (same measure+beat)
  type ChordEvent = { key: string; notes: TabNote[]; absBeat: number };
  const chordMap = new Map<string, ChordEvent>();
  for (const n of pass1Notes) {
    if (!selSet.has(n.measure)) continue;
    const key = `${n.measure}:${n.beat}`;
    if (!chordMap.has(key)) {
      chordMap.set(key, {
        key,
        notes: [],
        absBeat: (n.measure - 1) * beatsPerMeasure + (n.beat - 1),
      });
    }
    chordMap.get(key)!.notes.push(n);
  }
  const chordEvents = Array.from(chordMap.values()).sort((a, b) => a.absBeat - b.absBeat);

  // Cluster rhythm onsets
  const rhythmOnsets = clusterOnsets(rhythmResult.rawEvents);

  if (rhythmOnsets.length === 0) {
    return { notes: pass1Notes, error: "No notes detected in rhythm pass." };
  }
  if (rhythmOnsets.length < chordEvents.length) {
    return {
      notes: pass1Notes,
      error: `Rhythm pass detected ${rhythmOnsets.length} events but pass 1 has ${chordEvents.length} events in the selected measures. Play all notes/chords.`,
    };
  }

  // Validate polyphony and build re-timed notes
  const minSelectedMeasure = Math.min(...selectedMeasures);
  const baseAbsBeat = (minSelectedMeasure - 1) * beatsPerMeasure; // beat 0 of rhythm recording = beat 1 of first selected measure

  const updatedNotes = pass1Notes.map(n => ({ ...n }));

  for (let i = 0; i < chordEvents.length; i++) {
    const chord   = chordEvents[i];
    const rhythm  = rhythmOnsets[i];

    // Polyphony validation
    const pass1Count  = chord.notes.length;
    const rhythmCount = rhythm.count;
    if (pass1Count > 1 && rhythmCount === 1) {
      return {
        notes: pass1Notes,
        error: `Measure ${chord.notes[0].measure}, beat ${chord.notes[0].beat}: pass 1 has a chord (${pass1Count} notes) but rhythm pass played a single note. Strum all strings of the chord.`,
      };
    }

    // Compute new timing from rhythm onset
    const rhythmBeatOffset = (rhythm.onsetMs / 1000) / secPerBeat;
    const absNewBeat       = baseAbsBeat + rhythmBeatOffset;
    const newMeasure       = Math.floor(absNewBeat / beatsPerMeasure) + 1;
    const newBeat          = (absNewBeat % beatsPerMeasure) + 1;

    // Apply to the matching pass-1 notes
    for (const orig of chord.notes) {
      const idx = updatedNotes.findIndex(n => n.id === orig.id);
      if (idx !== -1) {
        updatedNotes[idx] = {
          ...updatedNotes[idx],
          measure: newMeasure,
          beat:    Math.round(newBeat * 4) / 4, // snap to 16th
        };
      }
    }
  }

  return { notes: updatedNotes };
}

/** Upload audio to the backend and get inferred tab back. */
export async function transcribeAudio(
  blob: Blob,
  bpm: number,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const wav = await blobToWav(blob);
  const form = new FormData();
  form.append("file", wav, "take.wav");
  form.append("bpm", String(Math.round(bpm)));
  form.append("detect_bpm", String(options.detectBpm ?? false));
  form.append("beats_per_measure", String(options.beatsPerMeasure ?? 4));
  form.append("coach_preset", String(options.coachPreset ?? false));
  form.append("quality_mode", options.qualityMode ?? "fast");
  if (options.onsetThreshold != null) {
    form.append("onset_threshold", String(options.onsetThreshold));
  }
  if (options.frameThreshold != null) {
    form.append("frame_threshold", String(options.frameThreshold));
  }
  if (options.minNoteLenMs != null) {
    form.append("min_note_len_ms", String(options.minNoteLenMs));
  }
  if (options.minAmplitudeRatio != null) {
    form.append("min_amplitude_ratio", String(options.minAmplitudeRatio));
  }
  if (options.expectedNotes != null && options.expectedNotes.length > 0) {
    form.append("expected_notes", JSON.stringify(options.expectedNotes));
  }

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail = `Transcription request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") {
        detail = body.detail;
      } else if (body?.detail?.message) {
        detail = body.detail.message;
      }
    } catch {
      /* ignore parse error */
    }
    throw new Error(detail);
  }

  return (await res.json()) as TranscriptionResult;
}
