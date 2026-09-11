"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  DEFAULT_CONTRACT, adaptEvent, computeOutcome, extractInitialData, hash, outcomeIdentity, semanticOutcome,
} = require("./outcome-engine");
const {
  applyCandidates, buildCheckpoint, classifyHealth, digest, selectWorkset, summarize, validateStore,
} = require("./outcome-incremental");

const REPO = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.resolve(REPO, "..", "w01_v16_outcome_incremental");
const V15_CACHE = path.resolve(REPO, "..", "w01_v15_outcome_engine", "price_cache_0907.json");
const APP_JS = path.join(REPO, "app.js");
const STORE_FILE = path.join(REPO, "outcome-store.json");
const MANIFEST_FILE = path.join(REPO, "outcome-manifest.json");
const CHECKPOINT_FILE = path.join(REPO, "outcome-checkpoint.json");
const RETRY_FILE = path.join(REPO, "outcome-retry.json");
const PRODUCTION = "https://line-stock-tracker-orqowf.pages.dev";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const MODE = process.argv.includes("--apply") ? "APPLY" : "DRY_RUN";
const NO_FETCH = process.argv.includes("--no-fetch");
const OUTPUT = path.resolve(argValue("--output-dir", DEFAULT_OUTPUT));
const RUN_DATE = argValue("--run-date", new Date().toISOString().slice(0, 10));
const CACHE_FILE = path.join(OUTPUT, "price_cache_incremental_0907.json");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
}

function writeJson(file, value, compact = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, compact ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function currentGitCommit() {
  try {
    return execFileSync("git", ["-c", `safe.directory=${REPO}`, "-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (_) {
    return null;
  }
}

function lastCandleDate(cacheEntry) {
  return cacheEntry?.candles?.map(row => row.date).filter(Boolean).sort().at(-1) || null;
}

async function fetchStudy(code, attempts = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      const url = `${PRODUCTION}/api/stock?code=${encodeURIComponent(code)}&range=5y&schema=8&v=v16-${Date.now()}-${attempt}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.http_status = response.status;
        error.retry_after = response.headers.get("retry-after");
        throw error;
      }
      const payload = await response.json();
      if (!Array.isArray(payload.candles) || !payload.candles.length) throw new Error("no candles");
      return {
        entry: {
          code, name: payload.name || null, market: payload.market || null,
          data_source: payload.dataSource || null, partial_history: Boolean(payload.partialHistory),
          fetched_at: new Date().toISOString(),
          candles: payload.candles.map(row => ({
            date: row.date, open: Number(row.open), high: Number(row.high), low: Number(row.low),
            close: Number(row.close), volume: Number(row.volume),
          })),
        },
        audit: { code, status: "FETCHED", attempt, http_status: 200, latency_ms: Date.now() - started, retry_after: null },
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(700 * attempt);
    }
  }
  return {
    entry: null,
    audit: {
      code, status: "FETCH_FAILED", attempts, error: lastError?.message || "unknown",
      http_status: lastError?.http_status || null, retry_after: lastError?.retry_after || null,
    },
  };
}

async function fetchCodes(codes, cache, concurrency = 2) {
  let cursor = 0;
  const audit = [];
  async function worker() {
    while (cursor < codes.length) {
      const index = cursor;
      cursor += 1;
      const code = codes[index];
      const result = await fetchStudy(code);
      if (result.entry) cache[code] = result.entry;
      audit.push({ ...result.audit, last_candle: result.entry ? lastCandleDate(result.entry) : lastCandleDate(cache[code]) });
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(codes.length, 1)) }, () => worker()));
  return audit.sort((a, b) => a.code.localeCompare(b.code));
}

function semanticHash(outcomes) {
  const rows = outcomes.map(semanticOutcome).sort((a, b) => outcomeIdentity(a).localeCompare(outcomeIdentity(b)));
  return hash(JSON.stringify(rows));
}

function summarizeTransitions(changes) {
  const result = {};
  for (const change of changes) {
    const key = `${change.from || "NEW"}->${change.to}`;
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function addDaysIso(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildRetryItems({ outcomes, previousQueue, fetchAudit, runAt }) {
  const previous = new Map((previousQueue?.items || []).map(item => [`${item.event_id}|${item.horizon}`, item]));
  const attempted = new Map(fetchAudit.map(item => [item.code, item]));
  return outcomes.filter(row => row.outcome_status === "PRICE_DATA_MISSING").map(row => {
    const key = `${row.event_id}|${row.horizon}`;
    const before = previous.get(key);
    const fetch = attempted.get(row.ticker);
    const actuallyAttempted = Boolean(fetch);
    return {
      event_id: row.event_id,
      horizon: row.horizon,
      ticker: row.ticker,
      target_date: row.target_trading_date || null,
      failure_reason: row.eligibility_reason || "required price data unavailable",
      http_status: fetch?.http_status || null,
      first_failed_at: before?.first_failed_at || runAt,
      last_attempt_at: actuallyAttempted ? runAt : (before?.last_attempt_at || null),
      attempt_count: (before?.attempt_count || 0) + (actuallyAttempted ? 1 : 0),
      next_retry_eligible_date: addDaysIso(RUN_DATE, 7),
    };
  }).sort((a, b) => `${a.event_id}|${a.horizon}`.localeCompare(`${b.event_id}|${b.horizon}`));
}

async function main() {
  const startedAt = Date.now();
  fs.mkdirSync(OUTPUT, { recursive: true });
  const sourceRows = extractInitialData(fs.readFileSync(APP_JS, "utf8"));
  const events = sourceRows.map(adaptEvent);
  const evidenceCount = sourceRows.reduce((sum, row) => sum + Math.max(1, ((row[18] || {}).evidence_records || []).length), 0);
  const eventById = new Map(events.map(event => [event.event_id, event]));
  const store = readJson(STORE_FILE);
  const manifest = readJson(MANIFEST_FILE);
  if (!store?.outcomes || !manifest) throw new Error("formal v1.5 store/manifest unavailable");
  if (store.outcomes.length !== manifest.outcome_rows) throw new Error("Outcome store/manifest mismatch");
  if (sourceRows.length < manifest.canonical_events) throw new Error(`canonical records regressed: ${sourceRows.length} < ${manifest.canonical_events}`);

  const checkpoint = readJson(CHECKPOINT_FILE, {});
  const previousRetryQueue = readJson(RETRY_FILE, { items: [] });
  const cache = readJson(CACHE_FILE, readJson(V15_CACHE, {}));
  let fetchAudit = [];
  if (!NO_FETCH) {
    const control = await fetchCodes(["2330"], cache, 1);
    fetchAudit.push(...control);
  }
  if (!cache["2330"]?.candles?.length) throw new Error("2330 exchange calendar unavailable");
  const calendarDates = [...new Set(cache["2330"].candles.map(row => row.date).filter(Boolean))].sort();
  const initialSelection = selectWorkset({ events, currentOutcomes: store.outcomes, calendarDates, checkpoint });
  const requiredCodes = [...new Set([
    ...initialSelection.newEvents.map(event => event.ticker),
    ...initialSelection.selected.map(item => item.row.ticker),
  ].filter(Boolean))].sort();
  if (!NO_FETCH) {
    const fetched = await fetchCodes(requiredCodes.filter(code => code !== "2330"), cache, 2);
    fetchAudit.push(...fetched);
  }
  writeJson(CACHE_FILE, cache, true);

  const runAt = new Date().toISOString();
  const finalCalendarDates = [...new Set(cache["2330"].candles.map(row => row.date).filter(Boolean))].sort();
  const selection = selectWorkset({ events, currentOutcomes: store.outcomes, calendarDates: finalCalendarDates, checkpoint });
  const candidates = [];
  for (const item of selection.selected) {
    const event = eventById.get(item.row.event_id);
    if (!event) continue;
    candidates.push(computeOutcome(event, cache[event.ticker]?.candles || [], finalCalendarDates, Number(item.row.horizon.slice(0, -1)), {
      computed_at: runAt,
      price_source: cache[event.ticker]?.data_source || item.row.price_source || null,
    }));
  }
  for (const event of selection.newEvents) {
    for (const days of DEFAULT_CONTRACT.horizons) {
      candidates.push(computeOutcome(event, cache[event.ticker]?.candles || [], finalCalendarDates, days, {
        computed_at: runAt,
        price_source: cache[event.ticker]?.data_source || null,
      }));
    }
  }

  const applied = applyCandidates(store.outcomes, candidates);
  const anomalies = validateStore(applied.outcomes, new Set(events.map(event => event.event_id)), finalCalendarDates);
  const retryItems = buildRetryItems({ outcomes: applied.outcomes, previousQueue: previousRetryQueue, fetchAudit, runAt });
  const recoveredRetries = applied.changes.filter(change => change.from === "PRICE_DATA_MISSING" && change.to === "READY").length;
  const failedRetries = selection.retryableMissingPrices.filter(row => {
    const updated = applied.outcomes.find(item => outcomeIdentity(item) === outcomeIdentity(row));
    return updated?.outcome_status === "PRICE_DATA_MISSING";
  });
  const health = classifyHealth({ anomalies, readyDrift: applied.ready_drift, reviewRows: selection.reviewRequired, failedRetries });
  const beforeSummary = summarize(store.outcomes);
  const afterSummary = summarize(applied.outcomes);
  const readyBefore = beforeSummary.by_status.READY || 0;
  const readyAfter = afterSummary.by_status.READY || 0;
  const accounting = {
    mode: MODE,
    run_at: runAt,
    source_commit: currentGitCommit(),
    price_cutoff_before: store.price_cutoff_date,
    price_cutoff_after: finalCalendarDates.at(-1) || null,
    current_outcome_total: store.outcomes.length,
    current_ready_total: readyBefore,
    new_canonical_events_detected: selection.newEvents.length,
    new_outcome_rows: applied.changes.filter(change => change.type === "NEW_OUTCOME").length,
    newly_matured_candidates: selection.newlyMatured.length,
    retryable_missing_price_candidates: selection.retryableMissingPrices.length,
    recovered_retries: recoveredRetries,
    failed_retries: failedRetries.length,
    review_rows: selection.reviewRequired.length,
    expected_outcome_delta: applied.outcomes.length - store.outcomes.length,
    actual_outcome_delta: MODE === "APPLY" ? applied.outcomes.length - store.outcomes.length : null,
    expected_ready_delta: readyAfter - readyBefore,
    actual_ready_delta: MODE === "APPLY" ? readyAfter - readyBefore : null,
    ready_drift_detected: applied.ready_drift.length,
    correction_candidates: 0,
    transitions: summarizeTransitions(applied.changes),
    duplicate_outcomes: anomalies.filter(item => item.type === "DUPLICATE_OUTCOME").length,
    anomalies: anomalies.length,
    invariant_validation: anomalies.length ? "FAIL" : "PASS",
    calculation_version: DEFAULT_CONTRACT.calculation_version,
    final_outcome_total: applied.outcomes.length,
    final_ready_total: readyAfter,
    still_not_matured: afterSummary.by_status.NOT_MATURED || 0,
    price_data_missing: afterSummary.by_status.PRICE_DATA_MISSING || 0,
    date_unresolved: afterSummary.by_status.DATE_UNRESOLVED || 0,
    not_eligible: afterSummary.by_status.NOT_ELIGIBLE || 0,
    fetch_codes: requiredCodes.length,
    fetch_success: fetchAudit.filter(item => item.status === "FETCHED").length,
    fetch_failed: fetchAudit.filter(item => item.status === "FETCH_FAILED").length,
    run_health: health,
  };
  const gatePass = !applied.ready_drift.length && !applied.rejected.length && !anomalies.length && !selection.reviewRequired.length;
  const result = {
    artifact_id: `W01_V16_OUTCOME_INCREMENTAL_${MODE}_${RUN_DATE}`,
    status: gatePass ? `${MODE}_PASS` : "BLOCKED_CORRECTNESS",
    accounting,
    selection: {
      selected_rows: selection.selected.length,
      selected_by_reason: selection.selected.reduce((acc, item) => {
        for (const reason of item.reasons) acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {}),
      isolated_event_ids: selection.isolated_event_ids,
    },
    fetch_audit: fetchAudit,
    ready_drift: applied.ready_drift,
    rejected_transitions: applied.rejected,
    anomalies,
    retry_queue_count: retryItems.length,
    semantic_hash_before: store.semantic_hash,
    semantic_hash_after: semanticHash(applied.outcomes),
    runtime_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
  };
  writeJson(path.join(OUTPUT, MODE === "APPLY" ? "current_run_apply_0907.json" : "current_run_dry_run_0907.json"), result);
  writeJson(path.join(OUTPUT, "retry_queue_candidate_0907.json"), { run_at: runAt, health, items: retryItems });
  if (!gatePass) throw new Error(`incremental write gate failed: drift=${applied.ready_drift.length}, rejected=${applied.rejected.length}, anomalies=${anomalies.length}, review=${selection.reviewRequired.length}`);

  if (MODE === "APPLY") {
    if (!applied.changes.length) {
      result.noop_write_skipped = true;
      result.accounting.actual_outcome_delta = 0;
      result.accounting.actual_ready_delta = 0;
      writeJson(path.join(OUTPUT, "current_run_second_idempotency_0907.json"), result);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const updatedStore = {
      ...store,
      artifact_id: `W01_V112_WEEKLY_OUTCOME_STORE_${RUN_DATE}`,
      formal_version: manifest.formal_version || store.release_label || store.formal_version,
      release_label: manifest.formal_version || store.release_label || store.formal_version,
      last_incremental_source_commit: accounting.source_commit,
      computed_at: runAt,
      price_cutoff_date: accounting.price_cutoff_after,
      outcome_rows: applied.outcomes.length,
      canonical_events: sourceRows.length,
      evidence_rows: evidenceCount,
      semantic_hash: result.semantic_hash_after,
      summary: afterSummary,
      run_health: health,
      outcomes: applied.outcomes,
    };
    writeJson(STORE_FILE, updatedStore, true);
    const storeBytes = fs.readFileSync(STORE_FILE);
    const storeHash = cryptoHash(storeBytes);
    const updatedManifest = {
      ...manifest,
      artifact_id: `W01_V112_WEEKLY_OUTCOME_MANIFEST_${RUN_DATE}`,
      formal_version: manifest.formal_version || store.release_label || store.formal_version,
      formal_candidate_version: "W01 v1.6 — Outcome Incremental Maturity & Update Monitor",
      computed_at: runAt,
      last_outcome_update: runAt,
      price_cutoff_date: accounting.price_cutoff_after,
      outcome_rows: applied.outcomes.length,
      canonical_events: sourceRows.length,
      evidence_rows: evidenceCount,
      semantic_hash: result.semantic_hash_after,
      by_horizon: afterSummary.by_horizon,
      by_status: afterSummary.by_status,
      release_contract: manifest.formal_version || store.release_label || store.formal_version,
      run_health: health,
      retry_queue_rows: retryItems.length,
      incremental_accounting: accounting,
      store_sha256: storeHash,
      store_bytes: storeBytes.length,
    };
    writeJson(MANIFEST_FILE, updatedManifest);
    const checkpointRecord = buildCheckpoint({
      events, outcomes: applied.outcomes, canonicalCommit: accounting.source_commit,
      runAt, maturityScanDate: accounting.price_cutoff_after, storeHash, retryItems, health,
    });
    writeJson(CHECKPOINT_FILE, checkpointRecord);
    writeJson(RETRY_FILE, { artifact_id: `W01_V112_OUTCOME_RETRY_SET_${RUN_DATE}`, formal_version: updatedStore.formal_version, run_at: runAt, health, items: retryItems });
    result.accounting.actual_outcome_delta = result.accounting.expected_outcome_delta;
    result.accounting.actual_ready_delta = result.accounting.expected_ready_delta;
    writeJson(path.join(OUTPUT, "current_run_apply_0907.json"), result);
  }
  console.log(JSON.stringify(result, null, 2));
}

function cryptoHash(buffer) {
  return require("crypto").createHash("sha256").update(buffer).digest("hex");
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
