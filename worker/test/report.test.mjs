import assert from "node:assert/strict";
import test from "node:test";
import { buildReport, parseReportQuery } from "../src/report.ts";
import { getSite } from "../src/sites.ts";
import { addSite, memorySql } from "./sqlite.mjs";

const D1 = Date.UTC(2026, 10, 2, 10);
const D2 = Date.UTC(2026, 10, 3, 10);
const NOW = Date.UTC(2026, 10, 4, 12);
const S = 1000;

const SESSIONS = [
  { id: "s1", at: D1, source: "Google", country: "United Kingdom", device: "Mobile", browser: "Chrome",
    events: [[0, "/"], [60, "/products/mug"], [90, "/products/mug", "add_to_cart"], [120, "/checkout"], [150, "/checkout", "purchase", 50]] },
  { id: "s2", at: D1 + 3_600_000, source: "Direct", country: "United States", device: "Desktop", browser: "Firefox", events: [[0, "/products/mug"]] },
  { id: "s3", at: D1 + 7_200_000, source: "Google", country: "United States", device: "Desktop", browser: "Chrome",
    events: [[0, "/checkout"], [10, "/checkout", "add_to_cart"], [30, "/products/mug"]] },
  { id: "s4", at: D2, source: "Direct", country: "United Kingdom", device: "Mobile", browser: "Safari", events: [[0, "/"]] },
];

async function fixture() {
  const { sql } = memorySql();
  await addSite(sql, "shop", "shop.example", "store");
  for (const s of SESSIONS) {
    const entry = s.events[0][1];
    for (const [offset, path, goal, revenue] of s.events) {
      const at = s.at + offset * S;
      await sql.run(
        `INSERT INTO events (site_id, at, day, hour, type, name, path, entry_path, referrer_host, source, campaign, country, device, browser, visitor_id, session_id, revenue)
         VALUES ('shop', ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [at, new Date(at).toISOString().slice(0, 10), new Date(at).getUTCHours(), goal ? "event" : "pageview", goal ?? null, path, entry, s.source, s.country, s.device, s.browser, `v-${s.id}`, s.id, revenue ?? 0],
      );
    }
  }
  const site = await getSite(sql, "shop", NOW);
  return async (query) => buildReport(sql, site, parseReportQuery(new URLSearchParams({ site: "shop", ...query })), NOW);
}

const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0);

test("report totals, breakdowns, buckets, funnel and journeys match the known dataset", async () => {
  const report = await fixture();
  const r = await report({ from: "2026-11-02", to: "2026-11-03", cmpFrom: "2026-10-31", cmpTo: "2026-11-01" });
  const m = r.main;

  assert.equal(m.gran, "day");
  assert.deepEqual((({goalRates,convertedVisitorDays,conversionVisitorDays,conversionRate,...metrics})=>metrics)(m.totals), { visitors: 4, pageviews: 7, bounceRate: 0.5, duration: null, visits: 4, bounces: 2, measuredVisits: 0, visibleMs: 0, conversions: 3, revenue: 50, goals: { purchase: 1, add_to_cart: 2, newsletter: 0 } });
  for (const dim of ["source", "country", "device", "browser", "entry"]) {
    assert.equal(sum(m.breakdowns[dim], "visitors"), m.totals.visitors, `${dim} visitors`);
    assert.equal(sum(m.breakdowns[dim], "pageviews"), m.totals.pageviews, `${dim} pageviews`);
    assert.equal(sum(m.breakdowns[dim], "conversions"), m.totals.conversions, `${dim} conversions`);
    assert.equal(sum(m.breakdowns[dim], "revenue"), m.totals.revenue, `${dim} revenue`);
  }
  assert.deepEqual(m.breakdowns.entry.map((e) => [e.name, e.visitors]), [["/", 2], ["/checkout", 1], ["/products/mug", 1]]);
  assert.deepEqual(m.breakdowns.page.map((p) => [p.name, p.pageviews, p.visitors]), [["/products/mug", 3, 3], ["/", 2, 2], ["/checkout", 2, 2]]);
  assert.deepEqual((({goalRates,convertedVisitorDays,conversionVisitorDays,conversionRate,...metrics})=>metrics)(m.breakdowns.source.find((s) => s.name === "Google")), { name: "Google", note: "Search", visitors: 2, pageviews: 5, conversions: 3, purchases: 1, revenue: 50 });
  assert.deepEqual(m.buckets.map((b) => [b.visitors, b.pageviews, b.future]), [[3, 6, false], [1, 1, false]]);

  assert.deepEqual(m.funnel.steps.map((s) => s.count), [3, 1, 1, 1], "s3 added to cart before viewing a product");
  assert.deepEqual(m.journeys, [{ path: ["/", "/products/mug", "/checkout"], conversions: 1 }]);

  assert.equal(r.prev.buckets.length, m.buckets.length);
  assert.equal(r.prev.totals.visitors, 0);

  const day = await report({ from: "2026-11-02", to: "2026-11-02" });
  assert.equal(day.main.gran, "hour");
  assert.equal(day.main.buckets.length, 24);
  assert.deepEqual(day.main.buckets.slice(10, 13).map((b) => [b.label, b.visitors]), [[10, 1], [11, 1], [12, 1]]);
});

test("filters only narrow and keep whole visits", async () => {
  const report = await fixture();
  const all = (await report({ from: "2026-11-02", to: "2026-11-03" })).main.totals;
  const cases = [
    ["source:Google", 2, 5],
    ["page:/checkout", 2, 5],
    ["entry:/", 2, 4],
    ["device:Mobile|country:United Kingdom", 2, 4],
    ["browser:Opera", 0, 0],
  ];
  for (const [f, visitors, pageviews] of cases) {
    const t = (await report({ from: "2026-11-02", to: "2026-11-03", f })).main.totals;
    assert.deepEqual([t.visitors, t.pageviews], [visitors, pageviews], f);
    assert.ok(t.visitors <= all.visitors && t.conversions <= all.conversions && t.revenue <= all.revenue, f);
  }
  await assert.rejects(report({ from: "2026-11-02", to: "2026-11-03", f: "ip:1.2.3.4" }), (e) => e.status === 400);
  await assert.rejects(report({ from: "2026-11-03", to: "2026-11-02" }), (e) => e.status === 400);
});
