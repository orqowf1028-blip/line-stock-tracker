const $ = selector => document.querySelector(selector);
let code = new URLSearchParams(location.search).get('code') || '';
const NS = 'http://www.w3.org/2000/svg';
const RANGE_LABELS = { '6m': '近 6 個月', '1y': '近 1 年', '3y': '近 3 年', '5y': '近 5 年' };
let currentRange = RANGE_LABELS[new URLSearchParams(location.search).get('range')] ? new URLSearchParams(location.search).get('range') : '6m';
const TRACKER_SIGNALS = window.LINE_TRACKER_SIGNALS || [];
const fmt = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const text = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
const svg = (name, attrs = {}, content = '') => { const node = document.createElementNS(NS, name); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); if (content !== '') node.textContent = content; return node; };
const clear = node => { while (node.firstChild) node.removeChild(node.firstChild); };
const HOLDING_KEY = 'lineTrackerHoldingThresholdsV1';
const TIER_BOUNDS = { 1: [0, 1], 2: [1, 5], 3: [5, 10], 4: [10, 15], 5: [15, 20], 6: [20, 30], 7: [30, 40], 8: [40, 50], 9: [50, 100], 10: [100, 200], 11: [200, 400], 12: [400, 600], 13: [600, 800], 14: [800, 1000], 15: [1000, Infinity] };
let holdingThresholds = loadHoldingThresholds(), studyData = null, tooltipLocked = false, symbols = [], symbolsPromise = null, loadSequence = 0;

function positive(value, fallback) { const numeric = Number(value); return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback; }
function loadHoldingThresholds() { try { const value = JSON.parse(localStorage.getItem(HOLDING_KEY) || '{}'); return { retail: positive(value.retail, 1), large1: positive(value.large1, 400), large2: positive(value.large2, 1000) }; } catch (_) { return { retail: 1, large1: 400, large2: 1000 }; } }
function saveHoldingThresholds() { try { localStorage.setItem(HOLDING_KEY, JSON.stringify(holdingThresholds)); } catch (_) {} }
function error(message) { $('#loading').className = 'error'; $('#loading').textContent = message; }
function grid(chart, width, top, bottom, low, high, ticks = 4) {
  for (let index = 0; index <= ticks; index++) {
    const y = top + (bottom - top) * index / ticks;
    chart.append(svg('line', { x1: 0, y1: y, x2: width, y2: y, stroke: '#234056', 'stroke-width': .8 }));
    const value = high - (high - low) * index / ticks;
    chart.append(svg('text', { x: width - 4, y: y - 3, fill: '#9cb3c6', 'font-size': 10, 'text-anchor': 'end' }, fmt(value)));
  }
}
function movingAverage(values, length) {
  return values.map((_, index) => {
    if (index + 1 < length) return null;
    const sample = values.slice(index + 1 - length, index + 1).map(finite);
    return sample.some(value => value === null) ? null : sample.reduce((sum, value) => sum + value, 0) / length;
  });
}
function trend(current, previous) {
  const a = finite(current), b = finite(previous);
  if (a === null || b === null) return '—';
  if (Math.abs(a - b) < 1e-9) return '→';
  return a > b ? '↑' : '↓';
}
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function placeTooltip(event) {
  const tooltip = $('#chartTooltip'), margin = 14;
  const left = Math.min(event.clientX + margin, innerWidth - tooltip.offsetWidth - 8);
  const top = Math.min(event.clientY + margin, innerHeight - tooltip.offsetHeight - 8);
  tooltip.style.left = `${Math.max(8, left)}px`; tooltip.style.top = `${Math.max(8, top)}px`;
}
function showTooltip(event, lines, lock = false) {
  const tooltip = $('#chartTooltip'); tooltip.innerHTML = lines.map(line => escapeHtml(line)).join('<br>'); tooltip.style.display = 'block';
  if (lock) tooltipLocked = true; placeTooltip(event);
}
function bindTooltip(node, lines) {
  node.style.cursor = 'pointer';
  node.addEventListener('pointerenter', event => { if (!tooltipLocked) showTooltip(event, lines); });
  node.addEventListener('pointermove', event => { if (!tooltipLocked) placeTooltip(event); });
  node.addEventListener('pointerleave', () => { if (!tooltipLocked) $('#chartTooltip').style.display = 'none'; });
  node.addEventListener('click', event => { event.stopPropagation(); tooltipLocked = false; showTooltip(event, lines, true); });
}
document.addEventListener('click', () => { tooltipLocked = false; const tooltip = $('#chartTooltip'); if (tooltip) tooltip.style.display = 'none'; });

function signalInitial(teacher) {
  const compact = String(teacher || '未').replace(/（猜）|\(猜\)|分析師|老師/g, '').trim();
  return Array.from(compact)[0] || '未';
}
function signalsOn(date) { return TRACKER_SIGNALS.filter(row => row.code === code && row.date === date); }
function metricText(label, value, previous, divisor = 1, digits = 0, suffix = '') {
  const currentNumber = finite(value), previousNumber = finite(previous);
  if (currentNumber === null) return `<span>${escapeHtml(label)} —</span>`;
  return `<span>${escapeHtml(label)} ${fmt(currentNumber / divisor, digits)}${suffix} ${trend(currentNumber, previousNumber)}</span>`;
}
function latestPair(points, key) {
  const values = points.filter(row => finite(row[key]) !== null);
  return [values.at(-1)?.[key], values.at(-2)?.[key]];
}

function drawKline(candles, institutions = []) {
  const chart = $('#kline'); clear(chart);
  if (!candles.length) { chart.append(svg('text', { x: 380, y: 180, fill: '#9cb3c6', 'text-anchor': 'middle' }, '暫無日K資料')); return; }
  const data = candles, width = 760, plotLeft = 128, plotRight = 718, priceTop = 42, priceBottom = 245, volumeTop = 286, volumeBottom = 360;
  const prices = data.flatMap(row => [finite(row.high), finite(row.low)]).filter(value => value !== null);
  const rawLow = Math.min(...prices), rawHigh = Math.max(...prices), padding = Math.max((rawHigh - rawLow) * .08, rawHigh * .01), low = rawLow - padding, high = rawHigh + padding;
  const step = (plotRight - plotLeft) / data.length, x = index => plotLeft + (index + .5) * step, y = value => priceBottom - (value - low) / (high - low) * (priceBottom - priceTop), bodyWidth = clamp(step * .68, .35, 10);
  grid(chart, width, priceTop, priceBottom, low, high);
  const closes = data.map(row => row.close), volumes = data.map(row => row.volume || 0), maxVolume = Math.max(...volumes, 1);
  const averages = [
    { length: 5, color: '#ffbd59', values: movingAverage(closes, 5) },
    { length: 10, color: '#70c8ff', values: movingAverage(closes, 10) },
    { length: 20, color: '#5bd68f', values: movingAverage(closes, 20) },
  ];
  const volumeMa5 = movingAverage(volumes, 5), volumeMa10 = movingAverage(volumes, 10);

  // A price-by-volume proxy. Official data does not expose the true account
  // class at each execution price, so institutional net volume is shown as a
  // transparent "main-force proxy" and the remainder as a retail proxy.
  const byDate = new Map(institutions.map(row => [row.date, row])), binCount = 18, binSize = Math.max((rawHigh - rawLow) / binCount, rawHigh * .001);
  const profile = Array.from({ length: binCount }, (_, index) => ({ low: rawLow + index * binSize, retail: 0, main: 0 }));
  data.forEach(row => {
    const typical = (Number(row.high) + Number(row.low) + Number(row.close)) / 3, volume = Math.max(Number(row.volume) || 0, 0);
    const chip = byDate.get(row.date) || {}, main = Math.min(volume, Math.abs(Number(chip.foreign) || 0) + Math.abs(Number(chip.trust) || 0));
    const index = clamp(Math.floor((typical - rawLow) / binSize), 0, binCount - 1);
    profile[index].main += main; profile[index].retail += Math.max(volume - main, 0);
  });
  const profileMax = Math.max(...profile.map(row => row.main + row.retail), 1), profileWidth = 112;
  profile.forEach(row => {
    const centerPrice = row.low + binSize / 2, totalWidth = (row.main + row.retail) / profileMax * profileWidth, mainWidth = row.main / profileMax * profileWidth;
    const barY = y(centerPrice) - Math.max((priceBottom - priceTop) / binCount * .36, 1.3), barHeight = Math.max((priceBottom - priceTop) / binCount * .72, 2);
    chart.append(svg('rect', { x: plotLeft - totalWidth, y: barY, width: Math.max(totalWidth - mainWidth, 0), height: barHeight, fill: '#a3d8ff', opacity: .23 }));
    chart.append(svg('rect', { x: plotLeft - mainWidth, y: barY, width: mainWidth, height: barHeight, fill: '#d9a7ff', opacity: .38 }));
  });
  chart.append(svg('line', { x1: plotLeft, y1: priceTop, x2: plotLeft, y2: priceBottom, stroke: '#52738b', 'stroke-width': .8, opacity: .8 }));

  data.forEach((row, index) => {
    const color = row.close >= row.open ? '#ef4d53' : '#25c878', cx = x(index), openY = y(row.open), closeY = y(row.close);
    chart.append(svg('line', { x1: cx, x2: cx, y1: y(row.high), y2: y(row.low), stroke: color, 'stroke-width': 1.2 }));
    chart.append(svg('rect', { x: cx - bodyWidth / 2, y: Math.min(openY, closeY), width: bodyWidth, height: Math.max(Math.abs(closeY - openY), 1.5), fill: color }));
    const volumeHeight = (row.volume || 0) / maxVolume * (volumeBottom - volumeTop);
    chart.append(svg('rect', { x: cx - bodyWidth / 2, y: volumeBottom - volumeHeight, width: bodyWidth, height: Math.max(volumeHeight, 1), fill: color, opacity: .82 }));
  });
  averages.forEach(average => {
    const points = average.values.map((value, index) => value === null ? null : `${x(index)},${y(value)}`).filter(Boolean);
    if (points.length > 1) chart.append(svg('polyline', { points: points.join(' '), fill: 'none', stroke: average.color, 'stroke-width': 1.5 }));
  });

  const highestIndex = data.reduce((best, row, index) => Number(row.high) > Number(data[best].high) ? index : best, 0);
  const lowestIndex = data.reduce((best, row, index) => Number(row.low) < Number(data[best].low) ? index : best, 0);
  const markExtreme = (index, value, label, above) => {
    const cx = x(index), cy = y(value), anchor = cx > plotRight - 90 ? 'end' : 'start', dx = anchor === 'end' ? -5 : 5;
    chart.append(svg('line', { x1: cx, y1: cy, x2: cx, y2: cy + (above ? -11 : 11), stroke: '#f4e6b2', 'stroke-width': 1 }));
    chart.append(svg('text', { x: cx + dx, y: cy + (above ? -13 : 21), fill: '#f4e6b2', 'font-size': 10, 'font-weight': 800, 'text-anchor': anchor }, `${label} ${fmt(value)}`));
  };
  markExtreme(highestIndex, data[highestIndex].high, '高', true);
  markExtreme(lowestIndex, data[lowestIndex].low, '低', false);

  const latestIndex = data.length - 1, header = [];
  averages.forEach(average => {
    const current = average.values[latestIndex], previous = average.values[latestIndex - 1];
    header.push({ value: `SMA${average.length} ${fmt(current)} ${trend(current, previous)}`, color: average.color });
  });
  let headerX = 8;
  header.forEach(item => { chart.append(svg('text', { x: headerX, y: 18, fill: item.color, 'font-size': 12, 'font-weight': 700 }, item.value)); headerX += 166; });
  chart.append(svg('line', { x1: 0, y1: 263, x2: width, y2: 263, stroke: '#42647c', 'stroke-width': .8 }));
  const latestVolume = volumes[latestIndex], previousVolume = volumes[latestIndex - 1];
  const volumeLabels = [
    `成交量 ${fmt(latestVolume / 1000, 0)} ${trend(latestVolume, previousVolume)}張`,
    `MA5 ${fmt(volumeMa5[latestIndex] / 1000, 0)} ${trend(volumeMa5[latestIndex], volumeMa5[latestIndex - 1])}張`,
    `MA10 ${fmt(volumeMa10[latestIndex] / 1000, 0)} ${trend(volumeMa10[latestIndex], volumeMa10[latestIndex - 1])}張`,
  ];
  [8, 184, 350].forEach((position, index) => chart.append(svg('text', { x: position, y: 279, fill: index ? (index === 1 ? '#ffbd59' : '#70c8ff') : '#dceaf5', 'font-size': 11, 'font-weight': 700 }, volumeLabels[index])));

  data.forEach((row, index) => {
    const dailySignals = signalsOn(row.date), buys = dailySignals.filter(item => ['買進', '加碼'].includes(item.signal)), sells = dailySignals.filter(item => ['賣出', '出場'].includes(item.signal));
    buys.forEach((item, markerIndex) => {
      const markerY = clamp(y(row.high) - 17 - markerIndex * 14, priceTop + 2, priceBottom - 14), marker = svg('g');
      marker.append(svg('rect', { x: x(index) - 6, y: markerY, width: 13, height: 13, rx: 2, fill: '#278dff', stroke: '#dff2ff', 'stroke-width': .7 }));
      marker.append(svg('text', { x: x(index) + .5, y: markerY + 10, fill: '#fff', 'font-size': 9, 'font-weight': 800, 'text-anchor': 'middle' }, signalInitial(item.teacher)));
      bindTooltip(marker, [row.date, `${item.teacher}｜${item.signal}`]); chart.append(marker);
    });
    sells.forEach((item, markerIndex) => {
      const markerY = clamp(y(row.low) + 5 + markerIndex * 14, priceTop + 2, priceBottom - 14), marker = svg('g');
      marker.append(svg('rect', { x: x(index) - 6, y: markerY, width: 13, height: 13, rx: 2, fill: '#ff70ad', stroke: '#ffe3ef', 'stroke-width': .7 }));
      marker.append(svg('text', { x: x(index) + .5, y: markerY + 10, fill: '#fff', 'font-size': 9, 'font-weight': 800, 'text-anchor': 'middle' }, signalInitial(item.teacher)));
      bindTooltip(marker, [row.date, `${item.teacher}｜${item.signal}`]); chart.append(marker);
    });
    const lines = [row.date, `開盤 ${fmt(row.open)}｜最高 ${fmt(row.high)}`, `最低 ${fmt(row.low)}｜收盤 ${fmt(row.close)}`, `成交量 ${fmt((row.volume || 0) / 1000, 0)} 張`];
    if (dailySignals.length) lines.push(...dailySignals.map(item => `${item.teacher}｜${item.signal}`));
    const hit = svg('rect', { x: plotLeft + index * step, y: priceTop, width: Math.max(step, .35), height: volumeBottom - priceTop, fill: 'transparent', 'pointer-events': 'all' });
    bindTooltip(hit, lines); chart.append(hit);
  });
  [0, Math.floor(data.length / 2), data.length - 1].forEach(index => chart.append(svg('text', { x: x(index), y: 386, fill: '#9cb3c6', 'font-size': 10, 'text-anchor': 'middle' }, data[index].date.slice(5))));

  const cross = svg('g', { visibility: 'hidden', 'pointer-events': 'none' });
  const vertical = svg('line', { y1: priceTop, y2: volumeBottom, stroke: '#dcecff', 'stroke-width': .8, 'stroke-dasharray': '4 4', opacity: .82 });
  const horizontal = svg('line', { x1: plotLeft, x2: plotRight, stroke: '#dcecff', 'stroke-width': .8, 'stroke-dasharray': '4 4', opacity: .82 });
  const dateBox = svg('rect', { y: 371, width: 76, height: 17, rx: 3, fill: '#18354a', stroke: '#7ca4bf', 'stroke-width': .6 });
  const dateText = svg('text', { y: 383, fill: '#fff', 'font-size': 10, 'text-anchor': 'middle' });
  const priceBox = svg('rect', { x: plotRight + 1, width: width - plotRight - 2, height: 17, rx: 3, fill: '#18354a', stroke: '#7ca4bf', 'stroke-width': .6 });
  const priceText = svg('text', { x: width - 4, fill: '#fff', 'font-size': 10, 'text-anchor': 'end' });
  cross.append(vertical, horizontal, dateBox, dateText, priceBox, priceText); chart.append(cross);
  chart.onpointermove = event => {
    const bounds = chart.getBoundingClientRect(), pointerX = (event.clientX - bounds.left) / bounds.width * width, pointerY = (event.clientY - bounds.top) / bounds.height * 390;
    if (pointerX < plotLeft || pointerX > plotRight || pointerY < priceTop || pointerY > volumeBottom) { cross.setAttribute('visibility', 'hidden'); return; }
    const index = clamp(Math.floor((pointerX - plotLeft) / step), 0, data.length - 1), cx = x(index), labelX = clamp(cx, 39, width - 39);
    const priceY = clamp(pointerY, priceTop, priceBottom), price = high - (priceY - priceTop) / (priceBottom - priceTop) * (high - low);
    vertical.setAttribute('x1', cx); vertical.setAttribute('x2', cx); horizontal.setAttribute('y1', priceY); horizontal.setAttribute('y2', priceY);
    dateBox.setAttribute('x', labelX - 38); dateText.setAttribute('x', labelX); dateText.textContent = data[index].date;
    priceBox.setAttribute('y', priceY - 8.5); priceText.setAttribute('y', priceY + 3.5); priceText.textContent = fmt(price);
    cross.setAttribute('visibility', 'visible');
  };
  chart.onpointerleave = () => cross.setAttribute('visibility', 'hidden');
}

function drawDailyBars(selector, points, options) {
  const chart = $(selector); clear(chart); const width = 600, plotRight = 570, top = 8, bottom = 125, dateY = 149;
  const values = points.map(row => finite(row[options.key])).filter(value => value !== null);
  if (!values.length) { chart.append(svg('text', { x: 300, y: 76, fill: '#9cb3c6', 'text-anchor': 'middle' }, '暫無每日籌碼資料')); return; }
  const low = Math.min(0, ...values), high = Math.max(0, ...values), range = Math.max(high - low, 1), paddedLow = low - range * .08, paddedHigh = high + range * .08;
  const y = value => bottom - (value - paddedLow) / (paddedHigh - paddedLow) * (bottom - top), zero = y(0), step = (plotRight - 12) / points.length, x = index => 12 + (index + .5) * step, barWidth = Math.max(step * .62, .35);
  chart.append(svg('line', { x1: 0, y1: zero, x2: width, y2: zero, stroke: '#557288', 'stroke-width': 1 }));
  points.forEach((row, index) => {
    const value = finite(row[options.key]); if (value === null) return;
    const target = y(value), color = value >= 0 ? '#ef4d53' : '#25c878';
    chart.append(svg('rect', { x: x(index) - barWidth / 2, y: Math.min(zero, target), width: barWidth, height: Math.max(Math.abs(target - zero), 1), fill: color }));
  });
  if (options.lineKey) {
    const lineValues = points.map(row => finite(row[options.lineKey])).filter(value => value !== null);
    if (lineValues.length > 1) {
      const lineLow = Math.min(...lineValues), lineHigh = Math.max(...lineValues), lineRange = Math.max(lineHigh - lineLow, Math.max(Math.abs(lineHigh), 1) * .02), lineY = value => bottom - (value - (lineLow - lineRange * .1)) / (lineRange * 1.2) * (bottom - top);
      const linePoints = points.map((row, index) => finite(row[options.lineKey]) === null ? null : `${x(index)},${lineY(row[options.lineKey])}`).filter(Boolean);
      chart.append(svg('polyline', { points: linePoints.join(' '), fill: 'none', stroke: options.lineColor, 'stroke-width': 2 }));
    }
  }
  points.forEach((row, index) => {
    const lines = [row.date, `${options.barLabel} ${fmt(finite(row[options.key]) / options.barDivisor, options.barDigits)} 張`];
    if (options.lineKey) lines.push(`${options.lineLabel} ${fmt(finite(row[options.lineKey]) / options.lineDivisor, options.lineDigits)} 張`);
    const hit = svg('rect', { x: 12 + index * step, y: top, width: step, height: bottom - top, fill: 'transparent', 'pointer-events': 'all' }); bindTooltip(hit, lines); chart.append(hit);
  });
  [0, Math.floor(points.length / 2), points.length - 1].forEach(index => { if (points[index]) chart.append(svg('text', { x: x(index), y: dateY, fill: '#9cb3c6', 'font-size': 10, 'text-anchor': 'middle' }, points[index].date.slice(5))); });
}

function drawDailyLine(selector, points, key, label) {
  const chart = $(selector); clear(chart); const width = 600, plotRight = 570, top = 10, bottom = 125, dateY = 149;
  const values = points.map(row => finite(row[key])).filter(value => value !== null);
  if (!values.length) { chart.append(svg('text', { x: 300, y: 76, fill: '#9cb3c6', 'text-anchor': 'middle' }, '暫無每日資料')); return; }
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(max - min, 1), low = Math.max(0, min - range * .12), high = max + range * .12;
  const step = (plotRight - 12) / Math.max(points.length - 1, 1), x = index => 12 + index * step, y = value => bottom - (value - low) / (high - low) * (bottom - top);
  grid(chart, width, top, bottom, low, high, 3);
  const linePoints = points.map((row, index) => finite(row[key]) === null ? null : `${x(index)},${y(row[key])}`).filter(Boolean);
  chart.append(svg('polyline', { points: linePoints.join(' '), fill: 'none', stroke: '#d985ff', 'stroke-width': 2 }));
  points.forEach((row, index) => { const hit = svg('rect', { x: Math.max(0, x(index) - step / 2), y: top, width: step, height: bottom - top, fill: 'transparent', 'pointer-events': 'all' }); bindTooltip(hit, [row.date, `${label} ${fmt(row[key])}%`]); chart.append(hit); });
  [0, Math.floor(points.length / 2), points.length - 1].forEach(index => { if (points[index]) chart.append(svg('text', { x: x(index), y: dateY, fill: '#9cb3c6', 'font-size': 10, 'text-anchor': 'middle' }, points[index].date.slice(5))); });
}

function drawHoldingBars(selector, points, key, color) {
  const chart = $(selector); clear(chart); const width = 760, top = 12, bottom = 103, values = points.map(row => finite(row[key])).filter(value => value !== null);
  if (!values.length) { chart.append(svg('text', { x: 380, y: 68, fill: '#9cb3c6', 'text-anchor': 'middle' }, '暫無集保資料')); return; }
  const rawLow = Math.min(...values), rawHigh = Math.max(...values), span = Math.max(rawHigh - rawLow, .6), low = Math.max(0, rawLow - span * .25), high = Math.min(100, rawHigh + span * .25), step = (width - 46) / points.length, barWidth = Math.max(step * .55, 4), y = value => bottom - (value - low) / (high - low) * (bottom - top);
  grid(chart, width, top, bottom, low, high, 3);
  points.forEach((row, index) => { const value = finite(row[key]); if (value === null) return; const x = 14 + index * step, rect = svg('rect', { x, y: y(value), width: barWidth, height: Math.max(bottom - y(value), 1), fill: color, opacity: .86 }); bindTooltip(rect, [row.date, `${fmt(value)}%`]); chart.append(rect); chart.append(svg('text', { x: x + barWidth / 2, y: y(value) - 4, fill: color, 'font-size': 9, 'text-anchor': 'middle' }, `${value.toFixed(1)}%`)); });
  if (points.length) { chart.append(svg('text', { x: 10, y: 123, fill: '#9cb3c6', 'font-size': 10 }, points[0].date?.slice(5) || '')); chart.append(svg('text', { x: 748, y: 123, fill: '#9cb3c6', 'font-size': 10, 'text-anchor': 'end' }, points.at(-1).date?.slice(5) || '')); }
}
function holdingRatio(holding, threshold, mode, legacyKey) {
  if (!holding?.tiers) return holding?.[legacyKey] ?? null;
  return Object.entries(holding.tiers).reduce((sum, [tier, ratio]) => { const bounds = TIER_BOUNDS[Number(tier)]; if (!bounds) return sum; const included = mode === 'below' ? bounds[1] <= threshold : bounds[0] >= threshold; return included ? sum + Number(ratio || 0) : sum; }, 0);
}
function renderHoldings(holdings) {
  const series = (threshold, mode, legacyKey) => holdings.map(holding => ({ ...holding, value: holdingRatio(holding, threshold, mode, legacyKey) })).filter(row => finite(row.value) !== null);
  const retail = series(holdingThresholds.retail, 'below', 'retail'), large1 = series(holdingThresholds.large1, 'above', 'large400'), large2 = series(holdingThresholds.large2, 'above', 'large1000'), latest = rows => rows.at(-1)?.value;
  text('#retailTitle', `散戶持股（≤${fmt(holdingThresholds.retail, 0)}張）`); text('#large1Title', `大戶持股1（＞${fmt(holdingThresholds.large1, 0)}張）`); text('#large2Title', `大戶持股2（＞${fmt(holdingThresholds.large2, 0)}張）`);
  text('#retail', latest(retail) === undefined ? '—' : `${fmt(latest(retail))}%`); text('#large1', latest(large1) === undefined ? '—' : `${fmt(latest(large1))}%`); text('#large2', latest(large2) === undefined ? '—' : `${fmt(latest(large2))}%`);
  drawHoldingBars('#holderRetail', retail.map(row => ({ ...row, retail: row.value })), 'retail', '#6ec8ff'); drawHoldingBars('#holder400', large1.map(row => ({ ...row, large400: row.value })), 'large400', '#ffbd59'); drawHoldingBars('#holder1000', large2.map(row => ({ ...row, large1000: row.value })), 'large1000', '#c77dff');
}
function initHoldingControls() {
  const inputs = { retail: $('#retailInput'), large1: $('#large1Input'), large2: $('#large2Input') };
  Object.entries(inputs).forEach(([key, input]) => { input.value = holdingThresholds[key]; input.addEventListener('change', () => { holdingThresholds[key] = positive(input.value, holdingThresholds[key]); input.value = holdingThresholds[key]; saveHoldingThresholds(); if (studyData) renderHoldings(studyData.holdings || []); }); });
}

function alignDaily(candles, institutions) {
  const byDate = new Map(institutions.map(row => [row.date, row])), displayed = candles.map(row => ({ date: row.date, ...(byDate.get(row.date) || {}) }));
  let trustCumulative = 0;
  displayed.forEach(row => {
    if (finite(row.trustCumulative) !== null) trustCumulative = Number(row.trustCumulative);
    else if (finite(row.trust) !== null) trustCumulative += Number(row.trust);
    row.trustCumulative = trustCumulative;
  });
  return displayed;
}
function render(data) {
  const candles = data.candles || [], latest = candles.at(-1), previous = candles.at(-2), change = latest && previous ? latest.close - previous.close : null;
  document.title = `${data.name || code}｜個股研究`;
  text('#name', `${data.name || code}（${code}）`); text('#market', data.market === 'listed' ? '上市' : data.market === 'otc' ? '上櫃' : '資料辨識中');
  text('#price', latest ? fmt(latest.close) : '—'); $('#price').className = `price ${change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}`;
  text('#change', change === null ? '—' : `${change >= 0 ? '+' : ''}${fmt(change)} (${previous?.close ? `${(change / previous.close * 100).toFixed(2)}%` : '—'})`); $('#change').className = `tag ${change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}`;
  text('#quoteMeta', latest ? `${latest.date}｜開 ${fmt(latest.open)}｜高 ${fmt(latest.high)}｜低 ${fmt(latest.low)}｜量 ${fmt(latest.volume / 1000, 0)} 張` : '等待官方日行情');
  const sourceNote = data.dataSource ? `｜${data.dataSource}${data.partialHistory ? '（長區間暫以近一年替代）' : ''}` : '';
  text('#updated', `資料更新：${data.updatedAt || '—'}${sourceNote}`); text('#rangeLabel', `${RANGE_LABELS[currentRange]}・滑鼠十字線對照日期與價位`); drawKline(candles, data.institutions || []);
  const daily = alignDaily(candles, data.institutions || []);
  drawDailyBars('#foreign', daily, { key: 'foreign', barLabel: '外資買賣超', barDivisor: 1000, barDigits: 0, lineKey: 'foreignHolding', lineLabel: '外資持股', lineDivisor: 1000, lineDigits: 0, lineColor: '#ffbd59' });
  drawDailyBars('#trust', daily, { key: 'trust', barLabel: '投信買賣超', barDivisor: 1000, barDigits: 0, lineKey: 'trustCumulative', lineLabel: '今年累計變化', lineDivisor: 1000, lineDigits: 0, lineColor: '#71c5ff' });
  drawDailyBars('#margin', daily, { key: 'marginDelta', barLabel: '融資差額', barDivisor: 1, barDigits: 0, lineKey: 'marginBalance', lineLabel: '融資餘額', lineDivisor: 1, lineDigits: 0, lineColor: '#c77dff' });
  drawDailyLine('#marginRate', daily, 'marginRate', '融資使用率');
  const [foreign, foreignPrevious] = latestPair(daily, 'foreign'), [foreignHolding, foreignHoldingPrevious] = latestPair(daily, 'foreignHolding');
  const [trust, trustPrevious] = latestPair(daily, 'trust'), [trustCumulative, trustCumulativePrevious] = latestPair(daily, 'trustCumulative');
  const [marginBalance, marginBalancePrevious] = latestPair(daily, 'marginBalance'), [marginDelta, marginDeltaPrevious] = latestPair(daily, 'marginDelta'), [marginRate, marginRatePrevious] = latestPair(daily, 'marginRate');
  $('#foreignMetrics').innerHTML = metricText('買賣超(張)', foreign, foreignPrevious, 1000) + metricText('外資持股(張)', foreignHolding, foreignHoldingPrevious, 1000);
  $('#trustMetrics').innerHTML = metricText('買賣超(張)', trust, trustPrevious, 1000) + metricText('期間累計變化(張)', trustCumulative, trustCumulativePrevious, 1000);
  $('#marginMetrics').innerHTML = metricText('融資(張)', marginBalance, marginBalancePrevious) + metricText('差額(張)', marginDelta, marginDeltaPrevious);
  $('#marginRateMetrics').innerHTML = metricText('融資使用率', marginRate, marginRatePrevious, 1, 2, '%');
  const holders = data.holdings || [], holding = holders.at(-1); text('#holderDate', holding ? `最新資料日 ${holding.date}；每根為該週最後營業日快照` : '每週最後營業日'); renderHoldings(holders);
  $('#loading').hidden = true; $('#dashboard').hidden = false;
}
function normalizedSymbol(value) { return String(value || '').trim().toLocaleLowerCase('zh-TW').replace(/[\s（）()]/g, ''); }
async function loadSymbols() {
  if (symbols.length) return symbols;
  if (symbolsPromise) return symbolsPromise;
  symbolsPromise = fetch('/api/symbols', { cache: 'no-store' }).then(async response => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
    const fragment = document.createDocumentFragment();
    symbols.forEach(item => { const option = document.createElement('option'); option.value = `${item.name}（${item.code}）`; option.label = `${item.code}｜${item.market === 'listed' ? '上市' : '上櫃'}`; fragment.append(option); });
    clear($('#symbolOptions')); $('#symbolOptions').append(fragment);
    text('#symbolStatus', `可搜尋 ${symbols.length.toLocaleString('zh-TW')} 支上市／上櫃股票`);
    return symbols;
  }).catch(cause => { symbolsPromise = null; text('#symbolStatus', '名稱清單暫時無法載入；仍可直接輸入四碼股號'); throw cause; });
  return symbolsPromise;
}
async function resolveSymbol(value) {
  const raw = String(value || '').trim(), codeMatch = raw.match(/(?<!\d)(\d{4})(?!\d)/);
  if (codeMatch) return { code: codeMatch[1], name: symbols.find(item => item.code === codeMatch[1])?.name || '' };
  if (!raw) throw new Error('請輸入股票名稱或四碼股號');
  await loadSymbols();
  const query = normalizedSymbol(raw);
  const exact = symbols.find(item => normalizedSymbol(item.name) === query);
  if (exact) return exact;
  const matches = symbols.filter(item => normalizedSymbol(item.name).includes(query));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`找到 ${matches.length} 支相近股票，請從輸入框建議清單選取完整名稱`);
  throw new Error('找不到此上市／上櫃股票，請確認名稱或改輸入四碼股號');
}
function prepareLoading(targetCode) {
  $('#dashboard').hidden = true; $('#loading').hidden = false; $('#loading').className = 'loading'; $('#loading').textContent = `正在整理 ${targetCode} 的日K、籌碼與持股分散資料…`;
  text('#name', `載入中（${targetCode}）`); text('#market', ''); text('#price', ''); text('#change', ''); text('#quoteMeta', ''); text('#updated', '正在載入官方資料…');
}
async function loadStudy(targetCode, pushHistory = false) {
  if (!/^\d{4}$/.test(targetCode)) return error('請輸入可辨識的四位股票代號。');
  code = targetCode; const sequence = ++loadSequence; prepareLoading(code);
  if (pushHistory) { const next = new URL(location.href); next.searchParams.set('code', code); next.searchParams.set('range', currentRange); history.pushState({ code, range: currentRange }, '', next); }
  try {
    const response = await fetch(`/api/stock?code=${encodeURIComponent(code)}&range=${encodeURIComponent(currentRange)}&schema=5`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (sequence !== loadSequence) return;
    studyData = payload; render(payload); $('#symbolInput').value = `${payload.name || code}（${code}）`; text('#symbolStatus', `${payload.name || code}（${code}）已更新完整研究頁`);
  } catch (cause) { if (sequence === loadSequence) error(`個股研究資料暫時無法完成：${cause.message || cause}`); }
}
function setRangeButtons() { document.querySelectorAll('[data-range]').forEach(button => button.classList.toggle('active', button.dataset.range === currentRange)); }
function initRangeControls() {
  setRangeButtons();
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
    const nextRange = button.dataset.range;
    if (!RANGE_LABELS[nextRange] || nextRange === currentRange) return;
    currentRange = nextRange; setRangeButtons();
    const next = new URL(location.href); next.searchParams.set('range', currentRange); history.replaceState({ code, range: currentRange }, '', next);
    if (/^\d{4}$/.test(code)) loadStudy(code, false);
  }));
  $('#klineFullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#klinePanel').requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => { text('#klineFullscreen', document.fullscreenElement ? '✕' : '⛶'); });
}
function focusSymbolInput() { const input = $('#symbolInput'); input.focus(); input.select(); }
function initSymbolSearch() {
  $('#symbolForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#symbolButton'); button.disabled = true; text('#symbolStatus', '正在辨識股票…');
    try { const target = await resolveSymbol($('#symbolInput').value); await loadStudy(target.code, target.code !== code); }
    catch (cause) { text('#symbolStatus', cause.message || String(cause)); focusSymbolInput(); }
    finally { button.disabled = false; }
  });
  $('#name').addEventListener('click', focusSymbolInput); $('#name').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusSymbolInput(); } });
  addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search), target = params.get('code') || '', nextRange = RANGE_LABELS[params.get('range')] ? params.get('range') : '6m';
    const changed = target && (target !== code || nextRange !== currentRange); currentRange = nextRange; setRangeButtons(); if (changed) loadStudy(target, false);
  });
  loadSymbols().catch(() => {});
}
function start() {
  initHoldingControls(); initRangeControls(); initSymbolSearch();
  if (!/^\d{4}$/.test(code)) { error('請在上方輸入股票名稱或四碼股號。'); focusSymbolInput(); return; }
  loadStudy(code, false);
}
start();
