/* Research-only valuation model. No canonical writes or estimated EPS. */
globalThis.W01PEModel = (() => {
  const quantile=(a,p)=>{const n=(a.length-1)*p,i=Math.floor(n);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(n-i)};
  function build(pe,prices){
    const byDate=new Map(pe.map(r=>[r.date,r]));
    const rows=prices.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(p=>{
      const v=+byDate.get(p.date)?.PER,close=+p.close;
      return {date:p.date,price:close,pe:Number.isFinite(v)&&v>0?v:null,eps:Number.isFinite(v)&&v>0&&close>0?close/v:null};
    }).filter(r=>Number.isFinite(r.price)&&r.price>0);
    const values=rows.filter(r=>r.pe>0).map(r=>r.pe).sort((a,b)=>a-b);
    const multiples=values.length?[.1,.25,.4,.6,.75,.9].map(p=>Math.round(quantile(values,p)*10)/10):[];
    rows.forEach(r=>r.bands=r.eps>0?multiples.map(m=>r.eps*m):null);
    return {rows,multiples,quantiles:[10,25,40,60,75,90],eps_method:'SAME_DATE_CLOSE_DIVIDED_BY_EXCHANGE_REPORTED_PE',eps_is_exchange_reference_proxy:true,strict_pit_certified:false,future_estimate_used:false};
  }
  return {build,quantile};
})();
