"use strict";

const crypto = require("crypto");

const HEALTH = Object.freeze({
  HEALTHY: "HEALTHY",
  HEALTHY_NO_CHANGE: "HEALTHY_NO_CHANGE",
  HEALTHY_WITH_KNOWN_LIMITATIONS: "HEALTHY_WITH_KNOWN_LIMITATIONS",
  DEGRADED_EXTERNAL: "DEGRADED_EXTERNAL",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  BLOCKED_CORRECTNESS: "BLOCKED_CORRECTNESS",
});

const TERMINAL_UNSUPPORTED = "KNOWN_UNSUPPORTED_INSTRUMENT";
const REVIEW_SECURITY_GAP = "SECURITY_SPECIFIC_DATA_GAP_REVIEW_REQUIRED";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function exactAccounting(expected, actual) {
  const keys = [...new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])].sort();
  const mismatches = keys.filter(key => (expected?.[key] ?? 0) !== (actual?.[key] ?? 0))
    .map(key => ({ key, expected: expected?.[key] ?? 0, actual: actual?.[key] ?? 0 }));
  return { status: mismatches.length ? HEALTH.BLOCKED_CORRECTNESS : HEALTH.HEALTHY, mismatches };
}

function classifyUnresolved(rows) {
  const unsupportedTickers = new Set(["00631L", "00632R", "00635U", "00663L", "00735", "00752", "00830", "00981A"]);
  return rows.map(row => ({
    identity: `${row.event_id}|${row.horizon}`,
    ticker: row.ticker,
    horizon: row.horizon,
    classification: unsupportedTickers.has(row.ticker) ? TERMINAL_UNSUPPORTED : REVIEW_SECURITY_GAP,
    retryable: false,
    research_eligible: false,
    retry_state: unsupportedTickers.has(row.ticker) ? "TERMINAL_EXCLUDED" : "REVIEW_HOLD",
    reason: unsupportedTickers.has(row.ticker)
      ? "Current production market-data adapter returned HTTP 400 for this ETF/special instrument class; excluded fail-closed without provider migration."
      : "Provider returned the security, but the required maturity path was incomplete; preserve unresolved and require review.",
  }));
}

function summarizeUnresolved(classified) {
  const count = key => classified.filter(row => row.classification === key).length;
  return {
    total: classified.length,
    known_unsupported_instrument: count(TERMINAL_UNSUPPORTED),
    review_required: count(REVIEW_SECURITY_GAP),
    retryable_transient: classified.filter(row => row.retryable).length,
    permanent_unavailable: 0,
    unknown: 0,
    research_eligible: classified.filter(row => row.research_eligible).length,
  };
}

function healthFromUnresolved(summary, correctnessPass = true) {
  if (!correctnessPass) return HEALTH.BLOCKED_CORRECTNESS;
  if (summary.retryable_transient > 0) return HEALTH.DEGRADED_EXTERNAL;
  if (summary.total > 0) return HEALTH.HEALTHY_WITH_KNOWN_LIMITATIONS;
  return HEALTH.HEALTHY;
}

function nextRetryState(current, result, attempt, maxAttempts = 2) {
  if (["TERMINAL_EXCLUDED", "REVIEW_HOLD", "RESOLVED"].includes(current)) return current;
  if (result === "SUCCESS") return "RESOLVED";
  if (result === "UNSUPPORTED") return "TERMINAL_EXCLUDED";
  if (result === "SECURITY_GAP") return "REVIEW_HOLD";
  if (result === "TRANSIENT_FAILURE") return attempt >= maxAttempts ? "RETRY_EXHAUSTED" : "RETRY_SCHEDULED";
  return "REVIEW_HOLD";
}

function makeCheckpoint(runId, stageNames) {
  return {
    checkpoint_version: "W01_V111_CHECKPOINT_V1",
    run_id: runId,
    stages: Object.fromEntries(stageNames.map(name => [name, { status: "NOT_STARTED", attempts: 0, semantic_hash: null }])),
  };
}

function completeStage(checkpoint, stage, semanticPayload) {
  if (!checkpoint.stages[stage]) throw new Error(`Unknown stage ${stage}`);
  const semanticHash = sha256(semanticPayload);
  if (checkpoint.stages[stage].status === "DONE") {
    if (checkpoint.stages[stage].semantic_hash !== semanticHash) throw new Error(`Checkpoint conflict at ${stage}`);
    return JSON.parse(JSON.stringify(checkpoint));
  }
  const next = JSON.parse(JSON.stringify(checkpoint));
  next.stages[stage] = {
    status: "DONE",
    attempts: checkpoint.stages[stage].attempts + 1,
    semantic_hash: semanticHash,
  };
  return next;
}

function resumePlan(checkpoint) {
  return Object.entries(checkpoint.stages).filter(([, state]) => state.status !== "DONE").map(([name]) => name);
}

function assertNoFutureReady(outcomes, asOf) {
  const future = outcomes.filter(row => row.outcome_status === "READY" && row.actual_trading_date && row.actual_trading_date > asOf)
    .map(row => `${row.event_id}|${row.horizon}`);
  return { status: future.length ? HEALTH.BLOCKED_CORRECTNESS : HEALTH.HEALTHY, future_ready_rows: future };
}

function buildW00Handoff({ runId, health, counts, deltas, readiness, warnings }) {
  return {
    contract_version: "W01_TO_W00_WEEKLY_HANDOFF_V0.2.0-RC",
    run_id: runId,
    candidate_version: "W01 v1.11 Candidate — Production Integration & Weekly Operations Release Candidate",
    health_state: health,
    counts,
    deltas,
    research_readiness: readiness,
    warnings,
    decision_use_allowed: false,
    contains_w08_private_data: false,
  };
}

module.exports = {
  HEALTH,
  TERMINAL_UNSUPPORTED,
  REVIEW_SECURITY_GAP,
  stableStringify,
  sha256,
  exactAccounting,
  classifyUnresolved,
  summarizeUnresolved,
  healthFromUnresolved,
  nextRetryState,
  makeCheckpoint,
  completeStage,
  resumePlan,
  assertNoFutureReady,
  buildW00Handoff,
};
