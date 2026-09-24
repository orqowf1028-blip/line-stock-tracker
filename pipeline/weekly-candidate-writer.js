'use strict';

const crypto = require('node:crypto');
const {
  eventIdFor,
  normalizeEvidence,
  stableStringify,
} = require('./weekly-reconciliation');

const ACTION_LABELS = Object.freeze({
  BUY: '買進',
  ADD: '加碼',
  HOLD: '續抱',
  SELL: '賣出',
  MARKET: '市場訊號',
  SHORT: '市場訊號',
  COVER: '市場訊號',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function evidenceCount(rows) {
  return rows.reduce((sum, row) => {
    const records = Array.isArray(row?.[18]?.evidence_records) ? row[18].evidence_records : [];
    return sum + Math.max(1, records.length);
  }, 0);
}

function teacherMaps(registry) {
  const byId = new Map();
  for (const teacher of registry?.teachers || []) byId.set(teacher.teacher_id, teacher);
  return byId;
}

function semanticMaps(payload) {
  const byId = new Map();
  for (const event of payload?.events || []) {
    if (byId.has(event.id)) throw new Error(`duplicate semantic event id: ${event.id}`);
    byId.set(event.id, event);
  }
  return byId;
}

function normalizedIncoming(dryRun) {
  return (dryRun?.normalized_evidence || []).map((row) => ({
    ...normalizeEvidence({
      ...row,
      teacher_id: row.teacher_candidate,
      canonical_action: row.action_candidate,
    }),
    source_ref: row.source_ref || null,
    allocation_context: row.allocation_context || null,
    raw_evidence_sha256: row.raw_evidence_sha256 || null,
  }));
}

function candidateIdentity(row) {
  return [row.teacher_id, row.ticker, row.action, row.event_date, row.observed_at].map((value) => value ?? '').join('|');
}

function approvedGroups({ approvedArtifact, dryRun }) {
  const approved = approvedArtifact?.records || [];
  const newRows = approved.filter((row) => row.proposed_action === 'NEW_CANONICAL_EVENT');
  const evidenceRows = approved.filter((row) => row.proposed_action === 'ADD_EVIDENCE_ONLY');
  if (newRows.length !== 129 || evidenceRows.length !== 2 || approved.length !== 131) {
    throw new Error(`approved partition mismatch: total=${approved.length} new=${newRows.length} evidence=${evidenceRows.length}`);
  }

  const incoming = normalizedIncoming(dryRun);
  const primaryByEvent = new Map();
  for (const evidence of incoming) {
    const eventId = eventIdFor(evidence);
    if (primaryByEvent.has(eventId)) throw new Error(`event id collision: ${eventId}`);
    primaryByEvent.set(eventId, evidence);
  }

  const approvedIds = new Set(newRows.map((row) => row.candidate_id));
  const groups = new Map();
  for (const row of newRows) {
    const evidence = primaryByEvent.get(row.candidate_id);
    if (!evidence) throw new Error(`approved event has no primary Evidence: ${row.candidate_id}`);
    if (candidateIdentity(row) !== candidateIdentity({
      teacher_id: evidence.teacher_id,
      ticker: evidence.ticker,
      action: evidence.action,
      event_date: evidence.event_date,
      observed_at: evidence.observed_at,
    })) throw new Error(`primary Evidence identity mismatch: ${row.candidate_id}`);
    groups.set(row.candidate_id, { decision: row, evidence: [evidence] });
  }

  const used = new Set([...groups.values()].flatMap((group) => group.evidence.map((item) => item.evidence_id)));
  for (const row of evidenceRows) {
    const group = groups.get(row.candidate_id);
    if (!group) throw new Error(`Evidence addition targets non-approved new event: ${row.candidate_id}`);
    const matches = incoming.filter((evidence) => !used.has(evidence.evidence_id)
      && evidence.teacher_id === row.teacher_id
      && evidence.ticker === row.ticker
      && evidence.action === row.action
      && evidence.event_date === row.event_date
      && evidence.observed_at === row.observed_at);
    if (matches.length !== 1) throw new Error(`Evidence addition is not uniquely linked: ${row.candidate_id} matches=${matches.length}`);
    group.evidence.push(matches[0]);
    used.add(matches[0].evidence_id);
  }

  const reviewEvidence = incoming.filter((item) => !used.has(item.evidence_id));
  if (used.size !== 131 || reviewEvidence.length !== 19 || groups.size !== 129) {
    throw new Error(`Evidence accounting mismatch: approved=${used.size} review=${reviewEvidence.length} events=${groups.size}`);
  }
  for (const eventId of groups.keys()) {
    if (!approvedIds.has(eventId)) throw new Error(`unapproved event group: ${eventId}`);
  }
  return { groups, approvedEvidenceIds: used, reviewEvidence };
}

function executionStatus(action, scope, detail) {
  if (action === 'BUY') return '買進｜數量未載';
  if (action === 'ADD') return '加碼｜數量未載';
  if (action === 'HOLD') return '續抱｜數量未載';
  if (action === 'SHORT') return '放空';
  if (action === 'COVER') return '回補';
  if (action === 'MARKET') return '觀察市場';
  if (action === 'SELL' && scope === 'FULL') return '全數出清';
  if (action === 'SELL' && scope === 'PARTIAL') return /一半|二分之一|1\s*[／/]\s*2/.test(String(detail || '')) ? '賣出一半' : '部分出場';
  if (action === 'SELL') return '賣出｜全數或部分未明';
  return '觀察市場';
}

function directionFor(action) {
  if (['BUY', 'ADD', 'HOLD'].includes(action)) return 'BULLISH';
  if (action === 'SELL') return 'BEARISH';
  return 'NEUTRAL';
}

function publicSafeReason(semantic, evidence) {
  const detail = String(semantic.detail || '').trim();
  const label = ACTION_LABELS[evidence.action] || '市場訊號';
  const parts = [`研究訊號：${label}`];
  if (detail) parts.push(detail);
  if (evidence.price !== null) parts.push(`${evidence.action === 'SELL' ? '出場價' : '建議價'}約 ${evidence.price}`);
  return [...new Set(parts)].join('；').replace(/；+/g, '；').replace(/；$/u, '') + '。';
}

function evidenceRecord(evidence, semantic, canonicalEventId) {
  const lineage = semantic.bridge_lineage || {};
  return {
    source: evidence.source,
    source_reference_id: lineage.source_reference || evidence.source_ref || evidence.evidence_id,
    event_id: semantic.id || evidence.source_event_id,
    canonical_event_id: canonicalEventId,
    evidence_id: evidence.evidence_id,
    source_event_id: evidence.source_event_id,
    source_ref: evidence.source_ref,
    observed_at: evidence.observed_at,
    raw_text: semantic.raw_evidence || semantic.detail || '',
    raw_evidence: semantic.raw_evidence || null,
    raw_evidence_sha256: sha256(semantic.raw_evidence || semantic.detail || ''),
    capture_batch_id: lineage.capture_batch_id || null,
    capture_batch_sha256: lineage.capture_batch_sha256 || null,
    capture_timestamp: lineage.capture_timestamp || null,
    source_component_ids: semantic.source_component_ids || [],
    safe_summary: publicSafeReason(semantic, evidence),
  };
}

function buildRow({ eventId, group, semanticById, teacherById }) {
  const evidence = group.evidence[0];
  const semantic = semanticById.get(evidence.source_event_id);
  if (!semantic) throw new Error(`semantic payload missing source event: ${evidence.source_event_id}`);
  const teacher = teacherById.get(evidence.teacher_id);
  if (!teacher) throw new Error(`Teacher Registry reference missing: ${evidence.teacher_id}`);
  const action = evidence.action;
  const scope = evidence.exit_scope || null;
  const actionLabel = action === 'SELL' && scope === 'FULL' ? '出場' : (ACTION_LABELS[action] || '市場訊號');
  const displayReason = publicSafeReason(semantic, evidence);
  const records = group.evidence.map((item) => {
    const sourceSemantic = semanticById.get(item.source_event_id);
    if (!sourceSemantic) throw new Error(`semantic payload missing source event: ${item.source_event_id}`);
    return evidenceRecord(item, sourceSemantic, eventId);
  }).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  const date = evidence.event_date.slice(5).replace('-', '/');
  const entry = ['BUY', 'ADD', 'HOLD'].includes(action) && evidence.price !== null ? String(evidence.price) : '不明';
  const exit = action === 'SELL' && evidence.price !== null ? String(evidence.price) : '';
  const status = executionStatus(action, scope, semantic.detail);
  const performance = ['SHORT', 'COVER', 'MARKET'].includes(action) || (action === 'SELL' && scope === 'FULL') ? '—' : '待報價';
  const logic = [
    '訊號源：已登入投顧追蹤會員頁（擷取日 2026-09-24）',
    evidence.price !== null ? '價位來源：網站顯示價，非已驗證成交價' : '價位來源：來源未明示',
    action === 'SELL' && scope === 'UNKNOWN' ? 'SELL 範圍未明：不推定全數出清或 position=0' : null,
    ['SHORT', 'COVER', 'MARKET'].includes(action) ? '市場訊號不套用多頭持倉績效公式' : null,
  ].filter(Boolean).join('；');
  const meta = {
    signal_date: evidence.event_date,
    date_precision: evidence.date_precision || 'DATE',
    year: Number(evidence.event_date.slice(0, 4)),
    raw_date: evidence.raw_date,
    raw_year: semantic.raw_year ?? Number(evidence.event_date.slice(0, 4)),
    resolved_date: evidence.event_date,
    resolved_year: Number(evidence.event_date.slice(0, 4)),
    resolution_method: semantic.resolution_method || 'SOURCE_CURRENT_WEEK_CONTEXT',
    resolution_confidence: semantic.resolution_confidence || 'HIGH',
    resolution_evidence: semantic.resolution_evidence || null,
    canonical_action: action,
    exit_scope: scope,
    raw_action: evidence.raw_action,
    evidence_grade: semantic.evidence_grade || 'B',
    observed_at: evidence.observed_at,
    source_published_at: semantic.source_published_at || evidence.event_date,
    effective_at: evidence.effective_at || semantic.effective_at || evidence.event_date,
    source_price_status: semantic.source_price_status || (evidence.price !== null ? 'SOURCE_DISPLAYED_NOT_EXECUTION_VERIFIED' : 'UNKNOWN'),
    event_id: eventId,
    partial_date: false,
    source_labels: ['WEB'],
    source_label: 'WEB',
    teacher_id: evidence.teacher_id,
    teacher_display_name: teacher.display_name || teacher.canonical_name,
    teacher_attribution_confidence: 'CANONICAL_EXISTING',
    signal_definition_id: evidence.signal_definition_id,
    signal_definition_version: '1.0',
    direction: directionFor(action),
    registry_version: 'W01_REGISTRY_V1',
    display_reason: displayReason,
    reason_summary: displayReason,
    display_logic: logic,
    evidence_records: records,
    evidence_count: records.length,
    weekly_partition: 'APPROVED_CLEAN',
    weekly_partition_artifact: 'W01_WEEKLY_0924_WRITE_GATE_PARTITION',
  };
  return [date, `${evidence.ticker} ${semantic.name || evidence.ticker}`, entry, '', performance, logic, meta.teacher_display_name, displayReason, actionLabel, exit, status, '', '', '', '', '', '', '', meta];
}

function rowEventId(row) {
  return row?.[18]?.event_id || null;
}

function buildCandidate({ baselineRows, approvedArtifact, reviewArtifact, dryRun, semanticPayload, teacherRegistry }) {
  const rows = clone(baselineRows);
  const baselineSerialized = new Map(rows.map((row) => [rowEventId(row), stableStringify(row)]).filter(([id]) => id));
  const before = { canonical: rows.length, evidence: evidenceCount(rows), teacher_registry: (teacherRegistry?.teachers || []).length };
  if (before.teacher_registry !== 73) throw new Error(`Teacher Registry count changed: ${before.teacher_registry}`);
  const { groups, approvedEvidenceIds, reviewEvidence } = approvedGroups({ approvedArtifact, dryRun });
  const semanticById = semanticMaps(semanticPayload);
  const teacherById = teacherMaps(teacherRegistry);
  const existingById = new Map(rows.map((row, index) => [rowEventId(row), { row, index }]).filter(([id]) => id));
  let canonicalDelta = 0;
  let evidenceDelta = 0;

  for (const [eventId, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = existingById.get(eventId);
    if (!existing) {
      const row = buildRow({ eventId, group, semanticById, teacherById });
      rows.push(row);
      existingById.set(eventId, { row, index: rows.length - 1 });
      canonicalDelta += 1;
      evidenceDelta += group.evidence.length;
      continue;
    }
    const records = existing.row?.[18]?.evidence_records || [];
    const evidenceIds = new Set(records.map((item) => item.evidence_id).filter(Boolean));
    for (const evidence of group.evidence) {
      if (!evidenceIds.has(evidence.evidence_id)) throw new Error(`existing event missing approved Evidence on rerun: ${eventId}/${evidence.evidence_id}`);
    }
  }

  rows.sort((a, b) => {
    const ad = a?.[18]?.resolved_date || a?.[18]?.signal_date || `0000-${String(a?.[0] || '').replace('/', '-')}`;
    const bd = b?.[18]?.resolved_date || b?.[18]?.signal_date || `0000-${String(b?.[0] || '').replace('/', '-')}`;
    return bd.localeCompare(ad) || String(rowEventId(a) || '').localeCompare(String(rowEventId(b) || ''));
  });

  const after = { canonical: rows.length, evidence: evidenceCount(rows), teacher_registry: (teacherRegistry?.teachers || []).length };
  const eventIds = rows.map(rowEventId).filter(Boolean);
  const evidenceIds = rows.flatMap((row) => (row?.[18]?.evidence_records || []).map((item) => item.evidence_id).filter(Boolean));
  const reviewRecords = reviewArtifact?.records || [];
  const reviewEvidenceIds = new Set(reviewEvidence.map((item) => item.evidence_id));
  const writtenEvidenceIds = new Set(evidenceIds);
  const reviewLeakage = [...reviewEvidenceIds].filter((id) => writtenEvidenceIds.has(id));
  const oldMutations = [...baselineSerialized.entries()].filter(([id, serialized]) => {
    const current = rows.find((row) => rowEventId(row) === id);
    return !current || stableStringify(current) !== serialized;
  });
  const validation = {
    approved_clean_accounted: groups.size === 129 && approvedEvidenceIds.size === 131,
    review_rows_accounted: reviewRecords.length === 19 && reviewEvidence.length === 19,
    no_review_leakage: reviewLeakage.length === 0,
    no_old_canonical_deletion_or_mutation: oldMutations.length === 0,
    event_ids_unique: new Set(eventIds).size === eventIds.length,
    evidence_ids_unique: new Set(evidenceIds).size === evidenceIds.length,
    teacher_registry_unchanged: before.teacher_registry === 73 && after.teacher_registry === 73,
    exact_delta: canonicalDelta === 129 && evidenceDelta === 131 && after.canonical === before.canonical + 129 && after.evidence === before.evidence + 131,
  };
  return {
    rows,
    summary: {
      mode: 'ISOLATED_WEEKLY_CANDIDATE',
      before,
      after,
      delta: { canonical: canonicalDelta, evidence: evidenceDelta },
      approved: { events: groups.size, evidence: approvedEvidenceIds.size },
      review: { rows: reviewRecords.length, evidence: reviewEvidence.length, leakage: reviewLeakage.length },
      validation,
      candidate_hash: sha256(stableStringify(rows)),
    },
  };
}

module.exports = {
  approvedGroups,
  buildCandidate,
  evidenceCount,
  sha256,
};
