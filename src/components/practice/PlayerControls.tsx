"use client";

// Exact Songsterr player bar styles extracted via CDP:
// Player bar bg:    rgb(42, 42, 46)  = #2a2a2e
// Player bar height: 74px
// Mixer/track btn:  rgb(55, 55, 59)  = #37373b, height 44px, width 86px, border-radius 2px
// Play button:      rgb(35, 140, 53) = #238c35, height 44px, width 51px, border-radius 2px
// Default buttons:  transparent bg, color white, height 74px, width 44px
// Disabled buttons: rgba(255,255,255,0.3)
// Speed btn:        width 64px

import { useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Volume2,
  VolumeX,
  Minus,
  Plus,
  Timer,
  Mic2,
  Download,
  MoreHorizontal,
  Pencil,
  Guitar,
  ChevronUp,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PlayerControlsProps {
  bpm: number;
}

function PlayerBtn({
  onClick,
  active,
  disabled: isDisabled,
  width = 44,
  height = 74,
  children,
  tip,
  bg,
  color,
}: {
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  width?: number;
  height?: number;
  children: React.ReactNode;
  tip?: string;
  bg?: string;
  color?: string;
}) {
  const defaultColor = isDisabled ? "rgba(255,255,255,0.3)" : color ?? "white";
  const defaultBg = active ? "rgba(255,255,255,0.12)" : bg ?? "transparent";

  const btn = (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className="flex flex-col items-center justify-center shrink-0 transition-opacity"
      style={{
        width,
        height,
        backgroundColor: defaultBg,
        color: defaultColor,
        borderRadius: bg ? 2 : 0,
        opacity: isDisabled ? 1 : undefined,
        cursor: isDisabled ? "default" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.opacity = "0.75";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.opacity = "1";
      }}
    >
      {children}
    </button>
  );

  if (!tip) return btn;
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs bg-zinc-800 border-zinc-700">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function PlayerControls({ bpm: initialBpm }: PlayerControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isMetronome, setIsMetronome] = useState(false);

  const clampSpeed = (v: number) => Math.min(200, Math.max(25, v));

  return (
    // height: 74px, bg: #2a2a2e, fixed at bottom
    <div
      className="shrink-0 flex items-center"
      style={{ height: 74, backgroundColor: "#2a2a2e" }}
    >
      {/* Mixer / track selector — #37373b, 86×44, radius 2 */}
      <div className="ml-2">
      <PlayerBtn
        width={86}
        height={44}
        tip="Track"
        bg="#37373b"
        color="white"
      >
        <div className="flex items-center gap-1.5 px-2">
          <Guitar style={{ width: 14, height: 14 }} />
          <div className="text-left">
            <div className="text-[10px] leading-tight truncate max-w-[54px]">Guitar Pro</div>
            <div className="text-[9px] leading-tight opacity-50">Track 1</div>
          </div>
          <ChevronUp style={{ width: 10, height: 10, opacity: 0.5 }} />
        </div>
      </PlayerBtn>
      </div>

      {/* Play / Pause — #238c35, 51×44 */}
      <div className="mx-1 flex">
        <button
          onClick={() => setIsPlaying((p) => !p)}
          className="flex items-center justify-center transition-opacity hover:opacity-80"
          style={{
            width: 51,
            height: 44,
            backgroundColor: "#238c35",
            borderRadius: 2,
            color: "white",
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause style={{ width: 18, height: 18 }} fill="white" />
          ) : (
            <Play style={{ width: 18, height: 18, marginLeft: 2 }} fill="white" />
          )}
        </button>
      </div>

      {/* Speed — transparent, 64px */}
      <div
        className="flex flex-col items-center justify-center shrink-0"
        style={{ width: 64, height: 74 }}
      >
        <button
          onClick={() => setSpeed((s) => clampSpeed(s + 5))}
          className="text-white/50 hover:text-white transition-colors"
          style={{ fontSize: 9, lineHeight: 1 }}
        >▲</button>
        <span className="text-[13px] text-white font-light leading-tight">{speed}%</span>
        <span className="text-[9px] text-white/40 uppercase tracking-widest leading-tight">Speed</span>
        <button
          onClick={() => setSpeed((s) => clampSpeed(s - 5))}
          className="text-white/50 hover:text-white transition-colors"
          style={{ fontSize: 9, lineHeight: 1 }}
        >▼</button>
      </div>

      {/* Pitch shift — disabled */}
      <PlayerBtn width={44} tip="Pitch shift" disabled color="rgba(255,255,255,0.3)">
        <RotateCcw style={{ width: 16, height: 16 }} />
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">Pitch</span>
      </PlayerBtn>

      {/* Loop */}
      <PlayerBtn width={44} active={isLooping} onClick={() => setIsLooping((l) => !l)} tip="Loop">
        <Repeat style={{ width: 16, height: 16 }} />
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">Loop</span>
      </PlayerBtn>

      {/* Solo — disabled */}
      <PlayerBtn width={44} tip="Solo" disabled>
        <div className="text-[12px] font-light">S</div>
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">Solo</span>
      </PlayerBtn>

      {/* Mute */}
      <PlayerBtn width={44} onClick={() => setIsMuted((m) => !m)} active={isMuted} tip="Mute">
        {isMuted ? (
          <VolumeX style={{ width: 16, height: 16 }} />
        ) : (
          <Volume2 style={{ width: 16, height: 16 }} />
        )}
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">Mute</span>
      </PlayerBtn>

      {/* Count in */}
      <PlayerBtn width={44} tip="Count in">
        <Timer style={{ width: 16, height: 16 }} />
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">Count</span>
      </PlayerBtn>

      {/* Metronome — disabled */}
      <PlayerBtn width={60} disabled tip="Metronome">
        <Mic2 style={{ width: 16, height: 16 }} />
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">Metronome</span>
      </PlayerBtn>

      {/* BPM display */}
      <div
        className="flex flex-col items-center justify-center shrink-0 px-2"
        style={{ minWidth: 48 }}
      >
        <span className="text-[13px] font-light text-white tabular-nums">{initialBpm}</span>
        <span className="text-[9px] text-white/40 uppercase tracking-widest">BPM</span>
      </div>

      <div className="flex-1" />

      {/* Right side: Download, More, Editor */}
      <PlayerBtn width={44} tip="Download">
        <Download style={{ width: 16, height: 16 }} />
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">DL</span>
      </PlayerBtn>

      <PlayerBtn width={44} tip="More">
        <MoreHorizontal style={{ width: 16, height: 16 }} />
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">More</span>
      </PlayerBtn>

      <PlayerBtn width={44} tip="Editor">
        <Pencil style={{ width: 16, height: 16 }} />
        <span className="text-[9px] mt-0.5 uppercase tracking-widest leading-none">Editor</span>
      </PlayerBtn>
    </div>
  );
}
