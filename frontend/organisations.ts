import { SectionLoader } from './section-loader';
import type { Organisation, OrganisationReport } from "../worker/src/organisations";

type Project = { id: string; name: string; organisationId: string };
const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing ${id}`);
  return node as T;
};
const input = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const select = (id: string): HTMLSelectElement => el<HTMLSelectElement>(id);
const escape = (value: string | number): string => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const fmt = (n: number): string => n.toLocaleString("en-GB");
const day = (at: number): string => new Date(at).toISOString().slice(0,10);
const DAY = 86400000;
let organisations: Organisation[] = [];
let projects: Project[] = [];
const loader = new SectionLoader();
window.addEventListener('pagehide',()=>loader.stop());
window.addEventListener('pageshow',event=>{if(event.persisted){restoreSelection();void load();}});
let generation = 0;


async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string,string> = {"Content-Type":"application/json"};
  const csrf = window.PostDeployAuth.csrf;
  if(csrf) headers["X-CSRF-Token"]=csrf;
  const response = await fetch(path,{method,headers,credentials:"same-origin",body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const value: unknown = await response.json();
  if(!response.ok) {
    if(response.status===401) location.assign("/auth");
    throw new Error(typeof value === "object" && value !== null && "message" in value ? String(value.message) : "The request failed. Try again.");
  }
  if(typeof value !== "object" || value === null) throw new Error("Unexpected server response.");
  return value as T;
}
function status(message: string, error = false): void {
  el("status").textContent = message;
  el("status").dataset.error = String(error);
}
function options(): void {
  select("organisation").innerHTML = organisations.map(o => `<option value="${escape(o.id)}">${escape(o.name)}</option>`).join("");
  select("destination").innerHTML = select("organisation").innerHTML;
  select("project").innerHTML = projects.map(p => `<option value="${escape(p.id)}">${escape(p.name)} — ${escape(organisations.find(o => o.id === p.organisationId)?.name ?? "")}</option>`).join("");
}
function render(data: OrganisationReport, query: URLSearchParams): void {

  const width = Math.max(300, Math.min(1000,el("render-buffer").clientWidth-72));
  const previous = data.prev;
  const max = Math.max(1, ...data.main.buckets.map(b=>b.pageviews), ...(previous?.buckets.map(b=>b.pageviews) ?? []));
  const x = (i: number): number => 45 + i * (width-65) / Math.max(1,data.main.buckets.length-1);
  const y = (n: number): number => 205 - n/max*170;
  const line = (values: {pageviews:number}[]): string => values.map((b,i)=>`${x(i)},${y(b.pageviews)}`).join(" ");
  const m = data.main.measurement;
  const current = data.main.totals.pageviews;
  const prior = previous?.totals.pageviews;
  const delta = prior === undefined ? "" : prior === 0 ? (current ? "No previous traffic for a percentage comparison" : "No traffic in either period") : `${((current-prior)/prior*100).toFixed(1)}% vs previous period`;
  const link = (id: string): string => {
    const q = new URLSearchParams({site:id,range:"custom",from:query.get("from") ?? "",to:query.get("to") ?? "",cmp:previous ? "prev":"off"});
    if(query.has("f")) q.set("f",query.get("f") ?? "");
    return `/dashboard#/overview?${q}`;
  };
  el("render-buffer").innerHTML = `<h2>${escape(data.organisation.name)}</h2><p><a class="btn" href="/insights?${escape(new URLSearchParams([...query,["org",data.organisation.id]]).toString())}">Explore insights</a></p><div class="actions">${["projects","series","goals","totals"].map(dataset=>`<a class="btn btn-sm" href="/api/organisations/${encodeURIComponent(data.organisation.id)}/export?${escape(new URLSearchParams([...query,["dataset",dataset]]).toString())}">Download ${dataset} CSV</a>`).join("")}</div><p data-part="goals" class="org-notes">Goal completions: ${fmt(data.main.conversions.completions)} · Daily-unique completion rate: ${(data.main.conversions.rate*100).toFixed(1)}% (${fmt(data.main.conversions.convertedVisitorDays)} / ${fmt(data.main.conversions.visitorDays)} project visitor-days). Repeats count in completions; the rate unions goals per project and local day within the UTC event window.</p><details data-part="goals"><summary>Goal completions by project</summary><div class="org-scroll"><table class="table"><thead><tr><th>Project</th><th>Goal</th><th>Completions</th><th>Converted visitor-days</th><th>Visitor-days</th><th>Rate</th></tr></thead><tbody>${data.main.goals.map(g=>`<tr><td>${escape(data.main.projects.find(p=>p.id===g.projectId)?.name??g.projectId)}</td><td>${escape(g.name)}</td><td>${fmt(g.completions)}</td><td>${fmt(g.convertedVisitorDays)}</td><td>${fmt(g.visitorDays)}</td><td>${(g.rate*100).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div></details><div class="org-summary"><div>Pageviews<strong>${fmt(current)}</strong><span class="muted">${escape(delta)}</span></div><div>Project visitor-days<strong>${fmt(data.main.totals.visitorDays)}</strong><span class="muted">Sum across projects, not distinct people</span></div><div>Projects<strong>${data.main.projects.length}</strong></div></div>
  <p data-part="measurement" class="org-notes">${fmt(m.visits)} visits · ${(m.bounceRate*100).toFixed(1)}% bounce · Visible visit duration: ${m.duration===null?"Unknown":`${m.duration}s`} (${fmt(m.measuredVisits)} measured visits). Visits start within the UTC range; duration divides total visible time by measured visits. A bounce has one pageview and no goal.</p>
  <section class="panel"><div class="panel-head"><h2>Traffic over time</h2></div><div class="org-chart-wrap"><p class="org-legend"><span><span class="org-key"></span>Selected period · pageviews</span>${previous?'<span><span class="org-key previous"></span>Previous period · pageviews</span>':""}</p><svg class="org-chart" viewBox="0 0 ${width} 250" role="group" aria-label="Daily pageviews in UTC; focus a point for exact values. Table below."><text x="0" y="35">${fmt(max)}</text><text x="22" y="210">0</text><path d="M45 205H${width-20}" stroke="currentColor" opacity=".2"/>${previous?`<polyline class="org-prev" points="${line(previous.buckets)}"/>`:""}<polyline class="org-trend" points="${line(data.main.buckets)}"/>${data.main.buckets.map((b,i)=>{const text=`${b.day}: ${b.pageviews} pageviews${previous?`; previous ${previous.buckets[i]?.day ?? "—"}: ${previous.buckets[i]?.pageviews ?? "—"}`:""}`;return `<circle tabindex="0" cx="${x(i)}" cy="${y(b.pageviews)}" r="4" aria-label="${text}" data-detail="${text}"><title>${text}</title></circle>`;}).join("")}<text x="45" y="240">${escape(query.get("from") ?? "")}</text><text x="${width-20}" y="240" text-anchor="end">${escape(query.get("to") ?? "")}</text></svg><p class="org-chart-detail" id="chart-detail" role="status">Focus or point to a dot to inspect a day.</p></div><details class="panel-body"><summary>Daily traffic table</summary><div class="org-scroll" tabindex="0" role="region" aria-label="Traffic table, scroll for more columns"><table class="table"><caption>Exact daily pageviews, UTC</caption><thead><tr><th scope="col">Date</th><th scope="col">Pageviews</th><th scope="col">Previous date</th><th scope="col">Previous pageviews</th></tr></thead><tbody>${data.main.buckets.map((b,i)=>`<tr><th scope="row">${b.day}</th><td>${fmt(b.pageviews)}</td><td>${previous?.buckets[i]?.day ?? "—"}</td><td>${previous?.buckets[i]?fmt(previous.buckets[i].pageviews):"—"}</td></tr>`).join("")}</tbody></table></div></details></section>
  <section class="panel org-management"><div class="panel-head"><h2>Project contribution</h2></div><div class="org-scroll" tabindex="0" role="region" aria-label="Traffic table, scroll for more columns"><table class="table"><caption>Ranked by pageviews for the selected period and filters</caption><thead><tr><th scope="col">Project</th><th scope="col">Pageviews</th><th scope="col">Share</th><th scope="col">Previous pageviews</th><th scope="col">Project visitor-days</th></tr></thead><tbody>${data.main.projects.map(p=>`<tr><th scope="row"><a href="${escape(link(p.id))}">${escape(p.name)}</a><br><span class="muted">${escape(p.domain)}</span></th><td>${fmt(p.pageviews)}</td><td>${current?(p.pageviews/current*100).toFixed(1):"0.0"}%<span class="org-bar" style="width:${current?p.pageviews/current*100:0}%" aria-hidden="true"></span></td><td>${previous?fmt(previous.projects.find(v=>v.id===p.id)?.pageviews ?? 0):"—"}</td><td>${fmt(p.visitorDays)}</td></tr>`).join("") || '<tr><td colspan="5">No projects yet. An administrator can create or move a project here.</td></tr>'}</tbody></table></div></section>
  <p class="org-notes muted">${current?"":"No pageviews match this period and filter. "}Organisation dates and chart buckets use UTC event times. Project visitor-days sum each project's local-day visitor identities that appear in this UTC window. People may count across projects and days; this is not a deduplicated audience. Project drilldowns retain each project's own timezone, so date-edge totals may differ. Moving projects includes their full history in their current organisation. Page filters select matching visits within the period.</p>`;
  el("render-buffer").querySelectorAll<SVGCircleElement>("circle[data-detail]").forEach(point => {
    for(const event of ["focus","pointerenter"]) point.addEventListener(event,()=>{el("chart-detail").textContent=point.dataset.detail ?? "";});
  });
}
async function load(push=false): Promise<void> {
  const current = ++generation;

  el("report").innerHTML = "";
  status("Loading traffic…");
  const id = select("organisation").value;
  const query = new URLSearchParams({ from:input("from").value,to:input("to").value });
  if(input("value").value) query.set("f",`${select("dimension").value}:${input("value").value}`);
  if(select("compare").value === "prev") {
    const start = Date.parse(input("from").value+"T00:00:00Z");
    const end = Date.parse(input("to").value+"T00:00:00Z");
    if(Number.isFinite(start) && Number.isFinite(end)) { query.set("cmpFrom",day(start-(end-start)-DAY)); query.set("cmpTo",day(start-DAY)); }
  }
  const address = new URLSearchParams(query); address.set("org",id); address.set("compare",select("compare").value);
  if(push) history.pushState(null,"",`/organisations?${address}`);
  else history.replaceState(null,"",`/organisations?${address}`);
  input("rename").value = organisations.find(o=>o.id===id)?.name ?? "";
  loader.reset();
  el('report').innerHTML=`<h2>${escape(organisations.find(o=>o.id===id)?.name??id)}</h2><p>${escape(query.get('from')??'')} – ${escape(query.get('to')??'')} · UTC event window · ${escape(query.get('f')??'All traffic')}</p>`+['summary','series','goals','measurement'].map(section=>`<section class="panel" aria-label="${section}"><h2>${section==='summary'?'Traffic summary':section==='series'?'Traffic over time':section==='goals'?'Goal completions':'Visit measurement'}</h2><div id="result-${section}" role="status">Waiting for exact ${section}…</div></section>`).join('')+'<div id="render-buffer" hidden></div>';
  status('Sections load independently.');
  for(const section of ['summary','series','goals','measurement']) {
    const q=new URLSearchParams(query); q.set('section',section); q.delete('cmpFrom');q.delete('cmpTo');
    const target=el<HTMLElement>('result-'+section);
    let selectedPacket: OrganisationReport|null=null, comparisonPacket: OrganisationReport|null=null;
    const draw=(value: unknown):void=>{
      if(current!==generation)return;
      const source=value as OrganisationReport;
     const packet={...source,prev:comparisonPacket?.main??null};
      const blank=():OrganisationReport['main']=>({totals:{pageviews:0,visitorDays:0},buckets:[],projects:[],goals:[],conversions:{completions:0,visitorDays:0,convertedVisitorDays:0,rate:0},measurement:{visits:0,bounces:0,measuredVisits:0,visibleMs:0,bounceRate:0,duration:null}});
      const data={...packet,main:{...blank(),...packet.main},prev:packet.prev?{...blank(),...packet.prev}:null};
      render(data,query);
      const buffer=el<HTMLElement>('render-buffer');
      if(section==='summary') {target.parentElement?.classList.remove('panel');buffer.querySelector('h2')?.remove();const contribution=buffer.querySelector('.org-management');if(contribution){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Project contribution · ${packet.main.projects.length} projects`;contribution.replaceWith(details);details.append(summary,contribution);}buffer.querySelector('.org-chart-wrap')?.closest('section')?.remove();buffer.querySelectorAll('[data-part]').forEach(n=>n.remove());target.replaceChildren(...buffer.childNodes);}
      else if(section==='series') {target.previousElementSibling?.remove();target.parentElement?.classList.remove('panel');const chart=buffer.querySelector('.org-chart-wrap')?.closest('section');target.replaceChildren(...(chart?[chart]:[]));}
      else target.replaceChildren(...buffer.querySelectorAll(`[data-part="${section}"]`));
      buffer.replaceChildren();
    };
    loader.enqueue(`/api/organisations/${encodeURIComponent(id)}/report?`+q,target,value=>{selectedPacket=value as OrganisationReport;draw(value);});
    if(section==='series'&&query.has('cmpFrom')) {
      const comparisonState=document.createElement('p');comparisonState.setAttribute('role','status');comparisonState.textContent='Waiting for comparison…';target.after(comparisonState);
      const cq=new URLSearchParams(q);cq.set('from',query.get('cmpFrom')??'');cq.set('to',query.get('cmpTo')??'');
      loader.enqueue(`/api/organisations/${encodeURIComponent(id)}/report?`+cq,comparisonState,value=>{comparisonPacket=value as OrganisationReport;if(selectedPacket)draw(selectedPacket);comparisonState.textContent=`Comparison ${cq.get('from')} – ${cq.get('to')} included.`;});
    }
  }
  if(query.has('cmpFrom')) {
    const comparison=document.createElement('section');comparison.className='panel';comparison.setAttribute('aria-label','Comparison traffic summary');
    const title=document.createElement('h2');title.textContent='Comparison traffic summary';comparison.append(title);
    const result=document.createElement('p');result.textContent='Waiting for comparison…';comparison.append(result);document.getElementById('result-summary')?.after(comparison);
    const q=new URLSearchParams(query);q.set('from',q.get('cmpFrom')??'');q.set('to',q.get('cmpTo')??'');q.delete('cmpFrom');q.delete('cmpTo');q.set('section','summary');
    loader.enqueue(`/api/organisations/${encodeURIComponent(id)}/report?`+q,result,value=>{const d=value as {main:{totals:{pageviews:number;visitorDays:number}}};result.textContent=`${q.get('from')} – ${q.get('to')}: ${fmt(d.main.totals.pageviews)} pageviews · ${fmt(d.main.totals.visitorDays)} visitor-days`;});
  }


}
async function mutate(form: HTMLFormElement, action: () => Promise<void>): Promise<void> {
  const button=form.querySelector("button"); if(button) button.disabled=true;
  try { await action(); await load(); } catch(e) { status(e instanceof Error?e.message:String(e),true); } finally { if(button) button.disabled=false; }
}
function restoreSelection(): void {
  const q = new URLSearchParams(location.search);
  const id=q.get("org") ?? organisations[0]?.id ?? "";
  if(!organisations.some(o=>o.id===id)) { status("This organisation does not exist. Choose an organisation to continue.",true); select("organisation").selectedIndex=-1; } else select("organisation").value=id;
  input("from").value=q.get("from") ?? day(Date.now()-29*DAY); input("to").value=q.get("to") ?? day(Date.now());
  select("compare").value=q.get("compare")==="off"?"off":"prev";
  input("value").value="";
  const f=q.get("f") ?? ""; if(f.includes(":")) { select("dimension").value=f.slice(0,f.indexOf(":")); input("value").value=f.slice(f.indexOf(":")+1); }
}
async function start(): Promise<void> {
  const auth = await window.PostDeployAuth.refresh();
  if(!auth.user) { location.replace("/auth"); return; }
  [organisations,projects] = await Promise.all([api<Organisation[]>("/api/organisations"),api<Project[]>("/api/sites/catalog")]);
  options();
  restoreSelection();
  window.addEventListener("popstate",()=>{restoreSelection();void load();});
  el("workspace").hidden=false;
  el("management").hidden=auth.user.role!=="admin";
  el("controls").addEventListener("submit",e=>{e.preventDefault();void load(true);});
  select("organisation").addEventListener("change",()=>void load(true));
  el("logout").addEventListener("click",()=>void window.PostDeployAuth.logout());
  for(const name of ["new-org","rename-org","new-project","move-project"]) el<HTMLFormElement>(name).addEventListener("submit",event=>{
    event.preventDefault();const form=el<HTMLFormElement>(name); const values=new FormData(form);
    void mutate(form,async()=>{
      let selected=select("organisation").value;
      if(name==="new-org") { const org=await api<Organisation>("/api/organisations","POST",{name:values.get("name")}); selected=org.id; }
      if(name==="rename-org") await api(`/api/organisations/${selected}`,"PATCH",{name:values.get("name")});
      if(name==="new-project") await api("/api/sites","POST",{name:values.get("name"),domain:values.get("domain"),kind:values.get("kind"),organisationId:selected});
      if(name==="move-project") await api(`/api/sites/${values.get("project")}`,"PATCH",{organisationId:values.get("destination")});
      [organisations,projects]=await Promise.all([api<Organisation[]>("/api/organisations"),api<Project[]>("/api/sites/catalog")]);options();select("organisation").value=selected;
    });
  });
  if(select("organisation").value) await load();
}
void start().catch(e=>status(e instanceof Error?e.message:String(e),true));
