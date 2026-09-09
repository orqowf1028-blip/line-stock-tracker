"use strict";

const {
  ACCEPTED_OUTCOME_VERSION,
  HORIZONS,
  mean,
  median,
  sampleStdDev,
  outcomeIdentity,
  sha256,
  stableStringify,
} = require("./scorecard-engine");

const HIERARCHICAL_SCORECARD_VERSION = "W01_SCORECARD_V1.1.0-CANDIDATE";
const SUFFICIENCY_RULE_VERSION = "W01_SUFFICIENCY_V1.0.0-CANDIDATE";
const SUFFICIENCY_ORDER = ["INSUFFICIENT", "EARLY_PATTERN", "DESCRIPTIVE", "MODERATE_EVIDENCE", "STRONGER_EVIDENCE"];

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

function usableTeacher(teacher) {
  return Boolean(teacher && teacher.teacher_id !== "W01-T-UNKNOWN" && teacher.review_status === "CONFIRMED");
}

function usableSignal(definition) {
  return Boolean(definition && definition.status === "ACTIVE" && definition.direction !== "UNKNOWN");
}

function readyAsOf(row, asOfDate) {
  return row.outcome_status === "READY"
    && /^\d{4}-\d{2}-\d{2}$/.test(String(row.actual_trading_date || ""))
    && row.actual_trading_date <= asOfDate;
}

function statusAsOf(row, asOfDate) {
  return row.outcome_status === "READY" && !readyAsOf(row, asOfDate) ? "NOT_MATURED_AS_OF" : row.outcome_status;
}

function metric(rows, field) {
  const values = rows.map(row => Number(row[field])).filter(Number.isFinite);
  return {
    values,
    mean: round(mean(values)),
    median: round(median(values)),
    min: values.length ? round(Math.min(...values)) : null,
    max: values.length ? round(Math.max(...values)) : null,
  };
}

function baseSufficiency(n) {
  if (n < 5) return "INSUFFICIENT";
  if (n < 10) return "EARLY_PATTERN";
  if (n < 20) return "DESCRIPTIVE";
  if (n < 50) return "MODERATE_EVIDENCE";
  return "STRONGER_EVIDENCE";
}

function capStatus(status, cap) {
  return SUFFICIENCY_ORDER[Math.min(SUFFICIENCY_ORDER.indexOf(status), SUFFICIENCY_ORDER.indexOf(cap))];
}

function assessSufficiency(metrics) {
  let status = baseSufficiency(metrics.n);
  const reasons = [`BASE_N_${status}`];
  if (metrics.n < 5) {
    return { status: "INSUFFICIENT", supported: false, reasons, rule_version: SUFFICIENCY_RULE_VERSION };
  }
  if (metrics.unique_tickers < 2 || metrics.unique_event_dates < 2) {
    status = "INSUFFICIENT";
    reasons.push("SINGLE_TICKER_OR_DATE");
  } else {
    const maxConcentration = Math.max(metrics.top_ticker_share, metrics.largest_date_concentration);
    if (maxConcentration >= 0.8) {
      status = capStatus(status, "EARLY_PATTERN");
      reasons.push("EXTREME_CONCENTRATION_GE_80PCT");
    } else if (maxConcentration >= 0.5) {
      status = capStatus(status, "DESCRIPTIVE");
      reasons.push("HIGH_CONCENTRATION_GE_50PCT");
    }
    if (metrics.coverage_ratio < 0.25) {
      status = capStatus(status, "EARLY_PATTERN");
      reasons.push("LOW_COVERAGE_LT_25PCT");
    } else if (metrics.coverage_ratio < 0.4) {
      status = capStatus(status, "DESCRIPTIVE");
      reasons.push("LIMITED_COVERAGE_LT_40PCT");
    }
    if (status === "STRONGER_EVIDENCE" && (metrics.unique_tickers < 15 || metrics.unique_event_dates < 15)) {
      status = "MODERATE_EVIDENCE";
      reasons.push("STRONGER_DIVERSITY_NOT_MET");
    }
    if (status === "MODERATE_EVIDENCE" && (metrics.unique_tickers < 8 || metrics.unique_event_dates < 8)) {
      status = "DESCRIPTIVE";
      reasons.push("MODERATE_DIVERSITY_NOT_MET");
    }
    if (metrics.outlier_sensitive) {
      status = capStatus(status, "DESCRIPTIVE");
      reasons.push("OUTLIER_SENSITIVE");
    }
  }
  return {
    status,
    supported: SUFFICIENCY_ORDER.indexOf(status) >= SUFFICIENCY_ORDER.indexOf("DESCRIPTIVE"),
    reasons,
    rule_version: SUFFICIENCY_RULE_VERSION,
  };
}

function aggregateCell(rows, descriptor, asOfDate) {
  const ready = rows.filter(row => readyAsOf(row, asOfDate));
  if (!ready.length) return null;
  const marketReturn = metric(ready, "market_return_pct");
  const directionalReturn = metric(ready, "directional_return_pct");
  const marketMfe = metric(ready, "market_mfe_pct");
  const marketMae = metric(ready, "market_mae_pct");
  const directionalMfe = metric(ready, "directional_mfe_pct");
  const directionalMae = metric(ready, "directional_mae_pct");
  const hitCount = directionalReturn.values.filter(value => value > 0).length;
  const hitInterval = wilsonInterval(hitCount, ready.length);
  const stddev = sampleStdDev(directionalReturn.values);
  const tickerCounts = new Map();
  const dateCounts = new Map();
  const statusCounts = {};
  for (const row of ready) {
    tickerCounts.set(row.ticker, (tickerCounts.get(row.ticker) || 0) + 1);
    dateCounts.set(row.event_date, (dateCounts.get(row.event_date) || 0) + 1);
  }
  for (const row of rows) {
    const status = statusAsOf(row, asOfDate);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const topTickerShare = Math.max(...tickerCounts.values()) / ready.length;
  const largestDateConcentration = Math.max(...dateCounts.values()) / ready.length;
  const coverageRatio = ready.length / rows.length;
  const outlierSensitive = ready.length >= 3
    && Math.abs(directionalReturn.mean - directionalReturn.median) > Math.max(2, (stddev || 0) * 0.5);
  const core = {
    ...descriptor,
    n: ready.length,
    unique_tickers: tickerCounts.size,
    unique_event_dates: dateCounts.size,
    top_ticker_share: round(topTickerShare),
    largest_date_concentration: round(largestDateConcentration),
    candidate_count: rows.length,
    excluded_count: rows.length - ready.length,
    coverage_ratio: round(coverageRatio),
    status_counts: Object.fromEntries(Object.entries(statusCounts).sort()),
    mean_market_return_pct: marketReturn.mean,
    median_market_return_pct: marketReturn.median,
    mean_directional_return_pct: directionalReturn.mean,
    median_directional_return_pct: directionalReturn.median,
    directional_hit_count: hitCount,
    directional_hit_rate: round(hitCount / ready.length),
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
    stddev_directional_return_pct: round(stddev),
    standard_error_directional_return_pct: stddev == null ? null : round(stddev / Math.sqrt(ready.length)),
    min_directional_return_pct: directionalReturn.min,
    max_directional_return_pct: directionalReturn.max,
    first_observation_date: ready.map(row => row.actual_trading_date).sort()[0],
    last_observation_date: ready.map(row => row.actual_trading_date).sort().at(-1),
    first_event_date: ready.map(row => row.event_date).sort()[0],
    last_event_date: ready.map(row => row.event_date).sort().at(-1),
    outlier_sensitive: outlierSensitive,
    benchmark_metrics_availability: "UNAVAILABLE",
    sector_benchmark_metrics_availability: "UNAVAILABLE",
    scorecard_version: HIERARCHICAL_SCORECARD_VERSION,
    sufficiency_rule_version: SUFFICIENCY_RULE_VERSION,
    as_of_date: asOfDate,
    observation_refs: ready.map(row => ({
      outcome_identity: outcomeIdentity(row),
      event_id: row.event_id,
      ticker: row.ticker,
      event_date: row.event_date,
      actual_trading_date: row.actual_trading_date,
      market_return_pct: round(Number(row.market_return_pct)),
      directional_return_pct: round(Number(row.directional_return_pct)),
      directional_mfe_pct: round(Number(row.directional_mfe_pct)),
      directional_mae_pct: round(Number(row.directional_mae_pct)),
    })).sort((left, right) => left.outcome_identity.localeCompare(right.outcome_identity)),
  };
  core.sufficiency = assessSufficiency(core);
  return core;
}

function distribution(cells) {
  const bins = { n1: 0, n2: 0, n3_4: 0, n5_9: 0, n10_19: 0, n20_49: 0, n50_plus: 0 };
  const sufficiency = {};
  const values = cells.map(cell => cell.n).sort((a, b) => a - b);
  for (const cell of cells) {
    if (cell.n === 1) bins.n1 += 1;
    else if (cell.n === 2) bins.n2 += 1;
    else if (cell.n <= 4) bins.n3_4 += 1;
    else if (cell.n <= 9) bins.n5_9 += 1;
    else if (cell.n <= 19) bins.n10_19 += 1;
    else if (cell.n <= 49) bins.n20_49 += 1;
    else bins.n50_plus += 1;
    sufficiency[cell.sufficiency.status] = (sufficiency[cell.sufficiency.status] || 0) + 1;
  }
  return {
    cells: cells.length,
    bins,
    sufficiency: Object.fromEntries(Object.entries(sufficiency).sort()),
    median_n: round(median(values)),
    mean_n: round(mean(values)),
    max_n: values.length ? Math.max(...values) : 0,
  };
}

function groupRows(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function buildLevel(groups, descriptorFn, asOfDate) {
  return [...groups.entries()]
    .map(([key, rows]) => aggregateCell(rows, descriptorFn(key, rows[0]), asOfDate))
    .filter(Boolean)
    .sort((left, right) => left.cell_id.localeCompare(right.cell_id));
}

function baselineComparison(hierarchy, cell) {
  let baseline = null;
  if (cell.level === "L3") {
    baseline = hierarchy.l1.find(candidate => candidate.signal_definition_id === cell.signal_definition_id && candidate.horizon === cell.horizon);
  } else if (cell.level === "L2") {
    baseline = hierarchy.l1_coarse.find(candidate => candidate.signal_family === cell.signal_family && candidate.direction === cell.direction && candidate.horizon === cell.horizon);
  }
  if (!baseline || baseline.as_of_date !== cell.as_of_date || baseline.scorecard_version !== cell.scorecard_version) {
    return { status: "UNAVAILABLE", baseline_cell_id: baseline?.cell_id || null };
  }
  return {
    status: "AVAILABLE",
    baseline_cell_id: baseline.cell_id,
    baseline_n: baseline.n,
    baseline_sufficiency: baseline.sufficiency.status,
    median_directional_return_delta_pct: round(cell.median_directional_return_pct - baseline.median_directional_return_pct),
    directional_hit_rate_delta: round(cell.directional_hit_rate - baseline.directional_hit_rate),
    label: "BASELINE_DELTA_NOT_ALPHA",
  };
}

function resolveBestSupportedView({ hierarchy, teacherId, signalDefinitionId, horizon, teacherRegistry, signalRegistry }) {
  const teacher = teacherRegistry.teachers.find(row => row.teacher_id === teacherId);
  const signal = signalRegistry.definitions.find(row => row.signal_id === signalDefinitionId);
  if (!usableTeacher(teacher)) return { requested_level: "L3", resolved_level: "EXCLUDED", reason_for_fallback: "TEACHER_UNRESOLVED_OR_REVIEW", sample_sufficiency: "UNAVAILABLE", underlying_cell_id: null };
  if (!usableSignal(signal)) return { requested_level: "L3", resolved_level: "EXCLUDED", reason_for_fallback: "SIGNAL_UNCLASSIFIED_OR_DIRECTION_UNKNOWN", sample_sufficiency: "UNAVAILABLE", underlying_cell_id: null };
  const l3 = hierarchy.l3.find(cell => cell.teacher_id === teacherId && cell.signal_definition_id === signalDefinitionId && cell.horizon === horizon);
  const l2 = hierarchy.l2.find(cell => cell.teacher_id === teacherId && cell.signal_family === signal.signal_family && cell.direction === signal.direction && cell.horizon === horizon);
  const l1 = hierarchy.l1.find(cell => cell.signal_definition_id === signalDefinitionId && cell.horizon === horizon);
  const chain = [{ level: "L3", cell: l3 }, { level: "L2", cell: l2 }, { level: "L1", cell: l1 }];
  const resolved = chain.find(item => item.cell?.sufficiency.supported);
  if (resolved) {
    return {
      requested_level: "L3",
      resolved_level: resolved.level,
      reason_for_fallback: resolved.level === "L3" ? "L3_SUFFICIENT" : `${chain.slice(0, chain.indexOf(resolved)).map(item => `${item.level}_${item.cell?.sufficiency.status || "NO_CELL"}`).join(";")}→${resolved.level}`,
      sample_sufficiency: resolved.cell.sufficiency.status,
      underlying_cell_id: resolved.cell.cell_id,
      requested_l3_cell_id: l3?.cell_id || null,
      requested_l3_status: l3?.sufficiency.status || "NO_CELL",
      l2_cell_id: l2?.cell_id || null,
      l2_status: l2?.sufficiency.status || "NO_CELL",
      l1_cell_id: l1?.cell_id,
      l1_status: l1.sufficiency.status,
      metrics: {
        n: resolved.cell.n,
        median_directional_return_pct: resolved.cell.median_directional_return_pct,
        directional_hit_rate: resolved.cell.directional_hit_rate,
      },
    };
  }
  return {
    requested_level: "L3",
    resolved_level: "OBSERVATION_ONLY",
    reason_for_fallback: "L3_L2_L1_ALL_INSUFFICIENT",
    sample_sufficiency: l3?.sufficiency.status || "INSUFFICIENT",
    underlying_cell_id: l3?.cell_id,
    requested_l3_cell_id: l3.cell_id,
    requested_l3_status: l3.sufficiency.status,
    l2_cell_id: l2?.cell_id || null,
    l2_status: l2?.sufficiency.status || "NO_CELL",
    l1_cell_id: l1?.cell_id || null,
    l1_status: l1?.sufficiency.status || "NO_CELL",
    metrics: null,
  };
}

function buildHierarchy({ outcomeStore, teacherRegistry, signalRegistry, asOfDate }) {
  if (outcomeStore.calculation_version !== ACCEPTED_OUTCOME_VERSION) throw new Error(`Unsupported Outcome version ${outcomeStore.calculation_version}`);
  const teacherMap = new Map(teacherRegistry.teachers.map(row => [row.teacher_id, row]));
  const signalMap = new Map(signalRegistry.definitions.map(row => [row.signal_id, row]));
  const rows = [];
  const exclusions = { teacher_outcome_rows: 0, teacher_ready_rows: 0, signal_outcome_rows: 0, signal_ready_rows: 0 };
  const identityCounts = new Map();
  const anomalies = [];
  for (const row of outcomeStore.outcomes) {
    const identity = outcomeIdentity(row);
    identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
    if (!usableTeacher(teacherMap.get(row.teacher_id))) {
      exclusions.teacher_outcome_rows += 1;
      if (row.outcome_status === "READY") exclusions.teacher_ready_rows += 1;
      continue;
    }
    if (!usableSignal(signalMap.get(row.signal_definition_id))) {
      exclusions.signal_outcome_rows += 1;
      if (row.outcome_status === "READY") exclusions.signal_ready_rows += 1;
      continue;
    }
    rows.push(row);
    if (row.outcome_status === "READY" && ["market_return_pct", "directional_return_pct", "directional_mfe_pct", "directional_mae_pct"].some(field => !Number.isFinite(Number(row[field])))) {
      anomalies.push({ identity, reason: "READY_NUMERIC_FIELD_MISSING" });
    }
  }
  const l1Groups = groupRows(rows, row => `${row.signal_definition_id}|${row.horizon}`);
  const l1CoarseGroups = groupRows(rows, row => {
    const signal = signalMap.get(row.signal_definition_id);
    return `${signal.signal_family}|${signal.direction}|${row.horizon}`;
  });
  const l2Groups = groupRows(rows, row => {
    const signal = signalMap.get(row.signal_definition_id);
    return `${row.teacher_id}|${signal.signal_family}|${signal.direction}|${row.horizon}`;
  });
  const l3Groups = groupRows(rows, row => `${row.teacher_id}|${row.signal_definition_id}|${row.horizon}`);
  const l1 = buildLevel(l1Groups, (key, row) => {
    const signal = signalMap.get(row.signal_definition_id);
    return { level: "L1", cell_id: `L1|${key}`, signal_definition_id: row.signal_definition_id, signal_name: signal.signal_name, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
  }, asOfDate);
  const l1Coarse = buildLevel(l1CoarseGroups, (key, row) => {
    const signal = signalMap.get(row.signal_definition_id);
    return { level: "L1_COARSE", cell_id: `L1C|${key}`, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
  }, asOfDate);
  const l2 = buildLevel(l2Groups, (key, row) => {
    const signal = signalMap.get(row.signal_definition_id);
    return { level: "L2", cell_id: `L2|${key}`, teacher_id: row.teacher_id, teacher_name: teacherMap.get(row.teacher_id).display_name, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
  }, asOfDate);
  const l3 = buildLevel(l3Groups, (key, row) => {
    const signal = signalMap.get(row.signal_definition_id);
    return { level: "L3", cell_id: `L3|${key}`, teacher_id: row.teacher_id, teacher_name: teacherMap.get(row.teacher_id).display_name, signal_definition_id: row.signal_definition_id, signal_name: signal.signal_name, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
  }, asOfDate);
  const hierarchy = { l1, l1_coarse: l1Coarse, l2, l3 };
  const comparisons = [
    ...l2.map(cell => ({ cell_id: cell.cell_id, level: "L2", ...baselineComparison(hierarchy, cell) })),
    ...l3.map(cell => ({ cell_id: cell.cell_id, level: "L3", ...baselineComparison(hierarchy, cell) })),
  ];
  const fallback = l3.map(cell => resolveBestSupportedView({ hierarchy, teacherId: cell.teacher_id, signalDefinitionId: cell.signal_definition_id, horizon: cell.horizon, teacherRegistry, signalRegistry }));
  const fallbackDistribution = {};
  for (const result of fallback) fallbackDistribution[result.resolved_level] = (fallbackDistribution[result.resolved_level] || 0) + 1;
  const duplicateOutcomes = [...identityCounts.entries()].filter(([, count]) => count > 1).map(([identity, count]) => ({ identity, count }));
  const readyEligible = rows.filter(row => readyAsOf(row, asOfDate)).length;
  const dataset = {
    artifact_id: `W01_V17_HIERARCHICAL_SCORECARD_${asOfDate}`,
    scorecard_version: HIERARCHICAL_SCORECARD_VERSION,
    sufficiency_rule_version: SUFFICIENCY_RULE_VERSION,
    as_of_date: asOfDate,
    outcome_calculation_version: outcomeStore.calculation_version,
    outcome_input_semantic_hash: outcomeStore.semantic_hash,
    formal_ready_input: outcomeStore.outcomes.filter(row => row.outcome_status === "READY").length,
    registry_safe_ready_input: readyEligible,
    exclusions,
    distribution: { l1: distribution(l1), l1_coarse: distribution(l1Coarse), l2: distribution(l2), l3: distribution(l3) },
    hierarchy,
    comparisons,
    fallback_resolutions: fallback,
    fallback_distribution: Object.fromEntries(Object.entries(fallbackDistribution).sort()),
    duplicate_outcomes: duplicateOutcomes,
    anomalies,
  };
  dataset.hashes = {
    l1: sha256(l1),
    l1_coarse: sha256(l1Coarse),
    l2: sha256(l2),
    l3: sha256(l3),
    comparisons: sha256(comparisons),
    fallback: sha256(fallback),
  };
  dataset.semantic_hash = sha256({
    scorecard_version: dataset.scorecard_version,
    sufficiency_rule_version: dataset.sufficiency_rule_version,
    as_of_date: dataset.as_of_date,
    outcome_input_semantic_hash: dataset.outcome_input_semantic_hash,
    hashes: dataset.hashes,
  });
  return dataset;
}

function affectedHierarchyKeys(row, signalRegistry) {
  const signal = signalRegistry.definitions.find(definition => definition.signal_id === row.signal_definition_id);
  if (!signal) return null;
  return {
    l1: `L1|${row.signal_definition_id}|${row.horizon}`,
    l1_coarse: `L1C|${signal.signal_family}|${signal.direction}|${row.horizon}`,
    l2: `L2|${row.teacher_id}|${signal.signal_family}|${signal.direction}|${row.horizon}`,
    l3: `L3|${row.teacher_id}|${row.signal_definition_id}|${row.horizon}`,
  };
}

function incrementalUpdateHierarchy(previous, { outcomeStore, teacherRegistry, signalRegistry, asOfDate }, changedOutcomeRows) {
  const teacherMap = new Map(teacherRegistry.teachers.map(row => [row.teacher_id, row]));
  const signalMap = new Map(signalRegistry.definitions.map(row => [row.signal_id, row]));
  const safeRows = outcomeStore.outcomes.filter(row => usableTeacher(teacherMap.get(row.teacher_id)) && usableSignal(signalMap.get(row.signal_definition_id)));
  const affected = { l1: new Set(), l1_coarse: new Set(), l2: new Set(), l3: new Set() };
  for (const row of changedOutcomeRows) {
    if (!usableTeacher(teacherMap.get(row.teacher_id)) || !usableSignal(signalMap.get(row.signal_definition_id))) continue;
    const keys = affectedHierarchyKeys(row, signalRegistry);
    for (const level of Object.keys(affected)) affected[level].add(keys[level]);
  }
  const keyFns = {
    l1: row => `L1|${row.signal_definition_id}|${row.horizon}`,
    l1_coarse: row => {
      const signal = signalMap.get(row.signal_definition_id);
      return `L1C|${signal.signal_family}|${signal.direction}|${row.horizon}`;
    },
    l2: row => {
      const signal = signalMap.get(row.signal_definition_id);
      return `L2|${row.teacher_id}|${signal.signal_family}|${signal.direction}|${row.horizon}`;
    },
    l3: row => `L3|${row.teacher_id}|${row.signal_definition_id}|${row.horizon}`,
  };
  const affectedGroups = Object.fromEntries(Object.keys(affected).map(level => [level, new Map()]));
  for (const row of safeRows) {
    for (const level of Object.keys(affected)) {
      const key = keyFns[level](row);
      if (!affected[level].has(key)) continue;
      if (!affectedGroups[level].has(key)) affectedGroups[level].set(key, []);
      affectedGroups[level].get(key).push(row);
    }
  }
  function descriptor(level, cellId, row) {
    const signal = signalMap.get(row.signal_definition_id);
    if (level === "l1") return { level: "L1", cell_id: cellId, signal_definition_id: row.signal_definition_id, signal_name: signal.signal_name, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
    if (level === "l1_coarse") return { level: "L1_COARSE", cell_id: cellId, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
    if (level === "l2") return { level: "L2", cell_id: cellId, teacher_id: row.teacher_id, teacher_name: teacherMap.get(row.teacher_id).display_name, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
    return { level: "L3", cell_id: cellId, teacher_id: row.teacher_id, teacher_name: teacherMap.get(row.teacher_id).display_name, signal_definition_id: row.signal_definition_id, signal_name: signal.signal_name, signal_family: signal.signal_family, direction: signal.direction, horizon: row.horizon };
  }
  const nextHierarchy = {};
  const changedCellIds = [];
  for (const level of Object.keys(affected)) {
    const replacements = new Map();
    for (const cellId of affected[level]) {
      const rows = affectedGroups[level].get(cellId) || [];
      const cell = rows.length ? aggregateCell(rows, descriptor(level, cellId, rows[0]), asOfDate) : null;
      replacements.set(cellId, cell);
    }
    const before = previous.hierarchy[level] || [];
    const merged = before.filter(cell => !replacements.has(cell.cell_id));
    for (const [cellId, cell] of replacements) {
      if (cell) merged.push(cell);
      const prior = before.find(candidate => candidate.cell_id === cellId) || null;
      if (stableStringify(prior) !== stableStringify(cell)) changedCellIds.push(cellId);
    }
    nextHierarchy[level] = merged.sort((left, right) => left.cell_id.localeCompare(right.cell_id));
  }
  const comparisons = [
    ...nextHierarchy.l2.map(cell => ({ cell_id: cell.cell_id, level: "L2", ...baselineComparison(nextHierarchy, cell) })),
    ...nextHierarchy.l3.map(cell => ({ cell_id: cell.cell_id, level: "L3", ...baselineComparison(nextHierarchy, cell) })),
  ];
  const fallback = nextHierarchy.l3.map(cell => resolveBestSupportedView({ hierarchy: nextHierarchy, teacherId: cell.teacher_id, signalDefinitionId: cell.signal_definition_id, horizon: cell.horizon, teacherRegistry, signalRegistry }));
  const fallbackDistribution = {};
  for (const result of fallback) fallbackDistribution[result.resolved_level] = (fallbackDistribution[result.resolved_level] || 0) + 1;
  const hashes = {
    l1: sha256(nextHierarchy.l1),
    l1_coarse: sha256(nextHierarchy.l1_coarse),
    l2: sha256(nextHierarchy.l2),
    l3: sha256(nextHierarchy.l3),
    comparisons: sha256(comparisons),
    fallback: sha256(fallback),
  };
  const next = {
    ...previous,
    outcome_calculation_version: outcomeStore.calculation_version,
    outcome_input_semantic_hash: outcomeStore.semantic_hash,
    formal_ready_input: outcomeStore.outcomes.filter(row => row.outcome_status === "READY").length,
    registry_safe_ready_input: safeRows.filter(row => readyAsOf(row, asOfDate)).length,
    distribution: {
      l1: distribution(nextHierarchy.l1),
      l1_coarse: distribution(nextHierarchy.l1_coarse),
      l2: distribution(nextHierarchy.l2),
      l3: distribution(nextHierarchy.l3),
    },
    hierarchy: nextHierarchy,
    comparisons,
    fallback_resolutions: fallback,
    fallback_distribution: Object.fromEntries(Object.entries(fallbackDistribution).sort()),
    hashes,
  };
  next.semantic_hash = sha256({
    scorecard_version: next.scorecard_version,
    sufficiency_rule_version: next.sufficiency_rule_version,
    as_of_date: next.as_of_date,
    outcome_input_semantic_hash: next.outcome_input_semantic_hash,
    hashes,
  });
  return {
    hierarchy: next,
    affected_keys: Object.fromEntries(Object.entries(affected).map(([level, keys]) => [level, [...keys].sort()])),
    recomputed_raw_cells: Object.values(affected).reduce((sum, keys) => sum + keys.size, 0),
    changed_raw_cell_ids: [...new Set(changedCellIds)].sort(),
  };
}

module.exports = {
  HIERARCHICAL_SCORECARD_VERSION,
  SUFFICIENCY_RULE_VERSION,
  SUFFICIENCY_ORDER,
  assessSufficiency,
  aggregateCell,
  distribution,
  baselineComparison,
  resolveBestSupportedView,
  buildHierarchy,
  affectedHierarchyKeys,
  incrementalUpdateHierarchy,
  usableTeacher,
  usableSignal,
  readyAsOf,
  stableStringify,
};
