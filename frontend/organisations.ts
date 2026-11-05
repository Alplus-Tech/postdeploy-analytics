import { SectionLoader } from './section-loader';
import type { Organisation, OrganisationPeriod, OrganisationReport } from "../worker/src/organisations";
import { DIMENSIONS, change, duration, exportAddress, insightsAddress, niceMax, pageAddress, presetFor, presetRange, projectReportAddress, rangeLabel, readSelection, reportQuery, shortDay, type Preset, type Selection } from './organisation-view';

type Project = { id: string; name: string; organisationId: string };
type Section = 'summary' | 'compare' | 'series' | 'seriesCompare' | 'goals' | 'measurement';
type Results = { summary?: OrganisationPeriod; compare?: OrganisationPeriod; series?: OrganisationPeriod; seriesCompare?: OrganisationPeriod; goals?: OrganisationPeriod; measurement?: OrganisationPeriod };
type ChartMetric = 'pageviews' | 'visitorDays';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing ${id}`);
  return node as T;
};
const input = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const select = (id: string): HTMLSelectElement => el<HTMLSelectElement>(id);
const escape = (value: string | number): string => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const fmt = (n: number): string => n.toLocaleString("en-GB");
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";
const axis = (v: number): string => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace(/\.0$/, "")}k` : fmt(v);

let organisations: Organisation[] = [];
let projects: Project[] = [];
let admin = false;
let sel: Selection = readSelection("", Date.now(), "");
let results: Results = {};
let chartMetric: ChartMetric = 'pageviews';
let chartAsTable = false;
let generation = 0;
let routed = "";
const loader = new SectionLoader();
window.addEventListener('pagehide', () => loader.stop());
window.addEventListener('pageshow', event => { if (event.persisted) { routed = ""; route(); } });

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const csrf = window.PostDeployAuth.csrf;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) location.assign("/auth");
    throw new Error(typeof value === "object" && value !== null && "message" in value ? String(value.message) : "The request failed. Try again.");
  }
  if (typeof value !== "object" || value === null) throw new Error("Unexpected server response.");
  return value as T;
}
function status(message: string, error = false, id = "status"): void {
  el(id).textContent = message;
  el(id).dataset.error = String(error);
}
const orgName = (id: string): string => organisations.find(o => o.id === id)?.name ?? id;
const validOrg = (): boolean => organisations.some(o => o.id === sel.org);

/* ---------- menus ---------- */
const MENUS: [string, string][] = [["org-button", "org-menu"], ["account-button", "account-menu"], ["csv-button", "csv-menu"], ["filter-button", "filter-panel"]];
function closeMenus(except?: string): void {
  for (const [button, menu] of MENUS) if (button !== except) { el(menu).hidden = true; el(button).setAttribute("aria-expanded", "false"); }
}
function wireMenus(): void {
  for (const [button, menu] of MENUS) el(button).addEventListener("click", () => {
    const open = el(menu).hidden;
    closeMenus(button);
    el(menu).hidden = !open;
    el(button).setAttribute("aria-expanded", String(open));
    if (open) el(menu).querySelector<HTMLElement>("select,input,a,button")?.focus();
  });
  document.addEventListener("click", event => {
    if (event.target instanceof Element && !event.target.closest(".pop")) closeMenus();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const open = MENUS.find(([, menu]) => !el(menu).hidden);
    if (open) { closeMenus(); el(open[0]).focus(); }
  });
  el("nav-toggle").addEventListener("click", () => {
    const open = !el("nav").classList.contains("open");
    el("nav").classList.toggle("open", open);
    el("nav-toggle").setAttribute("aria-expanded", String(open));
  });
}

/* ---------- chrome ---------- */
function options(): void {
  const orgOptions = organisations.map(o => `<option value="${escape(o.id)}">${escape(o.name)}</option>`).join("");
  for (const id of ["destination", "rename-target", "project-org"]) {
    const previous = select(id).value;
    select(id).innerHTML = orgOptions;
    select(id).value = organisations.some(o => o.id === previous) ? previous : sel.org;
  }
  const previousProject = select("project").value;
  select("project").innerHTML = projects.map(p => `<option value="${escape(p.id)}">${escape(p.name)} — ${escape(orgName(p.organisationId))}</option>`).join("");
  if (projects.some(p => p.id === previousProject)) select("project").value = previousProject;
  input("rename").value = orgName(select("rename-target").value);
  el("org-rows").innerHTML = organisations.map(o => `<tr><td><a href="${escape(pageAddress({ ...sel, org: o.id }))}">${escape(o.name)}</a></td><td class="r">${projects.filter(p => p.organisationId === o.id).length}</td></tr>`).join("");
}
function chrome(): void {
  const valid = validOrg();
  el("org-mark").textContent = valid ? initials(orgName(sel.org)) : "?";
  el("org-label").textContent = valid ? orgName(sel.org) : "Choose organisation";
  el("org-list").innerHTML = organisations.map(o => `<a href="${escape(pageAddress({ ...sel, org: o.id }))}" data-org="${escape(o.id)}" ${o.id === sel.org ? 'aria-current="true"' : ""}><span class="site-mark" aria-hidden="true">${escape(initials(o.name))}</span><span>${escape(o.name)}<br><span class="muted">${projects.filter(p => p.organisationId === o.id).length} projects</span></span>${o.id === sel.org ? '<span class="tick" aria-hidden="true">✓</span>' : ""}</a>`).join("");
  el<HTMLAnchorElement>("nav-report").href = pageAddress(sel);
  el<HTMLAnchorElement>("manage-back").href = pageAddress(sel);
  el<HTMLAnchorElement>("nav-insights").href = valid ? insightsAddress(sel) : "/insights";
  const first = projects.filter(p => p.organisationId === sel.org).sort((a, b) => a.name.localeCompare(b.name))[0];
  el<HTMLAnchorElement>("nav-projects").href = first ? projectReportAddress(first.id, sel) : "/dashboard#/overview";
  el<HTMLAnchorElement>("insights-link").href = insightsAddress(sel);
  el("csv-menu").querySelectorAll<HTMLAnchorElement>("a[data-dataset]").forEach(a => { a.href = exportAddress(sel, a.dataset.dataset ?? ""); });
}
function controls(): void {
  const preset = presetFor(sel, Date.now());
  select("range").value = preset;
  select("compare").value = sel.compare;
  input("from").value = sel.from;
  input("to").value = sel.to;
  el("custom-range").hidden = preset !== "custom";
  el("range-error").textContent = "";
  if (sel.filter) { select("dimension").value = sel.filter.dim; input("value").value = sel.filter.value; }
  const filter = sel.filter;
  el("filters").hidden = !filter;
  el("filters").innerHTML = filter ? `<span class="chip">${escape(DIMENSIONS.find(([id]) => id === filter.dim)?.[1] ?? filter.dim)} is <b>${escape(filter.value)}</b><button type="button" id="remove-filter" aria-label="Remove filter ${escape(DIMENSIONS.find(([id]) => id === filter.dim)?.[1] ?? filter.dim)} is ${escape(filter.value)}"><svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></span>` : "";
  document.getElementById("remove-filter")?.addEventListener("click", () => { sel = { ...sel, filter: null }; input("value").value = ""; void load(true); });
}

/* ---------- view routing ---------- */
function route(): void {
  sel = readSelection(location.search, Date.now(), organisations[0]?.id ?? "");
  const view = admin && location.hash === "#manage" ? "manage" : "report";
  const key = `${view}|${location.search}`;
  if (key === routed) return;
  routed = key;
  el("report-view").hidden = view !== "report";
  el("manage-view").hidden = view !== "manage";
  if (view === "report") el("nav-report").setAttribute("aria-current", "page"); else el("nav-report").removeAttribute("aria-current");
  if (view === "manage") el("nav-manage").setAttribute("aria-current", "page"); else el("nav-manage").removeAttribute("aria-current");
  el("nav").classList.remove("open");
  el("nav-toggle").setAttribute("aria-expanded", "false");
  chrome();
  controls();
  if (view === "manage") {
    loader.stop(); generation++;
    document.title = "Manage organisations · PostDeploy Analytics";
    options();
    return;
  }
  if (!validOrg()) {
    loader.stop(); generation++;
    el("report").innerHTML = "";
    el("toolbar").hidden = true;
    el("heading").textContent = "Organisation not found";
    el("subtitle").textContent = "";
    status(organisations.length ? "This organisation does not exist. Choose an organisation to continue." : "No organisations exist yet.", true);
    return;
  }
  void load();
}
function navigate(next: Selection): void {
  sel = next;
  void load(true);
}

/* ---------- report ---------- */
let moreOpen = false;
let goalsOpen = false;
function figure(id: string, label: string, detail = ""): string {
  return `<div class="fig" id="fig-${id}"><span class="k">${label}</span><span class="v" id="v-${id}"><span class="org-pending">—</span></span><span class="d" id="d-${id}">${detail}</span></div>`;
}
async function load(push = false): Promise<void> {
  const current = ++generation;
  const address = pageAddress(sel);
  if (push) history.pushState(null, "", address); else history.replaceState(null, "", address);
  routed = `report|${location.search}`;
  closeMenus();
  chrome();
  controls();
  results = {};
  loader.reset();
  const comparison = reportQuery(sel);
  const compareOn = comparison.has("cmpFrom");
  const name = orgName(sel.org);
  document.title = `${name} · PostDeploy Analytics`;
  el("heading").textContent = name;
  el("subtitle").textContent = `${rangeLabel(sel.from, sel.to)} · UTC${compareOn ? ` · vs ${rangeLabel(comparison.get("cmpFrom") ?? "", comparison.get("cmpTo") ?? "")}` : ""}`;
  el("toolbar").hidden = false;
  status("");
  el("report").innerHTML = `<section class="panel" aria-labelledby="h-figures">
    <h2 id="h-figures" class="visually-hidden">Key figures and daily traffic</h2>
    <div class="ledger org-ledger org-core">
      ${figure("pageviews", "Pageviews")}
      ${figure("visitorDays", "Project visitor-days")}
      ${figure("completions", "Goal completions")}
    </div>
    <div class="org-more-bar">
      <button type="button" class="btn btn-ghost btn-sm" id="more-toggle" aria-expanded="${moreOpen}" aria-controls="more-metrics">More metrics<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="org-states"><span id="state-summary" data-name="Totals"></span> <span id="state-compare" data-name="Comparison"></span> <span id="state-goals" data-name="Goals"></span> <span id="state-measurement" data-name="Visits"></span></span>
    </div>
    <div class="ledger org-ledger org-secondary" id="more-metrics" ${moreOpen ? "" : "hidden"}>
      ${figure("visits", "Visits")}
      ${figure("bounce", "Bounce rate")}
      ${figure("duration", "Visible visit duration")}
    </div>
    <div class="chart-wrap">
      <div class="chart-meta">
        <div class="seg" role="group" aria-label="Chart metric">
          <button type="button" data-metric="pageviews" aria-pressed="${chartMetric === "pageviews"}">Pageviews</button>
          <button type="button" data-metric="visitorDays" aria-pressed="${chartMetric === "visitorDays"}">Visitor-days</button>
        </div>
        <span class="key"><span class="swatch"></span>${escape(rangeLabel(sel.from, sel.to))}</span>
        ${compareOn ? `<span class="key"><span class="swatch cmp"></span><span id="state-seriesCompare">${escape(rangeLabel(comparison.get("cmpFrom") ?? "", comparison.get("cmpTo") ?? ""))}</span></span>` : ""}
        <span class="end"><button type="button" class="btn btn-ghost btn-sm" id="chart-toggle" aria-pressed="${chartAsTable}">${chartAsTable ? "Show chart" : "Show as table"}</button></span>
      </div>
      <div id="state-series" class="org-chart-state">Waiting for exact results…</div>
      <div id="chart-host"></div>
    </div>
  </section>
  <section class="panel org-block" aria-labelledby="h-projects">
    <div class="panel-head"><h2 id="h-projects">Projects</h2></div>
    <div class="panel-body" id="projects-body"><p class="muted">—</p></div>
  </section>
  <details class="org-disclose" id="goals-details" ${goalsOpen ? "open" : ""}>
    <summary><span>Goals</span><span class="muted" id="goals-count"></span></summary>
    <div class="panel org-goals" id="goals-body"><p class="muted">—</p></div>
  </details>
  <details class="org-about">
    <summary>Definitions</summary>
    <ul>
      <li>Dates and chart days use UTC event time. Project reports use each project’s own timezone, so totals near date edges can differ.</li>
      <li>Project visitor-days add each project’s daily visitors. The same person can count in several projects and on several days; this is not a count of people.</li>
      <li>Visits count when they start in the range. A bounce is one pageview and no goal. Visible duration averages measured visits only; unmeasured visits are unknown.</li>
      <li>Goal completions include repeats. The daily-unique rate divides converted visitor-days by visitor-days, uniting goals per project and day. No eligible visitor-days shows 0%.</li>
      <li>A page filter selects matching visits. Moving a project brings its full history into its current organisation.</li>
    </ul>
  </details>`;
  el("more-toggle").addEventListener("click", () => {
    moreOpen = !moreOpen;
    el("more-metrics").hidden = !moreOpen;
    el("more-toggle").setAttribute("aria-expanded", String(moreOpen));
  });
  el("goals-details").addEventListener("toggle", () => { goalsOpen = el<HTMLDetailsElement>("goals-details").open; });
  el("report").querySelectorAll<HTMLButtonElement>("[data-metric]").forEach(b => b.addEventListener("click", () => {
    chartMetric = b.dataset.metric === "visitorDays" ? "visitorDays" : "pageviews";
    el("report").querySelectorAll("[data-metric]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    drawSeries();
  }));
  el("chart-toggle").addEventListener("click", () => {
    chartAsTable = !chartAsTable;
    el("chart-toggle").setAttribute("aria-pressed", String(chartAsTable));
    el("chart-toggle").textContent = chartAsTable ? "Show chart" : "Show as table";
    drawSeries();
  });

  const base = reportQuery(sel); base.delete("cmpFrom"); base.delete("cmpTo");
  const previous = new URLSearchParams(base);
  previous.set("from", comparison.get("cmpFrom") ?? ""); previous.set("to", comparison.get("cmpTo") ?? "");
  const enqueue = (section: Section, server: 'summary' | 'series' | 'goals' | 'measurement', query: URLSearchParams): void => {
    const q = new URLSearchParams(query); q.set("section", server);
    const target = el<HTMLElement>(`state-${section}`);
    const label = target.textContent;
    loader.enqueue(`/api/organisations/${encodeURIComponent(sel.org)}/report?${q}`, target, value => {
      if (current !== generation) return;
      results[section] = (value as OrganisationReport).main;
      target.textContent = section === "seriesCompare" ? label : "";
      paint(section);
    });
  };
  enqueue("summary", "summary", base);
  enqueue("series", "series", base);
  if (compareOn) enqueue("seriesCompare", "series", previous);
  enqueue("goals", "goals", base);
  enqueue("measurement", "measurement", base);
  if (compareOn) enqueue("compare", "summary", previous);
}

function setFigure(id: string, value: string, detail: string, tone = ""): void {
  el(`v-${id}`).textContent = value;
  el(`d-${id}`).innerHTML = tone ? `<span class="${tone}">${escape(detail)}</span>` : escape(detail);
}
function delta(id: string, current: number, previous: number | undefined): void {
  if (previous === undefined) return;
  const d = change(current, previous);
  const cmp = reportQuery(sel);
  el(`d-${id}`).innerHTML = `<span class="${d.tone}">${escape(d.text)}</span><span class="visually-hidden"> compared with ${escape(rangeLabel(cmp.get("cmpFrom") ?? "", cmp.get("cmpTo") ?? ""))}</span>`;
}
function paint(section: Section): void {
  const { summary, compare, goals, measurement } = results;
  if (section === "summary" || section === "compare") {
    if (summary) {
      el("v-pageviews").textContent = fmt(summary.totals.pageviews);
      el("v-visitorDays").textContent = fmt(summary.totals.visitorDays);
      delta("pageviews", summary.totals.pageviews, compare?.totals.pageviews);
      delta("visitorDays", summary.totals.visitorDays, compare?.totals.visitorDays);
      renderProjects(summary, compare);
    }
  }
  if (section === "measurement" && measurement) {
    const m = measurement.measurement;
    setFigure("visits", fmt(m.visits), "");
    setFigure("bounce", m.visits ? pct(m.bounceRate) : "—", m.visits ? "" : "No visits");
    setFigure("duration", m.duration === null ? "Unknown" : duration(m.duration), `${fmt(m.measuredVisits)} of ${fmt(m.visits)} visits measured`);
  }
  if (section === "goals" && goals) {
    renderGoals(goals);
    const c = goals.conversions;
    if (!goals.goals.length) setFigure("completions", "—", "No goals set up");
    else setFigure("completions", fmt(c.completions), c.visitorDays ? `${pct(c.rate)} daily-unique rate` : "0 eligible visitor-days");
  }
  if (section === "series" || section === "seriesCompare") drawSeries();
}

function renderProjects(summary: OrganisationPeriod, compare: OrganisationPeriod | undefined): void {
  const total = summary.totals.pageviews;
  const max = Math.max(1, ...summary.projects.map(p => p.pageviews));
  const body = el("projects-body");
  if (!summary.projects.length) {
    body.innerHTML = `<div class="empty"><h3>No projects in this organisation yet</h3>${admin ? '<a class="btn" href="#manage">Add or move a project</a>' : "<p>An administrator can add or move a project here.</p>"}</div>`;
    return;
  }
  const previous = (id: string): number => compare?.projects.find(v => v.id === id)?.pageviews ?? 0;
  const trend = (id: string, now: number): string => {
    const before = previous(id);
    if (!before) return now ? "No prior" : "—";
    const d = change(now, before);
    return `<span class="${d.tone}">${escape(d.text)}</span>`;
  };
  body.innerHTML = `<table class="list org-projects">
    <colgroup><col><col class="c-num"><col class="c-small">${compare ? '<col class="c-num">' : ""}<col class="c-num"></colgroup>
    <thead><tr><th scope="col">Project</th><th scope="col" class="r">Pageviews</th><th scope="col" class="r">Share</th>${compare ? '<th scope="col" class="r">Change</th>' : ""}<th scope="col" class="r">Visitor-days</th></tr></thead>
    <tbody>${summary.projects.map(p => `<tr><th scope="row" class="cell-name"><a class="rowbtn org-rowlink" href="${escape(projectReportAddress(p.id, sel))}"><span class="fill" style="width:${(p.pageviews / max * 100).toFixed(1)}%"></span><span class="label">${escape(p.name)}</span><span class="note">${escape(p.domain)}</span></a></th><td class="r" data-label="Pageviews">${fmt(p.pageviews)}</td><td class="r" data-label="Share">${total ? pct(p.pageviews / total) : "0.0%"}</td>${compare ? `<td class="r" data-label="Change">${trend(p.id, p.pageviews)}</td>` : ""}<td class="r" data-label="Visitor-days">${fmt(p.visitorDays)}</td></tr>`).join("")}</tbody>
  </table>${total ? "" : '<p class="help org-foot">No pageviews match this period and filter.</p>'}`;
}

function renderGoals(goals: OrganisationPeriod): void {
  const c = goals.conversions;
  const name = (id: string): string => projects.find(p => p.id === id)?.name ?? id;
  const rate = (rate: number, converted: number, eligible: number): string => eligible ? `${pct(rate)} <span class="muted">${fmt(converted)}/${fmt(eligible)}</span>` : '<span class="muted">0 eligible</span>';
  el("goals-count").textContent = goals.goals.length ? String(goals.goals.length) : "";
  el("goals-body").innerHTML = goals.goals.length ? `<div class="org-scroll" tabindex="0" role="region" aria-label="Goals table"><table class="table">
    <thead><tr><th scope="col">Goal</th><th scope="col">Project</th><th scope="col" class="r">Completions</th><th scope="col" class="r">Daily-unique rate <span class="muted">converted/visitor-days</span></th></tr></thead>
    <tbody>${goals.goals.map(g => `<tr><td>${escape(g.name)}</td><td>${escape(name(g.projectId))}</td><td class="r">${fmt(g.completions)}</td><td class="r">${rate(g.rate, g.convertedVisitorDays, g.visitorDays)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><th scope="row" colspan="2">All goals</th><td class="r">${fmt(c.completions)}</td><td class="r">${rate(c.rate, c.convertedVisitorDays, c.visitorDays)}</td></tr></tfoot>
  </table></div>` : `<p class="muted">No goals are set up for these projects. Add them in each project’s Manage page.</p>`;
}

function drawSeries(): void {
  const host = document.getElementById("chart-host");
  const main = results.series;
  if (!host || !main) return;
  el("state-series").hidden = true;
  const prev = results.seriesCompare ?? null;
  const metric = chartMetric;
  const label = metric === "pageviews" ? "Pageviews" : "Project visitor-days";
  const buckets = main.buckets;
  const cur = buckets.map(b => b[metric]);
  const old = prev ? buckets.map((_, i) => prev.buckets[i]?.[metric] ?? null) : null;
  if (chartAsTable) {
    host.innerHTML = `<div class="chart-table" tabindex="0" role="region" aria-label="Daily ${label.toLowerCase()} table"><table class="table"><caption class="visually-hidden">Exact daily ${label.toLowerCase()}, UTC</caption><thead><tr><th scope="col">Day (UTC)</th><th scope="col" class="r">${label}</th>${prev ? '<th scope="col">Previous day</th><th scope="col" class="r">Previous</th>' : ""}</tr></thead><tbody>${buckets.map((b, i) => `<tr><td>${b.day}</td><td class="r">${fmt(b[metric])}</td>${prev ? `<td>${prev.buckets[i]?.day ?? "—"}</td><td class="r">${old?.[i] == null ? "—" : fmt(old[i] ?? 0)}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
    return;
  }
  host.innerHTML = `<div class="chart" id="chart" tabindex="0" role="img"></div>`;
  const chart = el("chart");
  const W = Math.max(280, chart.clientWidth);
  const H = chart.clientHeight || 280;
  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const n = cur.length;
  const max = niceMax(Math.max(0, ...cur, ...(old ?? []).map(v => v ?? 0)) * 1.08);
  const bars = n <= 14;
  const x = (i: number): number => pad.l + (bars ? (i + 0.5) * (iw / n) : n === 1 ? iw / 2 : i / (n - 1) * iw);
  const y = (v: number): number => pad.t + ih - v / max * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 80))));
  const path = (values: (number | null)[]): string => values.map((v, i) => v === null ? "" : `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  let marks = "";
  if (bars) {
    const bw = Math.min(24, iw / Math.max(1, n) * (old ? 0.36 : 0.6));
    if (old) marks += old.map((v, i) => v === null ? "" : `<rect class="bar cmp" x="${x(i) - bw - 1}" y="${y(v)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(v))}" rx="2"/>`).join("");
    marks += cur.map((v, i) => `<rect class="bar" x="${old ? x(i) + 1 : x(i) - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(v))}" rx="2"/>`).join("");
  } else {
    if (old) marks += `<path class="line cmp" d="${path(old)}"/>`;
    if (n) marks += `<path class="area" d="${path(cur)}L${x(n - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z"/><path class="line" d="${path(cur)}"/>`;
  }
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><defs><linearGradient id="area-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--color-accent)" stop-opacity="0.16"/><stop offset="1" stop-color="var(--color-accent)" stop-opacity="0"/></linearGradient></defs><g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g><g class="axis">${ticks.map(t => `<text x="${pad.l - 10}" y="${y(t) + 4}" text-anchor="end">${axis(t)}</text>`).join("")}${buckets.map((b, i) => i % every === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${shortDay(b.day)}</text>` : "").join("")}</g>${marks}<g class="hover"></g></svg><div class="tip" hidden></div>`;
  const total = cur.reduce((a, b) => a + b, 0);
  chart.setAttribute("aria-label", `Daily ${label.toLowerCase()} in UTC, ${fmt(total)} in total${metric === "visitorDays" ? " (a sum of daily figures, not distinct people)" : ""}. Use the left and right arrow keys to read each day, or show the chart as a table.`);
  const tip = chart.querySelector<HTMLElement>(".tip");
  const hover = chart.querySelector<SVGGElement>(".hover");
  if (!tip || !hover) return;
  const show = (i: number): void => {
    const v = cur[i];
    const b = buckets[i];
    if (v === undefined || !b) { hover.innerHTML = ""; tip.hidden = true; return; }
    chart.dataset.i = String(i);
    const o = old?.[i] ?? null;
    hover.innerHTML = `<line class="cursor" x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${pad.t + ih}"/>${bars ? "" : `${o !== null ? `<circle class="dot cmp" cx="${x(i)}" cy="${y(o)}" r="4"/>` : ""}<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4.5"/>`}`;
    const d = o !== null ? change(v, o) : null;
    tip.innerHTML = `<div class="dim">${shortDay(b.day, true)} (UTC)</div><div class="row"><span>${label}</span><b>${fmt(v)}</b></div>${prev && o !== null ? `<div class="row dim"><span>${shortDay(prev.buckets[i]?.day ?? "", true)}</span><span>${fmt(o)}</span></div><div class="row dim"><span>Change</span><span>${d?.text ?? ""}</span></div>` : ""}`;
    tip.hidden = false;
    const right = x(i) + 12 + tip.offsetWidth > W;
    tip.style.transform = `translate(${right ? x(i) - tip.offsetWidth - 12 : x(i) + 12}px, ${pad.t}px)`;
  };
  chart.onpointermove = (e: PointerEvent): void => {
    const px = e.clientX - chart.getBoundingClientRect().left - pad.l;
    const i = bars ? Math.floor(px / (iw / n)) : Math.round(px / iw * (n - 1));
    show(Math.max(0, Math.min(n - 1, i)));
  };
  chart.onpointerleave = (): void => { if (document.activeElement !== chart) show(-1); };
  chart.onblur = (): void => show(-1);
  chart.onkeydown = (e: KeyboardEvent): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const at = chart.dataset.i ? Number(chart.dataset.i) : n - 1;
    const i = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.max(0, Math.min(n - 1, at + (e.key === "ArrowRight" ? 1 : -1)));
    show(i);
    el("announce").textContent = [...tip.children].map(c => c.children.length ? [...c.children].map(x => x.textContent ?? "").join(" ") : c.textContent ?? "").join(", ");
  };
}

/* ---------- management ---------- */
async function refreshLists(): Promise<void> {
  [organisations, projects] = await Promise.all([api<Organisation[]>("/api/organisations"), api<Project[]>("/api/sites/catalog")]);
  options();
  chrome();
}
async function mutate(form: HTMLFormElement, action: () => Promise<string>): Promise<void> {
  const button = form.querySelector("button");
  if (button) button.disabled = true;
  status("Saving…", false, "manage-status");
  try { const message = await action(); await refreshLists(); status(message, false, "manage-status"); }
  catch (e) { status(e instanceof Error ? e.message : String(e), true, "manage-status"); }
  finally { if (button) button.disabled = false; }
}
function wireManagement(): void {
  select("rename-target").addEventListener("change", () => { input("rename").value = orgName(select("rename-target").value); });
  const forms: Record<string, (values: FormData, form: HTMLFormElement) => Promise<string>> = {
    "new-org": async (values, form) => {
      const org = await api<Organisation>("/api/organisations", "POST", { name: values.get("name") });
      sel = { ...sel, org: org.id };
      history.replaceState(null, "", pageAddress(sel) + "#manage");
      routed = `manage|${location.search}`;
      form.reset();
      return `Created ${org.name}.`;
    },
    "rename-org": async values => {
      const id = String(values.get("organisation") ?? "");
      await api(`/api/organisations/${encodeURIComponent(id)}`, "PATCH", { name: values.get("name") });
      return "Organisation renamed.";
    },
    "new-project": async (values, form) => {
      await api("/api/sites", "POST", { name: values.get("name"), domain: values.get("domain"), kind: values.get("kind"), organisationId: values.get("organisation") });
      form.reset();
      return "Project created.";
    },
    "move-project": async values => {
      await api(`/api/sites/${encodeURIComponent(String(values.get("project") ?? ""))}`, "PATCH", { organisationId: values.get("destination") });
      return "Project moved with its full history.";
    },
  };
  for (const [name, action] of Object.entries(forms)) el<HTMLFormElement>(name).addEventListener("submit", event => {
    event.preventDefault();
    const form = el<HTMLFormElement>(name);
    const values = new FormData(form);
    void mutate(form, () => action(values, form));
  });
}

/* ---------- start ---------- */
function wireReport(): void {
  select("dimension").innerHTML = DIMENSIONS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
  el("org-list").addEventListener("click", event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-org]") : null;
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    closeMenus();
    history.pushState(null, "", link.href);
    routed = "";
    route();
  });
  el("nav-report").addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    history.pushState(null, "", pageAddress(sel));
    route();
  });
  el("manage-back").addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    history.pushState(null, "", pageAddress(sel));
    route();
  });
  select("range").addEventListener("change", () => {
    const preset = select("range").value as Preset;
    if (preset === "custom") { el("custom-range").hidden = false; input("from").focus(); return; }
    navigate({ ...sel, ...presetRange(preset, Date.now()) });
  });
  select("compare").addEventListener("change", () => navigate({ ...sel, compare: select("compare").value === "off" ? "off" : "prev" }));
  el("custom-range").addEventListener("submit", event => {
    event.preventDefault();
    const from = input("from").value, to = input("to").value;
    if (!from || !to) { el("range-error").textContent = "Choose both dates."; return; }
    if (from > to) { el("range-error").textContent = "The start date must be on or before the end date."; return; }
    navigate({ ...sel, from, to });
  });
  el("filter-panel").addEventListener("submit", event => {
    event.preventDefault();
    const dim = DIMENSIONS.find(([id]) => id === select("dimension").value)?.[0];
    const value = input("value").value;
    if (!dim || !value) return;
    navigate({ ...sel, filter: { dim, value } });
  });
  let width = 0;
  new ResizeObserver(entries => {
    const next = Math.round(entries[0]?.contentRect.width ?? 0);
    if (next !== width) { width = next; drawSeries(); }
  }).observe(el("main"));
  el("logout").addEventListener("click", () => void window.PostDeployAuth.logout());
}
async function start(): Promise<void> {
  const auth = await window.PostDeployAuth.refresh();
  if (!auth.user) { location.replace("/auth"); return; }
  admin = auth.user.role === "admin";
  el("account-email").textContent = auth.user.email;
  el("nav-manage").hidden = !admin;
  wireMenus();
  wireReport();
  if (admin) wireManagement();
  [organisations, projects] = await Promise.all([api<Organisation[]>("/api/organisations"), api<Project[]>("/api/sites/catalog")]);
  el("org-button").removeAttribute("disabled");
  window.addEventListener("popstate", () => route());
  window.addEventListener("hashchange", () => route());
  options();
  route();
}
void start().catch(e => status(e instanceof Error ? e.message : String(e), true));
