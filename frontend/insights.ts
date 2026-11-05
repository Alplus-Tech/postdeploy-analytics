import { SectionLoader } from './section-loader';
import type { Insights, InsightPeriod, InsightRow } from '../worker/src/insights';
const node = <T extends HTMLElement = HTMLElement>(id: string): T => { const n=document.getElementById(id);if(!n)throw new Error(id);return n as T; };
const field = (id: string): HTMLInputElement => node<HTMLInputElement>(id);
const esc = (v: string|number): string => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
const fmt = (n: number): string => n.toLocaleString('en-GB',{maximumFractionDigits:0});
const pct = (n: number): string => `${(n*100).toFixed(1)}%`;
const colors=['#16866c','#3f68b5','#a25191','#986100','#526668','#b13c35','#666666'];
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const loader=new SectionLoader();
window.addEventListener('pagehide',()=>loader.stop());
window.addEventListener('pageshow',event=>{if(event.persisted){restore();void load();}});
let data: Insights|null=null, query=new URLSearchParams(), generation=0;
const params=():URLSearchParams=>new URLSearchParams(location.search);
function table(title: string, columns: string[], rows: (string|number)[][]): string {
 return `<details><summary>Exact table · ${esc(title)}</summary><div class="org-scroll" tabindex="0" role="region" aria-label="${esc(title)} table, scroll for more columns"><table class="table"><caption>${esc(title)}</caption><thead><tr>${columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((c,i)=>`<${i?'td':'th scope="row"'}>${esc(c)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function download(dataset: string): string {const p=new URLSearchParams(query);p.set('dataset',dataset);return `<a class="btn btn-sm" href="/api/insights?${esc(p.toString())}">Download ${esc(dataset)} CSV</a>`;}
function svg(title: string, body: string): string {return `<svg viewBox="0 0 800 260" role="img" aria-label="${esc(title)}" class="insight-chart">${body}</svg>`;}
function trend(id: string, p: InsightPeriod, prev: InsightPeriod|null, metric: 'pageviews'|'visitorDays'|'completions'|'rate'): string {
 const values=p.timeline.map(r=>r[metric]);const max=Math.max(metric==='rate'?1:0,...values,...(prev?.timeline.map(r=>r[metric])??[]),1);
 const x=(i:number):number=>55+i*720/Math.max(1,values.length-1),y=(v:number):number=>215-v/max*185;
 const points=(rows:InsightRow[]):string=>rows.map((r,i)=>`${x(i)},${y(r[metric])}`).join(' ');
 const unit=metric==='rate'?'Daily-unique completion rate':metric==='visitorDays'?'Visitor-days':metric==='completions'?'Completion occurrences':'Pageviews';
 return `<p>${esc(unit)} · ${esc(p.granularity)} buckets · ${esc(data?.timezone??'')}. Solid: selected; dashed: comparison aligned by bucket position.</p>${svg(`${unit} over time; inspect using slider or exact table below`, `<path d="M55 30V215H775" stroke="currentColor" fill="none" opacity=".3"/><text x="4" y="35">${metric==='rate'?pct(max):fmt(max)}</text><text x="35" y="219">0</text><polygon points="55,215 ${points(p.timeline)} ${x(values.length-1)},215" fill="#16866c" opacity=".12"/>${prev?`<polyline points="${points(prev.timeline)}" fill="none" stroke="#526668" stroke-width="2" stroke-dasharray="7 5"/>`:''}<polyline points="${points(p.timeline)}" fill="none" stroke="#16866c" stroke-width="3"/><text x="55" y="245">${esc(p.timeline[0]?.label??'')}</text><text x="775" y="245" text-anchor="end">${esc(p.timeline.at(-1)?.label??'')}</text>`)}<label class="inspect">Inspect ${esc(unit.toLowerCase())} bucket<input id="${id}" type="range" min="0" max="${Math.max(0,values.length-1)}" value="0"></label><p class="inspection" id="${id}-detail" role="status"></p>${table(unit,['Bucket','Pageviews','Visitor-days','Completions','Converted visitor-days','Eligible visitor-days','Rate','Comparison bucket','Comparison value'],p.timeline.map((r,i)=>[r.label,r.pageviews,r.visitorDays,r.completions,r.convertedVisitorDays,r.conversionVisitorDays,pct(r.rate),prev?.timeline[i]?.label??'—',prev?.timeline[i]?metric==='rate'?pct(prev.timeline[i].rate):prev.timeline[i][metric]:'—']))}`;
}
function wireTrend(id:string,p:InsightPeriod,prev:InsightPeriod|null,metric:'pageviews'|'visitorDays'|'completions'|'rate',root:HTMLElement):void {
 const input=root.querySelector<HTMLInputElement>('#'+id),detail=root.querySelector<HTMLElement>('#'+id+'-detail');if(!input||!detail)return;const show=():void=>{const i=Number(input.value),r=p.timeline[i],old=prev?.timeline[i];if(!r)return;const text=`${r.label}: ${metric==='rate'?pct(r.rate):fmt(r[metric])}. ${fmt(r.convertedVisitorDays)} converted / ${fmt(r.conversionVisitorDays)} eligible visitor-days; ${fmt(r.completions)} completion occurrences.${old?` Comparison ${old.label}: ${metric==='rate'?pct(old.rate):fmt(old[metric])}.`:''}`;detail.textContent=text;input.setAttribute('aria-valuetext',text);};input.addEventListener('input',show);show();
 const chart=input.closest('section')?.querySelector('svg');chart?.addEventListener('pointerdown',e=>{const rect=chart.getBoundingClientRect();input.value=String(Math.round(Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*800-55)/720))*(p.timeline.length-1)));show();});
}
function render(section:string): void {
 if(!data)return;const d=data,p=d.main,prev=d.prev;
 const root=node('render-buffer');
 const scoped=<T extends HTMLElement=HTMLElement>(id:string):T=>{const element=root.querySelector<T>('#'+id);if(!element)throw new Error(id);return element;};
 const field=(id:string):HTMLInputElement=>scoped<HTMLInputElement>(id);
 node('heading').textContent=`${d.name} · Insights`;
 node('scope-note').textContent=`${query.get('from')} – ${query.get('to')} · ${query.get('f')||'All traffic'}. ${d.organisation?'Organisation dates and activity buckets use UTC event timestamps. Project drilldowns use their recorded local dates; edge totals can differ.':'Project buckets use recorded local day/hour, including the timezone recorded at collection; repeated DST hours share a bin.'} ${d.organisation?'Reporting timezone':'Current project timezone'}: ${d.timezone}. Visitor-days sum project/local-day identities, never distinct people across days or projects. Activity-only continuations add no traffic or conversions.`;
 const selected=query.get('goal')??'';
 const metric=(query.get('metric')||'pageviews') as 'pageviews'|'visitorDays'|'completions';
 const categories=[...new Map(p.composition.map(r=>[r.key,r.category])).entries()];
 const max=Math.max(1,...p.timeline.map(r=>r.pageviews));
 const compBars=p.timeline.map((b,i)=>{let sum=0;return categories.map(([key,label],j)=>{const n=p.composition.find(r=>r.bucket===b.key&&r.key===key)?.pageviews??0;const y=215-(sum+n)/max*180;sum+=n;return `<rect data-category="${j}" x="${55+i*720/p.timeline.length}" y="${y}" width="${Math.max(1,720/p.timeline.length-1)}" height="${n/max*180}" fill="${colors[j%colors.length]}"><title>${esc(b.label)} · ${esc(label)}: ${n} pageviews</title></rect>`;}).join('');}).join('');
 const measured=p.duration.slice(0,6).reduce((n,r)=>n+r.visits,0),unknown=p.duration[6]?.visits??0;
 node('render-buffer').innerHTML=`<p class="insight-summary">${fmt(p.totals.pageviews)} pageviews · ${fmt(p.totals.visitorDays)} visitor-days · ${pct(p.totals.rate)} completion rate (${fmt(p.totals.convertedVisitorDays)} / ${fmt(p.totals.conversionVisitorDays)}) · ${fmt(p.totals.completions)} occurrences.${p.totals.pageviews?'':' No pageviews match this selection.'}</p>
 <nav class="actions insight-sections" aria-label="Analysis sections"><a href="#traffic">Traffic</a><a href="#acquisition">Acquisition</a><a href="#conversion">Conversion</a><a href="#activity">Activity</a><a href="#duration">Duration</a></nav>
 <section id="traffic" class="panel insight-section"><h2>How is traffic changing?</h2>${trend('traffic-inspect',p,prev,metric)}${download('timeline')}</section>
 <section class="panel insight-section"><h2>What makes up the traffic?</h2><p>Pageviews stacked by ${esc(d.compositionDimension)}. Top six across the whole selected period; Other includes every remaining category. Toggle visibility to inspect a layer; totals and tables keep all categories.</p><div class="insight-legend">${categories.map(([k,label],i)=>`<label><input type="checkbox" data-layer="${i}" checked><span style="background:${colors[i%colors.length]}"></span>${esc(label)}</label>`).join('')}</div>${svg('Stacked pageviews over time; exact composition table below',`<text x="4" y="35">${fmt(max)}</text><text x="35" y="219">0</text>${compBars}<text x="55" y="245">${esc(p.timeline[0]?.label??'')}</text><text x="775" y="245" text-anchor="end">${esc(p.timeline.at(-1)?.label??'')}</text>`)}<label class="inspect">Inspect composition bucket<input id="composition-inspect" type="range" min="0" max="${p.timeline.length-1}" value="0"></label><p id="composition-detail" role="status"></p>${table('Traffic composition' ,['Bucket','Category','Pageviews'],p.composition.map(r=>[p.timeline.find(b=>b.key===r.bucket)?.label??r.bucket,r.category,r.pageviews]))}${download('composition')}</section>
 <section id="acquisition" class="panel insight-section"><h2>Where does useful traffic come from?</h2><p>Ranked ${esc(d.dimension)} · top 20 by pageviews, plus a complete Other union. Shares use all selected pageviews. Conversion rates use the selected goal and the same filtered event window. Page rows describe the event path; landing pages use visit entry.</p><div class="ranked-bars">${p.ranking.map(r=>{const share=p.totals.pageviews?r.pageviews/p.totals.pageviews:0;const next=new URLSearchParams(query);next.delete('goal');if(d.dimension==='project'&&r.key!=='other'){next.delete('org');next.set('site',r.key.slice(2));next.set('dimension','source');}else if(r.key!=='other'){const dim=d.dimension;const value=r.key.slice(2);if(value.length<=300&&!value.includes('|'))next.set('f',[query.get('f'),`${dim}:${value}`].filter(Boolean).join('|'));}return `<div class="rank"><div>${r.key!=='other'&&(d.dimension==='project'||(r.key.slice(2).length>0&&r.key.slice(2).length<=300&&!r.key.includes('|')))?`<a href="/insights?${esc(next.toString())}">${esc(r.label)}</a>`:esc(r.label)}<span>${fmt(r.pageviews)} · ${pct(share)}</span></div><div class="rank-track"><span style="width:${share*100}%"></span></div></div>`;}).join('')}</div>${table('Ranked acquisition',['Category','Pageviews','Share','Completions','Converted visitor-days','Eligible visitor-days','Rate'],p.ranking.map(r=>[r.label,r.pageviews,pct(p.totals.pageviews?r.pageviews/p.totals.pageviews:0),r.completions,r.convertedVisitorDays,r.conversionVisitorDays,pct(r.rate)]))}${download('ranking')}</section>
 <section id="conversion" class="panel insight-section"><h2>Is traffic completing the goal?</h2><p>${esc(d.goals.find(g=>g.key===selected)?.name??'All goals, union of converted visitor-days')}. Rates divide converted visitor-days by the same bucket’s eligible visitor-days (the goal’s project when one goal is selected). Repeated completions count as occurrences. Hourly visitor-days can repeat between hours; weekly buckets deduplicate project/local days. Empty denominators produce 0%, with counts shown on inspection.</p>${trend('conversion-inspect',p,prev,'rate')}${download('timeline')}</section>
 <section id="activity" class="panel insight-section"><h2>When does traffic arrive?</h2><p>Pageview totals over the selected period, grouped by weekday and hour (${esc(d.timezone)}${d.organisation?' UTC event time':'; recorded local time, including historical timezone settings'}). No per-day normalisation. Darker cells mean more pageviews; inspect a cell or open the table.</p><div class="org-scroll" role="region" aria-label="Weekday and hour heatmap" tabindex="0"><div class="heatmap">${['',...Array.from({length:24},(_,h)=>String(h).padStart(2,'0'))].map(s=>`<span>${s}</span>`).join('')}${weekdays.map((day,w)=>`<span>${day.slice(0,3)}</span>${p.heatmap.filter(r=>r.weekday===w).map(r=>{const max=Math.max(1,...p.heatmap.map(h=>h.pageviews));return `<span class="heat" data-cell="${w*24+r.hour}" style="background:rgba(22,134,108,${r.pageviews?0.15+r.pageviews/max*.85:0})" title="${day} ${r.hour}:00: ${r.pageviews} pageviews"></span>`;}).join('')}`).join('')}</div></div><label class="inspect">Inspect weekday / hour<input id="heat-inspect" type="range" min="0" max="167" value="0"></label><p id="heat-detail" role="status"></p>${table('Weekday and hour activity',['Weekday (Sunday=0)','Hour','Pageviews'],p.heatmap.map(r=>[r.weekday,r.hour,r.pageviews]))}${download('heatmap')}</section>
 <section id="duration" class="panel insight-section"><h2>How long are visits visible?</h2><p>${fmt(measured)} measured of ${fmt(measured+unknown)} selected visits (${pct(measured+unknown?measured/(measured+unknown):0)} coverage). ${fmt(unknown)} unknown visits are excluded from the histogram. Includes measured single-page visits and measured zeroes. Full visible duration of visits starting within the selected period; page filters select matching visits. No median is inferred from bins.</p><div class="histogram" role="img" aria-label="Visible visit duration distribution; exact counts below">${p.duration.slice(0,6).map(r=>`<div><span class="hist-bar" style="height:${r.visits/Math.max(1,...p.duration.slice(0,6).map(b=>b.visits))*150}px"></span><strong>${fmt(r.visits)}</strong><span>${esc(r.label)}</span></div>`).join('')}</div>${table('Visible duration distribution',['Bin','Visits'],p.duration.map(r=>[r.label,r.visits]))}${download('duration')}</section>`;
 const compositionInput=field('composition-inspect'),compositionDetail=scoped('composition-detail'),heatInput=field('heat-inspect'),heatDetail=scoped('heat-detail');
 const inspectComposition=():void=>{const b=p.timeline[Number(compositionInput.value)];if(!b)return;const text=`${b.label}: `+categories.map(([key,label])=>`${label}: ${p.composition.find(r=>r.bucket===b.key&&r.key===key)?.pageviews??0} pageviews`).join('; ');compositionDetail.textContent=text;compositionInput.setAttribute('aria-valuetext',text);};compositionInput.addEventListener('input',inspectComposition);inspectComposition();
 if(section==='timeline'){wireTrend('traffic-inspect',p,prev,metric,root);wireTrend('conversion-inspect',p,prev,'rate',root);}
 node('render-buffer').querySelectorAll<HTMLInputElement>('[data-layer]').forEach(input=>input.addEventListener('change',()=>{input.closest('section')?.querySelectorAll<SVGElement>(`[data-category="${input.dataset.layer}"]`).forEach(rect=>rect.style.visibility=input.checked?'visible':'hidden');}));
 const showHeat=(i:number):void=>{const r=p.heatmap[i];if(!r)return;const text=`${weekdays[r.weekday]} ${String(r.hour).padStart(2,'0')}:00: ${fmt(r.pageviews)} pageviews`;heatDetail.textContent=text;heatInput.setAttribute('aria-valuetext',text);};heatInput.addEventListener('input',()=>showHeat(Number(heatInput.value)));showHeat(0);
 node('render-buffer').querySelectorAll<HTMLElement>('[data-cell]').forEach(cell=>cell.addEventListener('pointerdown',()=>{heatInput.value=cell.dataset.cell??'0';showHeat(Number(cell.dataset.cell));}));
}
async function load(push=false):Promise<void>{
 const seq=++generation;node('status').textContent='Loading insights…';node('report').innerHTML='';
 const p=params();for(const id of ['from','to','dimension','composition','goal','metric','f']){const value=field(id).value;if(value)p.set(id,value);else p.delete(id);}
 if(field('compare').value==='prev'){if(push||!p.has('cmpFrom')||!p.has('cmpTo')){const start=Date.parse(field('from').value),end=Date.parse(field('to').value);if(Number.isFinite(start)&&Number.isFinite(end)){p.set('cmpFrom',new Date(start-(end-start)-86400000).toISOString().slice(0,10));p.set('cmpTo',new Date(start-86400000).toISOString().slice(0,10));}}}else{p.delete('cmpFrom');p.delete('cmpTo');}
 query=p;if(push)history.pushState(null,'','/insights?'+p);
 loader.reset(); data=null;
 node('heading').textContent=`${p.get('org')??p.get('site')??'Analytics'} · Insights`;
 node('scope-note').textContent=`${p.get('from')} – ${p.get('to')} · ${p.get('org')?'UTC organisation event window':'Recorded project local dates'} · ${p.get('f')||'All traffic'}${p.has('cmpFrom')?' · Comparison '+p.get('cmpFrom')+' – '+p.get('cmpTo'):''}`;
 const sections=['summary','timeline','composition','ranking','heatmap','duration'] as const;
 node('report').innerHTML=sections.map(section=>`<section class="panel insight-section" id="section-${section}" aria-label="${section}"><h2>${({summary:'Traffic summary',timeline:'Traffic and goal trends',composition:'Traffic composition',ranking:'Acquisition',heatmap:'Arrival times',duration:'Visit duration'})[section]}</h2><div id="result-${section}" role="status">Waiting for exact ${section}…</div></section>`).join('')+'<div id="render-buffer" hidden></div>';
 node('status').textContent='Sections load independently. Exact tables and CSV downloads are included with each chart.';
 const blank=():InsightPeriod=>({granularity:'day',totals:{label:'',key:'',pageviews:0,visitorDays:0,completions:0,convertedVisitorDays:0,conversionVisitorDays:0,rate:0},timeline:[],composition:[],ranking:[],heatmap:[],duration:[]});
 for(const section of sections){
   const q=new URLSearchParams(p);q.set('section',section);q.delete('dataset');
   q.delete('cmpFrom');q.delete('cmpTo');
   const target=node('result-'+section);
   let selectedPacket: Insights|null=null, comparisonPacket: Insights|null=null;
    const draw=(value: unknown):void=>{
     if(seq!==generation)return;
     const source=value as Insights;
     const packet={...source,prev:comparisonPacket?.main??null};
     if(section==='summary') {
       node('heading').textContent=packet.name+' · Insights';
       const goal=node<HTMLSelectElement>('goal');const selected=query.get('goal')??'';goal.innerHTML='<option value="">All goals (union)</option>'+packet.goals.map(g=>`<option value="${esc(g.key)}">${esc(g.name)}</option>`).join('');goal.value=selected;
       target.textContent=`${fmt(packet.main.totals.pageviews)} pageviews · ${fmt(packet.main.totals.visitorDays)} project visitor-days.${packet.main.totals.pageviews?'':' No pageviews match this selection.'}${packet.prev?` Comparison: ${fmt(packet.prev.totals.pageviews)} pageviews · ${fmt(packet.prev.totals.visitorDays)} visitor-days.`:''}`;
       return;
     }
     data={...packet,main:{...blank(),...packet.main},prev:packet.prev?{...blank(),...packet.prev}:null};
     render(section);
     const buffer=node('render-buffer');
     const selectors={timeline:'#traffic, #conversion',composition:'section:nth-of-type(2)',ranking:'#acquisition',heatmap:'#activity',duration:'#duration'};
     target.previousElementSibling?.remove();target.parentElement?.classList.remove('panel');target.replaceChildren(...buffer.querySelectorAll(selectors[section]));buffer.replaceChildren();
    };
    loader.enqueue('/api/insights?'+q,target,value=>{selectedPacket=value as Insights;draw(value);});
    if(section==='timeline'&&p.has('cmpFrom')) {
      const comparisonState=document.createElement('p');comparisonState.setAttribute('role','status');comparisonState.textContent='Waiting for comparison…';target.after(comparisonState);
      const cq=new URLSearchParams(q);cq.set('from',p.get('cmpFrom')??'');cq.set('to',p.get('cmpTo')??'');
      loader.enqueue('/api/insights?'+cq,comparisonState,value=>{comparisonPacket=value as Insights;if(selectedPacket)draw(selectedPacket);comparisonState.textContent=`Comparison ${cq.get('from')} – ${cq.get('to')} included.`;});
    }
 }
  if(p.has('cmpFrom')) {
    const comparison=document.createElement('section');comparison.className='panel';comparison.setAttribute('aria-label','Comparison traffic summary');
    const title=document.createElement('h2');title.textContent='Comparison traffic summary';comparison.append(title);
    const result=document.createElement('p');result.textContent='Waiting for comparison…';comparison.append(result);document.getElementById('result-summary')?.after(comparison);
    const q=new URLSearchParams(p);q.set('from',q.get('cmpFrom')??'');q.set('to',q.get('cmpTo')??'');q.delete('cmpFrom');q.delete('cmpTo');q.set('section','summary');
    loader.enqueue('/api/insights?'+q,result,value=>{const d=value as {main:{totals:{pageviews:number;visitorDays:number}}};result.textContent=`${q.get('from')} – ${q.get('to')}: ${fmt(d.main.totals.pageviews)} pageviews · ${fmt(d.main.totals.visitorDays)} visitor-days`;});
  }


}
function restore():void{const p=params();node('goal').innerHTML=p.get('goal')?`<option value="${esc(p.get('goal')??'')}">Selected goal</option>`:'<option value="">All goals (union)</option>';const today=new Date().toISOString().slice(0,10);for(const id of ['dimension','composition','goal','metric','f'])field(id).value=p.get(id)??(id==='dimension'?(p.has('org')?'project':'source'):id==='composition'?'source':id==='metric'?'pageviews':'');field('from').value=p.get('from')??new Date(Date.now()-29*86400000).toISOString().slice(0,10);field('to').value=p.get('to')??today;field('compare').value=p.has('cmpFrom')?'prev':'off';}
async function init():Promise<void>{await window.PostDeployAuth.refresh();if(!window.PostDeployAuth.user){location.assign('/auth');return;}restore();node('controls').addEventListener('submit',e=>{e.preventDefault();void load(true);});node('clear').addEventListener('click',()=>{field('f').value='';field('goal').value='';void load(true);});window.addEventListener('popstate',()=>{restore();void load();});node('logout').addEventListener('click',()=>void window.PostDeployAuth.logout());await load();}
void init().catch(e=>{node('status').textContent=`${e instanceof Error?e.message:String(e)} Reload to retry.`;});
