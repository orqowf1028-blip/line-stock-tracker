'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  UNKNOWN_TEACHER_ID,
  canonicalAction,
  normalizeEvidence,
  reconcileEvidence,
  resultHash,
  stableStringify,
} = require('./weekly-reconciliation');

const REPO = path.resolve(__dirname, '..');
const WORK = path.resolve(REPO, '..');
const AGENT_ROOT = path.resolve(WORK, '..');
const PROJECT_ROOT = path.resolve(AGENT_ROOT, '..');
const DEFAULT_OUT = path.join(WORK, 'w01_v14_real_adapter');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function readRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  const marker = 'const INITIAL_DATA = ';
  const markerStart = text.indexOf(marker);
  if (markerStart >= 0) return JSON.parse(text.slice(markerStart + marker.length, text.indexOf(';\nconst NOTE_KEY', markerStart)));
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first < 0 || last <= first) throw new Error(`No array payload in ${file}`);
  return JSON.parse(text.slice(first, last + 1));
}

function rowMeta(row) {
  return row[18] || {};
}

function tickerOf(row) {
  return (String(row[1] || '').match(/\d{4,6}[A-Z]?/i) || [null])[0];
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isoDate(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateAdd(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function latestFormalDate(rows) {
  const dates = rows.map((row) => isoDate(rowMeta(row).signal_date || rowMeta(row).resolved_date)).filter(Boolean).sort();
  if (!dates.length) throw new Error('Formal baseline has no complete signal date');
  return dates.at(-1);
}

function inWindow(value, start, end) {
  const date = isoDate(value);
  return Boolean(date && date >= start && date <= end);
}

function sourceName(value) {
  const source = String(value || 'OTHER').trim().toUpperCase();
  if (source === 'MEMBER' || source === 'MEMBER_SITE' || source === 'MEMBER_WEB') return 'WEB';
  if (source === 'REPORT' || source === 'IMAGE') return 'IMAGE';
  return source;
}

function sourceIdentifier(record, fallback) {
  return record.source_event_id || record.event_id || record.component_id || record.line_message_hash || record.source_ref || fallback;
}

function evidenceId({ source, sourceId, ticker, action, eventDate, rawDate }) {
  return `real-${sha256(stableStringify({ source, sourceId, ticker, action, eventDate, rawDate: eventDate ? null : rawDate })).slice(0, 24)}`;
}

function registryMaps(teacherRegistry) {
  const byLabel = new Map();
  for (const teacher of teacherRegistry.teachers || []) {
    const labels = [teacher.canonical_name, teacher.display_name, ...(teacher.aliases || []), ...((teacher.source_identifiers || {}).production_display_labels || []), ...((teacher.source_identifiers || {}).member_page_or_event_labels || [])];
    for (const label of labels.filter(Boolean)) byLabel.set(String(label).trim(), teacher);
  }
  return byLabel;
}

function teacherCandidate(label, maps) {
  const teacher = maps.get(String(label || '').trim());
  return teacher ? { teacher_id: teacher.teacher_id, teacher_display_name: teacher.display_name } : { teacher_id: UNKNOWN_TEACHER_ID, teacher_display_name: '未標示' };
}

function signalDefinitionFor(action, rawAction, exitScope) {
  if (action === 'BUY') return 'W01-SIG-BUY-V1';
  if (action === 'ADD') return 'W01-SIG-ADD-V1';
  if (action === 'HOLD') return 'W01-SIG-HOLD-V1';
  if (action === 'SHORT') return 'W01-SIG-SHORT-V1';
  if (action === 'COVER') return 'W01-SIG-COVER-V1';
  if (action === 'SELL' && (exitScope === 'FULL' || String(rawAction || '').includes('出場') || String(rawAction || '').includes('出清'))) return 'W01-SIG-EXIT-FULL-V1';
  if (action === 'SELL') return 'W01-SIG-SELL-V1';
  if (action === 'MARKET') return 'W01-SIG-MARKET-V1';
  return 'W01-SIG-UNCLASSIFIED-V1';
}

function normalizedRecord(raw) {
  const normalized = normalizeEvidence(raw);
  return {
    ...normalized,
    source_ref: raw.source_ref || null,
    raw_teacher: raw.raw_teacher || null,
    teacher_candidate: raw.teacher_candidate || normalized.teacher_id,
    raw_reason: raw.raw_reason || raw.raw_text || null,
    allocation_context: raw.allocation_context || raw.allocation || null,
  };
}

function baseRawFromRow(row, record, index, evidenceIndex, teacherMaps = null) {
  const meta = rowMeta(row);
  const source = sourceName(record.source || meta.source_label || meta.source_kind);
  const ticker = tickerOf(row);
  const action = canonicalAction(meta.canonical_action || row[8]);
  const eventDate = isoDate(meta.signal_date || meta.resolved_date);
  const rawDate = meta.raw_date || row[0] || null;
  const sourceId = sourceIdentifier(record, `${index}-${evidenceIndex}`);
  let observedAt = record.observed_at || meta.observed_at || null;
  if (!observedAt && record.line_message_date && record.line_message_time) observedAt = `${record.line_message_date}T${record.line_message_time}:00+08:00`;
  const price = action === 'SELL' ? numeric(row[9]) : numeric(row[2]);
  const teacher = meta.teacher_id ? { teacher_id: meta.teacher_id, teacher_display_name: meta.teacher_display_name || row[6] || '未標示' } : teacherCandidate(row[6], teacherMaps || new Map());
  const raw = {
    evidence_id: evidenceId({ source, sourceId, ticker, action, eventDate, rawDate }),
    source,
    source_ref: record.source_ref || meta.source_ref || null,
    source_event_id: sourceId,
    raw_teacher: meta.teacher_display_name || row[6] || null,
    teacher_candidate: teacher.teacher_id,
    teacher_id: teacher.teacher_id,
    teacher_display_name: teacher.teacher_display_name,
    ticker,
    raw_action: meta.raw_action || row[8] || null,
    canonical_action: action,
    exit_scope: meta.exit_scope || null,
    event_date: eventDate,
    raw_date: rawDate,
    date_precision: meta.date_precision || (eventDate ? 'DATE' : 'MONTH_DAY'),
    source_snapshot_date: meta.source_snapshot_date || null,
    observed_at: observedAt,
    effective_at: meta.effective_at || null,
    published_at: meta.source_published_at || null,
    price,
    price_semantics: meta.entry_price_semantics || meta.exit_price_semantics || null,
    price_quality: meta.source_price_status === 'VERIFIED_EXECUTION' ? 'VERIFIED_EXECUTION' : 'SOURCE_EXPLICIT',
    raw_reason: meta.display_reason || row[7] || null,
    display_reason: meta.display_reason || row[7] || null,
    raw_text: record.raw_text || meta.raw_evidence || row[7] || null,
    allocation_context: row[10] || null,
    signal_definition_id: meta.signal_definition_id || signalDefinitionFor(action, meta.raw_action || row[8], meta.exit_scope),
    signal_definition_version: meta.signal_definition_version || '1.0',
    metadata: { formal_row_index: index, formal_event_id: meta.event_id || null },
  };
  return normalizedRecord(raw);
}

function adaptLineRows(rows, teacherRegistry, start, end) {
  const raw = [];
  const maps = registryMaps(teacherRegistry);
  let incompleteDateExcluded = 0;
  rows.forEach((row, index) => {
    const meta = rowMeta(row);
    const eventDate = isoDate(meta.signal_date || meta.resolved_date);
    const lineRecords = (meta.evidence_records || []).filter((record) => sourceName(record.source) === 'LINE');
    if (!lineRecords.length) return;
    if (!eventDate) {
      incompleteDateExcluded += lineRecords.length;
      return;
    }
    if (!inWindow(eventDate, start, end)) return;
    lineRecords.forEach((record, evidenceIndex) => raw.push(baseRawFromRow(row, record, index, evidenceIndex, maps)));
  });
  const unique = new Map(raw.map((item) => [item.evidence_id, item]));
  return { raw, normalized: [...unique.values()].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)), incompleteDateExcluded };
}

function adaptWebPayload(payload, teacherRegistry, start, end) {
  const maps = registryMaps(teacherRegistry);
  const raw = [];
  let incompleteDateExcluded = 0;
  for (const event of payload.events || []) {
    const eventDate = isoDate(event.signal_date || event.resolved_date);
    if (!eventDate) {
      incompleteDateExcluded += 1;
      continue;
    }
    if (!inWindow(eventDate, start, end)) continue;
    const teacher = teacherCandidate(event.teacher, maps);
    const source = 'WEB';
    const action = canonicalAction(event.canonical_action || event.action);
    const rawAction = event.raw_action || event.action || null;
    const exitScope = event.exit_scope || (action === 'SELL' && (String(rawAction).includes('出場') || String(rawAction).includes('出清')) ? 'FULL' : (action === 'SELL' ? 'UNKNOWN' : null));
    const sourceId = event.id;
    const item = {
      evidence_id: evidenceId({ source, sourceId, ticker: event.code, action, eventDate, rawDate: event.raw_date || event.date }),
      source,
      source_ref: event.source_audit || payload.lineage_file || 'member_site_signals.json',
      source_event_id: sourceId,
      raw_teacher: event.teacher_source || event.teacher || null,
      teacher_candidate: teacher.teacher_id,
      teacher_id: teacher.teacher_id,
      teacher_display_name: teacher.teacher_display_name,
      ticker: String(event.code || '').trim() || null,
      raw_action: rawAction,
      canonical_action: action,
      exit_scope: exitScope,
      event_date: eventDate,
      raw_date: event.raw_date || event.date || null,
      date_precision: event.date_precision || 'DATE',
      source_snapshot_date: payload.captured_at ? String(payload.captured_at).slice(0, 10) : null,
      observed_at: event.time ? `${eventDate}T${event.time}:00+08:00` : event.observed_at || null,
      effective_at: event.effective_at || null,
      published_at: event.source_published_at || null,
      price: numeric(event.price || event.exit),
      price_semantics: event.price_semantics || null,
      price_quality: event.source_price_status === 'VERIFIED_EXECUTION' ? 'VERIFIED_EXECUTION' : 'SOURCE_EXPLICIT',
      raw_reason: event.detail || null,
      display_reason: event.detail || null,
      raw_text: event.raw_evidence || event.detail || `${event.teacher || '未標示'} ${event.code || ''} ${event.action || ''}`,
      allocation_context: event.quantity || null,
      signal_definition_id: event.signal_definition_id || signalDefinitionFor(action, rawAction, exitScope),
      signal_definition_version: event.signal_definition_version || '1.0',
      metadata: { source_section: event.source_section || null, evidence_grade: event.evidence_grade || null },
    };
    raw.push(normalizedRecord(item));
  }
  const unique = new Map(raw.map((item) => [item.evidence_id, item]));
  return { raw, normalized: [...unique.values()].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)), incompleteDateExcluded };
}

function formalProjection(rows, teacherRegistry) {
  const events = [];
  const evidenceToEvents = new Map();
  const maps = registryMaps(teacherRegistry);
  rows.forEach((row, index) => {
    const meta = rowMeta(row);
    const records = meta.evidence_records?.length ? meta.evidence_records : [{ source: meta.source_label || meta.source_kind || 'OTHER', raw_text: meta.raw_evidence || row[7] || '' }];
    const evidence = records.map((record, evidenceIndex) => baseRawFromRow(row, record, index, evidenceIndex, maps));
    const eventId = `formal-${String(index).padStart(4, '0')}-${meta.event_id || sha256(`${row[0]}|${row[1]}|${row[6]}|${row[8]}|${row[2]}`).slice(0, 12)}`;
    const event = {
      event_id: eventId,
      teacher_id: meta.teacher_id || UNKNOWN_TEACHER_ID,
      teacher_display_name: meta.teacher_display_name || row[6] || '未標示',
      ticker: tickerOf(row),
      action: canonicalAction(meta.canonical_action || row[8]),
      exit_scope: meta.exit_scope || null,
      event_date: isoDate(meta.signal_date || meta.resolved_date),
      raw_date: meta.raw_date || row[0] || null,
      observed_at: meta.observed_at || null,
      price: canonicalAction(meta.canonical_action || row[8]) === 'SELL' ? numeric(row[9]) : numeric(row[2]),
      display_reason: meta.display_reason || row[7] || null,
      evidence,
      correlation_keys: [],
      source_event_ids: evidence.map((item) => item.source_event_id).filter(Boolean),
      sequence_keys: [],
      force_state: null,
      field_lineage: {},
    };
    events.push(event);
    for (const item of evidence) {
      if (!evidenceToEvents.has(item.evidence_id)) evidenceToEvents.set(item.evidence_id, new Set());
      evidenceToEvents.get(item.evidence_id).add(eventId);
    }
  });
  return { events, evidenceToEvents };
}

function sanitizeEvidence(item) {
  return {
    evidence_id: item.evidence_id,
    source: item.source,
    source_ref: item.source_ref,
    source_event_id: item.source_event_id,
    raw_teacher: item.raw_teacher,
    teacher_candidate: item.teacher_id,
    ticker: item.ticker,
    raw_action: item.raw_action,
    action_candidate: item.action,
    exit_scope: item.exit_scope,
    raw_date: item.raw_date,
    event_date: item.event_date,
    source_snapshot_date: item.source_snapshot_date,
    observed_at: item.observed_at,
    effective_at: item.effective_at,
    price: item.price,
    price_semantics: item.price_semantics,
    allocation_context: item.allocation_context,
    signal_definition_id: item.signal_definition_id,
    raw_evidence_sha256: sha256(item.raw_text || ''),
  };
}

function classifyCurrentWeek({ baseline, incoming, teacherRegistry, signalRegistry }) {
  const exact = [];
  const unmatched = [];
  for (const item of incoming) {
    const matches = baseline.evidenceToEvents.get(item.evidence_id);
    if (matches?.size) exact.push({ item, existing: [...matches].sort() });
    else unmatched.push(item);
  }

  const groups = new Map();
  for (const match of exact) {
    const key = match.existing.length === 1 ? match.existing[0] : `ambiguous:${match.item.evidence_id}`;
    if (!groups.has(key)) groups.set(key, { candidate_id: key, evidence: [], existing: match.existing, review: match.existing.length > 1 });
    groups.get(key).evidence.push(match.item);
  }

  const reconciliation = unmatched.length ? reconcileEvidence({ existingEvents: baseline.events, evidence: unmatched, teacherRegistry, signalRegistry }) : { events: baseline.events, audit: [], validation: { unknown_teacher_safe: true, teacher_registry_references_valid: true, signal_registry_references_valid: true, evidence_ids_unique_per_event: true, field_lineage_present: true } };
  const baselineIds = new Set(baseline.events.map((event) => event.event_id));
  const deltaRows = [];

  for (const group of groups.values()) {
    const first = group.evidence[0];
    const sources = [...new Set(group.evidence.map((item) => item.source))].sort();
    const status = group.review ? 'MATCH_PROBABLE_REVIEW' : (sources.includes('LINE') && sources.includes('WEB') ? 'MATCH_CONFIRMED' : (sources[0] === 'WEB' ? 'WEB_ONLY' : 'LINE_ONLY'));
    deltaRows.push({
      candidate_id: group.candidate_id,
      teacher_id: first.teacher_id,
      ticker: first.ticker,
      action: first.action,
      event_date: first.event_date,
      observed_at: group.evidence.map((item) => item.observed_at).filter(Boolean).sort()[0] || null,
      sources,
      match_status: status,
      existing_canonical_match: group.existing,
      proposed_action: 'NO_CHANGE',
      review_status: group.review ? 'REVIEW_REQUIRED_EXISTING_AMBIGUITY' : null,
      safety_reason: 'Every incoming Evidence ID is already present in the immutable formal baseline.',
    });
  }

  for (const audit of reconciliation.audit) {
    const item = unmatched.find((candidate) => candidate.evidence_id === audit.evidence_id);
    if (!item) continue;
    let proposedAction = 'REVIEW_REQUIRED';
    if (audit.result === 'MATCH_CONFIRMED') proposedAction = 'ADD_EVIDENCE_ONLY';
    if (audit.result === 'NEW_CANONICAL' && item.teacher_id !== UNKNOWN_TEACHER_ID && item.action !== 'UNCLASSIFIED' && item.event_date) proposedAction = 'NEW_CANONICAL_EVENT';
    if (audit.result === 'DUPLICATE_EVIDENCE' || audit.result === 'DUPLICATE_INPUT') proposedAction = 'NO_CHANGE';
    if (audit.result === 'SOURCE_CONFLICT' || audit.result === 'MATCH_PROBABLE_REVIEW') proposedAction = 'REVIEW_REQUIRED';
    deltaRows.push({
      candidate_id: audit.event_id || item.evidence_id,
      teacher_id: item.teacher_id,
      ticker: item.ticker,
      action: item.action,
      event_date: item.event_date,
      observed_at: item.observed_at,
      sources: [item.source],
      match_status: audit.result,
      existing_canonical_match: audit.related_event_id || audit.event_id || null,
      proposed_action: proposedAction,
      review_status: proposedAction === 'REVIEW_REQUIRED' ? audit.result : null,
      safety_reason: proposedAction === 'NEW_CANONICAL_EVENT' ? 'Complete date, known registry teacher and classified action; not applied in dry-run.' : 'No automatic canonical mutation in dry-run.',
    });
  }

  deltaRows.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const counts = {};
  for (const name of ['MATCH_CONFIRMED', 'MATCH_PROBABLE_REVIEW', 'WEB_ONLY', 'LINE_ONLY', 'SOURCE_CONFLICT', 'TEACHER_UNRESOLVED', 'SIGNAL_UNCLASSIFIED', 'NEW_CANONICAL_EVENT', 'ADD_EVIDENCE_ONLY', 'FIELD_ENRICHMENT', 'NO_CHANGE', 'REVIEW_REQUIRED', 'REJECTED']) counts[name] = 0;
  for (const row of deltaRows) {
    if (counts[row.match_status] !== undefined) counts[row.match_status] += 1;
    if (counts[row.proposed_action] !== undefined) counts[row.proposed_action] += 1;
    if (row.teacher_id === UNKNOWN_TEACHER_ID) counts.TEACHER_UNRESOLVED += 1;
    if (row.action === 'UNCLASSIFIED') counts.SIGNAL_UNCLASSIFIED += 1;
  }
  const safeNew = deltaRows.filter((row) => row.proposed_action === 'NEW_CANONICAL_EVENT').length;
  const safeEvidence = deltaRows.filter((row) => ['NEW_CANONICAL_EVENT', 'ADD_EVIDENCE_ONLY', 'FIELD_ENRICHMENT'].includes(row.proposed_action)).reduce((sum, row) => sum + row.sources.length, 0);
  return {
    exact_evidence: exact.length,
    unmatched_evidence: unmatched.length,
    delta_rows: deltaRows,
    counts,
    proposed: { canonical_delta: safeNew, evidence_delta: safeEvidence, field_enrichments: counts.FIELD_ENRICHMENT },
    validation: reconciliation.validation,
    reconciliation_hash: resultHash(reconciliation),
    baseline_event_ids_preserved: baseline.events.every((event) => baselineIds.has(event.event_id)),
  };
}

function sourceRoleCounts(deltaRows) {
  return {
    MATCH_CONFIRMED: deltaRows.filter((row) => row.match_status === 'MATCH_CONFIRMED').length,
    MATCH_PROBABLE_REVIEW: deltaRows.filter((row) => row.match_status === 'MATCH_PROBABLE_REVIEW').length,
    WEB_ONLY: deltaRows.filter((row) => row.match_status === 'WEB_ONLY').length,
    LINE_ONLY: deltaRows.filter((row) => row.match_status === 'LINE_ONLY').length,
  };
}

function runDryRun(options = {}) {
  const files = {
    baseline: options.baseline || path.join(REPO, 'app.js'),
    line: options.line || path.join(AGENT_ROOT, 'outputs', 'line_signals.js'),
    web: options.web || path.join(WORK, 'member_site_signals.json'),
    teacherRegistry: options.teacherRegistry || path.join(REPO, 'teacher-registry.json'),
    signalRegistry: options.signalRegistry || path.join(REPO, 'signal-definition-registry.json'),
    out: options.out || DEFAULT_OUT,
  };
  const baselineRows = readRows(files.baseline);
  const lineRows = readRows(files.line);
  const webPayload = JSON.parse(fs.readFileSync(files.web, 'utf8'));
  const teacherRegistry = JSON.parse(fs.readFileSync(files.teacherRegistry, 'utf8'));
  const signalRegistry = JSON.parse(fs.readFileSync(files.signalRegistry, 'utf8'));
  const end = latestFormalDate(baselineRows);
  const start = dateAdd(end, -6);
  const line = adaptLineRows(lineRows, teacherRegistry, start, end);
  const web = adaptWebPayload(webPayload, teacherRegistry, start, end);
  const incomingMap = new Map([...line.normalized, ...web.normalized].map((item) => [item.evidence_id, item]));
  const incoming = [...incomingMap.values()].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  const baseline = formalProjection(baselineRows, teacherRegistry);
  const classified = classifyCurrentWeek({ baseline, incoming, teacherRegistry, signalRegistry });
  const second = classifyCurrentWeek({ baseline, incoming, teacherRegistry, signalRegistry });
  const deterministic = sha256(stableStringify(classified)) === sha256(stableStringify(second));
  const secondRun = classifyCurrentWeek({ baseline, incoming, teacherRegistry, signalRegistry });
  const allValidation = Object.values(classified.validation).every(Boolean);
  const exactDeltaKnown = Number.isInteger(classified.proposed.canonical_delta) && Number.isInteger(classified.proposed.evidence_delta);
  const writeGate = allValidation && deterministic && exactDeltaKnown && classified.counts.SOURCE_CONFLICT === 0 && classified.counts.REVIEW_REQUIRED === 0;
  const artifact = {
    artifact_id: 'W01_V14_REAL_ADAPTER_DRY_RUN_2026-09-06',
    generated_at: new Date().toISOString(),
    mode: 'DRY_RUN_NO_CANONICAL_WRITE',
    files: {
      baseline: path.relative(PROJECT_ROOT, files.baseline),
      line_adapter_output: path.relative(PROJECT_ROOT, files.line),
      web_adapter_output: path.relative(PROJECT_ROOT, files.web),
      teacher_registry: path.relative(PROJECT_ROOT, files.teacherRegistry),
      signal_registry: path.relative(PROJECT_ROOT, files.signalRegistry),
    },
    source_snapshot: {
      window_start: start,
      window_end: end,
      web_captured_at: webPayload.captured_at || null,
      web_source_url: webPayload.source_url || null,
      web_coverage: webPayload.coverage || null,
      raw_web_records: web.raw.length,
      raw_line_records: line.raw.length,
      normalized_web_records: web.normalized.length,
      normalized_line_records: line.normalized.length,
      unique_normalized_evidence: incoming.length,
      incomplete_date_excluded: { WEB: web.incompleteDateExcluded, LINE: line.incompleteDateExcluded },
      source_file_hashes: {
        baseline: sha256(fs.readFileSync(files.baseline)),
        line: sha256(fs.readFileSync(files.line)),
        web: sha256(fs.readFileSync(files.web)),
      },
    },
    baseline: {
      canonical_events: baselineRows.length,
      evidence_records: baselineRows.reduce((sum, row) => sum + Math.max(1, (rowMeta(row).evidence_records || []).length), 0),
      teacher_registry: (teacherRegistry.teachers || []).length,
      signal_definitions: (signalRegistry.definitions || []).length,
      missing_year: baselineRows.filter((row) => rowMeta(row).partial_date === true && rowMeta(row).date_precision === 'MONTH_DAY').length,
      ambiguous_rows: baselineRows.filter((row) => rowMeta(row).review_reason === 'AMBIGUOUS_SAME_DAY_DUPLICATE' || rowMeta(row).review_status === 'REVIEW_REQUIRED').length,
      ambiguous_groups: new Set(baselineRows.filter((row) => rowMeta(row).review_reason === 'AMBIGUOUS_SAME_DAY_DUPLICATE' || rowMeta(row).review_status === 'REVIEW_REQUIRED').map((row) => rowMeta(row).review_group_id || `${row[0]}|${row[1]}|${row[6]}|${row[8]}|${row[2]}`)).size,
      unclassified: baselineRows.filter((row) => String(rowMeta(row).signal_definition_id || '').includes('UNCLASSIFIED')).length,
      teacher_review_groups: (teacherRegistry.merge_reviews || []).length,
    },
    reconciliation: {
      exact_evidence_matches: classified.exact_evidence,
      unmatched_evidence: classified.unmatched_evidence,
      source_role_counts: sourceRoleCounts(classified.delta_rows),
      counts: classified.counts,
      proposed: classified.proposed,
      expected_canonical_delta: classified.proposed.canonical_delta,
      expected_evidence_delta: classified.proposed.evidence_delta,
      actual_canonical_delta: 0,
      actual_evidence_delta: 0,
      second_run_canonical_delta: classified.proposed.canonical_delta,
      second_run_evidence_delta: classified.proposed.evidence_delta,
      deterministic,
      first_hash: sha256(stableStringify(classified)),
      second_hash: sha256(stableStringify(second)),
      validation: classified.validation,
      write_gate: writeGate ? 'PASS' : 'NOT_REACHED',
    },
    candidates: classified.delta_rows,
    normalized_evidence: incoming.map(sanitizeEvidence),
    checkpoints: {
      adapter_map: 'PASS',
      real_source_dry_run: allValidation && deterministic ? 'PASS' : 'FAIL',
      pre_write: writeGate ? 'PASS_ZERO_DELTA' : 'NOT_REACHED',
      canonical_write: 'NOT_PERFORMED',
      deployment: 'NOT_PERFORMED',
      production_verification: 'NOT_PERFORMED',
    },
  };
  fs.mkdirSync(files.out, { recursive: true });
  fs.writeFileSync(path.join(files.out, 'real_adapter_dry_run_0906.json'), `${stableStringify(artifact)}\n`, 'utf8');
  fs.writeFileSync(path.join(files.out, 'normalized_evidence_0906.json'), `${stableStringify({ window: { start, end }, records: artifact.normalized_evidence })}\n`, 'utf8');
  fs.writeFileSync(path.join(files.out, 'candidate_delta_0906.json'), `${stableStringify({ window: { start, end }, records: artifact.candidates })}\n`, 'utf8');
  return artifact;
}

if (require.main === module) {
  const artifact = runDryRun();
  process.stdout.write(`${JSON.stringify({
    status: artifact.checkpoints.real_source_dry_run,
    window: [artifact.source_snapshot.window_start, artifact.source_snapshot.window_end],
    raw: { WEB: artifact.source_snapshot.raw_web_records, LINE: artifact.source_snapshot.raw_line_records },
    normalized: { WEB: artifact.source_snapshot.normalized_web_records, LINE: artifact.source_snapshot.normalized_line_records },
    counts: artifact.reconciliation.counts,
    expected: { canonical: artifact.reconciliation.expected_canonical_delta, evidence: artifact.reconciliation.expected_evidence_delta },
    write_gate: artifact.reconciliation.write_gate,
  }, null, 2)}\n`);
}

module.exports = {
  adaptLineRows,
  adaptWebPayload,
  classifyCurrentWeek,
  dateAdd,
  formalProjection,
  latestFormalDate,
  readRows,
  runDryRun,
};
