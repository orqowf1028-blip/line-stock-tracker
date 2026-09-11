'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  adaptLineRows,
  adaptWebPayload,
  dateAdd,
  formalProjection,
  latestFormalDate,
  readRows,
  runDryRun,
} = require('./real-adapter-integration');
const { reconcileEvidence, stableStringify } = require('./weekly-reconciliation');

const REPO = path.resolve(__dirname, '..');
const WORK = path.resolve(REPO, '..');
const AGENT_ROOT = path.resolve(WORK, '..');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function semanticWithoutIdentity(result) {
  return result.events.map((event) => ({
    state: event.state,
    review_status: event.review_status,
    teacher_id: event.teacher_id,
    ticker: event.ticker,
    action: event.action,
    exit_scope: event.exit_scope,
    event_date: event.event_date,
    raw_date: event.raw_date,
    observed_at: event.observed_at,
    effective_at: event.effective_at,
    price: event.price,
    display_reason: event.display_reason,
    sources: event.sources,
    evidence_ids: event.evidence.map((item) => item.evidence_id).sort(),
    field_lineage: event.field_lineage,
  })).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
}

function evidenceCount(rows) {
  return rows.reduce((total, row) => total + Math.max(1, (((row[18] || {}).evidence_records) || []).length), 0);
}

function main() {
  const files = {
    baseline: path.join(REPO, 'app.js'),
    line: path.join(AGENT_ROOT, 'outputs', 'line_signals.js'),
    web: path.join(WORK, 'member_site_signals.json'),
    teacher: path.join(REPO, 'teacher-registry.json'),
    signal: path.join(REPO, 'signal-definition-registry.json'),
  };
  const before = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, hashFile(file)]));
  const artifact = runDryRun();
  const currentRows = readRows(files.baseline);

  assert.equal(artifact.mode, 'DRY_RUN_NO_CANONICAL_WRITE');
  assert.equal(artifact.baseline.canonical_events, currentRows.length);
  assert.equal(artifact.baseline.evidence_records, evidenceCount(currentRows));
  assert.equal(artifact.baseline.teacher_registry, 73);
  assert.equal(artifact.baseline.signal_definitions, 9);
  assert.equal(artifact.baseline.missing_year, 1213);
  assert.ok(artifact.baseline.ambiguous_groups >= 52);
  assert.ok(artifact.baseline.ambiguous_rows >= 115);
  assert.equal(artifact.baseline.unclassified, 3);
  assert.equal(artifact.baseline.teacher_review_groups, 2);
  assert.equal(artifact.reconciliation.expected_canonical_delta, 0);
  assert.equal(artifact.reconciliation.expected_evidence_delta, 0);
  assert.equal(artifact.reconciliation.counts.NO_CHANGE, artifact.candidates.length);
  assert.equal(artifact.reconciliation.counts.REVIEW_REQUIRED, 0);
  assert.equal(artifact.reconciliation.counts.SOURCE_CONFLICT, 0);
  assert.equal(artifact.reconciliation.counts.SIGNAL_UNCLASSIFIED, 0);
  assert.equal(artifact.reconciliation.write_gate, 'PASS');
  assert.equal(artifact.reconciliation.deterministic, true);
  assert.equal(artifact.reconciliation.first_hash, artifact.reconciliation.second_hash);
  assert.equal(artifact.reconciliation.second_run_canonical_delta, 0);
  assert.equal(artifact.reconciliation.second_run_evidence_delta, 0);
  assert.ok(Object.values(artifact.reconciliation.validation).every(Boolean));

  const baselineRows = readRows(files.baseline);
  const lineRows = readRows(files.line);
  const webPayload = JSON.parse(fs.readFileSync(files.web, 'utf8'));
  const teachers = JSON.parse(fs.readFileSync(files.teacher, 'utf8'));
  const signals = JSON.parse(fs.readFileSync(files.signal, 'utf8'));
  const end = latestFormalDate(baselineRows);
  const start = dateAdd(end, -6);
  const line = adaptLineRows(lineRows, teachers, start, end);
  const web = adaptWebPayload(webPayload, teachers, start, end);
  const baseline = formalProjection(baselineRows, teachers);
  const byFormalEvent = new Map();
  for (const item of [...line.normalized, ...web.normalized]) {
    const matches = baseline.evidenceToEvents.get(item.evidence_id);
    if (!matches || matches.size !== 1) continue;
    const eventId = [...matches][0];
    if (!byFormalEvent.has(eventId)) byFormalEvent.set(eventId, []);
    byFormalEvent.get(eventId).push(item);
  }

  const realPairs = [...byFormalEvent.values()].filter((items) => new Set(items.map((item) => item.source)).size > 1);
  assert.ok(realPairs.length > 0, 'no real WEB+LINE confirmed groups found');
  let arrivalPair = null;
  let forward = null;
  let reverse = null;
  for (const items of realPairs) {
    const lineItem = items.find((item) => item.source === 'LINE');
    const webItem = items.find((item) => item.source === 'WEB');
    const first = reconcileEvidence({ evidence: [lineItem], teacherRegistry: teachers, signalRegistry: signals });
    const lineThenWeb = reconcileEvidence({ existingEvents: first.events, evidence: [webItem], teacherRegistry: teachers, signalRegistry: signals });
    const second = reconcileEvidence({ evidence: [webItem], teacherRegistry: teachers, signalRegistry: signals });
    const webThenLine = reconcileEvidence({ existingEvents: second.events, evidence: [lineItem], teacherRegistry: teachers, signalRegistry: signals });
    if (lineThenWeb.events.length === 1 && webThenLine.events.length === 1 && stableStringify(semanticWithoutIdentity(lineThenWeb)) === stableStringify(semanticWithoutIdentity(webThenLine))) {
      arrivalPair = { ticker: lineItem.ticker, date: lineItem.event_date, teacher_id: webItem.teacher_id };
      forward = lineThenWeb;
      reverse = webThenLine;
      break;
    }
  }
  assert.ok(arrivalPair, 'no real confirmed pair preserved arrival-order semantic equivalence');
  assert.equal(forward.events[0].evidence.length, 2);
  assert.equal(reverse.events[0].evidence.length, 2);

  const structuralGroups = new Map();
  for (const row of artifact.candidates) {
    const key = `${row.teacher_id}|${row.ticker}|${row.action}|${row.event_date}`;
    if (!structuralGroups.has(key)) structuralGroups.set(key, []);
    structuralGroups.get(key).push(row.candidate_id);
  }
  const repeated = [...structuralGroups.values()].filter((ids) => new Set(ids).size > 1);
  assert.ok(repeated.length > 0, 'current-week repeated-operation anchor not found');
  assert.ok(repeated.every((ids) => new Set(ids).size === ids.length), 'repeated operations were collapsed');

  const after = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, hashFile(file)]));
  assert.deepEqual(after, before, 'raw/formal source file changed during dry-run');

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    window: [start, end],
    raw: { WEB: web.raw.length, LINE: line.raw.length },
    normalized: { WEB: web.normalized.length, LINE: line.normalized.length },
    candidate_groups: artifact.candidates.length,
    confirmed_cross_source_groups: realPairs.length,
    real_arrival_order_anchor: arrivalPair,
    expected_delta: { canonical: 0, evidence: 0 },
    second_run_delta: { canonical: 0, evidence: 0 },
    repeated_operation_groups: repeated.length,
    source_files_immutable: true,
  }, null, 2)}\n`);
}

main();
