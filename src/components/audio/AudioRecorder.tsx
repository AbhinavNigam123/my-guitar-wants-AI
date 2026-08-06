"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";

export type RecorderState = "idle" | "requesting" | "counting-in" | "recording" | "stopped" | "error";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob, durationMs: number) => void;
  onRecordingStart?: () => void;
  onRecordingTick?: (elapsedMs: number) => void;
  /** Fired when user cancels during count-in — no blob, no session side-effects. */
  onRecordingCancel?: () => void;
  disabled?: boolean;
  isLive?: boolean;
  /** When set, plays this many metronome clicks before auto-starting the recording. */
  countInBeats?: number;
  /** BPM for the count-in metronome (required if countInBeats is set). */
  bpm?: number;
  /** Beats per measure for count-in downbeat accents. */
  beatsPerMeasure?: number;
  /** Continue an audio-clock-scheduled metronome after the count-in while recording. */
  metronomeDuringRecording?: boolean;
  idleLabel?: string;
  idleDescription?: string;
}

const BAR_COUNT = 40;

// Mic SVG icon (inline, no lucide dependency in the button)
const MicIcon = ({ size = 22, color = "white" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const StopSquare = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="white" stroke="none">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

export default function AudioRecorder({
  onRecordingComplete,
  onRecordingStart,
  onRecordingTick,
  onRecordingCancel,
  disabled,
  isLive,
  countInBeats,
  bpm,
  beatsPerMeasure = 4,
  metronomeDuringRecording = false,
  idleLabel,
  idleDescription,
}: AudioRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [countInRemaining, setCountInRemaining] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.05));
  const [errorMsg, setErrorMsg] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countInAbortRef = useRef(false);
  const countInTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingMetronomeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metCtxRef = useRef<AudioContext | null>(null);

  const clearCountInTimers = useCallback(() => {
    if (countInTimeoutRef.current) {
      clearTimeout(countInTimeoutRef.current);
      countInTimeoutRef.current = null;
    }
    if (recordingMetronomeTimerRef.current) {
      clearInterval(recordingMetronomeTimerRef.current);
      recordingMetronomeTimerRef.current = null;
    }
    if (metCtxRef.current) {
      metCtxRef.current.close().catch(() => {});
      metCtxRef.current = null;
    }
  }, []);

  const stopAnimLoop = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopAnimLoop();
    clearCountInTimers();
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, [stopAnimLoop, clearCountInTimers]);

  useEffect(() => () => cleanup(), [cleanup]);

  const startAnalysis = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      const bucketSize = Math.floor(dataArray.length / BAR_COUNT);
      const newBars = Array.from({ length: BAR_COUNT }, (_, i) => {
        const slice = dataArray.slice(i * bucketSize, (i + 1) * bucketSize);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
        return Math.max(0.05, avg / 255);
      });
      setBars(newBars);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMsg("");
    countInAbortRef.current = false;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (countInAbortRef.current) {
        stream.getTracks().forEach(t => t.stop());
        setState("idle");
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const duration = Date.now() - startTimeRef.current;
        onRecordingComplete(blob, duration);
        setState("stopped");
        setBars(Array(BAR_COUNT).fill(0.05));
      };

      // Optional count-in metronome before recording
      if (countInBeats && countInBeats > 0 && bpm && bpm > 0) {
        setState("counting-in");
        setCountInRemaining(countInBeats);
        const beatMs = (60 / bpm) * 1000;
        const metCtx = new AudioContext();
        metCtxRef.current = metCtx;
        await new Promise<void>((resolve, reject) => {
          let beat = 0;
          const tick = () => {
            if (countInAbortRef.current) {
              clearCountInTimers();
              reject(new Error("cancelled"));
              return;
            }
            const osc = metCtx.createOscillator();
            const g   = metCtx.createGain();
            const isDownbeat = beat % beatsPerMeasure === 0;
            osc.frequency.value = isDownbeat ? 880 : 660;
            g.gain.setValueAtTime(0.4, metCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, metCtx.currentTime + 0.08);
            osc.connect(g);
            g.connect(metCtx.destination);
            osc.start();
            osc.stop(metCtx.currentTime + 0.09);
            beat++;
            setCountInRemaining(Math.max(0, countInBeats - beat));
            if (beat < countInBeats) {
              countInTimeoutRef.current = setTimeout(tick, beatMs);
            } else {
              // Start the take on the beat after the final count-in click.
              countInTimeoutRef.current = setTimeout(() => {
                metCtx.close();
                metCtxRef.current = null;
                countInTimeoutRef.current = null;
                resolve();
              }, beatMs);
            }
          };
          tick();
        });
      }

      if (countInAbortRef.current) {
        cleanup();
        setState("idle");
        return;
      }

      recorder.start(100);
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      setState("recording");
      onRecordingStart?.();
      onRecordingTick?.(0);

      if (metronomeDuringRecording && bpm && bpm > 0) {
        const metCtx = new AudioContext();
        metCtxRef.current = metCtx;
        if (metCtx.state === "suspended") await metCtx.resume();
        const secondsPerBeat = 60 / bpm;
        let nextClickTime = metCtx.currentTime + 0.02;
        let beatIndex = 0;
        const scheduleClick = (atTime: number, index: number) => {
          const osc = metCtx.createOscillator();
          const gain = metCtx.createGain();
          osc.type = "square";
          osc.frequency.value = index % beatsPerMeasure === 0 ? 880 : 660;
          gain.gain.setValueAtTime(0, atTime);
          gain.gain.linearRampToValueAtTime(0.12, atTime + 0.003);
          gain.gain.exponentialRampToValueAtTime(0.001, atTime + 0.06);
          osc.connect(gain);
          gain.connect(metCtx.destination);
          osc.start(atTime);
          osc.stop(atTime + 0.07);
        };
        const scheduleAhead = () => {
          while (nextClickTime < metCtx.currentTime + 0.15) {
            scheduleClick(nextClickTime, beatIndex);
            nextClickTime += secondsPerBeat;
            beatIndex++;
          }
        };
        scheduleAhead();
        recordingMetronomeTimerRef.current = setInterval(scheduleAhead, 25);
      }

      timerRef.current = setInterval(() => {
        const nextElapsed = Date.now() - startTimeRef.current;
        setElapsedMs(nextElapsed);
        onRecordingTick?.(nextElapsed);
      }, 100);

      startAnalysis(stream);
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") {
        cleanup();
        setState("idle");
        setCountInRemaining(0);
        onRecordingCancel?.();
        return;
      }
      const msg = err instanceof Error ? err.message : "Microphone access denied.";
      setErrorMsg(msg);
      setState("error");
      cleanup();
    }
  }, [onRecordingComplete, onRecordingStart, onRecordingTick, onRecordingCancel, cleanup, startAnalysis, clearCountInTimers, countInBeats, bpm, beatsPerMeasure, metronomeDuringRecording]);

  const cancelCountIn = useCallback(() => {
    countInAbortRef.current = true;
    clearCountInTimers();
    cleanup();
    setState("idle");
    setCountInRemaining(0);
    setBars(Array(BAR_COUNT).fill(0.05));
    onRecordingCancel?.();
  }, [cleanup, clearCountInTimers, onRecordingCancel]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setElapsedMs(0);
    setCountInRemaining(0);
    setBars(Array(BAR_COUNT).fill(0.05));
    setErrorMsg("");
  }, []);

  const formatTime = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const min = Math.floor(total / 60).toString().padStart(2, "0");
    const sec = (total % 60).toString().padStart(2, "0");
    const tenths = Math.floor((ms % 1000) / 100);
    return `${min}:${sec}.${tenths}`;
  };

  const stateLabel = () => {
    if (state === "idle") return idleLabel ?? (isLive ? "Live input ready" : "Ready to record");
    if (state === "requesting") return "Requesting mic…";
    if (state === "counting-in") return `Count-in: ${countInRemaining} beat${countInRemaining !== 1 ? "s" : ""}`;
    if (state === "recording") return "Recording";
    if (state === "stopped") return "Complete";
    if (state === "error") return "Error";
    return "";
  };

  const isRecording  = state === "recording";
  const isCountingIn = state === "counting-in";
  const isIdle       = state === "idle" || state === "error";

  return (
    <div style={{
      padding: "18px 14px 12px",
      margin: "12px 16px 0",
      border: "1px solid var(--ss-panel-border)",
      borderRadius: 6,
      background: "var(--ss-controls-surface)",
    }}>
      {/* State label */}
      <div style={{
        fontSize: 11,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: isRecording ? "#e53e3e" : isCountingIn ? "#d79f36" : "var(--ss-text-muted)",
        textAlign: "center",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}>
        {(isRecording || isCountingIn) && (
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: isCountingIn ? "#d79f36" : "#e53e3e" }} />
        )}
        {stateLabel()}
      </div>

      {/* Record / Stop button */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: idleDescription && isIdle ? 8 : 12 }}>
        {isIdle ? (
          <motion.button
            onClick={disabled ? undefined : startRecording}
            disabled={disabled}
            whileTap={{ scale: 0.93 }}
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: disabled ? "#4a3030" : "#e53e3e",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: disabled ? 0.5 : 1,
              boxShadow: disabled ? "none" : "0 2px 8px rgba(229,62,62,0.35)",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "#c53030"; }}
            onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = "#e53e3e"; }}
          >
            <MicIcon size={22} />
          </motion.button>
        ) : isRecording ? (
          <motion.button
            onClick={stopRecording}
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "#e53e3e",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 0px rgba(229,62,62,0.4)",
              animation: "pulse-ring 1.2s ease-out infinite",
            }}
          >
            <StopSquare size={18} />
          </motion.button>
        ) : state === "stopped" ? (
          <button
            onClick={reset}
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "var(--ss-surface)",
              border: "1.5px solid var(--ss-panel-border)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ss-text-muted)",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#238c35"; e.currentTarget.style.color = "#238c35"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--ss-panel-border)"; e.currentTarget.style.color = "var(--ss-text-muted)"; }}
            title="Record again"
          >
            <MicIcon size={20} color="currentColor" />
          </button>
        ) : isCountingIn ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "#d79f3620",
              border: "2px solid #d79f36",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexDirection: "column",
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#d79f36", lineHeight: 1 }}>
                {countInRemaining}
              </span>
            </div>
            <button
              type="button"
              onClick={cancelCountIn}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "5px 12px",
                borderRadius: 4,
                border: "1px solid var(--ss-panel-border)",
                background: "var(--ss-surface)",
                color: "var(--ss-text)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          // requesting
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            background: "var(--ss-controls-btn)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ss-text-muted)" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            </motion.div>
          </div>
        )}
      </div>

      {/* Timer — monospace, 13px, only while recording */}
      {idleDescription && isIdle && (
        <p style={{
          margin: "0 0 12px",
          textAlign: "center",
          fontSize: 10,
          lineHeight: 1.4,
          color: "var(--ss-text-muted)",
        }}>
          {idleDescription}
        </p>
      )}

      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ textAlign: "center", marginBottom: 8 }}
          >
            <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "var(--ss-text-title)" }}>
              {formatTime(elapsedMs)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Waveform bars — green when recording, faint when idle */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: 28,
        padding: "0 8px",
        opacity: isRecording || isCountingIn ? 1 : 0.45,
      }}>
        {bars.map((height, i) => (
          <motion.div
            key={i}
            style={{
              flex: 1,
              borderRadius: 2,
              minHeight: 2,
              originY: 0.5,
              backgroundColor: isRecording ? "#238c35" : "var(--ss-panel-border)",
              transition: "background-color 0.2s",
            }}
            animate={{ scaleY: Math.max(height, 0.08) }}
            transition={{ duration: 0.08 }}
          />
        ))}
      </div>

      {/* Error message */}
      <AnimatePresence>
        {state === "error" && errorMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#e53e3e",
              background: "rgba(229,62,62,0.08)",
              borderRadius: 4,
              padding: "6px 10px",
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            {errorMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pulsing ring keyframe */}
      <style>{`
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0px rgba(229,62,62,0.5); }
          70%  { box-shadow: 0 0 0 10px rgba(229,62,62,0); }
          100% { box-shadow: 0 0 0 0px rgba(229,62,62,0); }
        }
      `}</style>
    </div>
  );
}
