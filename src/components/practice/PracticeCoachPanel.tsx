"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, Loader2 } from "lucide-react";
import type { PracticeFeedback, PracticeMetrics, NoteStatus, AlignmentResult } from "@/types/music";
import AudioRecorder from "@/components/audio/AudioRecorder";

interface PracticeCoachPanelProps {
  feedback?: PracticeFeedback;
  metrics?: PracticeMetrics;
  isAnalysing: boolean;
  isRecording?: boolean;
  onRecordingStart: () => void;
  onRecordingComplete: (blob: Blob, duration: number) => void;
}

const STATUS_COLOR: Record<NoteStatus, string> = {
  correct:    "#238c35",
  early:      "#d79f36",
  late:       "#cf6a28",
  missed:     "#cf4343",
  wrong_note: "#a06cc9",
  unplayed:   "#6d6d6d",
};

const STATUS_LABEL: Record<NoteStatus, string> = {
  correct:    "✓",
  early:      "E",
  late:       "L",
  missed:     "✗",
  wrong_note: "W",
  unplayed:   "–",
};

// Enlarged ScoreRing — 96px, matching the plan spec
function ScoreRing({ pct }: { pct: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 80 ? "#238c35" : pct >= 60 ? "#d79f36" : "#cf4343";

  return (
    <div style={{ position: "relative", width: 96, height: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={96} height={96} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
        <circle cx={48} cy={48} r={r} fill="none" stroke="#2a2a2e" strokeWidth={6} />
        <motion.circle
          cx={48} cy={48} r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div style={{ textAlign: "center", position: "relative" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{pct}</span>
        <span style={{ fontSize: 11, color: "#8a8b8c", display: "block", lineHeight: 1 }}>%</span>
      </div>
    </div>
  );
}

// 2×2 metric card
function MetricCard({
  label,
  value,
  sub,
  color = "#d6d6d6",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: "#2a2a2e",
      borderRadius: 4,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.4px", color: "#8a8b8c" }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 10, color: "#6d6d6d" }}>{sub}</span>}
    </div>
  );
}

function AlignmentRow({ a, i }: { a: AlignmentResult; i: number }) {
  const color = STATUS_COLOR[a.status];
  const sign = a.timingOffsetMs > 0 ? "+" : "";
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.025 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "5px 0",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#3f3f46", width: 20 }}>{a.tabNoteId}</span>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color,
          background: `${color}18`,
          border: `1px solid ${color}30`,
          borderRadius: 3,
          padding: "1px 5px",
          minWidth: 18,
          textAlign: "center",
        }}>
          {STATUS_LABEL[a.status]}
        </span>
      </div>
      {a.status !== "missed" && a.status !== "unplayed" && (
        <span style={{
          fontSize: 11,
          fontFamily: "monospace",
          fontVariantNumeric: "tabular-nums",
          color: Math.abs(a.timingOffsetMs) < 50 ? "#238c35" : Math.abs(a.timingOffsetMs) < 120 ? "#d79f36" : "#cf6a28",
        }}>
          {sign}{a.timingOffsetMs}ms
        </span>
      )}
    </motion.div>
  );
}

// Mini waveform bars for live input skeleton
const MINI_BAR_COUNT = 20;
const MINI_BAR_PEAKS = Array.from(
  { length: MINI_BAR_COUNT },
  (_, i) => 0.22 + ((i * 7) % 11) * 0.06,
);

function MiniBars({ active }: { active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 20 }}>
      {Array.from({ length: MINI_BAR_COUNT }).map((_, i) => (
        <motion.div
          key={i}
          style={{ flex: 1, borderRadius: 1, background: active ? "#238c35" : "#37373b" }}
          animate={active ? { scaleY: [0.1, MINI_BAR_PEAKS[i], 0.1] } : { scaleY: 0.1 }}
          transition={active ? { duration: 0.4 + i * 0.02, repeat: Infinity, delay: i * 0.04 } : {}}
        />
      ))}
    </div>
  );
}

export default function PracticeCoachPanel({
  feedback,
  metrics,
  isAnalysing,
  onRecordingStart,
  onRecordingComplete,
}: PracticeCoachPanelProps) {
  const [isRecording, setIsRecording] = useState(false);

  const handleRecordingStart = useCallback(() => {
    setIsRecording(true);
    onRecordingStart();
  }, [onRecordingStart]);

  const handleRecordingComplete = useCallback((blob: Blob, duration: number) => {
    setIsRecording(false);
    onRecordingComplete(blob, duration);
  }, [onRecordingComplete]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#1a1a1c" }}>
      {/* Panel header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
        height: 44,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <div style={{
          width: 24, height: 24,
          borderRadius: 6,
          background: "rgba(35,140,53,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Sparkles size={13} color="#238c35" />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "white" }}>Practice Coach</span>

        {/* "LIVE" indicator badge — activates during recording */}
        <AnimatePresence>
          {isRecording && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "#238c35",
                borderRadius: 10,
                padding: "2px 7px",
                marginLeft: 4,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "white", display: "inline-block" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "white", letterSpacing: "0.4px" }}>LIVE</span>
            </motion.div>
          )}
        </AnimatePresence>

        <span style={{ marginLeft: "auto", fontSize: 10, color: "#3f3f46", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>
          AI
        </span>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Recorder */}
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <AudioRecorder
            onRecordingStart={handleRecordingStart}
            onRecordingComplete={handleRecordingComplete}
            disabled={isAnalysing}
          />
        </div>

        {/* Score + metrics */}
        <AnimatePresence mode="wait">
          {isAnalysing ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 16px", color: "#8a8b8c" }}
            >
              <Loader2 size={18} color="#238c35" style={{ animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 12 }}>Analysing take…</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </motion.div>
          ) : !metrics ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "32px 16px" }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "#2a2a2e",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6d6d6d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </div>
              <p style={{ fontSize: 12, color: "#6d6d6d", textAlign: "center", padding: "0 20px", lineHeight: 1.5 }}>
                Hit record to get AI feedback on your playing
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Accuracy ring + 2×2 metric cards */}
              <div style={{ padding: "16px 16px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                  <ScoreRing pct={metrics.accuracyPercent} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#d6d6d6", marginBottom: 4 }}>Overall score</p>
                    <p style={{ fontSize: 11, color: "#8a8b8c", lineHeight: 1.5 }}>
                      {metrics.accuracyPercent >= 80
                        ? "Great take! Timing is solid."
                        : metrics.accuracyPercent >= 60
                        ? "Solid attempt — keep at it."
                        : "Keep practising — you'll get there."}
                    </p>
                  </div>
                </div>

                {/* 2×2 metric cards grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <MetricCard
                    label="Timing drift"
                    value={`${metrics.timingDriftMs}ms`}
                    sub="avg offset"
                    color={metrics.timingDriftMs < 80 ? "#238c35" : metrics.timingDriftMs < 150 ? "#d79f36" : "#cf6a28"}
                  />
                  <MetricCard
                    label="Weakest bar"
                    value={`#${metrics.weakestMeasure}`}
                    sub="needs work"
                    color="#cf6a28"
                  />
                  <MetricCard
                    label="Rec. tempo"
                    value={`${metrics.recommendedTempoBpm}`}
                    sub="BPM suggested"
                    color="#5376f0"
                  />
                  <MetricCard
                    label="Your tempo"
                    value={`${metrics.currentTempoBpm}`}
                    sub="BPM played"
                    color="#d6d6d6"
                  />
                </div>
              </div>

              {/* Coach notes */}
              {feedback && (
                <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <p style={{ fontSize: 10, fontWeight: 500, color: "#6d6d6d", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 8 }}>
                    Coach notes
                  </p>
                  <p style={{ fontSize: 12, color: "#a0a0a4", lineHeight: 1.6, marginBottom: 10 }}>
                    {feedback.overallComment}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {feedback.tips.map((tip, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <ChevronRight size={12} color="#238c35" style={{ flexShrink: 0, marginTop: 2 }} />
                        <p style={{ fontSize: 12, color: "#8a8b8c", lineHeight: 1.5 }}>{tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Note-by-note analysis */}
              {feedback && (
                <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <p style={{ fontSize: 10, fontWeight: 500, color: "#6d6d6d", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 6 }}>
                    Note analysis
                  </p>
                  {feedback.alignments.map((a, i) => (
                    <AlignmentRow key={a.tabNoteId} a={a} i={i} />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Live Input skeleton section ──────────────────────── */}
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "12px 16px",
        }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: "#6d6d6d", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 8 }}>
            Live Input
          </p>

          {/* Mini waveform — visible during recording */}
          <div style={{ marginBottom: 8 }}>
            <MiniBars active={isRecording} />
          </div>

          <p style={{ fontSize: 11, color: "#6d6d6d", lineHeight: 1.5, marginBottom: 10 }}>
            Note detection coming soon — microphone input will write tab in real time
          </p>

          {/* Disabled "Start Live Tab" button */}
          {/* TODO: connect WebAudio PitchDetector → TabWriter pipeline */}
          <button
            disabled
            title="Coming in next version"
            style={{
              width: "100%",
              height: 34,
              borderRadius: 4,
              background: "#2a2a2e",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#6d6d6d",
              fontSize: 12,
              fontWeight: 500,
              cursor: "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: 0.6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
            Start Live Tab
          </button>
        </div>
      </div>
    </div>
  );
}
