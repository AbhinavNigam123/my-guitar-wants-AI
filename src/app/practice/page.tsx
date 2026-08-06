"use client";

// Exact Songsterr colors from live CDP inspection:
// Body bg:       rgb(28,29,31)  = #1c1d1f
// Nav bg:        rgb(32,32,34)  = #202022
// Player bar bg: rgb(42,42,46)  = #2a2a2e
// Song title:    Georgia, 45px, weight 300, #d6d6d6, line-height 45px
// Artist:        songsterr font (sans), 18px, weight 700, white
// Accent green:  rgb(35,140,53) = #238c35

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, X, Search } from "lucide-react";
import Header from "@/components/layout/Header";
import TabViewer, { NOTE_STYLE, LEGEND_ITEMS } from "@/components/practice/TabViewer";
import PlayerControls from "@/components/practice/PlayerControls";
import StudioDashboard, { type TranscribeTuning } from "@/components/practice/StudioDashboard";
import { analyzePracticeTake } from "@/lib/coach-analysis";
import {
  buildPracticeTimeline,
  recordingElapsedToBeat,
  restoreDetectedOnsets,
} from "@/lib/practice-timeline";
import { buildStairwaySession, STAIRWAY_SONG_METRICS } from "@/lib/stairway-tab-data";
import { transcribeAudio, mergeRhythm } from "@/lib/transcribe";
import {
  detectTempoFlagInfos,
  regridRange,
  detectChordFlags,
  fillMeasureFromShape,
  type TempoFlagInfo,
} from "@/lib/tempo-flags";
import {
  saveSession,
  saveRecording,
  getRecording,
  deleteSession,
  computeSongMetrics,
  type SavedSession,
} from "@/lib/practice-store";
import { usePlayback } from "@/hooks/usePlayback";
import {
  analyzeSongTheory,
  DEFAULT_THEORY_TOGGLES,
  getMeasureTheoryContext,
  type TheoryOverlayToggles,
} from "@/lib/theory-analysis";
import { mapTranscribedTakeToTab, type TranscribedTakeNote } from "@/lib/played-take-lane";
import type {
  PracticeAction,
  PracticeMetrics,
  PracticeSession,
  Technique,
  SongMetrics,
  TabNote,
} from "@/types/music";

function audioExtension(blob: Blob): string {
  if (blob.type.includes("wav")) return "wav";
  if (blob.type.includes("ogg")) return "ogg";
  if (blob.type.includes("mp4") || blob.type.includes("m4a")) return "m4a";
  return "webm";
}

function fixtureFilename(parts: {
  songTitle: string;
  startMeasure: number;
  endMeasure: number;
  bpm: number;
  speed: number;
  kind: "real-take" | "synth-reference";
  extension: string;
}): string {
  const song = parts.songTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "practice";
  return `${song}-m${parts.startMeasure}-${parts.endMeasure}-${Math.round(parts.bpm)}bpm-${Math.round(parts.speed)}pct-${parts.kind}.${parts.extension}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Hardcoded song list for search ──────────────────────────────────────
const SONGS = [
  { id: 1, title: "Smoke on the Water",       artist: "Deep Purple",     difficulty: 2, genre: "Rock"    },
  { id: 2, title: "Nothing Else Matters",     artist: "Metallica",       difficulty: 3, genre: "Metal"   },
  { id: 3, title: "Wonderwall",               artist: "Oasis",           difficulty: 1, genre: "Rock"    },
  { id: 4, title: "Stairway to Heaven",       artist: "Led Zeppelin",    difficulty: 4, genre: "Rock"    },
  { id: 5, title: "Hotel California",         artist: "Eagles",          difficulty: 3, genre: "Rock"    },
];

const BASE_SESSION = buildStairwaySession();
const CLEAN_SESSION: PracticeSession = {
  ...BASE_SESSION,
  beatsPerMeasure: BASE_SESSION.beatsPerMeasure ?? 4,
  tabNotes: BASE_SESSION.tabNotes.map(n => ({ ...n, status: undefined })),
  feedback: undefined,
  metrics: undefined,
};

/** Derive per-measure accuracy from annotated tab notes (correct / total). */
function deriveMeasureAccuracy(notes: TabNote[]): { measure: number; accuracy: number }[] {
  const map = new Map<number, { correct: number; total: number }>();
  for (const n of notes) {
    const entry = map.get(n.measure) ?? { correct: 0, total: 0 };
    entry.total++;
    if (n.status === "correct") entry.correct++;
    map.set(n.measure, entry);
  }
  return Array.from(map.entries())
    .map(([measure, { correct, total }]) => ({
      measure,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    }))
    .sort((a, b) => a.measure - b.measure);
}

// ── Search Modal ─────────────────────────────────────────────────────────
function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? SONGS.filter(s =>
        s.title.toLowerCase().includes(query.toLowerCase()) ||
        s.artist.toLowerCase().includes(query.toLowerCase())
      )
    : SONGS;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100]"
            style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            // --panel-surface-dark: #252529, --popup-shadow-dark
            className="fixed z-[101] top-20 left-1/2 -translate-x-1/2 w-full max-w-xl rounded-lg overflow-hidden"
            style={{ backgroundColor: "var(--ss-panel)", border: "1px solid var(--ss-panel-border)", boxShadow: "0 4px 35px 0 rgba(0,0,0,0.2)" }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--ss-popup-divider)", backgroundColor: "var(--ss-search-bg)" }}>
              <Search size={18} color="var(--ss-text-muted)" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search songs, artists…"
                className="flex-1 bg-transparent outline-none"
                style={{ color: "var(--ss-text)", fontSize: 16, fontWeight: 300 }}
              />
              <button onClick={onClose} className="hover:opacity-70 transition-opacity">
                <X size={18} color="var(--ss-text-muted)" />
              </button>
            </div>

            {/* Results */}
            <div className="py-2">
              {filtered.length === 0 && (
                <p className="px-4 py-6 text-center" style={{ color: "var(--ss-text-muted)", fontSize: 14 }}>
                  No results
                </p>
              )}
              {filtered.map(song => (
                <button
                  key={song.id}
                  onClick={onClose}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left transition-colors"
                  style={{ borderBottom: "1px solid var(--ss-popup-divider)", background: "transparent" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--ss-controls-btn)")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  {/* Difficulty dots — --difficulty-color-dark #525359, --difficulty-color-fill #007aff */}
                  <div className="flex gap-0.5 shrink-0">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: i < song.difficulty ? "#007aff" : "#525359" }}
                      />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ color: "var(--ss-text)", fontSize: 15, fontWeight: 400, fontFamily: "Georgia, serif" }}>
                      {song.title}
                    </p>
                    <p style={{ color: "var(--ss-text-muted)", fontSize: 13, fontWeight: 300, marginTop: 2 }}>
                      {song.artist}
                    </p>
                  </div>
                  <span style={{ color: "var(--ss-text-muted)", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                    {song.genre}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Tab display mode dropdown ────────────────────────────────────────────
function DisplayDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = ["Tab", "Guitar Pro", "Chords"];
  return (
    <div className="relative" style={{ width: "auto" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          borderRadius: 2,
          backgroundColor: "var(--ss-controls-btn)",
          border: "none",
          height: 32,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          padding: "0 30px 0 10px",
          position: "relative",
          minWidth: 72,
        }}
      >
        <span style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--ss-text-title)",
          whiteSpace: "nowrap",
          lineHeight: "20px",
        }}>
          {value}
        </span>
        <svg
          width="13" height="8" viewBox="0 0 13 8"
          style={{ position: "absolute", right: 9, top: 13, fill: "#238c35", transform: open ? "rotate(0)" : "rotate(180deg)" }}
        >
          <path d="M12.68 7.74a1 1 0 0 0 .06-1.42L7.38.5a1.95 1.95 0 0 0-.88-.4c-.24 0-.66.23-.88.4L.26 6.32a1 1 0 0 0 1.48 1.36l5.35-5.84c-.14.08-.46.26-.59.26-.13 0-.45-.18-.59-.26l5.35 5.84a1 1 0 0 0 1.42.06Z" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full mt-1 left-0 rounded-lg overflow-hidden z-20"
            style={{ backgroundColor: "var(--ss-panel)", border: "1px solid var(--ss-panel-border)", minWidth: 140 }}
          >
            {options.map(opt => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className="w-full text-left px-4 py-2.5 hover:opacity-70 transition-opacity flex items-center gap-2"
                style={{ color: "var(--ss-text)", fontSize: 14, fontWeight: 300, borderBottom: "1px solid var(--ss-popup-divider)" }}
              >
                {opt === value && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#238c35" stroke="none">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                )}
                {opt !== value && <div style={{ width: 12 }} />}
                {opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Header icon button (ZQQn2G_headerButtonWrapper: 32×32) ────────────────
function HeaderIconBtn({ onClick, active, children }: {
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  const iconColor = active ? "var(--ss-controls-surface)" : "var(--ss-topbar-item)";
  return (
    <div style={{ userSelect: "none", width: 32, height: 32, margin: 0, padding: 0, position: "relative" }}>
      <button
        onClick={onClick}
        style={{
          cursor: "pointer",
          appearance: "none",
          background: "transparent",
          border: "none",
          height: 32,
          width: 32,
          margin: 0,
          padding: 0,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: active ? "#e7e7e7" : "#75787c",
        }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ position: "absolute", inset: 0 }}>
          <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.3" fill={active ? "#238c35" : "transparent"} />
        </svg>
        <div style={{ position: "relative", zIndex: 1, color: iconColor, display: "flex" }}>{children}</div>
      </button>
    </div>
  );
}

// ── Editor toolbar button ───────────────────────────────────────────────
function EditorBtn({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 4,
        border: `1px solid ${active ? "#5376f0" : "rgba(255,255,255,0.15)"}`,
        background: active ? "rgba(83,118,240,0.35)" : "rgba(255,255,255,0.06)",
        color: disabled ? "#666" : active ? "#e8ecff" : "#c4c4c4",
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function PracticePage() {
  const [session, setSession]           = useState<PracticeSession>(CLEAN_SESSION);
  const [isAnalysing, setIsAnalysing]   = useState(false);
  const [hasRecorded, setHasRecorded]   = useState(false);
  const [liked, setLiked]               = useState(false);
  const [displayMode, setDisplayMode]   = useState("Tab");
  const [searchOpen, setSearchOpen]     = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [transcribeInfo, setTranscribeInfo]   = useState<string | null>(null);
  const [totalMeasures, setTotalMeasures]     = useState<number | undefined>(undefined);
  const [rhythmMerging, setRhythmMerging]     = useState(false);
  const [rhythmMergeError, setRhythmMergeError] = useState<string | null>(null);
  const [rhythmMergeInfo, setRhythmMergeInfo]   = useState<string | null>(null);
  const [editorMode, setEditorMode]             = useState(false);
  const [selectedNoteId, setSelectedNoteId]     = useState<string | null>(null);
  const [bpmCandidates, setBpmCandidates]         = useState<number[]>([]);
  const [beatsPerMeasure, setBeatsPerMeasure]     = useState(CLEAN_SESSION.beatsPerMeasure ?? 4);
  const [coachRecordingElapsedMs, setCoachRecordingElapsedMs] = useState<number | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [songMetrics, setSongMetrics] = useState<SongMetrics>(STAIRWAY_SONG_METRICS);
  const [showSaveAudioPrompt, setShowSaveAudioPrompt] = useState(false);
  const [hasDownloadableCoachTake, setHasDownloadableCoachTake] = useState(false);
  const [audioExportMessage, setAudioExportMessage] = useState<string | null>(null);
  const [audioExportError, setAudioExportError] = useState<string | null>(null);
  const [playbackBpm, setPlaybackBpm] = useState(CLEAN_SESSION.bpm);
  // Holds the last coach recording blob and its session id so the save-audio
  // prompt can persist audio on demand without re-running analysis.
  const lastCoachBlobRef = useRef<{ id: string; blob: Blob | null; durationMs: number } | null>(null);
  const lastCoachEventsRef = useRef<{ onsetMs: number; midi: number; amplitude: number }[]>([]);
  const [lastRawPlayedTake, setLastRawPlayedTake] = useState<TranscribedTakeNote[]>([]);
  const [theoryToggles, setTheoryToggles] = useState<TheoryOverlayToggles>(DEFAULT_THEORY_TOGGLES);
  const [tabToolbarCollapsed, setTabToolbarCollapsed] = useState(false);
  const [theoryMeasure, setTheoryMeasure] = useState<number | null>(null);
  const [theoryTabRequestKey, setTheoryTabRequestKey] = useState(0);
  const [showPlayedTakeLane, setShowPlayedTakeLane] = useState(false);
  const [hideGhostDetections, setHideGhostDetections] = useState(true);
  const [lastTranscribeSource, setLastTranscribeSource] = useState<{
    blob: Blob;
    durationMs: number;
    tuning?: TranscribeTuning;
  } | null>(null);
  // Active coach drill state
  const [activeDrill, setActiveDrill] = useState<PracticeAction | null>(null);
  const [preDrillBpm, setPreDrillBpm] = useState<number | null>(null);
  // Theory → tab highlight
  const [highlightedMeasures, setHighlightedMeasures] = useState<number[]>([]);
  // Generate Tab: tempo / chord correction flags
  const [tempoFlagInfos, setTempoFlagInfos] = useState<TempoFlagInfo[]>([]);
  const tempoFlags = useMemo(() => tempoFlagInfos.map(f => f.measure), [tempoFlagInfos]);
  const [tempoPrompt, setTempoPrompt] = useState<{
    measure: number; begin: number; end: number; suggestedBpm: number;
  } | null>(null);
  const [chordFlags, setChordFlags] = useState<number[]>([]);
  const [chordPrompt, setChordPrompt] = useState<{
    measure: number; chord: string; options: string[];
  } | null>(null);
  // Coach measure range — null means "all measures"
  const [coachMeasureRange, setCoachMeasureRange] = useState<{ start: number; end: number } | null>(null);
  // Heat-map: per-measure accuracy (0–1). Derived after coach analysis.
  const [measureScores, setMeasureScores] = useState<Record<number, number>>({});
  // Take-compare: metrics from the previous take for delta display.
  const [prevTakeMetrics, setPrevTakeMetrics] = useState<PracticeMetrics | null>(null);
  // Let-ring pick mode: when set, clicking notes in this range toggles letRing.
  const [letRingPickRange, setLetRingPickRange] = useState<{ start: number; end: number } | null>(null);
  // Tab lock: when true, the tab cannot be edited (let-ring, etc.). Default locked for pre-built tabs.
  const [tabLocked, setTabLocked] = useState(true);
  // Capture last recording duration before the elapsed ms state resets to null
  const lastRecordingDurationMsRef = useRef<number>(0);
  const editorPanelRef = useRef<HTMLDivElement>(null);

  const refreshSongMetrics = useCallback(() => {
    computeSongMetrics(session.songTitle, session.artist)
      .then(m => setSongMetrics(m))
      .catch(() => { /* IndexedDB unavailable in some environments */ });
  }, [session.songTitle, session.artist]);

  // Load real song metrics on mount
  useEffect(() => { refreshSongMetrics(); }, [refreshSongMetrics]);

  const theoryAnalysis = useMemo(
    () => analyzeSongTheory(session.tabNotes),
    [session.tabNotes],
  );

  // Detect sparse-chord measures that might benefit from fill-in (rare)
  const chordFlagInfos = useMemo(
    () => theoryAnalysis.measures.length > 0
      ? detectChordFlags(
          session.tabNotes,
          theoryAnalysis.measures,
          theoryAnalysis.recurringShapes,
          session.beatsPerMeasure ?? beatsPerMeasure,
        )
      : [],
    [theoryAnalysis, session.tabNotes, session.beatsPerMeasure, beatsPerMeasure],
  );

  useEffect(() => {
    // This mirrors derived chord suggestions into dismissible UI state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChordFlags(chordFlagInfos.map(f => f.measure));
  }, [chordFlagInfos]);
  const theoryContext = theoryMeasure != null
    ? getMeasureTheoryContext(theoryAnalysis, theoryMeasure)
    : null;

  const lastPlayedTakeNotes = useMemo(
    () => mapTranscribedTakeToTab(lastRawPlayedTake, session.tabNotes, {
      bpm: playbackBpm,
      beatsPerMeasure: session.beatsPerMeasure ?? beatsPerMeasure,
      phraseStartBeat: ((coachMeasureRange?.start ?? session.startMeasure) - 1)
        * (session.beatsPerMeasure ?? beatsPerMeasure),
      hideGhosts: hideGhostDetections,
    }),
    [lastRawPlayedTake, session.tabNotes, session.startMeasure, session.beatsPerMeasure, beatsPerMeasure, playbackBpm, hideGhostDetections, coachMeasureRange],
  );

  const selectedNote = selectedNoteId
    ? session.tabNotes.find(n => n.id === selectedNoteId)
    : undefined;

  const {
    isPlaying,
    source,
    playbackBeat,
    currentMeasure: playbackMeasure,
    canPlayOriginal,
    speed,
    loopEnabled,
    metronomeEnabled,
    metronomeVolume,
    togglePlay,
    seekTo,
    changeSource,
    setRecordingBlob,
    setSpeed,
    setLoopRegion,
    toggleLoop,
    toggleMetronome,
    setMetronomeVolume,
    isExportingSynth,
    exportSynthReference,
  } = usePlayback(session.tabNotes, playbackBpm, session.beatsPerMeasure ?? beatsPerMeasure);

  // ── Loop measure region (human-readable measure numbers, synced to beat region) ──
  const [loopMeasureRegion, setLoopMeasureRegion] = useState<{ startMeasure: number; endMeasure: number } | null>(null);

  const handleLoopRangeChange = useCallback((startM: number, endM: number) => {
    const bpm2 = session.beatsPerMeasure ?? beatsPerMeasure;
    setLoopMeasureRegion({ startMeasure: startM, endMeasure: endM });
    setLoopRegion({
      startBeat: (startM - 1) * bpm2,
      endBeat: endM * bpm2,
    });
    // Auto-enable loop when user sets a range
    if (!loopEnabled) toggleLoop();
  }, [session.beatsPerMeasure, beatsPerMeasure, setLoopRegion, loopEnabled, toggleLoop]);

  /** Clear loop region highlight + disable looping. */
  const handleClearLoop = useCallback(() => {
    setLoopMeasureRegion(null);
    setLoopRegion(null);
    if (loopEnabled) toggleLoop();
  }, [loopEnabled, toggleLoop, setLoopRegion]);

  /** Toggle loop; turning OFF also clears the measure highlight. */
  const handleLoopToggle = useCallback(() => {
    if (loopEnabled) {
      setLoopMeasureRegion(null);
      setLoopRegion(null);
    }
    toggleLoop();
  }, [loopEnabled, toggleLoop, setLoopRegion]);

  /** Clear an active drill — restore original BPM and disable loop. */
  const handleClearDrill = useCallback(() => {
    if (preDrillBpm != null) {
      setPlaybackBpm(preDrillBpm);
      setPreDrillBpm(null);
    }
    if (loopEnabled) toggleLoop();
    setLoopMeasureRegion(null);
    setLoopRegion(null);
    setActiveDrill(null);
  }, [preDrillBpm, loopEnabled, toggleLoop, setLoopRegion]);

  /** Let-ring: "all" adds to every note in range; "pick" enters interactive pick mode. */
  const handleAddLetRing = useCallback((startM: number, endM: number, mode: "all" | "pick") => {
    if (mode === "all") {
      setSession(s => ({
        ...s,
        tabNotes: s.tabNotes.map(n =>
          n.measure >= startM && n.measure <= endM ? { ...n, letRing: true } : n,
        ),
      }));
    } else {
      setLetRingPickRange({ start: startM, end: endM });
    }
  }, []);

  /** Toggle letRing on a single note while in pick mode. */
  const handleLetRingNotePick = useCallback((noteId: string) => {
    setSession(s => ({
      ...s,
      tabNotes: s.tabNotes.map(n => n.id === noteId ? { ...n, letRing: !n.letRing } : n),
    }));
  }, []);

  /** A/B Listen — seek to the weakest measure, loop it, switch to synth. */
  const handleABListen = useCallback(() => {
    const measure = session.metrics?.weakestMeasure;
    if (measure == null) return;
    handleLoopRangeChange(measure, measure);
    const bpm2 = session.beatsPerMeasure ?? beatsPerMeasure;
    seekTo((measure - 1) * bpm2);
    changeSource(source === "synth" && canPlayOriginal ? "original" : "synth");
  }, [session.metrics?.weakestMeasure, session.beatsPerMeasure, beatsPerMeasure, handleLoopRangeChange, seekTo, changeSource, source, canPlayOriginal]);

  const handleCoachMeasureSelect = useCallback((measure: number) => {
    const beats = session.beatsPerMeasure ?? beatsPerMeasure;
    setHighlightedMeasures([measure]);
    seekTo((measure - 1) * beats);
  }, [session.beatsPerMeasure, beatsPerMeasure, seekTo]);

  const handleTheoryHighlightToggle = useCallback((measures: number[]) => {
    const next = [...new Set(measures)].sort((a, b) => a - b);
    setHighlightedMeasures(current => {
      const normalizedCurrent = [...new Set(current)].sort((a, b) => a - b);
      const isSame = normalizedCurrent.length === next.length
        && normalizedCurrent.every((measure, index) => measure === next[index]);
      return isSame ? [] : next;
    });
  }, []);

  const handleCoachPlaybackAction = useCallback((
    action: "reference" | "take" | "compare" | "loop" | "slow" | "record",
    requestedMeasure?: number,
    targetBpm?: number,
  ) => {
    const measure = requestedMeasure ?? session.metrics?.weakestMeasure;
    if (measure != null) {
      handleCoachMeasureSelect(measure);
      if (action !== "record") handleLoopRangeChange(measure, measure);
    }
    if (action === "reference") changeSource("synth");
    if (action === "take" && canPlayOriginal) changeSource("original");
    if (action === "compare") changeSource(source === "synth" && canPlayOriginal ? "original" : "synth");
    if (action === "slow") {
      setSpeed(75);
      if (targetBpm != null && targetBpm !== playbackBpm) {
        setPreDrillBpm(playbackBpm);
        setPlaybackBpm(targetBpm);
      }
    }
  }, [
    canPlayOriginal,
    changeSource,
    handleCoachMeasureSelect,
    handleLoopRangeChange,
    playbackBpm,
    session.metrics?.weakestMeasure,
    setSpeed,
    source,
  ]);

  /** Confirm a chord flag — fill in missing notes from the chosen shape. */
  const handleChordConfirm = useCallback((measure: number, shapeIdx: number) => {
    const info = chordFlagInfos.find(f => f.measure === measure);
    if (!info || shapeIdx >= info.candidateShapes.length) { setChordPrompt(null); return; }
    const bpm2 = session.beatsPerMeasure ?? beatsPerMeasure;
    const filled = fillMeasureFromShape(session.tabNotes, measure, info.candidateShapes[shapeIdx], bpm2);
    setSession(s => ({ ...s, tabNotes: filled }));
    setChordPrompt(null);
  }, [chordFlagInfos, session.tabNotes, session.beatsPerMeasure, beatsPerMeasure]);

  /** Apply a tempo regrid for a specific measure range. */
  const handleTempoApply = useCallback((begin: number, end: number, newBpm: number) => {
    const oldBpm = session.bpm ?? playbackBpm;
    const bpm2 = session.beatsPerMeasure ?? beatsPerMeasure;
    const regrided = regridRange(session.tabNotes, begin, end, oldBpm, newBpm, bpm2);
    setSession(s => ({ ...s, tabNotes: regrided }));
    setTempoPrompt(null);
    // Re-detect flags after regrid
    setTempoFlagInfos(detectTempoFlagInfos(regrided, playbackBpm, bpm2));
  }, [session.bpm, session.beatsPerMeasure, session.tabNotes, playbackBpm, beatsPerMeasure]);

  const handleNoteSelect = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
  }, []);

  const handleNoteContextMenu = useCallback((noteId: string) => {
    setEditorMode(true);
    setSelectedNoteId(noteId);
  }, []);

  useEffect(() => {
    if (!selectedNoteId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedNoteId(null);
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (editorPanelRef.current?.contains(target)) return;
      if (target.closest("[data-tab-note='true']")) return;
      setSelectedNoteId(null);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [selectedNoteId]);

  const handleToggleLetRing = useCallback(() => {
    if (!selectedNoteId) return;
    setSession(s => ({
      ...s,
      tabNotes: s.tabNotes.map(n =>
        n.id === selectedNoteId ? { ...n, letRing: !n.letRing } : n,
      ),
    }));
  }, [selectedNoteId]);

  const handleSetTechnique = useCallback((technique: Technique | undefined) => {
    if (!selectedNoteId) return;
    setSession(s => ({
      ...s,
      tabNotes: s.tabNotes.map(n => {
        if (n.id !== selectedNoteId) return n;
        if (technique === undefined) {
          return { ...n, technique: undefined, bendSemitones: undefined };
        }
        return { ...n, technique, bendSemitones: technique === "bend" ? n.bendSemitones : undefined };
      }),
    }));
  }, [selectedNoteId]);

  const handleToggleTechnique = useCallback((technique: Technique) => {
    if (!selectedNoteId) return;
    setSession(s => ({
      ...s,
      tabNotes: s.tabNotes.map(n =>
        n.id === selectedNoteId
          ? { ...n, technique: n.technique === technique ? undefined : technique }
          : n,
      ),
    }));
  }, [selectedNoteId]);

  const handleRecordingStart = useCallback(() => {
    if (session.metrics) setPrevTakeMetrics(session.metrics);
    setHighlightedMeasures([]);
    setTheoryMeasure(null);
    setSession(s => ({
      ...s,
      tabNotes: s.tabNotes.map(n => ({ ...n, status: undefined })),
      feedback: undefined,
      metrics: undefined,
    }));
    setHasRecorded(false);
    setIsAnalysing(false);
    setTranscribeError(null);
    setTranscribeInfo(null);
    setMeasureScores({});
    setCoachError(null);
    setBpmCandidates([]);
    setRecordingBlob(null);
    setTotalMeasures(undefined);
    setCoachRecordingElapsedMs(null);
    lastCoachEventsRef.current = [];
    setLastRawPlayedTake([]);

    // Jump green cursor to the start of the coached measure range
    const bpm2 = session.beatsPerMeasure ?? beatsPerMeasure;
    const startM = coachMeasureRange?.start ?? session.startMeasure;
    const endM = coachMeasureRange?.end ?? session.endMeasure;
    seekTo((startM - 1) * bpm2);
    if (coachMeasureRange) {
      setLoopMeasureRegion({ startMeasure: startM, endMeasure: endM });
    }
  }, [setRecordingBlob, coachMeasureRange, session.beatsPerMeasure, session.metrics, session.startMeasure, session.endMeasure, beatsPerMeasure, seekTo]);

  const handleRecordingCancel = useCallback(() => {
    setCoachRecordingElapsedMs(null);
  }, []);

  const handleCoachRecordingTick = useCallback((elapsedMs: number) => {
    lastRecordingDurationMsRef.current = elapsedMs;
    setCoachRecordingElapsedMs(elapsedMs);
  }, []);

  const handleSaveAudio = useCallback((save: boolean) => {
    setShowSaveAudioPrompt(false);
    if (!save || !lastCoachBlobRef.current) return;
    const { id, blob } = lastCoachBlobRef.current;
    if (!blob) return;
    saveRecording(id, blob).then(() => {
      if (lastCoachBlobRef.current?.id === id) lastCoachBlobRef.current.blob = null;
      refreshSongMetrics();
    }).catch(() => {});
  }, [refreshSongMetrics]);

  const handleDeleteSession = useCallback((id: string) => {
    deleteSession(id).then(() => refreshSongMetrics()).catch(() => {});
  }, [refreshSongMetrics]);

  const handleRecordingComplete = useCallback(async (blob: Blob) => {
    setCoachRecordingElapsedMs(null);
    setIsAnalysing(true);
    setHasRecorded(true);
    setCoachError(null);
    setRecordingBlob(blob);

    const expectedNotes = session.tabNotes.map(n => ({ ...n, status: undefined }));
    const activeBeatsPerMeasure = session.beatsPerMeasure ?? beatsPerMeasure;

    try {
      const coachBpm = playbackBpm;
      const result = await transcribeAudio(blob, coachBpm, {
        detectBpm: false,
        beatsPerMeasure: activeBeatsPerMeasure,
        coachPreset: true,
        expectedNotes: expectedNotes.map(n => ({
          measure: n.measure,
          beat: n.beat,
          string: n.string,
          fret: n.fret,
        })),
      });
      const timeline = buildPracticeTimeline({
        bpm: coachBpm,
        beatsPerMeasure: activeBeatsPerMeasure,
        startMeasure: coachMeasureRange?.start ?? session.startMeasure,
        audioPreprocess: result.settings?.audioPreprocess,
      });
      const restoredEvents = restoreDetectedOnsets(result.rawEvents, timeline);
      const restoredTabNotes = result.tabNotes.map(n => ({
        ...n,
        onsetMs: (n.onsetMs ?? 0) + timeline.trimStartMs,
      }));
      lastCoachEventsRef.current = restoredEvents;
      setLastRawPlayedTake(restoredTabNotes);
      const recordingDurationMs = result.durationMs ?? lastRecordingDurationMsRef.current;
      const analysis = analyzePracticeTake({
        expectedNotes,
        transcription: { ...result, rawEvents: restoredEvents },
        bpm: coachBpm,
        beatsPerMeasure: activeBeatsPerMeasure,
        recordingDurationMs: recordingDurationMs > 0 ? recordingDurationMs : undefined,
        coachMeasureRange: coachMeasureRange ?? undefined,
        theoryMeasures: theoryAnalysis.measures,
      });
      if (process.env.NODE_ENV !== "production") {
        console.info("[coach timing calibration]", {
          correctionMs: analysis.metrics.inputLatencyCorrectionMs ?? 0,
          sampleCount: analysis.metrics.timingCalibrationSampleCount ?? 0,
          residualDriftMs: analysis.metrics.timingDriftMs,
        });
      }
      setSession(s => ({
        ...s,
        tabNotes: analysis.tabNotes,
        feedback: analysis.feedback,
        metrics: analysis.metrics,
      }));
      // Shift current → previous metrics for take-compare card
      // Derive per-measure accuracy scores (0–1) for heat-map
      const scores = Object.fromEntries(
        (analysis.metrics.measureResults ?? []).map(result => [
          result.measure,
          result.accuracyPercent / 100,
        ]),
      );
      setMeasureScores(scores);
      setTranscribeInfo(`Coach aligned ${result.noteCount} detected notes against the known tab.`);

      // Persist session record to IndexedDB
      const sessionId = `coach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const durationMs = result.durationMs ?? 0;
      const measureAccuracy = deriveMeasureAccuracy(analysis.tabNotes);
      const record: SavedSession = {
        id: sessionId,
        songTitle: session.songTitle,
        artist: session.artist,
        bpm: session.bpm,
        beatsPerMeasure: activeBeatsPerMeasure,
        createdAt: Date.now(),
        durationMs,
        accuracyPercent: analysis.metrics.accuracyPercent,
        timingDriftMs: analysis.metrics.timingDriftMs,
        weakestMeasure: analysis.metrics.weakestMeasure,
        recommendedTempoBpm: analysis.metrics.recommendedTempoBpm,
        measureAccuracy,
        measureResults: analysis.metrics.measureResults,
        coachedRange: coachMeasureRange ?? {
          start: session.startMeasure,
          end: session.endMeasure,
        },
        hasAudio: false,
      };
      saveSession(record).then(() => refreshSongMetrics()).catch(() => {});
      lastCoachBlobRef.current = { id: sessionId, blob, durationMs };
      setHasDownloadableCoachTake(true);
      setShowSaveAudioPrompt(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Coach transcription failed.";
      const isNetwork = msg.includes("fetch") || msg.includes("Failed to fetch");
      setCoachError(
        isNetwork
          ? "Can't reach the transcription server. Start the backend on :8000 and record again."
          : msg,
      );
      // Leave tab notes as unplayed — no synthetic fabrication
      setSession(s => ({
        ...s,
        tabNotes: s.tabNotes.map(n => ({ ...n, status: undefined })),
        feedback: undefined,
        metrics: undefined,
      }));
      setHasRecorded(false);
    } finally {
      setIsAnalysing(false);
    }
  }, [beatsPerMeasure, coachMeasureRange, playbackBpm, refreshSongMetrics, session.beatsPerMeasure, session.bpm, session.endMeasure, session.startMeasure, session.songTitle, session.artist, session.tabNotes, setRecordingBlob, theoryAnalysis.measures]);

  // Flash chord overlay temporarily when a theory-aware finding is clicked
  const chordOverlayFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFindingClick = useCallback((finding: { measure: number; theoryHint?: { chord: string; measure: number } }) => {
    setHighlightedMeasures([finding.measure]);
    if (finding.theoryHint) {
      setTheoryToggles(t => ({ ...t, chordNames: true }));
      if (chordOverlayFlashRef.current) clearTimeout(chordOverlayFlashRef.current);
      chordOverlayFlashRef.current = setTimeout(() => {
        setTheoryToggles(t => ({ ...t, chordNames: false }));
      }, 5000);
    }
  }, []);
  const handleTranscribe = useCallback(async (blob: Blob, _ms: number, bpm: number, options?: TranscribeTuning) => {
    setHighlightedMeasures([]);
    setTheoryMeasure(null);
    setTranscribing(true);
    setTranscribeError(null);
    setTranscribeInfo(null);
    setHasRecorded(false);
    setIsAnalysing(false);
    setLastTranscribeSource({ blob, durationMs: _ms, tuning: options });
    try {
      const result = await transcribeAudio(blob, bpm, {
        detectBpm: options?.detectBpm,
        beatsPerMeasure: options?.beatsPerMeasure ?? beatsPerMeasure,
        onsetThreshold: options?.onsetThreshold,
        frameThreshold: options?.frameThreshold,
        minNoteLenMs: options?.minNoteLenMs,
        qualityMode: options?.qualityMode,
      });
      if (result.tabNotes.length === 0) {
        setTranscribeError("No notes detected. Try playing louder or closer to the mic.");
        return;
      }
      const effectiveBpm = Math.round(result.bpm);
      const effectiveBeatsPerMeasure = result.beatsPerMeasure ?? options?.beatsPerMeasure ?? beatsPerMeasure;
      setPlaybackBpm(effectiveBpm);
      setSession(s => ({
        ...s,
        songTitle: "Your Recording",
        artist: "Transcribed from audio",
        beatsPerMeasure: effectiveBeatsPerMeasure,
        tabNotes: result.tabNotes.map(n => ({ ...n, status: undefined })),
        bpm: effectiveBpm,
        feedback: undefined,
        metrics: undefined,
      }));
      // Clear stale state from any previous tab session
      setHighlightedMeasures([]);
      setTheoryMeasure(null);
      setActiveDrill(null);
      setPreDrillBpm(null);
      setTempoPrompt(null);
      setChordFlags([]);
      setChordPrompt(null);
      setMeasureScores({});
      setPrevTakeMetrics(null);
      // Detect sustained tempo shifts (sparse — at most a couple of flags)
      setTempoFlagInfos(detectTempoFlagInfos(
        result.tabNotes,
        effectiveBpm,
        effectiveBeatsPerMeasure,
      ));
      // Store blob for original playback + total measures for the tab viewer
      setRecordingBlob(blob);
      if (result.totalMeasures) setTotalMeasures(result.totalMeasures);
      setBpmCandidates(result.bpmCandidates ?? result.bpmDetection?.candidates ?? []);
      const bpmLabel = result.detectedBpm
        ? ` at ${Math.round(result.detectedBpm)} BPM auto`
        : ` at ${Math.round(effectiveBpm)} BPM manual`;
      setTranscribeInfo(`Detected ${result.noteCount} notes${bpmLabel}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transcription failed";
      setTranscribeError(
        msg.includes("fetch") || msg.includes("Failed to fetch")
          ? "Can't reach the transcription server. Is the backend running on :8000?"
          : msg,
      );
    } finally {
      setTranscribing(false);
    }
  }, [beatsPerMeasure, setRecordingBlob]);

  const handleBpmCandidateSelect = useCallback(async (candidateBpm: number) => {
    if (!lastTranscribeSource) return;

    setHighlightedMeasures([]);
    setTheoryMeasure(null);
    setTranscribing(true);
    setTranscribeError(null);
    setTranscribeInfo(null);
    try {
      const tuning = lastTranscribeSource.tuning;
      const result = await transcribeAudio(lastTranscribeSource.blob, Math.round(candidateBpm), {
        detectBpm: false,
        beatsPerMeasure: tuning?.beatsPerMeasure ?? beatsPerMeasure,
        onsetThreshold: tuning?.onsetThreshold,
        frameThreshold: tuning?.frameThreshold,
        qualityMode: tuning?.qualityMode,
        minNoteLenMs: tuning?.minNoteLenMs,
      });
      if (result.tabNotes.length === 0) {
        setTranscribeError("No notes detected after BPM correction.");
        return;
      }

      setPlaybackBpm(Math.round(result.bpm));
      setSession(s => ({
        ...s,
        songTitle: "Your Recording",
        artist: "Transcribed from audio",
        beatsPerMeasure: result.beatsPerMeasure ?? tuning?.beatsPerMeasure ?? beatsPerMeasure,
        tabNotes: result.tabNotes.map(n => ({ ...n, status: undefined })),
        bpm: Math.round(result.bpm),
        feedback: undefined,
        metrics: undefined,
      }));
      setHighlightedMeasures([]);
      setTheoryMeasure(null);
      setTempoPrompt(null);
      setChordFlags([]);
      setChordPrompt(null);
      const newBpm = Math.round(result.bpm);
      const newBpM = result.beatsPerMeasure ?? tuning?.beatsPerMeasure ?? beatsPerMeasure;
      setTempoFlagInfos(detectTempoFlagInfos(result.tabNotes, newBpm, newBpM));
      setRecordingBlob(lastTranscribeSource.blob);
      if (result.totalMeasures) setTotalMeasures(result.totalMeasures);
      setTranscribeInfo(`Re-quantized ${result.noteCount} notes at ${Math.round(result.bpm)} BPM`);
    } catch (e) {
      setTranscribeError(e instanceof Error ? e.message : "BPM correction failed");
    } finally {
      setTranscribing(false);
    }
  }, [beatsPerMeasure, lastTranscribeSource, setRecordingBlob]);

  const handleRhythmRecord = useCallback(async (blob: Blob, selectedMeasures: number[], bpm: number) => {
    setRhythmMerging(true);
    setRhythmMergeError(null);
    setRhythmMergeInfo(null);
    try {
      const activeBeatsPerMeasure = session.beatsPerMeasure ?? beatsPerMeasure;
      const rhythmResult = await transcribeAudio(blob, bpm, { beatsPerMeasure: activeBeatsPerMeasure });
      if (rhythmResult.rawEvents.length === 0) {
        setRhythmMergeError("No onsets detected in the rhythm pass. Try playing louder.");
        return;
      }
      const { notes, error } = mergeRhythm(session.tabNotes, rhythmResult, selectedMeasures, bpm, activeBeatsPerMeasure);
      if (error) {
        setRhythmMergeError(error);
        return;
      }
      setSession(s => ({ ...s, tabNotes: notes }));
      setRhythmMergeInfo(`Re-timed ${selectedMeasures.length} measure${selectedMeasures.length !== 1 ? "s" : ""}.`);
    } catch (e) {
      setRhythmMergeError(e instanceof Error ? e.message : "Rhythm merge failed");
    } finally {
      setRhythmMerging(false);
    }
  }, [beatsPerMeasure, session.beatsPerMeasure, session.tabNotes]);

  const activeBeatsPerMeasure = session.beatsPerMeasure ?? beatsPerMeasure;
  const maxMeasure = useMemo(
    () => Math.max(...session.tabNotes.map(n => n.measure), 1),
    [session.tabNotes],
  );
  const coachStartMeasure = coachMeasureRange?.start ?? session.startMeasure;
  const coachEndMeasure = coachMeasureRange?.end ?? session.endMeasure;
  const phraseStartBeat = (coachStartMeasure - 1) * activeBeatsPerMeasure;
  const phraseEndBeat = coachEndMeasure * activeBeatsPerMeasure;

  const handleDownloadLastTake = useCallback(async () => {
    setAudioExportError(null);
    setAudioExportMessage(null);
    const last = lastCoachBlobRef.current;
    if (!last) {
      setAudioExportError("Record a Coach take before downloading audio.");
      return;
    }
    try {
      const blob = last.blob ?? await getRecording(last.id);
      if (!blob) throw new Error("The saved recording could not be found.");
      downloadBlob(blob, fixtureFilename({
        songTitle: session.songTitle,
        startMeasure: coachStartMeasure,
        endMeasure: coachEndMeasure,
        bpm: playbackBpm,
        speed,
        kind: "real-take",
        extension: audioExtension(blob),
      }));
      setAudioExportMessage("Downloaded the original Coach take.");
    } catch (error) {
      setAudioExportError(error instanceof Error ? error.message : "Could not download the Coach take.");
    }
  }, [coachEndMeasure, coachStartMeasure, playbackBpm, session.songTitle, speed]);

  const handleExportSynthReference = useCallback(async () => {
    setAudioExportError(null);
    setAudioExportMessage(null);
    try {
      const blob = await exportSynthReference({
        startBeat: phraseStartBeat,
        endBeat: phraseEndBeat,
      });
      downloadBlob(blob, fixtureFilename({
        songTitle: session.songTitle,
        startMeasure: coachStartMeasure,
        endMeasure: coachEndMeasure,
        bpm: playbackBpm,
        speed,
        kind: "synth-reference",
        extension: audioExtension(blob),
      }));
      setAudioExportMessage("Exported the metronome-free synth reference.");
    } catch (error) {
      setAudioExportError(error instanceof Error ? error.message : "Could not export the synth reference.");
    }
  }, [
    coachEndMeasure,
    coachStartMeasure,
    exportSynthReference,
    phraseEndBeat,
    phraseStartBeat,
    playbackBpm,
    session.songTitle,
    speed,
  ]);

  const coachTimeline = {
    bpm: playbackBpm,
    phraseStartBeat,
  };
  const coachRecordingBeat =
    coachRecordingElapsedMs == null
      ? undefined
      : Math.min(
          phraseEndBeat,
          recordingElapsedToBeat(coachRecordingElapsedMs, coachTimeline),
        );
  const visiblePlaybackBeat = coachRecordingBeat ?? playbackBeat;

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--ss-surface)", color: "var(--ss-text)", fontWeight: 300, paddingTop: 80 }}
    >
      {/* Search modal */}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      <Header onSearchOpen={() => setSearchOpen(true)} />

      {/* ── Body: tab area + Studio dashboard (full height) ── */}
      <div className="flex flex-1 overflow-hidden min-h-0" style={{ position: "relative" }}>
        {/* Tab area */}
        <motion.div
          layout
          className="flex-1 flex flex-col overflow-auto"
          style={{ backgroundColor: "var(--ss-surface)", minWidth: 0 }}
        >
          {/* Song info */}
          <div
            className="shrink-0 flex flex-col items-center"
            style={{ backgroundColor: "var(--ss-surface)", margin: "0 20px", paddingTop: 32, paddingBottom: 16 }}
          >
            <h1
              className="text-center"
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 45,
                fontWeight: 300,
                color: "var(--ss-text-title)",
                lineHeight: "45px",
                margin: 0,
              }}
            >
              {session.songTitle}
              <span style={{ color: "var(--ss-text-muted)", fontWeight: 300, marginInlineStart: "0.25em" }}>Tab</span>
            </h1>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "center",
                width: "100%",
                maxWidth: 900,
                marginTop: 12,
                marginBottom: 4,
              }}
            >
              <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 20, minWidth: 0 }}>
                <HeaderIconBtn onClick={() => setLiked(l => !l)} active={liked}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </HeaderIconBtn>
                <DisplayDropdown value={displayMode} onChange={setDisplayMode} />
              </div>

              <div style={{ display: "flex", alignItems: "center", padding: "0 20px", fontSize: 13, lineHeight: "25px" }}>
                <span style={{ color: "var(--ss-text-muted)", fontWeight: 700, textTransform: "uppercase", marginRight: 8, fontSize: 13 }}>Revision from:</span>
                <button type="button" style={{ background: "none", border: "none", color: "#238c35", cursor: "pointer", fontSize: 13, fontWeight: 400, padding: 0 }}>
                  6/11/2026
                </button>
              </div>

              <div style={{ flex: 1, display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 8, minWidth: 0 }}>
                {/* Print */}
                <HeaderIconBtn>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                </HeaderIconBtn>
                {/* Tab lock / unlock */}
                <div style={{ userSelect: "none", width: 32, height: 32, position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setTabLocked(l => { if (!l) setLetRingPickRange(null); return !l; })}
                    title={tabLocked ? "Tab locked — click to allow editing" : "Tab unlocked — click to lock"}
                    style={{
                      cursor: "pointer", appearance: "none", background: "transparent", border: "none",
                      height: 32, width: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      color: tabLocked ? "#cf4343" : "#238c35",
                    }}
                  >
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ position: "absolute", inset: 0 }}>
                      <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.3" fill="transparent" />
                    </svg>
                    <div style={{ position: "relative", zIndex: 1, display: "flex" }}>
                      {tabLocked ? (
                        // Closed lock
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      ) : (
                        // Open lock
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                        </svg>
                      )}
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <a
              href="#"
              className="hover:opacity-70 transition-opacity"
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 18,
                fontWeight: 300,
                color: "#238c35",
                textDecoration: "none",
                lineHeight: "23px",
                marginBottom: 4,
              }}
            >
              {session.artist}
            </a>
          </div>

          {/* ── Tab Toolbar ────────────────────────────────────────────── */}
          <div
            className="shrink-0"
            style={{
              margin: tabToolbarCollapsed ? "0 20px" : "6px 20px 4px",
              borderRadius: 6,
              background: tabToolbarCollapsed ? "transparent" : "var(--ss-controls-surface)",
              border: tabToolbarCollapsed ? "none" : "1px solid var(--ss-panel-border)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "stretch",
              gap: 0,
              position: "relative",
              overflow: "visible",
              transition: "margin 180ms ease, border-color 180ms ease, background-color 180ms ease",
            }}
          >
            {tabToolbarCollapsed && (
              <button
                type="button"
                onClick={() => setTabToolbarCollapsed(false)}
                aria-expanded="false"
                title="Show theory and recording results"
                style={{
                  position: "absolute",
                  zIndex: 10,
                  right: 4,
                  top: 1,
                  width: 25,
                  height: 17,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  border: "none",
                  borderRadius: 0,
                  background: "transparent",
                  color: "var(--ss-text-secondary)",
                  cursor: "pointer",
                  boxShadow: "none",
                  lineHeight: 1,
                }}
              >
                <ChevronDown size={19} strokeWidth={1.7} />
              </button>
            )}
            <AnimatePresence initial={false}>
              {!tabToolbarCollapsed && (
                <motion.div
                  key="tab-toolbar-content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    width: "100%",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "stretch",
                    overflow: "hidden",
                  }}
                >
            {/* ── Theory (yellow) ── */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
              borderRight: "1px solid var(--ss-panel-border)",
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#ca8a04", flexShrink: 0 }}>Theory</span>
              <div style={{ display: "flex", alignItems: "center", gap: 1, background: "rgba(202,138,4,0.18)", borderRadius: 4, padding: 1 }}>
                {([
                  ["chordNames",       "Chords"],
                  ["romanNumerals",    "Roman"],
                  ["fretboardPatterns","Shapes"],
                  ["improvGuides",     "Improv"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTheoryToggles(t => ({ ...t, [key]: !t[key] }))}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 3, border: "none",
                      background: theoryToggles[key] ? "#ca8a04" : "var(--ss-controls-surface)",
                      color: theoryToggles[key] ? "#fff" : "var(--ss-text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                background: "rgba(202,138,4,0.18)", color: "#e0a93f", letterSpacing: "0.2px",
              }}>
                {theoryAnalysis.key} {theoryAnalysis.mode}
              </span>
            </div>

            {/* ── Overlay (teal) ── */}
            {hasRecorded && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                borderRight: "1px solid var(--ss-panel-border)",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#0d9488", flexShrink: 0 }}>Overlay</span>
                <button
                  type="button"
                  onClick={() => setShowPlayedTakeLane(v => !v)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 4,
                    border: `1px solid ${showPlayedTakeLane ? "#0d9488" : "rgba(13,148,136,0.35)"}`,
                    background: showPlayedTakeLane ? "rgba(13,148,136,0.2)" : "rgba(13,148,136,0.08)",
                    color: showPlayedTakeLane ? "#2dd4bf" : "var(--ss-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  Your take
                </button>
                {showPlayedTakeLane && (
                  <button
                    type="button"
                    onClick={() => setHideGhostDetections(v => !v)}
                    title="Show/hide noise detections outside the tab"
                    style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 4,
                      border: `1px solid ${!hideGhostDetections ? "#0d9488" : "rgba(13,148,136,0.35)"}`,
                      background: !hideGhostDetections ? "rgba(13,148,136,0.2)" : "transparent",
                      color: !hideGhostDetections ? "#2dd4bf" : "var(--ss-text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    Noise {hideGhostDetections ? "hidden" : "shown"}
                  </button>
                )}
              </div>
            )}

            {/* ── Results legend ── */}
            {hasRecorded && session.metrics && !isAnalysing && (
              <div style={{
                display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "6px 10px",
                borderRight: "1px solid var(--ss-panel-border)",
              }}>
                <span
                  title="Colors show detected pitch and timing aligned to expected tab notes; they do not identify the physical string played."
                  style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ss-text-muted)", flexShrink: 0 }}
                >
                  Expected outcome
                </span>
                {LEGEND_ITEMS.map(([status, label]) => {
                  const s = NOTE_STYLE[status];
                  return (
                    <div key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{
                        width: 9, height: 9, borderRadius: "50%", background: s.text, display: "inline-block", flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ss-text)" }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Drills (blue chips) ── */}
            {hasRecorded && session.feedback?.practiceActions && session.feedback.practiceActions.length > 0 && !isAnalysing && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                borderRight: "1px solid var(--ss-panel-border)",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#5376f0", flexShrink: 0 }}>Drills</span>
                {session.feedback.practiceActions.slice(0, 3).map((action, i) => (
                  <button
                    key={i}
                    type="button"
                    title={action.detail}
                    onClick={() => {
                      if (action.targetBpm) {
                        if (action.targetBpm !== playbackBpm) setPreDrillBpm(playbackBpm);
                        setPlaybackBpm(action.targetBpm);
                      }
                      if (action.measure != null) {
                        const endMeasure = Math.max(action.measure, action.endMeasure ?? action.measure);
                        setHighlightedMeasures(
                          Array.from(
                            { length: endMeasure - action.measure + 1 },
                            (_, index) => action.measure! + index,
                          ),
                        );
                        handleLoopRangeChange(action.measure, endMeasure);
                        seekTo((action.measure - 1) * activeBeatsPerMeasure);
                      }
                      setActiveDrill(action);
                    }}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 4,
                      border: "1px solid rgba(83,118,240,0.45)",
                      background: "rgba(83,118,240,0.14)",
                      color: "#8eaaff",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* ── Right actions ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px" }}>
              <button
                type="button"
                onClick={() => setTabToolbarCollapsed(true)}
                aria-expanded="true"
                title="Collapse theory and recording results"
                style={{
                  width: 24,
                  height: 22,
                  fontWeight: 700,
                  padding: 0,
                  borderRadius: 0,
                  border: "none",
                  background: "transparent",
                  color: "var(--ss-text-secondary)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <ChevronUp size={19} strokeWidth={1.7} />
              </button>
              {isAnalysing && (
                <span style={{ fontSize: 11, color: "#60a5fa", fontWeight: 600 }}>Aligning…</span>
              )}

              {session.metrics && !isAnalysing && (
                <button
                  type="button"
                  onClick={() => setHighlightedMeasures(h => h.length > 0 ? [] : [session.metrics!.weakestMeasure])}
                  title={`Highlight the weakest measure (m${session.metrics.weakestMeasure}) in the tab`}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 4,
                    border: "1px solid rgba(220,38,38,0.45)",
                    background: highlightedMeasures.length > 0 ? "rgba(220,38,38,0.22)" : "rgba(220,38,38,0.1)",
                    color: "#f87171",
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {highlightedMeasures.length > 0
                    ? `Clear · m${session.metrics.weakestMeasure}`
                    : `Worst · m${session.metrics.weakestMeasure}`}
                </button>
              )}

              {canPlayOriginal && session.metrics && (
                <button
                  type="button"
                  onClick={handleABListen}
                  title={`A/B listening: keep measure ${session.metrics.weakestMeasure} looped and switch to ${source === "synth" ? "your recorded take" : "the synth reference"}. Click again to switch back.`}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 4,
                    border: "1px solid rgba(83,118,240,0.55)",
                    background: "rgba(83,118,240,0.18)",
                    color: "#8eaaff",
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  A/B · {source === "synth" ? "Hear your take" : "Hear reference"} · m{session.metrics.weakestMeasure}
                </button>
              )}
            </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <TabViewer
            notes={session.tabNotes}
            bpm={playbackBpm}
            currentMeasure={playbackMeasure}
            playbackBeat={visiblePlaybackBeat}
            hasRecorded={hasRecorded}
            totalMeasures={totalMeasures}
            beatsPerMeasure={activeBeatsPerMeasure}
            editorMode={editorMode}
            selectedNoteId={selectedNoteId}
            loopMeasureRegion={loopMeasureRegion}
            theoryMeasures={theoryAnalysis.measures}
            theoryToggles={theoryToggles}
            theoryKey={theoryAnalysis.key}
            theoryMode={theoryAnalysis.mode}
            theoryShapes={theoryAnalysis.recurringShapes}
            onMeasureTheoryClick={(m) => {
              setTheoryMeasure(m);
              setDashboardOpen(true);
            }}
            onHighlightMeasures={setHighlightedMeasures}
            onOpenTheoryTab={() => {
              setDashboardOpen(true);
              setTheoryTabRequestKey(key => key + 1);
            }}
            showPlayedTakeLane={showPlayedTakeLane}
            playedTakeNotes={lastPlayedTakeNotes}
            hideGhostDetections={hideGhostDetections}
            onSeek={seekTo}
            onNoteSelect={handleNoteSelect}
            onNoteContextMenu={handleNoteContextMenu}
            onLoopRangeChange={handleLoopRangeChange}
            highlightedMeasures={highlightedMeasures}
            activeMeasureRange={coachMeasureRange}
            onClearLoop={loopMeasureRegion ? handleClearLoop : undefined}
            tempoFlags={tempoFlags}
            tempoPrompt={tempoPrompt}
            onTempoFlagClick={(m, maxM) => {
              const info = tempoFlagInfos.find(f => f.measure === m);
              setTempoPrompt({
                measure: m,
                begin: m,
                end: info?.endMeasure ?? maxM,
                suggestedBpm: info?.suggestedBpm ?? playbackBpm,
              });
            }}
            onTempoPromptChange={setTempoPrompt}
            onTempoPromptApply={handleTempoApply}
            onTempoFlagDismiss={(m) => {
              setTempoFlagInfos(infos => infos.filter(f => f.measure !== m));
            }}
            chordFlags={chordFlags}
            onChordFlagClick={(m) => {
              const info = chordFlagInfos.find(f => f.measure === m);
              if (!info) return;
              setChordPrompt({
                measure: m,
                chord: info.labeledChord,
                options: info.candidateShapes.map(s =>
                  s.positions.map(p => `s${p.string}f${p.fret}`).join(" ")
                ),
              });
            }}
            measureScores={measureScores}
            onAddLetRing={tabLocked ? undefined : handleAddLetRing}
            letRingPickRange={letRingPickRange}
            onLetRingNotePick={handleLetRingNotePick}
            onLetRingPickDone={() => setLetRingPickRange(null)}
          />

          {/* ── Chord-confirm popup ── */}
          {chordPrompt && (
            <div style={{
              position: "sticky", bottom: 12, left: "50%", transform: "translateX(-50%)",
              zIndex: 60, width: "min(420px, 92vw)",
              background: "var(--ss-controls-surface, #2a2a2e)",
              border: "1px solid rgba(167,139,250,0.5)", borderRadius: 10,
              padding: "14px 16px 12px", boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>
                  ♪ Complete as <strong>{chordPrompt.chord}</strong> in M{chordPrompt.measure}?
                </span>
                <button type="button" onClick={() => setChordPrompt(null)}
                  style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--ss-text-muted)", fontSize: 16 }}>×</button>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--ss-text-muted)" }}>
                This measure seems to have fewer notes than expected for a <strong style={{ color: "#a78bfa" }}>{chordPrompt.chord}</strong> chord.
                Confirming will add the likely missing strings on beat 1.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {chordPrompt.options.map((opt, i) => (
                  <button key={i} type="button"
                    onClick={() => handleChordConfirm(chordPrompt.measure, i)}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 5,
                      background: "rgba(167,139,250,0.2)", color: "#a78bfa",
                      border: "1px solid rgba(167,139,250,0.5)", cursor: "pointer",
                    }}>
                    Fill ({opt})
                  </button>
                ))}
                <button type="button" onClick={() => setChordPrompt(null)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 5,
                    background: "transparent", color: "var(--ss-text-muted)",
                    border: "1px solid var(--ss-panel-border)", cursor: "pointer",
                  }}>Keep as-is</button>
              </div>
            </div>
          )}

          {editorMode && (
            <div ref={editorPanelRef} style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              position: "sticky",
              bottom: 0,
              zIndex: 30,
              padding: "10px 16px",
              background: "rgba(83,118,240,0.12)",
              borderTop: "1px solid rgba(83,118,240,0.25)",
              fontSize: 12,
              color: "#a8b8f0",
            }}>
              <span style={{ marginRight: 4 }}>
                {selectedNote
                  ? <>Note <strong>{selectedNote.fret}</strong> on string {selectedNote.string}</>
                  : "Click a note to edit"}
              </span>
              <EditorBtn
                label="Let ring"
                active={!!selectedNote?.letRing}
                disabled={!selectedNoteId}
                onClick={handleToggleLetRing}
              />
              <EditorBtn
                label="Slide"
                active={selectedNote?.technique === "slide"}
                disabled={!selectedNoteId}
                onClick={() => handleToggleTechnique("slide")}
              />
              <EditorBtn
                label="Vibrato"
                active={selectedNote?.technique === "vibrato"}
                disabled={!selectedNoteId}
                onClick={() => handleToggleTechnique("vibrato")}
              />
              <EditorBtn
                label="Clear technique"
                disabled={!selectedNoteId || !selectedNote?.technique}
                onClick={() => handleSetTechnique(undefined)}
              />
              <span style={{ marginLeft: "auto", opacity: 0.75 }}>
                Click the tab to move the playhead
              </span>
            </div>
          )}

          {/* Dashboard toggle */}
          <button
            onClick={() => setDashboardOpen(o => !o)}
            title={dashboardOpen ? "Close Studio" : "Open Studio"}
            style={{
              position: "absolute",
              right: dashboardOpen ? "clamp(280px, 20vw, 420px)" : 0,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 20,
              width: 24,
              height: 48,
              background: "var(--ss-controls-surface)",
              border: "1px solid var(--ss-panel-border)",
              borderRadius: dashboardOpen ? "4px 0 0 4px" : "0 4px 4px 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--ss-text-muted)",
              transition: "right 0.3s ease, color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#238c35"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--ss-text-muted)"; }}
          >
            {dashboardOpen ? (
              <svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <polyline points="7,2 3,7 7,12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            )}
          </button>
        </motion.div>

        {/* Studio dashboard — full height, header to player */}
        <AnimatePresence initial={false}>
          {dashboardOpen && (
            <motion.div
              key="studio"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "clamp(280px, 20vw, 420px)", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="shrink-0 flex flex-col overflow-hidden"
              style={{ width: "clamp(280px, 20vw, 420px)" }}
            >
              <StudioDashboard
                songTitle={session.songTitle}
                artist={session.artist}
                bpm={playbackBpm}
                onCoachBpmChange={setPlaybackBpm}
                beatsPerMeasure={session.beatsPerMeasure ?? beatsPerMeasure}
                tabLocked={tabLocked}
                onRequestUnlock={() => setTabLocked(false)}
                onBeatsPerMeasureChange={(beats) => {
                  if (tabLocked) return;
                  setBeatsPerMeasure(beats);
                  setSession(s => ({ ...s, beatsPerMeasure: beats }));
                }}
                feedback={session.feedback}
                metrics={isAnalysing ? undefined : session.metrics}
                songMetrics={songMetrics}
                isAnalysing={isAnalysing}
                coachError={coachError}
                showSaveAudioPrompt={showSaveAudioPrompt}
                onSaveAudio={handleSaveAudio}
                canDownloadLastTake={hasDownloadableCoachTake}
                onDownloadLastTake={handleDownloadLastTake}
                onExportSynthReference={
                  process.env.NODE_ENV !== "production"
                    ? handleExportSynthReference
                    : undefined
                }
                isExportingSynth={isExportingSynth}
                audioExportMessage={audioExportMessage}
                audioExportError={audioExportError}
                onDeleteSession={handleDeleteSession}
                onApplyCoachAction={({ measure, targetBpm }) => {
                  // Record the pre-drill BPM so we can undo it later
                  if (targetBpm != null && targetBpm !== playbackBpm) {
                    setPreDrillBpm(playbackBpm);
                    setPlaybackBpm(targetBpm);
                  }
                  if (measure != null) {
                    handleLoopRangeChange(measure, measure);
                    seekTo((measure - 1) * activeBeatsPerMeasure);
                  }
                  // Track the active drill for the undo indicator
                  const action = session.feedback?.practiceActions?.find(
                    a => a.measure === measure && a.targetBpm === targetBpm,
                  );
                  if (action) setActiveDrill(action);
                }}
                activeDrill={activeDrill}
                onClearDrill={handleClearDrill}
                onHighlightMeasures={handleTheoryHighlightToggle}
                highlightedMeasures={highlightedMeasures}
                onFindingClick={handleFindingClick}
                prevTakeMetrics={prevTakeMetrics}
                onCoachMeasureSelect={handleCoachMeasureSelect}
                onCoachPlaybackAction={handleCoachPlaybackAction}
                onRecordingStart={handleRecordingStart}
                onRecordingTick={handleCoachRecordingTick}
                onRecordingCancel={handleRecordingCancel}
                onRecordingComplete={handleRecordingComplete}
                onTranscribe={handleTranscribe}
                transcribing={transcribing}
                transcribeError={transcribeError}
                transcribeInfo={transcribeInfo}
                bpmCandidates={bpmCandidates}
                selectedBpm={session.bpm}
                onBpmCandidateSelect={handleBpmCandidateSelect}
                tabNotes={session.tabNotes.length > 0 ? session.tabNotes : undefined}
                onRhythmRecord={handleRhythmRecord}
                rhythmMerging={rhythmMerging}
                rhythmMergeError={rhythmMergeError}
                rhythmMergeInfo={rhythmMergeInfo}
                hasCoachRecording={hasRecorded && !!session.metrics}
                showPlayedTakeLane={showPlayedTakeLane}
                onTogglePlayedTakeLane={() => setShowPlayedTakeLane(v => !v)}
                theoryAnalysis={theoryAnalysis}
                theoryToggles={theoryToggles}
                onTheoryTogglesChange={setTheoryToggles}
                onTheoryMeasureSelect={(measure) => {
                  setTheoryMeasure(measure);
                  if (measure == null) setHighlightedMeasures([]);
                }}
                theoryContext={theoryContext}
                theoryTabRequestKey={theoryTabRequestKey}
                coachMeasureRange={coachMeasureRange}
                maxCoachMeasure={maxMeasure}
                onCoachMeasureRangeApply={(start, end) => {
                  const boundedStart = Math.max(1, Math.min(maxMeasure, start));
                  const boundedEnd = Math.max(boundedStart, Math.min(maxMeasure, end));
                  setCoachMeasureRange({ start: boundedStart, end: boundedEnd });
                  handleLoopRangeChange(boundedStart, boundedEnd);
                  seekTo((boundedStart - 1) * activeBeatsPerMeasure);
                }}
                onCoachMeasureRangeClear={() => {
                  setCoachMeasureRange(null);
                  handleClearLoop();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Player bar */}
      <PlayerControls
        bpm={playbackBpm}
        isPlaying={isPlaying}
        onBpmChange={setPlaybackBpm}
        source={source}
        canPlayOriginal={canPlayOriginal}
        editorMode={editorMode}
        speed={speed}
        loopEnabled={loopEnabled}
        loopMeasureRegion={loopMeasureRegion}
        totalMeasures={totalMeasures}
        metronomeEnabled={metronomeEnabled}
        metronomeVolume={metronomeVolume}
        onPlayPause={togglePlay}
        onSourceChange={changeSource}
        onSpeedChange={setSpeed}
        onLoopToggle={handleLoopToggle}
        onLoopRangeChange={handleLoopRangeChange}
        onLoopClear={handleClearLoop}
        onMetronomeToggle={toggleMetronome}
        onMetronomeVolumeChange={setMetronomeVolume}
        onEditorToggle={() => {
          setEditorMode(m => {
            if (m) setSelectedNoteId(null);
            return !m;
          });
        }}
      />
    </div>
  );
}
