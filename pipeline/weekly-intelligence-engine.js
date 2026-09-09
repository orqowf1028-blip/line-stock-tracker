"use strict";

const crypto = require("node:crypto");
const {
  affectedHierarchyKeys,
} = require("./hierarchical-scorecard-engine");
const {
  affectedAlphaKeys,
} = require("./teacher-alpha-engine");

const V19_VERSION = "W01_WEEKLY_INTELLIGENCE_V0.1.0-CANDIDATE";
const MATURITY_MONITOR_VERSION = "W01_RESEARCH_MATURITY_MONITOR_V0.1.0-CANDIDATE";
const CANONICAL_CONTRACT = "W01_V1.4_WEEKLY_RECONCILIATION";

const HEALTH = Object.freeze({
  HEALTHY: "HEALTHY",
  HEALTHY_NO_CHANGE: "HEALTHY_NO_CHANGE",
  DEGRADED_EXTERNAL: "DEGRADED_EXTERNAL",
  HEALTHY_WITH_STALE_AFFECTED_SUBSET: "HEALTHY_WITH_STALE_AFFECTED_SUBSET",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  BLOCKED_CORRECTNESS: "BLOCKED_CORRECTNESS",
});

const EXPECTED_VERSIONS = Object.freeze({
  canonical_contract: CANONICAL_CONTRACT,
  outcome_calculation_version: "W01_OUTCOME_V1.0.0-SHADOW",
  scorecard_version: "W01_SCORECARD_V1.1.0-CANDIDATE",
  sufficiency_rule_version: "W01_SUFFICIENCY_V1.0.0-CANDIDATE",
  teacher_alpha_version: "W01_TEACHER_ALPHA_V0.1.0-RESEARCH",
  peer_baseline_version: "W01_LOTO_PEER_BASELINE_V0.1.0-RESEARCH",
  maturity_monitor_version: MATURITY_MONITOR_VERSION,
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  const payload = Buffer.isBuffer(value) ? value : (typeof value === "string" ? value : stableStringify(value));
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function buildDependencyDag() {
  return {
    version: V19_VERSION,
    nodes: ["SOURCE_EVIDENCE", "CANONICAL", "OUTCOME", "SCORECARD", "TEACHER_ALPHA", "MATURITY_MONITOR", "CHECKPOINT"],
    edges: [
      { from: "SOURCE_EVIDENCE", to: "CANONICAL", invalidation_keys: ["evidence_id", "source_event_id", "correlation_key"] },
      { from: "CANONICAL", to: "OUTCOME", invalidation_keys: ["event_id", "calculation_fingerprint", "calculation_version"] },
      { from: "OUTCOME", to: "SCORECARD", invalidation_keys: ["event_id+horizon", "outcome_status", "directional_return_pct", "mfe_mae", "as_of"] },
      { from: "SCORECARD", to: "TEACHER_ALPHA", invalidation_keys: ["L2_cell_id", "L3_cell_id", "sufficiency_status", "scorecard_semantic_hash"] },
      { from: "OUTCOME", to: "TEACHER_ALPHA", invalidation_keys: ["teacher_id", "signal_semantic", "horizon", "LOTO_peer_membership"] },
      { from: "TEACHER_ALPHA", to: "MATURITY_MONITOR", invalidation_keys: ["alpha_semantic_hash", "sample_gate", "baseline_quality", "horizon_consistency", "temporal_stability"] },
      { from: "MATURITY_MONITOR", to: "CHECKPOINT", invalidation_keys: ["maturity_snapshot_id", "health_state", "walk_forward_readiness"] },
    ],
  };
}

function validateVersionCoherence(actual) {
  const mismatches = [];
  for (const [key, expected] of Object.entries(EXPECTED_VERSIONS)) {
    if (actual[key] !== expected) mismatches.push({ key, expected, actual: actual[key] ?? null });
  }
  return { status: mismatches.length ? HEALTH.BLOCKED_CORRECTNESS : HEALTH.HEALTHY, mismatches };
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row);
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function assessWalkForwardReadiness(metrics, alphaCells = []) {
  const stronger = alphaCells.filter(row => row.alpha_candidate_state === "STRONGER_RESEARCH_CANDIDATE");
  const strongerBaselineSafe = stronger.every(row => row.peer_baseline_quality?.supported === true);
  const strongerTemporalSafe = stronger.every(row => row.temporal_stability?.status === "BOTH_POSITIVE");
  const strongerHorizonSafe = stronger.every(row => row.horizon_consistency === "CONSISTENT_POSITIVE");
  const reasons = [];

  if (!metrics.stronger_candidate_count) {
    reasons.push("NO_STRONGER_RESEARCH_CANDIDATE");
    reasons.push(`DUAL_GATE_PASS_${metrics.dual_gate_pass_count}_OF_${metrics.alpha_cell_count}`);
    reasons.push(`EVALUABLE_TEACHERS_${metrics.evaluable_teacher_count}_OF_${metrics.eligible_teacher_count}`);
    return { state: "NOT_READY_SAMPLE", reasons, dimensions: { sample: false, baseline: metrics.valid_loto_baseline_cells > 0, temporal_depth: metrics.temporal_stability_eligible_count > 0, horizon_consistency: metrics.horizon_consistency_eligible_count > 0, teacher_coverage: metrics.evaluable_teacher_count > 0 } };
  }
  if (!strongerBaselineSafe || !metrics.valid_loto_baseline_cells) {
    reasons.push("STRONGER_CANDIDATE_LACKS_VALID_LOTO_BASELINE");
    return { state: "NOT_READY_BASELINE", reasons, dimensions: { sample: true, baseline: false, temporal_depth: strongerTemporalSafe, horizon_consistency: strongerHorizonSafe, teacher_coverage: true } };
  }
  if (!strongerTemporalSafe || !strongerHorizonSafe) {
    reasons.push("STRONGER_CANDIDATE_LACKS_TEMPORAL_OR_HORIZON_CONFIRMATION");
    return { state: "NOT_READY_TEMPORAL_DEPTH", reasons, dimensions: { sample: true, baseline: true, temporal_depth: strongerTemporalSafe, horizon_consistency: strongerHorizonSafe, teacher_coverage: true } };
  }
  const independentTeachers = new Set(stronger.map(row => row.teacher_id)).size;
  if (independentTeachers < 2) {
    reasons.push("ONLY_ONE_INDEPENDENT_TEACHER_HAS_STRONGER_CANDIDATE");
    return { state: "APPROACHING_READINESS", reasons, dimensions: { sample: true, baseline: true, temporal_depth: true, horizon_consistency: true, teacher_coverage: false } };
  }
  reasons.push("MULTI_TEACHER_STRONGER_CANDIDATES_PASS_EXISTING_V1_8_GATES");
  return { state: "READY_FOR_SHADOW_WALK_FORWARD", reasons, dimensions: { sample: true, baseline: true, temporal_depth: true, horizon_consistency: true, teacher_coverage: true } };
}

function buildMaturityMetrics({ canonicalCount, evidenceCount, outcomeStore, hierarchy, alpha }) {
  const alphaCells = alpha.alpha_cells || [];
  const alphaSummary = alpha.summary || {};
  const usableFallback = (hierarchy.fallback_resolutions || []).filter(row => row.resolved_level !== "OBSERVATION_ONLY").length;
  const fallbackTotal = (hierarchy.fallback_resolutions || []).length;
  const stronger = alphaCells.filter(row => row.alpha_candidate_state === "STRONGER_RESEARCH_CANDIDATE");
  return {
    canonical_count: canonicalCount,
    evidence_count: evidenceCount,
    outcome_count: outcomeStore.outcomes.length,
    ready_count: outcomeStore.outcomes.filter(row => row.outcome_status === "READY").length,
    registry_safe_ready: hierarchy.registry_safe_ready_input,
    l1_count: hierarchy.hierarchy.l1.length,
    l2_count: hierarchy.hierarchy.l2.length,
    l3_count: hierarchy.hierarchy.l3.length,
    hierarchical_usable_coverage: fallbackTotal ? Number((usableFallback / fallbackTotal * 100).toFixed(2)) : 0,
    alpha_cell_count: alphaCells.length,
    dual_gate_pass_count: alphaSummary.cells_both_sample_gates_pass || 0,
    positive_candidate_count: alphaCells.filter(row => row.alpha_candidate_state === "DESCRIPTIVE_POSITIVE_EDGE_CANDIDATE").length,
    negative_candidate_count: alphaCells.filter(row => row.alpha_candidate_state === "DESCRIPTIVE_NEGATIVE_EDGE_CANDIDATE").length,
    stronger_candidate_count: stronger.length,
    eligible_teacher_count: alphaSummary.eligible_teachers || 0,
    evaluable_teacher_count: alphaSummary.teachers_with_evaluable_cells || 0,
    horizon_consistency_eligible_count: alphaSummary.cells_with_usable_horizon_consistency || 0,
    temporal_stability_eligible_count: alphaSummary.temporal_stability_tests || 0,
    valid_loto_baseline_cells: alphaSummary.cells_with_valid_peer_baseline || 0,
    supported_loto_baseline_cells: alphaCells.filter(row => row.peer_baseline_quality?.supported).length,
    baseline_quality_distribution: countBy(alphaCells, row => row.peer_baseline_quality?.status || "UNKNOWN"),
    sample_sufficiency_distribution: countBy(alphaCells, row => row.teacher_sample_state || "UNKNOWN"),
    stronger_candidate_teacher_count: new Set(stronger.map(row => row.teacher_id)).size,
  };
}

function buildMaturitySnapshot({ runId, asOf, counts, artifacts, versions, healthState, stageHealth }) {
  const metrics = buildMaturityMetrics({
    canonicalCount: counts.canonical,
    evidenceCount: counts.evidence,
    outcomeStore: artifacts.outcomeStore,
    hierarchy: artifacts.hierarchy,
    alpha: artifacts.alpha,
  });
  const readiness = assessWalkForwardReadiness(metrics, artifacts.alpha.alpha_cells || []);
  const snapshotCore = {
    monitor_version: MATURITY_MONITOR_VERSION,
    run_id: runId,
    as_of: asOf,
    metrics,
    walk_forward_readiness: readiness,
    health_state: healthState,
    stage_health: stageHealth,
    calculation_versions: versions,
    input_hashes: {
      outcome: artifacts.outcomeStore.semantic_hash,
      scorecard: artifacts.hierarchy.semantic_hash,
      teacher_alpha: artifacts.alpha.semantic_hash,
    },
  };
  return { ...snapshotCore, maturity_snapshot_id: `W01-MAT-${sha256(snapshotCore).slice(0, 20)}` };
}

function maturityDelta(previous, current) {
  const keys = Object.keys(current.metrics);
  const numeric = {};
  for (const key of keys) {
    if (typeof current.metrics[key] === "number") numeric[key] = current.metrics[key] - (typeof previous?.metrics?.[key] === "number" ? previous.metrics[key] : current.metrics[key]);
  }
  return {
    comparison_basis: previous ? previous.maturity_snapshot_id || previous.run_id : "NO_PRIOR_V19_SNAPSHOT",
    numeric,
    readiness_from: previous?.walk_forward_readiness?.state || null,
    readiness_to: current.walk_forward_readiness.state,
    health_from: previous?.health_state || null,
    health_to: current.health_state,
  };
}

function accountingCheck(expected, actual) {
  const keys = [...new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])].sort();
  const mismatches = keys.filter(key => (expected?.[key] ?? 0) !== (actual?.[key] ?? 0)).map(key => ({ key, expected: expected?.[key] ?? 0, actual: actual?.[key] ?? 0 }));
  return { status: mismatches.length ? HEALTH.BLOCKED_CORRECTNESS : HEALTH.HEALTHY, mismatches };
}

function globalHealth(stageHealth, accounting, versionCoherence) {
  if (accounting.status === HEALTH.BLOCKED_CORRECTNESS || versionCoherence.status === HEALTH.BLOCKED_CORRECTNESS || Object.values(stageHealth).includes(HEALTH.BLOCKED_CORRECTNESS)) return HEALTH.BLOCKED_CORRECTNESS;
  if (Object.values(stageHealth).includes(HEALTH.REVIEW_REQUIRED)) return HEALTH.REVIEW_REQUIRED;
  if (Object.values(stageHealth).some(value => [HEALTH.DEGRADED_EXTERNAL, HEALTH.HEALTHY_WITH_STALE_AFFECTED_SUBSET].includes(value))) return HEALTH.DEGRADED_EXTERNAL;
  if (Object.values(stageHealth).every(value => value === HEALTH.HEALTHY_NO_CHANGE)) return HEALTH.HEALTHY_NO_CHANGE;
  return HEALTH.HEALTHY;
}

function deriveInvalidationPlan(changedOutcomes, signalRegistry, alphaDataset) {
  const hierarchy = { l1: new Set(), l1_coarse: new Set(), l2: new Set(), l3: new Set() };
  const alpha = { direct: new Set(), peer_baselines: new Set(), all: new Set() };
  for (const row of changedOutcomes || []) {
    const hierarchyKeys = affectedHierarchyKeys(row, signalRegistry);
    if (hierarchyKeys) for (const key of Object.keys(hierarchy)) hierarchy[key].add(hierarchyKeys[key]);
    const alphaKeys = affectedAlphaKeys(row, alphaDataset, signalRegistry);
    for (const key of alphaKeys.direct || []) alpha.direct.add(key);
    for (const key of alphaKeys.peer_baselines || []) alpha.peer_baselines.add(key);
    for (const key of alphaKeys.all || []) alpha.all.add(key);
  }
  return {
    hierarchy: Object.fromEntries(Object.entries(hierarchy).map(([key, value]) => [key, [...value].sort()])),
    alpha: Object.fromEntries(Object.entries(alpha).map(([key, value]) => [key, [...value].sort()])),
  };
}

function assertAsOfSafe(outcomes, asOf) {
  const future = (outcomes || []).filter(row => row.outcome_status === "READY" && row.actual_trading_date && row.actual_trading_date > asOf).map(row => `${row.event_id}|${row.horizon}`);
  return { status: future.length ? HEALTH.BLOCKED_CORRECTNESS : HEALTH.HEALTHY, future_ready_rows: future };
}

function buildW00Handoff(run) {
  return {
    contract_version: "W01_TO_W00_WEEKLY_HANDOFF_V0.1.0",
    w01_formal_version: "W01 v1.6 — Outcome Incremental Maturity & Update Monitor",
    candidate_version: "W01 v1.9 Candidate — Weekly Intelligence Pipeline & Research Maturity Monitor",
    weekly_run_status: run.global_health,
    canonical_delta: run.actual.canonical,
    evidence_delta: run.actual.evidence,
    ready_delta: run.actual.newly_ready,
    scorecard_maturity_delta: { l1: run.actual.affected_l1, l2: run.actual.affected_l2, l3: run.actual.affected_l3 },
    alpha_maturity_delta: { cells: run.actual.affected_alpha, loto_peer_groups: run.actual.affected_loto_peer_groups },
    research_readiness: run.maturity_snapshot.walk_forward_readiness,
    blockers: run.blockers,
    warnings: run.warnings,
    next_recommended_action: "Continue natural weekly evidence accumulation; do not open Walk-Forward until the existing v1.8 stronger-candidate gate is met.",
    contains_w08_private_data: false,
  };
}

function runWeeklyIntelligence(input) {
  const versionCoherence = validateVersionCoherence(input.versions);
  const accounting = accountingCheck(input.expected, input.actual);
  const healthState = globalHealth(input.stage_health, accounting, versionCoherence);
  const snapshot = buildMaturitySnapshot({ runId: input.run_id, asOf: input.as_of, counts: input.counts, artifacts: input.artifacts, versions: input.versions, healthState, stageHealth: input.stage_health });
  const delta = maturityDelta(input.previous_snapshot || null, snapshot);
  const duplicateSnapshot = input.previous_snapshot?.maturity_snapshot_id === snapshot.maturity_snapshot_id || (input.previous_snapshot?.run_id === snapshot.run_id && input.previous_snapshot?.as_of === snapshot.as_of && stableStringify(input.previous_snapshot.metrics) === stableStringify(snapshot.metrics));
  const blockers = [
    ...accounting.mismatches.map(row => `ACCOUNTING:${row.key}`),
    ...versionCoherence.mismatches.map(row => `VERSION:${row.key}`),
  ];
  const run = {
    orchestrator_version: V19_VERSION,
    run_id: input.run_id,
    as_of: input.as_of,
    source_mode: input.source_mode,
    expected: input.expected,
    actual: input.actual,
    accounting,
    version_coherence: versionCoherence,
    stage_health: input.stage_health,
    global_health: healthState,
    partial_success: healthState === HEALTH.DEGRADED_EXTERNAL,
    maturity_snapshot: snapshot,
    maturity_delta: delta,
    maturity_snapshot_write_delta: duplicateSnapshot ? 0 : 1,
    blockers,
    warnings: input.warnings || [],
    checkpoint_chain: input.checkpoint_chain,
    runtime_ms: input.runtime_ms || {},
  };
  run.semantic_hash = sha256({ ...run, runtime_ms: undefined });
  run.w00_handoff = buildW00Handoff(run);
  return run;
}

module.exports = {
  V19_VERSION,
  MATURITY_MONITOR_VERSION,
  CANONICAL_CONTRACT,
  EXPECTED_VERSIONS,
  HEALTH,
  stableStringify,
  sha256,
  buildDependencyDag,
  validateVersionCoherence,
  assessWalkForwardReadiness,
  buildMaturityMetrics,
  buildMaturitySnapshot,
  maturityDelta,
  accountingCheck,
  globalHealth,
  deriveInvalidationPlan,
  assertAsOfSafe,
  buildW00Handoff,
  runWeeklyIntelligence,
};
