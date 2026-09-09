"use strict";

const { performance } = require("perf_hooks");

const {
  HIERARCHICAL_SCORECARD_VERSION,
  SUFFICIENCY_RULE_VERSION,
  SUFFICIENCY_ORDER,
  aggregateCell,
  usableTeacher,
  usableSignal,
  readyAsOf,
} = require("./hierarchical-scorecard-engine");
const {
  HORIZONS,
  outcomeIdentity,
  sha256,
  stableStringify,
} = require("./scorecard-engine");

const TEACHER_ALPHA_VERSION = "W01_TEACHER_ALPHA_V0.1.0-RESEARCH";
const PEER_BASELINE_VERSION = "W01_LOTO_PEER_BASELINE_V0.1.0-RESEARCH";
const TEMPORAL_SPLIT_VERSION = "W01_ALPHA_TEMPORAL_SPLIT_V0.1.0-RESEARCH";
const ALPHA_INCREMENTAL_INDEX_VERSION = "W01_ALPHA_DEPENDENCY_INDEX_V0.1.0";
const HORIZON_ORDER = new Map(HORIZONS.map((value, index) => [value, index]));

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function supportedSufficiency(status) {
  return SUFFICIENCY_ORDER.indexOf(status) >= SUFFICIENCY_ORDER.indexOf("DESCRIPTIVE");
}

function alphaEligibleSignal(definition) {
  return usableSignal(definition) && ["BULLISH", "BEARISH"].includes(definition.direction);
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

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function maximumShare(rows, keyFn) {
  if (!rows.length) return null;
  return round(Math.max(...countBy(rows, keyFn).values()) / rows.length);
}

function exactKey(row) {
  return `${row.signal_definition_id}|${row.horizon}`;
}

function coarseKey(row, signalMap) {
  const signal = signalMap.get(row.signal_definition_id);
  return `${signal.signal_family}|${signal.direction}|${row.horizon}`;
}

function teacherExactKey(row) {
  return `${row.teacher_id}|${row.signal_definition_id}|${row.horizon}`;
}

function teacherCoarseKey(row, signalMap) {
  return `${row.teacher_id}|${coarseKey(row, signalMap)}`;
}

function peerQuality(peerCell, peerTeacherCount) {
  if (!peerCell) return { status: "NO_BASELINE", supported: false, reasons: ["NO_PEER_READY_OBSERVATIONS"] };
  if (!peerCell.sufficiency.supported) {
    return { status: "INSUFFICIENT", supported: false, reasons: [`V17_${peerCell.sufficiency.status}`] };
  }
  if (peerTeacherCount < 3) {
    return { status: "LOW_TEACHER_BREADTH", supported: false, reasons: ["PEER_TEACHERS_LT_3"] };
  }
  const sufficiencyIndex = SUFFICIENCY_ORDER.indexOf(peerCell.sufficiency.status);
  if (sufficiencyIndex >= SUFFICIENCY_ORDER.indexOf("STRONGER_EVIDENCE") && peerTeacherCount >= 15) {
    return { status: "STRONGER_BASELINE", supported: true, reasons: ["V17_STRONGER_AND_PEERS_GE_15"] };
  }
  if (sufficiencyIndex >= SUFFICIENCY_ORDER.indexOf("MODERATE_EVIDENCE") && peerTeacherCount >= 8) {
    return { status: "MODERATE_BASELINE", supported: true, reasons: ["V17_MODERATE_AND_PEERS_GE_8"] };
  }
  return { status: "DESCRIPTIVE_BASELINE", supported: true, reasons: ["V17_SUPPORTED_AND_PEERS_GE_3"] };
}

function edgeDirection(cell) {
  if (cell.median_directional_return_delta_pct > 0 && cell.directional_hit_rate_delta > 0) return "POSITIVE_BOTH";
  if (cell.median_directional_return_delta_pct < 0 && cell.directional_hit_rate_delta < 0) return "NEGATIVE_BOTH";
  if (cell.median_directional_return_delta_pct > 0) return "POSITIVE_MEDIAN_ONLY";
  if (cell.directional_hit_rate_delta > 0) return "POSITIVE_HIT_ONLY";
  if (cell.median_directional_return_delta_pct === 0 && cell.directional_hit_rate_delta === 0) return "NEUTRAL";
  return "MIXED";
}

function allBaselineForCell(hierarchy, cell) {
  if (cell.level === "L3") {
    return hierarchy.hierarchy.l1.find(row => row.signal_definition_id === cell.signal_definition_id && row.horizon === cell.horizon) || null;
  }
  return hierarchy.hierarchy.l1_coarse.find(row => row.signal_family === cell.signal_family && row.direction === cell.direction && row.horizon === cell.horizon) || null;
}

function candidateGroupForCell(cell, maps) {
  if (cell.level === "L3") return maps.exact.get(`${cell.signal_definition_id}|${cell.horizon}`) || [];
  return maps.coarse.get(`${cell.signal_family}|${cell.direction}|${cell.horizon}`) || [];
}

function teacherGroupForCell(cell, maps) {
  if (cell.level === "L3") return maps.teacherExact.get(`${cell.teacher_id}|${cell.signal_definition_id}|${cell.horizon}`) || [];
  return maps.teacherCoarse.get(`${cell.teacher_id}|${cell.signal_family}|${cell.direction}|${cell.horizon}`) || [];
}

function buildPeerAggregate(cell, peerCandidateRows, asOfDate) {
  if (!peerCandidateRows.some(row => readyAsOf(row, asOfDate))) return null;
  const semantic = cell.level === "L3" ? cell.signal_definition_id : `${cell.signal_family}|${cell.direction}`;
  return aggregateCell(peerCandidateRows, {
    level: "PEER_BASELINE",
    cell_id: `LOTO|${cell.teacher_id}|${cell.level}|${semantic}|${cell.horizon}`,
    excluded_teacher_id: cell.teacher_id,
    signal_level: cell.level,
    signal_definition_id: cell.signal_definition_id || null,
    signal_family: cell.signal_family,
    direction: cell.direction,
    horizon: cell.horizon,
  }, asOfDate);
}

function alphaCellFromTeacherCell(cell, hierarchy, maps, asOfDate) {
  const allCandidates = candidateGroupForCell(cell, maps);
  const peerCandidates = allCandidates.filter(row => row.teacher_id !== cell.teacher_id);
  const peerReady = peerCandidates.filter(row => readyAsOf(row, asOfDate));
  const peer = buildPeerAggregate(cell, peerCandidates, asOfDate);
  const peerTeacherCount = new Set(peerReady.map(row => row.teacher_id)).size;
  const quality = peerQuality(peer, peerTeacherCount);
  const allBaseline = allBaselineForCell(hierarchy, cell);
  const teacherConcentration = Math.max(cell.top_ticker_share, cell.largest_date_concentration);
  const peerConcentration = peer ? Math.max(peer.top_ticker_share, peer.largest_date_concentration) : null;
  const peerClusterShare = maximumShare(peerReady, row => `${row.ticker}|${row.event_date}|${cell.direction}`);
  const medianDelta = peer ? round(cell.median_directional_return_pct - peer.median_directional_return_pct) : null;
  const meanDelta = peer ? round(cell.mean_directional_return_pct - peer.mean_directional_return_pct) : null;
  const hitDelta = peer ? round(cell.directional_hit_rate - peer.directional_hit_rate) : null;
  const result = {
    alpha_cell_id: `ALPHA|${cell.cell_id}`,
    teacher_id: cell.teacher_id,
    teacher_name: cell.teacher_name,
    signal_level: cell.level,
    signal_definition_id: cell.signal_definition_id || null,
    signal_name: cell.signal_name || null,
    signal_family: cell.signal_family,
    direction: cell.direction,
    horizon: cell.horizon,
    as_of_date: asOfDate,
    teacher_n: cell.n,
    teacher_unique_tickers: cell.unique_tickers,
    teacher_unique_dates: cell.unique_event_dates,
    teacher_top_ticker_share: cell.top_ticker_share,
    teacher_largest_date_share: cell.largest_date_concentration,
    teacher_mean_directional_return_pct: cell.mean_directional_return_pct,
    teacher_median_directional_return_pct: cell.median_directional_return_pct,
    teacher_directional_hit_rate: cell.directional_hit_rate,
    teacher_mean_directional_mfe_pct: cell.mean_directional_mfe_pct,
    teacher_median_directional_mfe_pct: cell.median_directional_mfe_pct,
    teacher_mean_directional_mae_pct: cell.mean_directional_mae_pct,
    teacher_median_directional_mae_pct: cell.median_directional_mae_pct,
    teacher_sample_state: cell.sufficiency.status,
    teacher_sample_supported: cell.sufficiency.supported,
    teacher_outlier_sensitive: cell.outlier_sensitive,
    peer_n: peer?.n || 0,
    peer_teacher_count: peerTeacherCount,
    peer_unique_tickers: peer?.unique_tickers || 0,
    peer_unique_dates: peer?.unique_event_dates || 0,
    peer_top_ticker_share: peer?.top_ticker_share ?? null,
    peer_largest_date_share: peer?.largest_date_concentration ?? null,
    peer_same_ticker_date_direction_share: peerClusterShare,
    peer_mean_directional_return_pct: peer?.mean_directional_return_pct ?? null,
    peer_median_directional_return_pct: peer?.median_directional_return_pct ?? null,
    peer_directional_hit_rate: peer?.directional_hit_rate ?? null,
    peer_mean_directional_mfe_pct: peer?.mean_directional_mfe_pct ?? null,
    peer_median_directional_mfe_pct: peer?.median_directional_mfe_pct ?? null,
    peer_mean_directional_mae_pct: peer?.mean_directional_mae_pct ?? null,
    peer_median_directional_mae_pct: peer?.median_directional_mae_pct ?? null,
    peer_sample_state: peer?.sufficiency.status || "NO_BASELINE",
    peer_baseline_quality: quality,
    peer_outlier_sensitive: peer?.outlier_sensitive || false,
    mean_directional_return_delta_pct: meanDelta,
    median_directional_return_delta_pct: medianDelta,
    directional_hit_rate_delta: hitDelta,
    mean_directional_mfe_delta_pct: peer ? round(cell.mean_directional_mfe_pct - peer.mean_directional_mfe_pct) : null,
    median_directional_mfe_delta_pct: peer ? round(cell.median_directional_mfe_pct - peer.median_directional_mfe_pct) : null,
    mean_directional_mae_delta_pct: peer ? round(cell.mean_directional_mae_pct - peer.mean_directional_mae_pct) : null,
    median_directional_mae_delta_pct: peer ? round(cell.median_directional_mae_pct - peer.median_directional_mae_pct) : null,
    benchmark_excess_delta_status: "UNAVAILABLE_INPUT",
    all_teacher_baseline_n: allBaseline?.n || 0,
    all_teacher_baseline_median_directional_return_pct: allBaseline?.median_directional_return_pct ?? null,
    all_teacher_baseline_hit_rate: allBaseline?.directional_hit_rate ?? null,
    all_teacher_vs_loto_median_difference_pct: peer && allBaseline ? round(allBaseline.median_directional_return_pct - peer.median_directional_return_pct) : null,
    all_teacher_vs_loto_hit_rate_difference: peer && allBaseline ? round(allBaseline.directional_hit_rate - peer.directional_hit_rate) : null,
    concentration_state: teacherConcentration >= 0.5 || (peerConcentration != null && peerConcentration >= 0.5) || (peerClusterShare != null && peerClusterShare >= 0.5) ? "CONCENTRATION_SENSITIVE" : "NO_HIGH_CONCENTRATION",
    outlier_state: cell.outlier_sensitive || peer?.outlier_sensitive ? "OUTLIER_SENSITIVE" : "NO_OUTLIER_FLAG",
    horizon_consistency: "PENDING",
    signal_consistency: "PENDING",
    temporal_stability: { status: "PENDING" },
    edge_direction: "NOT_EVALUABLE",
    alpha_candidate_state: "PENDING",
    teacher_alpha_version: TEACHER_ALPHA_VERSION,
    peer_baseline_version: PEER_BASELINE_VERSION,
    scorecard_version: HIERARCHICAL_SCORECARD_VERSION,
    sufficiency_rule_version: SUFFICIENCY_RULE_VERSION,
    underlying_teacher_outcome_ids: cell.observation_refs.map(row => row.outcome_identity),
    peer_baseline_outcome_ids: peer?.observation_refs.map(row => row.outcome_identity) || [],
    underlying_teacher_observations: cell.observation_refs,
    peer_baseline_observations: peer?.observation_refs || [],
    peer_baseline_identity: peer ? sha256({
      version: PEER_BASELINE_VERSION,
      excluded_teacher_id: cell.teacher_id,
      signal_level: cell.level,
      semantic: cell.level === "L3" ? cell.signal_definition_id : `${cell.signal_family}|${cell.direction}`,
      horizon: cell.horizon,
      as_of_date: asOfDate,
      outcome_ids: peer.observation_refs.map(row => row.outcome_identity),
    }) : null,
  };
  result.edge_direction = peer ? edgeDirection(result) : "NOT_EVALUABLE";
  return result;
}

function horizonGroupKey(cell) {
  const semantic = cell.signal_level === "L3" ? cell.signal_definition_id : `${cell.signal_family}|${cell.direction}`;
  return `${cell.teacher_id}|${cell.signal_level}|${semantic}`;
}

function horizonConsistency(cells) {
  const evaluable = cells
    .filter(cell => cell.teacher_sample_supported && cell.peer_baseline_quality.supported)
    .sort((left, right) => HORIZON_ORDER.get(left.horizon) - HORIZON_ORDER.get(right.horizon));
  const adjacent = evaluable.some((cell, index) => index > 0 && HORIZON_ORDER.get(cell.horizon) - HORIZON_ORDER.get(evaluable[index - 1].horizon) === 1);
  if (evaluable.length < 2 || !adjacent) return { status: "INSUFFICIENT", usable: false, horizons: evaluable.map(row => row.horizon) };
  const signs = evaluable.map(cell => Math.sign(cell.median_directional_return_delta_pct));
  const positives = evaluable.filter(cell => cell.median_directional_return_delta_pct > 0);
  const negatives = evaluable.filter(cell => cell.median_directional_return_delta_pct < 0);
  let status = "MIXED";
  if (positives.length === evaluable.length) status = "CONSISTENT_POSITIVE";
  else if (negatives.length === evaluable.length) status = "CONSISTENT_NEGATIVE";
  else {
    const short = evaluable.filter(cell => ["1D", "3D", "5D"].includes(cell.horizon));
    const long = evaluable.filter(cell => ["20D", "60D", "120D", "250D"].includes(cell.horizon));
    if (short.length && long.length && short.some(cell => cell.median_directional_return_delta_pct > 0) && !long.some(cell => cell.median_directional_return_delta_pct > 0)) status = "SHORT_TERM_ONLY";
    else if (short.length && long.length && long.some(cell => cell.median_directional_return_delta_pct > 0) && !short.some(cell => cell.median_directional_return_delta_pct > 0)) status = "LONG_TERM_ONLY";
    else if (positives.length && negatives.length) status = "SIGN_REVERSAL";
  }
  return {
    status,
    usable: true,
    horizons: evaluable.map(row => row.horizon),
    median_deltas: evaluable.map(row => row.median_directional_return_delta_pct),
    signs,
  };
}

function applyHorizonConsistency(cells) {
  const groups = groupRows(cells, horizonGroupKey);
  const profiles = [];
  for (const [groupId, rows] of groups) {
    const profile = { group_id: groupId, ...horizonConsistency(rows) };
    profiles.push(profile);
    for (const row of rows) row.horizon_consistency = profile.status;
  }
  return profiles.sort((a, b) => a.group_id.localeCompare(b.group_id));
}

function signalConsistencyForGroup(cells) {
  const evaluable = cells.filter(cell => cell.teacher_sample_supported && cell.peer_baseline_quality.supported);
  const definitions = new Set(evaluable.map(cell => cell.signal_definition_id));
  if (definitions.size < 2) return { status: "INSUFFICIENT", represented_signals: [...definitions] };
  const positive = evaluable.filter(cell => cell.edge_direction === "POSITIVE_BOTH");
  const negative = evaluable.filter(cell => cell.edge_direction === "NEGATIVE_BOTH");
  let status = "MIXED";
  if (positive.length >= 2 && !negative.length) status = "BROAD_POSITIVE";
  else if (negative.length >= 2 && !positive.length) status = "BROAD_NEGATIVE";
  else if (positive.length && negative.length) status = "MIXED";
  else if (positive.length === 1 || negative.length === 1) status = "SIGNAL_SPECIFIC";
  return { status, represented_signals: [...definitions].sort() };
}

function applySignalConsistency(cells) {
  const l3 = cells.filter(cell => cell.signal_level === "L3");
  const groups = groupRows(l3, cell => `${cell.teacher_id}|${cell.signal_family}|${cell.direction}|${cell.horizon}`);
  const profiles = [];
  for (const [groupId, rows] of groups) {
    const profile = { group_id: groupId, ...signalConsistencyForGroup(rows) };
    profiles.push(profile);
    for (const row of rows) row.signal_consistency = profile.status;
  }
  for (const row of cells.filter(cell => cell.signal_level === "L2")) row.signal_consistency = "COARSE_LEVEL_NOT_APPLICABLE";
  return profiles.sort((a, b) => a.group_id.localeCompare(b.group_id));
}

function temporalStability(cell, maps, asOfDate) {
  if (!cell.teacher_sample_supported || !cell.peer_baseline_quality.supported) {
    return { status: "TEMPORAL_STABILITY_UNAVAILABLE", reason: "PRIMARY_SAMPLE_OR_PEER_GATE" };
  }
  const teacherRows = teacherGroupForCell(cell, maps).filter(row => readyAsOf(row, asOfDate)).sort((left, right) => {
    return left.event_date.localeCompare(right.event_date) || outcomeIdentity(left).localeCompare(outcomeIdentity(right));
  });
  if (teacherRows.length < 20) return { status: "TEMPORAL_STABILITY_UNAVAILABLE", reason: "TEACHER_N_LT_20" };
  const splitAt = Math.floor(teacherRows.length / 2);
  const halves = [teacherRows.slice(0, splitAt), teacherRows.slice(splitAt)];
  const allPeerCandidates = candidateGroupForCell(cell, maps).filter(row => row.teacher_id !== cell.teacher_id);
  const results = [];
  for (const [index, half] of halves.entries()) {
    const start = half[0].event_date;
    const end = half.at(-1).event_date;
    const teacherAggregate = aggregateCell(half, { level: "TEMPORAL_TEACHER", cell_id: `${cell.alpha_cell_id}|${index}` }, asOfDate);
    const peerRange = allPeerCandidates.filter(row => row.event_date >= start && row.event_date <= end);
    const peerAggregate = buildPeerAggregate(cell, peerRange, asOfDate);
    const peerReady = peerRange.filter(row => readyAsOf(row, asOfDate));
    const quality = peerQuality(peerAggregate, new Set(peerReady.map(row => row.teacher_id)).size);
    if (!teacherAggregate?.sufficiency.supported || !quality.supported) {
      return { status: "TEMPORAL_STABILITY_UNAVAILABLE", reason: `HALF_${index + 1}_SAMPLE_OR_PEER_GATE`, early_n: halves[0].length, late_n: halves[1].length };
    }
    results.push({
      n: teacherAggregate.n,
      start,
      end,
      teacher_median: teacherAggregate.median_directional_return_pct,
      peer_n: peerAggregate.n,
      peer_median: peerAggregate.median_directional_return_pct,
      median_delta: round(teacherAggregate.median_directional_return_pct - peerAggregate.median_directional_return_pct),
    });
  }
  const earlySign = Math.sign(results[0].median_delta);
  const lateSign = Math.sign(results[1].median_delta);
  const status = earlySign && earlySign === lateSign ? (earlySign > 0 ? "BOTH_POSITIVE" : "BOTH_NEGATIVE") : "SIGN_REVERSAL";
  return { status, version: TEMPORAL_SPLIT_VERSION, early: results[0], late: results[1], same_sign: earlySign !== 0 && earlySign === lateSign };
}

function applyTemporalStability(cells, maps, asOfDate) {
  for (const cell of cells) cell.temporal_stability = temporalStability(cell, maps, asOfDate);
}

function classifyCandidate(cell) {
  if (!cell.teacher_sample_supported || !cell.peer_baseline_quality.supported) return "NOT_EVALUABLE";
  if (cell.concentration_state === "CONCENTRATION_SENSITIVE" || cell.outlier_state === "OUTLIER_SENSITIVE") return "OBSERVED_ONLY";
  if (cell.edge_direction === "NEGATIVE_BOTH") return "DESCRIPTIVE_NEGATIVE_EDGE_CANDIDATE";
  if (cell.edge_direction !== "POSITIVE_BOTH") return "OBSERVED_ONLY";
  const teacherModerate = SUFFICIENCY_ORDER.indexOf(cell.teacher_sample_state) >= SUFFICIENCY_ORDER.indexOf("MODERATE_EVIDENCE");
  const peerModerate = ["MODERATE_BASELINE", "STRONGER_BASELINE"].includes(cell.peer_baseline_quality.status);
  const horizonStrong = cell.horizon_consistency === "CONSISTENT_POSITIVE";
  const temporalStrong = cell.temporal_stability.status === "BOTH_POSITIVE";
  if (teacherModerate && peerModerate && horizonStrong && temporalStrong) return "STRONGER_RESEARCH_CANDIDATE";
  return "DESCRIPTIVE_POSITIVE_EDGE_CANDIDATE";
}

function teacherCoverageProfiles({ teacherRegistry, safeReadyRows, cells, hierarchy }) {
  const profiles = [];
  for (const teacher of teacherRegistry.teachers.filter(usableTeacher)) {
    const rows = safeReadyRows.filter(row => row.teacher_id === teacher.teacher_id);
    const teacherCells = cells.filter(row => row.teacher_id === teacher.teacher_id);
    const l3Fallback = hierarchy.fallback_resolutions.filter(row => row.requested_l3_cell_id?.startsWith(`L3|${teacher.teacher_id}|`));
    profiles.push({
      teacher_id: teacher.teacher_id,
      teacher_name: teacher.display_name,
      eligible_ready_outcomes: rows.length,
      unique_tickers: new Set(rows.map(row => row.ticker)).size,
      unique_dates: new Set(rows.map(row => row.event_date)).size,
      signal_definitions: [...new Set(rows.map(row => row.signal_definition_id))].sort(),
      horizons: [...new Set(rows.map(row => row.horizon))].sort((a, b) => HORIZON_ORDER.get(a) - HORIZON_ORDER.get(b)),
      sufficient_l3_cells: teacherCells.filter(row => row.signal_level === "L3" && row.teacher_sample_supported).length,
      resolved_l2_cells: l3Fallback.filter(row => row.resolved_level === "L2").length,
      resolved_l1_fallbacks: l3Fallback.filter(row => row.resolved_level === "L1").length,
      not_evaluable_cells: teacherCells.filter(row => row.alpha_candidate_state === "NOT_EVALUABLE").length,
      valid_alpha_cells: teacherCells.filter(row => !["NOT_EVALUABLE", "OBSERVED_ONLY"].includes(row.alpha_candidate_state)).length,
    });
  }
  return profiles.sort((a, b) => a.teacher_id.localeCompare(b.teacher_id));
}

function distribution(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

function selectPilotTeachers(profiles, count = 10) {
  const active = profiles.filter(row => row.eligible_ready_outcomes > 0).sort((a, b) => b.eligible_ready_outcomes - a.eligible_ready_outcomes || a.teacher_id.localeCompare(b.teacher_id));
  if (active.length <= count) return active.map(row => row.teacher_id);
  const positions = [0, 1, 2, 0.2, 0.35, 0.5, 0.65, 0.8, active.length - 2, active.length - 1]
    .map(value => Number.isInteger(value) ? value : Math.round((active.length - 1) * value));
  return [...new Set(positions.map(index => active[index].teacher_id))].slice(0, count);
}

function alphaSummary(dataset) {
  const cells = dataset.alpha_cells;
  const validBaseline = cells.filter(row => row.peer_n > 0);
  const bothGates = cells.filter(row => row.teacher_sample_supported && row.peer_baseline_quality.supported);
  const temporalAvailable = cells.filter(row => row.temporal_stability.status !== "TEMPORAL_STABILITY_UNAVAILABLE");
  const horizonUsable = cells.filter(row => row.horizon_consistency !== "INSUFFICIENT");
  const peerCounts = cells.map(row => row.peer_teacher_count).sort((a, b) => a - b);
  return {
    teacher_alpha_version: dataset.teacher_alpha_version,
    as_of_date: dataset.as_of_date,
    formal_ready_input: dataset.formal_ready_input,
    registry_safe_ready_input: dataset.registry_safe_ready_input,
    eligible_teachers: dataset.teacher_coverage_profiles.length,
    teachers_with_evaluable_cells: new Set(cells.filter(row => row.teacher_sample_supported && row.peer_baseline_quality.supported).map(row => row.teacher_id)).size,
    total_teacher_alpha_cells: cells.length,
    cells_by_level: distribution(cells.map(row => row.signal_level)),
    cells_with_valid_peer_baseline: validBaseline.length,
    cells_without_sufficient_peer_baseline: cells.filter(row => !row.peer_baseline_quality.supported).length,
    cells_both_sample_gates_pass: bothGates.length,
    both_gate_positive_median_delta_cells: bothGates.filter(row => row.median_directional_return_delta_pct > 0).length,
    both_gate_negative_median_delta_cells: bothGates.filter(row => row.median_directional_return_delta_pct < 0).length,
    both_gate_positive_hit_rate_delta_cells: bothGates.filter(row => row.directional_hit_rate_delta > 0).length,
    both_gate_negative_hit_rate_delta_cells: bothGates.filter(row => row.directional_hit_rate_delta < 0).length,
    both_gate_positive_both_cells: bothGates.filter(row => row.edge_direction === "POSITIVE_BOTH").length,
    both_gate_negative_both_cells: bothGates.filter(row => row.edge_direction === "NEGATIVE_BOTH").length,
    positive_median_delta_cells: validBaseline.filter(row => row.median_directional_return_delta_pct > 0).length,
    negative_median_delta_cells: validBaseline.filter(row => row.median_directional_return_delta_pct < 0).length,
    positive_hit_rate_delta_cells: validBaseline.filter(row => row.directional_hit_rate_delta > 0).length,
    negative_hit_rate_delta_cells: validBaseline.filter(row => row.directional_hit_rate_delta < 0).length,
    positive_both_cells: validBaseline.filter(row => row.edge_direction === "POSITIVE_BOTH").length,
    concentration_sensitive_cells: cells.filter(row => row.concentration_state === "CONCENTRATION_SENSITIVE").length,
    outlier_sensitive_cells: cells.filter(row => row.outlier_state === "OUTLIER_SENSITIVE").length,
    peer_teacher_count: {
      min: peerCounts[0] || 0,
      median: peerCounts.length ? peerCounts[Math.floor(peerCounts.length / 2)] : 0,
      max: peerCounts.at(-1) || 0,
      distribution: distribution(peerCounts.map(value => value === 0 ? "0" : value < 3 ? "1-2" : value < 8 ? "3-7" : value < 15 ? "8-14" : "15+")),
    },
    horizon_consistency_states: distribution(dataset.horizon_profiles.map(row => row.status)),
    cells_with_usable_horizon_consistency: horizonUsable.length,
    temporal_stability_tests: temporalAvailable.length,
    temporal_same_sign: temporalAvailable.filter(row => row.temporal_stability.same_sign).length,
    temporal_sign_reversal: temporalAvailable.filter(row => row.temporal_stability.status === "SIGN_REVERSAL").length,
    temporal_unavailable: cells.length - temporalAvailable.length,
    alpha_candidate_state_distribution: distribution(cells.map(row => row.alpha_candidate_state)),
    signal_consistency_states: distribution(dataset.signal_consistency_profiles.map(row => row.status)),
    duplicate_alpha_cells: dataset.duplicate_alpha_cells.length,
    anomalies: dataset.anomalies.length,
    semantic_hash: dataset.semantic_hash,
  };
}

function buildTeacherAlpha({ outcomeStore, teacherRegistry, signalRegistry, hierarchy, asOfDate }) {
  if (hierarchy.scorecard_version !== HIERARCHICAL_SCORECARD_VERSION) throw new Error(`Unsupported Scorecard version ${hierarchy.scorecard_version}`);
  if (hierarchy.sufficiency_rule_version !== SUFFICIENCY_RULE_VERSION) throw new Error(`Unsupported Sufficiency version ${hierarchy.sufficiency_rule_version}`);
  if (hierarchy.as_of_date !== asOfDate) throw new Error("Hierarchy as_of mismatch");
  const teacherMap = new Map(teacherRegistry.teachers.map(row => [row.teacher_id, row]));
  const signalMap = new Map(signalRegistry.definitions.map(row => [row.signal_id, row]));
  const safeCandidateRows = outcomeStore.outcomes.filter(row => usableTeacher(teacherMap.get(row.teacher_id)) && alphaEligibleSignal(signalMap.get(row.signal_definition_id)));
  const safeReadyRows = safeCandidateRows.filter(row => readyAsOf(row, asOfDate));
  const maps = {
    exact: groupRows(safeCandidateRows, exactKey),
    coarse: groupRows(safeCandidateRows, row => coarseKey(row, signalMap)),
    teacherExact: groupRows(safeCandidateRows, teacherExactKey),
    teacherCoarse: groupRows(safeCandidateRows, row => teacherCoarseKey(row, signalMap)),
  };
  const eligibleL3 = hierarchy.hierarchy.l3.filter(cell => ["BULLISH", "BEARISH"].includes(cell.direction));
  const eligibleL2 = hierarchy.hierarchy.l2.filter(cell => ["BULLISH", "BEARISH"].includes(cell.direction));
  const cells = [...eligibleL3, ...eligibleL2].map(cell => alphaCellFromTeacherCell(cell, hierarchy, maps, asOfDate));
  const horizonProfiles = applyHorizonConsistency(cells);
  const signalConsistencyProfiles = applySignalConsistency(cells);
  applyTemporalStability(cells, maps, asOfDate);
  for (const cell of cells) cell.alpha_candidate_state = classifyCandidate(cell);
  cells.sort((a, b) => a.alpha_cell_id.localeCompare(b.alpha_cell_id));
  const identities = countBy(cells, row => row.alpha_cell_id);
  const duplicateAlphaCells = [...identities.entries()].filter(([, count]) => count > 1).map(([alpha_cell_id, count]) => ({ alpha_cell_id, count }));
  const anomalies = [];
  for (const cell of cells) {
    if (cell.peer_baseline_outcome_ids.some(id => cell.underlying_teacher_outcome_ids.includes(id))) anomalies.push({ alpha_cell_id: cell.alpha_cell_id, reason: "SELF_INCLUDED_IN_PEER_BASELINE" });
    if (cell.peer_n !== cell.peer_baseline_outcome_ids.length) anomalies.push({ alpha_cell_id: cell.alpha_cell_id, reason: "PEER_TRACE_COUNT_MISMATCH" });
    if (cell.teacher_n !== cell.underlying_teacher_outcome_ids.length) anomalies.push({ alpha_cell_id: cell.alpha_cell_id, reason: "TEACHER_TRACE_COUNT_MISMATCH" });
  }
  const provisional = {
    artifact_id: `W01_V18_TEACHER_ALPHA_RESEARCH_${asOfDate}`,
    teacher_alpha_version: TEACHER_ALPHA_VERSION,
    peer_baseline_version: PEER_BASELINE_VERSION,
    temporal_split_version: TEMPORAL_SPLIT_VERSION,
    scorecard_version: HIERARCHICAL_SCORECARD_VERSION,
    sufficiency_rule_version: SUFFICIENCY_RULE_VERSION,
    outcome_calculation_version: outcomeStore.calculation_version,
    as_of_date: asOfDate,
    formal_ready_input: outcomeStore.outcomes.filter(row => row.outcome_status === "READY").length,
    registry_safe_ready_input: hierarchy.registry_safe_ready_input,
    alpha_eligible_ready_input: safeReadyRows.length,
    alpha_ineligible_ready_input: hierarchy.registry_safe_ready_input - safeReadyRows.length,
    alpha_cells: cells,
    horizon_profiles: horizonProfiles,
    signal_consistency_profiles: signalConsistencyProfiles,
    teacher_coverage_profiles: [],
    duplicate_alpha_cells: duplicateAlphaCells,
    anomalies,
    input_hashes: {
      outcome: outcomeStore.semantic_hash,
      outcome_calculation_version: outcomeStore.calculation_version,
      hierarchy: hierarchy.semantic_hash,
      scorecard_version: hierarchy.scorecard_version,
      sufficiency_rule_version: hierarchy.sufficiency_rule_version,
      teacher_registry: sha256(teacherRegistry),
      signal_registry: sha256(signalRegistry),
      dependency_index_version: ALPHA_INCREMENTAL_INDEX_VERSION,
    },
  };
  provisional.teacher_coverage_profiles = teacherCoverageProfiles({ teacherRegistry, safeReadyRows, cells, hierarchy });
  provisional.hashes = {
    alpha_cells: sha256(cells),
    horizon_profiles: sha256(horizonProfiles),
    signal_consistency_profiles: sha256(signalConsistencyProfiles),
    teacher_coverage_profiles: sha256(provisional.teacher_coverage_profiles),
  };
  provisional.semantic_hash = sha256({
    teacher_alpha_version: TEACHER_ALPHA_VERSION,
    peer_baseline_version: PEER_BASELINE_VERSION,
    as_of_date: asOfDate,
    outcome_hash: outcomeStore.semantic_hash,
    hierarchy_hash: hierarchy.semantic_hash,
    hashes: provisional.hashes,
  });
  provisional.summary = alphaSummary(provisional);
  return provisional;
}

function incrementalUpdateTeacherAlpha(previous, { outcomeStore, teacherRegistry, signalRegistry, hierarchy, asOfDate }, changedOutcomeRows) {
  const profileStarted = performance.now();
  let profileMark = profileStarted;
  const phaseMs = {};
  const mark = name => {
    const current = performance.now();
    phaseMs[name] = round(current - profileMark, 3);
    profileMark = current;
  };
  if (previous.teacher_alpha_version !== TEACHER_ALPHA_VERSION) throw new Error(`Unsupported Alpha version ${previous.teacher_alpha_version}`);
  if (hierarchy.scorecard_version !== HIERARCHICAL_SCORECARD_VERSION) throw new Error(`Unsupported Scorecard version ${hierarchy.scorecard_version}`);
  if (hierarchy.sufficiency_rule_version !== SUFFICIENCY_RULE_VERSION) throw new Error(`Unsupported Sufficiency version ${hierarchy.sufficiency_rule_version}`);
  if (previous.as_of_date !== asOfDate || hierarchy.as_of_date !== asOfDate) throw new Error("Alpha/Hierarchy as_of mismatch");
  const changedRows = changedOutcomeRows || [];
  const inputHashes = {
    outcome: outcomeStore.semantic_hash,
    outcome_calculation_version: outcomeStore.calculation_version,
    hierarchy: hierarchy.semantic_hash,
    scorecard_version: hierarchy.scorecard_version,
    sufficiency_rule_version: hierarchy.sufficiency_rule_version,
    teacher_registry: sha256(teacherRegistry),
    signal_registry: sha256(signalRegistry),
    dependency_index_version: ALPHA_INCREMENTAL_INDEX_VERSION,
  };
  // The caller's changed-row contract is the incremental checkpoint boundary.  With the
  // same as-of and compatible versions, an empty delta must not scan or rebuild Alpha.
  if (!changedRows.length && stableStringify(previous.input_hashes) === stableStringify(inputHashes)) {
    return {
      dataset: previous,
      scanned_outcomes: 0,
      recomputed_raw_cell_ids: [],
      recomputed_raw_cells: 0,
      recomputed_temporal_cell_ids: [],
      recomputed_temporal_cells: 0,
      changed_cell_ids: [],
      dependency_index: { exact_keys: 0, coarse_keys: 0, temporal_keys: 0, alpha_cells: previous.alpha_cells.length, zero_delta_fast_path: true },
      performance_profile: { phase_ms: { zero_delta_validation: round(performance.now() - profileStarted, 3) }, total_ms: round(performance.now() - profileStarted, 3) },
    };
  }
  if (!changedRows.length) {
    const dataset = buildTeacherAlpha({ outcomeStore, teacherRegistry, signalRegistry, hierarchy, asOfDate });
    return {
      dataset,
      scanned_outcomes: outcomeStore.outcomes.length,
      recomputed_raw_cell_ids: dataset.alpha_cells.map(row => row.alpha_cell_id),
      recomputed_raw_cells: dataset.alpha_cells.length,
      recomputed_temporal_cell_ids: dataset.alpha_cells.map(row => row.alpha_cell_id),
      recomputed_temporal_cells: dataset.alpha_cells.length,
      changed_cell_ids: dataset.alpha_cells.map(row => row.alpha_cell_id),
      dependency_index: { exact_keys: 0, coarse_keys: 0, temporal_keys: 0, alpha_cells: dataset.alpha_cells.length, zero_delta_fast_path: false, fallback_reason: "INCOMPATIBLE_OR_MISSING_INPUT_FINGERPRINT" },
      performance_profile: { phase_ms: { full_fallback: round(performance.now() - profileStarted, 3) }, total_ms: round(performance.now() - profileStarted, 3) },
    };
  }
  const teacherMap = new Map(teacherRegistry.teachers.map(row => [row.teacher_id, row]));
  const signalMap = new Map(signalRegistry.definitions.map(row => [row.signal_id, row]));
  const safeCandidateRows = outcomeStore.outcomes.filter(row => usableTeacher(teacherMap.get(row.teacher_id)) && alphaEligibleSignal(signalMap.get(row.signal_definition_id)));
  const safeReadyRows = safeCandidateRows.filter(row => readyAsOf(row, asOfDate));
  mark("outcome_selection");
  const maps = {
    exact: groupRows(safeCandidateRows, exactKey),
    coarse: groupRows(safeCandidateRows, row => coarseKey(row, signalMap)),
    teacherExact: groupRows(safeCandidateRows, teacherExactKey),
    teacherCoarse: groupRows(safeCandidateRows, row => teacherCoarseKey(row, signalMap)),
  };
  mark("group_index_build");
  const hierarchyCells = [...hierarchy.hierarchy.l3, ...hierarchy.hierarchy.l2]
    .filter(cell => ["BULLISH", "BEARISH"].includes(cell.direction));
  const hierarchyByAlphaId = new Map(hierarchyCells.map(cell => [`ALPHA|${cell.cell_id}`, cell]));
  const exactAlphaIds = new Map();
  const coarseAlphaIds = new Map();
  const temporalAlphaIds = new Map();
  function addIndex(index, key, id) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(id);
  }
  for (const cell of hierarchyCells) {
    const id = `ALPHA|${cell.cell_id}`;
    const coarse = `${cell.signal_family}|${cell.direction}|${cell.horizon}`;
    if (cell.level === "L3") addIndex(exactAlphaIds, `${cell.signal_definition_id}|${cell.horizon}`, id);
    else addIndex(coarseAlphaIds, coarse, id);
    // Temporal stability intentionally depends on the coarse family pool for both levels.
    addIndex(temporalAlphaIds, coarse, id);
  }
  mark("dependency_index_build");
  const rawIds = new Set();
  const temporalIds = new Set();
  for (const changed of changedRows) {
    const signal = signalMap.get(changed.signal_definition_id);
    if (!signal || !alphaEligibleSignal(signal)) continue;
    for (const id of exactAlphaIds.get(`${changed.signal_definition_id}|${changed.horizon}`) || []) rawIds.add(id);
    const coarse = `${signal.signal_family}|${signal.direction}|${changed.horizon}`;
    for (const id of coarseAlphaIds.get(coarse) || []) rawIds.add(id);
    for (const id of temporalAlphaIds.get(coarse) || []) temporalIds.add(id);
  }
  mark("invalidation_discovery");
  // Structural sharing is safe because only invalidated/cascade cells are shallow-cloned
  // before mutation.  The large evidence arrays in unrelated cells stay immutable and are
  // not serialized/deserialized merely to discover that they did not change.
  const previousMap = new Map(previous.alpha_cells.map(cell => [cell.alpha_cell_id, cell]));
  const previousIds = new Set(previousMap.keys());
  const removedIds = [...previousIds].filter(id => !hierarchyByAlphaId.has(id));
  for (const id of removedIds) previousMap.delete(id);
  for (const id of rawIds) {
    const cell = hierarchyByAlphaId.get(id);
    if (cell) previousMap.set(id, alphaCellFromTeacherCell(cell, hierarchy, maps, asOfDate));
    else previousMap.delete(id);
  }
  mark("raw_and_loto_recompute");
  // Include genuinely new eligible hierarchy cells even when they were absent from the prior dataset.
  for (const [id, cell] of hierarchyByAlphaId) {
    if (!previousMap.has(id)) {
      rawIds.add(id);
      temporalIds.add(id);
      previousMap.set(id, alphaCellFromTeacherCell(cell, hierarchy, maps, asOfDate));
    }
  }
  mark("new_cell_reconcile");
  let cells = [...previousMap.values()].sort((a, b) => a.alpha_cell_id.localeCompare(b.alpha_cell_id));
  const cellById = new Map(cells.map(cell => [cell.alpha_cell_id, cell]));
  const rawCells = [...rawIds].map(id => cellById.get(id)).filter(Boolean);
  const horizonGroups = groupRows(cells, horizonGroupKey);
  const affectedHorizonGroups = new Set(rawCells.map(horizonGroupKey));
  const signalGroupKey = cell => `${cell.teacher_id}|${cell.signal_family}|${cell.direction}|${cell.horizon}`;
  const signalGroups = groupRows(cells.filter(cell => cell.signal_level === "L3"), signalGroupKey);
  const affectedSignalGroups = new Set(rawCells.filter(cell => cell.signal_level === "L3").map(signalGroupKey));
  const cascadeIds = new Set([...rawIds, ...temporalIds]);
  for (const key of affectedHorizonGroups) for (const cell of horizonGroups.get(key) || []) cascadeIds.add(cell.alpha_cell_id);
  for (const key of affectedSignalGroups) for (const cell of signalGroups.get(key) || []) cascadeIds.add(cell.alpha_cell_id);
  // Clone only cells whose derived state can change; large trace arrays remain shared.
  for (const id of cascadeIds) {
    if (!rawIds.has(id) && cellById.has(id)) cellById.set(id, { ...cellById.get(id) });
  }
  mark("cascade_clone");
  cells = [...cellById.values()].sort((a, b) => a.alpha_cell_id.localeCompare(b.alpha_cell_id));
  const refreshedHorizonGroups = groupRows(cells, horizonGroupKey);
  const horizonProfileMap = new Map(previous.horizon_profiles.map(profile => [profile.group_id, profile]));
  for (const key of [...horizonProfileMap.keys()]) if (!refreshedHorizonGroups.has(key)) horizonProfileMap.delete(key);
  for (const key of affectedHorizonGroups) {
    const rows = refreshedHorizonGroups.get(key) || [];
    if (!rows.length) { horizonProfileMap.delete(key); continue; }
    const profile = { group_id: key, ...horizonConsistency(rows) };
    horizonProfileMap.set(key, profile);
    for (const row of rows) row.horizon_consistency = profile.status;
  }
  const horizonProfiles = [...horizonProfileMap.values()].sort((a, b) => a.group_id.localeCompare(b.group_id));
  mark("horizon_consistency");
  const refreshedSignalGroups = groupRows(cells.filter(cell => cell.signal_level === "L3"), signalGroupKey);
  const signalProfileMap = new Map(previous.signal_consistency_profiles.map(profile => [profile.group_id, profile]));
  for (const key of [...signalProfileMap.keys()]) if (!refreshedSignalGroups.has(key)) signalProfileMap.delete(key);
  for (const key of affectedSignalGroups) {
    const rows = refreshedSignalGroups.get(key) || [];
    if (!rows.length) { signalProfileMap.delete(key); continue; }
    const profile = { group_id: key, ...signalConsistencyForGroup(rows) };
    signalProfileMap.set(key, profile);
    for (const row of rows) row.signal_consistency = profile.status;
  }
  for (const row of cells) {
    if (row.signal_level === "L2" && cascadeIds.has(row.alpha_cell_id)) row.signal_consistency = "COARSE_LEVEL_NOT_APPLICABLE";
  }
  const signalConsistencyProfiles = [...signalProfileMap.values()].sort((a, b) => a.group_id.localeCompare(b.group_id));
  mark("signal_consistency");
  // Temporal checks depend only on the changed cell's teacher sample and matching peer pool.
  // Unaffected cells retain their already-versioned temporal result; recomputing all cells made
  // a small weekly delta more expensive than a full research rebuild.
  applyTemporalStability(cells.filter(cell => temporalIds.has(cell.alpha_cell_id)), maps, asOfDate);
  mark("temporal_stability");
  for (const cell of cells) if (cascadeIds.has(cell.alpha_cell_id)) cell.alpha_candidate_state = classifyCandidate(cell);
  mark("candidate_classification");
  const identities = countBy(cells, row => row.alpha_cell_id);
  const duplicateAlphaCells = [...identities.entries()].filter(([, count]) => count > 1).map(([alpha_cell_id, count]) => ({ alpha_cell_id, count }));
  const anomalies = [];
  for (const cell of cells) {
    if (cell.peer_baseline_outcome_ids.some(id => cell.underlying_teacher_outcome_ids.includes(id))) anomalies.push({ alpha_cell_id: cell.alpha_cell_id, reason: "SELF_INCLUDED_IN_PEER_BASELINE" });
    if (cell.peer_n !== cell.peer_baseline_outcome_ids.length) anomalies.push({ alpha_cell_id: cell.alpha_cell_id, reason: "PEER_TRACE_COUNT_MISMATCH" });
    if (cell.teacher_n !== cell.underlying_teacher_outcome_ids.length) anomalies.push({ alpha_cell_id: cell.alpha_cell_id, reason: "TEACHER_TRACE_COUNT_MISMATCH" });
  }
  mark("integrity_checks");
  const dataset = {
    artifact_id: `W01_V18_TEACHER_ALPHA_RESEARCH_${asOfDate}`,
    teacher_alpha_version: TEACHER_ALPHA_VERSION,
    peer_baseline_version: PEER_BASELINE_VERSION,
    temporal_split_version: TEMPORAL_SPLIT_VERSION,
    scorecard_version: HIERARCHICAL_SCORECARD_VERSION,
    sufficiency_rule_version: SUFFICIENCY_RULE_VERSION,
    outcome_calculation_version: outcomeStore.calculation_version,
    as_of_date: asOfDate,
    formal_ready_input: outcomeStore.outcomes.filter(row => row.outcome_status === "READY").length,
    registry_safe_ready_input: hierarchy.registry_safe_ready_input,
    alpha_eligible_ready_input: safeReadyRows.length,
    alpha_ineligible_ready_input: hierarchy.registry_safe_ready_input - safeReadyRows.length,
    alpha_cells: cells,
    horizon_profiles: horizonProfiles,
    signal_consistency_profiles: signalConsistencyProfiles,
    teacher_coverage_profiles: [],
    duplicate_alpha_cells: duplicateAlphaCells,
    anomalies,
    input_hashes: inputHashes,
  };
  dataset.teacher_coverage_profiles = teacherCoverageProfiles({ teacherRegistry, safeReadyRows, cells, hierarchy });
  mark("teacher_coverage");
  dataset.hashes = {
    alpha_cells: sha256(cells),
    horizon_profiles: sha256(horizonProfiles),
    signal_consistency_profiles: sha256(signalConsistencyProfiles),
    teacher_coverage_profiles: sha256(dataset.teacher_coverage_profiles),
  };
  dataset.semantic_hash = sha256({
    teacher_alpha_version: TEACHER_ALPHA_VERSION,
    peer_baseline_version: PEER_BASELINE_VERSION,
    as_of_date: asOfDate,
    outcome_hash: outcomeStore.semantic_hash,
    hierarchy_hash: hierarchy.semantic_hash,
    hashes: dataset.hashes,
  });
  mark("serialization_hashing");
  dataset.summary = alphaSummary(dataset);
  mark("summary");
  const comparisonIds = new Set([...cascadeIds, ...removedIds]);
  // This is deliberately the dependency-complete invalidation manifest.  Re-serializing
  // both 100+ MB datasets merely to shrink this reporting list was the largest measured
  // incremental-only cost.  The canonical dataset hash below remains the exact semantic
  // verifier; the independent reference build is still used by the release gate.
  const changedCellIds = [...comparisonIds].sort();
  mark("semantic_diff");
  return {
    dataset,
    scanned_outcomes: safeCandidateRows.length,
    recomputed_raw_cell_ids: [...rawIds].sort(),
    recomputed_raw_cells: rawIds.size,
    recomputed_temporal_cell_ids: [...temporalIds].sort(),
    recomputed_temporal_cells: temporalIds.size,
    changed_cell_ids: changedCellIds,
    dependency_index: {
      exact_keys: exactAlphaIds.size,
      coarse_keys: coarseAlphaIds.size,
      temporal_keys: temporalAlphaIds.size,
      alpha_cells: hierarchyByAlphaId.size,
      zero_delta_fast_path: false,
    },
    performance_profile: { phase_ms: phaseMs, total_ms: round(performance.now() - profileStarted, 3) },
  };
}

function affectedAlphaKeys(changedOutcome, dataset, signalRegistry) {
  const signal = signalRegistry.definitions.find(row => row.signal_id === changedOutcome.signal_definition_id);
  if (!signal || !alphaEligibleSignal(signal)) return { direct: [], peer_baselines: [], all: [] };
  const exactSuffix = `|${changedOutcome.signal_definition_id}|${changedOutcome.horizon}`;
  const coarseSuffix = `|${signal.signal_family}|${signal.direction}|${changedOutcome.horizon}`;
  const direct = [
    `ALPHA|L3|${changedOutcome.teacher_id}|${changedOutcome.signal_definition_id}|${changedOutcome.horizon}`,
    `ALPHA|L2|${changedOutcome.teacher_id}|${signal.signal_family}|${signal.direction}|${changedOutcome.horizon}`,
  ];
  const peerBaselines = dataset.alpha_cells.filter(cell => cell.teacher_id !== changedOutcome.teacher_id && (
    (cell.signal_level === "L3" && cell.alpha_cell_id.endsWith(exactSuffix))
    || (cell.signal_level === "L2" && cell.alpha_cell_id.endsWith(coarseSuffix))
  )).map(cell => cell.alpha_cell_id);
  const raw = [...new Set([...direct, ...peerBaselines])].sort();
  const rawCells = dataset.alpha_cells.filter(cell => raw.includes(cell.alpha_cell_id));
  const horizonProfileGroups = [...new Set(rawCells.map(horizonGroupKey))].sort();
  const signalProfileGroups = [...new Set(rawCells.filter(cell => cell.signal_level === "L3").map(cell => `${cell.teacher_id}|${cell.signal_family}|${cell.direction}|${cell.horizon}`))].sort();
  const cascadeCells = dataset.alpha_cells.filter(cell => {
    if (horizonProfileGroups.includes(horizonGroupKey(cell))) return true;
    return cell.signal_level === "L3" && signalProfileGroups.includes(`${cell.teacher_id}|${cell.signal_family}|${cell.direction}|${cell.horizon}`);
  }).map(cell => cell.alpha_cell_id);
  return {
    direct: [...new Set(direct)].sort(),
    peer_baselines: [...new Set(peerBaselines)].sort(),
    raw_alpha_cells: raw,
    horizon_profile_groups: horizonProfileGroups,
    signal_profile_groups: signalProfileGroups,
    all: [...new Set([...raw, ...cascadeCells])].sort(),
  };
}

function semanticCellMap(dataset) {
  return new Map(dataset.alpha_cells.map(cell => [cell.alpha_cell_id, stableStringify(cell)]));
}

module.exports = {
  TEACHER_ALPHA_VERSION,
  PEER_BASELINE_VERSION,
  TEMPORAL_SPLIT_VERSION,
  ALPHA_INCREMENTAL_INDEX_VERSION,
  alphaEligibleSignal,
  peerQuality,
  horizonConsistency,
  buildTeacherAlpha,
  incrementalUpdateTeacherAlpha,
  alphaSummary,
  selectPilotTeachers,
  affectedAlphaKeys,
  semanticCellMap,
  stableStringify,
  sha256,
};
