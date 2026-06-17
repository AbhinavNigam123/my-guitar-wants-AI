"use client";

// Songsterr dark CSS tokens (from real stylesheet):
// --controls-surface-dark:          #2a2a2e   (bar bg)
// --controls-border-dark:           #ffffff14 (border)
// --controls-play-dark:             #238c35   (play btn)
// --controls-play-hover-dark:       #18b320
// --controls-feature-dark:          #8a8b8c   (icon btns)
// --controls-feature-hover-dark:    #bdbebf
// --controls-feature-chosen-dark:   #e6e6e6
// --controls-feature-disabled-dark: #a6a7a933
// --controls-mixer-dark:            #37373b   (mixer bg)
// --controls-mixer-hover-dark:      #46464b
// --controls-mixer-icon-dark:       #a6a7a9
// --mixer-text-dark:                #d6d6d6
// --play-button-source-dark:        #29362c   (inactive source toggle bg)
// --play-button-group-dark:         #05790b   (active source toggle bg)
// Font weights from tokens:
// --system-font-weight-light: 300
// --system-font-weight-bold:  500
// Button labels: 10px / 500 / uppercase / 0.3px

import { useState } from "react";
import { Play, Pause, Repeat, Volume2, VolumeX, Download, MoreHorizontal, Pencil, ChevronUp } from "lucide-react";

interface PlayerControlsProps {
  bpm: number;
}

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
  color: "#8a8b8c",
  lineHeight: "12px",
  marginTop: 3,
};
const LABEL_DISABLED: React.CSSProperties = {
  ...LABEL,
  color: "rgba(166,167,169,0.2)",
};

function FeatureBtn({
  width = 51,
  disabled,
  active,
  onClick,
  label,
  children,
}: {
  width?: number;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const iconColor = disabled
    ? "rgba(166,167,169,0.2)"
    : active
    ? "#e6e6e6"
    : "#8a8b8c";

  return (
    <button
      onClick={onClick}
      style={{
        width,
        height: 74,
        background: "transparent",
        border: "none",
        color: iconColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        position: "relative",
        padding: 0,
      }}
      onMouseEnter={e => {
        if (!disabled) e.currentTarget.style.color = "#bdbebf";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = iconColor;
      }}
    >
      {/* Active indicator bar at top — matches Songsterr --controls-item-chosen-before-dark */}
      {active && (
        <div style={{
          position: "absolute",
          top: 0,
          left: "20%",
          right: "20%",
          height: 2,
          backgroundColor: "#238c35",
          borderRadius: "0 0 2px 2px",
        }} />
      )}
      {children}
      {label !== undefined && (
        <span style={disabled ? LABEL_DISABLED : LABEL}>{label}</span>
      )}
    </button>
  );
}

// Icons
const HeadphonesIcon = ({ color }: { color: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
);
const MetronomeIcon = ({ color }: { color: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 21 L12 3 L19 21 Z" />
    <line x1="12" y1="21" x2="12" y2="11" />
    <line x1="12" y1="14" x2="17" y2="9" strokeWidth="2" />
  </svg>
);
const CountIcon = ({ color }: { color: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" />
    <text x="12" y="16.5" textAnchor="middle" fill={color} fontSize="11" fontWeight="500">3</text>
  </svg>
);
const SpeedIcon = ({ color }: { color: string }) => (
  <svg width="18" height="21" viewBox="0 0 18 21" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
    <circle cx="9" cy="11" r="7" />
    <line x1="9" y1="4" x2="9" y2="2" />
    <line x1="9" y1="11" x2="13" y2="7" strokeWidth="2" />
  </svg>
);
const GuitarIcon = ({ color }: { color: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
    <path d="M9 18c-2.5 0-5-2.5-5-5 0-1.5.5-3 2-4L14 2" />
    <path d="M15 6c1.5 1 2 2.5 2 4 0 2.5-2.5 5-5 5" />
    <circle cx="9" cy="18" r="1.5" fill={color} stroke="none" />
  </svg>
);

export default function PlayerControls({ bpm }: PlayerControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [source, setSource] = useState<"original" | "synth">("original");

  return (
    <div style={{
      height: 74,
      backgroundColor: "#2a2a2e",
      borderTop: "1px solid #ffffff14",
      display: "flex",
      alignItems: "center",
      flexShrink: 0,
    }}>

      {/* Mixer / track selector */}
      <div style={{ padding: "0 8px", flexShrink: 0 }}>
        <button
          style={{
            width: 86,
            height: 44,
            backgroundColor: "#37373b",
            borderRadius: 2,
            border: "none",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 8px",
            cursor: "pointer",
            color: "#a6a7a9",
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#46464b")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#37373b")}
        >
          <GuitarIcon color="#a6a7a9" />
          <div style={{ flex: 1, textAlign: "left", overflow: "hidden" }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#a6a7a9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Guitar Pro
            </div>
            <div style={{ fontSize: 10, fontWeight: 500, color: "#a6a7a9" }}>Track 1</div>
          </div>
          <ChevronUp size={10} color="#a6a7a9" />
        </button>
      </div>

      {/* Play button — #238c35, 74×44 */}
      <button
        onClick={() => setIsPlaying(p => !p)}
        style={{
          width: 74,
          height: 44,
          backgroundColor: "#238c35",
          borderRadius: 2,
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          color: "white",
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#18b320")}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#238c35")}
      >
        {isPlaying
          ? <Pause size={35} fill="white" color="white" />
          : <Play size={35} fill="white" color="white" style={{ marginLeft: 3 }} />
        }
      </button>

      {/* Source toggle: ORIGINAL / SYNTH */}
      <div style={{ display: "flex", marginLeft: 4, flexShrink: 0, height: 44 }}>
        {(["original", "synth"] as const).map(s => {
          const active = source === s;
          return (
            <button
              key={s}
              onClick={() => setSource(s)}
              style={{
                height: 44,
                padding: "0 10px",
                // Active: play-button-source-dark #29362c bg + green text
                // Inactive: darker bg
                backgroundColor: active ? "#29362c" : "#222225",
                border: "none",
                borderRadius: s === "original" ? "2px 0 0 2px" : "0 2px 2px 0",
                color: active ? "#238c35" : "#8a8b8c",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                cursor: "pointer",
                minWidth: 54,
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Speed */}
      <button
        style={{
          width: 64,
          height: 74,
          background: "transparent",
          border: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#8a8b8c",
          flexShrink: 0,
          gap: 2,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#bdbebf")}
        onMouseLeave={e => (e.currentTarget.style.color = "#8a8b8c")}
      >
        <SpeedIcon color="currentColor" />
        <span style={{ fontSize: 14, fontWeight: 300, color: "white", lineHeight: "16px" }}>{speed}%</span>
        <span style={LABEL}>Speed</span>
      </button>

      {/* Loop */}
      <FeatureBtn active={isLooping} onClick={() => setIsLooping(l => !l)} label="Loop">
        <Repeat size={24} />
      </FeatureBtn>

      {/* Solo — disabled */}
      <FeatureBtn disabled label="Solo">
        <HeadphonesIcon color="rgba(166,167,169,0.2)" />
      </FeatureBtn>

      {/* Mute */}
      <FeatureBtn active={isMuted} onClick={() => setIsMuted(m => !m)} label="Mute">
        {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
      </FeatureBtn>

      {/* Count in */}
      <FeatureBtn label="Count in">
        <CountIcon color="#8a8b8c" />
      </FeatureBtn>

      {/* Metronome — disabled */}
      <FeatureBtn disabled width={66} label="Metronome">
        <MetronomeIcon color="rgba(166,167,169,0.2)" />
      </FeatureBtn>

      <div style={{ flex: 1 }} />

      {/* BPM readout */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 300, color: "#d6d6d6" }}>{bpm}</span>
        <span style={LABEL}>BPM</span>
      </div>

      <div style={{ width: 1, height: 30, backgroundColor: "#ffffff14", margin: "0 4px", flexShrink: 0 }} />

      {/* Download */}
      <FeatureBtn width={86} label="Download">
        <Download size={22} />
      </FeatureBtn>

      {/* More */}
      <FeatureBtn width={50} label="More">
        <MoreHorizontal size={22} />
      </FeatureBtn>

      {/* Editor */}
      <FeatureBtn width={50} label="Editor">
        <Pencil size={22} />
      </FeatureBtn>
    </div>
  );
}
