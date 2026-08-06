/**
 * practice-store.ts
 *
 * IndexedDB persistence for AI Coach practice sessions and optional audio blobs.
 *
 * DB name:    "guitar-practice-coach"
 * Stores:
 *   sessions   — keyed by session id; holds lightweight session records
 *   recordings — keyed by session id; holds raw audio Blob (optional)
 */

import type {
  MeasureCoachResult,
  MeasureMastery,
  MeasureMasteryLevel,
  SongMetrics,
} from "@/types/music";

export interface SavedSession {
  id: string;
  songTitle: string;
  artist: string;
  bpm: number;
  beatsPerMeasure: number;
  createdAt: number;         // unix ms
  durationMs: number;        // length of the coach recording
  accuracyPercent: number;
  timingDriftMs: number;
  weakestMeasure: number;
  recommendedTempoBpm: number;
  /** Per-measure breakdown derived from note statuses on the page. */
  measureAccuracy: { measure: number; accuracy: number }[];
  /** Measure-first Coach evidence. Missing on legacy v1 sessions. */
  measureResults?: MeasureCoachResult[];
  coachedRange?: { start: number; end: number };
  hasAudio: boolean;
}

const DB_NAME    = "guitar-practice-coach";
const DB_VERSION = 2;
const SESSIONS   = "sessions";
const RECORDINGS = "recordings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const store = db.createObjectStore(SESSIONS, { keyPath: "id" });
        store.createIndex("songTitle", "songTitle", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(RECORDINGS)) {
        db.createObjectStore(RECORDINGS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(storeNames, mode);
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Save (upsert) a session record. */
export async function saveSession(record: SavedSession): Promise<void> {
  const db = await openDb();
  const t  = tx(db, SESSIONS, "readwrite");
  await promisify(t.objectStore(SESSIONS).put(record));
}

/** List all sessions for a given song title, newest first. */
export async function listSessions(songTitle: string): Promise<SavedSession[]> {
  const db  = await openDb();
  const t   = tx(db, SESSIONS, "readonly");
  const all = await promisify<SavedSession[]>(t.objectStore(SESSIONS).getAll() as IDBRequest<SavedSession[]>);
  return all
    .filter(s => s.songTitle === songTitle)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete a session record and its audio blob (if present). */
export async function deleteSession(id: string): Promise<void> {
  const db = await openDb();
  const t  = tx(db, [SESSIONS, RECORDINGS], "readwrite");
  t.objectStore(SESSIONS).delete(id);
  t.objectStore(RECORDINGS).delete(id);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror    = () => reject(t.error);
  });
}

/** Persist the raw audio blob for a session. Marks hasAudio on the record. */
export async function saveRecording(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  // Store the blob
  const t1 = tx(db, RECORDINGS, "readwrite");
  await promisify(t1.objectStore(RECORDINGS).put({ id, blob }));
  // Update hasAudio flag on the session record
  const t2    = tx(db, SESSIONS, "readwrite");
  const store = t2.objectStore(SESSIONS);
  const record = await promisify<SavedSession | undefined>(store.get(id) as IDBRequest<SavedSession | undefined>);
  if (record) {
    await promisify(store.put({ ...record, hasAudio: true }));
  }
}

/** Retrieve the audio blob for a session, or null if not stored. */
export async function getRecording(id: string): Promise<Blob | null> {
  const db  = await openDb();
  const t   = tx(db, RECORDINGS, "readonly");
  const row = await promisify<{ id: string; blob: Blob } | undefined>(
    t.objectStore(RECORDINGS).get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>,
  );
  return row?.blob ?? null;
}

/** Compute a SongMetrics aggregate from all saved sessions for a song. */
export async function computeSongMetrics(
  songTitle: string,
  artist: string,
): Promise<SongMetrics> {
  const sessions = await listSessions(songTitle);

  if (sessions.length === 0) {
    return {
      songTitle,
      artist,
      sessionsPlayed: 0,
      bestAccuracy: 0,
      avgAccuracy: 0,
      totalPracticeMinutes: 0,
      lastPracticed: "—",
      measureAccuracy: [],
      recentTakes: [],
    };
  }

  const bestAccuracy  = Math.max(...sessions.map(s => s.accuracyPercent));
  const avgAccuracy   = Math.round(
    sessions.reduce((sum, s) => sum + s.accuracyPercent, 0) / sessions.length,
  );
  const totalMinutes  = Math.round(
    sessions.reduce((sum, s) => sum + s.durationMs, 0) / 60000,
  );
  const lastDate      = new Date(sessions[0].createdAt);
  const lastPracticed = lastDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Aggregate per-measure accuracy across sessions
  const measureMap = new Map<number, { total: number; count: number }>();
  for (const s of sessions) {
    for (const m of s.measureAccuracy) {
      const existing = measureMap.get(m.measure) ?? { total: 0, count: 0 };
      measureMap.set(m.measure, {
        total: existing.total + m.accuracy,
        count: existing.count + 1,
      });
    }
  }
  const measureAccuracy = Array.from(measureMap.entries())
    .map(([measure, { total, count }]) => ({ measure, accuracy: Math.round(total / count) }))
    .sort((a, b) => a.measure - b.measure);
  const measureMastery = deriveMeasureMastery(sessions);

  const recentTakes = sessions.slice(0, 10).map(s => ({
    id: s.id,
    date: new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    accuracy: s.accuracyPercent,
    tempo: s.bpm,
  }));

  return {
    songTitle,
    artist,
    sessionsPlayed: sessions.length,
    bestAccuracy,
    avgAccuracy,
    totalPracticeMinutes: totalMinutes,
    lastPracticed,
    measureAccuracy,
    measureMastery,
    recentTakes,
  };
}

export function deriveMeasureMastery(sessions: SavedSession[]): MeasureMastery[] {
  const measureNumbers = new Set<number>();
  for (const session of sessions) {
    for (const result of session.measureResults ?? []) measureNumbers.add(result.measure);
    for (const result of session.measureAccuracy) measureNumbers.add(result.measure);
  }

  return [...measureNumbers].sort((a, b) => a - b).map(measure => {
    const recent = sessions
      .filter(session => {
        if (session.coachedRange && (measure < session.coachedRange.start || measure > session.coachedRange.end)) {
          return false;
        }
        return Boolean(
          session.measureResults?.some(result => result.measure === measure && result.scoredNoteCount > 0)
          ?? session.measureAccuracy.some(result => result.measure === measure),
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map(session => {
        const result = session.measureResults?.find(row => row.measure === measure);
        const legacy = session.measureAccuracy.find(row => row.measure === measure);
        return {
          accuracyPercent: result?.accuracyPercent ?? legacy?.accuracy ?? 0,
          pitchCoveragePercent: result?.pitchCoveragePercent,
          timingDriftMs: result?.timingDriftMs,
        };
      });

    if (recent.length === 0) {
      return {
        measure,
        level: "unpracticed",
        recentTakeCount: 0,
        accuracyPercent: 0,
      };
    }

    const average = (values: number[]) =>
      Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    const accuracyPercent = average(recent.map(result => result.accuracyPercent));
    const pitchRows = recent.flatMap(result =>
      result.pitchCoveragePercent == null ? [] : [result.pitchCoveragePercent]
    );
    const timingRows = recent.flatMap(result =>
      result.timingDriftMs == null ? [] : [result.timingDriftMs]
    );
    const pitchCoveragePercent = pitchRows.length ? average(pitchRows) : undefined;
    const timingDriftMs = timingRows.length ? average(timingRows) : undefined;
    const latestImproved = recent.length >= 2
      && recent[0].accuracyPercent > recent[1].accuracyPercent;

    let level: MeasureMasteryLevel = "learning";
    if (
      recent.length === 3
      && accuracyPercent >= 90
      && timingDriftMs != null && timingDriftMs <= 70
      && pitchCoveragePercent != null && pitchCoveragePercent >= 85
    ) {
      level = "mastered";
    } else if (
      recent.length === 3
      && accuracyPercent >= 75
      && timingDriftMs != null && timingDriftMs <= 100
    ) {
      level = "reliable";
    } else if (latestImproved && accuracyPercent >= 60) {
      level = "improving";
    }

    const timingWeak = timingDriftMs != null && timingDriftMs > 100;
    const notesWeak = accuracyPercent < 75 || (pitchCoveragePercent != null && pitchCoveragePercent < 75);
    return {
      measure,
      level,
      recentTakeCount: recent.length,
      accuracyPercent,
      pitchCoveragePercent,
      timingDriftMs,
      dominantIssue: timingWeak && notesWeak ? "mixed" : timingWeak ? "timing" : notesWeak ? "notes" : undefined,
    };
  });
}
