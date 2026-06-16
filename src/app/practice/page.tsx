"use client";

// Exact Songsterr colors from live CDP inspection:
// Body bg:       rgb(28,29,31)  = #1c1d1f
// Nav bg:        rgb(32,32,34)  = #202022
// Player bar bg: rgb(42,42,46)  = #2a2a2e
// Song title:    Georgia, 45px, weight 300, #d6d6d6, line-height 45px
// Artist:        songsterr font (sans), 18px, weight 700, white
// Accent green:  rgb(35,140,53) = #238c35

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import Header from "@/components/layout/Header";
import TabViewer from "@/components/practice/TabViewer";
import PlayerControls from "@/components/practice/PlayerControls";
import PracticeCoachPanel from "@/components/practice/PracticeCoachPanel";
import { buildMockSession } from "@/lib/mock-practice-data";
import type { PracticeSession } from "@/types/music";

// ── Hardcoded song list for search ──────────────────────────────────────
const SONGS = [
  { id: 1, title: "Smoke on the Water",       artist: "Deep Purple",     difficulty: 2, genre: "Rock"    },
  { id: 2, title: "Nothing Else Matters",     artist: "Metallica",       difficulty: 3, genre: "Metal"   },
  { id: 3, title: "Wonderwall",               artist: "Oasis",           difficulty: 1, genre: "Rock"    },
  { id: 4, title: "Stairway to Heaven",       artist: "Led Zeppelin",    difficulty: 4, genre: "Rock"    },
  { id: 5, title: "Hotel California",         artist: "Eagles",          difficulty: 3, genre: "Rock"    },
];

const BASE_SESSION = buildMockSession();
const CLEAN_SESSION: PracticeSession = {
  ...BASE_SESSION,
  tabNotes: BASE_SESSION.tabNotes.map(n => ({ ...n, status: undefined })),
  feedback: undefined,
  metrics: undefined,
};

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
            className="fixed z-[101] top-20 left-1/2 -translate-x-1/2 w-full max-w-xl rounded-lg overflow-hidden"
            style={{ backgroundColor: "#2a2a2e", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <Search size={18} color="#8a8b8c" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search songs, artists…"
                className="flex-1 bg-transparent outline-none"
                style={{ color: "white", fontSize: 16, fontWeight: 300 }}
              />
              <button onClick={onClose} className="hover:opacity-70 transition-opacity">
                <X size={18} color="#8a8b8c" />
              </button>
            </div>

            {/* Results */}
            <div className="py-2">
              {filtered.length === 0 && (
                <p className="px-4 py-6 text-center" style={{ color: "#8a8b8c", fontSize: 14 }}>
                  No results
                </p>
              )}
              {filtered.map(song => (
                <button
                  key={song.id}
                  onClick={onClose}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:opacity-70 transition-opacity"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                >
                  {/* Difficulty dots */}
                  <div className="flex gap-0.5 shrink-0">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: i < song.difficulty ? "#238c35" : "rgba(255,255,255,0.15)" }}
                      />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ color: "white", fontSize: 15, fontWeight: 400, fontFamily: "Georgia, serif" }}>
                      {song.title}
                    </p>
                    <p style={{ color: "#8a8b8c", fontSize: 13, fontWeight: 300, marginTop: 2 }}>
                      {song.artist}
                    </p>
                  </div>
                  <span style={{ color: "#8a8b8c", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.3px" }}>
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
  const options = ["Tab", "Guitar Pro", "Chords", "Score"];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-full border hover:opacity-70 transition-opacity"
        style={{
          borderColor: "rgba(255,255,255,0.25)",
          padding: "4px 14px",
          color: "white",
          fontSize: 14,
          fontWeight: 300,
          backgroundColor: "transparent",
        }}
      >
        {value}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#238c35" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full mt-1 left-0 rounded-lg overflow-hidden z-20"
            style={{ backgroundColor: "#2a2a2e", border: "1px solid rgba(255,255,255,0.1)", minWidth: 140 }}
          >
            {options.map(opt => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className="w-full text-left px-4 py-2.5 hover:opacity-70 transition-opacity flex items-center gap-2"
                style={{ color: "white", fontSize: 14, fontWeight: 300, borderBottom: "1px solid rgba(255,255,255,0.04)" }}
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

// ── Star (like) button ───────────────────────────────────────────────────
function CircleBtn({ onClick, active, children }: { onClick?: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center rounded-full border hover:opacity-70 transition-opacity"
      style={{
        width: 32,
        height: 32,
        borderColor: active ? "#238c35" : "rgba(255,255,255,0.25)",
        color: active ? "#238c35" : "rgba(255,255,255,0.6)",
        backgroundColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function PracticePage() {
  const [session, setSession] = useState<PracticeSession>(CLEAN_SESSION);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [displayMode, setDisplayMode] = useState("Tab");
  const [searchOpen, setSearchOpen] = useState(false);

  const handleRecordingStart = useCallback(() => {
    setSession(s => ({
      ...s,
      tabNotes: BASE_SESSION.tabNotes.map(n => ({ ...n, status: undefined })),
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
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: "#1c1d1f", color: "white", fontWeight: 300 }}
    >
      {/* Search modal */}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Nav */}
      <Header onSearchOpen={() => setSearchOpen(true)} />

      {/* ── Song info ─────────────────────────────────────── */}
      <div
        className="shrink-0 flex flex-col items-center"
        style={{ backgroundColor: "#1c1d1f", paddingTop: 28, paddingBottom: 16 }}
      >
        {/* Title — Georgia, 45px, 300, #d6d6d6 */}
        <h1
          className="text-center"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 45,
            fontWeight: 300,
            color: "#d6d6d6",
            lineHeight: "45px",
            marginBottom: 0,
          }}
        >
          {session.songTitle}{" "}
          <span style={{ color: "#d6d6d6" }}>Tab</span>
        </h1>

        {/* Metadata row */}
        <div className="flex items-center gap-3 mt-5">
          <CircleBtn onClick={() => setLiked(l => !l)} active={liked}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? "#238c35" : "none"} stroke="currentColor" strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </CircleBtn>

          <DisplayDropdown value={displayMode} onChange={setDisplayMode} />

          <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.3px" }}>
            <span style={{ color: "#8a8b8c" }}>Published on:</span>
            <span style={{ color: "#238c35" }}>1/1/2020</span>
          </div>

          <CircleBtn>
            <RotateCcw size={13} />
          </CircleBtn>

          {/* Print — with green badge */}
          <div className="relative">
            <CircleBtn>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </CircleBtn>
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-white"
              style={{ backgroundColor: "#238c35", fontSize: 8, fontWeight: 700 }}
            >
              8
            </span>
          </div>
        </div>

        {/* Artist — 18px / 700 / white, centered */}
        <a
          href="#"
          className="hover:opacity-70 transition-opacity"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#238c35",
            textDecoration: "none",
            marginTop: 10,
            marginBottom: 12,
          }}
        >
          {session.artist}
        </a>

        {/* Upgrade banner */}
        <div
          className="flex items-center gap-3 px-4 py-2 rounded"
          style={{ backgroundColor: "rgba(35,140,53,0.12)", border: "1px solid rgba(35,140,53,0.3)" }}
        >
          <button
            className="hover:opacity-80 transition-opacity"
            style={{
              backgroundColor: "#238c35",
              borderRadius: 2,
              border: "none",
              color: "white",
              fontSize: 13,
              fontWeight: 500,
              padding: "4px 14px",
            }}
          >
            Upgrade to Plus
          </button>
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
            for Loop and slow down with just one click
          </span>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tab area */}
        <div className="flex-1 flex flex-col overflow-auto" style={{ backgroundColor: "#1c1d1f" }}>

          {/* Phrase nav bar */}
          <div
            className="flex items-center justify-between px-4 shrink-0"
            style={{ height: 36, borderBottom: "1px solid rgba(255,255,255,0.06)", backgroundColor: "#1c1d1f" }}
          >
            <button
              className="flex items-center gap-1 hover:opacity-70 transition-opacity"
              style={{ color: "#8a8b8c", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.3px", background: "none", border: "none" }}
            >
              <ChevronLeft size={13} />
              Prev phrase
            </button>
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
              Measures {session.startMeasure}–{session.endMeasure}
            </span>
            <button
              className="flex items-center gap-1 hover:opacity-70 transition-opacity"
              style={{ color: "#8a8b8c", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.3px", background: "none", border: "none" }}
            >
              Next phrase
              <ChevronRight size={13} />
            </button>
          </div>

          {/* Analysis strip */}
          <AnimatePresence>
            {(isAnalysing || hasRecorded) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden shrink-0"
              >
                <div
                  className="px-4 py-2 flex items-center gap-2"
                  style={{
                    backgroundColor: isAnalysing ? "rgba(35,99,235,0.1)" : "rgba(35,140,53,0.1)",
                    color: isAnalysing ? "#60a5fa" : "#238c35",
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: "0.3px",
                  }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: isAnalysing ? "#60a5fa" : "#238c35" }}
                  />
                  {isAnalysing ? "Aligning note events to tablature…" : "Analysis complete — results in Practice Coach →"}
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

        {/* AI Coach sidebar */}
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

      {/* Player bar */}
      <PlayerControls bpm={session.bpm} />
    </div>
  );
}
