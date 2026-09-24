'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildCandidate, sha256 } = require('./weekly-candidate-writer');
const { readRows } = require('./real-adapter-integration');
const { stableStringify } = require('./weekly-reconciliation');

const [baselineApp, approvedPath, reviewPath, dryRunPath, semanticPath, teacherRegistryPath, outputDirectory] = process.argv.slice(2);
if (![baselineApp, approvedPath, reviewPath, dryRunPath, semanticPath, teacherRegistryPath, outputDirectory].every(Boolean)) {
  throw new Error('usage: node run-weekly-candidate-writer.js <baseline-app.js> <approved.json> <review.json> <dry-run.json> <semantic.json> <teacher-registry.json> <output-directory>');
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const baselineRows = readRows(baselineApp);
const inputs = {
  approvedArtifact: readJson(approvedPath),
  reviewArtifact: readJson(reviewPath),
  dryRun: readJson(dryRunPath),
  semanticPayload: readJson(semanticPath),
  teacherRegistry: readJson(teacherRegistryPath),
};
const first = buildCandidate({ baselineRows, ...inputs });
if (!Object.values(first.summary.validation).every(Boolean)) throw new Error(`candidate validation failed: ${JSON.stringify(first.summary.validation)}`);
const second = buildCandidate({ baselineRows: first.rows, ...inputs });
if (second.summary.delta.canonical !== 0 || second.summary.delta.evidence !== 0) throw new Error('second-run delta is not zero');
if (first.summary.candidate_hash !== second.summary.candidate_hash) throw new Error('second-run semantic hash changed');

const source = fs.readFileSync(baselineApp, 'utf8');
const marker = 'const INITIAL_DATA = ';
const start = source.indexOf(marker);
const end = source.indexOf(';\nconst NOTE_KEY', start);
if (start < 0 || end < 0) throw new Error('INITIAL_DATA marker not found');
const candidateSource = `${source.slice(0, start + marker.length)}${JSON.stringify(first.rows)}${source.slice(end)}`;

fs.mkdirSync(outputDirectory, { recursive: true });
const candidateApp = path.join(outputDirectory, 'app_candidate_0924.js');
const candidateRows = path.join(outputDirectory, 'canonical_candidate_rows_0924.json');
const checkpoint = path.join(outputDirectory, 'candidate_writer_checkpoint_0924.json');
fs.writeFileSync(candidateApp, candidateSource, 'utf8');
fs.writeFileSync(candidateRows, `${stableStringify(first.rows)}\n`, 'utf8');
const artifact = {
  artifact_id: 'W01_WEEKLY_0924_CANDIDATE_WRITER_CHECKPOINT',
  mode: 'ISOLATED_NO_PRODUCTION_WRITE',
  input_hashes: Object.fromEntries([
    baselineApp, approvedPath, reviewPath, dryRunPath, semanticPath, teacherRegistryPath,
  ].map((file) => [path.basename(file), sha256(fs.readFileSync(file))])),
  first_run: first.summary,
  second_run: second.summary,
  deterministic_rerun: first.summary.candidate_hash === second.summary.candidate_hash,
  second_run_delta: second.summary.delta,
  files: {
    candidate_app: candidateApp,
    candidate_rows: candidateRows,
    candidate_app_sha256: sha256(fs.readFileSync(candidateApp)),
    candidate_rows_sha256: sha256(fs.readFileSync(candidateRows)),
  },
  production_changed: false,
  git_changed_by_runner: false,
};
fs.writeFileSync(checkpoint, `${stableStringify(artifact)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ status: 'PASS', ...artifact }, null, 2)}\n`);

