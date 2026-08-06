"use client";

import { useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, HelpCircle, Loader2, Minus, Plus, SlidersHorizontal } from "lucide-react";
import type {
  PracticeAction,
  PracticeFeedback,
  PracticeFocus,
  PracticeMetrics,
  SongMetrics,
  NoteStatus,
  AlignmentResult,
  TabNote,
  CoachFinding,
  MeasureMastery,
} from "@/types/music";
import { comparePracticeMetrics, rankPracticeActions } from "@/lib/coach-analysis";
import type { MeasureTheoryContext, SongTheoryAnalysis, TheoryOverlayToggles } from "@/lib/theory-analysis";
import AudioRecorder from "@/components/audio/AudioRecorder";
import MiniFretboard from "@/components/practice/MiniFretboard";

type DashboardTab = "record" | "theory" | "ai" | "metrics";

interface StudioDashboardProps {
  songTitle: string;
  artist: string;
  bpm: number;
  onCoachBpmChange?: (bpm: number) => void;
  beatsPerMeasure: number;
  onBeatsPerMeasureChange: (beats: number) => void;
  tabLocked?: boolean;
  onRequestUnlock?: () => void;
  feedback?: PracticeFeedback;
  metrics?: PracticeMetrics;
  songMetrics: SongMetrics;
  isAnalysing: boolean;
  coachError?: string | null;
  showSaveAudioPrompt?: boolean;
  onSaveAudio?: (save: boolean) => void;
  canDownloadLastTake?: boolean;
  onDownloadLastTake?: () => void;
  onExportSynthReference?: () => void;
  isExportingSynth?: boolean;
  audioExportMessage?: string | null;
  audioExportError?: string | null;
  onDeleteSession?: (id: string) => void;
  /** Optional: called when a coach action should be applied to playback. */
  onApplyCoachAction?: (action: { measure?: number; targetBpm?: number }) => void;
  /** Currently active drill (set after Apply). */
  activeDrill?: PracticeAction | null;
  /** Clear the active drill and restore pre-drill state. */
  onClearDrill?: () => void;
  /** Called when the user clicks a chord/shape in the Theory tab to highlight measures. */
  onHighlightMeasures?: (measures: number[]) => void;
  highlightedMeasures?: number[];
  /** Called when the user clicks a coach finding (highlight + optional theory overlay flash). */
  onFindingClick?: (finding: CoachFinding) => void;
  /** Previous take's metrics — shown as a delta card in the AI Coach tab. */
  prevTakeMetrics?: PracticeMetrics | null;
  onCoachMeasureSelect?: (measure: number) => void;
  onCoachPlaybackAction?: (
    action: "reference" | "take" | "compare" | "loop" | "slow" | "record",
    measure?: number,
    targetBpm?: number,
  ) => void;
  onRecordingStart: () => void;
  onRecordingTick?: (elapsedMs: number) => void;
  onRecordingCancel?: () => void;
  onRecordingComplete: (blob: Blob, duration: number) => void;
  onTranscribe: (blob: Blob, duration: number, bpm: number, options?: TranscribeTuning) => void;
  transcribing: boolean;
  transcribeError: string | null;
  transcribeInfo: string | null;
  bpmCandidates?: number[];
  selectedBpm?: number;
  onBpmCandidateSelect?: (bpm: number) => void;
  /** Pass-1 tab notes — enables the optional rhythm pass section. */
  tabNotes?: TabNote[];
  /** Called when the rhythm recording is complete and should be merged. */
  onRhythmRecord?: (blob: Blob, selectedMeasures: number[], bpm: number) => void;
  rhythmMerging?: boolean;
  rhythmMergeError?: string | null;
  rhythmMergeInfo?: string | null;
  /** Optional played-take comparison lane toggle (mirrors tab control). */
  hasCoachRecording?: boolean;
  showPlayedTakeLane?: boolean;
  onTogglePlayedTakeLane?: () => void;
  /** Theory mode — analysis layer + overlay toggles. */
  theoryAnalysis?: SongTheoryAnalysis;
  theoryToggles?: TheoryOverlayToggles;
  onTheoryTogglesChange?: (toggles: TheoryOverlayToggles) => void;
  onTheoryMeasureSelect?: (measure: number | null) => void;
  theoryContext?: MeasureTheoryContext | null;
  theoryTabRequestKey?: number;
  coachMeasureRange?: { start: number; end: number } | null;
  maxCoachMeasure?: number;
  onCoachMeasureRangeApply?: (start: number, end: number) => void;
  onCoachMeasureRangeClear?: () => void;
}

type RecordMode = "transcribe" | "coach";
type TempoMode = "manual" | "auto";

export interface TranscribeTuning {
  detectBpm: boolean;
  beatsPerMeasure: number;
  onsetThreshold: number;
  frameThreshold: number;
  minNoteLenMs: number;
  qualityMode: "fast" | "accurate";
}

const TABS: { id: DashboardTab; label: string }[] = [
  { id: "record", label: "Record" },
  { id: "theory", label: "Theory" },
  { id: "ai", label: "AI Coach" },
  { id: "metrics", label: "Metrics" },
];

const STATUS_COLOR: Record<NoteStatus, string> = {
  correct: "var(--ss-text)",
  early: "#d79f36",
  late: "#38bdf8",
  missed: "#cf4343",
  wrong_note: "#a06cc9",
  unplayed: "var(--ss-text-muted)",
};

const TIME_SIGNATURES = [3, 4, 5, 6, 7] as const;

function ScoreRing({ pct }: { pct: number }) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 80 ? "#238c35" : pct >= 60 ? "#d79f36" : "#cf4343";
  return (
    <div style={{ position: "relative", width: 76, height: 76, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={76} height={76} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
        <circle cx={38} cy={38} r={r} fill="none" stroke="var(--ss-controls-btn)" strokeWidth={5} />
        <motion.circle
          cx={38} cy={38} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeLinecap="round" strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{pct}</span>
        <span style={{ fontSize: 10, color: "var(--ss-text-muted)", display: "block" }}>%</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, color = "var(--ss-text-title)" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: "var(--ss-controls-btn)", borderRadius: 2, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--ss-text-secondary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AlignmentRow({ a }: { a: AlignmentResult }) {
  const color = STATUS_COLOR[a.status];
  const sign = a.timingOffsetMs > 0 ? "+" : "";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--ss-popup-divider)" }}>
      <span style={{ fontSize: 11, color }}>{a.tabNoteId}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {a.confidence && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            color: a.confidence === "high" ? "#238c35" : a.confidence === "medium" ? "#d79f36" : "var(--ss-text-muted)",
          }}>
            {a.confidence}
          </span>
        )}
        {a.status !== "missed" && a.status !== "unplayed" && (
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--ss-text-muted)" }}>{sign}{a.timingOffsetMs}ms</span>
        )}
      </span>
    </div>
  );
}

function CoachActionCard({
  label,
  detail,
  focus,
  onApply,
}: {
  label: string;
  detail: string;
  focus?: PracticeAction["focus"];
  onApply?: () => void;
}) {
  const focusColor = focus === "pitch" || focus === "notes" ? "#a06cc9" : focus === "timing" ? "#d79f36" : "#5376f0";
  const focusLabel = focus === "pitch" ? "notes" : focus ?? null;
  return (
    <div style={{ background: "var(--ss-controls-btn)", border: "1px solid var(--ss-panel-border)", borderRadius: 3, padding: "8px 9px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {focusLabel && (
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: focusColor, marginRight: 5 }}>
              {focusLabel}
            </span>
          )}
          <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 700, color: "var(--ss-text-title)" }}>{label}</p>
        </div>
        {onApply && (
          <button
            onClick={onApply}
            title="Apply to playback"
            style={{
              flexShrink: 0,
              height: 18,
              padding: "0 7px",
              borderRadius: 2,
              border: "1px solid var(--ss-panel-border)",
              background: "var(--ss-controls-btn)",
              color: "var(--ss-text-muted)",
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              cursor: "pointer",
              transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#238c35"; e.currentTarget.style.borderColor = "#238c35"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--ss-text-muted)"; e.currentTarget.style.borderColor = "var(--ss-panel-border)"; }}
          >
            Apply
          </button>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.4, color: "var(--ss-text-muted)" }}>{detail}</p>
    </div>
  );
}

function TheoryChip({
  children,
  active,
  accent = "#ca8a04",
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: 700,
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${active ? accent : "var(--ss-panel-border)"}`,
        background: active ? `${accent}22` : "var(--ss-controls-btn)",
        color: active ? accent : "var(--ss-text-title)",
        cursor: onClick ? "pointer" : "default",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function CoachFindingRow({
  finding,
  onClick,
}: {
  finding: CoachFinding;
  onClick?: (finding: CoachFinding) => void;
}) {
  const color = finding.severity === "high" ? "#cf4343" : finding.severity === "medium" ? "#d79f36" : "var(--ss-text-muted)";
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={clickable ? () => onClick?.(finding) : undefined}
      disabled={!clickable}
      style={{
        display: "flex", gap: 7, alignItems: "flex-start", marginBottom: 5,
        width: "100%", textAlign: "left", padding: "4px 2px", borderRadius: 4,
        background: "transparent", border: "none",
        cursor: clickable ? "pointer" : "default",
      }}
      title={clickable ? `Highlight measure ${finding.measure}` : undefined}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.4, color: "var(--ss-text-secondary)" }}>{finding.message}</p>
        {finding.theoryHint && (
          <span style={{
            display: "inline-block", marginTop: 3, fontSize: 10, fontWeight: 700,
            padding: "1px 6px", borderRadius: 8,
            background: "rgba(202,138,4,0.18)", color: "#ca8a04",
          }}>
            {finding.theoryHint.chord} · M{finding.theoryHint.measure}
          </span>
        )}
      </div>
    </button>
  );
}

export default function StudioDashboard({
  songTitle,
  artist,
  bpm,
  onCoachBpmChange,
  beatsPerMeasure,
  onBeatsPerMeasureChange,
  tabLocked = false,
  onRequestUnlock,
  feedback,
  metrics,
  songMetrics,
  isAnalysing,
  coachError,
  showSaveAudioPrompt,
  onSaveAudio,
  canDownloadLastTake,
  onDownloadLastTake,
  onExportSynthReference,
  isExportingSynth,
  audioExportMessage,
  audioExportError,
  onDeleteSession,
  onApplyCoachAction,
  activeDrill,
  onClearDrill,
  onHighlightMeasures,
  highlightedMeasures = [],
  onFindingClick,
  onRecordingStart,
  onRecordingTick,
  onRecordingCancel,
  onRecordingComplete,
  onTranscribe,
  transcribing,
  transcribeError,
  transcribeInfo,
  bpmCandidates,
  selectedBpm,
  onBpmCandidateSelect,
  tabNotes,
  onRhythmRecord,
  rhythmMerging,
  rhythmMergeError,
  rhythmMergeInfo,
  hasCoachRecording,
  showPlayedTakeLane,
  onTogglePlayedTakeLane,
  theoryAnalysis,
  theoryToggles,
  onTheoryTogglesChange,
  onTheoryMeasureSelect,
  theoryContext,
  theoryTabRequestKey = 0,
  coachMeasureRange,
  maxCoachMeasure = 1,
  onCoachMeasureRangeApply,
  onCoachMeasureRangeClear,
  prevTakeMetrics,
  onCoachMeasureSelect,
  onCoachPlaybackAction,
}: StudioDashboardProps) {
  const [tab, setTab] = useState<DashboardTab>("record");
  const [isRecording, setIsRecording] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [recordMode, setRecordMode] = useState<RecordMode>("transcribe");
  const [tempoMode, setTempoMode] = useState<TempoMode>("auto");
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [recordBpm, setRecordBpm] = useState(bpm);
  const [coachMetronomeEnabled, setCoachMetronomeEnabled] = useState(true);
  const [practiceRangeOpen, setPracticeRangeOpen] = useState(false);
  const [practiceRangeStart, setPracticeRangeStart] = useState(1);
  const [practiceRangeEnd, setPracticeRangeEnd] = useState(maxCoachMeasure);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [onsetThreshold, setOnsetThreshold] = useState(0.38);
  const [frameThreshold, setFrameThreshold] = useState(0.28);
  const [minNoteLenMs, setMinNoteLenMs] = useState(0);
  const [highAccuracy, setHighAccuracy] = useState(false);
  const [practiceFocus, setPracticeFocus] = useState<PracticeFocus>("full");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
  const [selectedMasteryMeasure, setSelectedMasteryMeasure] = useState<number | null>(null);

  const clearTheoryHighlight = useCallback(() => {
    onHighlightMeasures?.([]);
    onTheoryMeasureSelect?.(null);
  }, [onHighlightMeasures, onTheoryMeasureSelect]);

  useEffect(() => {
    if (theoryTabRequestKey <= 0) return;
    // This prop is an explicit navigation request from the tab inspector.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab("theory");
  }, [theoryTabRequestKey]);
  const effectiveRecordBpm = recordMode === "coach"
    ? Math.round(bpm)
    : tempoMode === "auto" ? Math.round(bpm) : recordBpm;

  // Rhythm pass state
  const [rhythmOpen, setRhythmOpen] = useState(false);
  const [selectedMeasures, setSelectedMeasures] = useState<Set<number>>(new Set());

  const availableMeasures = useMemo(() => {
    if (!tabNotes || tabNotes.length === 0) return [];
    const nums = [...new Set(tabNotes.map(n => n.measure))].sort((a, b) => a - b);
    return nums;
  }, [tabNotes]);
  const rankedPracticeActions = useMemo(
    () => rankPracticeActions(feedback?.practiceActions ?? [], practiceFocus),
    [feedback?.practiceActions, practiceFocus],
  );
  const comparison = useMemo(
    () => metrics ? comparePracticeMetrics(metrics, prevTakeMetrics) : null,
    [metrics, prevTakeMetrics],
  );
  const selectedMastery = useMemo(
    () => songMetrics.measureMastery?.find(row => row.measure === selectedMasteryMeasure) ?? null,
    [songMetrics.measureMastery, selectedMasteryMeasure],
  );

  const handleRecordingStart = useCallback(() => {
    setIsRecording(true);
    onRecordingStart();
  }, [onRecordingStart]);

  const handleRecordingComplete = useCallback((blob: Blob, duration: number) => {
    setIsRecording(false);
    if (recordMode === "transcribe") {
      onTranscribe(blob, duration, effectiveRecordBpm, {
        detectBpm: tempoMode === "auto",
        beatsPerMeasure,
        onsetThreshold,
        frameThreshold,
        minNoteLenMs,
        qualityMode: highAccuracy ? "accurate" : "fast",
      });
    } else {
      onRecordingComplete(blob, duration);
      if (aiEnabled) setTab("ai");
    }
  }, [onRecordingComplete, onTranscribe, recordMode, aiEnabled, effectiveRecordBpm, tempoMode, beatsPerMeasure, onsetThreshold, frameThreshold, minNoteLenMs, highAccuracy]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      backgroundColor: "var(--ss-topbar-surface)",
      borderLeft: "1px solid var(--ss-topbar-border)",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px 0",
        borderBottom: "1px solid var(--ss-topbar-border)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ss-text-title)" }}>Studio</span>
          {isRecording && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "#238c35", borderRadius: 10, padding: "2px 7px",
              fontSize: 10, fontWeight: 700, color: "white",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "white" }} />
              LIVE
            </span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--ss-text-muted)", margin: "0 0 10px", lineHeight: 1.4 }}>
          {songTitle} · {artist} · {Math.round(bpm)} BPM
        </p>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => {
                if (t.id !== tab) clearTheoryHighlight();
                setTab(t.id);
              }}
              style={{
                flex: 1,
                padding: "8px 4px",
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.3px",
                color: tab === t.id ? "#238c35" : "var(--ss-text-muted)",
                background: "transparent",
                border: "none",
                borderBottom: tab === t.id ? "2px solid #238c35" : "2px solid transparent",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <AnimatePresence mode="wait">
          {tab === "record" && (
            <motion.div key="record" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Primary recording mode */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
                margin: "14px 16px 0",
                padding: 4,
                borderRadius: 6,
                background: "var(--ss-controls-surface)",
                border: "1px solid var(--ss-panel-border)",
              }}>
                {([
                  { id: "transcribe", label: "Generate Tab" },
                  { id: "coach", label: "Coach Me" },
                ] as { id: RecordMode; label: string }[]).map(m => (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (m.id !== recordMode) clearTheoryHighlight();
                      setRecordMode(m.id);
                    }}
                    style={{
                      minHeight: 36,
                      padding: "7px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.2px",
                      cursor: "pointer",
                      border: recordMode === m.id ? "1px solid var(--ss-success)" : "1px solid transparent",
                      borderRadius: 4,
                      background: recordMode === m.id ? "var(--ss-success)" : "var(--ss-controls-btn)",
                      color: recordMode === m.id ? "white" : "var(--ss-text-muted)",
                      transition: "background 0.15s, color 0.15s, border-color 0.15s",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {recordMode === "transcribe" && (
                <div style={{
                  margin: "12px 16px 0",
                  padding: 12,
                  borderRadius: 6,
                  border: "1px solid var(--ss-panel-border)",
                  background: "var(--ss-controls-surface)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--ss-text-title)" }}>Recording setup</p>
                      <p style={{ margin: "3px 0 0", fontSize: 10, lineHeight: 1.4, color: "var(--ss-text-muted)" }}>Choose how the new tab should be measured.</p>
                    </div>
                    <span style={{
                      padding: "3px 7px", borderRadius: 10, flexShrink: 0,
                      background: "var(--ss-success-soft)", color: "var(--ss-success)",
                      fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.35px",
                    }}>
                      {tempoMode === "auto" ? "Auto tempo" : `${recordBpm} BPM`}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                    {([
                      { id: "auto", label: "Auto BPM", detail: "Detect from audio" },
                      { id: "manual", label: "Manual", detail: "Set exact tempo" },
                    ] as { id: TempoMode; label: string; detail: string }[]).map(m => (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (m.id === "manual") setRecordBpm(Math.round(bpm));
                          setTempoMode(m.id);
                        }}
                        disabled={isRecording}
                        style={{
                          minHeight: 42,
                          padding: "6px 8px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: isRecording ? "not-allowed" : "pointer",
                          border: `1px solid ${tempoMode === m.id ? "var(--ss-accent)" : "var(--ss-panel-border)"}`,
                          borderRadius: 4,
                          background: tempoMode === m.id ? "var(--ss-accent-soft)" : "var(--ss-controls-btn)",
                          color: tempoMode === m.id ? "var(--ss-accent)" : "var(--ss-text-muted)",
                          opacity: isRecording ? 0.6 : 1,
                        }}
                      >
                        <span style={{ display: "block" }}>{m.label}</span>
                        <span style={{ display: "block", marginTop: 2, fontSize: 9, fontWeight: 500 }}>{m.detail}</span>
                      </button>
                    ))}
                  </div>

                  {tempoMode === "auto" ? (
                    <div style={{
                      padding: "10px 11px",
                      marginTop: 10, borderRadius: 4, background: "var(--ss-accent-soft)",
                      border: "1px solid var(--ss-accent-border)",
                    }}>
                      <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ss-text)" }}>
                        Start playing when ready. Tempo is detected from the recording.
                      </span>
                    </div>
                  ) : (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      padding: "9px 10px", marginTop: 10, borderRadius: 4,
                      background: "var(--ss-controls-btn)", border: "1px solid var(--ss-panel-border)",
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ss-text-secondary)" }}>Recording tempo</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <button
                          type="button"
                          title="Decrease BPM"
                          onClick={() => setRecordBpm(value => Math.max(40, value - 1))}
                          disabled={isRecording}
                          style={{
                            width: 26, height: 26, borderRadius: 3, border: "1px solid var(--ss-panel-border)",
                            background: "var(--ss-controls-surface)", color: "var(--ss-text-title)",
                            cursor: isRecording ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Minus size={13} />
                        </button>
                        <input
                          aria-label="Manual recording BPM"
                          type="number"
                          min={40}
                          max={240}
                          value={recordBpm}
                          disabled={isRecording}
                          onChange={event => {
                            const value = Number.parseInt(event.target.value, 10);
                            if (Number.isFinite(value)) setRecordBpm(Math.min(240, Math.max(40, value)));
                          }}
                          style={{
                            width: 50, height: 26, textAlign: "center", borderRadius: 3, outline: "none",
                            border: "1px solid var(--ss-panel-border)", background: "var(--ss-controls-surface)",
                            color: "var(--ss-text-title)", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                            MozAppearance: "textfield",
                          } as React.CSSProperties}
                        />
                        <button
                          type="button"
                          title="Increase BPM"
                          onClick={() => setRecordBpm(value => Math.min(240, value + 1))}
                          disabled={isRecording}
                          style={{
                            width: 26, height: 26, borderRadius: 3, border: "1px solid var(--ss-panel-border)",
                            background: "var(--ss-controls-surface)", color: "var(--ss-text-title)",
                            cursor: isRecording ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Plus size={13} />
                        </button>
                        <span style={{ fontSize: 9, color: "var(--ss-text-muted)" }}>BPM</span>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ss-text-secondary)", textTransform: "uppercase", letterSpacing: "0.35px" }}>Time signature</span>
                      <span style={{ fontSize: 9, color: "var(--ss-text-muted)" }}>{beatsPerMeasure} beats per bar</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${TIME_SIGNATURES.length}, 1fr)`, gap: 4 }}>
                        {TIME_SIGNATURES.map(beats => (
                          <button
                            key={beats}
                            type="button"
                            onClick={() => {
                              if (tabLocked) {
                                setShowUnlockPrompt(true);
                                return;
                              }
                              onBeatsPerMeasureChange(beats);
                            }}
                            disabled={isRecording}
                            style={{
                              height: 30,
                              padding: 0,
                              fontSize: 10,
                              fontWeight: 700,
                              fontVariantNumeric: "tabular-nums",
                              cursor: isRecording ? "not-allowed" : "pointer",
                              border: `1px solid ${beatsPerMeasure === beats ? "#5376f0" : "var(--ss-panel-border)"}`,
                              borderRadius: 3,
                              background: beatsPerMeasure === beats ? "#5376f0" : "var(--ss-controls-btn)",
                              color: beatsPerMeasure === beats ? "white" : "var(--ss-text-muted)",
                              opacity: isRecording ? 0.6 : 1,
                            }}
                          >
                            {beats}/4
                          </button>
                        ))}
                      </div>
                    </div>

                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen(o => !o)}
                      style={{
                        width: "100%",
                        height: 32,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        background: "var(--ss-controls-btn)",
                        border: "1px solid var(--ss-panel-border)",
                        borderRadius: 3,
                        color: "var(--ss-text-muted)",
                        cursor: "pointer",
                        padding: "0 9px",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                        <SlidersHorizontal size={13} />
                        Advanced
                      </span>
                      <span style={{ fontSize: 12 }}>{advancedOpen ? "-" : "+"}</span>
                    </button>
                    <AnimatePresence>
                      {advancedOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          style={{ overflow: "hidden" }}
                        >
                          <div style={{ padding: "12px 2px 2px", display: "grid", gap: 11 }}>
                            <label style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              paddingBottom: 8,
                              borderBottom: "1px solid var(--ss-panel-border)",
                              cursor: isRecording ? "default" : "pointer",
                            }}>
                              <span>
                                <span style={{ display: "block", fontSize: 11, color: "var(--ss-text-title)", fontWeight: 600 }}>
                                  High accuracy
                                </span>
                                <span style={{ display: "block", marginTop: 2, fontSize: 10, color: "var(--ss-text-muted)" }}>
                                  Slower two-pass detection for quiet or short notes.
                                </span>
                              </span>
                              <input
                                type="checkbox"
                                checked={highAccuracy}
                                disabled={isRecording}
                                onChange={event => setHighAccuracy(event.target.checked)}
                              />
                            </label>
                            {[
                              {
                                label: "Onset",
                                value: onsetThreshold,
                                min: 0.2,
                                max: 0.7,
                                step: 0.01,
                                format: (v: number) => v.toFixed(2),
                                set: setOnsetThreshold,
                              },
                              {
                                label: "Frame",
                                value: frameThreshold,
                                min: 0.1,
                                max: 0.6,
                                step: 0.01,
                                format: (v: number) => v.toFixed(2),
                                set: setFrameThreshold,
                              },
                              {
                                label: "Min note",
                                value: minNoteLenMs,
                                min: 0,
                                max: 140,
                                step: 5,
                                format: (v: number) => v === 0 ? "Auto" : `${Math.round(v)}ms`,
                                set: setMinNoteLenMs,
                              },
                            ].map(control => (
                              <label key={control.label} style={{ display: "grid", gridTemplateColumns: "62px 1fr 44px", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>{control.label}</span>
                                <input
                                  type="range"
                                  className="ss-range"
                                  min={control.min}
                                  max={control.max}
                                  step={control.step}
                                  value={control.value}
                                  onChange={e => control.set(Number(e.target.value))}
                                  style={{ width: "100%" }}
                                />
                                <span style={{ fontSize: 11, color: "var(--ss-text-title)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                  {control.format(control.value)}
                                </span>
                              </label>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {recordMode === "coach" && (
                <div style={{
                  margin: "12px 16px 0",
                  padding: "12px",
                  borderRadius: 6,
                  border: "1px solid var(--ss-panel-border)",
                  background: "var(--ss-controls-surface)",
                }}>
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--ss-text-title)" }}>Coach setup</p>
                    <p style={{ margin: "3px 0 0", fontSize: 10, lineHeight: 1.4, color: "var(--ss-text-muted)" }}>Configure the take before recording.</p>
                  </div>
                  <div style={{
                    marginBottom: 11, borderBottom: "1px solid var(--ss-panel-border)", paddingBottom: 11,
                  }}>
                    <button
                      type="button"
                      aria-expanded={practiceRangeOpen}
                      onClick={() => {
                        const next = !practiceRangeOpen;
                        if (next) {
                          setPracticeRangeStart(coachMeasureRange?.start ?? 1);
                          setPracticeRangeEnd(coachMeasureRange?.end ?? maxCoachMeasure);
                        }
                        setPracticeRangeOpen(next);
                      }}
                      disabled={isRecording || isAnalysing}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "7px 8px", borderRadius: 4, textAlign: "left",
                        border: "1px solid var(--ss-panel-border)", background: "var(--ss-controls-btn)",
                        color: "var(--ss-text-title)", cursor: isRecording || isAnalysing ? "not-allowed" : "pointer",
                        opacity: isRecording || isAnalysing ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.35px", color: "#8eaaff" }}>
                        Practice range
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        M{coachMeasureRange?.start ?? 1}–{coachMeasureRange?.end ?? maxCoachMeasure}
                      </span>
                      <ChevronDown
                        size={13}
                        style={{ transform: practiceRangeOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
                      />
                    </button>
                    {practiceRangeOpen && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 7, alignItems: "center", paddingTop: 8 }}>
                        <input
                          aria-label="Coach range start measure"
                          type="number"
                          min={1}
                          max={maxCoachMeasure}
                          value={practiceRangeStart}
                          disabled={isRecording || isAnalysing}
                          onChange={event => setPracticeRangeStart(Math.max(1, Math.min(maxCoachMeasure, Number(event.target.value) || 1)))}
                          style={{
                            minWidth: 0, height: 28, borderRadius: 3, textAlign: "center",
                            border: "1px solid var(--ss-panel-border)", background: "var(--ss-surface)",
                            color: "var(--ss-text-title)", fontSize: 12, fontWeight: 700,
                          }}
                        />
                        <span style={{ fontSize: 10, color: "var(--ss-text-muted)" }}>to</span>
                        <input
                          aria-label="Coach range end measure"
                          type="number"
                          min={1}
                          max={maxCoachMeasure}
                          value={practiceRangeEnd}
                          disabled={isRecording || isAnalysing}
                          onChange={event => setPracticeRangeEnd(Math.max(1, Math.min(maxCoachMeasure, Number(event.target.value) || 1)))}
                          style={{
                            minWidth: 0, height: 28, borderRadius: 3, textAlign: "center",
                            border: "1px solid var(--ss-panel-border)", background: "var(--ss-surface)",
                            color: "var(--ss-text-title)", fontSize: 12, fontWeight: 700,
                          }}
                        />
                        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <button
                            type="button"
                            disabled={isRecording || isAnalysing}
                            onClick={() => {
                              const start = Math.min(practiceRangeStart, practiceRangeEnd);
                              const end = Math.max(practiceRangeStart, practiceRangeEnd);
                              onCoachMeasureRangeApply?.(start, end);
                              setPracticeRangeOpen(false);
                            }}
                            style={{
                              padding: "4px 10px", borderRadius: 3, border: "none",
                              background: "#5376f0", color: "white", fontSize: 10, fontWeight: 800,
                              cursor: isRecording || isAnalysing ? "not-allowed" : "pointer",
                            }}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            disabled={isRecording || isAnalysing}
                            onClick={() => {
                              onCoachMeasureRangeClear?.();
                              setPracticeRangeOpen(false);
                            }}
                            style={{
                              padding: "4px 9px", borderRadius: 3,
                              border: "1px solid var(--ss-panel-border)", background: "transparent",
                              color: "var(--ss-text-muted)", fontSize: 10, fontWeight: 700,
                              cursor: isRecording || isAnalysing ? "not-allowed" : "pointer",
                            }}
                          >
                            All
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                    paddingBottom: 11, marginBottom: 11, borderBottom: "1px solid var(--ss-panel-border)",
                  }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--ss-text-title)" }}>AI Coach analysis</p>
                      <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--ss-text-muted)" }}>Open feedback when the take finishes.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aiEnabled}
                      onClick={() => setAiEnabled(value => !value)}
                      disabled={isRecording}
                      style={{
                        position: "relative", width: 40, height: 22, borderRadius: 11, border: "none",
                        background: aiEnabled ? "#238c35" : "var(--ss-controls-btn)",
                        cursor: isRecording ? "not-allowed" : "pointer", opacity: isRecording ? 0.6 : 1, flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: "absolute", top: 3, left: aiEnabled ? 21 : 3,
                        width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s",
                      }} />
                    </button>
                  </div>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 12,
                  }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--ss-text-title)" }}>
                        Recording metronome
                      </p>
                      <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--ss-text-muted)", lineHeight: 1.35 }}>
                        {coachMetronomeEnabled ? "Two-bar count-in, then clicks through the take." : "Off — recording starts immediately."}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={coachMetronomeEnabled}
                      onClick={() => setCoachMetronomeEnabled(enabled => !enabled)}
                      disabled={isRecording}
                      style={{
                        position: "relative",
                        width: 40,
                        height: 22,
                        borderRadius: 11,
                        border: "none",
                        background: coachMetronomeEnabled ? "#238c35" : "var(--ss-controls-btn)",
                        cursor: isRecording ? "not-allowed" : "pointer",
                        opacity: isRecording ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: "absolute",
                        top: 3,
                        left: coachMetronomeEnabled ? 21 : 3,
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "white",
                        transition: "left 0.2s",
                      }} />
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--ss-text-muted)", marginRight: "auto" }}>Take tempo</span>
                    <button
                      type="button"
                      title="Decrease Coach BPM"
                      onClick={() => onCoachBpmChange?.(Math.max(40, Math.round(bpm) - 1))}
                      disabled={isRecording}
                      style={{
                        width: 26, height: 26, borderRadius: 3,
                        background: "var(--ss-controls-btn)", border: "1px solid var(--ss-panel-border)",
                        color: "var(--ss-text-title)", cursor: isRecording ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <Minus size={13} />
                    </button>
                    <input
                      aria-label="Coach recording BPM"
                      type="number"
                      min={40}
                      max={240}
                      value={Math.round(bpm)}
                      disabled={isRecording}
                      onChange={event => {
                        const value = Number.parseInt(event.target.value, 10);
                        if (Number.isFinite(value)) onCoachBpmChange?.(Math.min(240, Math.max(40, value)));
                      }}
                      style={{
                        width: 54,
                        height: 26,
                        textAlign: "center",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--ss-text-title)",
                        background: "var(--ss-controls-btn)",
                        border: "1px solid var(--ss-panel-border)",
                        borderRadius: 3,
                        outline: "none",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    />
                    <button
                      type="button"
                      title="Increase Coach BPM"
                      onClick={() => onCoachBpmChange?.(Math.min(240, Math.round(bpm) + 1))}
                      disabled={isRecording}
                      style={{
                        width: 26, height: 26, borderRadius: 3,
                        background: "var(--ss-controls-btn)", border: "1px solid var(--ss-panel-border)",
                        color: "var(--ss-text-title)", cursor: isRecording ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <Plus size={13} />
                    </button>
                    <span style={{ width: 25, fontSize: 10, color: "var(--ss-text-muted)" }}>BPM</span>
                  </div>
                </div>
              )}

              <AudioRecorder
                onRecordingStart={handleRecordingStart}
                onRecordingTick={recordMode === "coach" ? onRecordingTick : undefined}
                onRecordingCancel={onRecordingCancel}
                onRecordingComplete={handleRecordingComplete}
                disabled={isAnalysing || transcribing}
                countInBeats={
                  recordMode === "coach"
                    ? coachMetronomeEnabled ? beatsPerMeasure * 2 : 0
                    : beatsPerMeasure * 2
                }
                bpm={effectiveRecordBpm}
                beatsPerMeasure={beatsPerMeasure}
                metronomeDuringRecording={recordMode === "coach" && coachMetronomeEnabled}
                idleLabel={recordMode === "transcribe" ? "Record a riff" : "Record your take"}
                idleDescription={
                  recordMode === "transcribe"
                    ? tempoMode === "auto"
                      ? `Auto BPM · ${effectiveRecordBpm} BPM count-in · ${beatsPerMeasure}/4`
                      : `${effectiveRecordBpm} BPM · ${beatsPerMeasure}/4 · two-bar count-in`
                    : coachMetronomeEnabled
                      ? `${effectiveRecordBpm} BPM · two-bar count-in · metronome on`
                      : `${effectiveRecordBpm} BPM · starts immediately`
                }
              />

              {/* Transcription status */}
              {transcribing && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 16px 12px", color: "#60a5fa" }}>
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  <span style={{ fontSize: 12 }}>Transcribing your playing…</span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              )}
              {transcribeInfo && !transcribing && (
                <div style={{ padding: "0 16px 12px", textAlign: "center" }}>
                  <span style={{ fontSize: 12, color: "#238c35", fontWeight: 600 }}>{transcribeInfo} — see the tab on the left.</span>
                  {bpmCandidates && bpmCandidates.length > 1 && onBpmCandidateSelect && (
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {bpmCandidates.map(candidate => {
                        const active = Math.round(candidate) === Math.round(selectedBpm ?? 0);
                        return (
                          <button
                            key={candidate}
                            type="button"
                            onClick={() => {
                              setRecordBpm(Math.round(candidate));
                              onBpmCandidateSelect(candidate);
                            }}
                            disabled={transcribing}
                            style={{
                              minWidth: 42,
                              height: 24,
                              borderRadius: 3,
                              border: `1px solid ${active ? "#238c35" : "var(--ss-panel-border)"}`,
                              background: active ? "rgba(35,140,53,0.2)" : "var(--ss-controls-btn)",
                              color: active ? "#238c35" : "var(--ss-text-secondary)",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {Math.round(candidate)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {transcribeError && !transcribing && (
                <div style={{ margin: "0 16px 12px", padding: "8px 10px", borderRadius: 4, background: "rgba(229,62,62,0.08)" }}>
                  <span style={{ fontSize: 11, color: "#e57373", lineHeight: 1.4 }}>{transcribeError}</span>
                </div>
              )}

              <div style={{ padding: "12px 16px 14px" }}>
                <p style={{ fontSize: 11, color: "var(--ss-text-muted)", lineHeight: 1.5, margin: 0 }}>
                  {recordMode === "transcribe"
                    ? "Play cleanly and leave a short gap before and after the riff. You can review detected tempo candidates when transcription finishes."
                    : "Play against the known tab. The Coach will align pitch and timing, highlight expected-note outcomes, and suggest what to practice next."}
                </p>
              </div>

              {/* ── Optional rhythm pass ── */}
              {recordMode === "transcribe" && availableMeasures.length > 0 && (
                <div style={{ borderTop: "1px solid var(--ss-panel-border)" }}>
                  {/* Accordion header */}
                  <button
                    onClick={() => setRhythmOpen(o => !o)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 16px", background: "transparent", border: "none",
                      cursor: "pointer", color: "var(--ss-text-muted)",
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                      Re-time Measures
                    </span>
                    <span style={{ fontSize: 10, color: "var(--ss-text-muted)" }}>optional</span>
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="var(--ss-text-muted)" strokeWidth="1.5" strokeLinecap="round"
                      style={{ transform: rhythmOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", marginLeft: 6 }}
                    >
                      <polyline points="1,1 5,5 9,1" />
                    </svg>
                  </button>

                  <AnimatePresence>
                    {rhythmOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: "hidden" }}
                      >
                        <div style={{ padding: "0 16px 12px" }}>
                          <p style={{ fontSize: 11, color: "var(--ss-text-secondary)", lineHeight: 1.5, margin: "0 0 8px" }}>
                            Play the rhythm only (any pitch) for the selected measures. A 2-measure click-track plays first. Your timing replaces pass-1 timing for those measures.
                          </p>

                          {/* Measure checkboxes */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                            {availableMeasures.map(m => {
                              const sel = selectedMeasures.has(m);
                              return (
                                <button
                                  key={m}
                                  onClick={() => setSelectedMeasures(prev => {
                                    const next = new Set(prev);
                                    if (next.has(m)) next.delete(m); else next.add(m);
                                    return next;
                                  })}
                                  style={{
                                    padding: "3px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600,
                                    border: `1px solid ${sel ? "#238c35" : "var(--ss-panel-border)"}`,
                                    background: sel ? "rgba(35,140,53,0.15)" : "var(--ss-controls-btn)",
                                    color: sel ? "#238c35" : "var(--ss-text-muted)",
                                    cursor: "pointer",
                                  }}
                                >
                                  M{m}
                                </button>
                              );
                            })}
                            <button
                              onClick={() => setSelectedMeasures(new Set(availableMeasures))}
                              style={{
                                padding: "3px 8px", borderRadius: 3, fontSize: 10,
                                border: "1px solid var(--ss-panel-border)", background: "transparent",
                                color: "var(--ss-text-muted)", cursor: "pointer",
                              }}
                            >
                              All
                            </button>
                            <button
                              onClick={() => setSelectedMeasures(new Set())}
                              style={{
                                padding: "3px 8px", borderRadius: 3, fontSize: 10,
                                border: "1px solid var(--ss-panel-border)", background: "transparent",
                                color: "var(--ss-text-muted)", cursor: "pointer",
                              }}
                            >
                              None
                            </button>
                          </div>

                          {/* Rhythm recorder (with 8-beat count-in) */}
                          {selectedMeasures.size > 0 && (
                            <AudioRecorder
                              countInBeats={8}
                              bpm={effectiveRecordBpm}
                              disabled={rhythmMerging}
                              onRecordingStart={() => undefined}
                              onRecordingCancel={() => undefined}
                              onRecordingComplete={(blob) => {
                                onRhythmRecord?.(blob, Array.from(selectedMeasures).sort((a, b) => a - b), effectiveRecordBpm);
                              }}
                            />
                          )}

                          {rhythmMerging && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#60a5fa", fontSize: 12 }}>
                              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                              Merging rhythm…
                            </div>
                          )}
                          {rhythmMergeInfo && !rhythmMerging && (
                            <p style={{ fontSize: 12, color: "#238c35", fontWeight: 600, margin: "4px 0 0" }}>{rhythmMergeInfo}</p>
                          )}
                          {rhythmMergeError && !rhythmMerging && (
                            <p style={{ fontSize: 11, color: "#e57373", lineHeight: 1.4, margin: "4px 0 0" }}>{rhythmMergeError}</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}

          {tab === "theory" && theoryAnalysis && theoryToggles && onTheoryTogglesChange && (
            <motion.div key="theory" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: 14, overflowY: "auto", maxHeight: "calc(100vh - 200px)" }}>
              {/* Key — one glance */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                marginBottom: 14, padding: "12px 14px", borderRadius: 8,
                background: "rgba(202,138,4,0.1)", border: "1px solid rgba(202,138,4,0.28)",
              }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#ca8a04", marginBottom: 2 }}>Key</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--ss-text-title)", lineHeight: 1.1 }}>
                    {theoryAnalysis.key} <span style={{ fontWeight: 500, fontSize: 16, color: "var(--ss-text-secondary)" }}>{theoryAnalysis.mode}</span>
                  </div>
                </div>
                {highlightedMeasures.length > 0 && (
                  <button
                    type="button"
                    onClick={clearTheoryHighlight}
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "5px 8px",
                      borderRadius: 5,
                      border: "1px solid rgba(202,138,4,0.42)",
                      background: "rgba(202,138,4,0.12)",
                      color: "#d79f36",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Clear tab highlight
                  </button>
                )}
                {theoryAnalysis.keyChanges[0] && (
                  <button
                    type="button"
                    onClick={() => onHighlightMeasures?.([theoryAnalysis.keyChanges[0].measure])}
                    style={{
                      fontSize: 10, fontWeight: 600, padding: "5px 8px", borderRadius: 5, maxWidth: 120,
                      border: "1px solid rgba(155,143,215,0.4)", background: "rgba(155,143,215,0.12)",
                      color: "#9b8fd7", cursor: "pointer", textAlign: "left", lineHeight: 1.3,
                    }}
                    title={theoryAnalysis.keyChanges[0].label}
                  >
                    Shift @ M{theoryAnalysis.keyChanges[0].measure}
                  </button>
                )}
              </div>

              {/* Inspect — the main job of this panel */}
              {theoryContext ? (
                <div style={{
                  marginBottom: 14, padding: "12px 14px", borderRadius: 8,
                  background: "var(--ss-controls-btn)", border: "1px solid var(--ss-panel-border)",
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ss-text-muted)" }}>
                      Measure {theoryContext.measure}
                    </span>
                    {onTheoryMeasureSelect && (
                      <button
                        type="button"
                        onClick={() => onTheoryMeasureSelect(null)}
                        style={{ fontSize: 10, color: "var(--ss-text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 28, fontWeight: 700, color: "#ca8a04", lineHeight: 1 }}>{theoryContext.chord}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ss-text-title)" }}>{theoryContext.roman}</div>
                      <div style={{ fontSize: 11, color: "var(--ss-text-secondary)" }}>{theoryContext.function}</div>
                    </div>
                    {showUnlockPrompt && (
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                        marginTop: 7, padding: "7px 9px", borderRadius: 4,
                        background: "rgba(202,138,4,0.1)", border: "1px solid rgba(202,138,4,0.32)",
                      }}>
                        <span style={{ fontSize: 10, color: "var(--ss-text-secondary)" }}>
                          Unlock the tab to change its time signature.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onRequestUnlock?.();
                            setShowUnlockPrompt(false);
                          }}
                          style={{
                            flexShrink: 0, padding: "3px 8px", borderRadius: 3,
                            border: "1px solid rgba(202,138,4,0.55)", background: "transparent",
                            color: "#d79f36", fontSize: 9, fontWeight: 800, cursor: "pointer",
                            textTransform: "uppercase",
                          }}
                        >
                          Unlock
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{
                    margin: "-2px 0 9px",
                    fontSize: 10,
                    color: "var(--ss-text-muted)",
                    lineHeight: 1.4,
                  }}>
                    Inferred from the written pitches · {theoryContext.confidence} confidence
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, marginBottom: 8,
                    background: "rgba(155,143,215,0.1)", border: "1px solid rgba(155,143,215,0.25)",
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "#9b8fd7" }}>Play over</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ss-text-title)" }}>{theoryContext.improvScale}</span>
                  </div>
                  {theoryContext.relatedMeasures.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onHighlightMeasures?.([theoryContext.measure, ...theoryContext.relatedMeasures])}
                      style={{
                        width: "100%", fontSize: 11, fontWeight: 600, padding: "7px 10px", borderRadius: 5,
                        border: "1px solid rgba(202,138,4,0.35)", background: "rgba(202,138,4,0.1)",
                        color: "#ca8a04", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      Show same shape · M{[theoryContext.measure, ...theoryContext.relatedMeasures].join(", ")}
                    </button>
                  )}
                  {theoryContext.alternativeVoicings.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onHighlightMeasures?.(
                        theoryContext.alternativeVoicings.flatMap(voicing => voicing.measures),
                      )}
                      style={{
                        width: "100%", marginTop: 6, fontSize: 11, fontWeight: 700,
                        padding: "7px 10px", borderRadius: 5, textAlign: "left",
                        border: "1px solid rgba(202,138,4,0.42)",
                        background: "var(--ss-controls-surface)",
                        color: "#ca8a04", cursor: "pointer",
                      }}
                    >
                      Show {theoryContext.alternativeVoicings.length} alternative chord pattern{theoryContext.alternativeVoicings.length === 1 ? "" : "s"} ›
                    </button>
                  )}
                </div>
              ) : (
                <div style={{
                  marginBottom: 14, padding: "14px", borderRadius: 8, textAlign: "center",
                  border: "1px dashed var(--ss-panel-border)", background: "transparent",
                }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ss-text-title)" }}>Inspect a measure</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--ss-text-muted)", lineHeight: 1.4 }}>
                    Click a gold theory label on the tab to inspect its chord, confidence, and alternative patterns.
                  </p>
                </div>
              )}

              {/* Chords in this song */}
              {(() => {
                const seen = new Map<string, number[]>();
                for (const m of theoryAnalysis.measures) {
                  if (!m.chord || m.chord === "?") continue;
                  const list = seen.get(m.chord) ?? [];
                  list.push(m.measure);
                  seen.set(m.chord, list);
                }
                const chords = [...seen.entries()];
                if (chords.length === 0) return null;
                return (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ss-text-muted)", marginBottom: 8 }}>
                      Chords in this song
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {chords.map(([chord, measures]) => (
                        <TheoryChip
                          key={chord}
                          onClick={() => onHighlightMeasures?.(measures)}
                          active={theoryContext?.chord === chord}
                        >
                          {chord}
                          <span style={{ fontWeight: 500, opacity: 0.65, marginLeft: 5 }}>{measures.length}</span>
                        </TheoryChip>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Progressions */}
              {theoryAnalysis.progressions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ss-text-muted)", marginBottom: 8 }}>
                    Progressions
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {theoryAnalysis.progressions.slice(0, 4).map(p => (
                      <button
                        key={p.numerals + p.measures.join("-")}
                        type="button"
                        onClick={() => onHighlightMeasures?.(p.measures)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                          padding: "9px 11px", borderRadius: 6, textAlign: "left", cursor: "pointer",
                          background: "var(--ss-controls-btn)", border: "1px solid var(--ss-panel-border)",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#9b8fd7", letterSpacing: "0.3px" }}>{p.numerals}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ss-text-muted)", flexShrink: 0 }}>
                          M{p.measures[0]}–{p.measures[p.measures.length - 1]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Shapes with mini fretboards */}
              {theoryAnalysis.recurringShapes.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ss-text-muted)", marginBottom: 8 }}>
                    Shapes · tap to find on tab
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {theoryAnalysis.recurringShapes.slice(0, 5).map((rs, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onHighlightMeasures?.(rs.measures)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 10px", borderRadius: 6, textAlign: "left", cursor: "pointer",
                          background: "var(--ss-controls-btn)", border: "1px solid var(--ss-panel-border)",
                        }}
                      >
                        <MiniFretboard positions={rs.shape.positions} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#ca8a04" }}>{rs.shape.label}</div>
                          <div style={{ fontSize: 10, color: "var(--ss-text-muted)", marginTop: 2 }}>
                            {rs.measures.length} place{rs.measures.length === 1 ? "" : "s"} · M{rs.measures.slice(0, 4).join(", ")}
                            {rs.measures.length > 4 ? "…" : ""}
                          </div>
                        </div>
                        <ChevronRight size={14} color="var(--ss-text-muted)" style={{ flexShrink: 0 }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {tab === "ai" && (
            <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Color legend + played take live on the Tab Layer above the staff */}

              {isAnalysing ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 16px", color: "var(--ss-text-muted)" }}>
                  <Loader2 size={18} color="#238c35" style={{ animation: "spin 1s linear infinite" }} />
                  <span style={{ fontSize: 12 }}>Aligning notes to tablature…</span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              ) : coachError ? (
                <div style={{ margin: "20px 16px", padding: "12px 14px", borderRadius: 4, background: "rgba(229,62,62,0.08)", border: "1px solid rgba(229,62,62,0.18)" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "#e57373" }}>Coach transcription failed</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#a07070", lineHeight: 1.5 }}>{coachError}</p>
                </div>
              ) : !metrics || !aiEnabled ? (
                <div style={{ padding: "32px 16px", textAlign: "center" }}>
                  <p style={{ fontSize: 12, color: "var(--ss-text-muted)", lineHeight: 1.5 }}>
                    {!aiEnabled
                      ? "Turn on AI analysis to get note-by-note feedback after recording."
                      : "Record a take to see accuracy, timing, and coaching tips."}
                  </p>
                </div>
              ) : (
                <div style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                    <ScoreRing pct={metrics.accuracyPercent} />
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ss-text-title)", margin: "0 0 4px" }}>Overall result</p>
                      <p style={{ fontSize: 11, color: "var(--ss-text-muted)", margin: 0, lineHeight: 1.4 }}>
                        {metrics.accuracyPercent >= 80 ? "Great take — push tempo next." : metrics.accuracyPercent >= 60 ? `Solid — tighten measure ${metrics.weakestMeasure}.` : `Slow down and isolate measure ${metrics.weakestMeasure}.`}
                      </p>
                    </div>
                  </div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, marginBottom: 16,
                    border: "1px solid var(--ss-panel-border)", borderRadius: 4, overflow: "hidden",
                    background: "var(--ss-panel-border)",
                  }}>
                    <div style={{ background: "var(--ss-controls-surface)", padding: "11px 12px" }}>
                      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.45px", color: "var(--ss-text-muted)" }}>Timing</div>
                      <div style={{ marginTop: 4, fontSize: 17, fontWeight: 700, color: metrics.timingDriftMs <= 80 ? "#238c35" : "#d79f36" }}>{metrics.timingDriftMs}ms</div>
                      <div style={{ marginTop: 2, fontSize: 10, color: "var(--ss-text-secondary)" }}>average drift</div>
                    </div>
                    <div style={{ background: "var(--ss-controls-surface)", padding: "11px 12px" }}>
                      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.45px", color: "var(--ss-text-muted)" }}>Pitch coverage</div>
                      <div style={{ marginTop: 4, fontSize: 17, fontWeight: 700, color: (metrics.pitchCoveragePercent ?? 0) >= 80 ? "#238c35" : "#a06cc9" }}>{metrics.pitchCoveragePercent ?? metrics.accuracyPercent}%</div>
                      <div style={{ marginTop: 2, fontSize: 10, color: "var(--ss-text-secondary)" }}>expected pitches supported</div>
                    </div>
                  </div>

                  {metrics.measureResults && metrics.measureResults.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)" }}>Measure map</span>
                        <span style={{ fontSize: 10, color: "var(--ss-text-muted)" }}>tap to locate</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(34px, 1fr))", gap: 4 }}>
                        {metrics.measureResults.map(result => {
                          const color = result.accuracyPercent >= 85 ? "#238c35" : result.accuracyPercent >= 60 ? "#d79f36" : "#cf4343";
                          return (
                            <button
                              key={result.measure}
                              type="button"
                              onClick={() => onCoachMeasureSelect?.(result.measure)}
                              title={`Measure ${result.measure}: ${result.accuracyPercent}% accuracy, ${result.timingDriftMs}ms timing`}
                              style={{
                                height: 30, borderRadius: 3, cursor: onCoachMeasureSelect ? "pointer" : "default",
                                border: result.measure === metrics.weakestMeasure ? `1px solid ${color}` : "1px solid var(--ss-panel-border)",
                                background: `${color}20`, color, fontSize: 10, fontWeight: 700,
                              }}
                            >
                              M{result.measure}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {comparison && (
                    <div style={{
                      padding: "10px 12px", borderRadius: 4, marginBottom: 14,
                      background: comparison.verdict === "improved" ? "rgba(35,140,53,0.08)" : comparison.verdict === "repeat" ? "rgba(207,67,67,0.07)" : "var(--ss-controls-surface)",
                      border: `1px solid ${comparison.verdict === "improved" ? "rgba(35,140,53,0.28)" : comparison.verdict === "repeat" ? "rgba(207,67,67,0.24)" : "var(--ss-panel-border)"}`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: comparison.verdict === "improved" ? "#238c35" : comparison.verdict === "repeat" ? "#cf4343" : "#d79f36", textTransform: "capitalize" }}>
                          {comparison.verdict}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--ss-text-muted)" }}>vs previous take</span>
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 10, color: "var(--ss-text-secondary)" }}>
                        <span>Accuracy {comparison.accuracyDelta > 0 ? "+" : ""}{comparison.accuracyDelta}%</span>
                        <span>Timing {comparison.timingDeltaMs > 0 ? "+" : ""}{comparison.timingDeltaMs}ms</span>
                        <span>Coverage {comparison.pitchCoverageDelta > 0 ? "+" : ""}{comparison.pitchCoverageDelta}%</span>
                      </div>
                    </div>
                  )}

                  {/* Save recording prompt */}
                  {showSaveAudioPrompt && onSaveAudio && (
                    <div style={{
                      margin: "0 0 14px",
                      padding: "10px 12px",
                      borderRadius: 4,
                      background: "rgba(35,140,53,0.07)",
                      border: "1px solid rgba(35,140,53,0.22)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}>
                      <span style={{ fontSize: 11, color: "var(--ss-text-muted)", flex: 1, lineHeight: 1.4 }}>
                        Save this audio recording?
                      </span>
                      <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                        <button
                          onClick={() => onSaveAudio(true)}
                          style={{
                            height: 22, padding: "0 10px", borderRadius: 2, border: "none",
                            background: "#238c35", color: "white", fontSize: 11, fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => onSaveAudio(false)}
                          style={{
                            height: 22, padding: "0 10px", borderRadius: 2, border: "1px solid var(--ss-panel-border)",
                            background: "transparent", color: "var(--ss-text-muted)", fontSize: 11, fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          No
                        </button>
                      </div>
                    </div>
                  )}

                  {(onDownloadLastTake || onExportSynthReference) && (
                    <div style={{
                      marginBottom: 14,
                      padding: "10px 12px",
                      borderRadius: 4,
                      background: "var(--ss-controls-surface)",
                      border: "1px solid var(--ss-panel-border)",
                    }}>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}>
                        {onDownloadLastTake && (
                          <button
                            type="button"
                            onClick={onDownloadLastTake}
                            disabled={!canDownloadLastTake || isExportingSynth}
                            style={{
                              height: 26,
                              padding: "0 10px",
                              borderRadius: 3,
                              border: "1px solid var(--ss-panel-border)",
                              background: "var(--ss-controls-btn)",
                              color: "var(--ss-text-title)",
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: !canDownloadLastTake || isExportingSynth ? "not-allowed" : "pointer",
                              opacity: !canDownloadLastTake || isExportingSynth ? 0.5 : 1,
                            }}
                          >
                            Download last take
                          </button>
                        )}
                        {onExportSynthReference && (
                          <button
                            type="button"
                            onClick={onExportSynthReference}
                            disabled={isExportingSynth}
                            style={{
                              height: 26,
                              padding: "0 10px",
                              borderRadius: 3,
                              border: "1px solid rgba(83,118,240,0.45)",
                              background: "rgba(83,118,240,0.12)",
                              color: "#8eaaff",
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: isExportingSynth ? "wait" : "pointer",
                              opacity: isExportingSynth ? 0.65 : 1,
                            }}
                          >
                            {isExportingSynth ? "Exporting synth..." : "Export synth reference"}
                          </button>
                        )}
                      </div>
                      {audioExportMessage && (
                        <p style={{ margin: "7px 0 0", fontSize: 10, color: "#238c35", lineHeight: 1.4 }}>
                          {audioExportMessage}
                        </p>
                      )}
                      {audioExportError && (
                        <p style={{ margin: "7px 0 0", fontSize: 10, color: "#cf4343", lineHeight: 1.4 }}>
                          {audioExportError}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Active drill indicator */}
                  {activeDrill && onClearDrill && (
                    <div style={{
                      marginBottom: 12,
                      padding: "9px 12px",
                      borderRadius: 4,
                      background: "rgba(83,118,240,0.1)",
                      border: "1px solid rgba(83,118,240,0.3)",
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 8,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "#8eaaff", marginBottom: 3 }}>
                          Active Drill{activeDrill.focus ? ` · ${activeDrill.focus}` : ""}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ss-text-title)", marginBottom: 2 }}>{activeDrill.label}</div>
                        {activeDrill.measure && (
                          <div style={{ fontSize: 10, color: "var(--ss-text-muted)" }}>
                            Looping m{activeDrill.measure}{activeDrill.targetBpm ? ` @ ${activeDrill.targetBpm} BPM` : ""}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={onClearDrill}
                        title="Clear drill — restore original BPM and disable loop"
                        style={{
                          flexShrink: 0,
                          height: 20,
                          padding: "0 8px",
                          borderRadius: 2,
                          border: "1px solid rgba(83,118,240,0.4)",
                          background: "transparent",
                          color: "#8eaaff",
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Undo
                      </button>
                    </div>
                  )}

                  {feedback && (
                    <>
                      <div style={{ marginBottom: 14 }}>
                        <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", margin: "0 0 7px" }}>Focus your next take</p>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                          {([
                            ["notes", "Notes"],
                            ["timing", "Timing"],
                            ["transitions", "Changes"],
                            ["full", "Full"],
                          ] as [PracticeFocus, string][]).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setPracticeFocus(id)}
                              style={{
                                height: 28, borderRadius: 3, cursor: "pointer", fontSize: 9, fontWeight: 700,
                                border: `1px solid ${practiceFocus === id ? "#5376f0" : "var(--ss-panel-border)"}`,
                                background: practiceFocus === id ? "rgba(83,118,240,0.18)" : "var(--ss-controls-btn)",
                                color: practiceFocus === id ? "#8eaaff" : "var(--ss-text-muted)",
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", marginBottom: 6 }}>Prescription</p>
                      {rankedPracticeActions.length > 0 && (
                        <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                          {rankedPracticeActions.slice(0, 3).map(action => (
                            <div key={action.label}>
                              <CoachActionCard
                                label={action.label}
                                detail={action.detail}
                                focus={action.focus}
                                onApply={onApplyCoachAction
                                  ? () => onApplyCoachAction({ measure: action.measure, targetBpm: action.targetBpm })
                                  : undefined
                                }
                              />
                              {action.availableActions && action.availableActions.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0 2px 8px" }}>
                                  {action.availableActions.map(actionType => (
                                    <button
                                      key={actionType}
                                      type="button"
                                      onClick={() => {
                                        if (actionType === "record") {
                                          clearTheoryHighlight();
                                          setTab("record");
                                        }
                                        onCoachPlaybackAction?.(actionType, action.measure, action.targetBpm);
                                      }}
                                      style={{
                                        height: 21, padding: "0 7px", borderRadius: 2, cursor: "pointer",
                                        border: "1px solid var(--ss-panel-border)", background: "transparent",
                                        color: "var(--ss-text-muted)", fontSize: 9, fontWeight: 700, textTransform: "capitalize",
                                      }}
                                    >
                                      {actionType === "take" ? "My take" : actionType === "compare" ? "A/B" : actionType}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {feedback.issueClusters && feedback.issueClusters.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", marginBottom: 6 }}>Patterns</p>
                          {feedback.issueClusters.map(cluster => (
                            <button
                              key={cluster.id}
                              type="button"
                              onClick={() => cluster.measures[0] != null && onCoachMeasureSelect?.(cluster.measures[0])}
                              style={{
                                width: "100%", display: "flex", gap: 9, textAlign: "left",
                                padding: "9px 10px", marginBottom: 5, borderRadius: 4,
                                background: "var(--ss-controls-surface)", border: "1px solid var(--ss-panel-border)",
                                cursor: cluster.measures.length > 0 ? "pointer" : "default",
                              }}
                            >
                              <span style={{
                                width: 6, height: 6, marginTop: 4, borderRadius: "50%", flexShrink: 0,
                                background: cluster.severity === "high" ? "#cf4343" : cluster.severity === "medium" ? "#d79f36" : "#238c35",
                              }} />
                              <span style={{ flex: 1 }}>
                                <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--ss-text-title)" }}>{cluster.title}</span>
                                <span style={{ display: "block", marginTop: 2, fontSize: 10, lineHeight: 1.4, color: "var(--ss-text-muted)" }}>{cluster.summary}</span>
                              </span>
                              {cluster.measures[0] != null && <span style={{ fontSize: 9, color: "var(--ss-text-muted)" }}>M{cluster.measures[0]}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                      <div style={{ padding: "10px 12px", marginBottom: 10, borderRadius: 4, background: "rgba(35,140,53,0.07)", border: "1px solid rgba(35,140,53,0.2)" }}>
                        <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.4px", color: "#238c35" }}>Session recap</div>
                        <p style={{ margin: "5px 0 0", fontSize: 11, lineHeight: 1.45, color: "var(--ss-text-secondary)" }}>
                          {comparison?.verdict === "improved"
                            ? `This take improved across the main signals. Measure ${metrics.weakestMeasure} remains the best next check.`
                            : `You played at ${metrics.currentTempoBpm} BPM. Work measure ${metrics.weakestMeasure} at ${metrics.recommendedTempoBpm} BPM, then record another take.`}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setEvidenceOpen(value => !value)}
                        style={{
                          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                          height: 32, padding: "0 10px", borderRadius: 3, cursor: "pointer",
                          border: "1px solid var(--ss-panel-border)", background: "var(--ss-controls-surface)",
                          color: "var(--ss-text-secondary)", fontSize: 10, fontWeight: 700,
                        }}
                      >
                        Evidence and confidence
                        <ChevronDown size={13} style={{ transform: evidenceOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                      </button>
                      {evidenceOpen && (
                        <div style={{ padding: "9px 4px 2px" }}>
                          {feedback.findings?.map((finding, i) => (
                            <CoachFindingRow
                              key={`${finding.type}-${finding.measure}-${finding.beat ?? i}`}
                              finding={finding}
                              onClick={onFindingClick}
                            />
                          ))}
                          {feedback.tips.slice(0, 2).map((tip, i) => (
                            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                              <ChevronRight size={12} color="#238c35" style={{ flexShrink: 0, marginTop: 2 }} />
                              <p style={{ fontSize: 11, color: "var(--ss-text-muted)", margin: 0, lineHeight: 1.4 }}>{tip}</p>
                            </div>
                          ))}
                          <div style={{ marginTop: 8 }}>
                            {feedback.alignments.map(alignment => <AlignmentRow key={alignment.tabNoteId} a={alignment} />)}
                          </div>
                          <p style={{ margin: "8px 0 0", fontSize: 9, lineHeight: 1.4, color: "var(--ss-text-muted)" }}>
                            Outcomes align detected pitch and timing with expected tab notes. They do not identify the physical string played.
                          </p>
                        </div>
                      )}

                      {feedback.coachQuestions && feedback.coachQuestions.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => setHelpOpen(value => !value)}
                            style={{
                              width: "100%", height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 7,
                              borderRadius: 3, border: "1px solid var(--ss-panel-border)", background: "transparent",
                              color: "var(--ss-text-muted)", cursor: "pointer", fontSize: 10, fontWeight: 700,
                            }}
                          >
                            <HelpCircle size={13} />
                            Ask Coach
                            <ChevronDown size={13} style={{ marginLeft: "auto", transform: helpOpen ? "rotate(180deg)" : "none" }} />
                          </button>
                          {helpOpen && (
                            <div style={{ paddingTop: 5 }}>
                              {feedback.coachQuestions.map(question => (
                                <button
                                  key={question.id}
                                  type="button"
                                  onClick={() => setOpenQuestionId(value => value === question.id ? null : question.id)}
                                  style={{
                                    width: "100%", padding: "8px 9px", marginBottom: 4, textAlign: "left", borderRadius: 3,
                                    border: "1px solid var(--ss-panel-border)", background: "var(--ss-controls-surface)",
                                    color: "var(--ss-text-secondary)", cursor: "pointer", fontSize: 10, fontWeight: 700,
                                  }}
                                >
                                  {question.question}
                                  {openQuestionId === question.id && (
                                    <span style={{ display: "block", marginTop: 5, color: "var(--ss-text-muted)", fontWeight: 400, lineHeight: 1.45 }}>{question.answer}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {tab === "metrics" && (
            <motion.div key="metrics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: 16 }}>
              <p style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", marginBottom: 12 }}>
                {songMetrics.songTitle}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                <MetricCard label="Sessions" value={String(songMetrics.sessionsPlayed)} sub="for this song" color="#238c35" />
                <MetricCard label="Best" value={`${songMetrics.bestAccuracy}%`} sub="accuracy" color="#5376f0" />
                <MetricCard label="Average" value={`${songMetrics.avgAccuracy}%`} sub="accuracy" />
                <MetricCard label="Practice" value={`${songMetrics.totalPracticeMinutes}m`} sub={`last: ${songMetrics.lastPracticed}`} color="#d79f36" />
              </div>

              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", marginBottom: 8 }}>Measure mastery</p>
              {(songMetrics.measureMastery?.length ?? 0) > 0 ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(48px, 1fr))", gap: 5 }}>
                    {songMetrics.measureMastery?.map(row => {
                      const colors: Record<MeasureMastery["level"], string> = {
                        unpracticed: "var(--ss-text-muted)",
                        learning: "#cf6a28",
                        improving: "#d79f36",
                        reliable: "#5376f0",
                        mastered: "#238c35",
                      };
                      const color = colors[row.level];
                      return (
                        <button
                          key={row.measure}
                          type="button"
                          onClick={() => setSelectedMasteryMeasure(value => value === row.measure ? null : row.measure)}
                          style={{
                            minHeight: 46, padding: "6px 4px", borderRadius: 4, cursor: "pointer",
                            border: `1px solid ${selectedMasteryMeasure === row.measure ? color : "var(--ss-panel-border)"}`,
                            background: row.level === "unpracticed" ? "var(--ss-controls-btn)" : `${color}18`,
                            color,
                          }}
                        >
                          <span style={{ display: "block", fontSize: 11, fontWeight: 800 }}>M{row.measure}</span>
                          <span style={{ display: "block", marginTop: 3, fontSize: 8, textTransform: "uppercase" }}>{row.level}</span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedMastery && (
                    <div style={{ marginTop: 8, padding: "10px 11px", borderRadius: 4, border: "1px solid var(--ss-panel-border)", background: "var(--ss-controls-surface)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ss-text-title)" }}>Measure {selectedMastery.measure}</span>
                        <span style={{ fontSize: 9, color: "var(--ss-text-muted)", textTransform: "capitalize" }}>{selectedMastery.level}</span>
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 7, fontSize: 10, color: "var(--ss-text-secondary)" }}>
                        <span>{selectedMastery.accuracyPercent}% accuracy</span>
                        {selectedMastery.pitchCoveragePercent != null && <span>{selectedMastery.pitchCoveragePercent}% coverage</span>}
                        {selectedMastery.timingDriftMs != null && <span>{selectedMastery.timingDriftMs}ms timing</span>}
                      </div>
                      <p style={{ margin: "7px 0 0", fontSize: 10, lineHeight: 1.4, color: "var(--ss-text-muted)" }}>
                        {selectedMastery.dominantIssue === "timing"
                          ? "Keep this measure looped and stabilize the pulse before raising tempo."
                          : selectedMastery.dominantIssue === "notes"
                            ? "Review the expected pitches slowly, then record another focused take."
                            : selectedMastery.dominantIssue === "mixed"
                              ? "Lower the tempo and rebuild both pitch coverage and timing."
                              : "This measure is stable across recent eligible takes."}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 11, color: "var(--ss-text-muted)", lineHeight: 1.5 }}>Record Coach takes to build recent-consistency mastery.</p>
              )}

              <p style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--ss-text-muted)", margin: "16px 0 8px" }}>Recent takes</p>
              {songMetrics.recentTakes.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--ss-text-muted)", lineHeight: 1.5 }}>
                  No sessions yet. Record a take in Coach Me mode.
                </p>
              ) : songMetrics.recentTakes.map((t, i) => (
                <div key={t.id ?? i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 0", borderBottom: "1px solid var(--ss-popup-divider)",
                  fontSize: 12, gap: 6,
                }}>
                  <span style={{ color: "var(--ss-text-muted)", minWidth: 56 }}>{t.date}</span>
                  <span style={{ color: t.accuracy >= 80 ? "#238c35" : "var(--ss-text-title)", fontWeight: 600, minWidth: 34, textAlign: "right" }}>{t.accuracy}%</span>
                  <span style={{ color: "var(--ss-text-secondary)", flex: 1 }}>{t.tempo} BPM</span>
                  {t.id && onDeleteSession && (
                    <button
                      onClick={() => onDeleteSession(t.id!)}
                      title="Delete this session"
                      style={{
                        width: 18, height: 18, borderRadius: 2, border: "none",
                        background: "transparent", color: "var(--ss-text-muted)", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 0, flexShrink: 0,
                        transition: "color 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = "#cf4343"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--ss-text-muted)"; }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
