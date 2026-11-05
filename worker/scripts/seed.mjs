import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { classifySource } from "../src/ingest.ts";
import { INSERT_SITE, siteRowValues, STARTERS } from "../src/sites.ts";

const require = createRequire(import.meta.url);
const D = require("../../demo/js/data.js");

const DAY = 86_400_000;
const DAYS = 90;
const scale = Number(process.env.SEED_SCALE ?? 0.05);
if (!(scale > 0 && scale <= 1)) throw new Error("SEED_SCALE must be a number in (0, 1]");
const seedDate = process.env.SEED_DATE;
const now = seedDate ? Date.parse(`${seedDate}T23:59:59.999Z`) : Date.now();
if (Number.isNaN(now)) throw new Error("SEED_DATE must be YYYY-MM-DD");
const today = Math.floor(now / DAY) * DAY;
const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = process.env.SEED_OUTPUT_DIR ?? `${root}.wrangler/seed`;
const wrangler = `${root}node_modules/.bin/wrangler`;

const HOURLY = [0.22, 0.15, 0.11, 0.09, 0.1, 0.16, 0.33, 0.6, 0.86, 1.03, 1.12, 1.16, 1.2, 1.18, 1.14, 1.12, 1.1, 1.08, 1.15, 1.32, 1.42, 1.3, 0.92, 0.5];
const REFERRER_URLS = {
  Google: "https://www.google.com/",
  Bing: "https://www.bing.com/",
  DuckDuckGo: "https://duckduckgo.com/",
  Instagram: "https://www.instagram.com/",
  "Instagram stories": "https://l.instagram.com/",
  Pinterest: "https://www.pinterest.com/",
  LinkedIn: "https://www.linkedin.com/",
  "github.com": "https://github.com/",
  "homeandhearth.example": "https://homeandhearth.example/journal",
  "launchboard.example": "https://launchboard.example/tools",
  "toolfinder.example": "https://toolfinder.example/",
  "Developer forum": "https://forum.devtalk.example/t/1",
  "Q&A sites": "https://stackoverflow.com/questions",
};
const UTM_SOURCES = { Newsletter: "newsletter", "Search ads": "Search ads", "Podcast show notes": "Podcast" };
const LONG_TAIL = {
  store: ["/faq", "/contact", "/shop/gifts", "/journal/care-guide", "/returns"],
  docs: ["/docs/cli", "/docs/accessibility", "/docs/faq", "/blog/v3-released", "/docs/api/hooks"],
  saas: ["/about", "/security", "/integrations", "/blog/hiring-guide", "/features/notes"],
};
const MORE_COUNTRIES = ["Spain", "Italy", "Sweden", "Japan", "Brazil", "India", "Mexico", "Poland", "Belgium", "Switzerland", "Portugal", "Norway"];

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const lit = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

function picker(key) {
  const r = (k) => D.rand(`${key}|${k}`);
  const pick = (list, weight, k) => {
    const total = list.reduce((a, x) => a + weight(x), 0);
    let acc = 0;
    const target = r(k) * total;
    for (const x of list) {
      acc += weight(x);
      if (target < acc) return x;
    }
    return list[list.length - 1];
  };
  return { r, pick };
}

function dailyVisitors(site) {
  const from = D.isoDay(today - (DAYS - 1) * DAY);
  const result = D.query(site, { range: "custom", custom: { from, to: D.isoDay(today) }, compare: null, todayMs: today, nowHour: 23, filters: [] });
  const days = result.main.buckets;
  const norm = site.base / (days.reduce((a, b) => a + b.visitors, 0) / days.length);
  return days.map((b) => ({ dayMs: b.start, visitors: b.visitors * norm }));
}

function sessionEvents(site, prof, starter, dayMs, index) {
  const day = D.isoDay(dayMs);
  const key = `${site.id}|${day}|${index}`;
  const { r, pick } = picker(key);
  const realPath = (name, k) => (name === "Other pages" ? LONG_TAIL[site.kind][Math.floor(r(k) * LONG_TAIL[site.kind].length)] : name);

  const src = pick(prof.sources, (s) => s.share, "src");
  const [refLabel] = pick(src.referrers, (x) => x[1], "ref");
  let country = pick(prof.countries, (c) => c.share, "country").name;
  if (country === "Other") {
    const spare = MORE_COUNTRIES.filter((c) => !prof.countries.some((x) => x.name === c));
    country = spare[Math.floor(r("country2") * spare.length)];
  }
  const device = pick(prof.devices, (d) => d.share, "device").name;
  const browser = pick(prof.browsers, (b) => b.share, "browser").name;
  const campaign = prof.campaigns.find((c, i) => c.source === src.name && r(`camp${i}`) < c.share)?.name;

  const revenueGoal = prof.goals.find((g) => g.revenue);
  const otherGoals = prof.goals.filter((g) => !g.revenue);
  const engaged = 1 - site.bounce;
  const steps = [];

  if (r("buy") < revenueGoal.rate * src.cvr) {
    const [journey] = pick(prof.journeys, (j) => j[1], "journey");
    const funnelGoals = starter.funnel.steps.map((s) => s.match.goal).filter((g) => g && g !== revenueGoal.id);
    journey.forEach((p, i) => {
      if (i === journey.length - 1) for (const g of funnelGoals) steps.push({ goal: g });
      steps.push({ page: p });
    });
    steps.push({ goal: revenueGoal.id, revenue: Math.round(site.aov * src.aov * (0.7 + 0.6 * r("aov")) * 100) / 100 });
  } else {
    const entries = prof.pages.filter((p) => p.entry > 0);
    steps.push({ page: realPath(pick(entries, (p) => p.entry, "entry").name, "entry2") });
    if (r("bounce") >= site.bounce) {
      const extra = 1 + Math.floor(-Math.log(1 - r("depth")) * Math.max(0.5, (site.ppv - site.bounce) / engaged - 2));
      for (let i = 0; i < extra; i++) {
        const next = realPath(pick(prof.pages, (p) => p.views, `page${i}`).name, `tail${i}`);
        if (next !== steps[steps.length - 1].page) steps.push({ page: next });
      }
      for (const g of otherGoals) {
        if (r(`goal-${g.id}`) < (g.rate * src.cvr) / engaged) {
          steps.splice(1 + Math.floor(r(`at-${g.id}`) * (steps.length - 1)), 0, { goal: g.id });
        }
      }
    }
  }

  const span = steps.length > 1 ? (site.duration / engaged) * (0.4 + 1.2 * r("span")) * 1000 : 0;
  const gap = steps.length > 1 ? span / (steps.length - 1) : 0;
  const hour = pick(HOURLY.map((w, h) => ({ w, h })), (x) => x.w, "hour").h;
  let start = dayMs + hour * 3_600_000 + Math.floor(r("minute") * 3_600_000);
  const end = Math.ceil(span) + steps.length;
  if (start + end > now) return [];
  start = Math.max(dayMs, Math.min(start, dayMs + DAY - 1 - end));

  const entryPath = steps.find((s) => s.page)?.page ?? "/";
  const landing = new URL(`https://${site.domain}${entryPath}`);
  const utm = UTM_SOURCES[refLabel];
  if (utm) landing.searchParams.set("utm_source", utm);
  if (campaign) landing.searchParams.set("utm_campaign", campaign);
  const referrer = REFERRER_URLS[refLabel] ? new URL(REFERRER_URLS[refLabel]) : null;
  const origin = classifySource(landing, referrer, site.domain);

  const visitorId = sha(`seed|${key}`);
  const sessionId = sha(`${visitorId}|${day}`);
  let lastPage = entryPath;
  return steps.map((s, i) => {
    if (s.page) lastPage = s.page;
    return [
      site.id, Math.round(start + i * gap + i), day, s.page ? "pageview" : "event", s.goal ?? null, lastPage, entryPath,
      origin.referrerHost, origin.source, origin.campaign, country, device, browser, visitorId, sessionId, s.revenue ?? 0,
    ];
  });
}

const sites = D.defaultSites();
const lines = [`DELETE FROM events WHERE site_id IN (${sites.map((s) => lit(s.id)).join(", ")});`, `DELETE FROM sites WHERE id IN (${sites.map((s) => lit(s.id)).join(", ")});`];
let total = 0;

for (const site of sites) {
  const values = siteRowValues({ id: site.id, name: site.name, domain: site.domain, kind: site.kind, currency: site.currency, timezone: site.timezone, created: site.created });
  let position = 0;
  lines.push(`${INSERT_SITE.replace(/\?/g, () => lit(values[position++]))};`);

  const prof = D.profile(site);
  const rows = [];
  for (const { dayMs, visitors } of dailyVisitors(site)) {
    const exact = visitors * scale;
    const count = Math.floor(exact) + (D.rand(`${site.id}|${dayMs}|n`) < exact % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) rows.push(...sessionEvents(site, prof, STARTERS[site.kind], dayMs, i));
  }
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((row) => `(${row.map(lit).join(", ")})`);
    lines.push(
      `INSERT INTO events (site_id, at, day, type, name, path, entry_path, referrer_host, source, campaign, country, device, browser, visitor_id, session_id, revenue) VALUES\n${chunk.join(",\n")};`,
    );
  }
  total += rows.length;
  console.log(`${site.id}: ${rows.length} events`);
}

mkdirSync(outDir, { recursive: true });
const file = `${outDir}/seed.sql`;
writeFileSync(file, `${lines.join("\n")}\n`);
execFileSync(wrangler, ["d1", "execute", "postdeploy-analytics", "--local", "--file", file, ...(process.env.SEED_PERSIST_TO ? ["--persist-to", process.env.SEED_PERSIST_TO] : [])], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
console.log(`Seeded ${total} events for ${sites.length} sites (scale ${scale}).`);
