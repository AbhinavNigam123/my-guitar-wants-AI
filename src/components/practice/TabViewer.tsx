"use client";

import { motion } from "framer-motion";
import type { TabNote, NoteStatus } from "@/types/music";

interface TabViewerProps {
  notes: TabNote[];
  bpm: number;
  currentMeasure?: number;
}

// Layout constants
const STRING_H = 28;       // px per string row
const MEASURE_W = 210;     // px per measure
const NOTE_D = 22;         // note badge diameter
const PAD_L = 20;          // left padding inside a measure before notes start
const BEATS = 4;
const BEAT_W = (MEASURE_W - PAD_L * 2) / BEATS; // px per beat slot

// Authentic tab notation label order (high e on top, low E on bottom)
const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];

// Note colors use Songsterr tokens:
// unplayed: tab-note-base-dark #ddd on transparent — we show subtle bg
// correct/wrong etc are our own since Songsterr doesn't have a practice mode
const NOTE_STYLE: Record<NoteStatus, { bg: string; text: string; ring: string }> = {
  correct:    { bg: "#0a2e14", text: "#238c35", ring: "#18b320" },
  early:      { bg: "#2e2005", text: "#d79f36", ring: "#d88f06" },
  late:       { bg: "#2e1205", text: "#cf6a28", ring: "#ea580c" },
  missed:     { bg: "#2e0808", text: "#cf4343", ring: "#b83b3b" },
  wrong_note: { bg: "#1e0a2e", text: "#a06cc9", ring: "#7c3aed" },
  // --tab-note-base-dark: #ddd, bg transparent matches real Songsterr
  unplayed:   { bg: "transparent", text: "#dddddd", ring: "#6d6d6d" },
};

const LEGEND_ITEMS: [NoteStatus, string][] = [
  ["correct",    "Correct"],
  ["early",      "Early"],
  ["late",       "Late"],
  ["missed",     "Missed"],
  ["wrong_note", "Wrong"],
];

function groupByMeasure(notes: TabNote[]) {
  const map = new Map<number, TabNote[]>();
  for (const n of notes) {
    if (!map.has(n.measure)) map.set(n.measure, []);
    map.get(n.measure)!.push(n);
  }
  return map;
}

export default function TabViewer({ notes, bpm, currentMeasure }: TabViewerProps) {
  const byMeasure = groupByMeasure(notes);
  const measureNums = Array.from(byMeasure.keys()).sort((a, b) => a - b);
  const numMeasures = measureNums.length;
  const staffH = STRING_LABELS.length * STRING_H;
  const totalW = numMeasures * MEASURE_W + PAD_L;

  return (
    // Tab staff bg matches body: #1c1d1f. String lines: #303030. Measure bars: #3a3a3a.
    <div className="w-full" style={{ backgroundColor: "#1c1d1f" }}>
      {/* Tuning bar */}
      <div className="px-5 py-2.5 flex items-center justify-between gap-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-600">
          <span className="uppercase tracking-widest">Standard</span>
          <span>E A D G B e</span>
          <span>·</span>
          <span>{bpm} BPM</span>
          <span>·</span>
          <span>4/4</span>
          <span>·</span>
          <span>{numMeasures} measures</span>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 shrink-0">
          {LEGEND_ITEMS.map(([status, label]) => {
            const s = NOTE_STYLE[status];
            return (
              <div key={status} className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ background: s.bg, outline: `1px solid ${s.ring}` }}
                />
                <span className="text-[10px] text-zinc-600">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Staff area — scrolls horizontally */}
      <div className="overflow-x-auto overflow-y-hidden py-6 px-4">
        <div
          className="relative"
          style={{ width: totalW, height: staffH + 28 /* room for measure numbers */ }}
        >
          {/* ── Measure numbers (above staff) ── */}
          {measureNums.map((num, mi) => {
            const isActive = num === currentMeasure;
            return (
              <div
                key={`mn-${num}`}
                className="absolute text-[11px] font-mono select-none"
                style={{
                  left: PAD_L + mi * MEASURE_W,
                  top: 0,
                  color: isActive ? "#60a5fa" : "#3f3f46",
                  fontWeight: isActive ? 700 : 400,
                }}
              >
                {num}
              </div>
            );
          })}

          {/* ── Staff (string lines + measure bars) ── */}
          <div className="absolute" style={{ top: 20, left: 0, right: 0, height: staffH }}>
            {/* String labels on the left */}
            {STRING_LABELS.map((label, i) => (
              <div
                key={label}
                className="absolute text-[10px] font-mono text-zinc-700 select-none flex items-center"
                style={{
                  left: 0,
                  top: i * STRING_H,
                  height: STRING_H,
                  width: PAD_L - 4,
                  justifyContent: "flex-end",
                }}
              >
                {label}
              </div>
            ))}

            {/* Horizontal string lines — drawn once, full width */}
            {STRING_LABELS.map((_, i) => (
              <div
                key={`sl-${i}`}
                className="absolute"
                style={{
                  top: i * STRING_H + STRING_H / 2 - 0.5,
                  left: PAD_L,
                  right: 0,
                  height: 1,
                  // --tab-strings-dark: #6d6d6d
                  backgroundColor: "#6d6d6d",
                }}
              />
            ))}

            {/* Measure bar lines (left edge of each measure) */}
            {measureNums.map((_, mi) => {
              const isActive = measureNums[mi] === currentMeasure;
              return (
                <div
                  key={`bar-${mi}`}
                  className="absolute"
                  style={{
                  left: PAD_L + mi * MEASURE_W,
                  top: 0,
                  height: staffH,
                  width: isActive ? 2 : 1,
                  // --tab-measure-dark: #6d6d6d
                  backgroundColor: isActive ? "#238c35" : "#6d6d6d",
                  }}
                />
              );
            })}
            {/* Final right bar line */}
            <div
              className="absolute"
              style={{
                left: PAD_L + numMeasures * MEASURE_W,
                top: 0,
                height: staffH,
                width: 1,
                backgroundColor: "#3a3a3a",
              }}
            />

            {/* Active measure highlight */}
            {currentMeasure !== undefined && (
              <motion.div
                layoutId="measure-highlight"
                className="absolute"
                style={{
                  left: PAD_L + (currentMeasure - 1) * MEASURE_W,
                  top: 0,
                  width: MEASURE_W,
                  height: staffH,
                  background: "rgba(37, 99, 235, 0.06)",
                  borderTop: "1px solid rgba(37, 99, 235, 0.15)",
                  borderBottom: "1px solid rgba(37, 99, 235, 0.15)",
                }}
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
              />
            )}

            {/* ── Notes ── */}
            {notes.map((note, idx) => {
              const mi = measureNums.indexOf(note.measure);
              if (mi === -1) return null;

              const s = NOTE_STYLE[note.status ?? "unplayed"];
              const x = PAD_L + mi * MEASURE_W + (note.beat - 1) * BEAT_W + BEAT_W / 2 - NOTE_D / 2;
              const y = (note.string - 1) * STRING_H + STRING_H / 2 - NOTE_D / 2;

              return (
                <motion.div
                  key={note.id}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 22,
                    delay: idx * 0.02,
                  }}
                  className="absolute flex items-center justify-center font-mono font-bold select-none cursor-default"
                  style={{
                    left: x,
                    top: y,
                    width: NOTE_D,
                    height: NOTE_D,
                    borderRadius: note.fret <= 9 ? "50%" : 5,
                    background: s.bg,
                    color: s.text,
                    fontSize: note.fret >= 10 ? 9 : 11,
                    outline: `1.5px solid ${s.ring}`,
                    zIndex: 2,
                  }}
                  title={`String ${note.string} · Fret ${note.fret} · ${note.status ?? "unplayed"}`}
                >
                  {note.fret}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
