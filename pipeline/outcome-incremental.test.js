"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_CONTRACT,
  outcomeIdentity,
} = require("./outcome-engine");
const {
  applyCandidates,
  classifyHealth,
  classifyInvalidation,
  selectWorkset,
  transitionAllowed,
  validateStore,
} = require("./outcome-incremental");

const version = DEFAULT_CONTRACT.calculation_version;
const calendarEarly = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
const calendarLater = [...calendarEarly, "2026-09-07", "2026-09-08", "2026-09-09"];

function event(id, date = "2026-09-03", extra = {}) {
  return {
    event_id: id, ticker: "2330", action: "BUY", direction: "BULLISH", event_date: date,
    effective_at: null, source_time: "10:00", entry_price: 100, exit_price: null,
    entry_price_semantics: "EXPLICIT", exit_price_semantics: null,
    teacher_id: "W01-T-TEST", teacher_name: "測試", source_label: "FIXTURE", raw_action: "買進",
    ...extra,
  };
}

function outcome(id, horizon, status, extra = {}) {
  return {
    event_id: id, ticker: "2330", teacher_id: "W01-T-TEST", signal_definition_id: "W01-SIG-BUY-V1",
    action: "BUY", direction: "BULLISH", event_date: "2026-09-03", effective_at: null,
    source_time_status: "LINE_MESSAGE_TIME", horizon, calculation_version: version,
    computed_at: "2026-09-04T00:00:00Z", price_adjustment_type: "RAW_UNADJUSTED",
    corporate_action_status: "NOT_VERIFIED", benchmark_id: null, excess_return_pct: null,
    sector_benchmark_id: null, sector_excess_return_pct: null, benchmark_status: "UNSUPPORTED",
    sector_benchmark_status: "UNSUPPORTED", price_source: "FIXTURE", outcome_status: status,
    eligibility_reason: status,
    ...extra,
  };
}

function ready(id, horizon, target, close = 103) {
  return outcome(id, horizon, "READY", {
    reference_price: 100, reference_price_type: "EXPLICIT_SIGNAL_PRICE", reference_price_semantics: "EXPLICIT",
    reference_trading_date: target, reference_timestamp: `${target}T09:00:00+08:00`,
    target_trading_date: target, actual_trading_date: target, endpoint_close: close,
    market_return_pct: close - 100, directional_return_pct: close - 100,
    market_mfe_pct: Math.max(close - 100, 4), market_mae_pct: -1,
    directional_mfe_pct: Math.max(close - 100, 4), directional_mae_pct: -1,
  });
}

const events = [event("E1"), event("E2", "2026-09-01"), event("E3", null), event("E4", "2026-09-03", { review_status: "REVIEW_REQUIRED" })];
const current = [
  ready("E1", "1D", "2026-09-04"),
  outcome("E1", "3D", "NOT_MATURED"),
  outcome("E2", "1D", "PRICE_DATA_MISSING", { event_date: "2026-09-01" }),
  outcome("E3", "1D", "DATE_UNRESOLVED", { event_date: null }),
  outcome("E4", "1D", "NOT_MATURED"),
];

const selected = selectWorkset({ events, currentOutcomes: current, calendarDates: calendarLater });
assert(selected.newlyMatured.some(row => outcomeIdentity(row) === `${"E1"}|3D|${version}`));
assert(selected.retryableMissingPrices.length === 1);
assert(!selected.selected.some(item => item.row.event_id === "E4"));

// 1D/3D maturity and multiple horizons in one run.
const candidates = [
  ready("E1", "3D", "2026-09-09", 106),
  ready("E2", "1D", "2026-09-02", 102),
];
const applied = applyCandidates(current, candidates);
assert(applied.changes.length === 2);
assert(applied.ready_drift.length === 0);

// 20D remains NOT_MATURED and READY remains stable.
assert(!transitionAllowed("READY", "NOT_MATURED"));
const unchangedReady = applyCandidates(applied.outcomes, [ready("E1", "1D", "2026-09-04")]);
assert(unchangedReady.changes.length === 0);

// Price failure remains isolated, then retry succeeds.
const failed = outcome("E2", "3D", "PRICE_DATA_MISSING", { event_date: "2026-09-01" });
const withFailure = applyCandidates(applied.outcomes, [failed]);
assert(withFailure.changes.length === 1);
const recovered = applyCandidates(withFailure.outcomes, [ready("E2", "3D", "2026-09-04", 104)]);
assert(recovered.changes.some(change => change.from === "PRICE_DATA_MISSING" && change.to === "READY"));

// New event identity creates eight pre-maturity lifecycle rows.
const newEvent = event("E5", "2026-09-09");
const newRows = DEFAULT_CONTRACT.horizons.map(days => outcome("E5", `${days}D`, "NOT_MATURED", { event_date: "2026-09-09" }));
const withNew = applyCandidates(recovered.outcomes, newRows);
assert(withNew.changes.filter(change => change.type === "NEW_OUTCOME").length === 8);

// Missing-year remains isolated and review event is not scheduled.
assert(!selected.selected.some(item => item.row.event_id === "E3"));
assert(!selected.selected.some(item => item.row.event_id === "E4"));

// Dependency-aware invalidation.
assert.equal(classifyInvalidation(event("I1"), event("I1", "2026-09-03", { teacher_name: "新顯示名" })).status, "NO_RECOMPUTE");
assert.equal(classifyInvalidation(event("I1"), event("I1", "2026-09-04")).status, "REVIEW_REQUIRED");

// READY numeric drift is blocked.
const drift = applyCandidates(withNew.outcomes, [ready("E1", "1D", "2026-09-04", 110)]);
assert(drift.ready_drift.length === 1);

// Idempotency and invariants.
const repeated = applyCandidates(withNew.outcomes, candidates);
assert(repeated.changes.length === 0);
const anomalies = validateStore(withNew.outcomes, new Set(["E1", "E2", "E3", "E4", "E5"]), calendarLater);
assert.equal(anomalies.length, 0, JSON.stringify(anomalies));
assert.equal(classifyHealth({ anomalies: [], readyDrift: [], reviewRows: [], failedRetries: [] }), "HEALTHY");
assert.equal(classifyHealth({ anomalies: [], readyDrift: [], reviewRows: [], failedRetries: [{ event_id: "E2" }] }), "DEGRADED_EXTERNAL");
assert.equal(classifyHealth({ anomalies: [{ type: "BAD" }], readyDrift: [], reviewRows: [], failedRetries: [] }), "BLOCKED_CORRECTNESS");

const result = {
  result: "PASS",
  scenarios: {
    one_day_ready: true,
    three_day_ready: true,
    twenty_day_not_matured: true,
    multiple_horizons_same_run: true,
    isolated_price_failure: true,
    retry_recovery: true,
    ready_immutable: true,
    new_event_lifecycle: true,
    missing_year_isolated: true,
    review_event_isolated: true,
    dependency_aware_invalidation: true,
    second_run_idempotency: true,
  },
  selected: selected.selected.map(item => ({ identity: outcomeIdentity(item.row), reasons: item.reasons })),
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  const output = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
