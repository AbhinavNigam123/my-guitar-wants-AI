"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, Play, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "error";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob, durationMs: number) => void;
  onRecordingStart?: () => void;
  disabled?: boolean;
}

const BAR_COUNT = 40;

export default function AudioRecorder({
  onRecordingComplete,
  onRecordingStart,
  disabled,
}: AudioRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.05));
  const [errorMsg, setErrorMsg] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopAnimLoop = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopAnimLoop();
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [stopAnimLoop]);

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
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      recorder.start(100);
      startTimeRef.current = Date.now();
      setState("recording");
      onRecordingStart?.();

      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);

      startAnalysis(stream);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied.";
      setErrorMsg(msg);
      setState("error");
    }
  }, [onRecordingComplete, onRecordingStart, cleanup, startAnalysis]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setElapsedMs(0);
    setBars(Array(BAR_COUNT).fill(0.05));
    setErrorMsg("");
  }, []);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return `${s}.${tenths}s`;
  };

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              state === "recording" ? "bg-red-500 animate-pulse" : "bg-zinc-600"
            }`}
          />
          <span className="text-sm font-medium text-zinc-300">
            {state === "idle"       && "Ready to record"}
            {state === "requesting" && "Requesting microphone…"}
            {state === "recording"  && `Recording · ${formatTime(elapsedMs)}`}
            {state === "stopped"    && "Recording complete"}
            {state === "error"      && "Microphone error"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {state === "idle" || state === "error" ? (
            <Button
              size="sm"
              onClick={startRecording}
              disabled={disabled}
              className="gap-2 bg-red-600 hover:bg-red-500 text-white border-0"
            >
              <Mic className="w-4 h-4" />
              Record
            </Button>
          ) : state === "recording" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={stopRecording}
              className="gap-2 border-red-500/40 text-red-400 hover:bg-red-950/40"
            >
              <Square className="w-4 h-4 fill-current" />
              Stop
            </Button>
          ) : state === "requesting" ? (
            <Button size="sm" disabled variant="outline" className="gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Waiting…
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={reset}
              className="gap-2 border-white/10 text-zinc-400 hover:text-white"
            >
              <Play className="w-4 h-4" />
              Record again
            </Button>
          )}
        </div>
      </div>

      {/* Waveform bars */}
      <div className="flex items-center gap-[2px] h-14 px-1">
        {bars.map((height, i) => (
          <motion.div
            key={i}
            className={`flex-1 rounded-full transition-colors duration-150 ${
              state === "recording" ? "bg-red-500" : "bg-zinc-600"
            }`}
            animate={{ scaleY: height }}
            style={{ originY: 0.5, minHeight: 2 }}
            transition={{ duration: 0.08 }}
          />
        ))}
      </div>

      <AnimatePresence>
        {state === "error" && errorMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 text-sm text-red-400 bg-red-950/20 rounded-lg px-3 py-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {errorMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
