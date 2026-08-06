"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { TabNote } from "@/types/music";
import { noteAbsBeat, playableDurationSec } from "@/lib/synth-schedule";

const OPEN_FREQ: Record<number, number> = {
  1: 329.63,
  2: 246.94,
  3: 196.0,
  4: 146.83,
  5: 110.0,
  6: 82.41,
};

function noteToFreq(string: number, fret: number): number {
  return (OPEN_FREQ[string] ?? 110) * Math.pow(2, fret / 12);
}

export type PlaybackSource = "original" | "synth";

export interface LoopRegion {
  startBeat: number;
  endBeat: number;
}

export interface UsePlaybackResult {
  isPlaying: boolean;
  source: PlaybackSource;
  /** Continuous absolute beat position (0 = start of measure 1 beat 1). */
  playbackBeat: number;
  currentMeasure: number | undefined;
  canPlayOriginal: boolean;
  /** Playback speed as a percentage (10–200). Default 100. */
  speed: number;
  loopEnabled: boolean;
  /** Beat-based loop bounds. Null = loop whole song when loopEnabled. */
  loopRegion: LoopRegion | null;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  isExportingSynth: boolean;
  togglePlay: () => void;
  pause: () => void;
  seekTo: (absoluteBeat: number) => void;
  changeSource: (s: PlaybackSource) => void;
  setRecordingBlob: (blob: Blob | null) => void;
  setSpeed: (pct: number) => void;
  setLoopRegion: (region: LoopRegion | null) => void;
  toggleLoop: () => void;
  toggleMetronome: () => void;
  setMetronomeVolume: (v: number) => void;
  /** Render the UI synth for a beat range into an audio blob without changing playback state. */
  exportSynthReference: (region: LoopRegion) => Promise<Blob>;
}

export function usePlayback(notes: TabNote[], bpm: number, beatsPerMeasure = 4): UsePlaybackResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const [source, setSource] = useState<PlaybackSource>("synth");
  const [playbackBeat, setPlaybackBeat] = useState(0);
  const [canPlayOriginal, setCanPlayOriginal] = useState(false);
  const [speed, setSpeedState] = useState(100);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopRegion, setLoopRegionState] = useState<LoopRegion | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomeVolume, setMetronomeVolumeState] = useState(0.5);
  const [isExportingSynth, setIsExportingSynth] = useState(false);

  // Refs mirror state so callbacks always read the latest values without stale closures
  const speedRef          = useRef(100);
  const loopEnabledRef    = useRef(false);
  const loopRegionRef     = useRef<LoopRegion | null>(null);
  const metronomeEnabledRef = useRef(false);
  const metronomeVolumeRef  = useRef(0.5);
  const notesRef          = useRef(notes);
  const sourceRef         = useRef<PlaybackSource>("synth");

  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { sourceRef.current = source; }, [source]);

  const audioElRef          = useRef<HTMLAudioElement | null>(null);
  const audioBlobUrlRef     = useRef<string | null>(null);
  const audioCtxRef         = useRef<AudioContext | null>(null);
  const rafRef              = useRef<number>(0);
  const activeSourcesRef    = useRef<AudioBufferSourceNode[]>([]);
  const activeOscillatorsRef = useRef<OscillatorNode[]>([]);
  const positionBeatRef     = useRef(0);
  const playAnchorRef       = useRef({ ctxTime: 0, beat: 0 });
  const playingRef          = useRef(false);
  const totalBeatsRef       = useRef(beatsPerMeasure);

  // Forward refs for start functions (needed for loop callbacks to avoid circular deps)
  const startSynthRef    = useRef<() => void>(() => {});
  const startOriginalRef = useRef<() => void>(() => {});

  // sec per beat at the current playback speed
  const getSpb = useCallback(() => (60 / bpm) / (speedRef.current / 100), [bpm]);
  // sec per beat at normal speed (used to map audio.currentTime → beats)
  const normalSpb = 60 / bpm;

  const currentMeasure =
    playbackBeat > 0 || isPlaying
      ? Math.floor(playbackBeat / beatsPerMeasure) + 1
      : undefined;

  // Effective loop range when loop is active
  const getActiveLoop = useCallback((): LoopRegion | null => {
    if (!loopEnabledRef.current) return null;
    return loopRegionRef.current ?? { startBeat: 0, endBeat: totalBeatsRef.current };
  }, []);

  // ── Stop all scheduled audio ─────────────────────────────────────────────
  const haltAudio = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    for (const s of activeSourcesRef.current) {
      try { s.stop(0); } catch { /* already stopped */ }
    }
    activeSourcesRef.current = [];
    for (const o of activeOscillatorsRef.current) {
      try { o.stop(0); } catch { /* already stopped */ }
    }
    activeOscillatorsRef.current = [];
    if (audioElRef.current && !audioElRef.current.paused) {
      audioElRef.current.pause();
    }
  }, []);

  useEffect(() => {
    let maxEnd = beatsPerMeasure;
    for (const n of notes) {
      const end = noteAbsBeat(n, beatsPerMeasure) + n.durationBeats;
      if (end > maxEnd) maxEnd = end;
    }
    totalBeatsRef.current = maxEnd + 1;
  }, [notes, beatsPerMeasure]);

  useEffect(() => () => {
    haltAudio();
    audioCtxRef.current?.close();
    if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current);
  }, [haltAudio]);

  const setRecordingBlob = useCallback((blob: Blob | null) => {
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      audioBlobUrlRef.current = url;
      if (!audioElRef.current) audioElRef.current = new Audio();
      audioElRef.current.src = url;
      audioElRef.current.volume = 1;
      setCanPlayOriginal(true);
    } else {
      if (audioElRef.current) audioElRef.current.src = "";
      setCanPlayOriginal(false);
    }
  }, []);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    const ctx = audioCtxRef.current;
    const spb = getSpb();
    if (ctx && ctx.state !== "closed") {
      const elapsed = (ctx.currentTime - playAnchorRef.current.ctxTime) / spb;
      positionBeatRef.current = playAnchorRef.current.beat + elapsed;
    } else if (audioElRef.current) {
      positionBeatRef.current = audioElRef.current.currentTime / normalSpb;
    }
    setPlaybackBeat(positionBeatRef.current);
    haltAudio();
    playingRef.current = false;
    setIsPlaying(false);
  }, [haltAudio, getSpb, normalSpb]);

  const seekTo = useCallback((absoluteBeat: number) => {
    const clamped = Math.max(0, Math.min(absoluteBeat, totalBeatsRef.current));
    haltAudio();
    positionBeatRef.current = clamped;
    setPlaybackBeat(clamped);
    playingRef.current = false;
    setIsPlaying(false);
  }, [haltAudio]);

  // ── Karplus-Strong acoustic pluck (unchanged) ────────────────────────────
  function renderPluckBuffer(ctx: AudioContext, freq: number, durationSec: number, letRing: boolean): AudioBuffer {
    const SR = ctx.sampleRate;
    const period = Math.max(2, Math.round(SR / freq));
    const len = Math.ceil(durationSec * SR);
    const buf = ctx.createBuffer(1, len, SR);
    const out = buf.getChannelData(0);
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) {
      const pick = i < period * 0.08 ? 1 : 0;
      ring[i] = (Math.random() * 2 - 1) * pick * 0.9;
    }
    const decay = letRing ? 0.9992 : 0.9978 - Math.min(freq / 8000, 0.0015);
    let ptr = 0;
    for (let i = 0; i < len; i++) {
      const next = (ptr + 1) % period;
      out[i] = ring[ptr];
      ring[ptr] = ((ring[ptr] + ring[next]) * 0.5) * decay;
      ptr = next;
    }
    return buf;
  }

  function createReverbBus(ctx: AudioContext, destination: AudioNode = ctx.destination): GainNode {
    const input = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    const delays = [0.029, 0.047, 0.067].map(t => {
      const d = ctx.createDelay(0.2);
      d.delayTime.value = t;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2800;
      input.connect(d);
      d.connect(lp);
      lp.connect(g);
      g.connect(wet);
      g.connect(d);
      return d;
    });
    void delays;
    wet.connect(destination);
    input.connect(destination);
    return input;
  }

  function schedulePluck(
    ctx: AudioContext,
    freq: number,
    when: number,
    dur: number,
    letRing: boolean,
    dest: AudioNode,
    trackSource = true,
  ) {
    const buf = renderPluckBuffer(ctx, freq, dur, letRing);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (trackSource) activeSourcesRef.current.push(src);
    const body = ctx.createBiquadFilter();
    body.type = "peaking";
    body.frequency.value = 180;
    body.Q.value = 0.9;
    body.gain.value = 4;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(freq * 8, 5200);
    lp.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + 0.004);
    gain.gain.setValueAtTime(1, when + dur * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(body);
    body.connect(lp);
    lp.connect(gain);
    gain.connect(dest);
    src.start(when);
    src.stop(when + dur + 0.1);
    if (trackSource) {
      src.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== src);
      };
    }
  }

  // ── Woodblock metronome — schedules clicks at every beat in [startBeat, endBeat) ──
  // wallSpb: wall-clock seconds per beat at the current speed
  function scheduleMetronome(
    ctx: AudioContext,
    startBeat: number,
    endBeat: number,
    anchorCtxTime: number,
    wallSpb: number,
    vol: number,
    bpm_: number,
  ) {
    if (vol <= 0) return;
    const firstBeat = Math.ceil(startBeat);
    for (let b = firstBeat; b < endBeat + 0.01; b++) {
      const isDownbeat = b % beatsPerMeasure === 0;
      const beatTime = anchorCtxTime + (b - startBeat) * wallSpb;
      if (beatTime < ctx.currentTime - 0.01) continue;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = isDownbeat ? 880 : 660;
      // Short woodblock envelope
      g.gain.setValueAtTime(0, beatTime);
      g.gain.linearRampToValueAtTime(vol * 0.3, beatTime + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.06);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(beatTime);
      osc.stop(beatTime + 0.07);
      activeOscillatorsRef.current.push(osc);
    }
    void bpm_; // reserved for future pitch scaling by tempo
  }

  // ── RAF position loop — drives playbackBeat state and handles loop boundaries ──
  const startPositionLoop = useCallback((
    getBeat: () => number,
    onLoopBoundary: (() => void) | null,
  ) => {
    const tick = () => {
      if (!playingRef.current) return;
      const beat = getBeat();
      positionBeatRef.current = beat;
      setPlaybackBeat(beat);
      const loop = getActiveLoop();
      if (loop && beat >= loop.endBeat - 0.01) {
        onLoopBoundary?.();
        return;
      }
      if (!loop && beat >= totalBeatsRef.current) {
        haltAudio();
        playingRef.current = false;
        setIsPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [haltAudio, getActiveLoop]);

  // ── Synth playback ───────────────────────────────────────────────────────
  const startSynth = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") void ctx.resume();

    const spb = getSpb();
    const startBeat = positionBeatRef.current;
    const loop = getActiveLoop();
    const endBeat = loop ? loop.endBeat : totalBeatsRef.current;
    const now = ctx.currentTime;
    playAnchorRef.current = { ctxTime: now, beat: startBeat };

    const bus = createReverbBus(ctx);

    for (const note of notesRef.current) {
      const abs = noteAbsBeat(note, beatsPerMeasure);
      if (abs < startBeat - 0.01 || abs >= endBeat) continue;
      const rel = abs - startBeat;
      schedulePluck(
        ctx,
        noteToFreq(note.string, note.fret),
        now + rel * spb,
        playableDurationSec(note, notesRef.current, beatsPerMeasure, spb),
        !!note.letRing,
        bus,
      );
    }

    if (metronomeEnabledRef.current) {
      scheduleMetronome(ctx, startBeat, endBeat, now, spb, metronomeVolumeRef.current, bpm);
    }

    startPositionLoop(
      () => playAnchorRef.current.beat + (ctx.currentTime - playAnchorRef.current.ctxTime) / spb,
      loop ? () => {
        haltAudio();
        positionBeatRef.current = loop.startBeat;
        startSynthRef.current();
      } : null,
    );
  }, [bpm, beatsPerMeasure, getSpb, getActiveLoop, startPositionLoop, haltAudio]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportSynthReference = useCallback(async (region: LoopRegion): Promise<Blob> => {
    if (isExportingSynth) throw new Error("A synth export is already running.");
    if (typeof MediaRecorder === "undefined") {
      throw new Error("This browser does not support audio capture.");
    }

    const startBeat = Math.max(0, region.startBeat);
    const endBeat = Math.min(totalBeatsRef.current, region.endBeat);
    if (endBeat <= startBeat) throw new Error("Choose a valid Coach measure range.");

    const exportNotes = notesRef.current.filter((note) => {
      const beat = noteAbsBeat(note, beatsPerMeasure);
      return beat >= startBeat - 0.01 && beat < endBeat - 0.01;
    });
    if (exportNotes.length === 0) throw new Error("The selected Coach range has no notes to export.");

    setIsExportingSynth(true);
    const ctx = new AudioContext();
    try {
      if (ctx.state === "suspended") await ctx.resume();
      const capture = ctx.createMediaStreamDestination();
      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType
        ? new MediaRecorder(capture.stream, { mimeType })
        : new MediaRecorder(capture.stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      const result = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("The browser could not capture the synth reference."));
        recorder.onstop = () => {
          const type = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunks, { type });
          if (blob.size === 0) {
            reject(new Error("The synth export was empty."));
          } else {
            resolve(blob);
          }
        };
      });

      const secondsPerBeat = getSpb();
      const startAt = ctx.currentTime + 0.05;
      const bus = createReverbBus(ctx, capture);
      let finalEndSeconds = 0;
      for (const note of exportNotes) {
        const relativeBeat = noteAbsBeat(note, beatsPerMeasure) - startBeat;
        const duration = playableDurationSec(
          note,
          notesRef.current,
          beatsPerMeasure,
          secondsPerBeat,
        );
        const noteStart = relativeBeat * secondsPerBeat;
        finalEndSeconds = Math.max(finalEndSeconds, noteStart + duration);
        schedulePluck(
          ctx,
          noteToFreq(note.string, note.fret),
          startAt + noteStart,
          duration,
          !!note.letRing,
          bus,
          false,
        );
      }

      recorder.start();
      window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, Math.ceil((0.05 + finalEndSeconds + 0.5) * 1000));
      return await result;
    } finally {
      await ctx.close().catch(() => undefined);
      setIsExportingSynth(false);
    }
  }, [beatsPerMeasure, getSpb, isExportingSynth]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Original audio playback ──────────────────────────────────────────────
  const startOriginal = useCallback(() => {
    const audio = audioElRef.current;
    if (!audio || !audioBlobUrlRef.current) return;

    audio.playbackRate = speedRef.current / 100;
    audio.currentTime = positionBeatRef.current * normalSpb;
    void audio.play();
    playAnchorRef.current = { ctxTime: 0, beat: positionBeatRef.current };

    const loop = getActiveLoop();

    // Metronome uses a separate AudioContext in original mode
    if (metronomeEnabledRef.current) {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const startBeat = positionBeatRef.current;
      const endBeat = loop ? loop.endBeat : totalBeatsRef.current;
      // Wall-clock sec per beat: normalSpb / playbackRate
      const wallSpb = normalSpb / (speedRef.current / 100);
      scheduleMetronome(ctx, startBeat, endBeat, ctx.currentTime, wallSpb, metronomeVolumeRef.current, bpm);
    }

    startPositionLoop(
      () => audio.currentTime / normalSpb,
      loop ? () => {
        haltAudio();
        positionBeatRef.current = loop.startBeat;
        startOriginalRef.current();
      } : null,
    );
  }, [bpm, beatsPerMeasure, normalSpb, getActiveLoop, startPositionLoop, haltAudio]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep start refs current
  useEffect(() => { startSynthRef.current = startSynth; }, [startSynth]);
  useEffect(() => { startOriginalRef.current = startOriginal; }, [startOriginal]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      pause();
      return;
    }
    playingRef.current = true;
    setIsPlaying(true);
    if (sourceRef.current === "synth" || !canPlayOriginal) startSynthRef.current();
    else startOriginalRef.current();
  }, [pause, canPlayOriginal]);

  const changeSource = useCallback((s: PlaybackSource) => {
    pause();
    setSource(s);
  }, [pause]);

  // ── Speed ────────────────────────────────────────────────────────────────
  const setSpeed = useCallback((pct: number) => {
    const clamped = Math.max(15, Math.min(175, Math.round(pct / 5) * 5));
    const wasPlaying = playingRef.current;

    if (wasPlaying) {
      // Capture position with OLD speed before updating ref
      const oldSpb = (60 / bpm) / (speedRef.current / 100);
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== "closed") {
        const elapsed = (ctx.currentTime - playAnchorRef.current.ctxTime) / oldSpb;
        positionBeatRef.current = playAnchorRef.current.beat + elapsed;
      } else if (audioElRef.current) {
        positionBeatRef.current = audioElRef.current.currentTime / normalSpb;
      }
      haltAudio();
      playingRef.current = true; // keep playing flag; haltAudio does not clear it
    }

    speedRef.current = clamped;
    setSpeedState(clamped);

    if (wasPlaying) {
      if (sourceRef.current === "synth" || !canPlayOriginal) startSynthRef.current();
      else startOriginalRef.current();
    }
  }, [bpm, normalSpb, haltAudio, canPlayOriginal]);

  // ── Loop ─────────────────────────────────────────────────────────────────
  const setLoopRegion = useCallback((region: LoopRegion | null) => {
    loopRegionRef.current = region;
    setLoopRegionState(region);
  }, []);

  const toggleLoop = useCallback(() => {
    setLoopEnabled(prev => {
      loopEnabledRef.current = !prev;
      return !prev;
    });
  }, []);

  // ── Metronome ────────────────────────────────────────────────────────────
  const toggleMetronome = useCallback(() => {
    setMetronomeEnabled(prev => {
      metronomeEnabledRef.current = !prev;
      // If turning on while playing, restart to schedule clicks
      if (!prev && playingRef.current) {
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state !== "closed") {
          const spb = getSpb();
          const elapsed = (ctx.currentTime - playAnchorRef.current.ctxTime) / spb;
          positionBeatRef.current = playAnchorRef.current.beat + elapsed;
        } else if (audioElRef.current) {
          positionBeatRef.current = audioElRef.current.currentTime / normalSpb;
        }
        haltAudio();
        playingRef.current = true;
        if (sourceRef.current === "synth" || !canPlayOriginal) startSynthRef.current();
        else startOriginalRef.current();
      }
      return !prev;
    });
  }, [getSpb, normalSpb, haltAudio, canPlayOriginal]);

  const setMetronomeVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    metronomeVolumeRef.current = clamped;
    setMetronomeVolumeState(clamped);
  }, []);

  return {
    isPlaying,
    source,
    playbackBeat,
    currentMeasure,
    canPlayOriginal,
    speed,
    loopEnabled,
    loopRegion,
    metronomeEnabled,
    metronomeVolume,
    isExportingSynth,
    togglePlay,
    pause,
    seekTo,
    changeSource,
    setRecordingBlob,
    setSpeed,
    setLoopRegion,
    toggleLoop,
    toggleMetronome,
    setMetronomeVolume,
    exportSynthReference,
  };
}
