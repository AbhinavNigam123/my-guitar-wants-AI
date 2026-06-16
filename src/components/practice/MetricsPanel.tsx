"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Target, Timer, AlertTriangle, Gauge } from "lucide-react";
import type { PracticeMetrics } from "@/types/music";
import { Progress } from "@/components/ui/progress";

interface MetricsPanelProps {
  metrics?: PracticeMetrics;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  progress?: number;
  index: number;
}

function MetricCard({ icon, label, value, sub, accent, progress, index }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, type: "spring", stiffness: 300, damping: 24 }}
      className="rounded-xl border border-white/[0.07] bg-zinc-800/40 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`${accent} opacity-80`}>{icon}</div>
          <span className="text-xs text-zinc-500 font-medium">{label}</span>
        </div>
      </div>
      <div>
        <span className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</span>
        {sub && <span className="text-xs text-zinc-500 ml-1.5">{sub}</span>}
      </div>
      {progress !== undefined && (
        <Progress value={progress} className="h-1.5 bg-zinc-700" />
      )}
    </motion.div>
  );
}

export default function MetricsPanel({ metrics }: MetricsPanelProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
        <Gauge className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-zinc-200">Performance Metrics</span>
      </div>

      <div className="p-4">
        <AnimatePresence mode="wait">
          {!metrics ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-2 py-8 text-zinc-600"
            >
              <Gauge className="w-8 h-8 opacity-30" />
              <span className="text-sm">Metrics will appear after recording</span>
            </motion.div>
          ) : (
            <motion.div
              key="metrics"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-2 gap-3"
            >
              <MetricCard
                index={0}
                icon={<Target className="w-4 h-4" />}
                label="Accuracy"
                value={`${metrics.accuracyPercent}%`}
                accent="text-emerald-400"
                progress={metrics.accuracyPercent}
              />
              <MetricCard
                index={1}
                icon={<Timer className="w-4 h-4" />}
                label="Timing drift"
                value={`${metrics.timingDriftMs}`}
                sub="ms avg"
                accent={metrics.timingDriftMs < 80 ? "text-emerald-400" : metrics.timingDriftMs < 150 ? "text-yellow-400" : "text-orange-400"}
              />
              <MetricCard
                index={2}
                icon={<AlertTriangle className="w-4 h-4" />}
                label="Weakest measure"
                value={`#${metrics.weakestMeasure}`}
                accent="text-orange-400"
              />
              <MetricCard
                index={3}
                icon={<Gauge className="w-4 h-4" />}
                label="Rec. tempo"
                value={`${metrics.recommendedTempoBpm}`}
                sub={`BPM · was ${metrics.currentTempoBpm}`}
                accent="text-blue-400"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
