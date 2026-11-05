(function (root) {
  "use strict";

  const DAY = 86400000;
  const EPOCH = Date.UTC(2025, 0, 1);

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rand(key) {
    let t = hash(key) + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function jitter(key, spread) {
    return 1 + (rand(key) * 2 - 1) * spread;
  }

  function isoDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function dayStart(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  }

  const SOURCES = {
    store: [
      { name: "Google", kind: "Search", share: 0.34, cvr: 1.0, aov: 1.0, referrers: [["Google", 1]] },
      { name: "Direct", kind: "Direct", share: 0.22, cvr: 1.35, aov: 1.1, referrers: [["Direct or unknown", 1]] },
      { name: "Instagram", kind: "Social", share: 0.14, cvr: 0.7, aov: 0.85, referrers: [["Instagram", 0.8], ["Instagram stories", 0.2]] },
      { name: "Newsletter", kind: "Email", share: 0.11, cvr: 2.1, aov: 1.2, referrers: [["Newsletter", 1]] },
      { name: "Pinterest", kind: "Social", share: 0.08, cvr: 0.6, aov: 0.9, referrers: [["Pinterest", 1]] },
      { name: "Bing", kind: "Search", share: 0.05, cvr: 1.1, aov: 1.05, referrers: [["Bing", 0.7], ["DuckDuckGo", 0.3]] },
      { name: "Home & Hearth blog", kind: "Referral", share: 0.06, cvr: 1.5, aov: 1.15, referrers: [["homeandhearth.example", 1]] }
    ],
    docs: [
      { name: "Google", kind: "Search", share: 0.48, cvr: 1.0, aov: 1.0, referrers: [["Google", 1]] },
      { name: "Direct", kind: "Direct", share: 0.19, cvr: 1.4, aov: 1.0, referrers: [["Direct or unknown", 1]] },
      { name: "GitHub", kind: "Referral", share: 0.13, cvr: 1.6, aov: 1.0, referrers: [["github.com", 1]] },
      { name: "Forums", kind: "Social", share: 0.09, cvr: 0.9, aov: 1.0, referrers: [["Developer forum", 0.6], ["Q&A sites", 0.4]] },
      { name: "DuckDuckGo", kind: "Search", share: 0.06, cvr: 1.1, aov: 1.0, referrers: [["DuckDuckGo", 1]] },
      { name: "Newsletter", kind: "Email", share: 0.05, cvr: 2.4, aov: 1.0, referrers: [["Newsletter", 1]] }
    ],
    saas: [
      { name: "Google", kind: "Search", share: 0.29, cvr: 1.0, aov: 1.0, referrers: [["Google", 1]] },
      { name: "Direct", kind: "Direct", share: 0.24, cvr: 1.5, aov: 1.25, referrers: [["Direct or unknown", 1]] },
      { name: "LinkedIn", kind: "Social", share: 0.13, cvr: 0.8, aov: 1.4, referrers: [["LinkedIn", 1]] },
      { name: "Product directory", kind: "Referral", share: 0.1, cvr: 1.3, aov: 0.9, referrers: [["launchboard.example", 0.7], ["toolfinder.example", 0.3]] },
      { name: "Podcast", kind: "Referral", share: 0.07, cvr: 1.9, aov: 1.1, referrers: [["Podcast show notes", 1]] },
      { name: "Search ads", kind: "Paid", share: 0.12, cvr: 0.9, aov: 1.0, referrers: [["Search ads", 1]] },
      { name: "Newsletter", kind: "Email", share: 0.05, cvr: 2.2, aov: 1.1, referrers: [["Newsletter", 1]] }
    ]
  };

  const COUNTRIES = {
    store: [["United Kingdom", 0.31, 1.2], ["United States", 0.22, 1.0], ["Germany", 0.11, 1.05], ["Netherlands", 0.08, 1.1], ["France", 0.07, 0.9], ["Ireland", 0.06, 1.15], ["Canada", 0.05, 0.95], ["Australia", 0.04, 0.85], ["Other", 0.06, 0.6]],
    docs: [["United States", 0.29, 1.0], ["India", 0.14, 0.8], ["Germany", 0.1, 1.1], ["United Kingdom", 0.08, 1.05], ["Brazil", 0.07, 0.85], ["France", 0.06, 1.0], ["Japan", 0.05, 0.95], ["Poland", 0.05, 1.1], ["Other", 0.16, 0.8]],
    saas: [["United States", 0.38, 1.1], ["United Kingdom", 0.12, 1.05], ["Germany", 0.09, 1.0], ["Canada", 0.07, 1.0], ["Romania", 0.05, 0.9], ["Spain", 0.05, 0.85], ["Australia", 0.05, 1.0], ["Sweden", 0.04, 1.15], ["Other", 0.15, 0.7]]
  };

  const DEVICES = {
    store: [["Mobile", 0.63, 0.8], ["Desktop", 0.31, 1.45], ["Tablet", 0.06, 1.0]],
    docs: [["Desktop", 0.78, 1.1], ["Mobile", 0.19, 0.6], ["Tablet", 0.03, 0.8]],
    saas: [["Desktop", 0.66, 1.25], ["Mobile", 0.3, 0.55], ["Tablet", 0.04, 0.9]]
  };

  const BROWSERS = {
    store: [["Safari", 0.41, 1.05], ["Chrome", 0.39, 1.0], ["Firefox", 0.06, 1.0], ["Edge", 0.06, 0.95], ["Samsung Internet", 0.05, 0.8], ["Other", 0.03, 0.7]],
    docs: [["Chrome", 0.58, 1.0], ["Firefox", 0.17, 1.1], ["Safari", 0.13, 1.0], ["Edge", 0.08, 0.9], ["Other", 0.04, 0.8]],
    saas: [["Chrome", 0.55, 1.0], ["Safari", 0.24, 1.1], ["Edge", 0.1, 0.95], ["Firefox", 0.08, 1.0], ["Other", 0.03, 0.7]]
  };

  const PAGES = {
    store: [["/", 0.27, 0.42], ["/shop/ceramics", 0.13, 0.12], ["/shop/linen", 0.1, 0.08], ["/products/stoneware-mug", 0.08, 0.1], ["/products/linen-throw", 0.06, 0.06], ["/journal/slow-mornings", 0.05, 0.11], ["/cart", 0.07, 0.01], ["/checkout", 0.05, 0.0], ["/about", 0.03, 0.03], ["/shipping", 0.03, 0.02], ["Other pages", 0.13, 0.05]],
    docs: [["/", 0.08, 0.1], ["/docs/getting-started", 0.14, 0.18], ["/docs/install", 0.11, 0.14], ["/docs/configuration", 0.1, 0.09], ["/docs/api/components", 0.12, 0.12], ["/guides/theming", 0.07, 0.08], ["/docs/migration-v3", 0.06, 0.07], ["/changelog", 0.05, 0.04], ["/pricing", 0.04, 0.03], ["Other pages", 0.23, 0.15]],
    saas: [["/", 0.22, 0.38], ["/pricing", 0.13, 0.11], ["/features/recording", 0.1, 0.12], ["/features/transcripts", 0.08, 0.08], ["/blog/remote-interviews", 0.07, 0.13], ["/signup", 0.08, 0.02], ["/templates", 0.06, 0.05], ["/customers", 0.04, 0.03], ["/changelog", 0.03, 0.02], ["Other pages", 0.19, 0.06]]
  };

  const CAMPAIGNS = {
    store: [["autumn-edit", "Newsletter", 0.55], ["weekly-letter", "Newsletter", 0.45], ["ceramics-reel", "Instagram", 0.3], ["pin-boards", "Pinterest", 0.4]],
    docs: [["v3-release", "Newsletter", 0.7], ["release-notes", "GitHub", 0.2]],
    saas: [["brand-search", "Search ads", 0.6], ["competitor-terms", "Search ads", 0.4], ["episode-112", "Podcast", 0.5], ["monthly-update", "Newsletter", 0.8], ["founder-posts", "LinkedIn", 0.25]]
  };

  const GOALS = {
    store: [
      { id: "purchase", name: "Purchase", rate: 0.021, revenue: true },
      { id: "add_to_cart", name: "Add to cart", rate: 0.074 },
      { id: "newsletter", name: "Newsletter signup", rate: 0.012 }
    ],
    docs: [
      { id: "pro_upgrade", name: "Pro license", rate: 0.0016, revenue: true },
      { id: "copy_install", name: "Copied install command", rate: 0.11 },
      { id: "star_repo", name: "Opened repository", rate: 0.034 }
    ],
    saas: [
      { id: "subscription", name: "Paid subscription", rate: 0.0085, revenue: true },
      { id: "trial", name: "Started trial", rate: 0.046 },
      { id: "demo", name: "Booked a demo", rate: 0.007 }
    ]
  };

  const FUNNELS = {
    store: { name: "Checkout", steps: ["Visited a product", "Added to cart", "Started checkout", "Entered payment", "Purchased"], shape: [0.44, 0.48, 0.55, 0.78] },
    docs: { name: "Upgrade to Pro", steps: ["Read the docs", "Viewed pricing", "Opened checkout", "Purchased Pro"], shape: [0.09, 0.22, 0.48] },
    saas: { name: "Trial to paid", steps: ["Visited pricing", "Started trial", "Invited a teammate", "Added payment", "Subscribed"], shape: [0.3, 0.42, 0.4, 0.82] }
  };

  const JOURNEYS = {
    store: [[["/", "/shop/ceramics", "/products/stoneware-mug", "/checkout"], 0.27], [["/journal/slow-mornings", "/products/linen-throw", "/checkout"], 0.16], [["/products/stoneware-mug", "/cart", "/checkout"], 0.21], [["/", "/shop/linen", "/cart", "/checkout"], 0.13], [["/shop/ceramics", "/shipping", "/checkout"], 0.08]],
    docs: [[["/docs/getting-started", "/pricing", "/checkout"], 0.34], [["/docs/api/components", "/pricing", "/checkout"], 0.22], [["/", "/pricing", "/checkout"], 0.19], [["/guides/theming", "/docs/configuration", "/pricing", "/checkout"], 0.12]],
    saas: [[["/", "/pricing", "/signup"], 0.31], [["/blog/remote-interviews", "/features/recording", "/signup"], 0.18], [["/features/transcripts", "/pricing", "/signup"], 0.15], [["/", "/customers", "/pricing", "/signup"], 0.1], [["/templates", "/signup"], 0.09]]
  };

  const SITE_SEEDS = [
    { id: "fernhill", name: "Fernhill Goods", domain: "fernhill.example", kind: "store", base: 1650, growth: 0.0012, ppv: 3.6, bounce: 0.41, duration: 171, aov: 62, currency: "€", timezone: "Europe/London", created: "2025-01-01" },
    { id: "lantern", name: "Lantern UI docs", domain: "docs.lantern.example", kind: "docs", base: 4800, growth: 0.0009, ppv: 4.2, bounce: 0.33, duration: 242, aov: 149, currency: "$", timezone: "UTC", created: "2025-01-01" },
    { id: "quillcast", name: "Quillcast", domain: "quillcast.example", kind: "saas", base: 860, growth: 0.0019, ppv: 2.9, bounce: 0.47, duration: 128, aov: 29, currency: "$", timezone: "America/New_York", created: "2025-01-01" }
  ];

  const WEEKLY = {
    store: [1.12, 0.94, 0.95, 0.97, 0.99, 1.0, 1.08],
    docs: [0.62, 1.12, 1.17, 1.16, 1.12, 1.02, 0.66],
    saas: [0.71, 1.12, 1.15, 1.13, 1.08, 0.96, 0.7]
  };

  const HOURLY = [0.22, 0.15, 0.11, 0.09, 0.1, 0.16, 0.33, 0.6, 0.86, 1.03, 1.12, 1.16, 1.2, 1.18, 1.14, 1.12, 1.1, 1.08, 1.15, 1.32, 1.42, 1.3, 0.92, 0.5];
  const HOURLY_SUM = HOURLY.reduce((a, b) => a + b, 0);

  const DIMENSIONS = {
    source: "Source",
    referrer: "Referrer",
    campaign: "Campaign",
    country: "Country",
    device: "Device",
    browser: "Browser",
    page: "Page",
    entry: "Entry page"
  };

  function profile(site) {
    const kind = site.kind;
    return {
      sources: SOURCES[kind],
      countries: COUNTRIES[kind].map(([name, share, cvr]) => ({ name, share, cvr })),
      devices: DEVICES[kind].map(([name, share, cvr]) => ({ name, share, cvr })),
      browsers: BROWSERS[kind].map(([name, share, cvr]) => ({ name, share, cvr })),
      pages: PAGES[kind].map(([name, views, entry]) => ({ name, views, entry })),
      campaigns: CAMPAIGNS[kind].map(([name, source, share]) => ({ name, source, share })),
      goals: GOALS[kind],
      funnel: FUNNELS[kind],
      journeys: JOURNEYS[kind]
    };
  }

  function dayVisitors(site, dayMs) {
    const idx = Math.round((dayMs - EPOCH) / DAY);
    const dow = new Date(dayMs).getUTCDay();
    const key = site.id + isoDay(dayMs);
    let v = site.base * Math.pow(1 + site.growth, idx) * WEEKLY[site.kind][dow] * jitter(key + "v", 0.09);
    const seasonal = 1 + 0.08 * Math.sin((idx / 365) * Math.PI * 2 + hash(site.id) % 7);
    v *= seasonal;
    if (rand(key + "spike") > 0.985) v *= 1.6 + rand(key + "spk2") * 0.8;
    return v;
  }

  // Report days are the viewer's calendar days, stored as UTC midnights; a
  // moment is stamped in the same frame so it lands in the right bucket.
  function clockMs(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  }

  function makeSite(seed) {
    return Object.assign({ empty: false }, seed);
  }

  function defaultSites() {
    return SITE_SEEDS.map(makeSite);
  }

  // A filter narrows visitors; dimension factors scale counts, conversion
  // multipliers tilt conversions so every breakdown still sums to its total.
  function filterFactors(site, prof, filters) {
    let visitors = 1;
    let cvr = 1;
    let sourceSet = null;
    let campaign = null;
    let page = null;
    for (const f of filters) {
      if (f.dim === "source") {
        sourceSet = new Set([f.value]);
      } else if (f.dim === "referrer") {
        const src = prof.sources.find((s) => s.referrers.some((r) => r[0] === f.value));
        if (src) {
          sourceSet = new Set([src.name]);
          visitors *= src.referrers.find((r) => r[0] === f.value)[1];
        } else visitors = 0;
      } else if (f.dim === "campaign") {
        const c = prof.campaigns.find((x) => x.name === f.value);
        if (c) {
          sourceSet = new Set([c.source]);
          visitors *= c.share;
          cvr *= 1.25;
          campaign = c;
        } else visitors = 0;
      } else if (f.dim === "page" || f.dim === "entry") {
        const p = prof.pages.find((x) => x.name === f.value);
        if (p) {
          visitors *= f.dim === "entry" ? p.entry : Math.min(1, p.views * site.ppv * 0.62);
          page = p;
        } else visitors = 0;
      } else {
        const list = f.dim === "country" ? prof.countries : f.dim === "device" ? prof.devices : prof.browsers;
        const row = list.find((x) => x.name === f.value);
        if (row) {
          visitors *= row.share;
          cvr *= row.cvr / weightedCvr(list);
        } else visitors = 0;
      }
    }
    return { visitors, cvr, sourceSet, campaign, page };
  }

  function weightedCvr(list) {
    return list.reduce((a, r) => a + r.share * r.cvr, 0);
  }

  function sourceCvrNorm(prof) {
    return prof.sources.reduce((a, s) => a + s.share * s.cvr, 0);
  }

  function blankTotals(prof) {
    const goals = {};
    for (const g of prof.goals) goals[g.id] = 0;
    return { visitors: 0, pageviews: 0, bounces: 0, durationSum: 0, revenue: 0, goals };
  }

  function addInto(into, part) {
    into.visitors += part.visitors;
    into.pageviews += part.pageviews;
    into.bounces += part.bounces;
    into.durationSum += part.durationSum;
    into.revenue += part.revenue;
    for (const k in part.goals) into.goals[k] += part.goals[k];
  }

  // Per-source contributions for one day (or hour fraction). The atomic unit
  // every series, total and breakdown is assembled from.
  function sliceBySource(site, prof, dayMs, fraction, factors, purchaseGoal) {
    const total = dayVisitors(site, dayMs) * fraction;
    const key = site.id + isoDay(dayMs);
    const norm = sourceCvrNorm(prof);
    const out = [];
    let shareSum = 0;
    const shares = prof.sources.map((s) => {
      const sh = s.share * jitter(key + s.name, 0.12);
      shareSum += sh;
      return sh;
    });
    prof.sources.forEach((s, i) => {
      if (factors.sourceSet && !factors.sourceSet.has(s.name)) return;
      const visitors = (total * shares[i]) / shareSum * factors.visitors;
      const goals = {};
      let revenue = 0;
      for (const g of prof.goals) {
        const n = visitors * g.rate * (s.cvr / norm) * factors.cvr * jitter(key + s.name + g.id, 0.15);
        goals[g.id] = n;
        if (g.id === purchaseGoal) revenue = n * site.aov * s.aov * jitter(key + s.name + "aov", 0.1);
      }
      const ppv = site.ppv * jitter(key + "ppv", 0.06) * (factors.page ? 1.15 : 1);
      const bounceRate = Math.min(0.92, site.bounce * jitter(key + s.name + "b", 0.1) * (s.kind === "Social" ? 1.18 : 1));
      const duration = site.duration * jitter(key + s.name + "d", 0.12) * (s.kind === "Email" ? 1.2 : 1);
      out.push({ source: s, visitors, pageviews: visitors * ppv, bounces: visitors * bounceRate, durationSum: visitors * duration, revenue, goals });
    });
    return out;
  }

  function finalize(t) {
    return {
      visitors: t.visitors,
      pageviews: t.pageviews,
      bounceRate: t.visitors ? t.bounces / t.visitors : 0,
      duration: t.visitors ? t.durationSum / t.visitors : 0,
      conversions: Object.values(t.goals).reduce((a, b) => a + b, 0),
      revenue: t.revenue,
      goals: t.goals
    };
  }

  function rangeBounds(range, todayMs, custom) {
    const end = todayMs;
    switch (range) {
      case "today": return { start: end, end, days: 1 };
      case "7d": return { start: end - 6 * DAY, end, days: 7 };
      case "30d": return { start: end - 29 * DAY, end, days: 30 };
      case "90d": return { start: end - 89 * DAY, end, days: 90 };
      case "12m": return { start: end - 364 * DAY, end, days: 365 };
      case "custom": {
        const s = Date.parse(custom.from + "T00:00:00Z");
        const e = Date.parse(custom.to + "T00:00:00Z");
        return { start: s, end: e, days: Math.round((e - s) / DAY) + 1 };
      }
      default: return { start: end - 29 * DAY, end, days: 30 };
    }
  }

  function compareBounds(b, mode) {
    if (mode === "prev") return { start: b.start - b.days * DAY, end: b.start - DAY, days: b.days };
    if (mode === "year") return { start: b.start - 364 * DAY, end: b.end - 364 * DAY, days: b.days };
    return null;
  }

  function granularity(days) {
    if (days === 1) return "hour";
    if (days <= 92) return "day";
    return "week";
  }

  // A website added in the demo has no seeded history: it reports exactly the
  // sample pageviews it has received, each one a single-page visit.
  function collectVisits(site, bounds, filters, opts) {
    const prof = profile(site);
    const gran = granularity(bounds.days);
    const endMs = bounds.end + DAY;
    const visits = site.visits.filter((v) => v.at >= bounds.start && v.at < endMs && filters.every((f) => visitValue(v, f.dim) === f.value));
    const buckets = [];
    if (gran === "hour") {
      for (let h = 0; h <= 23; h++) buckets.push({ start: bounds.start + h * 3600000, label: h, future: bounds.end === opts.todayMs && h > opts.nowHour, n: 0 });
      for (const v of visits) buckets[new Date(v.at).getUTCHours()].n++;
    } else {
      const size = gran === "week" ? 7 * DAY : DAY;
      for (let d = bounds.start; d <= bounds.end; d += size) buckets.push({ start: d, n: 0 });
      for (const v of visits) buckets[Math.min(buckets.length - 1, Math.floor((v.at - bounds.start) / size))].n++;
    }
    const goals = {};
    for (const g of prof.goals) goals[g.id] = 0;
    const fin = (n) => ({ visitors: n, pageviews: n, bounceRate: n ? 1 : 0, duration: 0, conversions: 0, revenue: 0, goals: Object.assign({}, goals) });
    return {
      gran,
      prof,
      manual: true,
      visits,
      purchase: (prof.goals.find((g) => g.revenue) || {}).id,
      totals: fin(visits.length),
      buckets: buckets.map((b) => Object.assign({ start: b.start, label: b.label, future: !!b.future }, fin(b.n))),
      bySource: new Map()
    };
  }

  function visitValue(v, dim) {
    if (dim === "page" || dim === "entry") return v.page;
    return { source: "Direct", referrer: "Direct or unknown", campaign: null, country: "Unknown", device: "Desktop", browser: "Chrome" }[dim];
  }

  function collect(site, bounds, filters, opts) {
    if (site.visits) return collectVisits(site, bounds, filters, opts);
    const prof = profile(site);
    const factors = filterFactors(site, prof, filters);
    const purchase = (prof.goals.find((g) => g.revenue) || {}).id;
    const gran = granularity(bounds.days);
    const nowHour = opts.nowHour;
    const buckets = [];
    const totals = blankTotals(prof);
    const bySource = new Map();
    const createdMs = Date.parse(site.created + "T00:00:00Z");

    const byEntry = new Map(prof.pages.filter((p) => p.entry > 0).map((p) => [p.name, { visitors: 0, conversions: 0, revenue: 0 }]));
    const byPage = new Map(prof.pages.map((p) => [p.name, { pageviews: 0, visitors: 0 }]));
    const pushSlices = (bucket, slices, dayKey) => {
      for (const sl of slices) {
        addInto(bucket.t, sl);
        addInto(totals, sl);
        if (!bySource.has(sl.source.name)) bySource.set(sl.source.name, { source: sl.source, t: blankTotals(prof) });
        addInto(bySource.get(sl.source.name).t, sl);
        splitPages(site, prof, sl, dayKey, byEntry, byPage);
      }
    };

    if (gran === "hour") {
      const lastHour = bounds.end === opts.todayMs ? nowHour : 23;
      for (let h = 0; h <= 23; h++) {
        const bucket = { start: bounds.start + h * 3600000, label: h, t: blankTotals(prof), future: h > lastHour };
        if (!site.empty && !bucket.future && bounds.start >= createdMs) {
          const frac = (HOURLY[h] / HOURLY_SUM) * jitter(site.id + isoDay(bounds.start) + "h" + h, 0.18);
          pushSlices(bucket, sliceBySource(site, prof, bounds.start, frac, factors, purchase), site.id + isoDay(bounds.start) + "h" + h);
        }
        buckets.push(bucket);
      }
    } else {
      let current = null;
      for (let d = bounds.start; d <= bounds.end; d += DAY) {
        if (!current || gran === "day" || (gran === "week" && current.count === 7)) {
          current = { start: d, t: blankTotals(prof), count: 0 };
          buckets.push(current);
        }
        current.count++;
        if (site.empty || d < createdMs) continue;
        const frac = d === opts.todayMs ? hourFraction(nowHour) : 1;
        pushSlices(current, sliceBySource(site, prof, d, frac, factors, purchase), site.id + isoDay(d));
      }
    }

    return {
      gran,
      prof,
      factors,
      purchase,
      totals: finalize(totals),
      buckets: buckets.map((b) => Object.assign({ start: b.start, label: b.label, future: !!b.future }, finalize(b.t))),
      bySource,
      byEntry,
      byPage
    };
  }

  // Each page has its own seeded pull per source, conversion strength and
  // basket size, so page rows differ while still adding up to the slice.
  function pageTraits(site, source, page) {
    const k = site.id + page.name;
    return {
      tilt: 0.55 + rand(k + source.name + "tilt") * 0.9,
      cvr: 0.35 + rand(k + "cvr") * 1.5,
      aov: 0.75 + rand(k + "aov") * 0.6,
      depth: 1.15 + rand(k + "depth") * 0.9
    };
  }

  function splitPages(site, prof, sl, dayKey, byEntry, byPage) {
    const conversions = Object.values(sl.goals).reduce((a, b) => a + b, 0);
    const entries = [];
    let sw = 0, sc = 0, sr = 0;
    const views = [];
    let sv = 0;
    for (const p of prof.pages) {
      const tr = pageTraits(site, sl.source, p);
      const v = p.views * tr.tilt * jitter(dayKey + p.name + "v", 0.2);
      views.push([p, v, tr]);
      sv += v;
      if (p.entry > 0) {
        const w = p.entry * tr.tilt * jitter(dayKey + p.name + "e", 0.25);
        const c = w * tr.cvr;
        const r = c * tr.aov;
        entries.push([p, w, c, r]);
        sw += w; sc += c; sr += r;
      }
    }
    for (const [p, w, c, r] of entries) {
      const row = byEntry.get(p.name);
      row.visitors += (sl.visitors * w) / sw;
      if (sc) row.conversions += (conversions * c) / sc;
      if (sr) row.revenue += (sl.revenue * r) / sr;
    }
    for (const [p, v, tr] of views) {
      const row = byPage.get(p.name);
      const pv = (sl.pageviews * v) / sv;
      row.pageviews += pv;
      row.visitors += pv / tr.depth;
    }
  }

  function hourFraction(nowHour) {
    let s = 0;
    for (let h = 0; h <= nowHour; h++) s += HOURLY[h];
    return s / HOURLY_SUM;
  }

  function distribute(total, rows, key) {
    const weightSum = rows.reduce((a, r) => a + r.w, 0) || 1;
    return rows.map((r) => Object.assign({}, r, { [key]: (total * r.w) / weightSum }));
  }

  function breakdown(site, result, dim, filters) {
    if (result.manual) {
      const counts = new Map();
      for (const v of result.visits) {
        const name = visitValue(v, dim);
        if (name != null) counts.set(name, (counts.get(name) || 0) + 1);
      }
      return [...counts].map(([name, n]) => ({ name, visitors: n, pageviews: n, conversions: 0, purchases: 0, revenue: 0 })).sort((a, b) => b.visitors - a.visitors);
    }
    const prof = result.prof;
    const t = result.totals;
    const active = filters.find((f) => f.dim === dim);
    const purchaseRate = (r) => r.cvr;
    let rows;

    if (dim === "source") {
      rows = [...result.bySource.values()].map(({ source, t: st }) => {
        const fin = finalize(st);
        return { name: source.name, note: source.kind, visitors: fin.visitors, conversions: fin.conversions, purchases: result.purchase ? fin.goals[result.purchase] : 0, revenue: fin.revenue, bounceRate: fin.bounceRate };
      });
    } else if (dim === "referrer") {
      rows = [];
      for (const { source, t: st } of result.bySource.values()) {
        const fin = finalize(st);
        for (const [name, share] of source.referrers) {
          if (active && active.value !== name) continue;
          const w = active ? 1 : share;
          rows.push({ name, note: source.name, visitors: fin.visitors * w, conversions: fin.conversions * w, revenue: fin.revenue * w });
        }
      }
    } else if (dim === "campaign") {
      rows = [];
      for (const c of prof.campaigns) {
        if (active && active.value !== c.name) continue;
        const src = result.bySource.get(c.source);
        if (!src) continue;
        const fin = finalize(src.t);
        const w = active ? 1 : c.share;
        rows.push({ name: c.name, note: c.source, visitors: fin.visitors * w, conversions: fin.conversions * w * 1.25, revenue: fin.revenue * w * 1.25 });
      }
    } else if ((dim === "page" || dim === "entry") && active) {
      rows = [{ name: active.value, visitors: t.visitors, pageviews: t.pageviews, conversions: t.conversions, revenue: t.revenue }];
    } else if (dim === "entry") {
      rows = [...result.byEntry].map(([name, r]) => Object.assign({ name }, r));
    } else if (dim === "page") {
      rows = [...result.byPage].map(([name, r]) => ({ name, pageviews: r.pageviews, visitors: Math.min(t.visitors, r.visitors) }));
    } else {
      const list = dim === "country" ? prof.countries : dim === "device" ? prof.devices : prof.browsers;
      const base = list.filter((r) => !active || r.name === active.value).map((r) => ({ name: r.name, w: r.share, cvr: r.cvr }));
      const v = distribute(t.visitors, base, "visitors");
      const conv = distribute(t.conversions, base.map((r) => ({ name: r.name, w: r.w * purchaseRate(r) })), "conversions");
      const rev = distribute(t.revenue, base.map((r) => ({ name: r.name, w: r.w * purchaseRate(r) })), "revenue");
      rows = v.map((r, i) => ({ name: r.name, visitors: r.visitors, conversions: conv[i].conversions, revenue: rev[i].revenue }));
    }

    const sortKey = dim === "page" ? "pageviews" : "visitors";
    const isRest = (r) => r.name === "Other" || r.name === "Other pages";
    rows.sort((a, b) => isRest(a) - isRest(b) || b[sortKey] - a[sortKey]);
    return rows;
  }

  function funnel(result) {
    const f = result.prof.funnel;
    if (result.manual) return { name: f.name, steps: f.steps.map((name) => ({ name, count: 0 })) };
    const visitors = result.totals.visitors;
    const last = result.purchase ? result.totals.goals[result.purchase] : 0;
    const counts = [visitors * f.shape[0]];
    const tail = f.shape.slice(1);
    while (tail.length < f.steps.length - 1) tail.push(0.5);
    const product = tail.reduce((a, b) => a * b, 1);
    const scale = counts[0] > 0 && last > 0 ? Math.pow(last / (counts[0] * product), 1 / tail.length) : 1;
    for (const r of tail) counts.push(counts[counts.length - 1] * Math.min(0.98, r * scale));
    counts[counts.length - 1] = Math.min(counts[counts.length - 2] || 0, last);
    return { name: f.name, steps: f.steps.map((name, i) => ({ name, count: counts[i] })) };
  }

  function journeys(result) {
    const conv = result.purchase ? result.totals.goals[result.purchase] : 0;
    return result.prof.journeys.map(([path, share]) => ({ path, conversions: conv * share })).sort((a, b) => b.conversions - a.conversions);
  }

  // Live activity: deterministic for a given second so reloads look stable.
  const EVENT_KINDS = ["pageview", "pageview", "pageview", "pageview", "pageview", "goal", "pageview", "pageview"];

  function liveVisitors(site, now) {
    if (site.visits) return site.visits.filter((v) => clockMs(now) - v.at < 5 * 60000).length;
    if (site.empty) return 0;
    const dayMs = dayStart(now);
    const perMinute = (dayVisitors(site, dayMs) * HOURLY[now.getHours()]) / HOURLY_SUM / 60;
    return Math.max(1, Math.round(perMinute * 4.2 * jitter(site.id + Math.floor(now.getTime() / 15000), 0.12)));
  }

  function liveEvent(site, seq) {
    const prof = profile(site);
    const key = site.id + "live" + seq;
    const pick = (list, k, weight) => {
      const r = rand(key + k);
      let acc = 0;
      const sum = list.reduce((a, x) => a + weight(x), 0);
      for (const x of list) {
        acc += weight(x) / sum;
        if (r <= acc) return x;
      }
      return list[list.length - 1];
    };
    const source = pick(prof.sources, "s", (s) => s.share);
    const country = pick(prof.countries, "c", (c) => c.share);
    const device = pick(prof.devices, "d", (d) => d.share);
    const page = pick(prof.pages.filter((p) => p.name !== "Other pages"), "p", (p) => p.views);
    let kind = EVENT_KINDS[Math.floor(rand(key + "k") * EVENT_KINDS.length)];
    let goal = null;
    let revenue = 0;
    if (kind === "goal") {
      goal = pick(prof.goals, "g", (g) => g.rate);
      if (goal.revenue) {
        kind = "revenue";
        revenue = Math.round(site.aov * source.aov * jitter(key + "r", 0.35));
      }
    }
    const sessionId = "s" + (hash(key + "sess") % 97);
    return { seq, kind, source: source.name, country: country.name, device: device.name, page: page.name, goal: goal && goal.name, revenue, sessionId };
  }

  function sessionTimeline(site, sessionId, endMs) {
    const prof = profile(site);
    const key = site.id + sessionId;
    const steps = 3 + Math.floor(rand(key + "n") * 4);
    const journey = prof.journeys[hash(key) % prof.journeys.length][0];
    const pages = prof.pages.filter((p) => p.name !== "Other pages");
    const events = [];
    let t = endMs - steps * 52000;
    for (let i = 0; i < steps; i++) {
      const path = journey[i] || pages[hash(key + i) % pages.length].name;
      events.push({ at: t, kind: "pageview", label: path });
      t += 25000 + Math.floor(rand(key + "t" + i) * 60000);
    }
    const goal = prof.goals[hash(key + "g") % prof.goals.length];
    if (rand(key + "conv") > 0.45) events.push({ at: t, kind: goal.revenue ? "revenue" : "goal", label: goal.name, revenue: goal.revenue ? Math.round(site.aov * jitter(key + "rv", 0.3)) : 0 });
    const source = prof.sources[hash(key + "src") % prof.sources.length];
    const country = prof.countries[hash(key + "cty") % (prof.countries.length - 1)];
    const device = prof.devices[hash(key + "dev") % prof.devices.length];
    return { id: sessionId, source: source.name, country: country.name, device: device.name, events };
  }

  function query(site, opts) {
    const b = rangeBounds(opts.range, opts.todayMs, opts.custom);
    const filters = opts.filters || [];
    const main = collect(site, b, filters, opts);
    const cb = compareBounds(b, opts.compare);
    const prev = cb ? collect(site, cb, filters, opts) : null;
    return { bounds: b, compareBounds: cb, main, prev };
  }

  const api = { DAY, clockMs, DIMENSIONS, defaultSites, makeSite, profile, query, breakdown, funnel, journeys, liveVisitors, liveEvent, sessionTimeline, rangeBounds, dayStart, isoDay, hash, rand };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PDData = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
