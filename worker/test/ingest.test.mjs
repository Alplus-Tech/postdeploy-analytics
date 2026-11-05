import assert from "node:assert/strict";
import test from "node:test";
import { browserOf, classifySource, deviceOf, ingest, isBot, originAllowed, parseEvent, readLimitedText } from "../src/ingest.ts";
import { addSite, memorySql } from "./sqlite.mjs";

const IP = "203.0.113.77";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const NOW = Date.UTC(2026, 10, 4, 12);
const base = { site: "shop", type: "pageview", url: "https://shop.example/products/mug?utm_campaign=autumn&ref=x" };

const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);

test("event validation rejects malformed input", async () => {
  for (const body of [
    null,
    [],
    "pageview",
    { ...base, site: "Not An Id" },
    { ...base, type: "click" },
    { ...base, url: "javascript:alert(1)" },
    { ...base, url: `https://shop.example/${"a".repeat(2100)}` },
    { ...base, referrer: 42 },
    { ...base, name: "purchase" },
    { ...base, type: "event" },
    { ...base, type: "event", name: "Bad-Name" },
    { ...base, type: "event", name: "purchase", revenue: -1 },
    { ...base, type: "event", name: "purchase", revenue: 1_000_001 },
    { ...base, type: "event", name: "purchase", revenue: "10" },
    { ...base, ip: IP },
  ]) {
    rejects(() => parseEvent(body), 400);
  }
  const ok = parseEvent({ ...base, type: "event", name: "purchase", revenue: 49.499, referrer: "android-app://x" });
  assert.equal(ok.revenue, 49.5);
  assert.equal(ok.referrer, null);
  await assert.rejects(readLimitedText(new Blob(["x".repeat(4097)]).stream(), 4096), (e) => e.status === 413);
});

test("user agents and referrers are classified", () => {
  assert.equal(deviceOf(UA), "Mobile");
  assert.equal(browserOf(UA), "Chrome");
  const ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  assert.deepEqual([deviceOf(ipad), browserOf(ipad)], ["Tablet", "Safari"]);
  const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
  assert.deepEqual([deviceOf(edge), browserOf(edge)], ["Desktop", "Edge"]);
  assert.equal(browserOf("Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36"), "Samsung Internet");
  assert.ok(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"));
  assert.ok(isBot("curl/8.5.0"));
  assert.ok(!isBot(UA));

  const page = new URL("https://shop.example/?utm_source=newsletter&utm_campaign=autumn");
  assert.deepEqual(classifySource(page, new URL("https://www.google.co.uk/"), "shop.example"), { source: "Newsletter", referrerHost: "google.co.uk", campaign: "autumn" });
  assert.equal(classifySource(new URL("https://shop.example/"), new URL("https://www.google.co.uk/"), "shop.example").source, "Google");
  assert.equal(classifySource(new URL("https://shop.example/"), new URL("https://blog.friend.example/post"), "shop.example").source, "blog.friend.example");
  assert.equal(classifySource(new URL("https://shop.example/"), new URL("https://www.shop.example/"), ["shop.example", "www.shop.example"]).source, "Direct");
  assert.equal(classifySource(new URL("https://shop.example/"), null, "shop.example").source, "Direct");
});

test("ingestion derives a session and never stores the IP address or user agent", async () => {
  const { sql, db } = memorySql();
  await addSite(sql, "shop", "shop.example", "store");
  const request = (event, extra = {}) => ({ event: parseEvent(event), ip: IP, userAgent: UA, countryCode: "GB", origin: "https://shop.example", doNotTrack: false, now: NOW, development: false, ...extra });

  assert.equal(await ingest(sql, request({ ...base, referrer: "https://www.google.com/" })), "stored");
  assert.equal(await ingest(sql, request({ ...base, url: "https://shop.example/checkout", referrer: "https://shop.example/products/mug" }, { now: NOW + 30_000 })), "stored");
  assert.equal(await ingest(sql, request({ ...base, type: "event", name: "purchase", revenue: 20 }, { now: NOW + 60_000 })), "stored");
  assert.equal(await ingest(sql, request(base, { userAgent: "Mozilla/5.0 (compatible; bingbot/2.0)" })), "dropped");
  await assert.rejects(ingest(sql, request({ ...base, site: "missing" })), (e) => e.status === 404);
  await assert.rejects(ingest(sql, request({ ...base, type: "event", name: "unknown_goal" })), (e) => e.status === 400);

  const rows = db.prepare("SELECT * FROM events ORDER BY at").all();
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => [r.path, r.entry_path, r.source, r.referrer_host, r.campaign, r.country, r.device, r.browser, r.revenue]),
    [
      ["/products/mug", "/products/mug", "Google", "google.com", "autumn", "United Kingdom", "Mobile", "Chrome", 0],
      ["/checkout", "/products/mug", "Google", "google.com", "autumn", "United Kingdom", "Mobile", "Chrome", 0],
      ["/products/mug", "/products/mug", "Google", "google.com", "autumn", "United Kingdom", "Mobile", "Chrome", 20],
    ],
  );
  assert.equal(new Set(rows.map((r) => r.session_id)).size, 1);
  assert.match(rows[0].visitor_id, /^[0-9a-f]{32}$/);

  const columns = db.prepare("SELECT name FROM pragma_table_info('events')").all().map((c) => c.name);
  assert.ok(!columns.some((c) => /ip|agent|ua$/.test(c)), columns.join());
  const everything = JSON.stringify(["events", "sites", "salts"].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
  assert.ok(!everything.includes(IP) && !everything.includes("203.0.113") && !everything.includes("Pixel 8"));
});

test("origin rule requires exact configured hosts, except in development", async () => {
  assert.ok(originAllowed("https://shop.example", "shop.example", false));
  assert.ok(!originAllowed("https://www.shop.example:8443", "shop.example", false));
  assert.ok(originAllowed(null, "shop.example", false));
  assert.ok(originAllowed("null", "shop.example", false));
  assert.ok(!originAllowed("https://evil.example", "shop.example", false));
  assert.ok(!originAllowed("https://shop.example.evil.test", "shop.example", false));
  assert.ok(!originAllowed("https://notshop.example", "shop.example", false));
  assert.ok(!originAllowed("garbage", "shop.example", false));
  assert.ok(originAllowed("https://evil.example", "shop.example", true));

  const { sql } = memorySql();
  await addSite(sql, "shop", "shop.example", "store");
  const request = (origin, development) => ({ event: parseEvent(base), ip: IP, userAgent: UA, countryCode: "GB", origin, doNotTrack: false, now: NOW + 3_600_000, development });
  await assert.rejects(ingest(sql, request("https://evil.example", false)), (e) => e.status === 403 && e.code === "origin_not_allowed");
  assert.equal(await ingest(sql, request("https://evil.example", true)), "stored");
  await assert.rejects(ingest(sql, request("https://blog.shop.example", false)), e => e.status === 403);
});

test("visible activity is bounded, idempotent, page scoped and splits midnight without pageviews", async () => {
  const { sql, db } = memorySql();
  await addSite(sql, "shop", "shop.example", "store");
  const page = "a".repeat(32);
  const send = (body, now) => ingest(sql, { event: parseEvent({ ...base, ...body }), ip: IP, userAgent: UA, origin: null, countryCode: "GB", doNotTrack: false, development: false, now });
  const start = Date.UTC(2026,10,8,23,59,20);
  await send({page},start);
  await send({page},start+1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,1);
  await send({type:"activity",page,visible:30000}, start+30000);
  await send({type:"activity",page,visible:30000}, start+31000);
  await send({type:"activity",page,visible:20000}, start+32000);
  assert.equal(db.prepare('SELECT visible_ms FROM visits').get().visible_ms,30000);
  await send({type:"activity",page,visible:60000}, start+60000);
  await send({type:"activity",page,visible:90000}, start+90000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM visits').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,1);
  assert.equal(db.prepare('SELECT SUM(visible_ms) n FROM visits').get().n,60000);
  await send({type:"event", name:"purchase"},start+91000);
  const { buildReport, parseReportQuery } = await import('../src/report.ts');
  const { getSite } = await import('../src/sites.ts');
  const r = await buildReport(sql,await getSite(sql,'shop',start+92000),parseReportQuery(new URLSearchParams('site=shop&from=2026-11-08&to=2026-11-09')),start+92000);
  assert.deepEqual([r.main.totals.visits,r.main.totals.visitors,r.main.totals.pageviews,r.main.totals.bounces,r.main.totals.duration],[2,2,1,1,30]);
  await send({page:"b".repeat(32)}, start+1891000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM visits').get().n,3);
  assert.equal(new Set(db.prepare("SELECT visitor_id FROM visits WHERE day='2026-11-09'").all().map(r=>r.visitor_id)).size,1);
  await sql.run("UPDATE sites SET timezone='Europe/London' WHERE id='shop'");
  await send({},start+1901000);
  await sql.run("UPDATE sites SET timezone='UTC' WHERE id='shop'");
  await send({},start+1902000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM visits').get().n,5,'switching timezone back cannot reopen an earlier visit');
  await send({type:"activity",page:"b".repeat(32),visible:Number.MAX_SAFE_INTEGER}, start+1903000);
  assert.ok(db.prepare('SELECT MAX(visible_ms - (last_at-at)) n FROM visits').get().n<=0,'forged duration cannot exceed elapsed visit time');
  assert.throws(()=>send({type:"activity",page,visible:1.5},start+1904000),e=>e.status===400);
  const before = db.prepare('SELECT SUM(visible_ms) n FROM visits').get().n;
  await send({type:"activity",page:"f".repeat(32),visible:80000},start+1910000);
  assert.equal(db.prepare('SELECT SUM(visible_ms) n FROM visits').get().n,before);
});
