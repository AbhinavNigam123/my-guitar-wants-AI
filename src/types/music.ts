export type NoteStatus =
  | "correct"
  | "early"
  | "late"
  | "missed"
  | "wrong_note"
  | "unplayed";

export interface TabNote {
  id: string;
  measure: number;
  beat: number;
  string: number; // 1 = high e, 6 = low E
  fret: number;
  durationBeats: number;
  status?: NoteStatus;
}

export interface NoteEvent {
  timestamp: number; // ms from recording start
  frequency: number; // Hz
  velocity: number; // 0–1
  string?: number;
  fret?: number;
}

export interface AlignmentResult {
  tabNoteId: string;
  status: NoteStatus;
  timingOffsetMs: number; // negative = early, positive = late
  detectedFrequency?: number;
  expectedFrequency?: number;
}

export interface PracticeFeedback {
  overallComment: string;
  tips: string[];
  alignments: AlignmentResult[];
  generatedAt: number; // unix ms
}

export interface PracticeMetrics {
  accuracyPercent: number;
  timingDriftMs: number; // avg absolute offset
  weakestMeasure: number;
  recommendedTempoBpm: number;
  currentTempoBpm: number;
}

export interface PracticeSession {
  id: string;
  songTitle: string;
  artist: string;
  phraseLabel: string;
  startMeasure: number;
  endMeasure: number;
  bpm: number;
  tabNotes: TabNote[];
  recordingBlob?: Blob;
  noteEvents?: NoteEvent[];
  feedback?: PracticeFeedback;
  metrics?: PracticeMetrics;
  createdAt: number;
}
