export type NoteStatus =
  | "correct"
  | "early"
  | "late"
  | "missed"
  | "wrong_note"
  | "unplayed";

export type Technique = "bend" | "slide" | "hammer" | "pull" | "vibrato";

export interface TabNote {
  id: string;
  measure: number;
  beat: number;
  string: number; // 1 = high e, 6 = low E
  fret: number;
  durationBeats: number;
  status?: NoteStatus;
  technique?: Technique;
  bendSemitones?: number;
  /** Note keeps resonating through playback (editor). */
  letRing?: boolean;
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
  confidence?: "high" | "medium" | "low";
}

export type CoachConfidence = "high" | "medium" | "low";
export type PracticeFocus = "notes" | "timing" | "transitions" | "full";

export interface MeasureCoachResult {
  measure: number;
  /** Existing note-alignment score, expressed as 0-100. */
  accuracyPercent: number;
  /** Expected pitches supported by detected pitch evidence, expressed as 0-100. */
  pitchCoveragePercent: number;
  timingDriftMs: number;
  confidence: CoachConfidence;
  scoredNoteCount: number;
}

export interface CoachFinding {
  type:
    | "missed"
    | "wrong_pitch"
    | "early"
    | "late"
    | "extra"
    | "weak_measure"
    | "detector_quality";
  measure: number;
  beat?: number;
  severity: "high" | "medium" | "low";
  message: string;
  /** Optional theory context when the finding lands on a chord change. */
  theoryHint?: { chord: string; measure: number };
}

export interface CoachIssueCluster {
  id: string;
  type: "timing" | "pitch_coverage" | "transition" | "detector_quality";
  title: string;
  summary: string;
  measures: number[];
  severity: "high" | "medium" | "low";
  evidenceCount: number;
}

export interface CoachQuestion {
  id: string;
  question: string;
  answer: string;
}

export interface PracticeAction {
  label: string;
  detail: string;
  measure?: number;
  endMeasure?: number;
  targetBpm?: number;
  /** Primary focus of this drill step. */
  focus?: PracticeFocus | "pitch";
  availableActions?: Array<"reference" | "take" | "compare" | "loop" | "slow" | "record">;
}

export interface PracticeFeedback {
  overallComment: string;
  tips: string[];
  alignments: AlignmentResult[];
  findings?: CoachFinding[];
  practiceActions?: PracticeAction[];
  issueClusters?: CoachIssueCluster[];
  coachQuestions?: CoachQuestion[];
  generatedAt: number; // unix ms
}

export interface PracticeMetrics {
  accuracyPercent: number;
  timingDriftMs: number; // avg absolute offset
  /** Constant recording/device delay removed before final Coach alignment. */
  inputLatencyCorrectionMs?: number;
  /** Exact-pitch attacks eligible for, or supporting, timing calibration. */
  timingCalibrationSampleCount?: number;
  weakestMeasure: number;
  recommendedTempoBpm: number;
  currentTempoBpm: number;
  pitchCoveragePercent?: number;
  measureResults?: MeasureCoachResult[];
}

export type MeasureMasteryLevel =
  | "unpracticed"
  | "learning"
  | "improving"
  | "reliable"
  | "mastered";

export interface MeasureMastery {
  measure: number;
  level: MeasureMasteryLevel;
  recentTakeCount: number;
  accuracyPercent: number;
  pitchCoveragePercent?: number;
  timingDriftMs?: number;
  dominantIssue?: "notes" | "timing" | "mixed";
}

export interface SongMetrics {
  songTitle: string;
  artist: string;
  sessionsPlayed: number;
  bestAccuracy: number;
  avgAccuracy: number;
  totalPracticeMinutes: number;
  lastPracticed: string;
  measureAccuracy: { measure: number; accuracy: number }[];
  measureMastery?: MeasureMastery[];
  recentTakes: { id?: string; date: string; accuracy: number; tempo: number }[];
}

export interface PracticeSession {
  id: string;
  songTitle: string;
  artist: string;
  phraseLabel: string;
  startMeasure: number;
  endMeasure: number;
  bpm: number;
  /** Time signature numerator. Denominator is currently quarter-note based. */
  beatsPerMeasure?: number;
  tabNotes: TabNote[];
  recordingBlob?: Blob;
  noteEvents?: NoteEvent[];
  feedback?: PracticeFeedback;
  metrics?: PracticeMetrics;
  createdAt: number;
}
