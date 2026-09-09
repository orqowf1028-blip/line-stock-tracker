"use strict";

const crypto = require("crypto");

const SCORECARD_VERSION = "W01_SCORECARD_V1.0.0-CANDIDATE";
const ACCEPTED_OUTCOME_VERSION = "W01_OUTCOME_V1.0.0-SHADOW";
const HORIZONS = ["1D", "3D", "5D", "10D", "20D", "60D", "120D", "250D"];

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleStdDev(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { lower: null, upper: null };
  const p = successes / total;
  const z2 = z ** 2;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / total) + (z2 / (4 * total ** 2))) / denominator;
  return { lower: round(center - margin), upper: round(center + margin) };
}

function sampleTier(n) {
  if (n <= 2) return "N_TOO_SMALL";
  if (n <= 4) return "N_LOW";
  if (n <= 9) return "N_MODERATE";
  if (n <= 19) return "N_HIGH";
  return "N_ROBUST";
}

function cellKey(row) {
  return `${row.teacher_id}|${row.signal_definition_id}|${row.horizon}`;
}

function outcomeIdentity(row) {
  return `${row.event_id}|${row.horizon}|${row.calculation_version}`;
}

function usableTeacher(teacher) {
  return Boolean(teacher && teacher.teacher_id !== "W01-T-UNKNOWN" && teacher.review_status === "CONFIRMED");
}

function usableSignal(definition) {
  return Boolean(definition && definition.status === "ACTIVE" && definition.direction !== "UNKNOWN");
}

function isReadyAsOf(row, asOfDate) {
  return row.outcome_status === "READY"
    && /^\d{4}-\d{2}-\d{2}$/.test(String(row.actual_trading_date || ""))
    && row.actual_trading_date <= asOfDate;
}

function statusAsOf(row, asOfDate) {
  if (row.outcome_status === "READY" && !isReadyAsOf(row, asOfDate)) return "NOT_MATURED_AS_OF";
  return row.outcome_status;
}

function metricValues(rows, field) {
  return rows.map(row => Number(row[field])).filter(Number.isFinite);
}

function aggregateMetric(rows, field) {
  const values = metricValues(rows, field);
  return {
    mean: round(mean(values)),
    median: round(median(values)),
    min: values.length ? round(Math.min(...values)) : null,
    max: values.length ? round(Math.max(...values)) : null,
    count: values.length,
  };
}

function buildCell(key, rows, teacherMap, signalMap, asOfDate, version) {
  const [teacherId, signalId, horizon] = key.split("|");
  const ready = rows.filter(row => isReadyAsOf(row, asOfDate));
  if (!ready.length) return null;
  const directional = metricValues(ready, "directional_return_pct");
  const hitCount = directional.filter(value => value > 0).length;
  const directionalMean = mean(directional);
  const directionalMedian = median(directional);
  const directionalStdDev = sampleStdDev(directional);
  const standardError = directionalStdDev == null ? null : directionalStdDev / Math.sqrt(directional.length);
  const hitInterval = wilsonInterval(hitCount, directional.length);
  const tickerCounts = new Map();
  const dateCounts = new Map();
  for (const row of ready) {
    tickerCounts.set(row.ticker, (tickerCounts.get(row.ticker) || 0) + 1);
    dateCounts.set(row.event_date, (dateCounts.get(row.event_date) || 0) + 1);
  }
  const topTickerCount = Math.max(...tickerCounts.values());
  const topDateCount = Math.max(...dateCounts.values());
  const statusCounts = {};
  for (const row of rows) {
    const status = statusAsOf(row, asOfDate);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const benchmarkReady = ready.filter(row => row.benchmark_status === "READY" && Number.isFinite(Number(row.excess_return_pct)));
  const sectorReady = ready.filter(row => row.sector_benchmark_status === "READY" && Number.isFinite(Number(row.sector_excess_return_pct)));
  const marketReturn = aggregateMetric(ready, "market_return_pct");
  const directionalReturn = aggregateMetric(ready, "directional_return_pct");
  const marketMfe = aggregateMetric(ready, "market_mfe_pct");
  const marketMae = aggregateMetric(ready, "market_mae_pct");
  const directionalMfe = aggregateMetric(ready, "directional_mfe_pct");
  const directionalMae = aggregateMetric(ready, "directional_mae_pct");
  const topTickerShare = topTickerCount / ready.length;
  const largestDateShare = topDateCount / ready.length;
  const outlierSensitive = ready.length >= 3
    && Math.abs(directionalMean - directionalMedian) > Math.max(2, (directionalStdDev || 0) * 0.5);
  const observationRefs = ready
    .map(row => ({
      outcome_identity: outcomeIdentity(row),
      event_id: row.event_id,
      ticker: row.ticker,
      event_date: row.event_date,
      actual_trading_date: row.actual_trading_date,
      directional_return_pct: round(Number(row.directional_return_pct)),
      market_return_pct: round(Number(row.market_return_pct)),
      directional_mfe_pct: round(Number(row.directional_mfe_pct)),
      directional_mae_pct: round(Number(row.directional_mae_pct)),
    }))
    .sort((left, right) => left.outcome_identity.localeCompare(right.outcome_identity));

  return {
    cell_id: key,
    teacher_id: teacherId,
    teacher_name: teacherMap.get(teacherId).display_name,
    signal_definition_id: signalId,
    signal_name: signalMap.get(signalId).signal_name,
    direction: signalMap.get(signalId).direction,
    horizon,
    n: ready.length,
    unique_tickers: tickerCounts.size,
    top_ticker_share: round(topTickerShare),
    unique_event_dates: dateCounts.size,
    largest_date_concentration: round(largestDateShare),
    mean_market_return_pct: marketReturn.mean,
    median_market_return_pct: marketReturn.median,
    mean_directional_return_pct: directionalReturn.mean,
    median_directional_return_pct: directionalReturn.median,
    directional_hit_count: hitCount,
    directional_hit_rate: round(hitCount / directional.length),
    directional_hit_rate_wilson95_lower: hitInterval.lower,
    directional_hit_rate_wilson95_upper: hitInterval.upper,
    mean_market_mfe_pct: marketMfe.mean,
    median_market_mfe_pct: marketMfe.median,
    mean_market_mae_pct: marketMae.mean,
    median_market_mae_pct: marketMae.median,
    mean_directional_mfe_pct: directionalMfe.mean,
    median_directional_mfe_pct: directionalMfe.median,
    mean_directional_mae_pct: directionalMae.mean,
    median_directional_mae_pct: directionalMae.median,
    stddev_directional_return_pct: round(directionalStdDev),
    standard_error_directional_return_pct: round(standardError),
    min_directional_return_pct: directionalReturn.min,
    max_directional_return_pct: directionalReturn.max,
    benchmark_metrics_availability: benchmarkReady.length === ready.length ? "AVAILABLE" : "UNAVAILABLE",
    mean_excess_return_pct: benchmarkReady.length === ready.length ? aggregateMetric(benchmarkReady, "excess_return_pct").mean : null,
    median_excess_return_pct: benchmarkReady.length === ready.length ? aggregateMetric(benchmarkReady, "excess_return_pct").median : null,
    sector_benchmark_metrics_availability: sectorReady.length === ready.length ? "AVAILABLE" : "UNAVAILABLE",
    mean_sector_excess_return_pct: sectorReady.length === ready.length ? aggregateMetric(sectorReady, "sector_excess_return_pct").mean : null,
    median_sector_excess_return_pct: sectorReady.length === ready.length ? aggregateMetric(sectorReady, "sector_excess_return_pct").median : null,
    first_observation_date: ready.map(row => row.actual_trading_date).sort()[0],
    last_observation_date: ready.map(row => row.actual_trading_date).sort().at(-1),
    first_event_date: ready.map(row => row.event_date).sort()[0],
    last_event_date: ready.map(row => row.event_date).sort().at(-1),
    sample_tier: sampleTier(ready.length),
    outlier_sensitive: outlierSensitive,
    concentration_flag: topTickerShare >= 0.5 || largestDateShare >= 0.5,
    candidate_count: rows.length,
    ready_count: ready.length,
    excluded_count: rows.length - ready.length,
    status_counts: Object.fromEntries(Object.entries(statusCounts).sort()),
    scorecard_version: version,
    as_of_date: asOfDate,
    observation_refs: observationRefs,
  };
}

function buildScorecard({ outcomeStore, teacherRegistry, signalRegistry, asOfDate, scorecardVersion = SCORECARD_VERSION, onlyKeys = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate || ""))) throw new Error("asOfDate must be YYYY-MM-DD");
  if (outcomeStore.calculation_version !== ACCEPTED_OUTCOME_VERSION) throw new Error(`Unsupported Outcome calculation version: ${outcomeStore.calculation_version}`);
  const teacherMap = new Map(teacherRegistry.teachers.map(teacher => [teacher.teacher_id, teacher]));
  const signalMap = new Map(signalRegistry.definitions.map(definition => [definition.signal_id, definition]));
  const eligibleTeachers = teacherRegistry.teachers.filter(usableTeacher);
  const eligibleSignals = signalRegistry.definitions.filter(usableSignal);
  const eligibleTeacherIds = new Set(eligibleTeachers.map(teacher => teacher.teacher_id));
  const eligibleSignalIds = new Set(eligibleSignals.map(signal => signal.signal_id));
  const allowedKeys = onlyKeys ? new Set(onlyKeys) : null;
  const groups = new Map();
  const excluded = {
    teacher_unresolved_or_review_outcome_rows: 0,
    teacher_unresolved_or_review_ready_rows: 0,
    signal_unusable_outcome_rows: 0,
    signal_unusable_ready_rows: 0,
  };
  const identityCounts = new Map();
  const anomalies = [];

  for (const row of outcomeStore.outcomes) {
    const identity = outcomeIdentity(row);
    identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
    if (!eligibleTeacherIds.has(row.teacher_id)) {
      excluded.teacher_unresolved_or_review_outcome_rows += 1;
      if (row.outcome_status === "READY") excluded.teacher_unresolved_or_review_ready_rows += 1;
      continue;
    }
    if (!eligibleSignalIds.has(row.signal_definition_id)) {
      excluded.signal_unusable_outcome_rows += 1;
      if (row.outcome_status === "READY") excluded.signal_unusable_ready_rows += 1;
      continue;
    }
    const key = cellKey(row);
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
    if (row.outcome_status === "READY") {
      const required = ["market_return_pct", "directional_return_pct", "directional_mfe_pct", "directional_mae_pct"];
      if (required.some(field => !Number.isFinite(Number(row[field])))) anomalies.push({ identity, reason: "READY_NUMERIC_FIELD_MISSING" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.actual_trading_date || ""))) anomalies.push({ identity, reason: "READY_ACTUAL_TRADING_DATE_MISSING" });
    }
  }

  const cells = [...groups.entries()]
    .map(([key, rows]) => buildCell(key, rows, teacherMap, signalMap, asOfDate, scorecardVersion))
    .filter(Boolean)
    .sort((left, right) => left.cell_id.localeCompare(right.cell_id));
  const distribution = { n1: 0, n2: 0, n3_4: 0, n5_9: 0, n10_19: 0, n20_49: 0, n50_plus: 0 };
  for (const cell of cells) {
    if (cell.n === 1) distribution.n1 += 1;
    else if (cell.n === 2) distribution.n2 += 1;
    else if (cell.n <= 4) distribution.n3_4 += 1;
    else if (cell.n <= 9) distribution.n5_9 += 1;
    else if (cell.n <= 19) distribution.n10_19 += 1;
    else if (cell.n <= 49) distribution.n20_49 += 1;
    else distribution.n50_plus += 1;
  }
  const duplicateOutcomes = [...identityCounts.entries()].filter(([, count]) => count > 1).map(([identity, count]) => ({ identity, count }));
  const readyObservations = cells.reduce((sum, cell) => sum + cell.n, 0);
  const teacherIdsWithReady = new Set(cells.map(cell => cell.teacher_id));
  const signalIdsWithReady = new Set(cells.map(cell => cell.signal_definition_id));
  const semanticCells = cells.map(cell => ({ ...cell }));
  const semanticHash = sha256({ scorecardVersion, asOfDate, outcomeVersion: outcomeStore.calculation_version, cells: semanticCells });
  return {
    artifact_id: `W01_V17_SCORECARD_${asOfDate}`,
    scorecard_version: scorecardVersion,
    as_of_date: asOfDate,
    input_outcome_calculation_version: outcomeStore.calculation_version,
    input_outcome_semantic_hash: outcomeStore.semantic_hash,
    input_outcome_rows: outcomeStore.outcomes.length,
    formal_ready_input_rows: outcomeStore.outcomes.filter(row => row.outcome_status === "READY").length,
    eligible_ready_observations: readyObservations,
    eligible_teacher_count: eligibleTeachers.length,
    teachers_with_ready_observations: teacherIdsWithReady.size,
    teacher_unresolved_or_review_identity_count: teacherRegistry.teachers.length - eligibleTeachers.length,
    eligible_signal_definition_count: eligibleSignals.length,
    signals_with_ready_observations: signalIdsWithReady.size,
    horizons: HORIZONS,
    possible_cartesian_cells: eligibleTeachers.length * eligibleSignals.length * HORIZONS.length,
    observed_candidate_cells: groups.size,
    ready_supported_cells: cells.length,
    sample_distribution: distribution,
    excluded,
    duplicate_outcomes: duplicateOutcomes,
    anomalies,
    cells,
    semantic_hash: semanticHash,
  };
}

function affectedCellKeys(changedOutcomeRows, teacherRegistry, signalRegistry) {
  const teacherMap = new Map(teacherRegistry.teachers.map(teacher => [teacher.teacher_id, teacher]));
  const signalMap = new Map(signalRegistry.definitions.map(definition => [definition.signal_id, definition]));
  return [...new Set(changedOutcomeRows
    .filter(row => usableTeacher(teacherMap.get(row.teacher_id)) && usableSignal(signalMap.get(row.signal_definition_id)))
    .map(cellKey))].sort();
}

function incrementalUpdateScorecard(previous, params, changedOutcomeRows) {
  const affected = affectedCellKeys(changedOutcomeRows, params.teacherRegistry, params.signalRegistry);
  const partial = buildScorecard({ ...params, onlyKeys: affected });
  const replacements = new Map(partial.cells.map(cell => [cell.cell_id, cell]));
  const mergedCells = previous.cells
    .filter(cell => !replacements.has(cell.cell_id) && !affected.includes(cell.cell_id))
    .concat(partial.cells)
    .sort((left, right) => left.cell_id.localeCompare(right.cell_id));
  const changedCells = affected.filter(key => {
    const before = previous.cells.find(cell => cell.cell_id === key) || null;
    const after = mergedCells.find(cell => cell.cell_id === key) || null;
    return stableStringify(before) !== stableStringify(after);
  });
  const eligibleTeachers = params.teacherRegistry.teachers.filter(usableTeacher);
  const eligibleSignals = params.signalRegistry.definitions.filter(usableSignal);
  const eligibleTeacherIds = new Set(eligibleTeachers.map(teacher => teacher.teacher_id));
  const eligibleSignalIds = new Set(eligibleSignals.map(signal => signal.signal_id));
  const observedKeys = new Set();
  const excluded = {
    teacher_unresolved_or_review_outcome_rows: 0,
    teacher_unresolved_or_review_ready_rows: 0,
    signal_unusable_outcome_rows: 0,
    signal_unusable_ready_rows: 0,
  };
  for (const row of params.outcomeStore.outcomes) {
    if (!eligibleTeacherIds.has(row.teacher_id)) {
      excluded.teacher_unresolved_or_review_outcome_rows += 1;
      if (row.outcome_status === "READY") excluded.teacher_unresolved_or_review_ready_rows += 1;
    } else if (!eligibleSignalIds.has(row.signal_definition_id)) {
      excluded.signal_unusable_outcome_rows += 1;
      if (row.outcome_status === "READY") excluded.signal_unusable_ready_rows += 1;
    } else {
      observedKeys.add(cellKey(row));
    }
  }
  const distribution = { n1: 0, n2: 0, n3_4: 0, n5_9: 0, n10_19: 0, n20_49: 0, n50_plus: 0 };
  for (const cell of mergedCells) {
    if (cell.n === 1) distribution.n1 += 1;
    else if (cell.n === 2) distribution.n2 += 1;
    else if (cell.n <= 4) distribution.n3_4 += 1;
    else if (cell.n <= 9) distribution.n5_9 += 1;
    else if (cell.n <= 19) distribution.n10_19 += 1;
    else if (cell.n <= 49) distribution.n20_49 += 1;
    else distribution.n50_plus += 1;
  }
  const next = {
    ...previous,
    input_outcome_rows: params.outcomeStore.outcomes.length,
    formal_ready_input_rows: params.outcomeStore.outcomes.filter(row => row.outcome_status === "READY").length,
    eligible_ready_observations: mergedCells.reduce((sum, cell) => sum + cell.n, 0),
    eligible_teacher_count: eligibleTeachers.length,
    teachers_with_ready_observations: new Set(mergedCells.map(cell => cell.teacher_id)).size,
    teacher_unresolved_or_review_identity_count: params.teacherRegistry.teachers.length - eligibleTeachers.length,
    eligible_signal_definition_count: eligibleSignals.length,
    signals_with_ready_observations: new Set(mergedCells.map(cell => cell.signal_definition_id)).size,
    possible_cartesian_cells: eligibleTeachers.length * eligibleSignals.length * HORIZONS.length,
    observed_candidate_cells: observedKeys.size,
    ready_supported_cells: mergedCells.length,
    sample_distribution: distribution,
    excluded,
    cells: mergedCells,
  };
  next.semantic_hash = sha256({ scorecardVersion: next.scorecard_version, asOfDate: next.as_of_date, outcomeVersion: next.input_outcome_calculation_version, cells: mergedCells });
  return { scorecard: next, affected_cell_keys: affected, changed_cell_keys: changedCells };
}

module.exports = {
  SCORECARD_VERSION,
  ACCEPTED_OUTCOME_VERSION,
  HORIZONS,
  stableStringify,
  sha256,
  mean,
  median,
  sampleStdDev,
  sampleTier,
  cellKey,
  outcomeIdentity,
  buildScorecard,
  affectedCellKeys,
  incrementalUpdateScorecard,
};
