"use client";

// Exact Songsterr player bar from getComputedStyle():
// Bar bg: rgb(42,42,46) = #2a2a2e, height 74px
// Mixer btn: rgb(55,55,59) = #37373b, 86×44px, radius 2px
//   - instrument name: 13px/500/#a6a7a9
//   - track label: 12px/500/#a6a7a9
// Play btn: rgb(35,140,53) = #238c35, 74×44px, radius 2px, icon 35×35px
// Source toggle (ORIGINAL/SYNTH): green active bg, dark inactive
// Regular btns: transparent, white, height 74px
//   widths: Speed 64px, Loop/Solo/Mute/CountIn 51px, Metronome 66px, Download ~86px
// Button labels: 10px/500/uppercase/0.3px/#8a8b8c
// Disabled label: rgba(166,167,169,0.2), icon color rgba(255,255,255,0.3)

import { useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Volume2,
  VolumeX,
  Download,
  MoreHorizontal,
  Pencil,
  ChevronUp,
} from "lucide-react";

interface PlayerControlsProps {
  bpm: number;
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
  color: "#8a8b8c",
  lineHeight: "12px",
};

const DISABLED_LABEL_STYLE: React.CSSProperties = {
  ...LABEL_STYLE,
  color: "rgba(166,167,169,0.2)",
};

function Btn({
  width,
  height = 74,
  bg,
  disabled: isDisabled,
  active,
  onClick,
  label,
  children,
}: {
  width: number;
  height?: number;
  bg?: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const iconColor = isDisabled ? "rgba(255,255,255,0.3)" : "white";
  const bgColor = active ? "rgba(255,255,255,0.12)" : (bg ?? "transparent");

  return (
    <button
      onClick={onClick}
      disabled={isDisabled && !onClick}
      className="flex flex-col items-center justify-center shrink-0 transition-opacity hover:opacity-70"
      style={{
        width,
        height,
        backgroundColor: bgColor,
        color: iconColor,
        borderRadius: bg ? 2 : 0,
        cursor: isDisabled ? "default" : "pointer",
        border: "none",
        outline: "none",
      }}
    >
      {children}
      {label !== undefined && (
        <span style={isDisabled ? DISABLED_LABEL_STYLE : LABEL_STYLE}>
          {label}
        </span>
      )}
    </button>
  );
}

// Speed-specific button with large number display
function SpeedBtn({ speed, onUp, onDown }: { speed: number; onUp: () => void; onDown: () => void }) {
  return (
    <button
      className="flex flex-col items-center justify-center shrink-0 hover:opacity-70 transition-opacity"
      style={{ width: 64, height: 74, background: "transparent", border: "none", color: "white" }}
    >
      <span style={{ fontSize: 16, fontWeight: 300, lineHeight: "18px" }}>{speed}%</span>
      <span style={LABEL_STYLE}>Speed</span>
    </button>
  );
}

// Guitar icon for the mixer
function GuitarIcon({ color = "white" }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18c-2.5 0-5-2.5-5-5 0-1.5.5-3 1.5-4L14 1.5" />
      <path d="M15 6c1.5 1 2.5 2.5 2.5 4 0 2.5-2.5 5-5 5" />
      <circle cx="9" cy="18" r="1" fill="white" stroke="none" />
      <line x1="14" y1="2" x2="20" y2="8" />
    </svg>
  );
}

// Metronome icon
function MetronomeIcon({ color = "white" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 3 19 21 5 21" />
      <line x1="12" y1="21" x2="12" y2="3" />
      <line x1="12" y1="12" x2="18" y2="6" strokeWidth="2" />
    </svg>
  );
}

// Count-in icon (number in circle)
function CountIcon({ color = "white" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <text x="12" y="16" textAnchor="middle" fill={color} fontSize="12" fontWeight="500" stroke="none">3</text>
    </svg>
  );
}

// Solo headphones icon
function HeadphonesIcon({ color = "white" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

export default function PlayerControls({ bpm }: PlayerControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [source, setSource] = useState<"original" | "synth">("original");

  return (
    <div
      className="shrink-0 flex items-center"
      style={{ height: 74, backgroundColor: "#2a2a2e", borderTop: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Mixer / track selector — #37373b, 86×44, radius 2 */}
      <div style={{ padding: "0 8px" }}>
        <button
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
          style={{
            width: 86,
            height: 44,
            backgroundColor: "#37373b",
            borderRadius: 2,
            border: "none",
            padding: "0 10px",
            color: "white",
          }}
        >
          <GuitarIcon color="#a6a7a9" />
          <div className="flex flex-col items-start min-w-0 flex-1">
            <span style={{ fontSize: 13, fontWeight: 500, color: "#a6a7a9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 48 }}>
              Guitar Pro
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "#a6a7a9" }}>Track 1</span>
          </div>
          <ChevronUp size={12} color="#a6a7a9" />
        </button>
      </div>

      {/* Play button — #238c35, 74×44 */}
      <button
        onClick={() => setIsPlaying(p => !p)}
        className="flex items-center justify-center hover:opacity-80 transition-opacity shrink-0"
        style={{ width: 74, height: 44, backgroundColor: "#238c35", borderRadius: 2, border: "none", color: "white" }}
      >
        {isPlaying
          ? <Pause size={35} fill="white" color="white" />
          : <Play size={35} fill="white" color="white" style={{ marginLeft: 3 }} />
        }
      </button>

      {/* Source toggle: ORIGINAL / SYNTH */}
      <div className="flex items-center shrink-0 ml-1" style={{ height: 44 }}>
        {(["original", "synth"] as const).map(s => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className="flex flex-col items-center justify-center transition-colors"
            style={{
              height: 44,
              padding: "0 8px",
              backgroundColor: source === s ? "#238c35" : "#2e2e32",
              borderRadius: s === "original" ? "2px 0 0 2px" : "0 2px 2px 0",
              border: "none",
              color: "white",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              minWidth: 48,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Speed */}
      <SpeedBtn
        speed={speed}
        onUp={() => setSpeed(s => Math.min(200, s + 5))}
        onDown={() => setSpeed(s => Math.max(25, s - 5))}
      />

      {/* Loop */}
      <Btn width={51} active={isLooping} onClick={() => setIsLooping(l => !l)} label="Loop">
        <Repeat size={24} />
      </Btn>

      {/* Solo — disabled */}
      <Btn width={51} disabled label="Solo">
        <HeadphonesIcon color="rgba(255,255,255,0.3)" />
      </Btn>

      {/* Mute */}
      <Btn width={51} active={isMuted} onClick={() => setIsMuted(m => !m)} label="Mute">
        {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
      </Btn>

      {/* Count in */}
      <Btn width={51} label="Count in">
        <CountIcon />
      </Btn>

      {/* Metronome — disabled */}
      <Btn width={66} disabled label="Metronome">
        <MetronomeIcon color="rgba(255,255,255,0.3)" />
      </Btn>

      <div className="flex-1" />

      {/* BPM */}
      <div
        className="flex flex-col items-center justify-center shrink-0"
        style={{ width: 50, color: "rgba(255,255,255,0.4)" }}
      >
        <span style={{ fontSize: 14, fontWeight: 300, color: "white" }}>{bpm}</span>
        <span style={LABEL_STYLE}>BPM</span>
      </div>

      <div style={{ width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.08)", margin: "0 4px" }} />

      {/* Download */}
      <Btn width={86} label="Download">
        <Download size={24} />
      </Btn>

      {/* More */}
      <Btn width={50} label="More">
        <MoreHorizontal size={24} />
      </Btn>

      {/* Editor */}
      <Btn width={50} label="Editor">
        <Pencil size={24} />
      </Btn>
    </div>
  );
}
