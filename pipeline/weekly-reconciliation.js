'use strict';

const crypto = require('node:crypto');

const STATES = Object.freeze({
  PROVISIONAL: 'PROVISIONAL',
  MATCHED: 'MATCHED',
  CANONICAL: 'CANONICAL',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  SOURCE_CONFLICT: 'SOURCE_CONFLICT',
});

const UNKNOWN_TEACHER_ID = 'W01-T-UNKNOWN';

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function sourceName(value) {
  const source = String(value || 'OTHER').trim().toUpperCase();
  if (source === 'MEMBER' || source === 'MEMBER_WEB') return 'WEB';
  if (source === 'REPORT' || source === 'IMAGE') return 'IMAGE';
  return source || 'OTHER';
}

function canonicalAction(value) {
  const action = String(value || '').trim().toUpperCase();
  const map = {
    '買進': 'BUY', BUY: 'BUY',
    '加碼': 'ADD', ADD: 'ADD',
    '續抱': 'HOLD', HOLD: 'HOLD',
    '賣出': 'SELL', SELL: 'SELL',
    '出場': 'SELL', EXIT: 'SELL',
    '市場訊號': 'MARKET', MARKET: 'MARKET',
    '放空': 'SHORT', SHORT: 'SHORT',
    '回補': 'COVER', COVER: 'COVER',
    '未分類': 'UNCLASSIFIED', UNCLASSIFIED: 'UNCLASSIFIED',
  };
  return map[action] || action || 'UNCLASSIFIED';
}

function numericPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeEvidence(raw) {
  const source = sourceName(raw.source || raw.source_kind);
  const teacherId = clean(raw.teacher_id) || UNKNOWN_TEACHER_ID;
  const eventDate = clean(raw.event_date || raw.signal_date || raw.resolved_date);
  const rawDate = clean(raw.raw_date);
  const action = canonicalAction(raw.canonical_action || raw.action || raw.raw_action);
  const evidenceCore = {
    source,
    source_event_id: clean(raw.source_event_id || raw.event_id || raw.component_id || raw.line_message_hash),
    raw_text: clean(raw.raw_text || raw.raw_evidence || raw.reason),
    teacher_id: teacherId,
    ticker: clean(raw.ticker || raw.stock_code),
    action,
    event_date: eventDate,
    raw_date: rawDate,
    observed_at: clean(raw.observed_at),
  };
  const evidenceId = clean(raw.evidence_id) || `ev-${sha256(stableStringify(evidenceCore)).slice(0, 24)}`;
  return {
    evidence_id: evidenceId,
    source,
    source_event_id: evidenceCore.source_event_id,
    correlation_key: clean(raw.correlation_key || raw.canonical_event_ref || raw.match_key),
    correction_of: clean(raw.correction_of),
    sequence_key: clean(raw.sequence_key || raw.operation_id),
    teacher_id: teacherId,
    teacher_display_name: clean(raw.teacher_display_name || raw.teacher),
    ticker: evidenceCore.ticker,
    action,
    raw_action: clean(raw.raw_action || raw.action),
    exit_scope: clean(raw.exit_scope),
    event_date: eventDate,
    raw_date: rawDate,
    date_precision: clean(raw.date_precision) || (eventDate ? 'DATE' : (rawDate ? 'MONTH_DAY' : 'UNKNOWN')),
    source_snapshot_date: clean(raw.source_snapshot_date),
    observed_at: evidenceCore.observed_at,
    effective_at: clean(raw.effective_at),
    published_at: clean(raw.published_at || raw.source_published_at),
    price: numericPrice(raw.price ?? raw.entry_price ?? raw.exit_price),
    price_semantics: clean(raw.price_semantics || raw.entry_price_semantics || raw.exit_price_semantics),
    price_quality: clean(raw.price_quality) || 'SOURCE_EXPLICIT',
    display_reason: clean(raw.display_reason || raw.reason),
    raw_text: evidenceCore.raw_text,
    allocation: clean(raw.allocation),
    signal_definition_id: clean(raw.signal_definition_id),
    signal_definition_version: clean(raw.signal_definition_version),
    metadata: canonicalize(raw.metadata || {}),
  };
}

function isUnknownTeacher(id) {
  return !id || id === UNKNOWN_TEACHER_ID;
}

function teacherCompatible(a, b) {
  return a === b || isUnknownTeacher(a) || isUnknownTeacher(b);
}

function dateCompatible(a, b) {
  if (a.event_date && b.event_date) return a.event_date === b.event_date;
  if (a.raw_date && b.raw_date) return a.raw_date === b.raw_date;
  return true;
}

function structuralConflict(event, evidence) {
  const checks = [
    ['ticker', event.ticker, evidence.ticker],
    ['action', event.action, evidence.action],
  ];
  if (event.event_date && evidence.event_date) checks.push(['event_date', event.event_date, evidence.event_date]);
  for (const [field, left, right] of checks) {
    if (left && right && left !== right) return field;
  }
  if (!teacherCompatible(event.teacher_id, evidence.teacher_id)) return 'teacher_id';
  return null;
}

function reasonTokens(value) {
  return new Set(String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2));
}

function jaccard(left, right) {
  const a = reasonTokens(left);
  const b = reasonTokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function timeNear(a, b, hours = 6) {
  if (!a || !b) return false;
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= hours * 3600000;
}

function matchEvidence(event, evidence) {
  if ((event.evidence || []).some((item) => item.evidence_id === evidence.evidence_id)) {
    return { kind: 'DUPLICATE', score: Infinity, reasons: ['same evidence_id'] };
  }

  if (evidence.correction_of && (event.evidence || []).some((item) => item.evidence_id === evidence.correction_of)) {
    const conflictField = structuralConflict(event, evidence);
    if (conflictField) return { kind: 'SOURCE_CONFLICT', score: Infinity, reasons: [`correction conflicts on ${conflictField}`] };
    return { kind: 'MATCH_CONFIRMED', score: 110, reasons: ['explicit correction_of Evidence link'] };
  }

  const sameCorrelation = event.correlation_keys?.includes(evidence.correlation_key) && evidence.correlation_key;
  if (sameCorrelation) {
    const conflictField = structuralConflict(event, evidence);
    if (conflictField) return { kind: 'SOURCE_CONFLICT', score: Infinity, reasons: [`conflicting ${conflictField}`] };
    return { kind: 'MATCH_CONFIRMED', score: 100, reasons: ['same explicit correlation key'] };
  }

  if (evidence.correlation_key && event.correlation_keys?.length) {
    return { kind: 'NO_MATCH', score: 0, reasons: ['different explicit operation keys'] };
  }

  if (event.ticker && evidence.ticker && event.ticker !== evidence.ticker) return { kind: 'NO_MATCH', score: 0, reasons: ['ticker differs'] };
  if (event.action && evidence.action && event.action !== evidence.action) return { kind: 'NO_MATCH', score: 0, reasons: ['action differs'] };
  if (!dateCompatible(event, evidence)) return { kind: 'NO_MATCH', score: 0, reasons: ['date differs'] };
  if (!teacherCompatible(event.teacher_id, evidence.teacher_id)) return { kind: 'NO_MATCH', score: 0, reasons: ['teacher differs'] };

  const corroborators = [];
  if (event.source_event_ids?.includes(evidence.source_event_id) && evidence.source_event_id) corroborators.push('same source event link');
  if (event.price !== null && evidence.price !== null && Number(event.price) === Number(evidence.price)) corroborators.push('exact price');
  if (jaccard(event.display_reason, evidence.display_reason || evidence.raw_text) >= 0.45) corroborators.push('distinctive reason overlap');
  if (timeNear(event.observed_at, evidence.observed_at)) corroborators.push('time proximity');
  if (event.exit_scope && evidence.exit_scope && event.exit_scope === evidence.exit_scope) corroborators.push('same explicit scope');
  if (event.sequence_keys?.includes(evidence.sequence_key) && evidence.sequence_key) corroborators.push('same sequence key');

  if (corroborators.length >= 2) return { kind: 'MATCH_CONFIRMED', score: corroborators.length, reasons: corroborators };
  return { kind: 'MATCH_PROBABLE_REVIEW', score: corroborators.length, reasons: corroborators.length ? corroborators : ['structural fields only'] };
}

function eventIdFor(evidence) {
  const anchor = evidence.correlation_key || evidence.evidence_id;
  return `w14-${sha256(stableStringify({ anchor, ticker: evidence.ticker, action: evidence.action, event_date: evidence.event_date, raw_date: evidence.raw_date })).slice(0, 20)}`;
}

function sourcePriority(source) {
  return ({ LINE: 3, WEB: 2, IMAGE: 1, OTHER: 0 })[source] ?? 0;
}

function pricePriority(evidence) {
  const quality = ({ VERIFIED_EXECUTION: 5, SOURCE_EXPLICIT: 4, CLOSE_FALLBACK: 3, APPROXIMATE: 2, UNKNOWN: 0 })[evidence.price_quality] ?? 1;
  return quality * 10 + sourcePriority(evidence.source) + (evidence.correction_of ? 100 : 0);
}

function chooseTeacher(evidence) {
  const known = evidence.filter((item) => !isUnknownTeacher(item.teacher_id));
  if (!known.length) return { teacher_id: UNKNOWN_TEACHER_ID, teacher_display_name: '未標示', evidence_ids: evidence.map((item) => item.evidence_id) };
  known.sort((a, b) => {
    const web = Number(b.source === 'WEB') - Number(a.source === 'WEB');
    if (web) return web;
    return a.teacher_id.localeCompare(b.teacher_id);
  });
  const chosen = known[0];
  return {
    teacher_id: chosen.teacher_id,
    teacher_display_name: chosen.teacher_display_name,
    evidence_ids: known.filter((item) => item.teacher_id === chosen.teacher_id).map((item) => item.evidence_id).sort(),
  };
}

function chooseReason(evidence) {
  const candidates = evidence.filter((item) => item.display_reason || item.raw_text);
  candidates.sort((a, b) => {
    const correction = Number(Boolean(b.correction_of)) - Number(Boolean(a.correction_of));
    if (correction) return correction;
    const left = String(a.display_reason || a.raw_text || '').length;
    const right = String(b.display_reason || b.raw_text || '').length;
    if (left !== right) return right - left;
    const source = sourcePriority(b.source) - sourcePriority(a.source);
    if (source) return source;
    return a.evidence_id.localeCompare(b.evidence_id);
  });
  const chosen = candidates[0] || null;
  return chosen ? { value: chosen.display_reason || chosen.raw_text, evidence_ids: [chosen.evidence_id] } : { value: null, evidence_ids: [] };
}

function choosePrice(evidence) {
  const candidates = evidence.filter((item) => item.price !== null);
  candidates.sort((a, b) => {
    const priority = pricePriority(b) - pricePriority(a);
    if (priority) return priority;
    return a.evidence_id.localeCompare(b.evidence_id);
  });
  const chosen = candidates[0] || null;
  return chosen ? { value: chosen.price, semantics: chosen.price_semantics, evidence_ids: [chosen.evidence_id] } : { value: null, semantics: null, evidence_ids: [] };
}

function earliest(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function rebuildEvent(event) {
  const evidence = [...(event.evidence || [])].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  const superseded = new Set(evidence.map((item) => item.correction_of).filter(Boolean));
  const activeEvidence = evidence.filter((item) => !superseded.has(item.evidence_id));
  const teacher = chooseTeacher(activeEvidence);
  const reason = chooseReason(activeEvidence);
  const price = choosePrice(activeEvidence);
  const priceValues = [...new Set(activeEvidence.filter((item) => item.price !== null).map((item) => String(item.price)))];
  const knownTeachers = [...new Set(activeEvidence.map((item) => item.teacher_id).filter((id) => !isUnknownTeacher(id)))];
  const conflicts = [];
  if (priceValues.length > 1) conflicts.push({ field: 'price', values: priceValues });
  if (knownTeachers.length > 1) conflicts.push({ field: 'teacher_id', values: knownTeachers });

  const first = activeEvidence[0] || evidence[0];
  const sources = [...new Set(evidence.map((item) => item.source))].sort();
  const eventDate = evidence.map((item) => item.event_date).filter(Boolean).sort()[0] || null;
  const rawDate = evidence.map((item) => item.raw_date).filter(Boolean).sort()[0] || null;
  const exitScope = evidence.map((item) => item.exit_scope).filter(Boolean).sort()[0] || null;
  const matched = sources.length > 1;
  let state = matched ? STATES.MATCHED : STATES.CANONICAL;
  let reviewStatus = isUnknownTeacher(teacher.teacher_id) ? 'TEACHER_UNRESOLVED' : 'CONFIRMED';
  if (conflicts.length) {
    state = STATES.REVIEW_REQUIRED;
    reviewStatus = 'FIELD_CONFLICT';
  }
  if (event.force_state === STATES.SOURCE_CONFLICT) {
    state = STATES.SOURCE_CONFLICT;
    reviewStatus = 'SOURCE_CONFLICT';
  } else if (event.force_state === STATES.REVIEW_REQUIRED) {
    state = STATES.REVIEW_REQUIRED;
    reviewStatus = event.force_review_status || 'MATCH_PROBABLE_REVIEW';
  }

  return {
    ...event,
    state,
    review_status: reviewStatus,
    teacher_id: teacher.teacher_id,
    teacher_display_name: teacher.teacher_display_name,
    ticker: first?.ticker || null,
    action: first?.action || 'UNCLASSIFIED',
    exit_scope: exitScope,
    event_date: eventDate,
    raw_date: rawDate,
    source_snapshot_date: earliest(evidence.map((item) => item.source_snapshot_date)),
    observed_at: earliest(evidence.map((item) => item.observed_at)),
    effective_at: earliest(evidence.map((item) => item.effective_at)),
    published_at: earliest(evidence.map((item) => item.published_at)),
    price: price.value,
    price_semantics: price.semantics,
    display_reason: reason.value,
    sources,
    correlation_keys: [...new Set(evidence.map((item) => item.correlation_key).filter(Boolean))].sort(),
    source_event_ids: [...new Set(evidence.map((item) => item.source_event_id).filter(Boolean))].sort(),
    sequence_keys: [...new Set(evidence.map((item) => item.sequence_key).filter(Boolean))].sort(),
    signal_definition_id: evidence.map((item) => item.signal_definition_id).find(Boolean) || null,
    signal_definition_version: evidence.map((item) => item.signal_definition_version).find(Boolean) || null,
    field_conflicts: conflicts,
    field_lineage: {
      teacher_id: teacher.evidence_ids,
      observed_at: evidence.filter((item) => item.observed_at === earliest(evidence.map((candidate) => candidate.observed_at))).map((item) => item.evidence_id),
      display_reason: reason.evidence_ids,
      price: price.evidence_ids,
      action: activeEvidence.map((item) => item.evidence_id),
      event_date: activeEvidence.filter((item) => item.event_date).map((item) => item.evidence_id),
    },
    evidence,
  };
}

function createEvent(evidence, options = {}) {
  return rebuildEvent({
    event_id: eventIdFor(evidence),
    force_state: options.forceState || null,
    force_review_status: options.reviewStatus || null,
    related_event_ids: options.relatedEventIds || [],
    evidence: [evidence],
  });
}

function cloneEvents(events) {
  return (events || []).map((event) => rebuildEvent(JSON.parse(JSON.stringify(event))));
}

function reconcileEvidence({ existingEvents = [], evidence = [], teacherRegistry = null, signalRegistry = null } = {}) {
  const events = cloneEvents(existingEvents);
  const normalized = evidence.map(normalizeEvidence).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  const seenInput = new Set();
  const audit = [];

  for (const item of normalized) {
    if (seenInput.has(item.evidence_id)) {
      audit.push({ evidence_id: item.evidence_id, result: 'DUPLICATE_INPUT' });
      continue;
    }
    seenInput.add(item.evidence_id);

    const duplicateEvent = events.find((event) => (event.evidence || []).some((candidate) => candidate.evidence_id === item.evidence_id));
    if (duplicateEvent) {
      audit.push({ evidence_id: item.evidence_id, result: 'DUPLICATE_EVIDENCE', event_id: duplicateEvent.event_id });
      continue;
    }

    const ranked = events.map((event) => ({ event, match: matchEvidence(event, item) }));
    const confirmed = ranked.filter((candidate) => candidate.match.kind === 'MATCH_CONFIRMED').sort((a, b) => b.match.score - a.match.score || a.event.event_id.localeCompare(b.event.event_id))[0];
    if (confirmed) {
      confirmed.event.evidence.push(item);
      Object.assign(confirmed.event, rebuildEvent(confirmed.event));
      audit.push({ evidence_id: item.evidence_id, result: 'MATCH_CONFIRMED', event_id: confirmed.event.event_id, reasons: confirmed.match.reasons });
      continue;
    }

    const conflict = ranked.find((candidate) => candidate.match.kind === 'SOURCE_CONFLICT');
    if (conflict) {
      conflict.event.force_state = STATES.SOURCE_CONFLICT;
      Object.assign(conflict.event, rebuildEvent(conflict.event));
      const created = createEvent(item, { forceState: STATES.SOURCE_CONFLICT, reviewStatus: 'SOURCE_CONFLICT', relatedEventIds: [conflict.event.event_id] });
      conflict.event.related_event_ids = [...new Set([...(conflict.event.related_event_ids || []), created.event_id])].sort();
      events.push(created);
      audit.push({ evidence_id: item.evidence_id, result: 'SOURCE_CONFLICT', event_id: created.event_id, related_event_id: conflict.event.event_id, reasons: conflict.match.reasons });
      continue;
    }

    const probable = ranked.filter((candidate) => candidate.match.kind === 'MATCH_PROBABLE_REVIEW').sort((a, b) => b.match.score - a.match.score || a.event.event_id.localeCompare(b.event.event_id))[0];
    if (probable) {
      const created = createEvent(item, { forceState: STATES.REVIEW_REQUIRED, reviewStatus: 'MATCH_PROBABLE_REVIEW', relatedEventIds: [probable.event.event_id] });
      events.push(created);
      audit.push({ evidence_id: item.evidence_id, result: 'MATCH_PROBABLE_REVIEW', event_id: created.event_id, related_event_id: probable.event.event_id, reasons: probable.match.reasons });
      continue;
    }

    const created = createEvent(item);
    events.push(created);
    audit.push({ evidence_id: item.evidence_id, result: 'NEW_CANONICAL', event_id: created.event_id });
  }

  const teacherIds = teacherRegistry ? new Set((teacherRegistry.teachers || []).map((item) => item.teacher_id)) : null;
  const signalDefinitions = signalRegistry ? new Set((signalRegistry.definitions || signalRegistry.signal_definitions || []).map((item) => item.signal_definition_id || item.definition_id || item.signal_id)) : null;
  const validation = {
    unknown_teacher_safe: events.every((event) => !isUnknownTeacher(event.teacher_id) || event.review_status === 'TEACHER_UNRESOLVED' || event.state === STATES.REVIEW_REQUIRED || event.state === STATES.SOURCE_CONFLICT),
    teacher_registry_references_valid: !teacherIds || events.every((event) => isUnknownTeacher(event.teacher_id) || teacherIds.has(event.teacher_id)),
    signal_registry_references_valid: !signalDefinitions || events.every((event) => !event.signal_definition_id || signalDefinitions.has(event.signal_definition_id)),
    evidence_ids_unique_per_event: events.every((event) => new Set(event.evidence.map((item) => item.evidence_id)).size === event.evidence.length),
    field_lineage_present: events.every((event) => event.field_lineage && Array.isArray(event.field_lineage.action)),
  };

  events.sort((a, b) => a.event_id.localeCompare(b.event_id));
  return { events, audit, validation };
}

function semanticProjection(result) {
  return result.events.map((event) => canonicalize({
    event_id: event.event_id,
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
    related_event_ids: event.related_event_ids || [],
  }));
}

function resultHash(result) {
  return sha256(stableStringify(semanticProjection(result)));
}

module.exports = {
  STATES,
  UNKNOWN_TEACHER_ID,
  canonicalAction,
  normalizeEvidence,
  matchEvidence,
  reconcileEvidence,
  semanticProjection,
  resultHash,
  stableStringify,
};
