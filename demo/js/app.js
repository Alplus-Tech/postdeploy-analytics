(function () {
  "use strict";
  const D = window.PDData;
  const DAY = D.DAY;

  /* ---------- helpers ---------- */
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("en-GB");
  const fmtInt = (n) => nf.format(Math.round(n));
  function fmtCompact(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, "") + "M";
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return nf.format(n);
  }
  const fmtPct = (x, d = 1) => (x * 100).toFixed(d) + "%";
  function fmtDur(s) {
    if (s == null) return "Unknown";
    s = Math.round(s);
    const m = Math.floor(s / 60);
    return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  }
  const site = () => state.sites.find((s) => s.id === state.siteId) || state.sites[0] || NO_SITE;
  const money = (n, compact) => site().currency + (compact ? fmtCompact(n) : fmtInt(n));
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDay = (ms) => { const d = new Date(ms); return `${d.getUTCDate()} ${monthNames[d.getUTCMonth()]}`; };
  const fmtDayY = (ms) => `${fmtDay(ms)} ${new Date(ms).getUTCFullYear()}`;
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: API ? site().timezone : undefined });
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const ICON = {
    chevron: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    user: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="5.5" r="2.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.75 13.5c.9-2.4 2.9-3.75 5.25-3.75s4.35 1.35 5.25 3.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    menu: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    info: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5M10 6.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    ok: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 10.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8 18 17H2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v4M10 14.6v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    mark: '<svg viewBox="0 0 512 512" width="24" height="24" aria-hidden="true" focusable="false"><path fill="var(--color-accent)" d="M96 190C60 150 90 105 150 80C230 42 345 25 408 60C458 88 452 141 394 176C328 216 198 240 140 228C112 222 104 208 96 190Z"/><path fill="var(--color-ink)" d="M258 234C330 226 400 292 434 370C462 434 428 466 350 471C268 476 162 474 116 455C72 437 66 396 96 342C126 289 192 241 258 234Z"/></svg>'
  };

  /* ---------- state ---------- */
  const STORE_KEY = "postdeploy-demo-sites-v1";
  const now = new Date();
  const todayMs = D.dayStart(now);
  function siteToday() {
    if (!API) return todayMs;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: site().timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  }
  const RANGES = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["12m", "Last 12 months"], ["custom", "Custom range"]];
  const METRICS = [
    { id: "visitors", label: "Visitor-days", f: (t) => fmtCompact(t.visitors), raw: (t) => t.visitors },
    { id: "pageviews", label: "Pageviews", f: (t) => fmtCompact(t.pageviews), raw: (t) => t.pageviews },
    { id: "bounceRate", label: "Bounce rate", f: (t) => fmtPct(t.bounceRate, 0), raw: (t) => t.bounceRate, lowerIsBetter: true, rate: true },
    { id: "duration", label: "Visible visit duration", f: (t) => t.duration == null ? "Unknown" : fmtDur(t.duration), raw: (t) => t.duration, rate: true },
    { id: "conversions", label: "Goal completions", f: (t) => fmtCompact(t.conversions), raw: (t) => t.conversions },
    { id: "revenue", label: "Revenue", f: (t) => money(t.revenue, true), raw: (t) => t.revenue }
  ];

  const state = {
    sites: [],
    health: null,
    rep: { key: "", status: "idle", data: null, error: null },
    route: "overview",
    sub: "",
    siteId: "fernhill",
    range: "30d",
    custom: { from: D.isoDay(todayMs - 13 * DAY), to: D.isoDay(todayMs) },
    compare: "prev",
    filters: [],
    metric: "visitors",
    panelTabs: { sources: "source", pages: "page", devices: "device" },
    audienceDim: "source",
    sort: { key: "visitors", dir: -1 },
    chartAsTable: false,
    reveal: { more: false, goals: false, breakdowns: false },
    failReports: false,
    live: { paused: false, data: null, siteId: null, fresh: new Set(), error: null, selected: null, session: null, kind: "all" },
    team: [
      { id: 1, name: "Maya Okafor", email: "maya@fernhill.example", role: "Owner", status: "Active" },
      { id: 2, name: "Tomas Lindqvist", email: "tomas@fernhill.example", role: "Admin", status: "Active" },
      { id: 3, name: "Priya Raman", email: "priya@fernhill.example", role: "Viewer", status: "Active" }
    ],
    keys: [
      { id: 1, name: "Weekly report script", prefix: "pd_demo_7Hq2", scope: "Read", created: todayMs - 41 * DAY, lastUsed: todayMs - DAY },
      { id: 2, name: "Data warehouse sync", prefix: "pd_demo_K9vX", scope: "Read", created: todayMs - 102 * DAY, lastUsed: todayMs - 3 * DAY }
    ],
    newKey: null,
    mcp: { enabled: true, clients: [{ id: 1, name: "Desktop assistant", connected: todayMs - 9 * DAY, tools: ["Read reports", "Query events"] }], tools: { reports: true, events: true, goals: false, manage: false } },
    deploy: { status: "live", steps: null, failNext: false, version: "1.4.0", account: "Demo account", region: "Automatic", history: [{ v: "1.4.0", at: todayMs - 6 * DAY, ok: true }, { v: "1.3.2", at: todayMs - 27 * DAY, ok: true }] },
    settings: { publicDashboard: false, excludeBots: true, respectDnt: true, retention: "24", timezone: "" },
    tracking: { platform: "html", verify: "idle" },
    onboard: null,
    menus: {}
  };
  let nextId = 100;
  let ds = null;
  let API = false;
  const isAdmin = () => !API || window.PostDeployAuth.user?.role === "admin";
  const NO_SITE = { id: "", name: "PostDeploy", domain: "No website yet", currency: "", empty: true, goals: [] };

  /* ---------- data sources ---------- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const lazyDims = (fn) => Object.keys(D.DIMENSIONS).reduce((o, dim) => {
    let v = null;
    return Object.defineProperty(o, dim, { enumerable: true, get: () => v || (v = fn(dim)) });
  }, {});

  function demoSource() {
    const live = { siteId: null, feed: [], history: [], seq: 0 };
    // Websites created in the demo, with their sample pageviews, are kept in
    // this browser so a reload does not lose them. Reset the demo to clear.
    function loadCreatedSites() {
      try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
        if (!Array.isArray(raw)) return [];
        return raw
          .filter((x) => x && typeof x.id === "string" && typeof x.domain === "string" && typeof x.name === "string" && ["store", "saas", "docs"].includes(x.kind) && Array.isArray(x.visits))
          .map((x) => {
            const visits = x.visits.filter((v) => v && Number.isFinite(v.at) && Number.isFinite(v.real) && typeof v.page === "string");
            return D.makeSite(Object.assign({}, x, { visits, empty: visits.length === 0 }));
          });
      } catch (e) {
        return [];
      }
    }
    const sites = D.defaultSites().concat(loadCreatedSites());
    const find = (id) => sites.find((s) => s.id === id);
    const save = () => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(sites.filter((s) => s.visits))); } catch (e) { /* the demo keeps working without storage */ }
    };
    function tick(s, initial) {
      if (s.visits) {
        if (!initial) return;
        live.feed = s.visits.map((v, i) => ({ id: "v" + i, kind: "pageview", page: v.page, source: "Direct", country: "Unknown", device: "Desktop", sessionId: "v" + i, at: v.real })).reverse();
        const nowMs = Date.now();
        live.history = Array.from({ length: 30 }, (_, i) => s.visits.filter((v) => Math.floor((nowMs - v.real) / 60000) === 29 - i).length);
        return;
      }
      if (s.empty) return;
      const add = initial ? 14 : 1;
      for (let k = 0; k < add; k++) {
        live.seq++;
        const ev = D.liveEvent(s, Math.floor(Date.now() / 2600) * 10 + live.seq);
        ev.id = "e" + live.seq;
        ev.at = Date.now() - (initial ? (add - k) * 21000 : 0);
        live.feed.unshift(ev);
      }
      live.feed = live.feed.slice(0, 60);
      const h = live.history;
      if (initial || !h.length) {
        live.history = Array.from({ length: 30 }, (_, i) => Math.max(1, Math.round(D.liveVisitors(s, new Date(Date.now() - (29 - i) * 60000)) * 1.6 * (0.8 + D.rand(s.id + "lh" + i + Math.floor(Date.now() / 60000)) * 0.4))));
      } else {
        h[h.length - 1] += 1;
      }
    }
    return {
      mode: "demo",
      livePeriod: 2600,
      async health() { return { ok: true, mode: "demo" }; },
      async listSites() { return sites.slice(); },
      async createSite(input) {
        const base = { store: 140, saas: 90, docs: 260 }[input.kind];
        const s = D.makeSite({ id: "site-" + Date.now().toString(36), name: input.name, domain: input.domain, kind: input.kind, base, growth: 0.002, ppv: 3, bounce: 0.44, duration: 140, aov: input.kind === "docs" ? 99 : 45, currency: "€", timezone: "UTC", created: D.isoDay(todayMs), empty: true, visits: [] });
        sites.push(s);
        save();
        return s;
      },
      async updateSite(id, patch) { const s = find(id); Object.assign(s, patch); save(); return s; },
      async deleteSite(id) { const i = sites.findIndex((s) => s.id === id); if (i >= 0) sites.splice(i, 1); save(); },
      async report(p) {
        await wait(380);
        if (p.fail) throw Object.assign(new Error("simulated"), { code: "simulated" });
        const s = find(p.siteId);
        const r = D.query(s, { range: p.range, custom: p.custom, compare: p.compare, filters: p.filters, todayMs, nowHour: new Date().getHours() });
        const dims = (res, filters) => lazyDims((dim) => D.breakdown(s, res, dim, filters(dim)));
        return {
          goals: r.main.prof.goals,
          main: Object.assign({}, r.main, { breakdowns: dims(r.main, () => p.filters), options: dims(r.main, (dim) => p.filters.filter((f) => f.dim !== dim)), funnel: D.funnel(r.main), journeys: D.journeys(r.main) }),
          prev: r.prev && Object.assign({}, r.prev, { breakdowns: dims(r.prev, () => p.filters) })
        };
      },
      async live(siteId) {
        const s = find(siteId);
        if (live.siteId !== siteId) { live.siteId = siteId; live.feed = []; tick(s, true); } else tick(s, false);
        return { visitorsNow: D.liveVisitors(s, new Date()), perMinute: live.history.slice(), events: live.feed.slice() };
      },
      liveNow: (s) => D.liveVisitors(s, new Date()),
      async session(siteId, sessionId, at) {
        const s = find(siteId);
        const ev = live.feed.find((e) => e.at === at && e.sessionId === sessionId);
        const tl = s.visits && ev ? { source: ev.source, country: ev.country, device: ev.device, events: [{ at: ev.at, kind: "pageview", label: ev.page }] } : D.sessionTimeline(s, sessionId, at);
        if (ev && !s.visits) {
          Object.assign(tl, { source: ev.source, country: ev.country, device: ev.device });
          const views = tl.events.filter((e) => e.kind === "pageview");
          const shift = at - 30000 - views[views.length - 1].at;
          tl.events = views.map((e) => Object.assign({}, e, { at: e.at + shift }));
          tl.events.push(ev.kind === "pageview" ? { at, kind: "pageview", label: ev.page } : { at, kind: ev.kind, label: ev.goal, revenue: ev.revenue });
        }
        return tl;
      },
      async verify(siteId) {
        await wait(1400);
        const s = find(siteId);
        return { received: !s.empty, lastEventAt: null, events: s.visits ? s.visits.length : 0 };
      },
      visitors30d: (s) => (s.empty ? 0 : D.query(s, { range: "30d", compare: null, filters: [], todayMs, nowHour: new Date().getHours() }).main.totals.visitors),
      sampleVisit(siteId, page) {
        const s = find(siteId);
        s.visits.push({ at: D.clockMs(new Date()), real: Date.now(), page });
        s.empty = false;
        save();
        live.siteId = null;
        return s;
      },
      reset() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing stored */ } }
    };
  }

  function apiSource() {
    const fail = (code, message) => Object.assign(new Error(message || code), { code, fromApi: true });
    async function call(method, path, body) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await fetch(path, { method, signal: ctrl.signal, headers: body ? { "Content-Type": "application/json", "X-CSRF-Token": window.PostDeployAuth.csrf || "" } : {}, body: body ? JSON.stringify(body) : undefined });
        const data = res.status === 204 ? null : await res.json().catch(() => null);
        if (res.status === 401) location.assign("/auth");
        if (!res.ok) throw fail((data && data.error) || "http_" + res.status, data && data.message);
        return data;
      } catch (e) {
        throw e.fromApi ? e : fail(ctrl.signal.aborted ? "timeout" : "network");
      } finally {
        clearTimeout(timer);
      }
    }
    const enc = encodeURIComponent;
    const asSite = (s) => Object.assign(s, { empty: s.lastEventAt == null });
    const liveNow = {};
    return {
      mode: "api",
      livePeriod: 5000,
      health: () => call("GET", "/api/health"),
      listSites: async () => (await call("GET", "/api/sites")).map(asSite),
      createSite: async (input) => asSite(await call("POST", "/api/sites", input)),
      updateSite: async (id, patch) => asSite(await call("PATCH", "/api/sites/" + enc(id), patch)),
      deleteSite: (id) => call("DELETE", "/api/sites/" + enc(id)),
      report(p) {
        const q = new URLSearchParams({ site: p.siteId, from: p.from, to: p.to });
        if (p.cmpFrom) { q.set("cmpFrom", p.cmpFrom); q.set("cmpTo", p.cmpTo); }
        if (p.filters.length) q.set("f", p.filters.map((f) => `${f.dim}:${f.value}`).join("|"));
        return call("GET", "/api/report?" + q);
      },
      async live(siteId) {
        const r = await call("GET", "/api/live?site=" + enc(siteId));
        liveNow[siteId] = r.visitorsNow;
        return r;
      },
      liveNow: (s) => (s.id in liveNow ? liveNow[s.id] : null),
      session: (siteId, sessionId) => call("GET", `/api/sessions/${enc(sessionId)}?site=${enc(siteId)}`),
      verify: (siteId) => call("GET", `/api/sites/${enc(siteId)}/verify`),
      visitors30d: (s) => s.visitors30d || 0
    };
  }

  async function pickSource() {
    if ((location.protocol === "http:" || location.protocol === "https:") && new URLSearchParams(location.search).get("demo") !== "1") {
      const api = apiSource();
      state.health = await api.health();
      return api;
    }
    return demoSource();
  }

  function errText(e) {
    if (e.code === "timeout") return "The analytics server took too long to answer.";
    if (e.code === "network") return "The analytics server could not be reached.";
    if (e.code === "owner_access_not_configured") return "Owner access is not set up for this installation yet.";
    return e.message && e.message !== e.code ? e.message : `The server answered with ${e.code}.`;
  }

  /* ---------- URL state ---------- */
  function readHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const parts = (path || "overview").split("/");
    state.route = ["overview", "audience", "conversions", "live", "manage", "welcome"].includes(parts[0]) ? parts[0] : "overview";
    state.sub = parts[1] || "";
    const q = new URLSearchParams(qs || "");
    state.missingSite = null;
    if (q.get("site") && state.sites.some((s) => s.id === q.get("site"))) state.siteId = q.get("site");
    else if (q.get("site")) state.missingSite = q.get("site");
    state.range = RANGES.some((r) => r[0] === q.get("range")) ? q.get("range") : "30d";
    if (q.get("from") && q.get("to")) state.custom = { from: q.get("from"), to: q.get("to") };
    state.compare = ["prev", "year", "off"].includes(q.get("cmp")) ? q.get("cmp") : "prev";
    state.metric = METRICS.some((m) => m.id === q.get("m")) ? q.get("m") : "visitors";
    if (q.get("dim") && D.DIMENSIONS[q.get("dim")]) state.audienceDim = q.get("dim");
    state.filters = (q.get("f") || "").split("|").filter(Boolean).map((p) => {
      const i = p.indexOf(":");
      return { dim: p.slice(0, i), value: p.slice(i + 1) };
    }).filter((f) => D.DIMENSIONS[f.dim]);
  }

  function hashFor(patch = {}) {
    const s = Object.assign({ route: state.route, sub: state.sub, siteId: state.siteId, range: state.range, compare: state.compare, metric: state.metric, filters: state.filters, audienceDim: state.audienceDim, custom: state.custom }, patch);
    const q = new URLSearchParams();
    q.set("site", s.siteId);
    if (s.range !== "30d") q.set("range", s.range);
    if (s.range === "custom") { q.set("from", s.custom.from); q.set("to", s.custom.to); }
    if (s.compare !== "prev") q.set("cmp", s.compare);
    if (s.metric !== "visitors") q.set("m", s.metric);
    if (s.route === "audience") q.set("dim", s.audienceDim);
    if (s.filters.length) q.set("f", s.filters.map((f) => `${f.dim}:${f.value}`).join("|"));
    return "#/" + s.route + (s.sub ? "/" + s.sub : "") + "?" + q.toString();
  }
  const go = (patch) => { location.hash = hashFor(patch); readHash(); };

  /* ---------- data access ---------- */
  const REPORT_ROUTES = ["overview", "audience", "conversions"];
  const report = () => state.rep.data;
  function periods() {
    const b = D.rangeBounds(state.range, siteToday(), state.custom);
    const cb = state.compare === "prev" ? { start: b.start - b.days * DAY, end: b.start - DAY, days: b.days } : state.compare === "year" ? { start: b.start - 364 * DAY, end: b.end - 364 * DAY, days: b.days } : null;
    return { bounds: b, compareBounds: cb };
  }
  function reportParams() {
    const { bounds, compareBounds } = periods();
    return {
      siteId: site().id, range: state.range, custom: state.custom, compare: state.compare === "off" ? null : state.compare, filters: state.filters,
      from: D.isoDay(bounds.start), to: D.isoDay(bounds.end),
      cmpFrom: compareBounds && D.isoDay(compareBounds.start), cmpTo: compareBounds && D.isoDay(compareBounds.end),
      fail: state.failReports
    };
  }
  function reportKey() { return JSON.stringify([state.siteId, state.range, state.custom, state.compare, state.filters, state.route]); }

  let repSeq = 0;
  const REPORT_MAX_AGE_MS = 30_000;
  async function loadReport(force) {
    if (!REPORT_ROUTES.includes(state.route)) return;
    const key = reportKey();
    if (!force && key === state.rep.key && !(API && Date.now() - (state.rep.at || 0) > REPORT_MAX_AGE_MS)) return;
    const seq = ++repSeq;
    state.rep = { key, status: "loading", data: null, error: null };
    try {
      if (API && site().empty) await refreshSites();
      if (seq !== repSeq) return;
      if (site().empty) { state.rep = { key: "", status: "idle", data: null, error: null }; render(); return; }
      const data = await ds.report(reportParams());
      if (seq === repSeq) state.rep = { key, status: "ready", data, error: null, at: Date.now() };
    } catch (error) {
      if (seq === repSeq) state.rep = { key, status: "error", data: null, error };
    }
    if (seq === repSeq) render();
  }

  async function refreshSites() {
    state.sites = (await ds.listSites()).filter((s) => !pendingDeletes.has(s.id));
  }
  const pendingDeletes = new Set();
  function putSite(s) {
    const i = state.sites.findIndex((x) => x.id === s.id);
    if (i >= 0) state.sites[i] = s;
  }

  function rangeLabel(b) {
    if (state.range === "today") return "Today so far";
    if (b.days === 1) return fmtDayY(b.start);
    const sameYear = new Date(b.start).getUTCFullYear() === new Date(b.end).getUTCFullYear();
    return `${sameYear ? fmtDay(b.start) : fmtDayY(b.start)} to ${fmtDayY(b.end)}`;
  }
  function compareLabel() {
    if (state.compare === "year") return "same period last year";
    const r = RANGES.find((x) => x[0] === state.range);
    if (state.range === "today") return "yesterday";
    if (state.range === "custom") return "the previous period";
    return "previous " + r[1].replace("Last ", "");
  }
  function delta(cur, prev, lowerIsBetter) {
    if (cur == null || prev == null) return { text: "coverage unavailable", cls: "" };
    if (!prev || prev === 0) return { text: "no earlier data", cls: "" };
    const d = (cur - prev) / prev;
    const good = lowerIsBetter ? d < 0 : d > 0;
    const sign = d > 0 ? "+" : d < 0 ? "−" : "";
    return { text: `${sign}${Math.abs(d * 100).toFixed(1)}%`, cls: Math.abs(d) < 0.005 ? "" : good ? "pos" : "neg" };
  }

  /* ---------- chrome ---------- */
  function renderTopbar() {
    const s = site();
    const live = s.empty ? null : ds.liveNow(s);
    const links = [["overview", "Overview"], ["audience", "Audience"], ["conversions", "Conversions"], ["live", "Live"], ["manage", "Manage"]];
    $("#topbar").innerHTML = `<div class="container">
      <a class="wordmark" href="${hashFor({ route: "overview", sub: "" })}" aria-label="PostDeploy Analytics, overview">${ICON.mark}<span class="logo-word hide-sm">postdeploy<span class="logo-period">.</span></span></a>
      <div class="pop">
        <button type="button" class="btn site-btn" data-menu="site" aria-haspopup="true" aria-expanded="${!!state.menus.site}"><span class="site-mark">${esc(initials(s.name))}</span><span class="domain">${esc(s.domain)}</span>${ICON.chevron}</button>
        <div class="menu" role="menu" ${state.menus.site ? "" : "hidden"}>
          <p class="menu-note">Websites</p>
          ${state.sites.map((x) => `<button type="button" role="menuitemradio" aria-checked="${x.id === s.id}" data-act="site" data-id="${x.id}"><span class="site-mark">${esc(initials(x.name))}</span><span>${esc(x.name)}<br><span class="muted">${esc(x.domain)}</span></span>${x.id === s.id ? `<span class="tick">${ICON.check.replace("<svg", '<svg width="14" height="14"')}</span>` : ""}</button>`).join("")}
          <hr><button type="button" role="menuitem" data-act="start-onboard">${ICON.plus} Add a website</button>
        </div>
      </div>
      <nav class="nav" id="nav" aria-label="Main">
        ${API ? `<a href="/organisations?org=${encodeURIComponent(s.organisationId || "default")}">Organisation</a>` : ""}
        ${links.map(([id, label]) => `<a href="${hashFor({ route: id, sub: "" })}" ${state.route === id ? 'aria-current="page"' : ""}>${label}${id === "live" && live != null ? ` <span class="count" aria-label="${live} visitors now">${live}</span>` : ""}</a>`).join("")}
      </nav>
      <div class="topbar-end">
        <button type="button" class="btn btn-ghost menu-toggle" data-act="nav-toggle" aria-expanded="false" aria-controls="nav" aria-label="Menu">${ICON.menu}<span class="hide-sm">Menu</span></button>
        <div class="pop">
          <button type="button" class="btn btn-ghost" data-menu="account" aria-haspopup="true" aria-expanded="${!!state.menus.account}" aria-label="Account menu"><span class="avatar">${API ? ICON.user : "MO"}</span></button>
          <div class="menu end" role="menu" ${state.menus.account ? "" : "hidden"}>
            <p class="menu-note">${API ? esc(window.PostDeployAuth.user?.email || "") : "Signed in as Maya Okafor (sample person)"}</p>
            <a role="menuitem" href="${hashFor({ route: "manage", sub: "team" })}">Team</a>
            <a role="menuitem" href="${hashFor({ route: "manage", sub: "settings" })}">Settings</a>
            ${API ? '<a role="menuitem" href="/auth#auth=password">Change password</a><hr><button type="button" role="menuitem" data-act="sign-out">Sign out</button>' : '<hr><button type="button" role="menuitem" data-act="toast" data-msg="Sign-out is not part of this demo.">Sign out</button>'}
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderDemoMenu() {
    $("#demo-pop").innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-menu="demo" aria-haspopup="true" aria-expanded="${!!state.menus.demo}">Demo controls ${ICON.chevron}</button>
      <div class="menu end" role="menu" ${state.menus.demo ? "" : "hidden"}>
        <p class="menu-note">Show states that real use would produce</p>
        <button type="button" role="menuitemcheckbox" aria-checked="${state.failReports}" data-act="toggle-fail">Reports fail to load${state.failReports ? `<span class="tick">${ICON.check.replace("<svg", '<svg width="14" height="14"')}</span>` : ""}</button>
        <button type="button" role="menuitemcheckbox" aria-checked="${state.deploy.failNext}" data-act="toggle-deploy-fail">Next deployment fails${state.deploy.failNext ? `<span class="tick">${ICON.check.replace("<svg", '<svg width="14" height="14"')}</span>` : ""}</button>
        <button type="button" role="menuitem" data-act="start-onboard">Replay first-run setup</button>
        <hr><button type="button" role="menuitem" data-act="reset">Reset the demo</button>
      </div>`;
  }

  /* ---------- report toolbar ---------- */
  function exportUrl(dataset) {
    const p=reportParams();
    const q=new URLSearchParams({site:p.siteId,from:p.from,to:p.to,dataset});
    if(p.cmpFrom) { q.set("cmpFrom",p.cmpFrom);q.set("cmpTo",p.cmpTo); }
    if(p.filters.length) q.set("f",p.filters.map(f=>f.dim+":"+f.value).join("|"));
    return "/api/export?"+q;
  }
  function toolbar(title, sub) {
    const r = periods();
    return `<div class="page-head">
      <div class="title"><h1>${title}</h1><span class="sub">${esc(site().name)} · ${rangeLabel(r.bounds)}${API ? ` · ${esc(site().timezone)}` : ""}${state.compare !== "off" && r.compareBounds ? ` · vs ${compareLabel()}` : ""}${sub ? ". " + sub : ""}</span></div>
      <div class="toolbar">
        ${API ? `<a class="btn" href="/insights?${esc(exportUrl("series").split("?")[1].replace(/&dataset=series/, ""))}">Insights</a><a class="btn" href="${esc(exportUrl(state.route==="audience"?state.audienceDim:state.route==="conversions"?"goals":"series"))}" title="Selected report and filters, including comparison. Up to 731 days and 10,000 rows. Page/referrer/campaign exports contain the displayed top 100.">Download CSV</a>` : ""}
        <label class="visually-hidden" for="range">Date range</label>
        <select class="select" id="range" data-change="range">${RANGES.map(([id, l]) => `<option value="${id}" ${id === state.range ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label class="visually-hidden" for="cmp">Compare with</label>
        <select class="select" id="cmp" data-change="compare">
          <option value="prev" ${state.compare === "prev" ? "selected" : ""}>Compare: previous period</option>
          <option value="year" ${state.compare === "year" ? "selected" : ""}>Compare: last year</option>
          <option value="off" ${state.compare === "off" ? "selected" : ""}>No comparison</option>
        </select>
        <div class="pop">
          <button type="button" class="btn" data-menu="filter" aria-haspopup="true" aria-expanded="${!!state.menus.filter}">${ICON.plus} Filter</button>
          <div class="menu end" role="menu" ${state.menus.filter ? "" : "hidden"}>${filterMenu()}</div>
        </div>
      </div>
    </div>
    ${state.range === "custom" ? customRange() : ""}
    ${filterChips()}`;
  }

  function customRange() {
    return `<form class="custom-range panel" style="padding:12px 16px;margin-bottom:16px" data-submit="custom">
      <div class="field"><label for="from">From</label><input class="input" type="date" id="from" name="from" value="${state.custom.from}" max="${D.isoDay(siteToday())}" min="2025-01-01" required></div>
      <div class="field"><label for="to">To</label><input class="input" type="date" id="to" name="to" value="${state.custom.to}" max="${D.isoDay(siteToday())}" min="2025-01-01" required></div>
      <div class="field"><span class="label">&nbsp;</span><button class="btn" type="submit">Apply range</button></div>
      <p class="help error" id="range-err" role="alert" style="flex-basis:100%;min-height:0"></p>
    </form>`;
  }

  function filterMenu() {
    if (state.menus.filter && state.menus.filter !== true) {
      const dim = state.menus.filter;
      const r = report();
      const rows = r ? (r.main.options || r.main.breakdowns)[dim].slice(0, 10) : [];
      return `<p class="menu-note">${D.DIMENSIONS[dim]} is</p>${rows.length ? rows.map((row) => `<button type="button" role="menuitem" data-act="add-filter" data-dim="${dim}" data-value="${esc(row.name)}">${esc(row.name)}<span class="tick muted num">${fmtCompact(row.visitors)}</span></button>`).join("") : '<p class="menu-note">No values in this range</p>'}<hr><button type="button" role="menuitem" data-act="filter-dim" data-dim="">Back</button>`;
    }
    return `<p class="menu-note">Filter every report by</p>${Object.entries(D.DIMENSIONS).map(([k, l]) => `<button type="button" role="menuitem" data-act="filter-dim" data-dim="${k}">${l}</button>`).join("")}`;
  }

  function filterChips() {
    if (!state.filters.length) return "";
    return `<div class="filters" aria-label="Active filters">${state.filters.map((f, i) => `<span class="chip">${D.DIMENSIONS[f.dim]} is <b>${esc(f.value)}</b><button type="button" data-act="rm-filter" data-i="${i}" aria-label="Remove filter ${D.DIMENSIONS[f.dim]} is ${esc(f.value)}">${ICON.x}</button></span>`).join("")}<button type="button" class="btn btn-ghost btn-sm" data-act="clear-filters">Clear all</button></div>`;
  }

  /* ---------- states ---------- */
  function skeleton(kind) {
    const line = (w, h = 14) => `<span class="skel" style="width:${w};height:${h}px"></span>`;
    if (kind === "overview") return `<div class="panel" aria-busy="true" aria-label="Loading report"><div class="ledger">${METRICS.map(() => `<div style="padding:16px 24px;display:grid;gap:8px">${line("60%")}${line("70%", 28)}${line("40%", 10)}</div>`).join("")}</div><div class="chart-wrap"><span class="skel" style="height:280px"></span></div></div><div class="grid-2" style="margin-top:16px">${[1, 2, 3, 4].map(() => `<div class="panel panel-body" style="display:grid;gap:12px">${line("30%", 18)}${[1, 2, 3, 4, 5].map(() => line("100%", 24)).join("")}</div>`).join("")}</div>`;
    return `<div class="panel panel-body" aria-busy="true" aria-label="Loading report" style="display:grid;gap:12px">${line("25%", 18)}${[1, 2, 3, 4, 5, 6, 7].map(() => line("100%", 28)).join("")}</div>`;
  }

  function errorState() {
    const simulated = state.rep.error.code === "simulated";
    return `<div class="panel"><div class="empty"><h2>This report did not load</h2><p>${simulated ? "The demo is set to fail report requests, the way a timed-out query would." : esc(errText(state.rep.error))} Your data is safe; nothing was changed.</p><div class="toolbar"><button type="button" class="btn btn-primary" data-act="retry">Try again</button>${simulated ? '<button type="button" class="btn btn-ghost" data-act="toggle-fail">Stop simulating failures</button>' : ""}</div></div></div>`;
  }

  function emptySiteState() {
    const s = site();
    return `<div class="panel"><div class="empty center"><h2>Waiting for the first visit to ${esc(s.domain)}</h2><p>Reports fill in as soon as the tracking snippet sends a pageview.${API ? "" : " In this demo you can send a sample one."}</p><div class="toolbar" style="justify-content:center">${API ? "" : '<button type="button" class="btn btn-primary" data-act="sample-visit">Send a sample pageview</button>'}<a class="btn${API ? " btn-primary" : ""}" href="${hashFor({ route: "manage", sub: "tracking" })}">Open tracking setup</a></div></div></div>`;
  }

  function noMatchState() {
    return `<div class="panel"><div class="empty center"><h2>No visits match these filters</h2><p>Nothing in this date range fits every filter at once. Remove one to widen the view.</p><button type="button" class="btn" data-act="clear-filters">Clear filters</button></div></div>`;
  }

  // Returns state markup or null when the full report should render.
  function reportGate(kind) {
    if (site().empty) return emptySiteState();
    if (state.rep.status === "error") return errorState();
    if (state.rep.status !== "ready") return skeleton(kind);
    if (report().main.totals.visitors < 0.5) return noMatchState();
    return null;
  }

  /* ---------- chart ---------- */
  function seriesFor(metricId) {
    const r = report();
    const m = METRICS.find((x) => x.id === metricId);
    const cur = r.main.buckets.map((b) => (b.future ? null : m.raw(b)));
    const prev = r.prev ? r.prev.buckets.map((b) => m.raw(b)) : null;
    return { m, cur, prev, buckets: r.main.buckets, prevBuckets: r.prev && r.prev.buckets, gran: r.main.gran };
  }

  function bucketLabel(b, gran) {
    if (gran === "hour") return String(b.label).padStart(2, "0") + ":00";
    if (gran === "week") return "Week of " + fmtDay(b.start);
    return b.start === siteToday() ? fmtDay(b.start) + ", so far" : fmtDay(b.start);
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function axisFmt(m, v) {
    if (m.id === "bounceRate") return Math.round(v * 100) + "%";
    if (m.id === "duration") return fmtDur(v);
    if (m.id === "revenue") return money(v, true);
    return v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0).replace(/\.0$/, "") + "k" : fmtInt(v);
  }

  function drawChart(el) {
    const { m, cur, prev, buckets, prevBuckets, gran } = seriesFor(state.metric);
    if (state.metric === "duration" && cur.every(v => v == null)) { el.innerHTML = '<p class="muted">Visible duration is unknown for this period. Activity observations are needed; elapsed event spans are not visible time.</p>'; return; }
    const W = Math.max(280, el.clientWidth);
    const H = el.clientHeight || 280;
    const pad = { l: 52, r: 8, t: 10, b: 26 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const vals = cur.filter((v) => v != null).concat(prev || []);
    const max = Math.max(niceMax(Math.max(...vals, 0) * 1.08), m.rate ? 0 : 4);
    const n = cur.length;
    const useBars = gran === "hour" || n <= 14;
    const x = (i) => pad.l + (useBars ? (i + 0.5) * (iw / n) : n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => pad.t + ih - (v / max) * ih;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`).join("");
    const yLabels = ticks.map((t) => `<text x="${pad.l - 10}" y="${y(t) + 4}" text-anchor="end">${axisFmt(m, t)}</text>`).join("");
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 80))));
    const xLabels = buckets.map((b, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${gran === "hour" ? String(b.label).padStart(2, "0") : fmtDay(b.start)}</text>` : "")).join("");
    let marks = "";
    if (useBars) {
      const bw = Math.min(24, (iw / n) * (prev ? 0.36 : 0.6));
      if (prev) marks += prev.map((v, i) => v == null ? "" : `<rect class="bar cmp" x="${x(i) - bw - 1}" y="${y(v)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(v))}" rx="2"/>`).join("");
      marks += cur.map((v, i) => (v == null ? "" : `<rect class="bar" x="${prev ? x(i) + 1 : x(i) - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, pad.t + ih - y(v))}" rx="2"/>`)).join("");
    } else {
      const pts = cur.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      const path = (p) => p.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("");
      if (prev) marks += `<path class="line cmp" d="${path(prev.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean))}"/>`;
      const partial = gran === "day" && buckets[buckets.length - 1].start === siteToday() && pts.length > 1;
      const solid = partial ? pts.slice(0, -1) : pts;
      if (pts.length) marks += `<path class="area" d="${path(solid)}L${solid[solid.length - 1][0]},${pad.t + ih}L${solid[0][0]},${pad.t + ih}Z"/><path class="line" d="${path(solid)}"/>`;
      if (partial) marks += `<path class="line partial" d="${path(pts.slice(-2))}"/>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
      <defs><linearGradient id="area-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--color-accent)" stop-opacity="0.16"/><stop offset="1" stop-color="var(--color-accent)" stop-opacity="0"/></linearGradient></defs>
      <g class="grid">${grid}</g><g class="axis">${yLabels}${xLabels}</g>${marks}<g class="hover"></g></svg><div class="tip" hidden></div>`;
    el.setAttribute("aria-label", `${m.label} by ${gran}. ${m.f(report().main.totals)} in total. Use the left and right arrow keys to read each ${gran}.`);

    const tip = $(".tip", el);
    const hover = $(".hover", el);
    const show = (i) => {
      if (i < 0 || i >= n || cur[i] == null) { hover.innerHTML = ""; tip.hidden = true; return; }
      el.dataset.i = i;
      hover.innerHTML = `<line class="cursor" x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${pad.t + ih}"/>${!useBars ? `${prev ? `<circle class="dot cmp" cx="${x(i)}" cy="${y(prev[i])}" r="4"/>` : ""}<circle class="dot" cx="${x(i)}" cy="${y(cur[i])}" r="4.5"/>` : ""}`;
      const fmt = (v) => (m.id === "bounceRate" ? fmtPct(v) : m.id === "duration" ? fmtDur(v) : m.id === "revenue" ? money(v) : fmtInt(v));
      const d = prev ? delta(cur[i], prev[i], m.lowerIsBetter) : null;
      tip.innerHTML = `<div class="dim">${bucketLabel(buckets[i], gran)}</div><div class="row"><span>${m.label}</span><b>${fmt(cur[i])}</b></div>${prev ? `<div class="row dim"><span>${bucketLabel(prevBuckets[i], gran)}</span><span>${fmt(prev[i])}</span></div><div class="row dim"><span>Change</span><span>${d.text}</span></div>` : ""}`;
      tip.hidden = false;
      const left = Math.min(W - tip.offsetWidth - 4, Math.max(0, x(i) + 12));
      tip.style.transform = `translate(${x(i) + 12 + tip.offsetWidth > W ? x(i) - tip.offsetWidth - 12 : left}px, ${pad.t}px)`;
      $("#announce").textContent = "";
    };
    el.onpointermove = (e) => {
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - pad.l;
      const i = useBars ? Math.floor(px / (iw / n)) : Math.round((px / iw) * (n - 1));
      show(Math.max(0, Math.min(n - 1, i)));
    };
    el.onpointerleave = () => { if (document.activeElement !== el) show(-1); };
    el.onblur = () => show(-1);
    el.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      let i = el.dataset.i ? +el.dataset.i : cur.filter((v) => v != null).length - 1;
      const last = cur.filter((v) => v != null).length - 1;
      i = e.key === "Home" ? 0 : e.key === "End" ? last : Math.max(0, Math.min(last, i + (e.key === "ArrowRight" ? 1 : -1)));
      show(i);
      $("#announce").textContent = [...tip.children].map((c) => c.innerText.replace(/\s+/g, " ")).join(", ");
    };
  }

  function chartTable() {
    const { m, cur, prev, buckets, prevBuckets, gran } = seriesFor(state.metric);
    const fmt = (v) => (m.id === "bounceRate" ? fmtPct(v) : m.id === "duration" ? fmtDur(v) : m.id === "revenue" ? money(v) : fmtInt(v));
    return `<div class="chart-table"><table class="table"><caption class="visually-hidden">${m.label} by ${gran}</caption><thead><tr><th scope="col">${gran === "hour" ? "Hour" : gran === "week" ? "Week" : "Day"}</th><th scope="col" class="r">${m.label}</th>${prev ? `<th scope="col" class="r">${compareLabel()}</th>` : ""}</tr></thead><tbody>${buckets.map((b, i) => (cur[i] == null ? "" : `<tr><td>${bucketLabel(b, gran)}</td><td class="r">${fmt(cur[i])}</td>${prev ? `<td class="r">${fmt(prev[i])}</td>` : ""}</tr>`)).join("")}</tbody></table></div>`;
  }

  /* ---------- breakdown lists ---------- */
  function listPanel(id, tabs, opts = {}) {
    const r = report();
    const dim = state.panelTabs[id] || tabs[0][0];
    const rows = r.main.breakdowns[dim];
    const valueKey = dim === "page" ? "pageviews" : "visitors";
    const max = Math.max(...rows.map((x) => x[valueKey]), 1);
    const filtered = state.filters.some((f) => f.dim === dim);
    const shown = rows.slice(0, opts.limit || 7);
    return `<section class="panel" aria-labelledby="h-${id}">
      <div class="panel-head"><h2 id="h-${id}">${opts.title}</h2>${tabs.length > 1 ? `<div class="seg" role="tablist" aria-label="${opts.title} view">${tabs.map(([d, l]) => `<button type="button" role="tab" aria-selected="${d === dim}" data-act="panel-tab" data-panel="${id}" data-dim="${d}">${l}</button>`).join("")}</div>` : ""}</div>
      <div class="panel-body">
        <table class="list"><colgroup><col><col class="c-num"><col class="c-small"></colgroup>
          <thead><tr><th scope="col">${D.DIMENSIONS[dim]}</th><th scope="col" class="r">${dim === "page" ? "Views" : "Visitor-days"}</th><th scope="col" class="r">${dim === "page" ? "Share" : API ? "Conv. rate" : "Completions"}</th></tr></thead>
          <tbody>${shown.map((row) => {
            const share = row[valueKey] / max;
            const right = dim === "page" ? fmtPct(row.pageviews / (r.main.totals.pageviews || 1), 0) : API ? (row.conversionVisitorDays ? fmtPct(row.conversionRate, 1) : "0 eligible") : fmtCompact(row.conversions || 0);
            return `<tr><td class="cell-name"><button type="button" class="rowbtn" ${filtered ? "disabled" : ""} data-act="add-filter" data-dim="${dim}" data-value="${esc(row.name)}" title="${filtered ? "" : `Filter by ${esc(row.name)}`}"><span class="fill" style="width:${(share * 100).toFixed(1)}%"></span><span class="label">${esc(row.name)}</span>${row.note && dim !== "source" ? `<span class="note">${esc(row.note)}</span>` : ""}</button></td><td class="r">${fmtCompact(row[valueKey])}</td><td class="r">${right}</td></tr>`;
          }).join("")}</tbody>
        </table>
      </div>
      <div class="panel-foot"><span>${filtered ? "Filtered" : ""}</span><a class="btn btn-ghost btn-sm" href="${hashFor({ route: "audience", audienceDim: dim })}">Open full table</a></div>
    </section>`;
  }

  function goalsPanel() {
    const r = report();
    const t = r.main.totals;
    const prev = r.prev && r.prev.totals;
    const rate = (g, n) => {
      const x = t.goalRates?.[g.id];
      if (!x) return fmtPct(n / (t.visitors || 1), 1);
      return x.visitorDays ? `${fmtPct(x.rate, 1)} <span class="muted">${fmtInt(x.convertedVisitorDays)}/${fmtInt(x.visitorDays)}</span>` : '<span class="muted">0 eligible</span>';
    };
    return `<section class="panel" aria-labelledby="h-goals"><div class="panel-head"><h2 id="h-goals">Goals</h2><a class="btn btn-ghost btn-sm" href="${hashFor({ route: "conversions" })}">Funnels and revenue</a></div>
      <div class="panel-body">${r.goals.length ? `<table class="list goal-list"><colgroup><col><col class="c-num"><col class="c-rate"></colgroup><thead><tr><th scope="col">Goal</th><th scope="col" class="r">Completions</th><th scope="col" class="r">Daily-unique rate</th></tr></thead><tbody>
      ${r.goals.map((g) => { const n = t.goals[g.id] || 0; const d = prev ? delta(n, prev.goals[g.id]) : null; return `<tr><td><span class="label">${esc(g.name)}${g.archived ? " (archived)" : ""}</span>${g.revenue ? ' <span class="tag revenue">Revenue</span>' : ""}</td><td class="r">${fmtCompact(n)}${d ? ` <span class="${d.cls}" style="font-size:12px">${d.text}</span>` : ""}</td><td class="r">${rate(g, n)}</td></tr>`; }).join("")}
      </tbody></table><p class="help">Completions include repeats. Rate: visitor-days completing ÷ visitor-days, same window and filters.</p>` : '<p class="muted">No goals are set up for this website.</p>'}</div></section>`;
  }

  /* ---------- screens ---------- */
  function viewOverview() {
    const gate = reportGate("overview");
    const head = toolbar("Overview");
    if (gate) return head + gate;
    const r = report();
    const t = r.main.totals;
    const p = r.prev && r.prev.totals;
    const showRevenue = t.revenue > 0 || (p && p.revenue > 0) || state.metric === "revenue";
    const core = METRICS.filter((m) => ["visitors", "pageviews", "conversions"].includes(m.id) || (m.id === "revenue" && showRevenue));
    const more = METRICS.filter((m) => m.id === "bounceRate" || m.id === "duration" || (m.id === "revenue" && !showRevenue));
    const moreOpen = state.reveal.more || more.some((m) => m.id === state.metric);
    const figure = (m) => {
      const d = p && m.raw(t) != null && m.raw(p) != null ? delta(m.raw(t), m.raw(p), m.lowerIsBetter) : null;
      const change = d ? `<span class="${d.cls}">${d.text}</span><span class="visually-hidden"> vs ${compareLabel()}</span>` : "";
      const coverage = m.id === "duration" && t.visits != null ? `${change ? " · " : ""}${fmtInt(t.measuredVisits)} of ${fmtInt(t.visits)} visits measured` : "";
      return `<button type="button" aria-pressed="${state.metric === m.id}" data-act="metric" data-id="${m.id}"><span class="k">${m.label}</span><span class="v">${m.f(t)}</span><span class="d">${change || coverage ? change + coverage : "&nbsp;"}</span></button>`;
    };
    const m = METRICS.find((x) => x.id === state.metric);
    const reveal = (id, label, extra = "") => `<button type="button" class="reveal" data-act="reveal" data-id="${id}" aria-expanded="${state.reveal[id]}" aria-controls="reveal-${id}"><span>${label}</span>${extra}${ICON.chevron}</button>`;
    return head + `<section class="panel" aria-label="Key figures and trend">
      <div class="ledger ledger-core" style="--cols:${core.length}" role="group" aria-label="Choose the figure the chart shows">${core.map(figure).join("")}</div>
      <div class="ledger-bar"><button type="button" class="btn btn-ghost btn-sm" data-act="reveal" data-id="more" aria-expanded="${moreOpen}" aria-controls="reveal-more">More metrics${ICON.chevron}</button></div>
      <div class="ledger ledger-more" id="reveal-more" role="group" aria-label="More figures for the chart" ${moreOpen ? "" : "hidden"}>${more.map(figure).join("")}</div>
      <div class="chart-wrap">
        <div class="chart-meta"><span class="key"><span class="swatch"></span>${m.label}, ${rangeLabel(periods().bounds)}</span>${r.prev ? `<span class="key"><span class="swatch cmp"></span>${compareLabel().replace(/^./, (c) => c.toUpperCase())}</span>` : ""}<span class="end"><button type="button" class="btn btn-ghost btn-sm" data-act="chart-table" aria-pressed="${state.chartAsTable}">${state.chartAsTable ? "Show chart" : "Show as table"}</button></span></div>
        ${state.chartAsTable ? chartTable() : `<div class="chart" id="chart" tabindex="0" role="img"></div>`}
      </div>
    </section>
    <div class="grid-2" style="margin-top:16px">
      ${listPanel("sources", [["source", "Sources"], ["referrer", "Referrers"], ["campaign", "Campaigns"]], { title: "Acquisition" })}
      ${listPanel("pages", [["page", "Top pages"], ["entry", "Entry pages"]], { title: "Pages" })}
    </div>
    <div class="reveals">
      ${reveal("goals", "Goals", r.goals.length ? `<span class="muted">${r.goals.length}</span>` : "")}
      <div id="reveal-goals" ${state.reveal.goals ? "" : "hidden"}>${state.reveal.goals ? goalsPanel() : ""}</div>
      ${reveal("breakdowns", "Locations and technology")}
      <div class="grid-2" id="reveal-breakdowns" ${state.reveal.breakdowns ? "" : "hidden"}>${state.reveal.breakdowns ? listPanel("countries", [["country", "Countries"]], { title: "Locations" }) + listPanel("devices", [["device", "Devices"], ["browser", "Browsers"]], { title: "Technology" }) : ""}</div>
    </div>`;
  }

  function viewAudience() {
    const gate = reportGate("table");
    const head = toolbar("Audience");
    const dims = [["source", "Sources"], ["referrer", "Referrers"], ["campaign", "Campaigns"], ["country", "Countries"], ["device", "Devices"], ["browser", "Browsers"], ["page", "Pages"], ["entry", "Entry pages"]];
    const tabs = `<div class="seg seg-block" role="tablist" aria-label="Breakdown">${dims.map(([d, l]) => `<button type="button" role="tab" aria-selected="${d === state.audienceDim}" data-act="aud-dim" data-dim="${d}">${l}</button>`).join("")}</div>`;
    if (gate) return head + tabs + gate;
    const r = report();
    const dim = state.audienceDim;
    const isPage = dim === "page";
    let rows = r.main.breakdowns[dim];
    const prevRows = r.prev ? r.prev.breakdowns[dim] : [];
    const prevBy = new Map(prevRows.map((x) => [x.name, x]));
    const total = isPage ? r.main.totals.pageviews : r.main.totals.visitors;
    const cols = isPage
      ? [["name", D.DIMENSIONS[dim]], ["pageviews", "Pageviews"], ["visitors", "Visitors"], ["share", "Share"]]
      : [["name", D.DIMENSIONS[dim]], ["visitors", "Visitors"], ["share", "Share"], ["change", "Change"], ["conversions", "Conversions"], ["cr", "Conv. rate"], ["revenue", "Revenue"]];
    const val = (row, k) => k === "share" ? (row[isPage ? "pageviews" : "visitors"] / (total || 1)) : k === "cr" ? (row.conversions || 0) / (row.visitors || 1) : k === "change" ? (prevBy.get(row.name) ? row.visitors / prevBy.get(row.name).visitors - 1 : 0) : row[k];
    const sk = cols.some((c) => c[0] === state.sort.key) ? state.sort.key : cols[1][0];
    rows = rows.slice().sort((a, b) => (sk === "name" ? a.name.localeCompare(b.name) : val(a, sk) - val(b, sk)) * (state.sort.dir < 0 ? -1 : 1));
    const filtered = state.filters.some((f) => f.dim === dim);
    const shareBar = !isPage && !["referrer", "campaign"].includes(dim) ? (() => {
      const top = rows.slice().sort((a, b) => b.visitors - a.visitors);

      const parts = top.slice(0, 5);
      const rest = top.slice(5).reduce((a, x) => a + x.visitors, 0);
      const segs = parts.map((x, i) => ({ name: x.name, v: x.visitors, c: `var(--color-share-${i + 1})` }));
      if (rest > 0) segs.push({ name: "Everything else", v: rest, c: "var(--color-compare)" });
      return `<div class="panel panel-body" style="margin-bottom:16px"><h2 class="visually-hidden">Share of visitors</h2><div class="share" role="img" aria-label="Share of visitors: ${segs.map((s) => `${s.name} ${fmtPct(s.v / total, 0)}`).join(", ")}">${segs.map((s) => `<span style="flex:${s.v};background:${s.c}"></span>`).join("")}</div><div class="share-key">${segs.map((s) => `<span><i style="background:${s.c}"></i>${esc(s.name)} <span class="muted num">${fmtPct(s.v / total, 0)}</span></span>`).join("")}</div></div>`;
    })() : "";
    const cell = (row, k) => {
      if (k === "share") return fmtPct(val(row, k), 1);
      if (k === "cr") return fmtPct(val(row, k), 2);
      if (k === "revenue") return money(row.revenue || 0);
      if (k === "change") { const pv = prevBy.get(row.name); if (!r.prev || !pv) return "<span class='muted'>none</span>"; const d = delta(row.visitors, pv.visitors); return `<span class="${d.cls}">${d.text}</span>`; }
      return fmtInt(row[k] || 0);
    };
    return head + tabs + shareBar + `<section class="panel"><div class="panel-body" style="overflow-x:auto">
      <table class="table restack"><caption class="visually-hidden">${D.DIMENSIONS[dim]} breakdown, sortable</caption><thead><tr>${cols.map(([k, l], i) => `<th scope="col" class="${i ? "r" : ""}" ${sk === k ? `aria-sort="${state.sort.dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button" class="sort" data-act="sort" data-key="${k}" ${sk === k ? 'aria-sort="1"' : ""}>${l}${sk === k ? (state.sort.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}<th scope="col" class="r"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td><b style="font-weight:550">${esc(row.name)}</b>${row.note ? ` <span class="muted" style="font-size:12px">${esc(row.note)}</span>` : ""}</td>${cols.slice(1).map(([k, l]) => `<td class="r" data-label="${l}">${cell(row, k)}</td>`).join("")}<td class="r act">${filtered ? `<button type="button" class="btn btn-sm" data-act="rm-filter-dim" data-dim="${dim}">Remove filter</button>` : `<button type="button" class="btn btn-sm" data-act="add-filter" data-dim="${dim}" data-value="${esc(row.name)}" aria-label="Filter every report by ${esc(row.name)}">Filter</button>`}</td></tr>`).join("")}</tbody></table>
      </div><div class="panel-foot"><span>${rows.length} rows. Totals match the overview for the same range and filters.</span></div></section>`;
  }

  function viewConversions() {
    const gate = reportGate("table");
    const head = toolbar("Conversions");
    if (gate) return head + gate;
    const r = report();
    const t = r.main.totals;
    const s = site();
    const purchaseGoal = r.goals.find((g) => g.revenue) || { id: "", name: "Payments" };
    const fun = r.main.funnel;
    const top = fun.steps[0].count || 1;
    const funnelHtml = fun.steps.map((st, i) => {
      const pct = st.count / top;
      const prevStep = i ? fun.steps[i - 1].count : st.count;
      const conv = i ? st.count / (prevStep || 1) : 1;
      return `<div class="funnel-step"><span>${i + 1}. ${esc(st.name)}</span><div class="bar-track" role="img" aria-label="${esc(st.name)}: ${fmtInt(st.count)} visitors, ${fmtPct(pct)} of the first step"><span class="bar-fill" style="transform:scaleX(${pct.toFixed(4)})"></span><span class="bar-label ${pct > 0.22 ? "on-fill" : ""}" ${pct <= 0.22 ? `style="left:calc(${(pct * 100).toFixed(1)}% + 10px)"` : ""}>${fmtInt(st.count)}</span></div><span class="drop">${i ? `${fmtPct(conv, 0)} continued<br>${fmtInt(prevStep - st.count)} left` : "Start"}</span></div>`;
    }).join("");
    const bySource = r.main.breakdowns.source.filter((x) => x.visitors > 0);
    const revTotal = t.revenue || 1;
    const purchases = t.goals[purchaseGoal.id] || 0;
    const journeys = r.main.journeys;
    return head + `<div class="ledger ledger-4 panel" style="margin-bottom:16px" role="group" aria-label="Conversion figures">
        <div class="fig"><span class="k">Conversions</span><span class="v">${fmtCompact(t.conversions)}</span></div>
        <div class="fig"><span class="k">${esc(purchaseGoal.name)}</span><span class="v">${fmtCompact(purchases)}</span></div>
        <div class="fig"><span class="k">Revenue</span><span class="v">${money(t.revenue)}</span></div>
        <div class="fig"><span class="k">Revenue per visitor</span><span class="v">${s.currency}${(t.revenue / (t.visitors || 1)).toFixed(2)}</span></div>
      </div>
      <div class="grid-2">
        <section class="panel span-2" aria-labelledby="h-funnel"><div class="panel-head"><h2 id="h-funnel">${esc(fun.name)} funnel</h2><span class="muted" style="font-size:14px">${fmtPct(fun.steps[fun.steps.length - 1].count / top, 2)} of starters finish</span></div><div class="panel-body"><div class="funnel">${funnelHtml}</div></div></section>
        <section class="panel" aria-labelledby="h-attr"><div class="panel-head"><h2 id="h-attr">Revenue by channel</h2><span class="muted" style="font-size:14px">Last-touch attribution</span></div><div class="panel-body" style="overflow-x:auto">
          <table class="table restack"><thead><tr><th scope="col">Channel</th><th scope="col" class="r">Payments</th><th scope="col" class="r">Revenue</th><th scope="col" class="r">Per visitor</th></tr></thead><tbody>
          ${bySource.sort((a, b) => b.revenue - a.revenue).map((x) => `<tr><td><button type="button" class="rowbtn" style="padding:0" data-act="add-filter" data-dim="source" data-value="${esc(x.name)}"><span class="label">${esc(x.name)}</span><span class="note">${fmtPct(x.revenue / revTotal, 0)}</span></button></td><td class="r" data-label="Payments">${fmtInt(x.purchases)}</td><td class="r" data-label="Revenue">${money(x.revenue)}</td><td class="r" data-label="Per visitor">${s.currency}${(x.revenue / (x.visitors || 1)).toFixed(2)}</td></tr>`).join("")}
          </tbody></table></div><div class="panel-foot"><span>Payments are matched to the visit that preceded them. Sample payment events, no provider connected.</span></div></section>
        <section class="panel" aria-labelledby="h-journeys"><div class="panel-head"><h2 id="h-journeys">Paths to ${esc(purchaseGoal.name.toLowerCase())}</h2></div><div class="panel-body"><table class="list"><colgroup><col><col class="c-num"></colgroup><thead><tr><th scope="col">Journey</th><th scope="col" class="r">Converted</th></tr></thead><tbody>
          ${journeys.map((j) => `<tr><td style="padding:8px 0"><span class="path">${j.path.map((p, i) => (i ? ICON.next : "") + `<code>${esc(p)}</code>`).join("")}</span></td><td class="r">${fmtInt(j.conversions)}</td></tr>`).join("")}
          </tbody></table></div></section>
        <div class="span-2">${goalsPanel()}</div>
        ${API ? '<div class="span-2" id="goal-management"></div>' : ""}
      </div>`;
  }

  /* ---------- live ---------- */
  let liveTimer = null;
  let liveBusy = false;
  async function pollLive() {
    const id = site().id;
    if (liveBusy || site().empty) return;
    liveBusy = true;
    try {
      const data = await ds.live(id);
      if (id === site().id) {
        const prev = state.live.siteId === id && state.live.data;
        const seen = new Set(prev ? prev.events.map((e) => e.id) : []);
        state.live.fresh = new Set(prev ? data.events.filter((e) => !seen.has(e.id)).map((e) => e.id) : []);
        if (!prev) Object.assign(state.live, { selected: null, session: null });
        Object.assign(state.live, { siteId: id, data, error: null });
      }
    } catch (e) {
      if (id === site().id) {
        if (!state.live.error) $("#announce").textContent = "Live updates did not load. Trying again shortly.";
        state.live.error = e;
      }
    } finally {
      liveBusy = false;
    }
    if (state.route === "live") renderLiveParts();
    if (API) updateNavCount();
  }
  function startLive() {
    stopLive();
    if (API || !state.live.data || state.live.siteId !== site().id) pollLive();
    liveTimer = setInterval(() => { if (!state.live.paused && state.route === "live") pollLive(); }, ds.livePeriod);
  }
  function stopLive() { if (liveTimer) clearInterval(liveTimer); liveTimer = null; }
  function updateNavCount() {
    const n = site().empty ? null : ds.liveNow(site());
    const c = $(".nav .count");
    if (c && n != null) { c.textContent = n; c.setAttribute("aria-label", `${n} visitors now`); } else if (!c && n != null) renderTopbar();
  }

  const goalName = (id) => { const g = (site().goals || []).find((x) => x.id === id); return g ? g.name : id; };
  function feedItem(ev) {
    const what = ev.kind === "pageview" ? `Viewed <code>${esc(ev.page)}</code>` : ev.kind === "revenue" ? `<span class="tag revenue">${esc(goalName(ev.goal))}</span> ${site().currency}${ev.revenue}` : `<span class="tag goal">${esc(goalName(ev.goal))}</span>`;
    return `<li class="${state.live.fresh.has(ev.id) ? "fresh" : ""}"><button type="button" data-act="session" data-id="${esc(ev.sessionId)}" data-at="${ev.at}" aria-pressed="${!!state.live.selected && state.live.selected.id === ev.sessionId}"><span class="when">${fmtClock(ev.at)}</span><span class="what">${what}</span><span class="where">${esc(ev.country)}, ${esc(ev.device.toLowerCase())}, from ${esc(ev.source)}</span></button></li>`;
  }

  function liveSub() {
    if (state.live.error) return `${site().name}. Live updates did not load; trying again every ${ds.livePeriod / 1000} seconds.`;
    return `${site().name}, ${API ? "updating every 5 seconds" : "updating every few seconds with sample events"}`;
  }

  function renderLiveParts() {
    const s = site();
    const feedEl = $("#feed");
    if (!feedEl) return;
    const data = state.live.siteId === s.id ? state.live.data : null;
    const events = data ? data.events : [];
    const list = events.filter((e) => state.live.kind === "all" || e.kind !== "pageview");
    const note = (text) => `<li><div class="empty"><p>${text}</p></div></li>`;
    feedEl.innerHTML = !data ? note(state.live.error ? esc(errText(state.live.error)) : "Loading recent events…") : list.length ? list.map(feedItem).join("") : note(state.live.kind === "all" ? "No visits in the last few minutes. They appear here the moment they happen." : "No conversions in the last few minutes. They appear here the moment they happen.");
    state.live.fresh = new Set();
    $("#live-now").textContent = fmtInt(data ? data.visitorsNow : 0);
    $("#live-sub").textContent = liveSub();
    const history = data ? data.perMinute : [];
    const peak = Math.max(1, ...history);
    $("#minibars").innerHTML = history.map((v) => `<span style="height:${(v / peak) * 100}%"></span>`).join("");
    const conv = events.filter((e) => e.kind !== "pageview").slice(0, 5);
    $("#recent-conv").innerHTML = conv.length ? conv.map((e) => `<tr><td>${e.kind === "revenue" ? `<span class="tag revenue">${esc(goalName(e.goal))}</span>` : `<span class="tag goal">${esc(goalName(e.goal))}</span>`}</td><td class="muted">${esc(e.source)}</td><td class="r">${e.revenue ? s.currency + e.revenue : ""}</td><td class="r muted">${fmtClock(e.at).slice(0, 5)}</td></tr>`).join("") : `<tr><td colspan="4" class="muted">None yet in this session</td></tr>`;
  }

  function sessionPanel() {
    const sel = state.live.selected;
    if (!sel) return `<div class="empty"><h3>Pick an event to follow its visit</h3><p>The whole session appears here: where the visitor came from, each page in order and anything they completed.</p></div>`;
    const tl = state.live.session;
    if (!tl) return `<p class="muted">Loading this visit…</p>`;
    if (tl.error) return `<div class="notice err" role="alert">${ICON.warn}<span>${esc(errText(tl.error))} Select the event again to retry.</span></div>`;
    return `<div class="meta-row"><span class="tag">${esc(tl.source)}</span><span class="tag">${esc(tl.country)}</span><span class="tag">${esc(tl.device)}</span><span class="tag">${tl.events.length} ${tl.events.length === 1 ? "event" : "events"}</span></div>
      <ol class="timeline">${tl.events.map((e) => `<li><span class="t">${fmtClock(e.at).slice(0, 5)}</span><span class="node ${e.kind}"></span><span>${e.kind === "pageview" ? `Viewed <code>${esc(e.label)}</code>` : `<b>${esc(e.label)}</b>${e.revenue ? ` <span class="pos num">${site().currency}${e.revenue}</span>` : ""}`}</span></li>`).join("")}</ol>
      ${API ? "" : '<p class="muted" style="font-size:14px">Sample visit. PostDeploy is designed to count visits without cookies.</p>'}`;
  }

  function viewLive() {
    const s = site();
    const head = `<div class="page-head"><div class="title"><h1>Live</h1><span class="sub" id="live-sub">${esc(liveSub())}</span></div>
      <div class="toolbar"><div class="seg" role="group" aria-label="Show"><button type="button" aria-pressed="${state.live.kind === "all"}" data-act="live-kind" data-kind="all">All events</button><button type="button" aria-pressed="${state.live.kind === "conv"}" data-act="live-kind" data-kind="conv">Conversions</button></div>
      ${s.visits && !s.empty ? `<button type="button" class="btn" data-act="sample-visit">Send a sample pageview</button>` : ""}<button type="button" class="btn" data-act="live-pause" aria-pressed="${state.live.paused}">${state.live.paused ? "Resume" : "Pause"}</button></div></div>`;
    if (s.empty) return head + emptySiteState();
    return head + `<div class="grid-3">
      <section class="panel panel-body" aria-labelledby="h-now"><h2 id="h-now" class="muted" style="font-size:14px;font-weight:500">Visitors right now</h2><div class="live-figure"><span class="v" id="live-now">0</span><span class="pulse ${state.live.paused ? "paused" : ""}" aria-hidden="true"></span><span class="muted" style="font-size:14px">${state.live.paused ? "paused" : "live"}</span></div>
        <p class="muted" style="font-size:13px;margin:12px 0 6px">Pageviews per minute, last 30 minutes</p><div class="minibars" id="minibars" role="img" aria-label="Pageviews per minute for the last 30 minutes"></div></section>
      <section class="panel span-2" aria-labelledby="h-rc"><div class="panel-head"><h2 id="h-rc">Recent conversions</h2></div><div class="panel-body"><table class="table"><tbody id="recent-conv"></tbody></table></div></section>
      <section class="panel span-2" aria-labelledby="h-feed"><div class="panel-head"><h2 id="h-feed">Traffic as it happens</h2><span class="muted" style="font-size:14px">Select an event to see its visit</span></div><div class="panel-body"><ul class="feed" id="feed" aria-live="off"></ul></div></section>
      <section class="panel" aria-labelledby="h-sess"><div class="panel-head"><h2 id="h-sess">Session timeline</h2></div><div class="panel-body" id="session">${sessionPanel()}</div></section>
    </div>`;
  }

  /* ---------- manage ---------- */
  const MANAGE = [["websites", "Websites"], ["tracking", "Tracking code"], ["team", "Team"], ["keys", "API keys"], ["mcp", "Agent access (MCP)"], ["deploy", "Deployment"], ["settings", "Settings"]];

  function viewManage() {
    if (!isAdmin() && !["", "websites", "tracking", "settings"].includes(state.sub)) return `<div class="page-head"><h1>Manage</h1></div><section class="panel"><div class="panel-body"><p>Your Viewer account can read all websites. An administrator manages users and settings.</p></div></section>`;
    const sub = MANAGE.some((m) => m[0] === state.sub) ? state.sub : "websites";
    const body = { websites: mWebsites, tracking: mTracking, team: mTeam, keys: mKeys, mcp: mMcp, deploy: mDeploy, settings: mSettings }[sub]();
    return `<div class="page-head"><div class="title"><h1>Manage</h1><span class="sub">${API ? "Websites, tracking and settings are saved to this installation." : "PostDeploy is designed to run in your own Cloudflare account. In this demo every action is simulated."}</span></div></div>
      <div class="manage"><nav class="subnav" aria-label="Manage sections">${MANAGE.filter(([id]) => isAdmin() || ["websites", "tracking", "settings"].includes(id)).map(([id, l]) => `<a href="${hashFor({ route: "manage", sub: id })}" ${sub === id ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav><div class="stack">${body}</div></div>`;
  }

  function mWebsites() {
    return `<section class="panel"><div class="panel-head"><h2>Websites</h2><button type="button" class="btn btn-primary" data-act="start-onboard">${ICON.plus} Add a website</button></div><div class="panel-body" style="overflow-x:auto">
      <table class="table restack"><thead><tr><th scope="col">Website</th><th scope="col" class="r">Visitors, 30 days</th><th scope="col" class="r">Status</th><th scope="col" class="r"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
      ${state.sites.map((s) => { const v = ds.visitors30d(s); return `<tr><td><span style="display:inline-flex;gap:10px;align-items:center"><span class="site-mark">${esc(initials(s.name))}</span><span><b style="font-weight:550">${esc(s.name)}</b><br><span class="muted" style="font-size:13px">${esc(s.domain)}</span></span></span></td><td class="r" data-label="Visitors, 30 days">${fmtInt(v)}</td><td class="r" data-label="Status">${s.empty ? '<span class="tag warn">Waiting for data</span>' : '<span class="tag ok">Receiving data</span>'}</td><td class="r act"><span style="display:inline-flex;gap:6px"><button type="button" class="btn btn-sm" data-act="site" data-id="${s.id}">Open</button><button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="rm-site" data-id="${s.id}" ${state.sites.length < 2 ? "disabled" : ""} aria-label="Remove ${esc(s.name)}">Remove</button></span></td></tr>`; }).join("")}
      </tbody></table></div></section>`;
  }

  function snippet(s) {
    const origin = API ? location.origin : "https://analytics.your-domain.example";
    const tag = `<script defer\n  src="${origin}/script.js"\n  data-site="${esc(s.id)}"></script>`;
    const goal = (s.goals || []).find((g) => g.revenue) || (s.goals || [])[0];
    if (API && state.tracking.platform === "spa") return `${tag}${goal ? `\n\n<!-- Pageviews on client-side navigation are sent automatically. Record a goal: -->\n<script>\n  window.postdeploy.track("${goal.id}"${goal.revenue ? ", { revenue: 49 }" : ""});\n</script>` : ""}`;
    if (state.tracking.platform === "spa") return `import { track } from "./postdeploy.js";\n\n// call after each client-side route change\nrouter.afterEach(() => track("pageview"));\n\n// record a goal\ntrack("${(site().kind === "store" ? "purchase" : "trial")}", { revenue: 49 });`;
    if (state.tracking.platform === "proxy") return `# Serve the tracker from your own domain\n/stats/script.js  ->  ${origin}/script.js\n/stats/event      ->  ${origin}/${API ? "api/event" : "event"}`;
    return tag;
  }

  function mTracking() {
    const s = site();
    const v = state.tracking.verify;
    const status = v === "checking" ? `<div class="notice" role="status"><span class="spinner" aria-hidden="true"></span>Looking for the snippet on ${esc(s.domain)}…</div>`
      : v === "ok" ? `<div class="notice ok" role="status">${ICON.ok}<span>Found it. ${esc(s.domain)} ${API ? `has sent ${fmtInt(state.tracking.result.events)} ${state.tracking.result.events === 1 ? "event" : "events"}, the latest at ${fmtClock(state.tracking.result.lastEventAt)}.` : "sent a sample pageview a moment ago."}</span></div>`
      : v === "fail" ? `<div class="notice err" role="alert">${ICON.warn}<span>No ${API ? "events from" : "snippet found on"} ${esc(s.domain)} yet. Publish the page with the snippet in its head, then check again.</span></div>`
      : v === "error" ? `<div class="notice err" role="alert">${ICON.warn}<span>${esc(errText(state.tracking.result))} Check again in a moment.</span></div>` : "";
    return `<section class="panel"><div class="panel-head"><h2>Tracking code for ${esc(s.domain)}</h2></div><div class="panel-body stack">
      <p class="muted" style="font-size:14px">Designed to load without cookies and without storing anything on the visitor's device. Choose how your site is built.</p>
      <div class="seg" role="tablist" aria-label="Installation method">${[["html", "Any website"], ["spa", "Single-page app"], ["proxy", "Own-domain proxy"]].map(([id, l]) => `<button type="button" role="tab" aria-selected="${state.tracking.platform === id}" data-act="platform" data-id="${id}">${l}</button>`).join("")}</div>
      <div class="code-wrap"><pre class="code" id="snippet">${esc(snippet(s))}</pre><button type="button" class="btn btn-sm" data-act="copy" data-target="snippet">Copy</button></div>
      <div class="toolbar"><button type="button" class="btn btn-primary" data-act="verify" ${v === "checking" ? 'aria-busy="true" disabled' : ""}>${v === "checking" ? '<span class="spinner" aria-hidden="true"></span> Checking' : "Check installation"}</button>${v === "ok" || v === "fail" || v === "error" ? `<button type="button" class="btn btn-ghost" data-act="verify-reset">Reset check</button>` : ""}</div>
      ${status}
    </div></section>`;
  }

  const OWNER_NOTE = `<div class="notice">${ICON.info}<span>Planned for a later release. These controls are not available yet.</span></div>`;
  function locked(title, inner) {
    return `<section class="panel"><div class="panel-head"><h2>${title}</h2></div><div class="panel-body stack">${OWNER_NOTE}<fieldset class="locked stack" disabled>${inner}</fieldset></div></section>`;
  }

  function mTeam() {
    const form = `<form class="form-row" data-submit="invite" novalidate>
        <div class="field"><label for="inv-email">Email address</label><input class="input input-lg" id="inv-email" name="email" type="email" autocomplete="off" placeholder="name@company.example" aria-describedby="inv-help"><span class="help" id="inv-help">They get read access until you change their role.</span></div>
        <div class="field" style="flex:0 0 160px"><label for="inv-role">Role</label><select class="select input-lg" id="inv-role" name="role"><option>Viewer</option><option>Admin</option></select><span class="help"></span></div>
        <div class="field" style="flex:0 0 auto"><span class="label" aria-hidden="true">&nbsp;</span><button type="submit" class="btn btn-primary" style="min-height:40px">Send invite</button><span class="help"></span></div>
      </form>`;
    if (API) return '<section class="panel"><div class="panel-head"><h2>Team</h2></div><div class="panel-body stack" id="auth-team"></div></section>';
    return `<section class="panel"><div class="panel-head"><h2>Team</h2></div><div class="panel-body stack">
      ${form}
      <div style="overflow-x:auto"><table class="table restack"><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col" class="r"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
      ${state.team.map((m) => `<tr><td><span style="display:inline-flex;gap:10px;align-items:center"><span class="avatar">${esc(initials(m.name))}</span><span>${esc(m.name)}<br><span class="muted" style="font-size:13px">${esc(m.email)}</span></span></span></td>
        <td data-label="Role">${m.role === "Owner" ? "Owner" : `<label class="visually-hidden" for="role-${m.id}">Role for ${esc(m.name)}</label><select class="select" id="role-${m.id}" data-change="role" data-id="${m.id}"><option ${m.role === "Viewer" ? "selected" : ""}>Viewer</option><option ${m.role === "Admin" ? "selected" : ""}>Admin</option></select>`}</td>
        <td data-label="Status">${m.status === "Invited" ? '<span class="tag goal">Invite sent</span>' : '<span class="tag ok">Active</span>'}</td>
        <td class="r act">${m.role === "Owner" ? "" : `<button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="rm-member" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">Remove</button>`}</td></tr>`).join("")}
      </tbody></table></div><p class="muted" style="font-size:13px">Sample people. No email is sent from this demo.</p></div></section>`;
  }

  function mKeys() {
    const nk = state.newKey;
    const intro = `<p class="muted" style="font-size:14px">Keys read your reports from scripts and dashboards. Each key is shown once.</p>`;
    const form = `<form class="form-row" data-submit="key" novalidate>
        <div class="field"><label for="key-name">Key name</label><input class="input input-lg" id="key-name" name="name" autocomplete="off" placeholder="Monthly board report"><span class="help" id="key-help"></span></div>
        <div class="field" style="flex:0 0 160px"><label for="key-scope">Access</label><select class="select input-lg" id="key-scope" name="scope"><option>Read</option><option>Read and write</option></select><span class="help"></span></div>
        <div class="field" style="flex:0 0 auto"><span class="label" aria-hidden="true">&nbsp;</span><button type="submit" class="btn btn-primary" style="min-height:40px">Create key</button><span class="help"></span></div>
      </form>`;
    if (API) return locked("API keys", intro + form);
    return `<section class="panel"><div class="panel-head"><h2>API keys</h2></div><div class="panel-body stack">
      ${intro}
      ${nk ? `<div class="secret" role="status"><span style="flex-basis:100%;font-size:14px"><b>${esc(nk.name)}</b> is ready. Copy it now; it will not be shown again.</span><code id="newkey">${esc(nk.token)}</code><button type="button" class="btn btn-sm" data-act="copy" data-target="newkey">Copy</button><button type="button" class="btn btn-sm btn-ghost" data-act="dismiss-key">Done</button></div>` : ""}
      ${form}
      ${state.keys.length ? `<div style="overflow-x:auto"><table class="table restack"><thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Access</th><th scope="col" class="r">Last used</th><th scope="col" class="r"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
      ${state.keys.map((k) => `<tr><td>${esc(k.name)}</td><td data-label="Key"><code>${esc(k.prefix)}…</code></td><td data-label="Access">${esc(k.scope)}</td><td class="r" data-label="Last used">${k.lastUsed ? fmtDay(k.lastUsed) : "Never"}</td><td class="r act"><button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="revoke" data-id="${k.id}" aria-label="Revoke ${esc(k.name)}">Revoke</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><h3>No API keys</h3><p>Create one to pull reports into another tool.</p></div>`}
    </div></section>`;
  }

  function mMcp() {
    const m = state.mcp;
    const tools = [["reports", "Read reports", "Totals, breakdowns and trends for any range"], ["events", "Query events", "Recent pageviews and goals"], ["goals", "Manage goals", "Create and edit goals and funnels"], ["manage", "Manage websites", "Add websites and change settings"]];
    const config = `{\n  "mcpServers": {\n    "postdeploy": {\n      "url": "https://analytics.your-domain.example/mcp",\n      "headers": { "Authorization": "Bearer <your API key>" }\n    }\n  }\n}`;
    const intro = `<p class="muted" style="font-size:14px">Let an AI assistant answer questions about your traffic, such as which campaign brought this week's sales. It sees only what the tools below allow.</p>`;
    const toolRows = (on) => `<div>${tools.map(([id, l, d]) => `<div class="settings-row"><div class="text"><b style="font-weight:550">${l}</b><span>${d}</span></div><button type="button" class="switch" role="switch" aria-checked="${on(id)}" aria-label="${l}" data-act="mcp-tool" data-id="${id}"></button></div>`).join("")}</div>`;
    if (API) return locked("Agent access over MCP", intro + toolRows(() => false));
    return `<section class="panel"><div class="panel-head"><h2>Agent access over MCP</h2><button type="button" class="switch" role="switch" aria-checked="${m.enabled}" aria-label="Allow MCP connections" data-act="mcp-toggle"></button></div><div class="panel-body stack">
      ${intro}
      ${m.enabled ? `${toolRows((id) => m.tools[id])}
      <h3>Connect a client</h3><div class="code-wrap"><pre class="code" id="mcpcfg">${esc(config)}</pre><button type="button" class="btn btn-sm" data-act="copy" data-target="mcpcfg">Copy</button></div>
      <div class="toolbar"><button type="button" class="btn" data-act="mcp-connect">Simulate a client connecting</button></div>
      <h3>Connected clients</h3>${m.clients.length ? `<table class="table restack"><tbody>${m.clients.map((c) => `<tr><td><b style="font-weight:550">${esc(c.name)}</b><br><span class="muted" style="font-size:13px">Connected ${fmtDay(c.connected)}, can ${esc(c.tools.join(" and ").toLowerCase())}</span></td><td class="r act"><button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="mcp-disconnect" data-id="${c.id}">Disconnect</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted">No clients connected.</p>`}`
      : `<div class="notice">${ICON.info}<span>MCP is off. Assistants cannot read anything until you turn it back on; existing connections are paused.</span></div>`}
    </div></section>`;
  }

  const DEPLOY_STEPS = ["Check the Cloudflare account", "Create the database", "Upload the collector worker", "Apply database migrations", "Route analytics.your-domain.example", "Run a test event"];

  function deploySteps(d) {
    if (!d.steps) return "";
    return `<ol class="steps" aria-live="polite">${DEPLOY_STEPS.map((l, i) => { const st = d.steps[i] || "pending"; return `<li class="${st}"><span class="state">${st === "done" ? ICON.check : st === "failed" ? ICON.x : ""}</span><span>${l}${st === "failed" ? ' <span class="neg">failed</span>' : ""}</span><span class="time">${st === "done" ? "done" : st === "active" ? "running" : ""}</span></li>`; }).join("")}</ol>`;
  }

  const nextVersion = (v) => { const p = v.split(".").map(Number); return `${p[0]}.${p[1] + 1}.0`; };

  function mDeploy() {
    if (API) {
      const h = state.health;
      const row = (k, v) => `<div><dt class="muted" style="font-size:13px">${k}</dt><dd style="margin:0">${v}</dd></div>`;
      return `<section class="panel"><div class="panel-head"><h2>Deployment</h2>${h.ok ? '<span class="tag ok">Live</span>' : '<span class="tag warn">Not answering</span>'}</div><div class="panel-body stack">
        <dl class="form-grid" style="margin:0">${row("Running version", `<span class="num">${esc(h.version || "unknown")}</span>`)}${row("Mode", h.mode === "production" ? "Production" : "Development")}${row("Database", h.database ? "Connected" : "Not reachable")}${row("Collector address", `<code>${esc(location.host)}</code>`)}</dl>
        <p class="muted" style="font-size:14px">Updates deploy from the repository, not from this page.</p>
      </div></section>`;
    }
    const d = state.deploy;
    const busy = d.status === "running";
    return `<section class="panel"><div class="panel-head"><h2>Deployment</h2>${d.status === "live" || d.status === "done" ? '<span class="tag ok">Live</span>' : d.status === "failed" ? '<span class="tag warn">Update failed</span>' : busy ? '<span class="tag goal">Updating</span>' : ""}</div><div class="panel-body stack">
      <dl class="form-grid" style="margin:0">
        <div><dt class="muted" style="font-size:13px">Cloudflare account</dt><dd style="margin:0">${esc(d.account)} <span class="muted">(simulated)</span></dd></div>
        <div><dt class="muted" style="font-size:13px">Running version</dt><dd style="margin:0" class="num">${esc(d.version)}</dd></div>
        <div><dt class="muted" style="font-size:13px">Collector address</dt><dd style="margin:0"><code>analytics.your-domain.example</code></dd></div>
        <div><dt class="muted" style="font-size:13px">Placement</dt><dd style="margin:0">${esc(d.region)}</dd></div>
      </dl>
      ${deploySteps(d)}
      ${d.status === "failed" ? `<div class="notice err" role="alert">${ICON.warn}<span>The migration step timed out, so nothing was switched over. Version ${esc(d.version)} is still serving traffic. Try again, or turn off the simulated failure in Demo controls.</span></div>` : ""}
      ${d.status === "done" ? `<div class="notice ok" role="status">${ICON.ok}<span>Version ${esc(d.version)} is live. The test event arrived.</span></div>` : ""}
      <div class="toolbar"><button type="button" class="btn btn-primary" data-act="deploy" ${busy ? 'disabled aria-busy="true"' : ""}>${busy ? '<span class="spinner" aria-hidden="true"></span> Updating' : d.status === "failed" ? "Try again" : `Update to ${nextVersion(d.version)}`}</button></div>
      <h3>History</h3><table class="table"><tbody>${d.history.map((h) => `<tr><td class="num">${esc(h.v)}</td><td>${h.ok ? '<span class="tag ok">Deployed</span>' : '<span class="tag warn">Rolled back</span>'}</td><td class="r muted">${fmtDayY(h.at)}</td></tr>`).join("")}</tbody></table>
    </div></section>`;
  }

  function mSettings() {
    const s = site();
    const st = API ? Object.assign({ retention: String(s.settings.retentionMonths), timezone: s.timezone }, s.settings) : state.settings;
    const row = (id, l, d) => `<div class="settings-row"><div class="text"><b style="font-weight:550">${l}</b><span>${d}</span></div><button type="button" class="switch" role="switch" aria-checked="${st[id]}" aria-label="${l}" data-act="setting" data-id="${id}"></button></div>`;
    return `<section class="panel"><div class="panel-head"><h2>Settings for ${esc(s.domain)}</h2></div><div class="panel-body">
      <fieldset style="border:0;padding:0;margin:0;min-width:0" ${!isAdmin() ? "disabled" : ""}><form class="form-grid" data-submit="settings" style="margin-bottom:8px">
        <div class="field"><label for="set-name">Website name</label><input class="input input-lg" id="set-name" name="name" value="${esc(s.name)}" autocomplete="off"><span class="help" id="set-name-help"></span></div>
        <div class="field"><label for="set-tz">Reporting timezone</label><select class="select input-lg" id="set-tz" name="tz">${[...new Set(["UTC", "Europe/London", "Europe/Bucharest", "America/New_York", "Asia/Tokyo", s.timezone])].map((z) => `<option ${(st.timezone || s.timezone) === z ? "selected" : ""}>${z}</option>`).join("")}</select><span class="help">${API ? "Days and hours in reports. Applies to visits recorded after the change." : ""}</span></div>
        <div class="field"><label for="set-ret">Keep raw events for</label><select class="select input-lg" id="set-ret" name="retention">${[["6", "6 months"], ["12", "12 months"], ["24", "24 months"], ["0", "Forever"]].map(([v, l]) => `<option value="${v}" ${st.retention === v ? "selected" : ""}>${l}</option>`).join("")}</select><span class="help">${API ? "Older events are deleted once a day." : "Older events are deleted once a day in the app."}</span></div>
        <div class="field" style="align-self:end"><button type="submit" class="btn btn-primary" style="min-height:40px;justify-self:start">Save changes</button><span class="help" id="set-saved" role="status"></span></div>
      </form>
      ${row("excludeBots", "Ignore bots and crawlers", "Leave known automated traffic out of your reports")}
      ${row("respectDnt", "Respect DNT and GPC", "Skip pageviews, goals and activity when the browser sends a privacy signal")}</fieldset>
      ${API ? '<p class="help">Reports are private to signed-in installation users. Public sharing is unavailable in v1.</p><div id="project-privacy"></div>' : row("publicDashboard", "Public dashboard", "Simulated sharing control")}
    </div></section>`;
  }

  /* ---------- onboarding ---------- */
  const OB_STEPS = ["Deploy", "Website", "Install", "Done"];
  function viewWelcome() {
    const ob = state.onboard || (state.onboard = { step: 0, deploy: { steps: null, status: "idle" }, account: "demo", name: "", domain: "", kind: "store", errors: {}, verify: "idle", siteId: null, busy: false });
    const stepper = `<ol class="stepper" aria-label="Setup progress">${OB_STEPS.map((l, i) => `<li class="${i < ob.step ? "done" : i === ob.step ? "current" : ""}" ${i === ob.step ? 'aria-current="step"' : ""}>${i + 1}. ${l}</li>`).join("")}</ol>`;
    let body = "";
    if (ob.step === 0 && API) {
      const h = state.health;
      body = `<div><h1>Your collector is running</h1><p class="muted" style="margin-top:6px">This installation answers at <code>${esc(location.host)}</code>. Next, add the website you want to measure.</p></div>
        ${h.ok && h.database ? `<div class="notice ok" role="status">${ICON.ok}<span>Collector running, version ${esc(h.version)}, in ${h.mode === "production" ? "production" : "development"} mode. The database is connected.</span></div>` : `<div class="notice err" role="alert">${ICON.warn}<span>The collector is running, but its database did not answer. Check the database setup, then reload this page.</span></div>`}
        <div class="actions">${state.sites.length ? `<a class="btn btn-ghost" href="${hashFor({ route: "overview", sub: "" })}">Cancel setup</a>` : ""}<button type="button" class="btn btn-primary" data-act="ob-next" ${h.ok && h.database ? "" : "disabled"}>Continue</button></div>`;
    } else if (ob.step === 0) {
      const d = ob.deploy;
      body = `<div><h1>Deploy your analytics to Cloudflare</h1><p class="muted" style="margin-top:6px">PostDeploy is designed to run in your own account, so visitor data stays with you. This demo uses a pretend account and creates nothing.</p></div>
        <div class="choice-grid" role="group" aria-label="Cloudflare account">
          <button type="button" class="choice" aria-pressed="${ob.account === "demo"}" data-act="ob-account" data-id="demo"><b>Demo account</b><span>Simulated, nothing is created</span></button>
          <button type="button" class="choice" aria-pressed="false" aria-disabled="true" data-act="toast" data-msg="Connecting a real account is outside this demo."><b>Connect my account</b><span>Not available in the demo</span></button>
          <button type="button" class="choice" aria-pressed="${ob.account === "skip"}" data-act="ob-account" data-id="skip"><b>Already deployed</b><span>Skip to adding a website</span></button>
        </div>
        ${deploySteps(d)}
        ${d.status === "failed" ? `<div class="notice err" role="alert">${ICON.warn}<span>The database migration timed out, so nothing was left half-built. Try again; the failed step reruns from the start.</span></div>` : ""}
        ${d.status === "done" ? `<div class="notice ok" role="status">${ICON.ok}<span>Your collector is live at <code>analytics.your-domain.example</code>.</span></div>` : ""}
        <div class="actions"><a class="btn btn-ghost" href="${hashFor({ route: "overview", sub: "" })}">Cancel setup</a>${ob.account === "skip" || d.status === "done" ? `<button type="button" class="btn btn-primary" data-act="ob-next">Continue</button>` : `<button type="button" class="btn btn-primary" data-act="ob-deploy" ${d.status === "running" ? 'disabled aria-busy="true"' : ""}>${d.status === "running" ? '<span class="spinner" aria-hidden="true"></span> Deploying' : d.status === "failed" ? "Try again" : "Deploy"}</button>`}</div>`;
    } else if (ob.step === 1) {
      body = `<div><h1>Add your first website</h1><p class="muted" style="margin-top:6px">Reports, goals and the tracking code are set up for it.</p></div>
        <form class="stack" data-submit="ob-site" novalidate id="ob-form">
          <div class="field"><label for="ob-name">Website name</label><input class="input input-lg" id="ob-name" name="name" value="${esc(ob.name)}" autocomplete="off" placeholder="Northwind Studio" ${ob.errors.name ? 'aria-invalid="true"' : ""} aria-describedby="ob-name-help"><span class="help ${ob.errors.name ? "error" : ""}" id="ob-name-help">${ob.errors.name || ""}</span></div>
          <div class="field"><label for="ob-domain">Domain</label><input class="input input-lg" id="ob-domain" name="domain" value="${esc(ob.domain)}" autocomplete="off" inputmode="url" placeholder="northwind.example" ${ob.errors.domain ? 'aria-invalid="true"' : ""} aria-describedby="ob-domain-help"><span class="help ${ob.errors.domain ? "error" : ""}" id="ob-domain-help">${ob.errors.domain || "Without https:// or a path."}</span></div>
          <div class="field"><span class="label" id="ob-kind-l">What does the website do?</span><div class="choice-grid" role="group" aria-labelledby="ob-kind-l">${[["store", "Sells products", "Purchases and carts"], ["saas", "Signs people up", "Trials and subscriptions"], ["docs", "Publishes content", "Readers and upgrades"]].map(([id, l, d]) => `<button type="button" class="choice" aria-pressed="${ob.kind === id}" data-act="ob-kind" data-id="${id}"><b>${l}</b><span>${d}</span></button>`).join("")}</div><span class="help">Sets sensible starting goals. You can change them later.</span></div>
          ${ob.errors.form ? `<div class="notice err" role="alert">${ICON.warn}<span>${esc(ob.errors.form)}</span></div>` : ""}
          <div class="actions"><button type="button" class="btn btn-ghost" data-act="ob-back">Back</button><button type="submit" class="btn btn-primary" ${ob.busy ? 'disabled aria-busy="true"' : ""}>${ob.busy ? '<span class="spinner" aria-hidden="true"></span> Adding' : "Add website"}</button></div>
        </form>`;
    } else if (ob.step === 2) {
      const s = state.sites.find((x) => x.id === ob.siteId);
      const v = ob.verify;
      body = `<div><h1>Install the tracking code</h1><p class="muted" style="margin-top:6px">Paste this into the head of every page on ${esc(s.domain)}, then publish.</p></div>
        <div class="code-wrap"><pre class="code" id="ob-snippet">${esc(`<script defer\n  src="${API ? location.origin : "https://analytics.your-domain.example"}/script.js"\n  data-site="${s.id}"></script>`)}</pre><button type="button" class="btn btn-sm" data-act="copy" data-target="ob-snippet">Copy</button></div>
        ${v === "checking" ? `<div class="notice" role="status"><span class="spinner" aria-hidden="true"></span>Waiting for the first pageview from ${esc(s.domain)}…</div>` : ""}
        ${v === "ok" ? `<div class="notice ok" role="status">${ICON.ok}<span>First pageview received from ${esc(s.domain)}. Reports are live.</span></div>` : ""}
        ${v === "none" ? `<div class="notice err" role="alert">${ICON.warn}<span>No pageview from ${esc(s.domain)} in the last minute. Publish the page with the snippet in its head, open it once, then check again.</span></div>` : ""}
        ${v === "error" ? `<div class="notice err" role="alert">${ICON.warn}<span>${esc(errText(ob.verifyError))} Check again in a moment.</span></div>` : ""}
        <div class="actions"><button type="button" class="btn btn-ghost" data-act="ob-skip-verify">I'll do this later</button>${v === "ok" ? `<button type="button" class="btn btn-primary" data-act="ob-next">Continue</button>` : `<button type="button" class="btn btn-primary" data-act="ob-verify" ${v === "checking" ? 'disabled aria-busy="true"' : ""}>${v === "checking" ? '<span class="spinner" aria-hidden="true"></span> Checking' : "Check installation"}</button>`}</div>`;
    } else {
      const s = state.sites.find((x) => x.id === ob.siteId);
      body = `<div><h1>${esc(s.name)} is set up</h1><p class="muted" style="margin-top:6px">${s.empty ? "The dashboard is ready and will fill in once the snippet sends its first pageview." : API ? "Its first pageview is already in the Live view." : "Its first sample visit is already in the Live view."}</p></div>
        <ul class="steps">${[API ? "Collector running" : "Collector deployed to Cloudflare", `${esc(s.domain)} added with starter goals`, s.empty ? "Tracking code waiting for its first pageview" : "Tracking code verified"].map((l, i) => `<li class="${i === 2 && s.empty ? "pending" : "done"}"><span class="state">${i === 2 && s.empty ? "" : ICON.check}</span><span>${l}</span><span></span></li>`).join("")}</ul>
        <div class="actions"><a class="btn" href="${hashFor({ route: "manage", sub: "team", siteId: s.id })}">Invite your team</a><button type="button" class="btn btn-primary" data-act="ob-finish">Open the dashboard</button></div>`;
    }
    return `<div class="onboard">${stepper}<section class="panel"><div class="panel-body">${body}</div></section></div>`;
  }

  function runSteps(target, failAt, onDone) {
    target.steps = [];
    target.status = "running";
    let i = 0;
    const tick = () => {
      if (i > 0) target.steps[i - 1] = "done";
      if (failAt === i - 1 && failAt >= 0) {
        target.steps[i - 1] = "failed";
        target.status = "failed";
        render();
        return;
      }
      if (i >= DEPLOY_STEPS.length) { target.status = "done"; onDone && onDone(); render(); return; }
      target.steps[i] = "active";
      i++;
      render();
      setTimeout(tick, 520 + (i % 3) * 180);
    };
    tick();
  }

  /* ---------- render ---------- */
  function render() {
    if (!API) renderDemoMenu();
    renderTopbar();
    const views = { overview: viewOverview, audience: viewAudience, conversions: viewConversions, live: viewLive, manage: viewManage, welcome: viewWelcome };
    const active = document.activeElement;
    const focusId = active && active.id;
    const focusAct = active && active.dataset && active.dataset.act ? `[data-act="${active.dataset.act}"]${active.dataset.id ? `[data-id="${active.dataset.id}"]` : ""}${active.dataset.dim ? `[data-dim="${active.dataset.dim}"]` : ""}${active.dataset.value ? `[data-value="${CSS.escape(active.dataset.value)}"]` : ""}` : null;
    $("#view").innerHTML = state.route === "welcome" && !isAdmin() ? '<section class="panel"><div class="panel-body"><h1>No websites yet</h1><p>An administrator can add the first website. Your Viewer account will be able to read its reports.</p></div></section>' : views[state.route]();
    const team = $("#auth-team");
    if (team) window.PostDeployAuth.mountTeam(team);
    if (API && window.PostdeployPrivacy) window.PostdeployPrivacy.mount(site(), isAdmin(), async (body) => { putSite(await ds.updateSite(site().id, body)); });
    if (!isAdmin()) document.querySelectorAll('[data-act="start-onboard"], [data-act="rm-site"]').forEach((el) => { el.disabled = true; el.title = "An administrator manages websites"; });
    if(API && window.PostdeployGoals) window.PostdeployGoals.mount(site(),isAdmin(),async()=>{ for(const s of await ds.listSites()) putSite(s); await loadReport(true); render(); });
    const chart = $("#chart");
    if (chart) drawChart(chart);
    if (state.route === "live") {
      if (!liveTimer) startLive();
      else if (!state.live.data || state.live.siteId !== site().id) pollLive();
      renderLiveParts();
    } else stopLive();
    if (focusId && document.getElementById(focusId) && active !== document.getElementById(focusId)) document.getElementById(focusId).focus();
    else if (focusAct && !document.contains(active)) { const el = $(focusAct); if (el) el.focus(); }
    document.title = `${{ overview: "Overview", audience: "Audience", conversions: "Conversions", live: "Live", manage: "Manage", welcome: "Set up" }[state.route]} · ${site().name} · PostDeploy Analytics${API ? "" : " demo"}`;
  }

  let renderedRoute = null;
  function onRoute() {
    const prevRoute = renderedRoute;
    readHash();
    if (state.missingSite) {
      history.replaceState(null, "", hashFor({ filters: [] }));
      readHash();
      setTimeout(() => toast(`That website is not ${API ? "on this installation" : "in this demo"} any more. Showing ${site().name}.`), 0);
    }
    if (!state.sites.length && state.route !== "welcome") {
      history.replaceState(null, "", hashFor({ route: "welcome", sub: "" }));
      readHash();
    }
    if (API && (state.route === "welcome" || (state.route === "manage" && state.sub === "deploy"))) refreshHealth();
    loadReport();
    state.menus = {};
    render();
    renderedRoute = state.route;
    if (prevRoute && prevRoute !== state.route) { window.scrollTo(0, 0); $("#main").focus({ preventScroll: true }); }
  }

  function refreshHealth() {
    ds.health().then((h) => h, () => Object.assign({}, state.health, { ok: false, database: false })).then((h) => { state.health = h; render(); });
  }

  async function pollVerify(ob) {
    const until = Date.now() + 60000;
    const active = () => state.onboard === ob && ob.step === 2 && state.route === "welcome";
    while (active()) {
      try {
        if ((await ds.verify(ob.siteId)).received) { await refreshSites(); ob.verify = "ok"; break; }
      } catch (e) {
        Object.assign(ob, { verify: "error", verifyError: e });
        break;
      }
      if (Date.now() + 2000 > until) { ob.verify = "none"; break; }
      await wait(2000);
    }
    if (active()) render();
  }

  /* ---------- toasts ---------- */
  function toast(msg, undo, onExpire) {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<p>${esc(msg)}</p>${undo ? '<button type="button" class="btn btn-sm">Undo</button>' : ""}`;
    $("#toasts").appendChild(el);
    let undone = false;
    const close = () => el.remove();
    if (undo) $("button", el).onclick = () => { undone = true; undo(); close(); };
    setTimeout(() => { if (!undone && onExpire) onExpire(); close(); }, undo ? 6000 : 3200);
  }

  /* ---------- actions ---------- */
  const actions = {
    "sign-out"() { window.PostDeployAuth.logout().catch((e) => toast(e.message)); },
    site(el) {
      Object.assign(state.live, { data: null, selected: null, session: null });
      const toOverview = state.route === "welcome" || (state.route === "manage" && (state.sub || "websites") === "websites");
      go({ siteId: el.dataset.id, filters: [], route: toOverview ? "overview" : state.route, sub: toOverview ? "" : state.sub });
    },
    metric(el) { go({ metric: el.dataset.id }); },
    "chart-table"() { state.chartAsTable = !state.chartAsTable; render(); },
    reveal(el) { const k = el.dataset.id; state.reveal[k] = el.getAttribute("aria-expanded") !== "true"; if (k === "more" && !state.reveal.more && ["bounceRate", "duration"].includes(state.metric)) { go({ metric: "visitors" }); return; } render(); },
    "panel-tab"(el) { state.panelTabs[el.dataset.panel] = el.dataset.dim; render(); },
    "aud-dim"(el) { go({ audienceDim: el.dataset.dim }); },
    sort(el) { const k = el.dataset.key; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 }; render(); },
    "add-filter"(el) {
      const f = state.filters.filter((x) => x.dim !== el.dataset.dim);
      f.push({ dim: el.dataset.dim, value: el.dataset.value });
      $("#announce").textContent = `Filtered by ${D.DIMENSIONS[el.dataset.dim]} ${el.dataset.value}`;
      go({ filters: f });
    },
    "rm-filter"(el) { go({ filters: state.filters.filter((_, i) => i !== +el.dataset.i) }); },
    "rm-filter-dim"(el) { go({ filters: state.filters.filter((f) => f.dim !== el.dataset.dim) }); },
    "clear-filters"() { go({ filters: [] }); },
    "filter-dim"(el) { state.menus.filter = el.dataset.dim || true; render(); const first = $(".toolbar .menu button"); if (first) first.focus(); },
    retry() { loadReport(true); render(); },
    reload() { location.reload(); },
    "toggle-fail"() { state.failReports = !state.failReports; state.menus = {}; loadReport(true); render(); },
    "toggle-deploy-fail"() { state.deploy.failNext = !state.deploy.failNext; state.menus = {}; render(); },
    reset() { ds.reset(); location.hash = ""; location.reload(); },
    toast(el) { state.menus = {}; render(); toast(el.dataset.msg); },
    "nav-toggle"(el) { const nav = $("#nav"); const open = !nav.classList.contains("open"); nav.classList.toggle("open", open); el.setAttribute("aria-expanded", open); },
    "sample-visit"() {
      const s = ds.sampleVisit(site().id, "/");
      $("#announce").textContent = `Sample pageview received from ${s.domain}. ${s.visits.length} so far today.`;
      state.live.data = null;
      loadReport(true);
      render();
    },
    "live-pause"() { state.live.paused = !state.live.paused; render(); },
    "live-kind"(el) { state.live.kind = el.dataset.kind; render(); },
    session(el) {
      const sel = { id: el.dataset.id, at: +el.dataset.at };
      Object.assign(state.live, { selected: sel, session: null });
      const show = () => { const box = $("#session"); if (box && state.live.selected === sel) box.innerHTML = sessionPanel(); };
      show();
      document.querySelectorAll("#feed button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === el.dataset.id));
      ds.session(site().id, sel.id, sel.at).then((tl) => tl, (error) => ({ error })).then((tl) => { if (state.live.selected === sel) state.live.session = tl; show(); });
    },
    "rm-site"(el) {
      const i = state.sites.findIndex((s) => s.id === el.dataset.id);
      const [removed] = state.sites.splice(i, 1);
      if (state.siteId === removed.id) state.siteId = state.sites[0].id;
      pendingDeletes.add(removed.id);
      render();
      const restore = () => { pendingDeletes.delete(removed.id); state.sites.splice(Math.min(i, state.sites.length), 0, removed); render(); };
      toast(`${removed.name} removed.`, restore, () => ds.deleteSite(removed.id).then(() => pendingDeletes.delete(removed.id), (e) => { restore(); toast(`${removed.name} was not removed. ${errText(e)}`); }));
    },
    platform(el) { state.tracking.platform = el.dataset.id; render(); },
    copy(el) {
      const text = $("#" + el.dataset.target).textContent;
      const done = () => { el.textContent = "Copied"; setTimeout(() => { if (document.contains(el)) el.textContent = "Copy"; }, 1600); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, done); else done();
    },
    verify() {
      const s = site();
      state.tracking.verify = "checking"; render();
      ds.verify(s.id).then(async (r) => {
        if (r.received && API) await refreshSites();
        Object.assign(state.tracking, { verify: r.received ? "ok" : "fail", result: r });
      }, (e) => Object.assign(state.tracking, { verify: "error", result: e })).then(render);
    },
    "verify-reset"() { state.tracking.verify = "idle"; render(); },
    "rm-member"(el) {
      const i = state.team.findIndex((m) => m.id === +el.dataset.id);
      const [m] = state.team.splice(i, 1);
      render();
      toast(`${m.name} no longer has access.`, () => { state.team.splice(i, 0, m); render(); });
    },
    revoke(el) {
      const i = state.keys.findIndex((k) => k.id === +el.dataset.id);
      const [k] = state.keys.splice(i, 1);
      render();
      toast(`“${k.name}” revoked. Scripts using it stop working.`, () => { state.keys.splice(i, 0, k); render(); });
    },
    "dismiss-key"() { state.newKey = null; render(); },
    "mcp-toggle"() { state.mcp.enabled = !state.mcp.enabled; render(); },
    "mcp-tool"(el) { state.mcp.tools[el.dataset.id] = !state.mcp.tools[el.dataset.id]; render(); },
    "mcp-connect"() {
      const names = { reports: "Read reports", events: "Query events", goals: "Manage goals", manage: "Manage websites" };
      const tools = Object.keys(state.mcp.tools).filter((k) => state.mcp.tools[k]).map((k) => names[k]);
      if (!tools.length) { toast("Turn on at least one tool before a client can connect."); return; }
      state.mcp.clients.push({ id: nextId++, name: ["Terminal agent", "Team chat assistant", "Notebook assistant"][state.mcp.clients.length % 3], connected: todayMs, tools });
      render();
    },
    "mcp-disconnect"(el) {
      const i = state.mcp.clients.findIndex((c) => c.id === +el.dataset.id);
      const [c] = state.mcp.clients.splice(i, 1);
      render();
      toast(`${c.name} disconnected.`, () => { state.mcp.clients.splice(i, 0, c); render(); });
    },
    deploy() {
      const d = state.deploy;
      const fail = d.failNext ? 3 : -1;
      const v = nextVersion(d.version);
      runSteps(d, fail, () => { d.version = v; d.history.unshift({ v, at: todayMs, ok: true }); });
    },
    setting(el) {
      const k = el.dataset.id;
      if (!API) { state.settings[k] = !state.settings[k]; render(); return; }
      const s = site();
      ds.updateSite(s.id, { [k]: !s.settings[k] }).then(putSite, (e) => toast(`That setting was not saved. ${errText(e)}`)).then(render);
    },
    "start-onboard"() { state.onboard = null; state.menus = {}; go({ route: "welcome", sub: "", filters: [] }); },
    "ob-account"(el) { state.onboard.account = el.dataset.id; render(); },
    "ob-deploy"() { const ob = state.onboard; runSteps(ob.deploy, state.deploy.failNext ? 3 : -1); },
    "ob-next"() { state.onboard.step++; render(); },
    "ob-back"() { state.onboard.step--; render(); },
    "ob-kind"(el) { const f = $("#ob-form"); if (f) { state.onboard.name = f.name.value; state.onboard.domain = f.domain.value; } state.onboard.kind = el.dataset.id; render(); },
    "ob-verify"() {
      const ob = state.onboard;
      ob.verify = "checking"; render();
      if (API) { pollVerify(ob); return; }
      setTimeout(() => { ob.verify = "ok"; ds.sampleVisit(ob.siteId, "/"); state.live.data = null; render(); }, 1600);
    },
    "ob-skip-verify"() { state.onboard.step = 3; render(); },
    "ob-finish"() { const id = state.onboard.siteId; state.onboard = null; state.live.data = null; go({ route: "overview", sub: "", siteId: id, filters: [] }); }
  };

  const submits = {
    custom(form) {
      const from = form.from.value, to = form.to.value;
      const err = $("#range-err");
      if (!from || !to) { err.textContent = "Choose both a start and an end date."; return; }
      if (from > to) { err.textContent = "The start date must be on or before the end date."; form.from.setAttribute("aria-invalid", "true"); form.from.focus(); return; }
      if (to > D.isoDay(siteToday())) { err.textContent = "The end date can't be in the future."; form.to.focus(); return; }
      go({ custom: { from, to } });
    },
    invite(form) {
      const email = form.email.value.trim();
      const help = $("#inv-help");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { form.email.setAttribute("aria-invalid", "true"); help.textContent = "Enter an email address like name@company.example."; help.classList.add("error"); form.email.focus(); return; }
      if (state.team.some((m) => m.email === email)) { form.email.setAttribute("aria-invalid", "true"); help.textContent = `${email} is already on the team.`; help.classList.add("error"); form.email.focus(); return; }
      state.team.push({ id: nextId++, name: email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), email, role: form.role.value, status: "Invited" });
      render();
      $("#inv-help").textContent = `Invite recorded for ${email}. In the demo no email is sent.`;
      $("#inv-email").focus();
    },
    key(form) {
      const name = form.name.value.trim();
      if (!name) { form.name.setAttribute("aria-invalid", "true"); const h = $("#key-help"); h.textContent = "Name the key after what will use it."; h.classList.add("error"); form.name.focus(); return; }
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
      let tok = "pd_demo_";
      for (let i = 0; i < 32; i++) tok += chars[Math.floor(Math.random() * chars.length)];
      state.keys.unshift({ id: nextId++, name, prefix: tok.slice(0, 12), scope: form.scope.value, created: todayMs, lastUsed: null });
      state.newKey = { name, token: tok };
      render();
    },
    async settings(form) {
      const name = form.name.value.trim();
      if (!name) { form.name.setAttribute("aria-invalid", "true"); const h = $("#set-name-help"); h.textContent = "The website needs a name."; h.classList.add("error"); form.name.focus(); return; }
      try {
        putSite(await ds.updateSite(site().id, API ? { name, timezone: form.tz.value, retentionMonths: Number(form.retention.value) } : { name }));
      } catch (e) {
        const h = $("#set-saved"); h.textContent = `Not saved. ${errText(e)}`; h.classList.add("error");
        return;
      }
      if (!API) Object.assign(state.settings, { timezone: form.tz.value, retention: form.retention.value });
      render();
      $("#set-saved").textContent = "Saved.";
    },
    async "ob-site"(form) {
      const ob = state.onboard;
      ob.name = form.name.value.trim();
      ob.domain = form.domain.value.trim();
      try { if (!/[\s/:@?#%\\]/u.test(ob.domain)) ob.domain = new URL("https://" + ob.domain.replace(/\.$/, "")).hostname; } catch {}
      ob.errors = {};
      if (!ob.name) ob.errors.name = "Give the website a name your team will recognise.";
      if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(ob.domain)) ob.errors.domain = "Enter a domain such as northwind.example.";
      else if (state.sites.some((s) => s.domain === ob.domain)) ob.errors.domain = `${ob.domain} is already being tracked.`;
      const invalid = () => { render(); const bad = $('[aria-invalid="true"]'); if (bad) bad.focus(); };
      if (Object.keys(ob.errors).length) { invalid(); return; }
      ob.busy = true;
      render();
      try {
        const s = await ds.createSite({ name: ob.name, domain: ob.domain, kind: ob.kind });
        state.sites.push(s);
        Object.assign(ob, { siteId: s.id, step: 2, busy: false });
      } catch (e) {
        ob.busy = false;
        if (e.code === "domain_taken") ob.errors.domain = `${ob.domain} is already being tracked.`;
        else ob.errors.form = `${errText(e)} Nothing was added; try again.`;
        invalid();
        return;
      }
      go({ route: "welcome", sub: "", siteId: ob.siteId, filters: [] });
    }
  };

  document.addEventListener("click", (e) => {
    if (e.target.closest(".skip")) { e.preventDefault(); $("#main").focus(); return; }
    const menuBtn = e.target.closest("[data-menu]");
    if (menuBtn) {
      const k = menuBtn.dataset.menu;
      const open = !state.menus[k];
      state.menus = {};
      if (open) state.menus[k] = true;
      render();
      const again = $(`[data-menu="${k}"]`);
      if (open && again) { const first = again.parentElement.querySelector(".menu [role^=menuitem]"); (first || again).focus(); } else if (again) again.focus();
      return;
    }
    const el = e.target.closest("[data-act]");
    if (el && !el.disabled && el.getAttribute("aria-disabled") !== "true") { e.preventDefault(); const keepMenu = el.dataset.act === "filter-dim"; if (!keepMenu && el.closest(".menu")) state.menus = {}; actions[el.dataset.act](el); return; }
    if (el && el.getAttribute("aria-disabled") === "true" && el.dataset.msg) { toast(el.dataset.msg); return; }
    if (!e.target.closest(".menu") && Object.keys(state.menus).length) { state.menus = {}; render(); }
    if (e.target.closest(".nav a")) $("#nav").classList.remove("open");
  });

  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-change]");
    if (!el) return;
    const k = el.dataset.change;
    if (k === "range") go({ range: el.value });
    else if (k === "compare") go({ compare: el.value });
    else if (k === "role") { const m = state.team.find((x) => x.id === +el.dataset.id); m.role = el.value; toast(`${m.name} is now ${el.value === "Admin" ? "an admin" : "a viewer"}.`); }
  });

  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-submit]");
    if (!form) return;
    e.preventDefault();
    submits[form.dataset.submit](form);
  });

  document.addEventListener("input", (e) => {
    if (e.target.getAttribute("aria-invalid") === "true") {
      e.target.removeAttribute("aria-invalid");
      const help = document.getElementById(e.target.getAttribute("aria-describedby") || "");
      if (help) help.classList.remove("error");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && Object.keys(state.menus).length) {
      const k = Object.keys(state.menus)[0];
      state.menus = {};
      render();
      const btn = $(`[data-menu="${k}"]`);
      if (btn) btn.focus();
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest(".menu")) {
      const items = [...e.target.closest(".menu").querySelectorAll("[role^=menuitem]")];
      const i = items.indexOf(e.target);
      if (i >= 0) { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
    }
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const c = $("#chart"); if (c) drawChart(c); }, 120); });
  setInterval(async () => {
    if (!ds || state.route === "welcome" || site().empty) return;
    if (API && state.route !== "live") await ds.live(site().id).catch(() => null);
    updateNavCount();
  }, 15000);

  function apiChrome() {
    const strip = $(".demo-strip");
    if (state.health.mode === "development") $("p", strip).innerHTML = "<b>Local development build</b> storing data in the local database.";
    else strip.hidden = true;
    $(".foot .container").innerHTML = `<span>PostDeploy Analytics ${esc(state.health.version || "")}</span><span>Figures come from this installation's database.</span>`;
  }

  function blocked(e) {
    const owner = e.code === "owner_access_not_configured";
    document.title = owner ? "Owner access needed · PostDeploy Analytics" : "Dashboard did not load · PostDeploy Analytics";
    $("#view").innerHTML = `<div class="page-head"><div class="title"><h1>PostDeploy Analytics</h1></div></div><div class="panel"><div class="empty"><h2>${owner ? "Owner access is not set up yet" : "The dashboard did not load"}</h2><p>${owner ? `The collector is running (version ${esc(state.health.version || "")}). Reports, websites and settings open once owner access is set up for this installation.` : `${esc(errText(e))} Your data is safe; nothing was changed.`}</p>${owner ? "" : '<div class="toolbar"><button type="button" class="btn btn-primary" data-act="reload">Try again</button></div>'}</div></div>`;
  }

  async function start() {
    try { ds = await pickSource(); } catch (e) { blocked(e); return; }
    API = ds.mode === "api";
    if (API) {
      try {
        const auth = await window.PostDeployAuth.refresh();
        if (!auth.user) { location.replace("/auth"); return; }
      } catch (e) { blocked(e); return; }
      apiChrome();
      if (!location.hash) { location.replace("/organisations"); return; }
    }
    try {
      state.sites = await ds.listSites();
    } catch (e) {
      blocked(e);
      return;
    }
    if (API) state.siteId = state.sites.length ? state.sites[0].id : "";
    window.addEventListener("hashchange", onRoute);
    onRoute();
    if (API && !site().empty) ds.live(site().id).then(updateNavCount, () => null);
  }
  start();
})();
