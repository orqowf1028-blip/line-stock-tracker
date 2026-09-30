(()=>{'use strict';
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cache={
2330:{industry:'晶圓代工／先進製程',role:'AI／HPC 晶片的製造供應鏈環節；不是終端 AI 軟體公司。',background:'公司 2Q26 法說指出先進製程需求強；2nm 放量是下半年重要營運因素。',risk:'2nm 初期放量、海外廠成本與匯率可能壓抑毛利，需求強不等於短期股价必漲。',url:'https://investor.tsmc.com/english/quarterly-results/2026/q2',date:'2026-07-16',eps:[107.4,141.3],estimate:'https://www.marketscreener.com/quote/stock/TSMC-TAIWAN-SEMICONDUCTOR-6492349/finances/',attempts:'W01 沒有正式預估 EPS；MarketScreener 2330 TWD／12月年結可用；FactSet 台積電 ADR 與 INVX／Bloomberg 報告是美元 ADR 或成長率口徑，本輪不換算／不混用。'},
8046:{industry:'PCB／IC 載板',role:'公司產品含 ABF／PP IC 載板與 HDI PCB；供應半導體封裝及電子系統互連。',background:'產品與技術路線來自公司公開資料；近期需求催化以老師 Evidence 為準，不由公司產品列表推定當期訂單。',risk:'注意載板景氣、產品組合與擴產利用率；本輪沒有獨立驗證未公布訂單。',url:'https://www.nanyapcb.com.tw/nypcb/english/index',date:null,eps:[18.08,45.46],estimate:'https://www.marketscreener.com/quote/stock/NAN-YA-PRINTED-CIRCUIT-BO-6498761/finances/',attempts:'W01 無正式預估 EPS；MarketScreener 年度 12月年結 TWD 可用。calendar 頁標六月是季度展示，不能拿季度數字當全年；其他獨立全年 EPS 來源尚未確認。'}
};
const brief=document.querySelector('#stockBrief'),fund=document.querySelector('#fundamentals');
function update(){const c=code,r=cache[c];const why=[...brief.querySelectorAll('.ux-card')].find(x=>x.querySelector('.ux-label')?.textContent==='Why Now');if(why&&!why.dataset.industry){why.dataset.industry='true';const old=why.querySelector('p')?.textContent||'';why.innerHTML='<span class="ux-label">Why Now</span><h3>產業背景 · '+E(r?.industry||'尚無已核對公開產業資料')+'</h3><p>'+E(r?.background||'不以老師訊號猜公司業務；此股公開研究補充仍待核對。')+'</p><p>'+E(r?.role||'')+'</p><b>老師近期觀點</b><p>'+E(old)+'</p><small>既有 Evidence，不是模型產業背景。</small><p><b>風險：</b>'+E(r?.risk||'見訊號詳情中的原始風險與資料限制。')+'</p>'+(r?'<small><a target="_blank" href="'+r.url+'">公司正式來源</a> · 發布 '+E(r.date||'未標示')+' · 核對 2026-09-12</small>':'')}
// EPS table is rendered by eps-research.js so value, YoY and provenance share one maintained mapping.
}
new MutationObserver(update).observe(brief,{childList:true,subtree:true});new MutationObserver(update).observe(fund,{childList:true,subtree:true});update();
})();
