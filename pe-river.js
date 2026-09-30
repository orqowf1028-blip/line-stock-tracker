(() => {
  'use strict';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const colors = ['#4c8ed9', '#69abc9', '#92c1b5', '#d0c78e', '#e4a66e', '#e37b78'];
  const preferenceKey = 'w01.stock.peRiver.range.v2';
  let period = 5;
  let currentPayload = null;
  let currentCode = null;
  const requestedPeriod = new URLSearchParams(location.search).get('peRange');
  try {
    if (requestedPeriod === '3' || requestedPeriod === '5') {
      period = Number(requestedPeriod);
      localStorage.setItem(preferenceKey, requestedPeriod);
    } else {
      period = localStorage.getItem(preferenceKey) === '3' ? 3 : 5;
    }
  } catch { period = requestedPeriod === '3' ? 3 : 5; }
  function smoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return 'M' + points[0].join(',');
    const slopes = points.slice(1).map((point, index) => (point[1] - points[index][1]) / (point[0] - points[index][0] || 1));
    const tangents = points.map((point, index) => {
      if (index === 0) return slopes[0];
      if (index === points.length - 1) return slopes.at(-1);
      const before = slopes[index - 1], after = slopes[index];
      return before * after <= 0 ? 0 : 2 * before * after / (before + after);
    });
    return 'M' + points[0].join(',') + points.slice(1).map((point, index) => {
      const previous = points[index], control = (point[0] - previous[0]) / 3;
      return 'C' + [previous[0] + control, previous[1] + tangents[index] * control, point[0] - control, point[1] - tangents[index + 1] * control, point[0], point[1]].join(',');
    }).join('');
  }
  function unavailable(message, status = 'UNAVAILABLE') {
    const box = document.querySelector('#peRiver');
    if (!box) return;
    box.dataset.peStatus = status;
    box.innerHTML = '<h3>本益比河流</h3><div class="pe-na"><strong>' + escapeHtml(message) + '</strong></div>';
  }
  function render(payload, activeCode) {
    const box = document.querySelector('#peRiver');
    if (!box || String(code).toUpperCase() !== activeCode) return;
    currentPayload = payload;
    currentCode = activeCode;
    const model = payload.model || W01PEModel.build(payload.rows || [], payload.prices || []);
    const all = model.rows || [], multiples = model.multiples || [];
    if (!all.length || multiples.length < 4) {
      unavailable('資料不足：' + (payload.unavailable_reason || '正值 PE 或價格觀測不足，未硬畫估值帶。'), payload.status || 'INSUFFICIENT_DATA');
      return;
    }
    const endDate = all.at(-1).date, start = new Date(endDate + 'T00:00:00Z');
    start.setUTCFullYear(start.getUTCFullYear() - period);
    const rows = all.filter(row => row.date >= start.toISOString().slice(0, 10));
    const drawable = rows.filter(row => row.bands?.length === multiples.length);
    if (drawable.length < 40) { unavailable('資料不足：選定期間內可用估值觀測少於 40 筆。', 'INSUFFICIENT_PERIOD_DATA'); return; }
    const firstTime = Date.parse(rows[0].date), lastTime = Date.parse(rows.at(-1).date), duration = lastTime - firstTime || 1;
    const x = row => 105 + (Date.parse(row.date) - firstTime) / duration * 500;
    const values = drawable.flatMap(row => [row.price, ...row.bands]).filter(Number.isFinite);
    const low = Math.max(0, Math.min(...values) * .92), high = Math.max(...values) * 1.06;
    const y = value => 286 - (value - low) / (high - low || 1) * 232;
    const segments = []; let segment = [];
    rows.forEach(row => {
      if (row.bands?.length === multiples.length) segment.push(row);
      else if (segment.length) { segments.push(segment); segment = []; }
    });
    if (segment.length) segments.push(segment);
    const fills = multiples.slice(1).map((multiple, bandIndex) => segments.map(current => {
      const upper = current.map(row => [x(row), y(row.bands[bandIndex + 1])]);
      const lower = current.slice().reverse().map(row => [x(row), y(row.bands[bandIndex])]);
      return '<path fill="' + colors[bandIndex] + '" opacity=".28" d="' + smoothPath(upper) + 'L' + lower[0].join(',') + smoothPath(lower).replace(/^M[^CL]+/, '') + 'Z"/>';
    }).join('')).join('');
    const viewportTicks = box.clientWidth < 520 ? 4 : 6;
    const dateTicks = Array.from({length: viewportTicks}, (_, index) => rows[Math.round(index / (viewportTicks - 1) * (rows.length - 1))]);
    const last = rows.at(-1), coverage = model.coverage || {};
    box.dataset.peStatus = 'AVAILABLE';
    box.dataset.pePeriod = String(period);
    box.dataset.peRows = String(rows.length);
    box.dataset.peCoverage = String(coverage.valuation_ratio ?? '');
    box.dataset.peMethod = model.eps_method;
    box.innerHTML =
      '<div class="pe-head"><div><h3>本益比河流 · TTM 估值帶</h3><p>股價 ' + last.price.toFixed(2) + ' TWD · ' + last.date + '</p></div><div class="pe-range">' +
      [3, 5].map(years => '<a data-pe-range="' + years + '" href="/stock.html?code=' + encodeURIComponent(activeCode) + '&amp;peRange=' + years + '" class="' + (period === years ? 'active' : '') + '" aria-current="' + (period === years ? 'true' : 'false') + '">近' + (years === 3 ? '三' : '五') + '年</a>').join('') +
      '</div></div><svg class="pe-chart" viewBox="0 0 690 340" role="img" aria-label="歷史股價與 TTM EPS 估值河流圖；左側本益比倍數，右側股價刻度，底部年月">' +
      fills + '<text x="7" y="28" fill="#edb2a5" font-size="11">高估值</text>' +
      multiples.slice().reverse().map((multiple, index) => '<rect x="7" y="' + (43 + index * 31) + '" width="82" height="24" rx="5" fill="' + colors[multiples.length - 1 - index] + '" opacity=".88"/><text x="48" y="' + (59 + index * 31) + '" fill="#07131f" text-anchor="middle" font-size="12" font-weight="700">' + multiple.toFixed(1) + 'x</text>').join('') +
      '<text x="7" y="' + (70 + multiples.length * 31) + '" fill="#9cc8e1" font-size="11">低估值</text>' +
      Array.from({length: 5}, (_, index) => { const value = low + (high - low) * index / 4; return '<line x1="105" x2="605" y1="' + y(value) + '" y2="' + y(value) + '" stroke="#57718a" opacity=".28"/><text x="614" y="' + (y(value) + 4) + '" fill="#a5b9cc" font-size="11">' + value.toFixed(0) + '</text>'; }).join('') +
      multiples.map((multiple, multipleIndex) => segments.map(current => '<path data-band="' + multiple + '" fill="none" stroke="' + colors[multipleIndex] + '" stroke-width="1" d="' + smoothPath(current.map(row => [x(row), y(row.bands[multipleIndex])])) + '"/>').join('')).join('') +
      '<path class="actual-price-line" fill="none" stroke="#78ead8" stroke-width="2.4" d="' + smoothPath(rows.map(row => [x(row), y(row.price)])) + '"/><text x="614" y="28" fill="#a5b9cc" font-size="12">股價 TWD</text>' +
      dateTicks.map((row, index) => '<text x="' + x(row) + '" y="316" text-anchor="' + (index === 0 ? 'start' : index === dateTicks.length - 1 ? 'end' : 'middle') + '" fill="#a5b9cc" font-size="11">' + row.date.slice(0, 7).replace('-', '/') + '</text>').join('') +
      '<rect class="pe-hover-area" x="105" y="54" width="500" height="232" fill="transparent"/></svg><div class="pe-tooltip" role="status">移到圖中查看日期、股價、參考 TTM EPS 與估值倍數。</div><p class="pe-price-legend">━━ 實際股價；曲線只做視覺平滑，不改原始觀測值。</p>' +
      '<details class="pe-method"><summary>估值方法、覆蓋率與限制</summary><p>估值帶 = 每日參考 TTM EPS × 固定 PE 倍數。參考 TTM EPS 以同日收盤價 ÷ 交易所歷史正值 PE 反推，再用 9 個交易日中位數去除四捨五入噪音；倍數取完整可用期間 PE 的 P10／25／40／60／75／90（先排除 P3／P97 極端值）。</p><p>這是可說明的 fallback：不使用 2026E／2027E 畫歷史河流，也不把預估 EPS 回填過去。觀測 ' + (coverage.valuation_rows ?? drawable.length) + '/' + (coverage.price_rows ?? all.length) + ' 筆；缺值日保持空白，短缺不會摧毀整張圖。資料未逐日完成 strict point-in-time certification，不可直接當回測訊號。</p><p>資料日期 ' + escapeHtml(payload.as_of || endDate) + ' · <a href="' + escapeHtml(payload.source_url || 'https://finmind.github.io/tutor/TaiwanMarket/Technical/') + '" target="_blank" rel="noopener">FinMind / TWSE、TPEx 衍生公開市場資料</a></p></details>';
    const hover = box.querySelector('.pe-hover-area'), svg = box.querySelector('svg');
    hover.onpointermove = event => {
      const bounds = svg.getBoundingClientRect(), coordinate = (event.clientX - bounds.left) / bounds.width * 690;
      const targetTime = firstTime + Math.max(0, Math.min(1, (coordinate - 105) / 500)) * duration;
      const row = rows.reduce((best, current) => Math.abs(Date.parse(current.date) - targetTime) < Math.abs(Date.parse(best.date) - targetTime) ? current : best);
      box.querySelector('.pe-tooltip').textContent = row.date + '｜股價 ' + row.price.toFixed(2) + '｜參考 TTM EPS ' + (row.eps?.toFixed(2) || 'N/A') + '｜歷史 PE ' + (row.pe?.toFixed(2) || 'N/A') + '｜' + multiples.map((multiple, index) => multiple.toFixed(1) + 'x=' + (row.bands?.[index]?.toFixed(0) || 'N/A')).join('；');
    };
  }
  async function load(inputCode) {
    const activeCode = String(inputCode).toUpperCase();
    if (/^00\d/.test(activeCode)) { unavailable('ETF／槓桿 ETF 不適用公司 EPS 與本益比河流圖。', 'NOT_APPLICABLE'); return; }
    const box = document.querySelector('#peRiver'); if (!box) return;
    box.innerHTML = '<h3>本益比河流</h3><p>讀取歷史價格與估值帶…</p>';
    try {
      const response = await fetch('/ui-data/pe-river-' + encodeURIComponent(activeCode) + '.json');
      if (!response.ok) throw new Error('valuation ' + response.status);
      const payload = await response.json();
      if (String(code).toUpperCase() === activeCode) render(payload, activeCode);
    } catch {
      if (String(code).toUpperCase() === activeCode) unavailable('N/A：尚未建立可稽核的歷史 PE／價格快取；未使用假資料補圖。', 'SOURCE_UNAVAILABLE');
    }
  }
  document.addEventListener('click', event => {
    const link = event.target.closest?.('#peRiver a[data-pe-range]');
    if (!link) return;
    event.preventDefault();
    const nextPeriod = link.dataset.peRange === '3' ? 3 : 5;
    try { localStorage.setItem(preferenceKey, String(nextPeriod)); } catch {}
    location.assign(link.href);
  }, true);
  function setPeriod(years) {
    period = years === 3 ? 3 : 5;
    try { localStorage.setItem(preferenceKey, String(period)); } catch {}
    if (currentPayload && currentCode) render(currentPayload, currentCode);
  }
  window.W01PERiver = {load, render, smoothPath, setPeriod};
})();
