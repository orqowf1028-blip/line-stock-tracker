const W01_PUBLIC_STATIC_PATHS = new Set(["/README.md","/app-config.js","/app.js","/index.html","/market-ui.js","/outcome-checkpoint.json","/outcome-integration.js","/outcome-manifest.json","/outcome-retry.json","/outcome-store.json","/outcome-unresolved.json","/pe-model.js","/pe-river.js","/pipeline/hierarchical-scorecard-engine.js","/pipeline/outcome-engine.js","/pipeline/outcome-incremental.js","/pipeline/outcome-incremental.test.js","/pipeline/real-adapter-integration.js","/pipeline/real-adapter-integration.test.js","/pipeline/run-outcome-incremental.js","/pipeline/run-weekly-candidate-writer.js","/pipeline/run-weekly-write-gate-partition.js","/pipeline/scorecard-engine.js","/pipeline/teacher-alpha-engine.js","/pipeline/weekly-candidate-writer.js","/pipeline/weekly-candidate-writer.test.js","/pipeline/weekly-intelligence-engine.js","/pipeline/weekly-operations.js","/pipeline/weekly-reconciliation.js","/pipeline/weekly-reconciliation.shadow.test.js","/pipeline/weekly-write-gate-partition.js","/pipeline/weekly-write-gate-partition.test.js","/research-tune2.js","/research/README.md","/research/alpha-performance-validation.json","/research/hierarchical-scorecard.json.gz","/research/maturity-snapshot.json","/research/release-validation.json","/research/teacher-alpha.json.gz","/research/unified-checkpoint.json","/schema.sql","/signal-data.js","/signal-definition-registry.json","/stock-tune2.js","/stock-tune3.js","/stock-tune4.js","/stock-tune5.js","/stock-ux.js","/stock.html","/stock.js","/teacher-registry.json","/tune2.css","/tune2.js","/tune3.css","/tune3.js","/tune4-market.js","/tune4.css","/tune5.css","/tune5.js","/ui-data/index.json","/ui-data/industry.json","/ui-data/pe-2330.json","/ui-data/pe-8046.json","/ui-data/pe-river-2330.json","/ui-data/pe-river-2454.json","/ui-data/pe-river-8046.json","/ui-data/stocks/%E5%8F%B0%E6%8C%87%E6%9C%9F.json","/ui-data/stocks/%E5%8F%B0%E7%A9%8D%E9%9B%BB%E6%9C%9F.json","/ui-data/stocks/0050.json","/ui-data/stocks/0052.json","/ui-data/stocks/00631L.json","/ui-data/stocks/00632R.json","/ui-data/stocks/00635U.json","/ui-data/stocks/00663L.json","/ui-data/stocks/00735.json","/ui-data/stocks/00752.json","/ui-data/stocks/00753L.json","/ui-data/stocks/00830.json","/ui-data/stocks/00940.json","/ui-data/stocks/00981A.json","/ui-data/stocks/00988A.json","/ui-data/stocks/1101.json","/ui-data/stocks/1301.json","/ui-data/stocks/1303.json","/ui-data/stocks/1309.json","/ui-data/stocks/1312.json","/ui-data/stocks/1316.json","/ui-data/stocks/1326.json","/ui-data/stocks/1342.json","/ui-data/stocks/1434.json","/ui-data/stocks/1513.json","/ui-data/stocks/1514.json","/ui-data/stocks/1515.json","/ui-data/stocks/1528.json","/ui-data/stocks/1560.json","/ui-data/stocks/1582.json","/ui-data/stocks/1597.json","/ui-data/stocks/1608.json","/ui-data/stocks/1709.json","/ui-data/stocks/1710.json","/ui-data/stocks/1714.json","/ui-data/stocks/1717.json","/ui-data/stocks/1718.json","/ui-data/stocks/1721.json","/ui-data/stocks/1727.json","/ui-data/stocks/1802.json","/ui-data/stocks/1809.json","/ui-data/stocks/1810.json","/ui-data/stocks/1815.json","/ui-data/stocks/2009.json","/ui-data/stocks/2049.json","/ui-data/stocks/2059.json","/ui-data/stocks/2221.json","/ui-data/stocks/2230.json","/ui-data/stocks/2233.json","/ui-data/stocks/2236.json","/ui-data/stocks/2301.json","/ui-data/stocks/2302.json","/ui-data/stocks/2303.json","/ui-data/stocks/2308.json","/ui-data/stocks/2312.json","/ui-data/stocks/2313.json","/ui-data/stocks/2317.json","/ui-data/stocks/2323.json","/ui-data/stocks/2324.json","/ui-data/stocks/2327.json","/ui-data/stocks/2328.json","/ui-data/stocks/2329.json","/ui-data/stocks/2330.json","/ui-data/stocks/2331.json","/ui-data/stocks/2332.json","/ui-data/stocks/2337.json","/ui-data/stocks/2338.json","/ui-data/stocks/2340.json","/ui-data/stocks/2344.json","/ui-data/stocks/2345.json","/ui-data/stocks/2351.json","/ui-data/stocks/2354.json","/ui-data/stocks/2357.json","/ui-data/stocks/2359.json","/ui-data/stocks/2360.json","/ui-data/stocks/2362.json","/ui-data/stocks/2363.json","/ui-data/stocks/2367.json","/ui-data/stocks/2368.json","/ui-data/stocks/2369.json","/ui-data/stocks/2374.json","/ui-data/stocks/2375.json","/ui-data/stocks/2376.json","/ui-data/stocks/2377.json","/ui-data/stocks/2379.json","/ui-data/stocks/2382.json","/ui-data/stocks/2388.json","/ui-data/stocks/2395.json","/ui-data/stocks/2397.json","/ui-data/stocks/2399.json","/ui-data/stocks/2401.json","/ui-data/stocks/2404.json","/ui-data/stocks/2405.json","/ui-data/stocks/2406.json","/ui-data/stocks/2408.json","/ui-data/stocks/2409.json","/ui-data/stocks/2413.json","/ui-data/stocks/2421.json","/ui-data/stocks/2425.json","/ui-data/stocks/2426.json","/ui-data/stocks/2434.json","/ui-data/stocks/2436.json","/ui-data/stocks/2441.json","/ui-data/stocks/2449.json","/ui-data/stocks/2451.json","/ui-data/stocks/2454.json","/ui-data/stocks/2455.json","/ui-data/stocks/2458.json","/ui-data/stocks/2464.json","/ui-data/stocks/2465.json","/ui-data/stocks/2466.json","/ui-data/stocks/2468.json","/ui-data/stocks/2472.json","/ui-data/stocks/2476.json","/ui-data/stocks/2478.json","/ui-data/stocks/2481.json","/ui-data/stocks/2484.json","/ui-data/stocks/2486.json","/ui-data/stocks/2489.json","/ui-data/stocks/2492.json","/ui-data/stocks/2493.json","/ui-data/stocks/2495.json","/ui-data/stocks/2537.json","/ui-data/stocks/2603.json","/ui-data/stocks/2605.json","/ui-data/stocks/2606.json","/ui-data/stocks/2607.json","/ui-data/stocks/2609.json","/ui-data/stocks/2611.json","/ui-data/stocks/2612.json","/ui-data/stocks/2615.json","/ui-data/stocks/2617.json","/ui-data/stocks/2618.json","/ui-data/stocks/2634.json","/ui-data/stocks/2637.json","/ui-data/stocks/2645.json","/ui-data/stocks/2743.json","/ui-data/stocks/2745.json","/ui-data/stocks/2880.json","/ui-data/stocks/2884.json","/ui-data/stocks/2892.json","/ui-data/stocks/3005.json","/ui-data/stocks/3006.json","/ui-data/stocks/3008.json","/ui-data/stocks/3015.json","/ui-data/stocks/3016.json","/ui-data/stocks/3017.json","/ui-data/stocks/3019.json","/ui-data/stocks/3022.json","/ui-data/stocks/3023.json","/ui-data/stocks/3026.json","/ui-data/stocks/3029.json","/ui-data/stocks/3032.json","/ui-data/stocks/3033.json","/ui-data/stocks/3034.json","/ui-data/stocks/3036.json","/ui-data/stocks/3037.json","/ui-data/stocks/3042.json","/ui-data/stocks/3044.json","/ui-data/stocks/3055.json","/ui-data/stocks/3060.json","/ui-data/stocks/3081.json","/ui-data/stocks/3090.json","/ui-data/stocks/3093.json","/ui-data/stocks/3094.json","/ui-data/stocks/3105.json","/ui-data/stocks/3122.json","/ui-data/stocks/3135.json","/ui-data/stocks/3138.json","/ui-data/stocks/3141.json","/ui-data/stocks/3152.json","/ui-data/stocks/3162.json","/ui-data/stocks/3163.json","/ui-data/stocks/3167.json","/ui-data/stocks/3168.json","/ui-data/stocks/3189.json","/ui-data/stocks/3211.json","/ui-data/stocks/3219.json","/ui-data/stocks/3228.json","/ui-data/stocks/3229.json","/ui-data/stocks/3231.json","/ui-data/stocks/3234.json","/ui-data/stocks/3260.json","/ui-data/stocks/3264.json","/ui-data/stocks/3265.json","/ui-data/stocks/3289.json","/ui-data/stocks/3294.json","/ui-data/stocks/3305.json","/ui-data/stocks/3323.json","/ui-data/stocks/3324.json","/ui-data/stocks/3338.json","/ui-data/stocks/3354.json","/ui-data/stocks/3357.json","/ui-data/stocks/3362.json","/ui-data/stocks/3363.json","/ui-data/stocks/3374.json","/ui-data/stocks/3376.json","/ui-data/stocks/3390.json","/ui-data/stocks/3402.json","/ui-data/stocks/3406.json","/ui-data/stocks/3413.json","/ui-data/stocks/3434.json","/ui-data/stocks/3441.json","/ui-data/stocks/3443.json","/ui-data/stocks/3450.json","/ui-data/stocks/3467.json","/ui-data/stocks/3479.json","/ui-data/stocks/3481.json","/ui-data/stocks/3483.json","/ui-data/stocks/3485.json","/ui-data/stocks/3490.json","/ui-data/stocks/3491.json","/ui-data/stocks/3498.json","/ui-data/stocks/3504.json","/ui-data/stocks/3528.json","/ui-data/stocks/3529.json","/ui-data/stocks/3532.json","/ui-data/stocks/3533.json","/ui-data/stocks/3543.json","/ui-data/stocks/3570.json","/ui-data/stocks/3577.json","/ui-data/stocks/3591.json","/ui-data/stocks/3594.json","/ui-data/stocks/3605.json","/ui-data/stocks/3617.json","/ui-data/stocks/3624.json","/ui-data/stocks/3645.json","/ui-data/stocks/3653.json","/ui-data/stocks/3661.json","/ui-data/stocks/3665.json","/ui-data/stocks/3680.json","/ui-data/stocks/3689.json","/ui-data/stocks/3691.json","/ui-data/stocks/3693.json","/ui-data/stocks/3694.json","/ui-data/stocks/3701.json","/ui-data/stocks/3702.json","/ui-data/stocks/3704.json","/ui-data/stocks/3706.json","/ui-data/stocks/3707.json","/ui-data/stocks/3711.json","/ui-data/stocks/3714.json","/ui-data/stocks/3715.json","/ui-data/stocks/4128.json","/ui-data/stocks/4130.json","/ui-data/stocks/4178.json","/ui-data/stocks/4510.json","/ui-data/stocks/4534.json","/ui-data/stocks/4540.json","/ui-data/stocks/4541.json","/ui-data/stocks/4549.json","/ui-data/stocks/4551.json","/ui-data/stocks/4566.json","/ui-data/stocks/4576.json","/ui-data/stocks/4714.json","/ui-data/stocks/4721.json","/ui-data/stocks/4722.json","/ui-data/stocks/4739.json","/ui-data/stocks/4749.json","/ui-data/stocks/4760.json","/ui-data/stocks/4764.json","/ui-data/stocks/4772.json","/ui-data/stocks/4903.json","/ui-data/stocks/4906.json","/ui-data/stocks/4908.json","/ui-data/stocks/4912.json","/ui-data/stocks/4915.json","/ui-data/stocks/4919.json","/ui-data/stocks/4931.json","/ui-data/stocks/4939.json","/ui-data/stocks/4949.json","/ui-data/stocks/4951.json","/ui-data/stocks/4952.json","/ui-data/stocks/4956.json","/ui-data/stocks/4958.json","/ui-data/stocks/4966.json","/ui-data/stocks/4967.json","/ui-data/stocks/4971.json","/ui-data/stocks/4973.json","/ui-data/stocks/4976.json","/ui-data/stocks/4977.json","/ui-data/stocks/4979.json","/ui-data/stocks/4989.json","/ui-data/stocks/4991.json","/ui-data/stocks/5243.json","/ui-data/stocks/5289.json","/ui-data/stocks/5314.json","/ui-data/stocks/5328.json","/ui-data/stocks/5340.json","/ui-data/stocks/5347.json","/ui-data/stocks/5351.json","/ui-data/stocks/5371.json","/ui-data/stocks/5425.json","/ui-data/stocks/5439.json","/ui-data/stocks/5443.json","/ui-data/stocks/5471.json","/ui-data/stocks/5475.json","/ui-data/stocks/5483.json","/ui-data/stocks/5498.json","/ui-data/stocks/6126.json","/ui-data/stocks/6127.json","/ui-data/stocks/6139.json","/ui-data/stocks/6140.json","/ui-data/stocks/6141.json","/ui-data/stocks/6147.json","/ui-data/stocks/6148.json","/ui-data/stocks/6153.json","/ui-data/stocks/6168.json","/ui-data/stocks/6173.json","/ui-data/stocks/6182.json","/ui-data/stocks/6187.json","/ui-data/stocks/6196.json","/ui-data/stocks/6197.json","/ui-data/stocks/6202.json","/ui-data/stocks/6205.json","/ui-data/stocks/6206.json","/ui-data/stocks/6207.json","/ui-data/stocks/6213.json","/ui-data/stocks/6215.json","/ui-data/stocks/6217.json","/ui-data/stocks/6224.json","/ui-data/stocks/6226.json","/ui-data/stocks/6239.json","/ui-data/stocks/6269.json","/ui-data/stocks/6271.json","/ui-data/stocks/6274.json","/ui-data/stocks/6278.json","/ui-data/stocks/6282.json","/ui-data/stocks/6284.json","/ui-data/stocks/6285.json","/ui-data/stocks/6291.json","/ui-data/stocks/6405.json","/ui-data/stocks/6414.json","/ui-data/stocks/6415.json","/ui-data/stocks/6426.json","/ui-data/stocks/6435.json","/ui-data/stocks/6442.json","/ui-data/stocks/6443.json","/ui-data/stocks/6449.json","/ui-data/stocks/6451.json","/ui-data/stocks/6456.json","/ui-data/stocks/6472.json","/ui-data/stocks/6488.json","/ui-data/stocks/6494.json","/ui-data/stocks/6505.json","/ui-data/stocks/6509.json","/ui-data/stocks/6515.json","/ui-data/stocks/6525.json","/ui-data/stocks/6530.json","/ui-data/stocks/6531.json","/ui-data/stocks/6533.json","/ui-data/stocks/6547.json","/ui-data/stocks/6573.json","/ui-data/stocks/6579.json","/ui-data/stocks/6588.json","/ui-data/stocks/6596.json","/ui-data/stocks/6620.json","/ui-data/stocks/6642.json","/ui-data/stocks/6657.json","/ui-data/stocks/6669.json","/ui-data/stocks/6672.json","/ui-data/stocks/6695.json","/ui-data/stocks/6706.json","/ui-data/stocks/6712.json","/ui-data/stocks/6716.json","/ui-data/stocks/6719.json","/ui-data/stocks/6725.json","/ui-data/stocks/6727.json","/ui-data/stocks/6732.json","/ui-data/stocks/6739.json","/ui-data/stocks/6742.json","/ui-data/stocks/6753.json","/ui-data/stocks/6761.json","/ui-data/stocks/6770.json","/ui-data/stocks/6788.json","/ui-data/stocks/6789.json","/ui-data/stocks/6805.json","/ui-data/stocks/6830.json","/ui-data/stocks/6831.json","/ui-data/stocks/6834.json","/ui-data/stocks/6861.json","/ui-data/stocks/6862.json","/ui-data/stocks/6877.json","/ui-data/stocks/6907.json","/ui-data/stocks/6913.json","/ui-data/stocks/6918.json","/ui-data/stocks/6919.json","/ui-data/stocks/6933.json","/ui-data/stocks/6949.json","/ui-data/stocks/6957.json","/ui-data/stocks/7402.json","/ui-data/stocks/7642.json","/ui-data/stocks/7717.json","/ui-data/stocks/7751.json","/ui-data/stocks/7769.json","/ui-data/stocks/7788.json","/ui-data/stocks/7799.json","/ui-data/stocks/7856.json","/ui-data/stocks/7932.json","/ui-data/stocks/8016.json","/ui-data/stocks/8021.json","/ui-data/stocks/8028.json","/ui-data/stocks/8033.json","/ui-data/stocks/8038.json","/ui-data/stocks/8039.json","/ui-data/stocks/8042.json","/ui-data/stocks/8043.json","/ui-data/stocks/8046.json","/ui-data/stocks/8054.json","/ui-data/stocks/8059.json","/ui-data/stocks/8069.json","/ui-data/stocks/8086.json","/ui-data/stocks/8096.json","/ui-data/stocks/8103.json","/ui-data/stocks/8110.json","/ui-data/stocks/8111.json","/ui-data/stocks/8112.json","/ui-data/stocks/8131.json","/ui-data/stocks/8150.json","/ui-data/stocks/8222.json","/ui-data/stocks/8227.json","/ui-data/stocks/8255.json","/ui-data/stocks/8261.json","/ui-data/stocks/8271.json","/ui-data/stocks/8299.json","/ui-data/stocks/8358.json","/ui-data/stocks/8431.json","/ui-data/stocks/8932.json","/ui-data/stocks/8996.json","/ui-data/stocks/9933.json","/ui-data/stocks/9958.json","/ui-data/taxonomy.json","/ui-data/teachers/W01-T-0001.json","/ui-data/teachers/W01-T-0002.json","/ui-data/teachers/W01-T-0003.json","/ui-data/teachers/W01-T-0004.json","/ui-data/teachers/W01-T-0005.json","/ui-data/teachers/W01-T-0006.json","/ui-data/teachers/W01-T-0007.json","/ui-data/teachers/W01-T-0008.json","/ui-data/teachers/W01-T-0009.json","/ui-data/teachers/W01-T-0010.json","/ui-data/teachers/W01-T-0011.json","/ui-data/teachers/W01-T-0012.json","/ui-data/teachers/W01-T-0013.json","/ui-data/teachers/W01-T-0014.json","/ui-data/teachers/W01-T-0015.json","/ui-data/teachers/W01-T-0016.json","/ui-data/teachers/W01-T-0017.json","/ui-data/teachers/W01-T-0018.json","/ui-data/teachers/W01-T-0019.json","/ui-data/teachers/W01-T-0020.json","/ui-data/teachers/W01-T-0021.json","/ui-data/teachers/W01-T-0022.json","/ui-data/teachers/W01-T-0023.json","/ui-data/teachers/W01-T-0024.json","/ui-data/teachers/W01-T-0025.json","/ui-data/teachers/W01-T-0026.json","/ui-data/teachers/W01-T-0027.json","/ui-data/teachers/W01-T-0028.json","/ui-data/teachers/W01-T-0029.json","/ui-data/teachers/W01-T-0030.json","/ui-data/teachers/W01-T-0031.json","/ui-data/teachers/W01-T-0032.json","/ui-data/teachers/W01-T-0033.json","/ui-data/teachers/W01-T-0034.json","/ui-data/teachers/W01-T-0035.json","/ui-data/teachers/W01-T-0036.json","/ui-data/teachers/W01-T-0037.json","/ui-data/teachers/W01-T-0038.json","/ui-data/teachers/W01-T-0039.json","/ui-data/teachers/W01-T-0040.json","/ui-data/teachers/W01-T-0041.json","/ui-data/teachers/W01-T-0042.json","/ui-data/teachers/W01-T-0043.json","/ui-data/teachers/W01-T-0044.json","/ui-data/teachers/W01-T-0045.json","/ui-data/teachers/W01-T-0046.json","/ui-data/teachers/W01-T-0047.json","/ui-data/teachers/W01-T-0048.json","/ui-data/teachers/W01-T-0049.json","/ui-data/teachers/W01-T-0050.json","/ui-data/teachers/W01-T-0051.json","/ui-data/teachers/W01-T-0052.json","/ui-data/teachers/W01-T-0053.json","/ui-data/teachers/W01-T-0054.json","/ui-data/teachers/W01-T-0055.json","/ui-data/teachers/W01-T-0056.json","/ui-data/teachers/W01-T-0057.json","/ui-data/teachers/W01-T-0058.json","/ui-data/teachers/W01-T-0059.json","/ui-data/teachers/W01-T-0060.json","/ui-data/teachers/W01-T-0061.json","/ui-data/teachers/W01-T-0062.json","/ui-data/teachers/W01-T-0063.json","/ui-data/teachers/W01-T-0064.json","/ui-data/teachers/W01-T-0065.json","/ui-data/teachers/W01-T-0066.json","/ui-data/teachers/W01-T-0067.json","/ui-data/teachers/W01-T-0068.json","/ui-data/teachers/W01-T-0069.json","/ui-data/teachers/W01-T-0070.json","/ui-data/teachers/W01-T-0071.json","/ui-data/teachers/W01-T-0072.json","/ui-data/teachers/W01-T-UNKNOWN.json","/ui-data/weekly-brief.json","/ux.css","/ux.js","/w00-handoff.json","/w01-version-manifest.json","/","/stock"]);
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
  if (/^00\d{3}[A-Z]?$/.test(code)) {
    const selectedRange = rangeKey(requestedRange);
    const date = new Date(); date.setMonth(date.getMonth() - RANGE_MONTHS[selectedRange]);
    const rows = await finMind('TaiwanStockPrice', code, date.toISOString().slice(0, 10), formatUtcDate(new Date()));
    const candles = rows.map(row => ({ date: row.date, open: row.open, high: row.max, low: row.min, close: row.close, volume: row.Trading_Volume }));
    return { code, name: code === '00631L' ? '元大台灣50正2' : code, market: 'ETF', candles, institutions: [], holdings: [], dataSource: 'FinMind', updatedAt: new Date().toISOString() };
  }
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
        formalVersion: 'W01 v1.13 — Decision UX & Research Navigation',
        canonical: 2971,
        evidence: 3295,
        outcomes: 22520,
        ready: 4924,
        outcomeCalculationVersion: 'W01_OUTCOME_V1.0.0-SHADOW',
        health: 'DEGRADED_EXTERNAL_WITH_KNOWN_LIMITATIONS',
        researchGate: 'NOT_READY_SAMPLE',
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/quotes') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      try { return await quotes(request); } catch (error) { return Response.json({ error: String(error?.message || error) }, { status: 502 }); }
    }
    if (url.pathname === '/api/fundamentals') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const code = url.searchParams.get('code');
      if (!/^\d{4}$/.test(code || '')) return Response.json({ error: 'Invalid instrument' }, { status: 400 });
      let revenue = [], eps2025 = null, gap = '';
      const end = formatUtcDate(new Date());
      const results = await Promise.allSettled([
        finMind('TaiwanStockMonthRevenue', code, '2023-01-01', end),
        finMind('TaiwanStockFinancialStatements', code, '2025-01-01', end),
      ]);
      if (results[0].status === 'fulfilled') {
        const all = results[0].value;
        revenue = all.filter(row => [2024, 2025, 2026].includes(row.revenue_year)).map(row => {
          const prior = all.find(other => other.revenue_year === row.revenue_year - 1 && other.revenue_month === row.revenue_month);
          return { year: row.revenue_year, month: row.revenue_month, value: row.revenue / 1e8, yoy: prior?.revenue ? (row.revenue / prior.revenue - 1) * 100 : null };
        });
      } else gap = '月營收來源目前不可用';
      if (results[1].status === 'fulfilled') {
        const rows = results[1].value.filter(row => row.type === 'EPS' && row.date.startsWith('2025'));
        if (new Set(rows.map(row => row.date.slice(5, 7))).size === 4) eps2025 = Number(rows.reduce((sum, row) => sum + row.value, 0).toFixed(2));
        else gap += '；2025A EPS 季資料不完整';
      } else gap += '；實際 EPS 來源不可用';
      return Response.json({ revenue, eps2025, gap, updated_at: new Date().toISOString() });
    }
    if (url.pathname === '/api/stock') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const code = (url.searchParams.get('code') || '').trim();
      if (!/^(?:\d{4}|00\d{3}[A-Z]?)$/.test(code)) return Response.json({ error: '請提供四碼股票或 ETF 代號' }, { status: 400 });
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
    let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{return new Response('Not found',{status:404})}
    if(!W01_PUBLIC_STATIC_PATHS.has(pathname))return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
    return env.ASSETS.fetch(request);
  },
};
