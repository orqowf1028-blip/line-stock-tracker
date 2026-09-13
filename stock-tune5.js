(()=>{'use strict';
const nav=document.querySelector('.ux-nav');if(nav)nav.innerHTML='<a class="nav-brand" href="/">W01</a><a href="/#market">10 秒看市場</a><a href="/#teachers">30 秒看老師</a><a href="/#stocks">1 分鐘看個股</a><span>v1.13</span>';
function arrange(){const k=document.querySelector('#klinePanel'),pref=document.querySelector('#chartPreferences'),dash=document.querySelector('#dashboard'),main=document.querySelector('main'),brief=document.querySelector('#stockBrief'),f=document.querySelector('#fundamentals');if(!k||!pref||!dash||!main||!brief||!f)return;
if(!k.querySelector('.t5-settings')){const settings=document.createElement('details');settings.className='t5-settings';settings.innerHTML='<summary>⚙ 圖表設定</summary>';settings.append(pref);const note=document.createElement('small');note.textContent='SMA、圖表區間偏好目前儲存於本機瀏覽器，不會跨裝置同步。';settings.append(note);k.querySelector('.chart-head').after(settings)}
let deep=document.querySelector('#deepResearch');if(!deep){deep=document.createElement('section');deep.id='deepResearch';deep.innerHTML='<h2 class="t5-deep-heading">深度研究</h2>';dash.after(deep)}if(brief.parentElement!==deep)deep.append(brief);if(f.parentElement!==deep)deep.append(f);
const right=document.querySelector('.right');for(const b of right?.querySelectorAll(':scope > button')||[])if(b.textContent.trim()==='恢復預設順序')b.remove();
const legacy=pref.querySelector('h3 .ux-muted');if(legacy)legacy.remove();}
new MutationObserver(arrange).observe(document.body,{childList:true,subtree:true});arrange();
})();
