"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ChevronRight,
  Loader2,
  Target,
  Timer,
  AlertTriangle,
  Gauge,
  Mic,
} from "lucide-react";
import type { PracticeFeedback, PracticeMetrics, NoteStatus, AlignmentResult } from "@/types/music";
import { Badge } from "@/components/ui/badge";
import AudioRecorder from "@/components/audio/AudioRecorder";

interface PracticeCoachPanelProps {
  feedback?: PracticeFeedback;
  metrics?: PracticeMetrics;
  isAnalysing: boolean;
  onRecordingStart: () => void;
  onRecordingComplete: (blob: Blob, duration: number) => void;
}

const STATUS_BADGE: Record<NoteStatus, { label: string; cls: string }> = {
  correct:    { label: "✓",   cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  early:      { label: "E",   cls: "bg-yellow-500/15  text-yellow-400  border-yellow-500/20"  },
  late:       { label: "L",   cls: "bg-orange-500/15  text-orange-400  border-orange-500/20"  },
  missed:     { label: "✗",   cls: "bg-red-600/15     text-red-400     border-red-500/20"     },
  wrong_note: { label: "W",   cls: "bg-violet-600/15  text-violet-400  border-violet-500/20"  },
  unplayed:   { label: "–",   cls: "bg-zinc-700/20    text-zinc-500    border-zinc-600/20"    },
};

function ScoreRing({ pct }: { pct: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 80 ? "#10b981" : pct >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative flex items-center justify-center" style={{ width: 80, height: 80 }}>
      <svg width={80} height={80} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={40} cy={40} r={r} fill="none" stroke="#27272a" strokeWidth={6} />
        <motion.circle
          cx={40}
          cy={40}
          r={r}
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
      <div className="absolute text-center">
        <span className="text-lg font-bold tabular-nums" style={{ color }}>
          {pct}
        </span>
        <span className="text-[10px] text-zinc-500 block leading-none">%</span>
      </div>
    </div>
  );
}

function MetricRow({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-right">
        <span className={`text-sm font-bold font-mono ${accent}`}>{value}</span>
        {sub && <span className="text-[11px] text-zinc-600 ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function AlignmentRow({ a, i }: { a: AlignmentResult; i: number }) {
  const b = STATUS_BADGE[a.status];
  const sign = a.timingOffsetMs > 0 ? "+" : "";
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.025 }}
      className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-zinc-700 w-6">{a.tabNoteId}</span>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 font-semibold ${b.cls}`}>
          {b.label}
        </Badge>
      </div>
      {a.status !== "missed" && a.status !== "unplayed" && (
        <span
          className={`text-[11px] font-mono tabular-nums ${
            Math.abs(a.timingOffsetMs) < 50
              ? "text-emerald-500"
              : Math.abs(a.timingOffsetMs) < 120
              ? "text-yellow-500"
              : "text-orange-500"
          }`}
        >
          {sign}{a.timingOffsetMs}ms
        </span>
      )}
    </motion.div>
  );
}

export default function PracticeCoachPanel({
  feedback,
  metrics,
  isAnalysing,
  onRecordingStart,
  onRecordingComplete,
}: PracticeCoachPanelProps) {
  return (
    <div className="flex flex-col h-full bg-[#141414]">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.08] shrink-0">
        <div className="w-6 h-6 rounded-md bg-[#2563eb]/20 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-[#60a5fa]" />
        </div>
        <span className="text-sm font-semibold text-white">Practice Coach</span>
        <span className="ml-auto text-[10px] text-zinc-600 uppercase tracking-widest font-mono">
          AI
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Recorder */}
        <div className="p-4 border-b border-white/[0.06]">
          <AudioRecorder
            onRecordingStart={onRecordingStart}
            onRecordingComplete={onRecordingComplete}
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
              className="flex flex-col items-center gap-3 py-10 text-zinc-600"
            >
              <Loader2 className="w-5 h-5 animate-spin text-[#60a5fa]" />
              <span className="text-xs">Analysing take…</span>
            </motion.div>
          ) : !metrics ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2.5 py-10"
            >
              <div className="w-12 h-12 rounded-full bg-zinc-800/50 flex items-center justify-center">
                <Mic className="w-5 h-5 text-zinc-600" />
              </div>
              <p className="text-xs text-zinc-600 text-center px-6">
                Hit record to get AI feedback on your playing
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="divide-y divide-white/[0.04]"
            >
              {/* Score */}
              <div className="px-4 py-4 flex items-center gap-4">
                <ScoreRing pct={metrics.accuracyPercent} />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-zinc-300">Overall score</p>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    {metrics.accuracyPercent >= 80
                      ? "Great take!"
                      : metrics.accuracyPercent >= 60
                      ? "Solid attempt."
                      : "Keep practising."}
                  </p>
                </div>
              </div>

              {/* Metrics */}
              <div className="px-4 py-3">
                <MetricRow
                  icon={<Timer className="w-3.5 h-3.5" />}
                  label="Timing drift"
                  value={`${metrics.timingDriftMs}ms`}
                  sub="avg"
                  accent={
                    metrics.timingDriftMs < 80
                      ? "text-emerald-400"
                      : metrics.timingDriftMs < 150
                      ? "text-yellow-400"
                      : "text-orange-400"
                  }
                />
                <MetricRow
                  icon={<AlertTriangle className="w-3.5 h-3.5" />}
                  label="Weakest measure"
                  value={`#${metrics.weakestMeasure}`}
                  accent="text-orange-400"
                />
                <MetricRow
                  icon={<Gauge className="w-3.5 h-3.5" />}
                  label="Rec. tempo"
                  value={`${metrics.recommendedTempoBpm} BPM`}
                  sub={`(was ${metrics.currentTempoBpm})`}
                  accent="text-[#60a5fa]"
                />
              </div>

              {/* Tips */}
              {feedback && (
                <div className="px-4 py-4">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2.5">
                    Coach notes
                  </p>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-3">
                    {feedback.overallComment}
                  </p>
                  <div className="space-y-2">
                    {feedback.tips.map((tip, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#2563eb]" />
                        <p className="text-xs text-zinc-500 leading-relaxed">{tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Note-by-note */}
              {feedback && (
                <div className="px-4 py-4">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">
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
      </div>
    </div>
  );
}
