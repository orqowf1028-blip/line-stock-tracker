(function () {
  'use strict';

  const EXPECTED_ROWS = 18576;
  const EXPECTED_READY = 2595;
  const EXPECTED_HASH = '470b9a4ba1adbad0cd6b8da6430e4b518de5b1f6411d1afd96ed62e658738e90';
  let manifestPromise;
  let storePromise;

  function fetchJson(path) {
    return fetch(path, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
      return response.json();
    });
  }

  function loadManifest() {
    manifestPromise ||= fetchJson('/outcome-manifest.json').then(manifest => {
      if (manifest.outcome_rows !== EXPECTED_ROWS || manifest.by_status?.READY !== EXPECTED_READY || manifest.semantic_hash !== EXPECTED_HASH) {
        throw new Error('Outcome manifest reconciliation failed');
      }
      return manifest;
    });
    return manifestPromise;
  }

  function loadStore() {
    storePromise ||= Promise.all([loadManifest(), fetchJson('/outcome-store.json')]).then(([manifest, store]) => {
      if (!Array.isArray(store.outcomes) || store.outcomes.length !== manifest.outcome_rows || store.semantic_hash !== manifest.semantic_hash) {
        throw new Error('Outcome Store reconciliation failed');
      }
      return store;
    });
    return storePromise;
  }

  function excelDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return value || '';
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function addOutcomesSheet(workbook, store) {
    const fields = [
      'event_id', 'ticker', 'teacher_id', 'signal_definition_id', 'action', 'direction',
      'event_date', 'effective_at', 'source_time_status', 'horizon', 'calculation_version',
      'computed_at', 'price_adjustment_type', 'corporate_action_status', 'price_source',
      'status', 'outcome_status', 'eligibility_reason', 'reference_price', 'reference_price_type',
      'reference_price_semantics', 'reference_trading_date', 'reference_timestamp',
      'explicit_price_field', 'explicit_candidate_status', 'target_trading_date',
      'actual_trading_date', 'endpoint_close', 'market_return_pct', 'directional_return_pct',
      'market_mfe_pct', 'market_mae_pct', 'directional_mfe_pct', 'directional_mae_pct',
      'benchmark_id', 'excess_return_pct', 'sector_benchmark_id', 'sector_excess_return_pct',
      'benchmark_status', 'sector_benchmark_status', 'lineage'
    ];
    const dateFields = new Set(['event_date', 'reference_trading_date', 'target_trading_date', 'actual_trading_date']);
    const sheet = workbook.addWorksheet('Outcomes');
    sheet.addRow(fields);
    for (const row of store.outcomes) {
      sheet.addRow(fields.map(field => {
        const value = row[field];
        if (field === 'lineage') return value ? JSON.stringify(value) : '';
        if (dateFields.has(field)) return excelDate(value);
        return value === null || value === undefined ? '' : value;
      }));
    }
    for (const field of dateFields) sheet.getColumn(fields.indexOf(field) + 1).numFmt = 'yyyy-mm-dd';
    for (const field of ['market_return_pct', 'directional_return_pct', 'market_mfe_pct', 'market_mae_pct', 'directional_mfe_pct', 'directional_mae_pct', 'excess_return_pct', 'sector_excess_return_pct']) {
      sheet.getColumn(fields.indexOf(field) + 1).numFmt = '0.0000';
    }
    styleWorksheet(sheet, fields.map(field => field === 'lineage' || field === 'eligibility_reason' ? 48 : field.includes('timestamp') || field.includes('_at') ? 24 : field.includes('id') ? 30 : 18));
    return sheet;
  }

  const baseBuildXlsxWorkbook = window.buildXlsxWorkbook;
  window.buildXlsxWorkbook = async function buildV16XlsxWorkbook() {
    const [workbook, store, manifest] = await Promise.all([baseBuildXlsxWorkbook(), loadStore(), loadManifest()]);
    addOutcomesSheet(workbook, store);
    const info = workbook.getWorksheet('Export_Info');
    info.addRows([
      ['Formal version', 'W01 v1.6 — Outcome Incremental Maturity & Update Monitor'],
      ['Outcome calculation_version', manifest.calculation_version],
      ['Outcome row count', manifest.outcome_rows],
      ['Outcome READY', manifest.by_status.READY],
      ['Outcome computed_at', manifest.computed_at],
      ['Outcome last update', manifest.last_outcome_update],
      ['Outcome price cutoff', manifest.price_cutoff_date],
      ['Outcome run health', manifest.run_health],
      ['Outcome retry rows', manifest.retry_queue_rows],
      ['Outcome semantic hash', manifest.semantic_hash],
      ['Outcome price basis', `${store.price_adjustment_type}; corporate actions ${store.corporate_action_status}`],
      ['Outcome limitation', 'Benchmark/sector benchmark unsupported; missing price/date states remain explicit']
    ]);
    return workbook;
  };

  window.downloadXlsx = async function downloadV16Xlsx() {
    saveEditedNotes();
    const button = document.querySelector('#xlsxButton');
    const status = document.querySelector('#xlsxStatus');
    button?.classList.add('loading');
    if (button) button.disabled = true;
    status.textContent = '正在建立含 Outcomes 的 XLSX…';
    try {
      const workbook = await window.buildXlsxWorkbook();
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).replaceAll('-', '').slice(4);
      link.href = url;
      link.download = `LINE_股市同學會_投資追蹤表_${stamp}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = `XLSX 已建立：${data.length} 筆訊號／${EXPECTED_ROWS} 筆 Outcomes`;
    } catch (error) {
      status.textContent = `XLSX 匯出失敗：${error.message || error}`;
    } finally {
      button?.classList.remove('loading');
      if (button) button.disabled = false;
    }
  };

  loadManifest().then(manifest => {
    const target = document.querySelector('#outcomeStatus');
    if (target) target.textContent = `Outcome Engine：${manifest.outcome_rows.toLocaleString()} 筆／READY ${manifest.by_status.READY.toLocaleString()} 筆｜${manifest.run_health}`;
  }).catch(error => {
    const target = document.querySelector('#outcomeStatus');
    if (target) target.textContent = `Outcome Engine 暫時無法載入：${error.message || error}`;
  });
})();
