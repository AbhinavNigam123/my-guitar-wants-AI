/**
 * End-to-end coach timing integration: synthetic WAV → backend transcribe
 * (with silence trim) → trim restoration → alignment.
 *
 * Confirms the production path no longer reports systematic early offset
 * when leading silence is trimmed from the uploaded recording.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePracticeTake } from "../src/lib/coach-analysis.ts";
import {
  buildPracticeTimeline,
  buildTimingDiagnostics,
  restoreDetectedOnsets,
} from "../src/lib/practice-timeline.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BENCH = join(ROOT, "benchmarks");
const FIXTURE = join(BENCH, "fixtures", "synthetic", "coach_latency_grid.wav");
const PYTHON = join(ROOT, "backend", ".venv311", "Scripts", "python.exe");

const BPM = 71;
const BEATS = 4;
const DRIFT_TOLERANCE_MS = 80;
const ACCURACY_MIN = 70;

const EXPECTED_NOTES = Array.from({ length: 12 }, (_, index) => ({
  id: `n${index}`,
  measure: Math.floor(index / 4) + 1,
  beat: (index % 4) + 1,
  string: 1,
  fret: index % 5,
  durationBeats: 0.5,
}));

const failures = [];

function ensureFixture() {
  const script = [
    "from pathlib import Path",
    "from benchmarks.generate_fixtures import ensure_fixture",
    `ensure_fixture(Path(${JSON.stringify(FIXTURE)}), "coach_latency_grid")`,
  ].join("; ");
  const proc = spawnSync(PYTHON, ["-c", script], { cwd: ROOT, encoding: "utf8" });
  if (proc.status !== 0) {
    throw new Error(`Fixture generation failed: ${proc.stderr || proc.stdout}`);
  }
}

function transcribe(path) {
  const expectedPath = join(BENCH, "results", "inputs", "coach-sync-expected.json");
  mkdirSync(dirname(expectedPath), { recursive: true });
  writeFileSync(expectedPath, JSON.stringify(EXPECTED_NOTES));
  const args = [
    join(BENCH, "transcribe_fixture.py"),
    "--path", path,
    "--bpm", String(BPM),
    "--beats", String(BEATS),
    "--preprocess",
    "--onset", "0.25",
    "--frame", "0.18",
    "--min-note-ms", "30",
    "--min-amp-ratio", "0.10",
    "--expected-notes-json", expectedPath,
  ];
  const proc = spawnSync(PYTHON, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (proc.status !== 0) {
    throw new Error(`Transcription failed: ${proc.stderr || proc.stdout}`);
  }
  const line = proc.stdout.trim().split(/\r?\n/).at(-1);
  return JSON.parse(line);
}

function runCase(name, transcription, withoutRestore = false) {
  const trimStartMs = transcription.settings?.audioPreprocess?.trimStartMs ?? 0;
  const timeline = buildPracticeTimeline({
    bpm: BPM,
    beatsPerMeasure: BEATS,
    startMeasure: 1,
    audioPreprocess: { trimStartMs },
  });

  const raw = transcription.rawEvents;
  const events = withoutRestore ? raw : restoreDetectedOnsets(raw, timeline);

  const result = analyzePracticeTake({
    expectedNotes: EXPECTED_NOTES,
    transcription: { noteCount: events.length, rawEvents: events },
    bpm: BPM,
    beatsPerMeasure: BEATS,
  });

  const earlyCount = result.feedback.alignments.filter(a => a.status === "early").length;
  const report = {
    name,
    trimStartMs,
    timingDriftMs: result.metrics.timingDriftMs,
    inputLatencyCorrectionMs: result.metrics.inputLatencyCorrectionMs,
    timingCalibrationSampleCount: result.metrics.timingCalibrationSampleCount,
    accuracy: result.metrics.accuracyPercent,
    earlyCount,
    rawCount: raw.length,
    restoredCount: events.length,
  };

  if (!withoutRestore) {
    if (trimStartMs < 50) {
      failures.push(`${name}: expected trimStartMs ≥50ms, got ${trimStartMs}`);
    }
    if (result.metrics.timingDriftMs > DRIFT_TOLERANCE_MS) {
      failures.push(`${name}: timingDriftMs=${result.metrics.timingDriftMs} (max ${DRIFT_TOLERANCE_MS})`);
      const diag = buildTimingDiagnostics(EXPECTED_NOTES, raw, timeline, result.feedback.alignments);
      for (const row of diag) {
        failures.push(
          `  ${row.noteId} m${row.measure} b${row.beat}: expected=${row.expectedMs}ms detected=${row.detectedMs} offset=${row.offsetMs}`,
        );
      }
    }
    if (result.metrics.accuracyPercent < ACCURACY_MIN) {
      failures.push(`${name}: accuracy=${result.metrics.accuracyPercent}% (min ${ACCURACY_MIN})`);
    }
    if (earlyCount >= EXPECTED_NOTES.length) {
      failures.push(`${name}: systematic early bias — ${earlyCount}/${EXPECTED_NOTES.length} notes classified early`);
    }
  } else {
    // Without restoration we expect large early bias when trim > 0
    if (trimStartMs > 50 && result.metrics.timingDriftMs < 150) {
      failures.push(`${name}: without-restore should show large drift when trim=${trimStartMs}, got ${result.metrics.timingDriftMs}`);
    }
  }

  return report;
}

ensureFixture();
const transcription = transcribe(FIXTURE);
const restoredReport = runCase("coach-sync-integration/restored", transcription, false);

const report = {
  ok: failures.length === 0,
  runAt: new Date().toISOString(),
  restored: restoredReport,
};
mkdirSync(join(BENCH, "results"), { recursive: true });
writeFileSync(join(BENCH, "results", "latest-coach-sync-integration.json"), JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.log(`HARNESS FAIL - coach sync integration (${failures.length} failures)`);
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(1);
}

console.log(
  `HARNESS PASS - coach sync integration: trim=${restoredReport.trimStartMs}ms ` +
  `drift=${restoredReport.timingDriftMs}ms accuracy=${restoredReport.accuracy}%`,
);
