(() => {
  'use strict';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cachePromise = fetch('/ui-data/eps-estimates.json').then(response => {
    if (!response.ok) throw new Error(`EPS cache ${response.status}`);
    return response.json();
  });
  let lastSignature = '';

  function formatValue(item) {
    return Number.isFinite(+item?.value) ? (+item.value).toFixed(2) : 'N/A';
  }

  function yoy(next, base) {
    const a = +next?.value;
    const b = +base?.value;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return (a - b) / Math.abs(b) * 100;
  }

  function formatYoy(value, missing) {
    if (!Number.isFinite(value)) return `N/A（缺 ${escapeHtml(missing)}）`;
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  }

  function provenance(item) {
    if (!item) return '<span class="eps-gap">來源不足</span>';
    const label = item.value_type === 'actual' ? '實際' : item.value_type === 'estimate' ? '預估' : '代理';
    return `<span class="eps-grade grade-${escapeHtml(item.source_grade)}">${escapeHtml(item.source_grade)}</span> ${escapeHtml(label)} · ${escapeHtml(item.source_name)} · as of ${escapeHtml(item.as_of || '未標示')}`;
  }

  function renderUnavailable(host, record) {
    const article = host.querySelector('article');
    if (!article) return;
    const heading = [...article.querySelectorAll('h3')].find(node => node.textContent.trim() === 'EPS');
    if (!heading) {
      if (!article.querySelector('.eps-research-block')) {
        const block = document.createElement('div');
        block.className = 'eps-research-block';
        block.dataset.epsCoverage = code;
        block.innerHTML = `<div class="eps-na"><strong>EPS／YoY：不適用</strong><br>${escapeHtml(record?.reason || '此商品沒有可比較的公司每股盈餘。')}</div>`;
        article.append(block);
      }
      const name = document.querySelector('#name');
      if (name && name.textContent.includes('載入中')) name.textContent = `${record?.display_name || code}（${code}）`;
      const loading = document.querySelector('#loading');
      if (loading?.textContent.includes('official source')) {
        loading.textContent = 'ETF／特殊商品介面已啟用；公司 EPS 與本益比不適用。';
        loading.classList.remove('error');
      }
      return;
    }
    heading.dataset.tuned = 'true';
    const old = heading.nextElementSibling;
    const block = document.createElement('div');
    block.className = 'eps-research-block';
    block.dataset.epsCoverage = code;
    block.innerHTML = `<div class="eps-na"><strong>EPS／YoY：不適用</strong><br>${escapeHtml(record?.reason || '此商品沒有可比較的公司每股盈餘。')}</div>`;
    old?.replaceWith(block);
  }

  function renderTable(host, record, methodology) {
    const article = host.querySelector('article');
    if (!article) return;
    const heading = [...article.querySelectorAll('h3')].find(node => node.textContent.trim() === 'EPS');
    if (!heading) return;
    heading.dataset.tuned = 'true';
    const values = record?.values || {};
    const actual = values['2025A'];
    const estimate26 = values['2026E'];
    const estimate27 = values['2027E'];
    const rows = [
      ['2025A', actual, '—'],
      ['2026E', estimate26, formatYoy(yoy(estimate26, actual), '2025A')],
      ['2027E', estimate27, formatYoy(yoy(estimate27, estimate26), '2026E')]
    ];
    const block = document.createElement('div');
    block.className = 'eps-research-block';
    block.dataset.epsCoverage = code;
    block.innerHTML = `
      <table class="ux-table eps-table">
        <thead><tr><th>年度</th><th>EPS（TWD）</th><th>YoY</th><th>資料層／來源</th></tr></thead>
        <tbody>${rows.map(([year, item, growth]) => `
          <tr data-eps-year="${year}">
            <td>${year}</td>
            <td>${formatValue(item)}</td>
            <td class="${String(growth).startsWith('+') ? 'up' : String(growth).startsWith('-') ? 'down' : ''}">${growth}</td>
            <td>${provenance(item)}</td>
          </tr>`).join('')}</tbody>
      </table>
      <details class="eps-source-details">
        <summary>資料可信度、日期與缺值規則</summary>
        <p>2026E YoY：${escapeHtml(methodology['2026E_yoy'])}<br>2027E YoY：${escapeHtml(methodology['2027E_yoy'])}</p>
        <p>估計值為單一公開市場資料供應者的年度預估，不冒稱市場共識；actual 與 estimate 分開標示。只有來源值或分母真的缺少／為 0 時才顯示 N/A。</p>
        ${Object.entries(values).map(([year, item]) => `<p><b>${year}</b> · ${provenance(item)} · observed ${escapeHtml(item.observed_at || '未標示')} · <a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener">來源</a></p>`).join('')}
      </details>`;
    heading.nextElementSibling?.replaceWith(block);
    article.querySelectorAll('p').forEach(note => {
      if (note.textContent.includes('預估 EPS 缺少可靠來源，維持 N/A')) {
        note.innerHTML = '2025A 實際值與 2026E／2027E 預估值分層顯示；來源等級與日期見上方明細。估計不寫入 Canonical／Outcome。';
      }
    });
  }

  async function update() {
    const host = document.querySelector('#fundamentals');
    if (!host || typeof code === 'undefined') return;
    const activeCode = String(code).toUpperCase();
    const signature = `${activeCode}:${host.textContent.length}`;
    if (lastSignature === signature && host.querySelector(`.eps-research-block[data-eps-coverage="${activeCode}"]`)) return;
    try {
      const cache = await cachePromise;
      if (String(code).toUpperCase() !== activeCode) return;
      const record = cache.by_ticker?.[activeCode];
      if (/^00\d/.test(activeCode) || record?.applicability === 'NOT_APPLICABLE') renderUnavailable(host, record);
      else renderTable(host, record, cache.methodology);
      lastSignature = signature;
    } catch (error) {
      console.warn('EPS research view unavailable', error);
    }
  }

  new MutationObserver(update).observe(document.querySelector('#fundamentals'), {childList:true, subtree:true});
  update();
  window.W01EPSResearch = {yoy, update};
})();
