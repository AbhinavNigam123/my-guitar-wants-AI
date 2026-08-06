import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePracticeTake } from "../src/lib/coach-analysis.ts";
import { STAIRWAY_TAB_NOTES } from "../src/lib/stairway-tab-data.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BENCH = join(ROOT, "benchmarks");
const RESULTS = join(BENCH, "results");
const MANIFEST = join(BENCH, "coach_audio_manifest.json");
const PYTHON = join(ROOT, "backend", ".venv311", "Scripts", "python.exe");
const SAVE_BASELINE = process.argv.includes("--save-baseline");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const failures = [];
const fixtureReports = [];

for (const fixture of manifest.fixtures ?? []) {
  ensureFixture(fixture);
  const expectedNotes = resolveExpectedNotes(fixture);
  const bpm = Number(fixture.bpm ?? manifest.defaults?.bpm ?? 120);
  const beatsPerMeasure = Number(fixture.beatsPerMeasure ?? manifest.defaults?.beatsPerMeasure ?? 4);
  const path = join(BENCH, fixture.normalizedPath ?? fixture.path);
  const expectedPath = join(RESULTS, "inputs", `${fixture.id}-expected.json`);
  mkdirSync(dirname(expectedPath), { recursive: true });
  writeFileSync(expectedPath, JSON.stringify(expectedNotes));
  const candidates = [];

  for (const preset of manifest.sweep ?? []) {
    const transcription = transcribeFixture(path, bpm, beatsPerMeasure, preset, expectedPath);
    const analysis = analyzePracticeTake({
      expectedNotes,
      transcription,
      bpm,
      beatsPerMeasure,
    });
    candidates.push(scoreCandidate(preset, transcription, analysis, expectedNotes));
  }

  candidates.sort((a, b) => b.score - a.score);
  const official = candidates.find(candidate => candidate.preset.name === manifest.productionPreset);
  if (!official) throw new Error(`Production preset ${manifest.productionPreset} is missing`);
  const expectationFailures = evaluateFixture(fixture, official);
  if (expectationFailures.length > 0) {
    failures.push(`${fixture.id}: ${expectationFailures.join("; ")}`);
  }
  fixtureReports.push({
    id: fixture.id,
    role: fixture.role ?? "synthetic",
    ok: expectationFailures.length === 0,
    official,
    diagnosticBest: candidates[0],
    topCandidates: candidates.slice(0, 3),
  });
}

const report = {
  ok: failures.length === 0,
  runAt: new Date().toISOString(),
  productionPreset: manifest.productionPreset,
  fixtures: fixtureReports,
};

mkdirSync(RESULTS, { recursive: true });
writeFileSync(join(RESULTS, "latest-coach.json"), JSON.stringify(report, null, 2));
if (SAVE_BASELINE) {
  const baselineDir = join(BENCH, "baselines");
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(join(baselineDir, "coach-audio-pre-pitch-only.json"), JSON.stringify(report, null, 2));
}

if (failures.length > 0) {
  console.log(`HARNESS FAIL - coach audio (${failures.length} fixtures)`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  process.exit(1);
}

console.log(`HARNESS PASS - coach audio ${fixtureReports.length}/${fixtureReports.length}, production preset ${manifest.productionPreset}`);

function ensureFixture(fixture) {
  if (fixture.generate) {
    const script = [
      "from pathlib import Path",
      "from benchmarks.generate_fixtures import ensure_fixture",
      `ensure_fixture(Path(${JSON.stringify(join(BENCH, fixture.path))}), ${JSON.stringify(fixture.generate)})`,
    ].join("; ");
    runPython(["-c", script], `Fixture generation failed for ${fixture.id}`);
  }
  if (fixture.normalizedPath) {
    const source = join(BENCH, fixture.path);
    const output = join(BENCH, fixture.normalizedPath);
    if (!existsSync(output) || statSync(output).mtimeMs < statSync(source).mtimeMs) {
      runPython([
        join(BENCH, "normalize_audio_fixture.py"),
        "--source", source,
        "--output", output,
      ], `Fixture normalization failed for ${fixture.id}`);
    }
  }
}

function transcribeFixture(path, bpm, beatsPerMeasure, preset, expectedPath) {
  const args = [
    join(BENCH, "transcribe_fixture.py"),
    "--path", path,
    "--bpm", String(bpm),
    "--beats", String(beatsPerMeasure),
    "--onset", String(preset.onset),
    "--frame", String(preset.frame),
    "--min-note-ms", String(preset.minNoteMs),
    "--min-amp-ratio", String(preset.minAmpRatio),
    "--expected-notes-json", expectedPath,
  ];
  if (preset.preprocess) args.push("--preprocess");

  const proc = spawnSync(PYTHON, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  if (proc.status !== 0) {
    throw new Error(`Transcription failed for ${path}: ${proc.stderr || proc.stdout}`);
  }
  const jsonLine = proc.stdout.trim().split(/\r?\n/).at(-1);
  return JSON.parse(jsonLine);
}

function scoreCandidate(preset, transcription, analysis, expectedNotes) {
  const counts = {
    correct: 0,
    early: 0,
    late: 0,
    missed: 0,
    wrong_note: 0,
    unplayed: 0,
    lowConfidence: 0,
    detectorQuality: 0,
    extra: 0,
  };
  for (const alignment of analysis.feedback.alignments) {
    counts[alignment.status] += 1;
    if (alignment.confidence === "low") counts.lowConfidence += 1;
  }
  for (const finding of analysis.feedback.findings ?? []) {
    if (finding.type === "detector_quality") counts.detectorQuality += 1;
    if (finding.type === "extra") {
      const match = finding.message.match(/(\d+) extra/);
      counts.extra += match ? Number(match[1]) : 1;
    }
  }

  const score =
    analysis.metrics.accuracyPercent
    - counts.missed * 12
    - counts.wrong_note * 7
    - counts.extra * 4
    - counts.lowConfidence * 2
    - counts.detectorQuality * 6;

  return {
    preset,
    score,
    noteCount: transcription.noteCount,
    rawEventCount: transcription.rawEvents.length,
    metrics: analysis.metrics,
    counts,
    settings: transcription.settings,
    alignments: analysis.feedback.alignments.map(alignment => {
      const expected = expectedNotes.find(note => note.id === alignment.tabNoteId);
      return {
        ...alignment,
        measure: expected?.measure,
        beat: expected?.beat,
        string: expected?.string,
        fret: expected?.fret,
      };
    }),
  };
}

function resolveExpectedNotes(fixture) {
  if (fixture.expectedNotesSource === "stairway:1-20") {
    return STAIRWAY_TAB_NOTES.filter(note => note.measure >= 1 && note.measure <= 20);
  }
  return fixture.expectedNotes ?? [];
}

function runPython(args, message) {
  const proc = spawnSync(PYTHON, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 8 });
  if (proc.status !== 0) throw new Error(`${message}: ${proc.stderr || proc.stdout}`);
  return proc;
}

function evaluateFixture(fixture, candidate) {
  const expect = fixture.expect ?? {};
  const failures = [];
  if (expect.minAccuracy != null && candidate.metrics.accuracyPercent < expect.minAccuracy) {
    failures.push(`accuracy ${candidate.metrics.accuracyPercent} < ${expect.minAccuracy}`);
  }
  if (expect.maxMissed != null && candidate.counts.missed > expect.maxMissed) {
    failures.push(`missed ${candidate.counts.missed} > ${expect.maxMissed}`);
  }
  if (expect.maxExtra != null && candidate.counts.extra > expect.maxExtra) {
    failures.push(`extra ${candidate.counts.extra} > ${expect.maxExtra}`);
  }
  if (expect.requiredWeakestMeasure != null && candidate.metrics.weakestMeasure !== expect.requiredWeakestMeasure) {
    failures.push(`weakest ${candidate.metrics.weakestMeasure} != ${expect.requiredWeakestMeasure}`);
  }
  for (const [status, minCount] of Object.entries(expect.statusMinimums ?? {})) {
    if ((candidate.counts[status] ?? 0) < minCount) {
      failures.push(`${status} ${(candidate.counts[status] ?? 0)} < ${minCount}`);
    }
  }
  return failures;
}
