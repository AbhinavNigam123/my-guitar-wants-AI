"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, Loader2 } from "lucide-react";
import type { PracticeFeedback, AlignmentResult, NoteStatus } from "@/types/music";
import { Badge } from "@/components/ui/badge";

interface FeedbackPanelProps {
  feedback?: PracticeFeedback;
  isAnalysing?: boolean;
}

const STATUS_BADGE: Record<NoteStatus, { label: string; className: string }> = {
  correct:    { label: "Correct",     className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  early:      { label: "Early",       className: "bg-yellow-500/20  text-yellow-300  border-yellow-500/30"  },
  late:       { label: "Late",        className: "bg-orange-500/20  text-orange-300  border-orange-500/30"  },
  missed:     { label: "Missed",      className: "bg-red-600/20     text-red-400     border-red-500/30"     },
  wrong_note: { label: "Wrong note",  className: "bg-violet-600/20  text-violet-300  border-violet-500/30"  },
  unplayed:   { label: "Unplayed",    className: "bg-zinc-700/30    text-zinc-400    border-zinc-600/30"    },
};

function AlignmentRow({ alignment, index }: { alignment: AlignmentResult; index: number }) {
  const badge = STATUS_BADGE[alignment.status];
  const offset = alignment.timingOffsetMs;
  const sign = offset > 0 ? "+" : "";

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0"
    >
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-zinc-600 w-8">{alignment.tabNoteId}</span>
        <Badge
          variant="outline"
          className={`text-xs px-2 py-0 font-medium ${badge.className}`}
        >
          {badge.label}
        </Badge>
      </div>
      {alignment.status !== "missed" && (
        <span
          className={`text-xs font-mono tabular-nums ${
            Math.abs(offset) < 50
              ? "text-emerald-400"
              : Math.abs(offset) < 120
              ? "text-yellow-400"
              : "text-orange-400"
          }`}
        >
          {sign}{offset}ms
        </span>
      )}
    </motion.div>
  );
}

export default function FeedbackPanel({ feedback, isAnalysing }: FeedbackPanelProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-zinc-200">AI Coach Feedback</span>
      </div>

      <AnimatePresence mode="wait">
        {isAnalysing ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center gap-3 py-12 text-zinc-500"
          >
            <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
            <span className="text-sm">Analysing your performance…</span>
          </motion.div>
        ) : !feedback ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center gap-2 py-12 text-zinc-600"
          >
            <Sparkles className="w-8 h-8 opacity-30" />
            <span className="text-sm">Record a take to get feedback</span>
          </motion.div>
        ) : (
          <motion.div
            key="feedback"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="divide-y divide-white/[0.04]"
          >
            {/* Summary */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-zinc-300 leading-relaxed">
                {feedback.overallComment}
              </p>
            </div>

            {/* Tips */}
            <div className="px-5 py-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
                Action items
              </p>
              {feedback.tips.map((tip, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="flex items-start gap-2 text-sm text-zinc-400"
                >
                  <ChevronRight className="w-4 h-4 shrink-0 mt-0.5 text-violet-500" />
                  {tip}
                </motion.div>
              ))}
            </div>

            {/* Note-by-note alignments */}
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
                Note analysis
              </p>
              <div>
                {feedback.alignments.map((a, i) => (
                  <AlignmentRow key={a.tabNoteId} alignment={a} index={i} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
