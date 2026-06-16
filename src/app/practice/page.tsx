"use client";

// Exact Songsterr colors from CDP inspection:
// Body bg:          rgb(28, 29, 31)   = #1c1d1f
// Nav bg:           rgb(32, 32, 34)   = #202022
// Player bar bg:    rgb(42, 42, 46)   = #2a2a2e
// Song title:       rgb(214,214,214)  = #d6d6d6, 45px, weight 300
// Artist text:      rgb(255,255,255)  = white,   18px, weight 700
// Icon/accent:      rgb(35, 140, 53)  = #238c35
// Upgrade btn:      #238c35 bg, white text, border-radius 2px
// Disabled:         rgba(255,255,255,0.3)

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, RotateCcw, Printer, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import Header from "@/components/layout/Header";
import TabViewer from "@/components/practice/TabViewer";
import PlayerControls from "@/components/practice/PlayerControls";
import PracticeCoachPanel from "@/components/practice/PracticeCoachPanel";
import { buildMockSession } from "@/lib/mock-practice-data";
import type { PracticeSession } from "@/types/music";

const BASE_SESSION = buildMockSession();
const CLEAN_SESSION: PracticeSession = {
  ...BASE_SESSION,
  tabNotes: BASE_SESSION.tabNotes.map((n) => ({ ...n, status: undefined })),
  feedback: undefined,
  metrics: undefined,
};

export default function PracticePage() {
  const [session, setSession] = useState<PracticeSession>(CLEAN_SESSION);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [displayMode, setDisplayMode] = useState("Tab");

  const handleRecordingStart = useCallback(() => {
    setSession((s) => ({
      ...s,
      tabNotes: BASE_SESSION.tabNotes.map((n) => ({ ...n, status: undefined })),
      feedback: undefined,
      metrics: undefined,
    }));
    setHasRecorded(false);
    setIsAnalysing(false);
  }, []);

  const handleRecordingComplete = useCallback((_blob: Blob, _ms: number) => {
    setIsAnalysing(true);
    setHasRecorded(true);
    setTimeout(() => {
      setSession(BASE_SESSION);
      setIsAnalysing(false);
    }, 2200);
  }, []);

  return (
    // Body bg: #1c1d1f
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: "#1c1d1f", color: "white", fontWeight: 300 }}
    >
      {/* ── Global nav ── */}
      <Header />

      {/* ── Song info area ── */}
      {/* Transparent bg — title sits over body #1c1d1f */}
      <div className="shrink-0 flex flex-col items-center pt-8 pb-4 px-6" style={{ backgroundColor: "#1c1d1f" }}>
        {/* Song title — 45px, #d6d6d6, weight 300 */}
        <h1
          className="text-center leading-tight mb-1"
          style={{ color: "#d6d6d6", fontSize: 45, fontWeight: 300 }}
        >
          {session.songTitle}{" "}
          <span style={{ color: "rgba(214,214,214,0.5)" }}>Tab</span>
        </h1>

        {/* Action row: star, Tab dropdown, Published on, refresh, print */}
        <div className="flex items-center gap-3 mt-3 mb-3">
          <button
            onClick={() => setLiked((l) => !l)}
            className="w-8 h-8 rounded-full border flex items-center justify-center transition-colors"
            style={{
              borderColor: liked ? "#238c35" : "rgba(255,255,255,0.25)",
              color: liked ? "#238c35" : "rgba(255,255,255,0.6)",
            }}
          >
            <Star style={{ width: 14, height: 14, fill: liked ? "#238c35" : "none" }} />
          </button>

          {/* Tab mode dropdown */}
          <button
            className="flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm transition-colors"
            style={{ borderColor: "rgba(255,255,255,0.25)", color: "white", fontWeight: 300 }}
          >
            {displayMode}
            <ChevronDown style={{ width: 14, height: 14 }} />
          </button>

          <div className="flex items-center gap-2 text-[13px]" style={{ color: "rgba(255,255,255,0.5)" }}>
            <span>PUBLISHED ON:</span>
            <span style={{ color: "#238c35", cursor: "pointer" }}>1/1/2020</span>
          </div>

          <button
            className="w-8 h-8 rounded-full border flex items-center justify-center transition-opacity hover:opacity-70"
            style={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.6)" }}
          >
            <RotateCcw style={{ width: 14, height: 14 }} />
          </button>

          <button
            className="w-8 h-8 rounded-full border flex items-center justify-center transition-opacity hover:opacity-70 relative"
            style={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.6)" }}
          >
            <Printer style={{ width: 14, height: 14 }} />
            {/* Green dot */}
            <span
              className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center text-[7px] text-white"
              style={{ backgroundColor: "#238c35" }}
            >
              8
            </span>
          </button>
        </div>

        {/* Artist — white, 18px, weight 700, green on hover */}
        <a
          href="#"
          className="text-[18px] font-bold transition-colors hover:opacity-75 mb-3"
          style={{ color: "white", fontWeight: 700 }}
        >
          {session.artist}
        </a>

        {/* Upgrade banner */}
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm"
          style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)" }}
        >
          <button
            className="px-3 py-1 text-white text-[13px] font-medium rounded-sm transition-opacity hover:opacity-85"
            style={{ backgroundColor: "#238c35", borderRadius: 2 }}
          >
            Upgrade to Plus
          </button>
          <span>for</span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>
            Loop and slow down with just one click
          </span>
        </div>
      </div>

      {/* ── Main content row ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tab viewer */}
        <div className="flex-1 overflow-auto flex flex-col" style={{ backgroundColor: "#1c1d1f" }}>
          {/* Phrase nav */}
          <div
            className="px-4 py-1.5 flex items-center justify-between border-b shrink-0"
            style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "#1c1d1f" }}
          >
            <div className="flex items-center gap-2 text-[12px]" style={{ color: "rgba(255,255,255,0.4)" }}>
              <button className="flex items-center gap-0.5 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/[0.05]">
                <ChevronLeft style={{ width: 13, height: 13 }} />
                Prev phrase
              </button>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>|</span>
              <span>Measures {session.startMeasure}–{session.endMeasure}</span>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>|</span>
              <button className="flex items-center gap-0.5 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/[0.05]">
                Next phrase
                <ChevronRight style={{ width: 13, height: 13 }} />
              </button>
            </div>
          </div>

          {/* Analysis status */}
          <AnimatePresence>
            {(isAnalysing || hasRecorded) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden shrink-0"
              >
                <div
                  className="px-5 py-2 flex items-center gap-2.5 text-[12px]"
                  style={{
                    backgroundColor: isAnalysing ? "rgba(37,99,235,0.1)" : "rgba(35,140,53,0.1)",
                    color: isAnalysing ? "#60a5fa" : "#238c35",
                  }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isAnalysing ? "#60a5fa" : "#238c35",
                      animation: isAnalysing ? "pulse 1s infinite" : undefined,
                    }}
                  />
                  {isAnalysing
                    ? "Aligning note events to tablature…"
                    : "Analysis complete — results in Practice Coach →"}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <TabViewer
            notes={session.tabNotes}
            bpm={session.bpm}
            currentMeasure={isAnalysing ? session.startMeasure : undefined}
          />
        </div>

        {/* AI Coach sidebar — 304px */}
        <div
          className="w-[304px] shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", backgroundColor: "#1c1d1f" }}
        >
          <PracticeCoachPanel
            feedback={session.feedback}
            metrics={isAnalysing ? undefined : session.metrics}
            isAnalysing={isAnalysing}
            onRecordingStart={handleRecordingStart}
            onRecordingComplete={handleRecordingComplete}
          />
        </div>
      </div>

      {/* ── Player controls ── */}
      <PlayerControls bpm={session.bpm} />
    </div>
  );
}
