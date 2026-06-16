import type {
  PracticeSession,
  TabNote,
  AlignmentResult,
  PracticeFeedback,
  PracticeMetrics,
} from "@/types/music";

// Smoke on the Water - main riff (simplified for demo)
const TAB_NOTES: TabNote[] = [
  // Measure 1
  { id: "n1",  measure: 1, beat: 1,   string: 4, fret: 0,  durationBeats: 1 },
  { id: "n2",  measure: 1, beat: 2,   string: 4, fret: 3,  durationBeats: 1 },
  { id: "n3",  measure: 1, beat: 3,   string: 4, fret: 5,  durationBeats: 1.5 },
  { id: "n4",  measure: 1, beat: 4.5, string: 4, fret: 0,  durationBeats: 0.5 },
  // Measure 2
  { id: "n5",  measure: 2, beat: 1,   string: 4, fret: 3,  durationBeats: 1 },
  { id: "n6",  measure: 2, beat: 2,   string: 4, fret: 6,  durationBeats: 1 },
  { id: "n7",  measure: 2, beat: 3,   string: 4, fret: 5,  durationBeats: 2 },
  // Measure 3
  { id: "n8",  measure: 3, beat: 1,   string: 4, fret: 0,  durationBeats: 1 },
  { id: "n9",  measure: 3, beat: 2,   string: 4, fret: 3,  durationBeats: 1 },
  { id: "n10", measure: 3, beat: 3,   string: 4, fret: 5,  durationBeats: 1 },
  { id: "n11", measure: 3, beat: 4,   string: 4, fret: 3,  durationBeats: 0.5 },
  { id: "n12", measure: 3, beat: 4.5, string: 3, fret: 5,  durationBeats: 0.5 },
  // Measure 4
  { id: "n13", measure: 4, beat: 1,   string: 4, fret: 0,  durationBeats: 2 },
  { id: "n14", measure: 4, beat: 3,   string: 5, fret: 3,  durationBeats: 1 },
  { id: "n15", measure: 4, beat: 4,   string: 5, fret: 5,  durationBeats: 1 },
];

const MOCK_ALIGNMENTS: AlignmentResult[] = [
  { tabNoteId: "n1",  status: "correct",    timingOffsetMs: 12   },
  { tabNoteId: "n2",  status: "correct",    timingOffsetMs: -8   },
  { tabNoteId: "n3",  status: "early",      timingOffsetMs: -95  },
  { tabNoteId: "n4",  status: "correct",    timingOffsetMs: 20   },
  { tabNoteId: "n5",  status: "late",       timingOffsetMs: 140  },
  { tabNoteId: "n6",  status: "correct",    timingOffsetMs: 15   },
  { tabNoteId: "n7",  status: "wrong_note", timingOffsetMs: 30,  detectedFrequency: 196, expectedFrequency: 207.65 },
  { tabNoteId: "n8",  status: "correct",    timingOffsetMs: -5   },
  { tabNoteId: "n9",  status: "correct",    timingOffsetMs: 18   },
  { tabNoteId: "n10", status: "missed",     timingOffsetMs: 0    },
  { tabNoteId: "n11", status: "late",       timingOffsetMs: 180  },
  { tabNoteId: "n12", status: "correct",    timingOffsetMs: 22   },
  { tabNoteId: "n13", status: "correct",    timingOffsetMs: -10  },
  { tabNoteId: "n14", status: "early",      timingOffsetMs: -110 },
  { tabNoteId: "n15", status: "correct",    timingOffsetMs: 8    },
];

export const MOCK_FEEDBACK: PracticeFeedback = {
  overallComment:
    "Solid attempt on the main riff! Your timing is mostly locked in on measures 1 and 4. Watch out for the transition into measure 2 — you're consistently arriving late on beat 1. The wrong note on n7 suggests you may be accidentally landing on fret 4 instead of fret 5.",
  tips: [
    "Practice the measure 2 entry in isolation with a metronome at 60 BPM.",
    "On the wrong note (measure 2, beat 3), try anchoring your ring finger on fret 5 before the phrase begins.",
    "Measure 3 beat 3 was missed — slow down and ensure you're lifting fingers cleanly.",
    "Your overall feel is great; just tighten up the two late entries and you'll nail it.",
  ],
  alignments: MOCK_ALIGNMENTS,
  generatedAt: Date.now(),
};

export const MOCK_METRICS: PracticeMetrics = {
  accuracyPercent: 73,
  timingDriftMs: 62,
  weakestMeasure: 2,
  recommendedTempoBpm: 60,
  currentTempoBpm: 112,
};

export function buildMockSession(): PracticeSession {
  const alignmentMap = new Map(
    MOCK_ALIGNMENTS.map((a) => [a.tabNoteId, a])
  );

  const annotatedNotes: TabNote[] = TAB_NOTES.map((note) => ({
    ...note,
    status: alignmentMap.get(note.id)?.status ?? "unplayed",
  }));

  return {
    id: "session-demo-1",
    songTitle: "Smoke on the Water",
    artist: "Deep Purple",
    phraseLabel: "Intro Riff — Phrase A",
    startMeasure: 1,
    endMeasure: 4,
    bpm: 112,
    tabNotes: annotatedNotes,
    feedback: MOCK_FEEDBACK,
    metrics: MOCK_METRICS,
    createdAt: Date.now(),
  };
}
