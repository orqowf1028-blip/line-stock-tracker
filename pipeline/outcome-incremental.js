"use strict";

const crypto = require("crypto");
const { DEFAULT_CONTRACT, outcomeIdentity, semanticOutcome } = require("./outcome-engine");

const VALID_TRANSITIONS = Object.freeze({
  NOT_MATURED: new Set(["NOT_MATURED", "PRICE_DATA_MISSING", "READY"]),
  PRICE_DATA_MISSING: new Set(["PRICE_DATA_MISSING", "READY"]),
  DATE_UNRESOLVED: new Set(["DATE_UNRESOLVED"]),
  NOT_ELIGIBLE: new Set(["NOT_ELIGIBLE"]),
  REVIEW_REQUIRED: new Set(["REVIEW_REQUIRED"]),
  READY: new Set(["READY"]),
});

const CALCULATION_FIELDS = Object.freeze([
  "ticker", "action", "direction", "event_date", "effective_at", "source_time",
  "entry_price", "exit_price", "entry_price_semantics", "exit_price_semantics",
]);

const DISPLAY_ONLY_FIELDS = Object.freeze([
  "teacher_name", "source_label", "raw_action", "evidence_grade",
]);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

function eventFingerprint(event) {
  return digest(Object.fromEntries(CALCULATION_FIELDS.map(field => [field, event[field] ?? null])));
}

function eventDisplayFingerprint(event) {
  return digest(Object.fromEntries(DISPLAY_ONLY_FIELDS.map(field => [field, event[field] ?? null])));
}

function horizonDays(row) {
  const match = String(row.horizon || "").match(/^(\d+)D$/);
  return match ? Number(match[1]) : null;
}

function sessionsAfter(date, calendarDates) {
  return calendarDates.filter(item => item > date);
}

function isMature(row, calendarDates) {
  const days = horizonDays(row);
  return Boolean(days && row.event_date && sessionsAfter(row.event_date, calendarDates).length >= days);
}

function classifyInvalidation(previous, next) {
  const calculationChanged = CALCULATION_FIELDS.filter(field => (previous?.[field] ?? null) !== (next?.[field] ?? null));
  const displayChanged = DISPLAY_ONLY_FIELDS.filter(field => (previous?.[field] ?? null) !== (next?.[field] ?? null));
  if (calculationChanged.length) {
    return { status: "REVIEW_REQUIRED", changed_fields: calculationChanged, reason: "formal Outcome input changed" };
  }
  if (displayChanged.length || (previous?.teacher_id ?? null) !== (next?.teacher_id ?? null)) {
    return { status: "NO_RECOMPUTE", changed_fields: [...displayChanged, ...((previous?.teacher_id ?? null) !== (next?.teacher_id ?? null) ? ["teacher_id"] : [])], reason: "display/attribution field only" };
  }
  return { status: "NO_RECOMPUTE", changed_fields: [], reason: "no Outcome dependency changed" };
}

function selectWorkset({ events, currentOutcomes, calendarDates, checkpoint = {}, approvedCorrections = [] }) {
  const eventById = new Map(events.map(event => [event.event_id, event]));
  const currentEventIds = new Set(currentOutcomes.map(row => row.event_id));
  const newEvents = events.filter(event => !currentEventIds.has(event.event_id));
  const newlyMatured = currentOutcomes.filter(row => row.outcome_status === "NOT_MATURED" && isMature(row, calendarDates));
  const retryableMissingPrices = currentOutcomes.filter(row => row.outcome_status === "PRICE_DATA_MISSING");
  const correctionIds = new Set(approvedCorrections);
  const approvedCorrectionRows = currentOutcomes.filter(row => correctionIds.has(outcomeIdentity(row)));
  const reviewRequired = [];

  const priorFingerprints = checkpoint.event_fingerprints || {};
  for (const event of events) {
    const prior = priorFingerprints[event.event_id];
    if (prior && prior.calculation !== eventFingerprint(event)) {
      reviewRequired.push({ event_id: event.event_id, reason: "UPSTREAM_CALCULATION_INPUT_CHANGED" });
    }
  }

  const isolatedEventIds = new Set(events.filter(event => event.review_status === "REVIEW_REQUIRED").map(event => event.event_id));
  const selectedMap = new Map();
  function add(row, reason) {
    if (isolatedEventIds.has(row.event_id)) return;
    const identity = outcomeIdentity(row);
    const prior = selectedMap.get(identity);
    const reasons = new Set([...(prior?.reasons || []), reason]);
    selectedMap.set(identity, { row, reasons: [...reasons].sort() });
  }
  newlyMatured.forEach(row => add(row, "NEWLY_MATURED"));
  retryableMissingPrices.forEach(row => add(row, "RETRYABLE_PRICE_DATA_MISSING"));
  approvedCorrectionRows.forEach(row => add(row, "APPROVED_CORRECTION"));

  return {
    eventById,
    newEvents,
    newlyMatured,
    retryableMissingPrices,
    approvedCorrectionRows,
    reviewRequired,
    selected: [...selectedMap.values()].sort((a, b) => outcomeIdentity(a.row).localeCompare(outcomeIdentity(b.row))),
    isolated_event_ids: [...isolatedEventIds].sort(),
  };
}

function rowsForNewEvents(events, compute, context) {
  return events.flatMap(event => DEFAULT_CONTRACT.horizons.map(days => compute(event, days, context)));
}

function transitionAllowed(from, to, explicitMigration = false) {
  if (from === "READY" && to !== "READY") return Boolean(explicitMigration);
  return Boolean(VALID_TRANSITIONS[from]?.has(to));
}

function applyCandidates(currentOutcomes, candidates, options = {}) {
  const map = new Map(currentOutcomes.map(row => [outcomeIdentity(row), row]));
  const changes = [];
  const drift = [];
  const rejected = [];
  for (const candidate of candidates) {
    const identity = outcomeIdentity(candidate);
    const previous = map.get(identity);
    if (!previous) {
      map.set(identity, candidate);
      changes.push({ identity, type: "NEW_OUTCOME", from: null, to: candidate.outcome_status });
      continue;
    }
    if (!transitionAllowed(previous.outcome_status, candidate.outcome_status, options.explicitMigration)) {
      rejected.push({ identity, from: previous.outcome_status, to: candidate.outcome_status, reason: "FORBIDDEN_TRANSITION" });
      continue;
    }
    const previousSemantic = stable(semanticOutcome(previous));
    const candidateSemantic = stable(semanticOutcome(candidate));
    if (previous.outcome_status === "READY" && previousSemantic !== candidateSemantic && !options.explicitMigration) {
      drift.push({ identity, classification: "DATA_DRIFT", previous: digest(previousSemantic), candidate: digest(candidateSemantic) });
      continue;
    }
    if (previousSemantic === candidateSemantic) continue;
    map.set(identity, candidate);
    changes.push({ identity, type: "STATE_OR_CONTENT_UPDATE", from: previous.outcome_status, to: candidate.outcome_status });
  }
  return {
    outcomes: [...map.values()].sort((a, b) => outcomeIdentity(a).localeCompare(outcomeIdentity(b))),
    changes,
    ready_drift: drift,
    rejected,
  };
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const value = typeof field === "function" ? field(row) : row[field];
    const key = value === undefined || value === null || value === "" ? "UNKNOWN" : String(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function summarize(outcomes) {
  return {
    total_rows: outcomes.length,
    by_status: countBy(outcomes, "outcome_status"),
    by_horizon: Object.fromEntries(DEFAULT_CONTRACT.horizons.map(days => {
      const label = `${days}D`;
      const rows = outcomes.filter(row => row.horizon === label);
      return [label, { total: rows.length, by_status: countBy(rows, "outcome_status") }];
    })),
  };
}

function validateStore(outcomes, eventIds, calendarDates) {
  const anomalies = [];
  const identities = countBy(outcomes, outcomeIdentity);
  const validHorizons = new Set(DEFAULT_CONTRACT.horizons.map(days => `${days}D`));
  const validStatuses = new Set(Object.keys(VALID_TRANSITIONS));
  const numericFields = ["reference_price", "endpoint_close", "market_return_pct", "directional_return_pct", "market_mfe_pct", "market_mae_pct", "directional_mfe_pct", "directional_mae_pct"];
  for (const [identity, count] of Object.entries(identities)) if (count !== 1) anomalies.push({ type: "DUPLICATE_OUTCOME", identity, count });
  for (const row of outcomes) {
    const identity = outcomeIdentity(row);
    if (!eventIds.has(row.event_id)) anomalies.push({ type: "ORPHAN_OUTCOME", identity });
    if (!validHorizons.has(row.horizon)) anomalies.push({ type: "INVALID_HORIZON", identity });
    if (!validStatuses.has(row.outcome_status)) anomalies.push({ type: "INVALID_STATUS", identity, status: row.outcome_status });
    if (row.calculation_version !== DEFAULT_CONTRACT.calculation_version) anomalies.push({ type: "CALCULATION_VERSION_MISMATCH", identity });
    if (row.outcome_status === "READY") {
      if (!(row.reference_price > 0) || !(row.endpoint_close > 0) || !row.reference_trading_date || !row.target_trading_date) anomalies.push({ type: "READY_INCOMPLETE", identity });
      if (row.reference_trading_date && row.target_trading_date && row.reference_trading_date > row.target_trading_date) anomalies.push({ type: "REFERENCE_AFTER_TARGET", identity });
      if (row.target_trading_date && calendarDates.at(-1) && row.target_trading_date > calendarDates.at(-1)) anomalies.push({ type: "FUTURE_READY", identity });
      if (Number.isFinite(row.market_return_pct) && (row.market_mfe_pct + 1e-6 < row.market_return_pct || row.market_mae_pct - 1e-6 > row.market_return_pct)) anomalies.push({ type: "MFE_MAE_INCONSISTENT", identity });
    }
    if (row.outcome_status === "NOT_MATURED" && row.target_trading_date && calendarDates.includes(row.target_trading_date)) anomalies.push({ type: "MATURE_TARGET_STILL_NOT_MATURED", identity });
    for (const field of numericFields) {
      if (row[field] !== null && row[field] !== undefined && !Number.isFinite(row[field])) anomalies.push({ type: "NON_FINITE", identity, field });
    }
  }
  return anomalies;
}

function buildCheckpoint({ events, outcomes, canonicalCommit, runAt, maturityScanDate, storeHash, retryItems, health }) {
  return {
    checkpoint_id: `W01_V16_OUTCOME_INCREMENTAL_${String(runAt).slice(0, 10)}`,
    last_successful_run_at: runAt,
    last_canonical_commit: canonicalCommit,
    last_canonical_event_marker: [...events.map(event => event.event_id)].sort().at(-1) || null,
    canonical_event_count: events.length,
    event_fingerprint_hash: digest(events.map(event => [event.event_id, eventFingerprint(event)]).sort()),
    event_fingerprints: Object.fromEntries(events.map(event => [event.event_id, { calculation: eventFingerprint(event), display: eventDisplayFingerprint(event) }])),
    calculation_version: DEFAULT_CONTRACT.calculation_version,
    price_data_coverage_checkpoint: maturityScanDate,
    last_maturity_scan_date: maturityScanDate,
    last_successful_production_hash: storeHash,
    outcome_total: outcomes.length,
    ready_total: outcomes.filter(row => row.outcome_status === "READY").length,
    failed_retry_subset: retryItems,
    external_dependency_status: health,
  };
}

function classifyHealth({ anomalies, readyDrift, reviewRows, failedRetries }) {
  if (anomalies.length || readyDrift.length) return "BLOCKED_CORRECTNESS";
  if (reviewRows.length) return "REVIEW_REQUIRED";
  if (failedRetries.length) return "DEGRADED_EXTERNAL";
  return "HEALTHY";
}

module.exports = {
  CALCULATION_FIELDS, DISPLAY_ONLY_FIELDS, VALID_TRANSITIONS, applyCandidates, buildCheckpoint,
  classifyHealth, classifyInvalidation, countBy, digest, eventDisplayFingerprint, eventFingerprint,
  horizonDays, isMature, rowsForNewEvents, selectWorkset, stable, summarize, transitionAllowed, validateStore,
};
