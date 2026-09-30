/* Local research candidate: valuation bands from exchange-reported PE and price. */
globalThis.W01PEModel = (() => {
  const quantile = (values, probability) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, sorted.length - 1);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  const median = values => quantile(values.filter(Number.isFinite), .5);
  const rollingMedian = (values, radius = 4) => values.map((value, index) => {
    if (!Number.isFinite(value)) return null;
    return median(values.slice(Math.max(0, index - radius), index + radius + 1).filter(Number.isFinite));
  });
  function build(peRows, priceRows) {
    const peByDate = new Map((peRows || []).map(row => [row.date, +row.PER]));
    const rows = (priceRows || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(row => {
      const price = +(row.close ?? row.Close ?? row.max ?? 0);
      const pe = peByDate.get(row.date);
      const usablePe = Number.isFinite(pe) && pe > 0 ? pe : null;
      return {date: row.date, price, pe: usablePe, impliedEps: usablePe && price > 0 ? price / usablePe : null};
    }).filter(row => Number.isFinite(row.price) && row.price > 0);
    const smoothed = rollingMedian(rows.map(row => row.impliedEps));
    const peValues = rows.map(row => row.pe).filter(Number.isFinite);
    const lowerFence = quantile(peValues, .03);
    const upperFence = quantile(peValues, .97);
    const robustPe = peValues.filter(value => value >= lowerFence && value <= upperFence);
    const quantiles = [10, 25, 40, 60, 75, 90];
    const multiples = robustPe.length >= 60 ? quantiles.map(q => Math.round(quantile(robustPe, q / 100) * 10) / 10) : [];
    rows.forEach((row, index) => {
      row.eps = smoothed[index];
      row.bands = row.eps > 0 && multiples.length ? multiples.map(multiple => row.eps * multiple) : null;
    });
    const usable = rows.filter(row => row.bands);
    return {
      rows, multiples, quantiles,
      coverage: {price_rows: rows.length, pe_rows: peValues.length, valuation_rows: usable.length, valuation_ratio: rows.length ? usable.length / rows.length : 0},
      eps_method: 'ROLLING_MEDIAN_OF_CLOSE_DIVIDED_BY_EXCHANGE_REPORTED_PE',
      pe_distribution_method: 'P03_P97_WINSORIZED_FULL_WINDOW_QUANTILES',
      smoothing_only: true,
      future_estimate_used: false,
      strict_pit_certified: false
    };
  }
  return {build, quantile};
})();
