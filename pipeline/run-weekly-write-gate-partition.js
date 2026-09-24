'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { partitionWriteGate, stableStringify } = require('./weekly-write-gate-partition');

const [dryRunPath, teacherRegistryPath, outputDirectory] = process.argv.slice(2);
if (!dryRunPath || !teacherRegistryPath || !outputDirectory) {
  throw new Error('usage: node run-weekly-write-gate-partition.js <dry-run.json> <teacher-registry.json> <output-directory>');
}

const dryRun = JSON.parse(fs.readFileSync(dryRunPath, 'utf8'));
const teacherRegistry = JSON.parse(fs.readFileSync(teacherRegistryPath, 'utf8'));
const artifact = partitionWriteGate({ dryRun, teacherRegistry });
if (artifact.write_gate !== 'PASS') throw new Error('write-gate partition validation failed');

fs.mkdirSync(outputDirectory, { recursive: true });
const files = {
  checkpoint: path.join(outputDirectory, 'write_gate_partition_checkpoint_0924.json'),
  approved: path.join(outputDirectory, 'approved_clean_candidates_0924.json'),
  review: path.join(outputDirectory, 'review_required_candidates_0924.json'),
};
fs.writeFileSync(files.checkpoint, `${stableStringify(artifact)}\n`, 'utf8');
fs.writeFileSync(files.approved, `${stableStringify({
  artifact_id: artifact.artifact_id,
  source_dry_run_artifact_id: artifact.source_dry_run_artifact_id,
  mode: 'APPROVED_CLEAN_CANDIDATES_NO_CANONICAL_WRITE',
  count: artifact.approved_clean.length,
  records: artifact.approved_clean,
})}\n`, 'utf8');
fs.writeFileSync(files.review, `${stableStringify({
  artifact_id: artifact.artifact_id,
  source_dry_run_artifact_id: artifact.source_dry_run_artifact_id,
  mode: 'QUARANTINED_REVIEW_REQUIRED',
  count: artifact.review_required.length,
  records: artifact.review_required,
})}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({ status: 'PASS', counts: artifact.counts, validation: artifact.validation, files }, null, 2)}\n`);

