'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCandidate } = require('./weekly-candidate-writer');
const { readRows } = require('./real-adapter-integration');

const [baselineApp, approvedPath, reviewPath, dryRunPath, semanticPath, teacherRegistryPath] = process.argv.slice(2);
if (![baselineApp, approvedPath, reviewPath, dryRunPath, semanticPath, teacherRegistryPath].every(Boolean)) {
  throw new Error('candidate writer test requires six input paths');
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const inputs = {
  approvedArtifact: readJson(approvedPath),
  reviewArtifact: readJson(reviewPath),
  dryRun: readJson(dryRunPath),
  semanticPayload: readJson(semanticPath),
  teacherRegistry: readJson(teacherRegistryPath),
};
const baselineRows = readRows(baselineApp);
const baselineSnapshot = JSON.stringify(baselineRows);
const first = buildCandidate({ baselineRows, ...inputs });
assert.deepEqual(first.summary.before, { canonical: 2842, evidence: 3164, teacher_registry: 73 });
assert.deepEqual(first.summary.after, { canonical: 2971, evidence: 3295, teacher_registry: 73 });
assert.deepEqual(first.summary.delta, { canonical: 129, evidence: 131 });
assert.equal(first.summary.review.rows, 19);
assert.equal(first.summary.review.evidence, 19);
assert.equal(first.summary.review.leakage, 0);
assert.ok(Object.values(first.summary.validation).every(Boolean));
assert.equal(JSON.stringify(baselineRows), baselineSnapshot);

const second = buildCandidate({ baselineRows: first.rows, ...inputs });
assert.deepEqual(second.summary.delta, { canonical: 0, evidence: 0 });
assert.equal(first.summary.candidate_hash, second.summary.candidate_hash);
assert.ok(Object.values(second.summary.validation).filter((value, index) => index !== Object.keys(second.summary.validation).indexOf('exact_delta')).every(Boolean));

const newRows = first.rows.filter((row) => String(row?.[18]?.event_id || '').startsWith('w14-'));
const newEvidence = newRows.flatMap((row) => row[18].evidence_records || []);
assert.equal(newRows.length, 129);
assert.equal(newEvidence.length, 131);
assert.equal(new Set(newEvidence.map((item) => item.evidence_id)).size, 131);
assert.ok(newEvidence.every((item) => item.source_event_id && item.source_ref && item.observed_at));
assert.ok(newEvidence.every((item) => item.capture_batch_id && item.capture_batch_sha256));

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  before: first.summary.before,
  after: first.summary.after,
  first_delta: first.summary.delta,
  second_delta: second.summary.delta,
  review: first.summary.review,
  candidate_hash: first.summary.candidate_hash,
}, null, 2)}\n`);

