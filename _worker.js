// Cloudflare Pages Advanced Mode.  Besides the tracker quote endpoint, this
// worker builds a per-stock research snapshot from official public sources.
const HEADERS = {
  Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (compatible; LINE-Stock-Tracker/1.1)',
};

const number = value => {
  const parsed = Number(String(value ?? '').replaceAll(',', '').replaceAll('−', '-').trim());
  return Number.isFinite(parsed) ? parsed : null;
};
const isoDate = value => {
  const parts = String(value || '').match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})/);
  if (!parts) return '';
  return `${Number(parts[1]) + 1911}-${String(parts[2]).padStart(2, '0')}-${String(parts[3]).padStart(2, '0')}`;
};
const ymd = value => String(value || '').replaceAll('-', '');
const RANGE_MONTHS = { '2m': 2, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60 };
const rangeKey = value => Object.prototype.hasOwnProperty.call(RANGE_MONTHS, value) ? value : '2m';
const formatUtcDate = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const rangeDates = value => {
  const end = new Date(), start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  start.setUTCMonth(start.getUTCMonth() - RANGE_MONTHS[rangeKey(value)]);
  return { startDate: formatUtcDate(start), endDate: formatUtcDate(end) };
};
const months = count => Array.from({ length: count }, (_, index) => {
  const date = new Date(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - index);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}01`;
});
const compactCookie = value => String(value || '').split(/,(?=[^;,]+=)/).map(part => part.split(';')[0]).filter(Boolean).join('; ');
const stripHtml = value => String(value || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function json(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`official source ${response.status}`);
  return response.json();
}

async function getListedMonth(code, date) {
  const payload = await json(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${code}`);
  if (payload.stat !== 'OK') return { name: '', rows: [] };
  const rows = (payload.data || []).map(row => ({
    date: isoDate(row[0]), volume: number(row[1]), open: number(row[3]), high: number(row[4]), low: number(row[5]), close: number(row[6]),
  })).filter(row => row.date && row.close !== null);
  const name = payload.title?.match(new RegExp(`${code}\\s+([^\\s]+)`))?.[1] || '';
  return { name, rows };
}

async function getOtcMonth(code, date) {
  const formatted = `${date.slice(0, 4)}/${date.slice(4, 6)}/01`;
  const payload = await json(`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${formatted}&id=&response=json`);
  const table = payload.tables?.[0];
  const rows = (table?.data || []).map(row => ({
    date: isoDate(row[0]), volume: number(row[1]), open: number(row[3]), high: number(row[4]), low: number(row[5]), close: number(row[6]),
  })).filter(row => row.date && row.close !== null);
  const name = table?.subtitle?.match(new RegExp(`${code}\\s+([^\\s]+)`))?.[1] || '';
  return { name, rows };
}

async function finMind(dataset, code, startDate, endDate) {
  const query = new URLSearchParams({ dataset, data_id: code, start_date: startDate, end_date: endDate });
  const payload = await json(`https://api.finmindtrade.com/api/v4/data?${query}`);
  if (payload.status !== 200 || !Array.isArray(payload.data)) throw new Error(`FinMind ${dataset} unavailable`);
  return payload.data;
}

async function finMindCandles(code, startDate, endDate) {
  const rows = await finMind('TaiwanStockPrice', code, startDate, endDate);
  return [...new Map(rows.map(row => {
    const candle = {
      date: String(row.date || ''),
      volume: number(row.Trading_Volume),
      open: number(row.open),
      high: number(row.max),
      low: number(row.min),
      close: number(row.close),
    };
    return [candle.date, candle];
  }).filter(([date, row]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && row.close !== null)).values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function finMindSymbols() {
  const payload = await json('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo');
  if (payload.status !== 200 || !Array.isArray(payload.data)) throw new Error('FinMind TaiwanStockInfo unavailable');
  return payload.data.map(row => ({
    code: String(row.stock_id || '').trim(),
    name: String(row.stock_name || '').trim(),
    market: row.type === 'tpex' ? 'otc' : row.type === 'twse' ? 'listed' : '',
  })).filter(row => /^\d{4}$/.test(row.code) && row.name && row.market);
}

let symbolDirectoryPromise = null;

async function symbolDirectory() {
  if (!symbolDirectoryPromise) {
    symbolDirectoryPromise = buildSymbolDirectory().catch(error => {
      symbolDirectoryPromise = null;
      throw error;
    });
  }
  return symbolDirectoryPromise;
}

async function getCandles(code, requestedRange) {
  const selectedRange = rangeKey(requestedRange), { startDate, endDate } = rangeDates(selectedRange);
  const finMindRows = await finMindCandles(code, startDate, endDate).catch(() => []);
  if (finMindRows.length) {
    const symbol = (await symbolDirectory().catch(() => [])).find(row => row.code === code);
    return {
      market: symbol?.market || 'unknown',
      name: symbol?.name || '',
      candles: finMindRows,
      dataSource: 'FinMind 台股日價（TWSE／TPEx 開放資料整合）',
      partialHistory: false,
    };
  }

  // The official TPEx month endpoint sometimes rejects Cloudflare egress.
  // Keep it as a fallback, but cap subrequests so long-range views stay inside
  // the Pages free-plan request budget.
  const dates = months(Math.min(RANGE_MONTHS[selectedRange], 12));
  const listedMonths = await Promise.all(dates.map(date => getListedMonth(code, date).catch(() => ({ name: '', rows: [] }))));
  const listed = listedMonths.flatMap(month => month.rows);
  const otcMonths = listed.length ? [] : await Promise.all(dates.map(date => getOtcMonth(code, date).catch(() => ({ name: '', rows: [] }))));
  const rows = listed.length ? listed : otcMonths.flatMap(month => month.rows);
  const unique = [...new Map(rows.map(row => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const name = [...listedMonths, ...otcMonths].map(month => month.name).find(Boolean) || '';
  return {
    market: listed.length ? 'listed' : unique.length ? 'otc' : 'unknown',
    name,
    candles: unique,
    dataSource: listed.length ? 'TWSE 官方月日行情' : 'TPEx 官方月日行情',
    partialHistory: RANGE_MONTHS[selectedRange] > 12,
  };
}

async function getDailyChips(code, candles) {
  const dates = candles.map(row => row.date), firstDate = dates[0], lastDate = dates.at(-1);
  const [institutions, margins, foreignOwnership] = await Promise.all([
    finMind('TaiwanStockInstitutionalInvestorsBuySell', code, firstDate, lastDate).catch(() => []),
    finMind('TaiwanStockMarginPurchaseShortSale', code, firstDate, lastDate).catch(() => []),
    finMind('TaiwanStockShareholding', code, firstDate, lastDate).catch(() => []),
  ]);
  const daily = new Map();
  const ensure = date => { if (!daily.has(date)) daily.set(date, { date, foreign: null, trust: null, trustCumulative: null, marginDelta: null, foreignHolding: null, marginBalance: null, marginRate: null }); return daily.get(date); };
  let trustCumulative = 0;
  for (const row of [...institutions].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const net = number(row.buy) !== null && number(row.sell) !== null ? number(row.buy) - number(row.sell) : null;
    if (row.name === 'Foreign_Investor') ensure(row.date).foreign = net;
    if (row.name === 'Investment_Trust') {
      ensure(row.date).trust = net;
      if (net !== null) trustCumulative += net;
      ensure(row.date).trustCumulative = trustCumulative;
    }
  }
  for (const row of margins) {
    const target = ensure(row.date), balance = number(row.MarginPurchaseTodayBalance), previous = number(row.MarginPurchaseYesterdayBalance), limit = number(row.MarginPurchaseLimit);
    target.marginBalance = balance;
    target.marginDelta = balance !== null && previous !== null ? balance - previous : null;
    target.marginRate = balance !== null && limit ? balance / limit * 100 : null;
  }
  for (const row of foreignOwnership) ensure(row.date).foreignHolding = number(row.ForeignInvestmentShares);
  return dates.map(date => ensure(date));
}

async function tdccOne(code, date) {
  // TDCC's synchronizer token is single-use, so every weekly point gets its
  // own lightweight form request before the stock-code query.
  const page = await fetch('https://www.tdcc.com.tw/portal/zh/smWeb/qryStock', { headers: HEADERS });
  if (!page.ok) return null;
  const pageHtml = await page.text();
  const token = pageHtml.match(/name="SYNCHRONIZER_TOKEN" value="([^"]+)"/)?.[1];
  const firDate = pageHtml.match(/name="firDate" value="(\d{8})"/)?.[1];
  if (!token || !firDate) return null;
  const cookie = compactCookie(page.headers.get('set-cookie'));
  const body = new URLSearchParams({ SYNCHRONIZER_TOKEN: token, SYNCHRONIZER_URI: '/portal/zh/smWeb/qryStock', method: 'submit', firDate, scaDate: date, sqlMethod: 'StockNo', stockNo: code, stockName: '' });
  const response = await fetch('https://www.tdcc.com.tw/portal/zh/smWeb/qryStock', { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) }, body });
  if (!response.ok) return null;
  const html = await response.text();
  let retail = 0, large400 = 0, large1000 = 0, found = false;
  const tiers = {};
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => stripHtml(cell[1]));
    const tier = number(cells[0]), ratio = number(cells[4]);
    if (!Number.isInteger(tier) || ratio === null || tier < 1 || tier > 15) continue;
    found = true;
    tiers[tier] = ratio;
    if (tier <= 11) retail += ratio;
    if (tier >= 12) large400 += ratio;
    if (tier >= 15) large1000 += ratio;
  }
  return found ? { date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, retail: Number(retail.toFixed(2)), large400: Number(large400.toFixed(2)), large1000: Number(large1000.toFixed(2)), tiers } : null;
}

async function tdccHoldings(code) {
  const calendar = await fetch('https://www.tdcc.com.tw/portal/zh/smWeb/qryStock', { headers: HEADERS });
  if (!calendar.ok) throw new Error(`TDCC ${calendar.status}`);
  const html = await calendar.text();
  const dates = [...html.matchAll(/<option value="(\d{8})"/g)].map(match => match[1]).slice(0, 7);
  if (!dates.length) throw new Error('TDCC date list unavailable');
  const result = await Promise.all(dates.map(date => tdccOne(code, date).catch(() => null)));
  return result.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
}

async function buildStudy(code, requestedRange) {
  const selectedRange = rangeKey(requestedRange);
  const { market, name, candles, dataSource, partialHistory } = await getCandles(code, selectedRange);
  if (!candles.length) throw new Error('找不到此代號的日行情');
  const [institutions, holdings] = await Promise.all([
    getDailyChips(code, candles).catch(() => []),
    tdccHoldings(code).catch(() => []),
  ]);
  return {
    code, market, name, candles, institutions, holdings,
    range: selectedRange, dataSource, partialHistory,
    updatedAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }),
  };
}

async function buildSymbolDirectory() {
  const [listedResult, otcBasicResult, otcQuoteResult, finMindResult] = await Promise.allSettled([
    json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
    json('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'),
    json('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'),
    finMindSymbols(),
  ]);
  const listed = listedResult.status === 'fulfilled' ? listedResult.value : [];
  const otcBasic = otcBasicResult.status === 'fulfilled' ? otcBasicResult.value : [];
  const otcQuotes = otcQuoteResult.status === 'fulfilled' ? otcQuoteResult.value : [];
  const finMindRecords = finMindResult.status === 'fulfilled' ? finMindResult.value : [];
  const records = [
    ...listed.map(row => ({ code: String(row.Code || '').trim(), name: String(row.Name || '').trim(), market: 'listed' })),
    ...otcBasic.map(row => ({ code: String(row.SecuritiesCompanyCode || '').trim(), name: String(row.CompanyAbbreviation || row.CompanyName || '').trim(), market: 'otc' })),
    ...otcQuotes.map(row => ({ code: String(row.SecuritiesCompanyCode || '').trim(), name: String(row.CompanyName || '').trim(), market: 'otc' })),
    ...finMindRecords,
  ].filter(row => /^\d{4}$/.test(row.code) && row.name);
  const symbols = [...new Map(records.map(row => [row.code, row])).values()].sort((a, b) => a.code.localeCompare(b.code));
  if (!symbols.length) throw new Error('上市櫃股票名稱清單暫時無法取得');
  return symbols;
}

async function quotes(request) {
  const url = new URL(request.url);
  const codes = [...new Set((url.searchParams.get('codes') || '').split(',').map(code => code.trim()).filter(code => /^(?:00\d{3}[A-Z]?|\d{4,6})$/.test(code)))].slice(0, 120);
  const requested = new Set(codes);
  const chunks = Array.from({ length: Math.ceil(codes.length / 30) }, (_, index) => codes.slice(index * 30, index * 30 + 30));
  const listedRequest = fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { headers: HEADERS }).then(async response => {
    if (!response.ok) throw new Error(`listed ${response.status}`);
    const rows = await response.json();
    return rows.filter(row => requested.has(String(row.Code || '').trim()));
  });
  const otcOfficialRequest = json('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes').then(rows => rows
    .filter(row => requested.has(String(row.SecuritiesCompanyCode || '').trim()))
    .map(row => ({
      SecuritiesCompanyCode: String(row.SecuritiesCompanyCode || '').trim(),
      ClosingPrice: row.Close,
      Change: row.Change,
    })));
  const otcRequests = chunks.map(async chunk => {
    const channel = chunk.map(code => `otc_${code}.tw`).join('|');
    const response = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channel)}&json=1&delay=0`, { headers: HEADERS });
    if (!response.ok) throw new Error(`otc ${response.status}`);
    const payload = JSON.parse((await response.text()).trim());
    return (payload.msgArray || []).filter(row => row.ex === 'otc' && row.c).map(row => {
      const price = row.z && row.z !== '-' ? row.z : row.pz, previous = Number(row.y), current = Number(price);
      if (!Number.isFinite(current) || current <= 0) return null;
      return { SecuritiesCompanyCode: row.c, ClosingPrice: price, Change: Number.isFinite(previous) && Number.isFinite(current) ? String(current - previous) : null };
    }).filter(Boolean);
  });
  const [listedResult, otcOfficialResult, ...otcResults] = await Promise.allSettled([listedRequest, otcOfficialRequest, ...otcRequests]);
  const listed = listedResult.status === 'fulfilled' ? listedResult.value : [];
  const otcOfficial = otcOfficialResult.status === 'fulfilled' ? otcOfficialResult.value : [];
  const otcRealtime = otcResults.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const otc = [...new Map([...otcOfficial, ...otcRealtime].map(row => [row.SecuritiesCompanyCode, row])).values()];
  const foundCodes = new Set([
    ...listed.map(row => String(row.Code || '').trim()),
    ...otc.map(row => String(row.SecuritiesCompanyCode || '').trim()),
  ]);
  const missingCodes = codes.filter(code => !foundCodes.has(code)).slice(0, 12);
  const end = new Date(), start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const finMindResults = await Promise.allSettled(missingCodes.map(async code => {
    const candles = await finMindCandles(code, formatUtcDate(start), formatUtcDate(end));
    const latest = candles.at(-1), previous = candles.at(-2);
    if (!latest || !Number.isFinite(latest.close)) return null;
    return {
      SecuritiesCompanyCode: code,
      ClosingPrice: String(latest.close),
      Change: previous && Number.isFinite(previous.close) ? String(latest.close - previous.close) : null,
    };
  }));
  const finMindFallback = finMindResults.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  const mergedOtc = [...new Map([...otc, ...finMindFallback].map(row => [row.SecuritiesCompanyCode, row])).values()];
  if (!listed.length && !mergedOtc.length) throw new Error('all quote sources failed');
  return Response.json({ listed, otc: mergedOtc }, { headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === '/api/release') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return Response.json({
        commit: env.CF_PAGES_COMMIT_SHA || 'unavailable',
        branch: env.CF_PAGES_BRANCH || 'main',
        deployment: env.CF_PAGES_URL || url.origin,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/quotes') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      try { return await quotes(request); } catch (error) { return Response.json({ error: String(error?.message || error) }, { status: 502 }); }
    }
    if (url.pathname === '/api/stock') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const code = (url.searchParams.get('code') || '').trim();
      if (!/^\d{4}$/.test(code)) return Response.json({ error: '請提供四碼股票代號' }, { status: 400 });
      const cache = caches.default, key = new Request(url.toString(), request);
      const cached = await cache.match(key);
      if (cached) return cached;
      try {
        const payload = await buildStudy(code, url.searchParams.get('range'));
        const response = Response.json(payload, { headers: { 'Cache-Control': 'public, max-age=900' } });
        context.waitUntil(cache.put(key, response.clone()));
        return response;
      } catch (error) { return Response.json({ error: String(error?.message || error) }, { status: 502 }); }
    }
    if (url.pathname === '/api/symbols') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const cache = caches.default, key = new Request(`${url.origin}/api/symbols?schema=3`);
      const cached = await cache.match(key);
      if (cached) return cached;
      try {
        const symbols = await buildSymbolDirectory();
        const response = Response.json({ symbols }, { headers: { 'Cache-Control': 'public, max-age=21600' } });
        context.waitUntil(cache.put(key, response.clone()));
        return response;
      } catch (error) { return Response.json({ error: String(error?.message || error) }, { status: 502 }); }
    }
    return env.ASSETS.fetch(request);
  },
};
