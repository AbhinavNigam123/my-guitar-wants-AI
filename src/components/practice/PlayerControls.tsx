"use client";

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Play, Pause, Repeat, Volume2, VolumeX, Download, MoreHorizontal, Pencil } from "lucide-react";

interface PlayerControlsProps {
  bpm: number;
  isPlaying?: boolean;
  source?: "original" | "synth";
  canPlayOriginal?: boolean;
  editorMode?: boolean;
  speed?: number;
  loopEnabled?: boolean;
  loopMeasureRegion?: { startMeasure: number; endMeasure: number } | null;
  totalMeasures?: number;
  metronomeEnabled?: boolean;
  metronomeVolume?: number;
  onPlayPause?: () => void;
  onSourceChange?: (s: "original" | "synth") => void;
  onEditorToggle?: () => void;
  onBpmChange?: (bpm: number) => void;
  onSpeedChange?: (pct: number) => void;
  onLoopToggle?: () => void;
  onLoopRangeChange?: (start: number, end: number) => void;
  /** Clear the current loop selection / highlight. */
  onLoopClear?: () => void;
  onMetronomeToggle?: () => void;
  onMetronomeVolumeChange?: (v: number) => void;
}

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
  color: "#8a8b8c",
  lineHeight: "12px",
  marginTop: -2,
  whiteSpace: "nowrap",
};

const SPEED_MIN = 15;
const SPEED_MAX = 175;
const SPEED_STEP = 5;

function snapSpeed(v: number): number {
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(v / SPEED_STEP) * SPEED_STEP));
}

// ── Portal popover — renders above everything, not clipped by player bar ──
function PlayerPopover({
  anchorRef,
  popoverRef,
  open,
  width = 300,
  children,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  width?: number;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      setPos({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + 8,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        left: pos.left,
        bottom: pos.bottom,
        transform: "translateX(-50%)",
        width,
        zIndex: 10000,
        backgroundColor: "var(--ss-controls-surface)",
        border: "1px solid var(--ss-panel-border)",
        borderRadius: 8,
        padding: "12px 14px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function useOutsideClose(
  anchorRef: React.RefObject<HTMLElement | null>,
  popoverRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchorRef, popoverRef, onClose, enabled]);
}

// ── Icons ─────────────────────────────────────────────────────────────────
const GuitarIcon = ({ color }: { color: string }) => (
  <svg width="27" height="28" viewBox="0 0 27 28" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="13.5" cy="19" rx="7" ry="7" />
    <path d="M13.5 12V5" />
    <path d="M11 5h5" /><path d="M11 7h5" /><path d="M11 9h5" />
    <path d="M12 12a2 2 0 0 0 3 0" />
    <circle cx="13.5" cy="19" r="1.3" fill={color} stroke="none" />
  </svg>
);

const MixerArrow = ({ color }: { color: string }) => (
  <svg role="img" width="13" height="8" viewBox="0 0 13 8" fill={color}>
    <path d="M12.68 7.74a1 1 0 0 0 .06-1.42L7.38.5a1.95 1.95 0 0 0-.88-.4c-.24 0-.66.23-.88.4L.26 6.32a1 1 0 0 0 1.48 1.36l5.35-5.84c-.14.08-.46.26-.59.26-.13 0-.45-.18-.59-.26l5.35 5.84a1 1 0 0 0 1.42.06Z" />
  </svg>
);

const SpeedIcon = ({ color }: { color: string }) => (
  <svg width="18" height="21" viewBox="0 0 18 21" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round">
    <circle cx="9" cy="11" r="7" />
    <line x1="9" y1="4.2" x2="9" y2="3" />
    <line x1="9" y1="11" x2="13" y2="7.5" strokeWidth="1.8" />
    <circle cx="9" cy="11" r="1" fill={color} stroke="none" />
  </svg>
);

const PitchShiftIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="9" x2="14" y2="9" /><line x1="4" y1="15" x2="14" y2="15" />
    <polyline points="11 6 14 9 11 12" /><polyline points="11 12 14 15 11 18" />
  </svg>
);

const SoloIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
);

const CountInIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.5" />
    <text x="12" y="16.5" textAnchor="middle" fill="currentColor" fontSize="10.5" fontWeight="500">3</text>
  </svg>
);

const MetronomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 21L12 4L19 21Z" />
    <line x1="12" y1="21" x2="12" y2="11" />
    <line x1="12" y1="14" x2="16.5" y2="9.5" strokeWidth="1.8" />
  </svg>
);

function FeatureBtn({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const iconColor = active ? "#e6e6e6" : "#8a8b8c";
  return (
    <div style={{ minWidth: 44, height: "100%", flexShrink: 0, position: "relative" }}>
      <button
        onClick={onClick}
        style={{
          background: "transparent", border: "none",
          flexDirection: "column", justifyContent: "center", alignItems: "center",
          width: "100%", height: "100%", padding: 0,
          cursor: "pointer", display: "flex", position: "relative",
          color: iconColor,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "#bdbebf"; }}
        onMouseLeave={e => { e.currentTarget.style.color = iconColor; }}
      >
        {active && (
          <div style={{
            position: "absolute", top: 0, left: "20%", right: "20%",
            height: 2, backgroundColor: "#238c35", borderRadius: "0 0 2px 2px",
          }} />
        )}
        <div style={{ marginBottom: 3, display: "flex" }}>{children}</div>
        {label !== undefined && <span style={LABEL}>{label}</span>}
      </button>
    </div>
  );
}

function BpmControl({ bpm, onChange }: { bpm: number; onChange: (b: number) => void }) {
  const btnStyle: React.CSSProperties = {
    background: "transparent", border: "none", color: "#8a8b8c",
    fontSize: 22, lineHeight: 1, cursor: "pointer", padding: "0 8px",
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
      padding: "4px 0 12px", borderBottom: "1px solid #3c3b40", marginBottom: 12,
    }}>
      <button type="button" style={btnStyle} onClick={() => onChange(Math.max(30, bpm - 1))} aria-label="Decrease BPM">−</button>
      <span style={{ fontSize: 15, fontWeight: 600, color: "#238c35", minWidth: 72, textAlign: "center" }}>
        {Math.round(bpm)} bpm
      </span>
      <button type="button" style={btnStyle} onClick={() => onChange(Math.min(240, bpm + 1))} aria-label="Increase BPM">+</button>
    </div>
  );
}

function SpeedSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ticks: { v: number; major: boolean }[] = [];
  for (let v = SPEED_MIN; v <= SPEED_MAX; v += SPEED_STEP) {
    ticks.push({ v, major: (v - SPEED_MIN) % 15 === 0 || v === SPEED_MAX });
  }
  const majorTicks = ticks.filter(t => t.major);

  return (
    <div>
      {/* Major labels */}
      <div style={{ position: "relative", height: 18, margin: "0 8px 4px" }}>
        {majorTicks.map(({ v }) => {
          const p = ((v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
          const active = value === v;
          return (
            <span
              key={v}
              style={{
                position: "absolute",
                left: `${p}%`,
                transform: "translateX(-50%)",
                fontSize: 11,
                fontWeight: active ? 700 : 400,
                color: active ? "#ffffff" : "#6d6d6d",
              }}
            >
              {v}
            </span>
          );
        })}
      </div>

      {/* Tick marks + track */}
      <div style={{ position: "relative", height: 40, margin: "0 8px" }}>
        {ticks.map(({ v, major }) => {
          const p = ((v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
          return (
            <div
              key={v}
              style={{
                position: "absolute",
                left: `${p}%`,
                bottom: 18,
                width: 1,
                height: major ? 10 : 5,
                backgroundColor: "#6d6d6d",
                transform: "translateX(-50%)",
                pointerEvents: "none",
              }}
            />
          );
        })}
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 16,
          height: 2, backgroundColor: "#4a4a4e", pointerEvents: "none",
        }} />
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={value}
          onChange={e => onChange(snapSpeed(Number(e.target.value)))}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            width: "100%", margin: 0, accentColor: "#238c35",
            cursor: "pointer",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 2, paddingRight: 4 }}>
        <SpeedIcon color="#6d6d6d" />
        <span style={{ fontSize: 16, color: "#8a8b8c" }}>%</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function PlayerControls({
  isPlaying: isPlayingProp,
  source: sourceProp,
  canPlayOriginal = false,
  editorMode = false,
  bpm,
  speed: speedProp = 100,
  loopEnabled = false,
  loopMeasureRegion = null,
  totalMeasures = 20,
  metronomeEnabled = false,
  metronomeVolume: metronomeProp = 0.5,
  onPlayPause,
  onSourceChange,
  onEditorToggle,
  onBpmChange,
  onSpeedChange,
  onLoopToggle,
  onLoopRangeChange,
  onLoopClear,
  onMetronomeToggle,
  onMetronomeVolumeChange,
}: PlayerControlsProps) {
  const [isPlayingLocal, setIsPlayingLocal] = useState(false);
  const isPlaying = isPlayingProp ?? isPlayingLocal;
  const [sourceLocal, setSourceLocal] = useState<"original" | "synth">("synth");
  const source = sourceProp ?? sourceLocal;
  const [isMuted, setIsMuted] = useState(false);

  const [speedOpen, setSpeedOpen] = useState(false);
  const [loopOpen, setLoopOpen] = useState(false);
  const [metronomeOpen, setMetronomeOpen] = useState(false);

  const [loopFrom, setLoopFrom] = useState(loopMeasureRegion?.startMeasure ?? 1);
  const [loopTo, setLoopTo] = useState(loopMeasureRegion?.endMeasure ?? totalMeasures);

  const [syncedLoopRegion, setSyncedLoopRegion] = useState(loopMeasureRegion);
  if (loopMeasureRegion !== syncedLoopRegion) {
    setSyncedLoopRegion(loopMeasureRegion);
    if (loopMeasureRegion) {
      setLoopFrom(loopMeasureRegion.startMeasure);
      setLoopTo(loopMeasureRegion.endMeasure);
    }
  }

  const speedAnchorRef = useRef<HTMLDivElement>(null);
  const speedPopoverRef = useRef<HTMLDivElement>(null);
  const loopAnchorRef = useRef<HTMLDivElement>(null);
  const loopPopoverRef = useRef<HTMLDivElement>(null);
  const metronomeAnchorRef = useRef<HTMLDivElement>(null);
  const metronomePopoverRef = useRef<HTMLDivElement>(null);

  useOutsideClose(speedAnchorRef, speedPopoverRef, () => setSpeedOpen(false), speedOpen);
  useOutsideClose(loopAnchorRef, loopPopoverRef, () => setLoopOpen(false), loopOpen);
  useOutsideClose(metronomeAnchorRef, metronomePopoverRef, () => setMetronomeOpen(false), metronomeOpen);

  function closeOthers(except: "speed" | "loop" | "metronome" | null) {
    if (except !== "speed") setSpeedOpen(false);
    if (except !== "loop") setLoopOpen(false);
    if (except !== "metronome") setMetronomeOpen(false);
  }

  function commitLoopRange() {
    const s = Math.max(1, Math.min(loopFrom, totalMeasures));
    const e = Math.max(s, Math.min(loopTo, totalMeasures));
    onLoopRangeChange?.(s, e);
  }

  return (
    <div style={{
      height: 74,
      backgroundColor: "var(--ss-controls-surface)",
      borderTop: "1px solid var(--ss-controls-border)",
      display: "flex",
      alignItems: "center",
      flexShrink: 0,
      overflow: "visible",
      position: "relative",
      zIndex: 200,
      width: "100%",
    }}>
      <div style={{ display: "flex", alignItems: "center", width: "100%", height: "100%" }}>

      <div style={{
        flex: 4, justifyContent: "space-between", alignItems: "center",
        height: "100%", marginLeft: 50, display: "flex", position: "relative",
      }}>

      <button
        style={{
          width: 254, height: 44, backgroundColor: "var(--ss-controls-btn)", border: "none", borderRadius: 2,
          display: "flex", flexFlow: "row", justifyContent: "space-between", alignItems: "center",
          padding: 0, cursor: "pointer", color: "var(--ss-text-secondary)", flexShrink: 0,
          transition: "background 0.2s ease-in-out",
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--ss-controls-btn-hover)")}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "var(--ss-controls-btn)")}
      >
        <div style={{ flexShrink: 0, minWidth: 46, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <GuitarIcon color="#a6a7a9" />
        </div>
        <div style={{ flexDirection: "column", justifyContent: "center", maxWidth: 168, height: 44, display: "flex", overflow: "hidden" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#a6a7a9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 5, textAlign: "left" }}>
            Acoustic Guitar (steel)
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#a6a7a9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 5, paddingTop: 2, textAlign: "left" }}>
            Jimmy Page | Harmony Sovereign
          </div>
        </div>
        <div style={{ flexShrink: 0, width: 40, height: 44, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 18, position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 1, backgroundColor: "rgba(255,255,255,0.08)" }} />
          <MixerArrow color="#a6a7a9" />
        </div>
      </button>

      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={() => { if (onPlayPause) onPlayPause(); else setIsPlayingLocal(p => !p); }}
          style={{
            width: 74, height: 44, backgroundColor: "#238c35",
            borderRadius: "2px 0 0 2px", border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0, color: "white",
            transition: "background 0.2s ease-in-out",
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#18b320")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#238c35")}
        >
          {isPlaying
            ? <Pause size={28} fill="white" color="white" />
            : <Play size={28} fill="white" color="white" style={{ marginLeft: 3 }} />}
        </button>

        <div style={{ display: "flex", flexDirection: "column", marginLeft: 2, height: 44, flexShrink: 0 }}
          title={canPlayOriginal ? "Switch playback source" : "Record & generate tab to unlock Original"}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px", color: "#6d6d6d", textAlign: "center", lineHeight: "14px", paddingBottom: 1 }}>
            Source
          </div>
          <div style={{ display: "flex", backgroundColor: "var(--ss-controls-btn)", borderRadius: 2, overflow: "hidden", height: 30 }}>
            {([{ id: "original" as const, label: "Original" }, { id: "synth" as const, label: "Synth" }]).map(({ id, label }) => {
              const isActive = source === id;
              const disabled = id === "original" && !canPlayOriginal;
              return (
                <button key={id}
                  onClick={() => { if (disabled) return; if (onSourceChange) onSourceChange(id); else setSourceLocal(id); }}
                  disabled={disabled}
                  style={{
                    minWidth: 72, padding: "0 10px", fontSize: 11, fontWeight: 600,
                    color: disabled ? "#4a4a4e" : isActive ? "white" : "#a6a7a9",
                    backgroundColor: isActive && !disabled ? "#238c35" : "transparent",
                    border: "none", cursor: disabled ? "not-allowed" : "pointer",
                  }}
                >{label}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Speed ── */}
      <div ref={speedAnchorRef} style={{ minWidth: 64, height: "100%", flexShrink: 0, position: "relative" }}>
        <button
          onClick={() => { setSpeedOpen(o => !o); closeOthers(speedOpen ? null : "speed"); }}
          style={{
            background: "transparent", border: "none",
            flexDirection: "column", justifyContent: "center", alignItems: "center",
            width: "100%", height: "100%", padding: 0, cursor: "pointer", display: "flex",
            color: speedProp !== 100 ? "#e6e6e6" : "#8a8b8c", position: "relative",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "#bdbebf")}
          onMouseLeave={e => (e.currentTarget.style.color = speedProp !== 100 ? "#e6e6e6" : "#8a8b8c")}
        >
          {(speedProp !== 100 || speedOpen) && (
            <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 2, backgroundColor: "#238c35", borderRadius: "0 0 2px 2px" }} />
          )}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 5, height: 24, marginBottom: 3 }}>
            <SpeedIcon color="currentColor" />
            <span style={{ fontSize: 13, fontWeight: 500, color: "inherit", minWidth: 35 }}>{speedProp}%</span>
          </div>
          <span style={LABEL}>Speed</span>
        </button>

        <PlayerPopover anchorRef={speedAnchorRef} popoverRef={speedPopoverRef} open={speedOpen} width={320}>
          {onBpmChange && <BpmControl bpm={bpm} onChange={onBpmChange} />}
          <SpeedSlider value={speedProp} onChange={v => onSpeedChange?.(v)} />
        </PlayerPopover>
      </div>

      <FeatureBtn label="Pitch shift"><PitchShiftIcon /></FeatureBtn>

      {/* ── Loop ── */}
      <div ref={loopAnchorRef} style={{ minWidth: 44, height: "100%", flexShrink: 0, position: "relative" }}>
        <button
          onClick={() => { setLoopOpen(o => !o); closeOthers(loopOpen ? null : "loop"); }}
          style={{
            background: "transparent", border: "none",
            flexDirection: "column", justifyContent: "center", alignItems: "center",
            width: "100%", height: "100%", padding: 0,
            cursor: "pointer", display: "flex", position: "relative",
            color: loopEnabled ? "#e6e6e6" : "#8a8b8c",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#bdbebf"; }}
          onMouseLeave={e => { e.currentTarget.style.color = loopEnabled ? "#e6e6e6" : "#8a8b8c"; }}
        >
          {(loopEnabled || loopOpen) && (
            <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 2, backgroundColor: "#238c35", borderRadius: "0 0 2px 2px" }} />
          )}
          <div style={{ marginBottom: 3, display: "flex" }}><Repeat size={22} /></div>
          <span style={LABEL}>Loop</span>
        </button>

        <PlayerPopover anchorRef={loopAnchorRef} popoverRef={loopPopoverRef} open={loopOpen} width={220}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px", color: "#6d6d6d" }}>
              Loop
            </div>
            <button
              type="button"
              onMouseDown={event => {
                // Keep range-input blur from auto-enabling and then immediately
                // toggling the loop back off in the same pointer interaction.
                event.preventDefault();
              }}
              onClick={() => {
                if (loopEnabled) onLoopToggle?.();
                else commitLoopRange();
              }}
              style={{
                background: loopEnabled ? "#238c35" : "#37373b",
                border: "none", borderRadius: 10, padding: "3px 10px",
                fontSize: 10, fontWeight: 600, color: loopEnabled ? "white" : "#8a8b8c",
                cursor: "pointer",
              }}
            >
              {loopEnabled ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: "#8a8b8c", marginBottom: 3 }}>From</div>
              <input
                type="number" min={1} max={totalMeasures} value={loopFrom}
                onChange={e => setLoopFrom(Number(e.target.value))}
                onKeyDown={e => e.key === "Enter" && commitLoopRange()}
                style={{
                  width: "100%", background: "#37373b", border: "1px solid #3c3b40",
                  borderRadius: 3, color: "#e6e6e6", fontSize: 12, padding: "4px 6px", outline: "none",
                }}
              />
            </div>
            <span style={{ color: "#8a8b8c", marginTop: 18 }}>–</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: "#8a8b8c", marginBottom: 3 }}>To</div>
              <input
                type="number" min={1} max={totalMeasures} value={loopTo}
                onChange={e => setLoopTo(Number(e.target.value))}
                onKeyDown={e => e.key === "Enter" && commitLoopRange()}
                style={{
                  width: "100%", background: "#37373b", border: "1px solid #3c3b40",
                  borderRadius: 3, color: "#e6e6e6", fontSize: 12, padding: "4px 6px", outline: "none",
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={commitLoopRange}
            style={{
              width: "100%",
              marginBottom: 8,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid rgba(35,140,53,0.5)",
              background: "rgba(35,140,53,0.14)",
              color: "#63c174",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Apply loop · M{Math.max(1, Math.min(loopFrom, totalMeasures))}–M{Math.max(
              Math.max(1, Math.min(loopFrom, totalMeasures)),
              Math.min(loopTo, totalMeasures),
            )}
          </button>
          {loopMeasureRegion && (
            <button
              type="button"
              onClick={() => {
                onLoopClear?.();
                setLoopOpen(false);
              }}
              style={{
                width: "100%", marginBottom: 8, padding: "6px 8px", borderRadius: 4,
                background: "transparent", border: "1px solid #4a4a4e",
                color: "#c4c4c6", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              Clear loop · M{loopMeasureRegion.startMeasure}–{loopMeasureRegion.endMeasure}
            </button>
          )}
          <div style={{ fontSize: 10, color: "#6d6d6d" }}>
            Drag measures on the tab to set · Esc to clear
          </div>
        </PlayerPopover>
      </div>

      <FeatureBtn label="Solo"><SoloIcon /></FeatureBtn>
      <FeatureBtn active={isMuted} onClick={() => setIsMuted(m => !m)} label="Mute">
        {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
      </FeatureBtn>
      <FeatureBtn label="Count in"><CountInIcon /></FeatureBtn>

      {/* ── Metronome ── */}
      <div ref={metronomeAnchorRef} style={{ minWidth: 44, height: "100%", flexShrink: 0, position: "relative" }}>
        <button
          onClick={() => { setMetronomeOpen(o => !o); closeOthers(metronomeOpen ? null : "metronome"); }}
          style={{
            background: "transparent", border: "none",
            flexDirection: "column", justifyContent: "center", alignItems: "center",
            width: "100%", height: "100%", padding: 0,
            cursor: "pointer", display: "flex", position: "relative",
            color: metronomeEnabled ? "#e6e6e6" : "#8a8b8c",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#bdbebf"; }}
          onMouseLeave={e => { e.currentTarget.style.color = metronomeEnabled ? "#e6e6e6" : "#8a8b8c"; }}
        >
          {(metronomeEnabled || metronomeOpen) && (
            <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 2, backgroundColor: "#238c35", borderRadius: "0 0 2px 2px" }} />
          )}
          <div style={{ marginBottom: 3, display: "flex" }}><MetronomeIcon /></div>
          <span style={LABEL}>Metronome</span>
        </button>

        <PlayerPopover anchorRef={metronomeAnchorRef} popoverRef={metronomePopoverRef} open={metronomeOpen} width={220}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px", color: "#6d6d6d" }}>
              Metronome
            </div>
            <button
              type="button"
              onClick={() => onMetronomeToggle?.()}
              style={{
                background: metronomeEnabled ? "#238c35" : "#37373b",
                border: "none", borderRadius: 10, padding: "3px 10px",
                fontSize: 10, fontWeight: 600, color: metronomeEnabled ? "white" : "#8a8b8c",
                cursor: "pointer",
              }}
            >
              {metronomeEnabled ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "#8a8b8c", marginBottom: 6 }}>Volume</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range" min={0} max={1} step={0.05}
              value={metronomeProp}
              onChange={e => onMetronomeVolumeChange?.(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#238c35", cursor: "pointer" }}
            />
            <span style={{ fontSize: 11, color: "#a6a7a9", minWidth: 34, textAlign: "right" }}>
              {Math.round(metronomeProp * 100)}%
            </span>
          </div>
        </PlayerPopover>
      </div>

      <FeatureBtn label="Download"><Download size={22} /></FeatureBtn>
      <FeatureBtn label="More"><MoreHorizontal size={22} /></FeatureBtn>
      </div>

      <div style={{ flex: 1, justifyContent: "flex-end", alignItems: "flex-end", height: "100%", marginRight: 50, display: "flex" }}>
        <FeatureBtn label="Editor" active={editorMode} onClick={onEditorToggle}><Pencil size={20} /></FeatureBtn>
      </div>

      </div>
    </div>
  );
}
