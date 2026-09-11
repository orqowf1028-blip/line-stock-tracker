'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  UNKNOWN_TEACHER_ID,
  reconcileEvidence,
  resultHash,
  semanticProjection,
  stableStringify,
} = require('./weekly-reconciliation');

const REPO = path.resolve(__dirname, '..');
const WORK = path.resolve(REPO, '..');
const OUT = path.join(WORK, 'w01_v14_weekly_reconciliation');

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(REPO, name), 'utf8'));
}

function readProductionRows() {
  const js = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
  const marker = 'const INITIAL_DATA = ';
  const start = js.indexOf(marker);
  const end = js.indexOf(';\nconst NOTE_KEY', start);
  assert.ok(start >= 0 && end > start, 'INITIAL_DATA payload not found');
  return JSON.parse(js.slice(start + marker.length, end));
}

function meta(row) {
  return row[18] || {};
}

function ticker(row) {
  return (String(row[1] || '').match(/\b\d{4,6}\b/) || [null])[0];
}

function action(row) {
  return meta(row).canonical_action || row[8] || 'UNCLASSIFIED';
}

function sourceSet(row) {
  const records = meta(row).evidence_records || [];
  return new Set(records.map((item) => String(item.source || 'OTHER').toUpperCase()));
}

function isMissingYear(row) {
  const value = meta(row);
  return value.partial_date === true && value.date_precision === 'MONTH_DAY';
}

function pickReplayRows(rows) {
  const selected = [];
  const used = new Set();
  function addWhere(predicate, limit) {
    for (let index = 0; index < rows.length && limit > 0; index += 1) {
      if (used.has(index) || !predicate(rows[index], index)) continue;
      used.add(index);
      selected.push({ index, row: rows[index] });
      limit -= 1;
    }
  }

  const anchors = new Set(['2454', '4971', '2303', '2486', '4576', '3037']);
  addWhere((row) => anchors.has(ticker(row)), 8);
  addWhere((row) => sourceSet(row).has('LINE') && sourceSet(row).has('WEB'), 7);
  addWhere((row) => sourceSet(row).size === 1 && sourceSet(row).has('WEB'), 5);
  addWhere((row) => sourceSet(row).size === 1 && sourceSet(row).has('LINE'), 4);
  addWhere((row) => meta(row).teacher_id === UNKNOWN_TEACHER_ID || !meta(row).teacher_id, 2);
  addWhere((row) => meta(row).review_status === 'REVIEW_REQUIRED' || meta(row).review_reason === 'AMBIGUOUS_SAME_DAY_DUPLICATE', 2);
  addWhere((row) => isMissingYear(row), 1);
  addWhere((row) => action(row) === 'UNCLASSIFIED', 1);
  addWhere(() => true, 30 - selected.length);
  assert.equal(selected.length, 30, 'bounded replay must contain 30 canonical events');
  return selected;
}

function rowEvidence(selected) {
  const output = [];
  for (const { index, row } of selected) {
    const value = meta(row);
    const records = value.evidence_records?.length ? value.evidence_records : [{ source: value.source_label || 'OTHER', raw_text: value.raw_evidence || row[7] || '' }];
    const code = ticker(row);
    const date = value.signal_date || value.resolved_date || null;
    const correlationKey = `formal-row-${index}-${value.event_id || code || 'unknown'}`;
    records.forEach((record, evidenceIndex) => {
      let observedAt = record.observed_at || null;
      if (!observedAt && record.line_message_date && record.line_message_time) observedAt = `${record.line_message_date}T${record.line_message_time}:00+08:00`;
      const sourceId = record.line_message_hash || record.event_id || record.component_id || record.source_ref || `${index}-${evidenceIndex}`;
      const candidatePrice = action(row) === 'SELL' && row[9] ? row[9] : row[2];
      output.push({
        evidence_id: `replay-${String(index).padStart(4, '0')}-${evidenceIndex}-${sha(`${record.source || 'OTHER'}|${sourceId}|${record.raw_text || ''}`).slice(0, 12)}`,
        source: record.source || value.source_label || 'OTHER',
        source_event_id: sourceId,
        correlation_key: correlationKey,
        teacher_id: value.teacher_id || UNKNOWN_TEACHER_ID,
        teacher_display_name: value.teacher_display_name || row[6] || '未標示',
        ticker: code,
        canonical_action: action(row),
        raw_action: value.raw_action || row[8],
        exit_scope: value.exit_scope || null,
        event_date: date,
        raw_date: value.raw_date || row[0] || null,
        date_precision: value.date_precision || (date ? 'DATE' : 'MONTH_DAY'),
        source_snapshot_date: value.source_snapshot_date || null,
        observed_at: observedAt,
        effective_at: value.effective_at || null,
        published_at: value.source_published_at || null,
        price: candidatePrice,
        price_semantics: value.entry_price_semantics || value.exit_price_semantics || null,
        price_quality: 'SOURCE_EXPLICIT',
        display_reason: value.display_reason || row[7] || null,
        raw_text: record.raw_text || value.raw_evidence || row[7] || null,
        signal_definition_id: value.signal_definition_id || null,
        signal_definition_version: value.signal_definition_version || null,
      });
    });
  }
  return output;
}

function knownTeacher(registry, offset = 0) {
  const values = registry.teachers.filter((item) => item.teacher_id !== UNKNOWN_TEACHER_ID && item.review_status === 'CONFIRMED');
  return values[offset];
}

function fixtureEvidence(teachers) {
  const t1 = knownTeacher(teachers, 0);
  const t2 = knownTeacher(teachers, 1);
  const base = {
    event_date: '2026-09-06',
    date_precision: 'DATE',
    signal_definition_id: 'W01-SIG-BUY-V1',
    signal_definition_version: '1.0',
  };
  return {
    webOnly: [{ ...base, evidence_id: 'fx-web-only', correlation_key: 'fx-web-only-op', source: 'WEB', source_event_id: 'web-001', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T001', action: 'BUY', price: 101, raw_text: '結構化買進 101' }],
    lineOnly: [{ ...base, evidence_id: 'fx-line-only', correlation_key: 'fx-line-only-op', source: 'LINE', source_event_id: 'line-001', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T002', action: 'BUY', observed_at: '2026-09-06T09:18:00+08:00', price: 88, raw_text: '即時買進 88，配置一成', display_reason: '即時買進並配置一成' }],
    lineWebPair: [
      { ...base, evidence_id: 'fx-lw-line', correlation_key: 'fx-lw-op', source: 'LINE', source_event_id: 'line-002', teacher_id: UNKNOWN_TEACHER_ID, teacher_display_name: '未標示', ticker: 'T003', action: 'BUY', observed_at: '2026-09-06T09:18:00+08:00', price: 75, raw_text: '買進 T003 75，伺服器題材', display_reason: '伺服器題材，買進 75' },
      { ...base, evidence_id: 'fx-lw-web', correlation_key: 'fx-lw-op', source: 'WEB', source_event_id: 'web-002', teacher_id: t2.teacher_id, teacher_display_name: t2.display_name, ticker: 'T003', action: 'BUY', observed_at: '2026-09-06T14:00:00+08:00', price: 75, raw_text: 'T003 買進 75' },
    ],
    webLinePair: [
      { ...base, evidence_id: 'fx-wl-web', correlation_key: 'fx-wl-op', source: 'WEB', source_event_id: 'web-003', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T004', action: 'BUY', observed_at: '2026-09-06T14:00:00+08:00', price: 66, raw_text: 'T004 買進 66' },
      { ...base, evidence_id: 'fx-wl-line', correlation_key: 'fx-wl-op', source: 'LINE', source_event_id: 'line-003', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T004', action: 'BUY', observed_at: '2026-09-06T09:30:00+08:00', price: 66, raw_text: 'T004 66 元買進，停損 63，目標 75', display_reason: '66 元買進；停損 63、目標 75' },
    ],
    unknownTeacher: [{ ...base, evidence_id: 'fx-unknown', correlation_key: 'fx-unknown-op', source: 'LINE', source_event_id: 'line-004', teacher_id: UNKNOWN_TEACHER_ID, teacher_display_name: '未標示', ticker: 'T005', action: 'HOLD', signal_definition_id: 'W01-SIG-HOLD-V1', raw_text: '續抱 T005' }],
    repeatedInput: [{ ...base, evidence_id: 'fx-repeat', correlation_key: 'fx-repeat-op', source: 'WEB', source_event_id: 'web-004', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T006', action: 'BUY', price: 45, raw_text: 'T006 買進 45' }],
    repeatedOperations: [
      { ...base, evidence_id: 'fx-op-a', correlation_key: 'fx-operation-a', sequence_key: 'A', source: 'WEB', source_event_id: 'web-005a', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T007', action: 'BUY', price: 50, raw_text: '第一次買進 50' },
      { ...base, evidence_id: 'fx-op-b', correlation_key: 'fx-operation-b', sequence_key: 'B', source: 'WEB', source_event_id: 'web-005b', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T007', action: 'BUY', price: 51, raw_text: '第二次買進 51' },
    ],
    conflict: [
      { ...base, evidence_id: 'fx-conflict-web', correlation_key: 'fx-conflict-op', source: 'WEB', source_event_id: 'web-006', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T008', action: 'BUY', price: 70, raw_text: 'T008 買進' },
      { ...base, evidence_id: 'fx-conflict-line', correlation_key: 'fx-conflict-op', source: 'LINE', source_event_id: 'line-006', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T008', action: 'SELL', signal_definition_id: 'W01-SIG-SELL-V1', price: 70, raw_text: 'T008 賣出' },
    ],
    correction: [
      { ...base, evidence_id: 'fx-correction-original', correlation_key: 'fx-correction-op', source: 'WEB', source_event_id: 'web-007', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T009', action: 'BUY', price: 100, raw_text: 'T009 買進 100' },
      { ...base, evidence_id: 'fx-correction-later', correlation_key: 'fx-correction-op', correction_of: 'fx-correction-original', source: 'WEB', source_event_id: 'web-007-correction', teacher_id: t1.teacher_id, teacher_display_name: t1.display_name, ticker: 'T009', action: 'BUY', price: 102, raw_text: '更正：T009 買進 102', display_reason: '更正買進價為 102' },
    ],
  };
}

function assertAllValidation(result) {
  for (const [key, value] of Object.entries(result.validation)) assert.equal(value, true, `validation failed: ${key}`);
}

function main() {
  const appBefore = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
  const teacherBefore = fs.readFileSync(path.join(REPO, 'teacher-registry.json'), 'utf8');
  const signalBefore = fs.readFileSync(path.join(REPO, 'signal-definition-registry.json'), 'utf8');
  const rows = readProductionRows();
  const teachers = JSON.parse(teacherBefore);
  const signals = JSON.parse(signalBefore);
  const selected = pickReplayRows(rows);
  const replayInput = rowEvidence(selected);
  const replay = reconcileEvidence({ evidence: replayInput, teacherRegistry: teachers, signalRegistry: signals });
  assertAllValidation(replay);
  assert.equal(replay.events.length, 30, 'known canonical sample must replay to 30 events');
  assert.equal(replay.events.reduce((sum, event) => sum + event.evidence.length, 0), new Set(replayInput.map((item) => item.evidence_id)).size, 'all sample Evidence must be retained once');

  const reversedReplay = reconcileEvidence({ evidence: [...replayInput].reverse(), teacherRegistry: teachers, signalRegistry: signals });
  assert.equal(resultHash(replay), resultHash(reversedReplay), 'bounded replay must be input-order deterministic');

  const fx = fixtureEvidence(teachers);
  const lineFirst = reconcileEvidence({ evidence: [fx.lineWebPair[0]], teacherRegistry: teachers, signalRegistry: signals });
  const lineThenWeb = reconcileEvidence({ existingEvents: lineFirst.events, evidence: [fx.lineWebPair[1]], teacherRegistry: teachers, signalRegistry: signals });
  const webFirst = reconcileEvidence({ evidence: [fx.lineWebPair[1]], teacherRegistry: teachers, signalRegistry: signals });
  const webThenLine = reconcileEvidence({ existingEvents: webFirst.events, evidence: [fx.lineWebPair[0]], teacherRegistry: teachers, signalRegistry: signals });
  assert.equal(resultHash(lineThenWeb), resultHash(webThenLine), 'LINE→WEB and WEB→LINE must converge');
  assert.equal(lineThenWeb.events.length, 1);
  assert.equal(lineThenWeb.events[0].teacher_id, fx.lineWebPair[1].teacher_id);
  assert.equal(lineThenWeb.events[0].observed_at, fx.lineWebPair[0].observed_at);
  assert.deepEqual(lineThenWeb.events[0].sources, ['LINE', 'WEB']);

  const reversePairA = reconcileEvidence({ evidence: fx.webLinePair, teacherRegistry: teachers, signalRegistry: signals });
  const reversePairB = reconcileEvidence({ evidence: [...fx.webLinePair].reverse(), teacherRegistry: teachers, signalRegistry: signals });
  assert.equal(resultHash(reversePairA), resultHash(reversePairB), 'WEB→LINE enrichment must be input-order independent');

  const weeklyInput = [
    ...fx.webOnly,
    ...fx.lineOnly,
    ...fx.lineWebPair,
    ...fx.webLinePair,
    ...fx.unknownTeacher,
    ...fx.repeatedInput,
    ...fx.repeatedInput,
    ...fx.repeatedOperations,
    ...fx.conflict,
    ...fx.correction,
  ];
  const weekly = reconcileEvidence({ evidence: weeklyInput, teacherRegistry: teachers, signalRegistry: signals });
  assertAllValidation(weekly);
  assert.equal(weekly.events.filter((event) => event.ticker === 'T003').length, 1, 'LINE-first/WEB-later must be one event');
  assert.equal(weekly.events.filter((event) => event.ticker === 'T004').length, 1, 'WEB-first/LINE-later must be one event');
  assert.equal(weekly.events.filter((event) => event.ticker === 'T007').length, 2, 'same-day repeated operations must remain separate');
  assert.equal(weekly.events.filter((event) => event.ticker === 'T008').length, 2, 'source conflict must remain separate');
  assert.ok(weekly.events.filter((event) => event.ticker === 'T008').every((event) => event.state === 'SOURCE_CONFLICT'));
  const unknown = weekly.events.find((event) => event.ticker === 'T005');
  assert.equal(unknown.teacher_id, UNKNOWN_TEACHER_ID);
  assert.equal(unknown.review_status, 'TEACHER_UNRESOLVED');
  assert.equal(weekly.events.find((event) => event.ticker === 'T006').evidence.length, 1, 'same Evidence must deduplicate');
  const corrected = weekly.events.find((event) => event.ticker === 'T009');
  assert.equal(corrected.price, 102, 'explicit late correction must replace the active canonical price');
  assert.equal(corrected.evidence.length, 2, 'late correction must retain original and correction Evidence');
  assert.equal(corrected.field_conflicts.length, 0, 'superseded correction value must not become an unresolved field conflict');

  const secondRun = reconcileEvidence({ existingEvents: weekly.events, evidence: weeklyInput, teacherRegistry: teachers, signalRegistry: signals });
  assert.equal(resultHash(weekly), resultHash(secondRun), 'weekly rerun must be idempotent');
  const correctionStart = reconcileEvidence({ evidence: [fx.correction[0]], teacherRegistry: teachers, signalRegistry: signals });
  const correctionApplied = reconcileEvidence({ existingEvents: correctionStart.events, evidence: [fx.correction[1]], teacherRegistry: teachers, signalRegistry: signals });
  assert.equal(correctionApplied.events.length, 1, 'late correction must update the affected event only');
  assert.equal(correctionApplied.events[0].price, 102, 'late correction must update the active canonical field');
  assert.equal(correctionApplied.events[0].evidence.length, 2, 'late correction must retain original Evidence lineage');

  assert.equal(fs.readFileSync(path.join(REPO, 'app.js'), 'utf8'), appBefore, 'production app.js changed during shadow test');
  assert.equal(fs.readFileSync(path.join(REPO, 'teacher-registry.json'), 'utf8'), teacherBefore, 'Teacher Registry mutated');
  assert.equal(fs.readFileSync(path.join(REPO, 'signal-definition-registry.json'), 'utf8'), signalBefore, 'Signal Registry mutated');
  assert.equal(rows.length, 2611, 'current canonical candidate changed');
  const evidenceCount = rows.reduce((sum, row) => sum + ((meta(row).evidence_records || []).length || 1), 0);
  assert.equal(evidenceCount, 2831, 'current Evidence candidate changed');

  const missingYear = rows.filter(isMissingYear).length;
  const unclassified = rows.filter((row) => String(meta(row).signal_definition_id || '').includes('UNCLASSIFIED')).length;
  const ambiguousRows = rows.filter((row) => meta(row).review_reason === 'AMBIGUOUS_SAME_DAY_DUPLICATE' || meta(row).review_status === 'REVIEW_REQUIRED').length;
  const ambiguousGroups = new Set(rows.filter((row) => meta(row).review_reason === 'AMBIGUOUS_SAME_DAY_DUPLICATE' || meta(row).review_status === 'REVIEW_REQUIRED').map((row) => meta(row).review_group_id || `${row[0]}|${row[1]}|${row[6]}|${row[8]}|${row[2]}`)).size;

  assert.equal(missingYear, 1213, 'missing-year baseline regressed');
  assert.equal(ambiguousGroups, 86, 'review group candidate regressed');
  assert.equal(ambiguousRows, 159, 'review row candidate regressed');
  assert.equal(unclassified, 3, 'UNCLASSIFIED baseline regressed');
  assert.equal(teachers.merge_reviews.length, 2, 'teacher identity review groups regressed');
  assert.equal(teachers.teachers.length, 73, 'Teacher Registry count regressed');
  assert.equal((signals.definitions || []).length, 9, 'Signal Definition count regressed');

  function findRow(code, predicate) {
    const found = rows.find((row) => ticker(row) === code && predicate(row, meta(row)));
    assert.ok(found, `regression anchor missing: ${code}`);
    return found;
  }
  const a2454 = findRow('2454', (row, value) => row[0] === '09/04' && row[6] === '蘇尊龍' && value.canonical_action === 'HOLD');
  assert.equal(a2454[2], '3350');
  const a4971 = findRow('4971', (row, value) => row[6] === '蘇尊龍' && value.canonical_action === 'HOLD' && row[2] === '501');
  assert.ok(String(meta(a4971).raw_evidence || '').includes('500') || String(meta(a4971).normalized_reason || '').includes('500'), '4971 approximate historical claim lost');
  const a2303 = findRow('2303', (row, value) => row[0] === '09/04' && row[6] === '徐紹軒' && value.exit_scope === 'FULL');
  assert.equal(a2303[2], '不明');
  assert.equal(a2303[9], '127.5');
  assert.ok(String(a2303[4]).includes('年份未明'));
  const a2486 = findRow('2486', (row, value) => row[0] === '09/04' && row[6] === '徐紹軒' && value.canonical_action === 'BUY');
  assert.equal(a2486[2], '254.0');
  assert.ok(String(a2486[10]).includes('10'));
  const a4576Full = findRow('4576', (row, value) => row[0] === '09/04' && row[6] === '陳韋廷' && value.exit_scope === 'FULL');
  const a4576Unknown = findRow('4576', (row, value) => row[0] === '09/04' && row[6] === '蘇麗芬' && value.exit_scope === 'UNKNOWN');
  assert.equal(a4576Full[9], '227.5');
  assert.equal(a4576Unknown[9], '236.5');
  findRow('3037', (row, value) => value.signal_date === '2025-08-18' && row[2] === '142');
  findRow('3037', (row, value) => value.signal_date === '2025-08-27' && row[2] === '152.5');

  assert.ok(appBefore.includes("const NOTE_KEY = 'lineTrackerNotesV3'"), 'local notes key regressed');
  assert.ok(appBefore.includes("addWorksheet('Signals')"), 'XLSX Signals sheet regressed');
  assert.ok(appBefore.includes("addWorksheet('Evidence')"), 'XLSX Evidence sheet regressed');
  assert.ok(appBefore.includes("addWorksheet('Export_Info')"), 'XLSX Export_Info sheet regressed');
  assert.ok(appBefore.includes('raw_evidence'), 'Raw Evidence support regressed');
  const publicText = ['index.html', 'app.js', 'stock.html', 'stock.js', 'signal-data.js', '_worker.js']
    .map((name) => fs.readFileSync(path.join(REPO, name), 'utf8')).join('\n');
  assert.equal(/W08[_ -]?PRIVATE|台股持股\\Agent工作區/i.test(publicText), false, 'W08 private-data marker leaked into public assets');

  const fixtureResults = {
    new_web_only: weekly.events.filter((event) => event.ticker === 'T001').length === 1,
    new_line_first: weekly.events.filter((event) => event.ticker === 'T002').length === 1,
    line_first_web_later: weekly.events.filter((event) => event.ticker === 'T003').length === 1,
    web_first_line_later: weekly.events.filter((event) => event.ticker === 'T004').length === 1,
    unknown_teacher_line: unknown.teacher_id === UNKNOWN_TEACHER_ID && unknown.review_status === 'TEACHER_UNRESOLVED',
    same_event_twice: weekly.events.find((event) => event.ticker === 'T006').evidence.length === 1,
    same_day_second_operation: weekly.events.filter((event) => event.ticker === 'T007').length === 2,
      source_conflict: weekly.events.filter((event) => event.ticker === 'T008').length === 2,
      late_correction: corrected.price === 102 && corrected.evidence.length === 2,
  };

  const artifact = {
    artifact_id: 'W01_V14_WEEKLY_RECONCILIATION_SHADOW_2026-09-06',
    generated_at: new Date().toISOString(),
    formal_baseline: {
      commit: 'c8fd408d8419df94fdefdf86b967a28be37c771c',
      canonical_events: rows.length,
      evidence_records: evidenceCount,
      missing_year: missingYear,
      ambiguous_groups: ambiguousGroups,
      ambiguous_rows: ambiguousRows,
      unclassified: unclassified,
      teacher_registry_count: teachers.teachers.length,
      signal_definition_count: (signals.definitions || signals.signal_definitions || []).length,
      production_delta: { canonical: 0, evidence: 0 },
    },
    replay: {
      sample_canonical_events: selected.length,
      sample_evidence_records: replayInput.length,
      replayed_events: replay.events.length,
      replay_hash: resultHash(replay),
      reversed_input_hash: resultHash(reversedReplay),
      input_order_deterministic: resultHash(replay) === resultHash(reversedReplay),
      selected_row_indices: selected.map((item) => item.index),
      selected_tickers: selected.map((item) => ticker(item.row)),
    },
    arrival_order: {
      line_then_web_hash: resultHash(lineThenWeb),
      web_then_line_hash: resultHash(webThenLine),
      semantically_equivalent: resultHash(lineThenWeb) === resultHash(webThenLine),
      semantic_projection: semanticProjection(lineThenWeb),
    },
    weekly_fixture: {
      input_evidence: weeklyInput.length,
      unique_evidence: new Set(weeklyInput.map((item) => item.evidence_id)).size,
      output_events: weekly.events.length,
      result_hash: resultHash(weekly),
      second_run_hash: resultHash(secondRun),
      idempotent: resultHash(weekly) === resultHash(secondRun),
      late_correction_sequential: {
        affected_events: correctionApplied.events.length,
        active_price: correctionApplied.events[0].price,
        evidence_records: correctionApplied.events[0].evidence.length,
      },
      cases: fixtureResults,
      audit: weekly.audit,
    },
    integrity: {
      teacher_registry_hash_before_after: sha(teacherBefore),
      signal_registry_hash_before_after: sha(signalBefore),
      app_hash_before_after: sha(appBefore),
      validation: weekly.validation,
      all_fixture_cases_pass: Object.values(fixtureResults).every(Boolean),
    },
    checkpoints: {
      A_architecture_inventory: 'PASS',
      B_reconciliation_contract: 'PASS',
      C_implementation: 'PASS',
      D_bounded_replay: 'PASS',
      E_arrival_order_equivalence: 'PASS',
      F_weekly_delta_simulation: 'PASS',
      G_preproduction_gate: 'SHADOW_PASS_NO_PRODUCTION_DEPLOYMENT',
    },
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'weekly_reconciliation_shadow_0906.json'), `${stableStringify(artifact)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT, 'checkpoints_0906.json'), `${stableStringify(artifact.checkpoints)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

main();
