'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { partitionWriteGate, stableStringify } = require('./weekly-write-gate-partition');

const dryRunPath = process.argv[2];
const teacherRegistryPath = process.argv[3];
if (!dryRunPath || !teacherRegistryPath) throw new Error('usage: node weekly-write-gate-partition.test.js <dry-run.json> <teacher-registry.json>');

const dryRunBytesBefore = fs.readFileSync(dryRunPath);
const registryBytesBefore = fs.readFileSync(teacherRegistryPath);
const dryRun = JSON.parse(dryRunBytesBefore.toString('utf8'));
const teacherRegistry = JSON.parse(registryBytesBefore.toString('utf8'));

const first = partitionWriteGate({ dryRun, teacherRegistry });
const second = partitionWriteGate({ dryRun, teacherRegistry });

assert.equal(first.input_count, 150);
assert.equal(first.counts.APPROVED_CLEAN, 131);
assert.equal(first.counts.NEW_CANONICAL_EVENT, 129);
assert.equal(first.counts.ADD_EVIDENCE_ONLY, 2);
assert.equal(first.counts.REVIEW_REQUIRED, 19);
assert.equal(first.counts.UNRESOLVED_IDENTITY, 14);
assert.equal(first.counts.SUSPECTED_DUPLICATE, 5);
assert.equal(first.teacher_registry_count, 73);
assert.equal(first.write_gate, 'PASS');
assert.ok(Object.values(first.validation).every(Boolean));
assert.ok(first.approved_clean.every((row) => row.write_status === 'APPROVED_CLEAN'));
assert.ok(first.review_required.every((row) => row.quarantine_status === 'REVIEW_REQUIRED'));
assert.ok(first.approved_clean.every((row) => row.teacher_id !== 'W01-T-UNKNOWN'));
assert.equal(first.approved_clean.length + first.review_required.length, 150);
assert.equal(stableStringify(first), stableStringify(second));
assert.deepEqual(fs.readFileSync(dryRunPath), dryRunBytesBefore);
assert.deepEqual(fs.readFileSync(teacherRegistryPath), registryBytesBefore);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  input: first.input_count,
  approved_clean: first.counts.APPROVED_CLEAN,
  review_required: first.counts.REVIEW_REQUIRED,
  unresolved_identity: first.counts.UNRESOLVED_IDENTITY,
  suspected_duplicate: first.counts.SUSPECTED_DUPLICATE,
  teacher_registry: first.teacher_registry_count,
  partition_hash: first.partition_hash,
}, null, 2)}\n`);

