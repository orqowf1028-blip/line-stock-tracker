"use strict";

const crypto = require("crypto");

const DEFAULT_CONTRACT = Object.freeze({
  calculation_version: "W01_OUTCOME_V1.0.0-SHADOW",
  horizons: [1, 3, 5, 10, 20, 60, 120, 250],
  market_close_time: "13:30",
  price_adjustment_type: "RAW_UNADJUSTED",
  corporate_action_status: "NOT_VERIFIED",
  benchmark_status: "UNSUPPORTED",
  sector_benchmark_status: "UNSUPPORTED",
});

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function extractInitialData(source) {
  const marker = "const INITIAL_DATA = ";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("INITIAL_DATA marker not found");
  let depth = 0;
  let string = false;
  let escaped = false;
  let end = -1;
  const offset = start + marker.length;
  for (let index = offset; index < source.length; index += 1) {
    const char = source[index];
    if (string) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') string = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("INITIAL_DATA closing bracket not found");
  return JSON.parse(source.slice(offset, end));
}

function tickerOf(label) {
  return String(label || "").match(/\b(00\d{3}[A-Z]?|\d{4})\b/)?.[1] || null;
}

function numeric(value) {
  const values = (String(value || "").replaceAll(",", "").match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter(number => Number.isFinite(number) && number > 0);
  return values.length ? Math.max(...values) : null;
}

function fullDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
}

function sourceDateFromEvidence(meta) {
  const dates = [...new Set((meta.evidence_records || [])
    .map(record => fullDate(record.line_message_date))
    .filter(Boolean))];
  return dates.length === 1 ? dates[0] : null;
}

function eventDate(meta) {
  if (meta.partial_date || meta.date_precision === "MONTH_DAY") return null;
  return fullDate(meta.resolved_date) || fullDate(meta.signal_date) || sourceDateFromEvidence(meta);
}

function sourceTime(meta, date) {
  const candidates = [];
  if (date && /^\d{2}:\d{2}/.test(String(meta.line_message_time || ""))) {
    candidates.push(String(meta.line_message_time).slice(0, 5));
  }
  for (const record of meta.evidence_records || []) {
    if (fullDate(record.line_message_date) === date && /^\d{2}:\d{2}/.test(String(record.line_message_time || ""))) {
      candidates.push(String(record.line_message_time).slice(0, 5));
    }
  }
  return candidates.sort()[0] || null;
}

function stableEventId(row, index) {
  const meta = row[18] || {};
  if (meta.event_id) return String(meta.event_id);
  if (meta.line_message_hash) return `LINE:${meta.line_message_hash}:${tickerOf(row[1]) || "NO_TICKER"}:${meta.signal_definition_id || row[8] || "NO_SIGNAL"}`;
  return `DERIVED:${hash(JSON.stringify([index, row[0], row[1], row[6], row[8], meta.raw_evidence || row[7]])).slice(0, 24)}`;
}

function adaptEvent(row, index) {
  const meta = row[18] || {};
  const date = eventDate(meta);
  const time = sourceTime(meta, date);
  return {
    event_id: stableEventId(row, index),
    row_index: index,
    ticker: tickerOf(row[1]),
    stock_label: row[1] || null,
    teacher_id: meta.teacher_id || null,
    teacher_name: meta.teacher_display_name || row[6] || null,
    signal_definition_id: meta.signal_definition_id || null,
    action: meta.canonical_action || null,
    direction: meta.direction || "UNKNOWN",
    event_date: date,
    effective_at: meta.effective_at || null,
    source_time: time,
    source_time_status: time ? "LINE_MESSAGE_TIME" : "DATE_ONLY_OR_SCRAPE_TIME",
    entry_price: numeric(row[2]),
    exit_price: numeric(row[9]),
    entry_price_semantics: meta.entry_price_semantics || null,
    exit_price_semantics: meta.exit_price_semantics || null,
    source_price_status: meta.source_price_status || null,
    source_label: meta.source_label || "OTHER",
    partial_date: Boolean(meta.partial_date || meta.date_precision === "MONTH_DAY"),
    exit_scope: meta.exit_scope || null,
    evidence_grade: meta.evidence_grade || null,
    raw_action: meta.raw_action || row[8] || null,
    review_status: meta.review_status || null,
  };
}

function intradayBeforeClose(event, contract = DEFAULT_CONTRACT) {
  return Boolean(event.source_time && event.source_time <= contract.market_close_time);
}

function explicitPriceCandidate(event, contract = DEFAULT_CONTRACT) {
  if (!intradayBeforeClose(event, contract)) return null;
  if (["BUY", "ADD"].includes(event.action) && event.entry_price && event.entry_price_semantics) {
    return { price: event.entry_price, semantics: event.entry_price_semantics, field: "entry_price" };
  }
  if (["SELL", "COVER"].includes(event.action) && event.exit_price && event.exit_price_semantics) {
    return { price: event.exit_price, semantics: event.exit_price_semantics, field: "exit_price" };
  }
  if (event.action === "SHORT" && event.entry_price && event.entry_price_semantics) {
    return { price: event.entry_price, semantics: event.entry_price_semantics, field: "entry_price" };
  }
  return null;
}

function normalizeCandles(candles) {
  return [...new Map((candles || []).map(row => [String(row.date || ""), {
    date: String(row.date || ""),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }]).filter(([date, row]) => fullDate(date) && [row.open, row.high, row.low, row.close].every(Number.isFinite))).values()]
    .sort((left, right) => left.date.localeCompare(right.date));
}

function resolveReference(event, candles, calendarDates, contract = DEFAULT_CONTRACT) {
  if (!event.event_date) return { status: "DATE_UNRESOLVED", reason: "year/date is not fully resolved" };
  if (!event.ticker) return { status: "NOT_ELIGIBLE", reason: "ticker is not usable by the existing Taiwan-market adapter" };
  if (event.direction === "UNKNOWN") return { status: "NOT_ELIGIBLE", reason: "Signal Registry direction is UNKNOWN" };
  const byDate = new Map(candles.map(row => [row.date, row]));
  const eventCandle = byDate.get(event.event_date);
  const explicit = explicitPriceCandidate(event, contract);
  if (explicit && eventCandle && explicit.price >= eventCandle.low - 1e-9 && explicit.price <= eventCandle.high + 1e-9) {
    return {
      status: "READY",
      reference_price: explicit.price,
      reference_price_type: "EXPLICIT_SIGNAL_PRICE",
      reference_price_semantics: explicit.semantics,
      reference_trading_date: event.event_date,
      reference_timestamp: `${event.event_date}T${event.source_time}:00+08:00`,
      explicit_price_field: explicit.field,
      explicit_candidate_status: "OHLC_COMPATIBLE",
    };
  }
  const nextDate = calendarDates.find(date => date > event.event_date);
  if (!nextDate) return { status: "NOT_MATURED", reason: "next exchange session is not yet available" };
  const nextCandle = byDate.get(nextDate);
  if (!nextCandle) return { status: "PRICE_DATA_MISSING", reason: `ticker has no candle on reference session ${nextDate}` };
  return {
    status: "READY",
    reference_price: nextCandle.open,
    reference_price_type: "NEXT_OPEN",
    reference_price_semantics: explicit ? "EXPLICIT_CANDIDATE_REJECTED_OR_NOT_EXECUTABLE" : "CONSERVATIVE_EXECUTABLE_FALLBACK",
    reference_trading_date: nextDate,
    reference_timestamp: `${nextDate}T09:00:00+08:00`,
    explicit_price_field: explicit?.field || null,
    explicit_candidate_status: explicit ? (!eventCandle ? "EVENT_CANDLE_MISSING" : "OUTSIDE_EVENT_DAY_OHLC") : "NONE",
  };
}

function roundPct(value) {
  return Number((value * 100).toFixed(6));
}

function computeOutcome(event, candlesInput, calendarInput, horizon, options = {}) {
  const contract = options.contract || DEFAULT_CONTRACT;
  const candles = normalizeCandles(candlesInput);
  const calendarDates = [...new Set(calendarInput || [])].filter(fullDate).sort();
  const base = {
    event_id: event.event_id, ticker: event.ticker, teacher_id: event.teacher_id,
    signal_definition_id: event.signal_definition_id, action: event.action, direction: event.direction,
    event_date: event.event_date, effective_at: event.effective_at, source_time_status: event.source_time_status,
    horizon: `${horizon}D`, calculation_version: contract.calculation_version,
    computed_at: options.computed_at || null, price_adjustment_type: contract.price_adjustment_type,
    corporate_action_status: contract.corporate_action_status, benchmark_id: null, excess_return_pct: null,
    sector_benchmark_id: null, sector_excess_return_pct: null, benchmark_status: contract.benchmark_status,
    sector_benchmark_status: contract.sector_benchmark_status, price_source: options.price_source || null,
  };
  if (!contract.horizons.includes(horizon)) return { ...base, outcome_status: "NOT_ELIGIBLE", eligibility_reason: "unsupported horizon" };
  if (!event.event_date) return { ...base, outcome_status: "DATE_UNRESOLVED", eligibility_reason: "year/date is not fully resolved" };
  if (!event.ticker) return { ...base, outcome_status: "NOT_ELIGIBLE", eligibility_reason: "ticker is not usable by the existing Taiwan-market adapter" };
  if (event.direction === "UNKNOWN") return { ...base, outcome_status: "NOT_ELIGIBLE", eligibility_reason: "Signal Registry direction is UNKNOWN" };
  const forwardDates = calendarDates.filter(date => date > event.event_date);
  const reference = resolveReference(event, candles, calendarDates, contract);
  if (forwardDates.length < horizon) {
    return {
      ...base, ...(reference.status === "READY" ? reference : {}), outcome_status: "NOT_MATURED",
      eligibility_reason: forwardDates.length === 0 && reference.status !== "READY"
        ? "next exchange session is not yet available"
        : `requires ${horizon} exchange sessions after event; only ${forwardDates.length} available`,
    };
  }
  if (reference.status !== "READY") return { ...base, outcome_status: reference.status, eligibility_reason: reference.reason };
  const pathDates = forwardDates.slice(0, horizon);
  const byDate = new Map(candles.map(row => [row.date, row]));
  const missing = pathDates.filter(date => !byDate.has(date));
  if (missing.length) return {
    ...base, ...reference, target_trading_date: pathDates.at(-1), outcome_status: "PRICE_DATA_MISSING",
    eligibility_reason: `missing ticker candle(s): ${missing.join(",")}`,
  };
  const path = pathDates.map(date => byDate.get(date));
  const endpoint = path.at(-1);
  const referencePrice = reference.reference_price;
  const marketReturn = endpoint.close / referencePrice - 1;
  const marketMfe = Math.max(...path.map(row => row.high / referencePrice - 1));
  const marketMae = Math.min(...path.map(row => row.low / referencePrice - 1));
  const directionalReturn = event.direction === "BULLISH" ? marketReturn : event.direction === "BEARISH" ? -marketReturn : null;
  const directionalMfe = event.direction === "BULLISH" ? marketMfe : event.direction === "BEARISH" ? Math.max(...path.map(row => 1 - row.low / referencePrice)) : null;
  const directionalMae = event.direction === "BULLISH" ? marketMae : event.direction === "BEARISH" ? Math.min(...path.map(row => 1 - row.high / referencePrice)) : null;
  return {
    ...base, ...reference, target_trading_date: pathDates.at(-1), actual_trading_date: endpoint.date,
    endpoint_close: endpoint.close, market_return_pct: roundPct(marketReturn),
    directional_return_pct: directionalReturn === null ? null : roundPct(directionalReturn),
    market_mfe_pct: roundPct(marketMfe), market_mae_pct: roundPct(marketMae),
    directional_mfe_pct: directionalMfe === null ? null : roundPct(directionalMfe),
    directional_mae_pct: directionalMae === null ? null : roundPct(directionalMae),
    outcome_status: "READY", eligibility_reason: "reference and all required exchange-session candles are available",
    lineage: {
      event_id: event.event_id, reference_rule: reference.reference_price_type,
      reference_observation: { date: reference.reference_trading_date, price: reference.reference_price, field: reference.explicit_price_field || "open" },
      path_observations: path.map(row => ({ date: row.date, high: row.high, low: row.low, close: row.close })),
    },
  };
}

function semanticOutcome(outcome) {
  const copy = JSON.parse(JSON.stringify(outcome));
  delete copy.computed_at;
  return copy;
}

function outcomeIdentity(outcome) {
  return `${outcome.event_id}|${outcome.horizon}|${outcome.calculation_version}`;
}

module.exports = {
  DEFAULT_CONTRACT, adaptEvent, computeOutcome, eventDate, explicitPriceCandidate, extractInitialData,
  hash, normalizeCandles, outcomeIdentity, resolveReference, semanticOutcome, sourceTime, stableEventId, tickerOf,
};
