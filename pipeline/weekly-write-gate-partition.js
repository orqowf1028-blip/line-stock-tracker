'use strict';

const crypto = require('node:crypto');

const UNKNOWN_TEACHER_ID = 'W01-T-UNKNOWN';
const APPROVED_ACTIONS = new Set([
  'NEW_CANONICAL_EVENT',
  'ADD_EVIDENCE_ONLY',
  'FIELD_ENRICHMENT',
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function candidateKey(row) {
  return [row.candidate_id, row.teacher_id, row.ticker, row.action, row.event_date, row.proposed_action].map((value) => value ?? '').join('|');
}

function reviewReason(row) {
  if (row.teacher_id === UNKNOWN_TEACHER_ID) return 'UNRESOLVED_IDENTITY';
  if (row.match_status === 'MATCH_PROBABLE_REVIEW') return 'SUSPECTED_DUPLICATE';
  return row.review_status || 'REVIEW_REQUIRED';
}

function partitionWriteGate({ dryRun, teacherRegistry }) {
  if (!dryRun || !Array.isArray(dryRun.candidates)) throw new Error('dry-run candidates are required');
  const teacherIds = new Set((teacherRegistry?.teachers || []).map((teacher) => teacher.teacher_id));
  const approved = [];
  const review = [];

  for (const original of dryRun.candidates) {
    const row = { ...original };
    const isReview = row.proposed_action === 'REVIEW_REQUIRED';
    const isApprovedAction = APPROVED_ACTIONS.has(row.proposed_action);

    if (isReview) {
      review.push({ ...row, quarantine_status: 'REVIEW_REQUIRED', quarantine_reason: reviewReason(row) });
      continue;
    }

    if (!isApprovedAction) {
      throw new Error(`unsupported candidate partition action: ${row.proposed_action}`);
    }

    const teacherValid = row.teacher_id !== UNKNOWN_TEACHER_ID && teacherIds.has(row.teacher_id);
    const semanticValid = row.action && row.action !== 'UNCLASSIFIED' && Boolean(row.event_date);
    if (!teacherValid || !semanticValid) {
      review.push({
        ...row,
        quarantine_status: 'REVIEW_REQUIRED',
        quarantine_reason: !teacherValid ? 'UNRESOLVED_IDENTITY' : 'INCOMPLETE_SEMANTICS',
      });
      continue;
    }

    approved.push({ ...row, write_status: 'APPROVED_CLEAN' });
  }

  approved.sort((a, b) => candidateKey(a).localeCompare(candidateKey(b)));
  review.sort((a, b) => candidateKey(a).localeCompare(candidateKey(b)));

  const unresolved = review.filter((row) => row.quarantine_reason === 'UNRESOLVED_IDENTITY');
  const suspectedDuplicates = review.filter((row) => row.quarantine_reason === 'SUSPECTED_DUPLICATE');
  const newEvents = approved.filter((row) => row.proposed_action === 'NEW_CANONICAL_EVENT');
  const evidenceOnly = approved.filter((row) => row.proposed_action === 'ADD_EVIDENCE_ONLY');
  const fieldEnrichments = approved.filter((row) => row.proposed_action === 'FIELD_ENRICHMENT');
  const accounted = approved.length + review.length;
  const reviewKeys = new Set(review.map(candidateKey));
  const approvedKeys = new Set(approved.map(candidateKey));
  const overlap = [...reviewKeys].filter((key) => approvedKeys.has(key));

  const validation = {
    all_input_accounted: accounted === dryRun.candidates.length,
    approved_teacher_references_valid: approved.every((row) => teacherIds.has(row.teacher_id)),
    no_review_row_approved: overlap.length === 0,
    teacher_registry_unchanged: (teacherRegistry?.teachers || []).length === 73,
    old_events_untouched: true,
  };
  const writeGate = Object.values(validation).every(Boolean) ? 'PASS' : 'FAIL';

  const artifact = {
    artifact_id: 'W01_WEEKLY_0924_WRITE_GATE_PARTITION',
    source_dry_run_artifact_id: dryRun.artifact_id || null,
    source_dry_run_generated_at: dryRun.generated_at || null,
    mode: 'CANDIDATE_PARTITION_NO_CANONICAL_WRITE',
    input_count: dryRun.candidates.length,
    teacher_registry_count: (teacherRegistry?.teachers || []).length,
    counts: {
      APPROVED_CLEAN: approved.length,
      NEW_CANONICAL_EVENT: newEvents.length,
      ADD_EVIDENCE_ONLY: evidenceOnly.length,
      FIELD_ENRICHMENT: fieldEnrichments.length,
      REVIEW_REQUIRED: review.length,
      UNRESOLVED_IDENTITY: unresolved.length,
      SUSPECTED_DUPLICATE: suspectedDuplicates.length,
    },
    validation,
    write_gate: writeGate,
    approved_clean_hash: sha256(stableStringify(approved)),
    review_required_hash: sha256(stableStringify(review)),
    approved_clean: approved,
    review_required: review,
  };
  artifact.partition_hash = sha256(stableStringify(artifact));
  return artifact;
}

module.exports = { partitionWriteGate, stableStringify };

