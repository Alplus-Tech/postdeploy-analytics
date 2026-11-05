import { SectionLoader } from './section-loader';
import type { InsightRow, InsightSectionResponse } from '../worker/src/insights';
import { change, niceMax, rangeLabel, shortDay } from './organisation-view';

type View = 'traffic' | 'conversion' | 'composition' | 'acquisition' | 'arrivals' | 'duration';
type Section = 'summary' | 'timeline' | 'composition' | 'ranking' | 'heatmap' | 'duration';
type Metric = 'pageviews' | 'visitorDays' | 'completions';
type Packet = InsightSectionResponse;
type Range = { from: string; to: string };
type Sel = { scope: 'org' | 'site'; id: string; from: string; to: string; cmp: Range | null; f: string; goal: string; dimension: string; composition: string; metric: Metric; view: View };
type Rendered = { html: string; wire?: (root: HTMLElement) => void };

const VIEWS: readonly { id: View; label: string; section: Section }[] = [
  { id: 'traffic', label: 'Traffic', section: 'timeline' },
  { id: 'conversion', label: 'Conversion', section: 'timeline' },
  { id: 'composition', label: 'Composition', section: 'composition' },
  { id: 'acquisition', label: 'Acquisition', section: 'ranking' },
  { id: 'arrivals', label: 'Arrival times', section: 'heatmap' },
  { id: 'duration', label: 'Duration', section: 'duration' },
];
const LEGACY_ANCHORS: Record<string, View> = { traffic: 'traffic', conversion: 'conversion', acquisition: 'acquisition', activity: 'arrivals', duration: 'duration' };
const METRICS: readonly [Metric, string][] = [['pageviews', 'Pageviews'], ['visitorDays', 'Visitor-days'], ['completions', 'Completions']];
const RANKS: readonly [string, string, boolean][] = [['project', 'Project', true], ['source', 'Source', false], ['entry', 'Landing page', false], ['page', 'Page', false], ['campaign', 'Campaign', false]];
const DIMENSION_NAMES: Record<string, string> = { source: 'Source', page: 'Page', entry: 'Entry page', campaign: 'Campaign', country: 'Country', device: 'Device', browser: 'Browser', referrer: 'Referrer' };
const SERIES = ['var(--color-accent-strong)', '#3f68b5', '#a25191', '#986100', '#2f7d7a', '#b13c35'];
const OTHER = 'var(--color-compare)';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DURATION_SHORT = ['0–10s', '10–30s', '30–60s', '1–3m', '3–10m', '10m+'];
const DAY = 86400000;

const node = <T extends HTMLElement = HTMLElement>(id: string): T => { const n = document.getElementById(id); if (!n) throw new Error(`Missing ${id}`); return n as T; };
const field = (id: string): HTMLInputElement => node<HTMLInputElement>(id);
const esc = (v: string | number): string => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const fmt = (n: number): string => n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
const compact = (v: number): string => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace(/\.0$/, '')}k` : fmt(v);

function comparison(from: string, to: string): Range | null {
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { from: iso(start - (end - start) - DAY), to: iso(start - DAY) };
}

function readSel(): Sel {
  const q = new URLSearchParams(location.search);
  const scope = q.has('org') ? 'org' : 'site';
  const cmpFrom = q.get('cmpFrom'), cmpTo = q.get('cmpTo');
  const metric = METRICS.find(([id]) => id === q.get('metric'))?.[0] ?? 'pageviews';
  const view = VIEWS.find(v => v.id === q.get('view'))?.id ?? LEGACY_ANCHORS[location.hash.slice(1)] ?? 'traffic';
  return {
    scope, id: q.get(scope) ?? '',
    from: q.get('from') ?? iso(Date.now() - 29 * DAY), to: q.get('to') ?? iso(Date.now()),
    cmp: cmpFrom && cmpTo ? { from: cmpFrom, to: cmpTo } : null,
    f: q.get('f') ?? '', goal: q.get('goal') ?? '',
    dimension: q.get('dimension') ?? (scope === 'org' ? 'project' : 'source'),
    composition: q.get('composition') ?? 'source',
    metric, view,
  };
}

function apiQuery(s: Sel, withComparison: boolean): URLSearchParams {
  const q = new URLSearchParams();
  if (s.id) q.set(s.scope, s.id);
  q.set('from', s.from); q.set('to', s.to);
  if (s.f) q.set('f', s.f);
  if (s.goal) q.set('goal', s.goal);
  q.set('dimension', s.dimension);
  q.set('composition', s.composition);
  if (withComparison && s.cmp) { q.set('cmpFrom', s.cmp.from); q.set('cmpTo', s.cmp.to); }
  return q;
}
function pageAddress(s: Sel): string {
  const q = apiQuery(s, true);
  if (s.metric !== 'pageviews') q.set('metric', s.metric);
  if (s.view !== 'traffic') q.set('view', s.view);
  return `/insights?${q}`;
}
function sectionUrl(s: Sel, section: Section, period: 'main' | 'prev'): string {
  const q = apiQuery(s, false);
  if (period === 'prev' && s.cmp) { q.set('from', s.cmp.from); q.set('to', s.cmp.to); }
  q.set('section', section);
  return `/api/insights?${q}`;
}
function csvLink(dataset: string): string {
  const q = apiQuery(sel, true);
  q.set('dataset', dataset);
  return `<a class="btn btn-sm" href="/api/insights?${esc(q.toString())}" download>Download CSV</a>`;
}

let sel = readSel();
let generation = 0;
let cacheKey = '';
let goals: { key: string; name: string }[] = [];
let meta: { name: string; timezone: string; organisation: boolean } | null = null;
let at: Partial<Record<View, number>> = {};
let tableOpen = false;
let filtersOpen = false;
let redraw: (() => void) | null = null;
const cache = new Map<string, Packet>();
const hiddenLayers = new Set<string>();
const loader = new SectionLoader();
window.addEventListener('pagehide', () => loader.stop());
window.addEventListener('pageshow', event => { if (event.persisted) { cache.clear(); sel = readSel(); load(false); } });

const viewOf = (id: View): { id: View; label: string; section: Section } => VIEWS.find(v => v.id === id) ?? { id: 'traffic', label: 'Traffic', section: 'timeline' };
const packet = (section: Section, period: 'main' | 'prev'): Packet | undefined => period === 'prev' && !sel.cmp ? undefined : cache.get(sectionUrl(sel, section, period));
const gran = (p: Packet): string => p.main.granularity ?? 'day';

function bucketShort(label: string, g: string): string { return g === 'hour' ? label.slice(11, 16) : shortDay(label.slice(0, 10)); }
function bucketLong(label: string, g: string): string {
  if (g === 'hour') return `${shortDay(label.slice(0, 10), true)} ${label.slice(11, 16)}`;
  return `${g === 'week' ? 'Week of ' : ''}${shortDay(label.slice(0, 10), true)}`;
}
const granName = (g: string): string => g === 'hour' ? 'hourly' : g === 'week' ? 'weekly' : 'daily';

/* ---------- table ---------- */
function exactTable(title: string, columns: string[], rows: (string | number)[][]): string {
  return `<details class="ins-table" ${tableOpen ? 'open' : ''}><summary>Exact table</summary><div class="ins-scroll" tabindex="0" role="region" aria-label="${esc(title)}, exact table"><table class="table"><caption class="visually-hidden">${esc(title)}</caption><thead><tr>${columns.map((c, i) => `<th scope="col"${i ? ' class="r"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((c, i) => i ? `<td class="r">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
const foot = (table: string, dataset: string): string => `<div class="ins-foot">${table}${csvLink(dataset)}</div>`;

/* ---------- inspection ---------- */
function inspector(root: HTMLElement, view: View, count: number, label: string, describe: (i: number) => string, chart?: HTMLElement, index?: (clientX: number, rect: DOMRect) => number): void {
  const input = root.querySelector<HTMLInputElement>('#inspect');
  const out = root.querySelector<HTMLElement>('#readout');
  if (!input || !out) return;
  input.max = String(Math.max(0, count - 1));
  input.value = String(Math.min(count - 1, at[view] ?? count - 1));
  input.setAttribute('aria-label', label);
  const show = (): void => {
    const i = Number(input.value);
    at[view] = i;
    const text = count ? describe(i) : 'No buckets in this period.';
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
    redraw?.();
  };
  input.addEventListener('input', show);
  if (chart && index) {
    const pick = (e: PointerEvent): void => {
      if (e.pointerType === 'touch' && e.type === 'pointermove') return;
      const i = index(e.clientX, chart.getBoundingClientRect());
      if (i < 0 || String(i) === input.value) return;
      input.value = String(i); show();
    };
    chart.addEventListener('pointerdown', pick);
    chart.addEventListener('pointermove', pick);
  }
  show();
}
const inspectMarkup = '<input class="ins-range" id="inspect" type="range" min="0" value="0"><p class="ins-readout" id="readout"></p>';

/* ---------- trend ---------- */
type Plot = { pad: { l: number; r: number; t: number; b: number }; W: number; iw: number };
function plotFrame(host: HTMLElement): { W: number; H: number; narrow: boolean } {
  const W = Math.max(240, Math.round(host.clientWidth));
  const narrow = W < 520;
  return { W, H: narrow ? 210 : 260, narrow };
}
function yAxis(W: number, pad: Plot['pad'], ih: number, max: number, narrow: boolean, axis: (v: number) => string): string {
  const ticks = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map(f => f * max);
  const y = (v: number): number => pad.t + ih - v / max * ih;
  return `<g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g><g class="axis">${ticks.map(t => `<text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(axis(t))}</text>`).join('')}</g>`;
}
function xAxis(labels: string[], x: (i: number) => number, iw: number, H: number): string {
  const n = labels.length;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 76))));
  return `<g class="axis">${labels.map((l, i) => i % every === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 && n > 1 ? 'start' : 'middle'}">${esc(l)}</text>` : '').join('')}</g>`;
}
function drawTrend(host: HTMLElement, cur: number[], old: number[] | null, max: number, axis: (v: number) => string, labels: string[], focus: number): (clientX: number, rect: DOMRect) => number {
  const { W, H, narrow } = plotFrame(host);
  const pad = { l: narrow ? 40 : 48, r: 10, t: 10, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, n = cur.length;
  const x = (i: number): number => pad.l + (n <= 1 ? iw / 2 : i / (n - 1) * iw);
  const y = (v: number): number => pad.t + ih - Math.min(v, max) / max * ih;
  const path = (values: number[]): string => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const prev = old ? old.slice(0, n) : null;
  const marks = n ? `${prev && prev.length ? `<path class="line cmp" d="${path(prev)}"/>` : ''}<path class="area" d="${path(cur)}L${x(n - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z"/><path class="line" d="${path(cur)}"/>` : '';
  const f = cur[focus];
  const o = prev?.[focus];
  const cursor = f === undefined ? '' : `<line class="cursor" x1="${x(focus)}" x2="${x(focus)}" y1="${pad.t}" y2="${pad.t + ih}"/>${o === undefined ? '' : `<circle class="dot cmp" cx="${x(focus)}" cy="${y(o)}" r="4"/>`}<circle class="dot" cx="${x(focus)}" cy="${y(f)}" r="4.5"/>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><defs><linearGradient id="area-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--color-accent)" stop-opacity="0.16"/><stop offset="1" stop-color="var(--color-accent)" stop-opacity="0"/></linearGradient></defs>${yAxis(W, pad, ih, max, narrow, axis)}${xAxis(labels, x, iw, H)}${marks}${cursor}</svg>`;
  return (clientX, rect) => n ? Math.max(0, Math.min(n - 1, Math.round((clientX - rect.left - pad.l) / iw * (n - 1)))) : -1;
}
function keyLine(unit: string, g: string, compared: boolean): string {
  const tz = meta?.timezone ?? '';
  return `<div class="chart-meta ins-key"><span class="key"><span class="swatch"></span>${esc(rangeLabel(sel.from, sel.to))}</span>${compared && sel.cmp ? `<span class="key"><span class="swatch cmp"></span>${esc(rangeLabel(sel.cmp.from, sel.cmp.to))}</span>` : ''}<span class="end">${esc(unit)} · ${granName(g)} · ${esc(tz)}</span></div>`;
}

function trendView(main: Packet, prev: Packet | undefined, conversion: boolean): Rendered {
  const rows = (main.main.timeline ?? []) as InsightRow[];
  const old = prev ? (prev.main.timeline ?? []) as InsightRow[] : null;
  const g = gran(main);
  const metric = sel.metric;
  const value = (r: InsightRow): number => conversion ? r.rate : r[metric];
  const unit = conversion ? 'Conversion rate' : METRICS.find(([id]) => id === metric)?.[1] ?? 'Pageviews';
  const cur = rows.map(value), was = old ? old.map(value) : null;
  const top = Math.max(0, ...cur, ...(was ?? []));
  const max = conversion ? Math.min(1, niceMax(top * 1000 * 1.08) / 1000) : niceMax(top * 1.08);
  const axis = conversion ? (v: number): string => `${(v * 100).toFixed(max < 0.02 ? 1 : 0)}%` : compact;
  const show = (v: number): string => conversion ? pct(v) : fmt(v);
  const labels = rows.map(r => bucketShort(r.label, g));
  const describe = (i: number): string => {
    const r = rows[i];
    if (!r) return '';
    const o = old?.[i];
    const base = conversion
      ? `${bucketLong(r.label, g)}: ${r.conversionVisitorDays ? `${pct(r.rate)} · ${fmt(r.convertedVisitorDays)} of ${fmt(r.conversionVisitorDays)} eligible visitor-days` : '0 eligible visitor-days'} · ${fmt(r.completions)} completions`
      : `${bucketLong(r.label, g)}: ${fmt(value(r))} ${unit.toLowerCase()}`;
    if (!o) return base;
    const d = conversion ? null : change(value(r), value(o));
    const prior = conversion && !o.conversionVisitorDays ? '0 eligible visitor-days' : show(value(o));
    return `${base} · ${bucketLong(o.label, g)}: ${prior}${d ? ` (${d.text})` : ''}`;
  };
  const goalName = goals.find(x => x.key === sel.goal)?.name ?? 'All goals (union)';
  const table = exactTable(conversion ? `Conversion rate, ${goalName}` : `${unit} by bucket`,
    ['Bucket', 'Pageviews', 'Visitor-days', 'Completions', 'Converted visitor-days', 'Eligible visitor-days', 'Rate', ...(old ? ['Comparison bucket', 'Comparison value'] : [])],
    rows.map((r, i) => [r.label, fmt(r.pageviews), fmt(r.visitorDays), fmt(r.completions), fmt(r.convertedVisitorDays), fmt(r.conversionVisitorDays), pct(r.rate), ...(old ? [old[i]?.label ?? '—', old[i] ? show(value(old[i])) : '—'] : [])]));
  return {
    html: `${keyLine(unit, g, !!old)}<div class="ins-chart" id="chart" role="img" aria-label="${esc(`${unit}, ${granName(g)}, ${rangeLabel(sel.from, sel.to)}${old && sel.cmp ? `; grey line ${rangeLabel(sel.cmp.from, sel.cmp.to)}` : ''}. Inspect with the slider below or open the exact table.`)}"></div>${inspectMarkup}${foot(table, 'timeline')}`,
    wire: root => {
      const host = root.querySelector<HTMLElement>('#chart');
      if (!host) return;
      let index: (clientX: number, rect: DOMRect) => number = () => -1;
      redraw = () => { index = drawTrend(host, cur, was, max, axis, labels, at[sel.view] ?? cur.length - 1); };
      redraw();
      inspector(root, sel.view, rows.length, `Inspect ${unit.toLowerCase()} by bucket`, describe, host, (x, rect) => index(x, rect));
    },
  };
}

/* ---------- composition ---------- */
function compositionView(main: Packet): Rendered {
  const g = gran(main);
  const buckets = main.main.timeline ?? [];
  const rows = main.main.composition ?? [];
  const totals = new Map<string, { label: string; n: number }>();
  for (const r of rows) { const t = totals.get(r.key) ?? { label: r.category, n: 0 }; t.n += r.pageviews; totals.set(r.key, t); }
  const cats = [...totals.entries()].sort((a, b) => (a[0] === 'other' ? 1 : 0) - (b[0] === 'other' ? 1 : 0) || b[1].n - a[1].n);
  const color = new Map(cats.map(([key], i) => [key, key === 'other' ? OTHER : SERIES[i % SERIES.length] ?? OTHER]));
  const cell = (bucket: string, key: string): number => rows.find(r => r.bucket === bucket && r.key === key)?.pageviews ?? 0;
  const max = niceMax(Math.max(0, ...buckets.map(b => b.pageviews)) * 1.08);
  const describe = (i: number): string => {
    const b = buckets[i];
    if (!b) return '';
    return `${bucketLong(b.label, g)}: ${fmt(b.pageviews)} pageviews · ${cats.map(([key, c]) => `${c.label} ${fmt(cell(b.key, key))}`).join(' · ')}`;
  };
  const legend = `<fieldset class="ins-legend"><legend class="visually-hidden">Show layers</legend>${cats.map(([key, c]) => `<label><input type="checkbox" data-layer="${esc(key)}" ${hiddenLayers.has(key) ? '' : 'checked'}><span class="sw" style="background:${color.get(key)}"></span>${esc(c.label)}</label>`).join('')}</fieldset>`;
  const table = exactTable('Pageviews by bucket and category', ['Bucket', 'Category', 'Pageviews'], rows.map(r => [buckets.find(b => b.key === r.bucket)?.label ?? r.bucket, r.category, fmt(r.pageviews)]));
  return {
    html: `${keyLine('Pageviews', g, false)}${legend}<div class="ins-chart" id="chart" role="img" aria-label="${esc(`Pageviews stacked by ${main.compositionDimension}, ${granName(g)}. Hidden layers keep the scale; totals and table include every category.`)}"></div>${inspectMarkup}${foot(table, 'composition')}`,
    wire: root => {
      const host = root.querySelector<HTMLElement>('#chart');
      if (!host) return;
      let geometry = { l: 0, iw: 1 };
      redraw = () => {
        const { W, H, narrow } = plotFrame(host);
        const pad = { l: narrow ? 40 : 48, r: 10, t: 10, b: 26 };
        const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, n = buckets.length;
        geometry = { l: pad.l, iw };
        const bw = iw / Math.max(1, n);
        const focus = at[sel.view] ?? n - 1;
        const bars = buckets.map((b, i) => {
          let sum = 0;
          return cats.filter(([key]) => !hiddenLayers.has(key)).map(([key]) => {
            const v = cell(b.key, key);
            const h = v / max * ih;
            sum += h;
            return v ? `<rect x="${(pad.l + i * bw + (bw > 4 ? 1 : 0)).toFixed(1)}" y="${(pad.t + ih - sum).toFixed(1)}" width="${Math.max(1, bw - (bw > 4 ? 2 : 0)).toFixed(1)}" height="${h.toFixed(1)}" fill="${color.get(key)}"/>` : '';
          }).join('');
        }).join('');
        const cursor = buckets[focus] ? `<rect class="ins-focus" x="${(pad.l + focus * bw).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${ih}"/>` : '';
        host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${yAxis(W, pad, ih, max, narrow, compact)}${xAxis(buckets.map(b => bucketShort(b.label, g)), i => pad.l + (i + 0.5) * bw, iw, H)}${cursor}${bars}</svg>`;
      };
      redraw();
      root.querySelectorAll<HTMLInputElement>('[data-layer]').forEach(box => box.addEventListener('change', () => {
        const key = box.dataset.layer ?? '';
        if (box.checked) hiddenLayers.delete(key); else hiddenLayers.add(key);
        redraw?.();
      }));
      inspector(root, sel.view, buckets.length, 'Inspect composition by bucket', describe, host, (x, rect) => buckets.length ? Math.max(0, Math.min(buckets.length - 1, Math.floor((x - rect.left - geometry.l) / (geometry.iw / buckets.length)))) : -1);
    },
  };
}

/* ---------- acquisition ---------- */
function drilldown(r: InsightRow, dimension: string): string | null {
  if (r.key === 'other') return null;
  const value = r.key.slice(2);
  if (dimension === 'project') return pageAddress({ ...sel, scope: 'site', id: value, dimension: 'source', composition: 'source', goal: '' });
  if (!value || value.length > 300 || value.includes('|')) return null;
  return pageAddress({ ...sel, goal: '', f: [sel.f, `${dimension}:${value}`].filter(Boolean).join('|') });
}
function acquisitionView(main: Packet): Rendered {
  const ranking = main.main.ranking ?? [];
  const total = main.main.totals?.pageviews ?? 0;
  const max = Math.max(1, ...ranking.map(r => r.pageviews));
  const share = (r: InsightRow): number => total ? r.pageviews / total : 0;
  const goalName = goals.find(x => x.key === sel.goal)?.name ?? 'All goals (union)';
  const list = ranking.length ? `<ol class="ins-rank">${ranking.map(r => {
    const href = drilldown(r, main.dimension);
    return `<li><div class="ins-rank-row">${href ? `<a href="${esc(href)}">${esc(r.label)}</a>` : `<span>${esc(r.label)}</span>`}<span class="num">${fmt(r.pageviews)} <span class="muted">${pct(share(r))}</span></span></div><span class="ins-bar"><span style="width:${(r.pageviews / max * 100).toFixed(1)}%"></span></span></li>`;
  }).join('')}</ol>` : '<p class="muted ins-empty">No pageviews in this period.</p>';
  const table = exactTable(`Ranked ${main.dimension}, rates for ${goalName}`, ['Category', 'Pageviews', 'Share', 'Completions', 'Converted visitor-days', 'Eligible visitor-days', 'Rate'], ranking.map(r => [r.label, fmt(r.pageviews), pct(share(r)), fmt(r.completions), fmt(r.convertedVisitorDays), fmt(r.conversionVisitorDays), pct(r.rate)]));
  return { html: `<div class="chart-meta ins-key"><span>Pageviews · share of ${fmt(total)}</span></div>${list}${foot(table, 'ranking')}` };
}

/* ---------- arrival times ---------- */
function arrivalsView(main: Packet): Rendered {
  const cells = main.main.heatmap ?? [];
  const max = Math.max(1, ...cells.map(c => c.pageviews));
  const value = (w: number, h: number): number => cells.find(c => c.weekday === w && c.hour === h)?.pageviews ?? 0;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const pos = (i: number): [number, number] => [order[Math.floor(i / 24)] ?? 0, i % 24];
  const tz = meta?.timezone ?? '';
  const hours = Array.from({ length: 24 }, (_, h) => `<span class="hh">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('');
  const grid = order.map((w, row) => `<span class="dd">${WEEKDAYS[w]?.slice(0, 3) ?? ''}</span>${Array.from({ length: 24 }, (_, h) => {
    const v = value(w, h);
    return `<span class="heat" data-cell="${row * 24 + h}" style="background:${v ? `color-mix(in oklab, var(--color-accent-strong) ${(12 + v / max * 88).toFixed(0)}%, var(--color-paper-2))` : 'var(--color-paper)'}"></span>`;
  }).join('')}`).join('');
  const describe = (i: number): string => { const [w, h] = pos(i); return `${WEEKDAYS[w] ?? ''} ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59: ${fmt(value(w, h))} pageviews`; };
  const table = exactTable('Pageviews by weekday and hour', ['Weekday (Sunday=0)', 'Hour', 'Pageviews'], cells.map(c => [c.weekday, c.hour, fmt(c.pageviews)]));
  return {
    html: `<div class="chart-meta ins-key"><span>Pageviews by weekday and hour · ${esc(tz)}${meta?.organisation ? ' event time' : ' recorded local time'}</span></div><div class="ins-scroll ins-heat-wrap" role="region" aria-label="Weekday and hour heatmap" tabindex="0"><div class="heatmap" id="chart"><span></span>${hours}${grid}</div></div>${inspectMarkup}${foot(table, 'heatmap')}`,
    wire: root => {
      const map = root.querySelector<HTMLElement>('#chart');
      redraw = () => { map?.querySelectorAll<HTMLElement>('[data-cell]').forEach(c => c.classList.toggle('on', c.dataset.cell === String(at[sel.view] ?? -1))); };
      if (at[sel.view] === undefined) {
        let best = 0;
        for (let i = 0; i < 168; i++) { const [w, h] = pos(i), [bw, bh] = pos(best); if (value(w, h) > value(bw, bh)) best = i; }
        at[sel.view] = best;
      }
      inspector(root, sel.view, 168, 'Inspect weekday and hour', describe);
      const input = root.querySelector<HTMLInputElement>('#inspect');
      map?.addEventListener('pointerdown', e => {
        const cell = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-cell]') : null;
        if (!cell || !input) return;
        input.value = cell.dataset.cell ?? '0';
        input.dispatchEvent(new Event('input'));
      });
    },
  };
}

/* ---------- duration ---------- */
function durationView(main: Packet): Rendered {
  const bins = main.main.duration ?? [];
  const measuredBins = bins.slice(0, 6);
  const measured = measuredBins.reduce((n, r) => n + r.visits, 0);
  const unknown = bins[6]?.visits ?? 0;
  const all = measured + unknown;
  const max = Math.max(1, ...measuredBins.map(b => b.visits));
  const coverage = all ? `${fmt(measured)} of ${fmt(all)} visits measured (${pct(measured / all)}) · ${fmt(unknown)} unknown` : 'No visits started in this period';
  const bars = `<div class="ins-hist" role="img" aria-label="${esc(`Visible visit duration: ${measuredBins.map(b => `${b.label} ${b.visits}`).join(', ')}; ${unknown} unknown`)}">${measuredBins.map((b, i) => `<div><strong>${fmt(b.visits)}</strong><span class="bar" style="height:${(b.visits / max * 100).toFixed(1)}%"></span><span class="lbl">${DURATION_SHORT[i] ?? esc(b.label)}</span></div>`).join('')}</div>`;
  const table = exactTable('Visible visit duration', ['Bin', 'Visits'], bins.map(r => [r.label, fmt(r.visits)]));
  return { html: `<div class="chart-meta ins-key"><span>Visible visit duration · ${esc(coverage)}</span></div>${bars}${foot(table, 'duration')}` };
}

/* ---------- shell ---------- */
function goalSelect(): string {
  const options = goals.length ? goals : sel.goal ? [{ key: sel.goal, name: 'Selected goal' }] : [];
  return `<label class="ins-inline"><span class="visually-hidden">Goal</span><select class="select" id="goal">${[{ key: '', name: 'All goals (union)' }, ...options].map(g => `<option value="${esc(g.key)}"${g.key === sel.goal ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>`;
}
function seg(name: string, options: readonly (readonly [string, string])[], current: string, attr: string): string {
  return `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([id, label]) => `<button type="button" data-${attr}="${esc(id)}" aria-pressed="${id === current}">${esc(label)}</button>`).join('')}</div>`;
}
function localControls(view: View): string {
  if (view === 'traffic') return seg('Metric', METRICS, sel.metric, 'metric');
  if (view === 'conversion') return goalSelect();
  if (view === 'composition') return seg('Stack by', sel.scope === 'org' ? [['source', 'Source'], ['project', 'Project']] : [['source', 'Source']], sel.composition, 'composition');
  if (view === 'acquisition') return `<label class="ins-inline"><span class="visually-hidden">Rank by</span><select class="select" id="dimension">${RANKS.filter(([, , orgOnly]) => !orgOnly || sel.scope === 'org').map(([id, label]) => `<option value="${id}"${id === sel.dimension ? ' selected' : ''}>By ${label.toLowerCase()}</option>`).join('')}</select></label>${goalSelect()}`;
  return '';
}
function definitions(): string {
  const org = sel.scope === 'org';
  return `<details class="ins-about"><summary>Definitions</summary><ul>
    <li>${org ? 'Dates and buckets use UTC event time. Project reports use each project’s recorded local time, so totals near date edges can differ.' : `Days and hours use the project’s recorded local time (currently ${esc(meta?.timezone ?? '')}); repeated daylight-saving hours share a bucket.`}</li>
    <li>Visitor-days add each project’s daily visitors. They are not distinct people across days or projects.</li>
    <li>Conversion rate divides converted visitor-days by eligible visitor-days in the same bucket and filters, using the goal’s project when one goal is selected. Completions include repeats. No eligible visitor-days shows 0%.</li>
    <li>Composition shows the top six categories and ranking the top twenty; Other is the exact union of the rest. Page uses each pageview’s path; landing page uses the visit’s entry page.</li>
    <li>Arrival times total pageviews per weekday and hour without per-day normalisation.</li>
    <li>Duration is the visible time of visits starting in the period. Unmeasured visits are unknown, not zero.</li>
    <li>The comparison is aligned by bucket position. Activity-only signals add no traffic or conversions.</li>
  </ul></details>`;
}
function shell(): string {
  const v = viewOf(sel.view);
  const visitorLabel = sel.scope === 'org' ? 'Project visitor-days' : 'Visitor-days';
  return `<section class="panel ins-summary" aria-label="Totals">
      <div class="ledger ins-ledger">
        <div class="fig"><span class="k">Pageviews</span><span class="v" id="v-pageviews">—</span><span class="d" id="d-pageviews"></span></div>
        <div class="fig"><span class="k">${visitorLabel}</span><span class="v" id="v-visitorDays">—</span><span class="d" id="d-visitorDays"></span></div>
      </div>
      <p class="ins-state-line"><span id="state-summary" data-name="Totals"></span> <span id="state-summary-prev" data-name="Comparison"></span></p>
    </section>
    <nav class="ins-tabs" aria-label="Analysis">${VIEWS.map(x => `<a href="${esc(pageAddress({ ...sel, view: x.id }))}" data-view="${x.id}"${x.id === v.id ? ' aria-current="page"' : ''}>${x.label}</a>`).join('')}</nav>
    <section class="panel ins-panel" aria-labelledby="ins-title">
      <h2 class="visually-hidden" id="ins-title">${v.label}</h2>
      <div class="panel-head">${localControls(v.id)}</div>
      ${sel.cmp && v.section === 'timeline' ? '<p class="ins-state-line"><span id="state-cmp" data-name="Comparison"></span></p>' : ''}
      <div class="panel-body" id="panel-body"><div class="ins-state" id="state-panel">Waiting for exact results…</div></div>
    </section>
    ${definitions()}`;
}

/* ---------- painting ---------- */
function setMeta(p: Packet): void {
  meta = { name: p.name, timezone: p.timezone, organisation: p.organisation };
  if (JSON.stringify(goals) !== JSON.stringify(p.goals)) {
    goals = p.goals;
    const holder = document.getElementById('goal')?.parentElement;
    if (holder) { holder.outerHTML = goalSelect(); wireGoal(); }
  }
  node('heading').textContent = p.name;
  document.title = `${p.name} · Insights · PostDeploy Analytics`;
  scopeNote();
}
function figure(id: 'pageviews' | 'visitorDays', cur: number | undefined, prev: number | undefined): void {
  if (cur === undefined) return;
  node(`v-${id}`).textContent = fmt(cur);
  const d = prev === undefined ? null : change(cur, prev);
  node(`d-${id}`).innerHTML = d ? `<span class="${d.tone}">${esc(d.text)}</span><span class="visually-hidden"> compared with ${esc(sel.cmp ? rangeLabel(sel.cmp.from, sel.cmp.to) : '')}</span>` : '';
}
function paintSummary(): void {
  const main = packet('summary', 'main'), prev = packet('summary', 'prev');
  if (!main) return;
  setMeta(main);
  figure('pageviews', main.main.totals?.pageviews, prev?.main.totals?.pageviews);
  figure('visitorDays', main.main.totals?.visitorDays, prev?.main.totals?.visitorDays);
}
function paintPanel(): void {
  const v = viewOf(sel.view);
  const main = packet(v.section, 'main');
  const body = document.getElementById('panel-body');
  if (!main || !body) return;
  setMeta(main);
  redraw = null;
  const rendered = v.id === 'traffic' || v.id === 'conversion' ? trendView(main, packet('timeline', 'prev'), v.id === 'conversion')
    : v.id === 'composition' ? compositionView(main)
    : v.id === 'acquisition' ? acquisitionView(main)
    : v.id === 'arrivals' ? arrivalsView(main)
    : durationView(main);
  body.innerHTML = rendered.html;
  body.querySelector('details.ins-table')?.addEventListener('toggle', e => { tableOpen = (e.currentTarget as HTMLDetailsElement).open; });
  rendered.wire?.(body);
}

function fetchInto(url: string, target: HTMLElement, seq: number, paint: () => void): void {
  const hit = cache.get(url);
  if (hit) { paint(); return; }
  loader.enqueue(url, target, value => {
    cache.set(url, value as Packet);
    if (seq !== generation) return;
    target.textContent = '';
    paint();
  });
}

/* ---------- controls and chrome ---------- */
function scopeNote(): void {
  const tz = meta?.timezone ?? (sel.scope === 'org' ? 'UTC' : '');
  node('scope-note').textContent = [rangeLabel(sel.from, sel.to), tz, sel.cmp ? `vs ${rangeLabel(sel.cmp.from, sel.cmp.to)}` : ''].filter(Boolean).join(' · ');
}
function chips(): void {
  const parts = sel.f.split('|').filter(Boolean);
  const host = node('filters');
  host.hidden = !parts.length;
  host.innerHTML = parts.map((p, i) => {
    const at = p.indexOf(':');
    const dim = at > 0 ? DIMENSION_NAMES[p.slice(0, at)] ?? p.slice(0, at) : 'Filter';
    const value = at > 0 ? p.slice(at + 1) : p;
    return `<span class="chip">${esc(dim)} is <b>${esc(value)}</b><button type="button" data-remove="${i}" aria-label="Remove filter ${esc(dim)} is ${esc(value)}"><svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></span>`;
  }).join('') + (parts.length > 1 || sel.goal ? '<button type="button" class="btn btn-ghost btn-sm" id="clear">Clear filters and goal</button>' : '');
  host.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(b => b.addEventListener('click', () => {
    sel = { ...sel, f: parts.filter((_, i) => String(i) !== b.dataset.remove).join('|') };
    load(true);
  }));
  document.getElementById('clear')?.addEventListener('click', () => { sel = { ...sel, f: '', goal: '' }; load(true); });
}
function syncControls(): void {
  field('from').value = sel.from;
  field('to').value = sel.to;
  node<HTMLSelectElement>('compare').value = sel.cmp ? 'prev' : 'off';
  field('f').value = sel.f;
  node('filter-field').hidden = !filtersOpen;
  node('filter-toggle').setAttribute('aria-expanded', String(filtersOpen));
  node('range-error').textContent = '';
  const cmp = sel.cmp ? 'prev' : 'off';
  const single = sel.f && !sel.f.includes('|') ? `&f=${encodeURIComponent(sel.f)}` : '';
  node<HTMLAnchorElement>('nav-insights').href = pageAddress(sel);
  node<HTMLAnchorElement>('nav-report').href = sel.scope === 'org' ? `/organisations?org=${encodeURIComponent(sel.id)}&from=${sel.from}&to=${sel.to}&compare=${cmp}${single}` : '/organisations';
  node<HTMLAnchorElement>('nav-projects').href = sel.scope === 'site' ? `/dashboard#/overview?site=${encodeURIComponent(sel.id)}&range=custom&from=${sel.from}&to=${sel.to}&cmp=${cmp}${single}` : '/dashboard#/overview';
  chips();
  scopeNote();
}
function wireGoal(): void {
  document.getElementById('goal')?.addEventListener('change', e => { sel = { ...sel, goal: (e.currentTarget as HTMLSelectElement).value }; load(true); });
}
function wireLocal(): void {
  const root = node('report');
  root.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(b => b.addEventListener('click', () => { const m = METRICS.find(([id]) => id === b.dataset.metric)?.[0]; if (m) { sel = { ...sel, metric: m }; load(true); } }));
  root.querySelectorAll<HTMLButtonElement>('[data-composition]').forEach(b => b.addEventListener('click', () => { sel = { ...sel, composition: b.dataset.composition ?? 'source' }; load(true); }));
  wireGoal();
  root.querySelector<HTMLSelectElement>('#dimension')?.addEventListener('change', e => { sel = { ...sel, dimension: (e.currentTarget as HTMLSelectElement).value }; load(true); });
}

function load(push: boolean): void {
  const seq = ++generation;
  const key = apiQuery(sel, true).toString();
  if (key !== cacheKey) { cache.clear(); cacheKey = key; at = {}; hiddenLayers.clear(); }
  const address = pageAddress(sel);
  if (push) history.pushState(null, '', address); else history.replaceState(null, '', address);
  loader.reset();
  redraw = null;
  node('status').textContent = '';
  if (!meta) node('heading').textContent = sel.id || 'Insights';
  syncControls();
  const report = node('report');
  report.innerHTML = shell();
  wireLocal();
  report.querySelectorAll<HTMLAnchorElement>('[data-view]').forEach(a => a.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const next = VIEWS.find(v => v.id === a.dataset.view)?.id;
    if (next && next !== sel.view) { sel = { ...sel, view: next }; load(true); document.querySelector<HTMLAnchorElement>(`[data-view="${next}"]`)?.focus(); }
  }));
  fetchInto(sectionUrl(sel, 'summary', 'main'), node('state-summary'), seq, paintSummary);
  if (sel.cmp) fetchInto(sectionUrl(sel, 'summary', 'prev'), node('state-summary-prev'), seq, paintSummary);
  const section = viewOf(sel.view).section;
  fetchInto(sectionUrl(sel, section, 'main'), node('state-panel'), seq, paintPanel);
  if (sel.cmp && section === 'timeline') fetchInto(sectionUrl(sel, 'timeline', 'prev'), node('state-cmp'), seq, paintPanel);
}

async function init(): Promise<void> {
  await window.PostDeployAuth.refresh();
  if (!window.PostDeployAuth.user) { location.assign('/auth'); return; }
  filtersOpen = !!sel.f;
  node('controls').addEventListener('submit', e => {
    e.preventDefault();
    const from = field('from').value, to = field('to').value;
    if (!from || !to) { node('range-error').textContent = 'Choose both dates.'; return; }
    if (from > to) { node('range-error').textContent = 'The start date must be on or before the end date.'; return; }
    const compare = node<HTMLSelectElement>('compare').value === 'prev';
    sel = { ...sel, from, to, cmp: compare ? comparison(from, to) : null, f: field('f').value.trim() };
    cache.clear();
    load(true);
  });
  node('filter-toggle').addEventListener('click', () => {
    filtersOpen = !filtersOpen;
    node('filter-field').hidden = !filtersOpen;
    node('filter-toggle').setAttribute('aria-expanded', String(filtersOpen));
    if (filtersOpen) field('f').focus();
  });
  node('nav-toggle').addEventListener('click', () => {
    const open = !node('nav').classList.contains('open');
    node('nav').classList.toggle('open', open);
    node('nav-toggle').setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('popstate', () => { sel = readSel(); load(false); });
  node('logout').addEventListener('click', () => void window.PostDeployAuth.logout());
  let width = 0;
  new ResizeObserver(entries => {
    const next = Math.round(entries[0]?.contentRect.width ?? 0);
    if (next !== width) { width = next; redraw?.(); }
  }).observe(node('report'));
  load(false);
}
void init().catch(e => { node('status').textContent = `${e instanceof Error ? e.message : String(e)} Reload to retry.`; });
