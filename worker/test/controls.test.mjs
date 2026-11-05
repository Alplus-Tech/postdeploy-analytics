import assert from "node:assert/strict";
import test from "node:test";
import { ingest, parseEvent, takeToken } from "../src/ingest.ts";
import { buildReport, parseReportQuery } from "../src/report.ts";
import { runRetention, monthsBefore } from "../src/retention.ts";
import { getSite, listSites } from "../src/sites.ts";
import { addSite, memorySql } from "./sqlite.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const hit = (sql, site, now, extra = {}, ip = "198.51.100.7") =>
  ingest(sql, {
    event: parseEvent({ site, type: "pageview", url: `https://${site}.example/`, ...extra }),
    ip, userAgent: UA, countryCode: "NL", origin: null, doNotTrack: false, now, development: false,
  });

test("days, hours, sessions and today follow the website's time zone", async () => {
  const { sql, db } = memorySql();
  await addSite(sql, "tokyo", "tokyo.example", "store", "Asia/Tokyo");
  await addSite(sql, "york", "york.example", "store", "America/New_York");
  const late = Date.UTC(2026, 10, 4, 23, 30);
  await hit(sql, "tokyo", late);
  await hit(sql, "york", late);
  const rows = db.prepare("SELECT site_id, day, hour FROM events ORDER BY site_id").all();
  assert.deepEqual(rows.map((r) => [r.site_id, r.day, r.hour]), [["tokyo", "2026-11-05", 8], ["york", "2026-11-04", 18]]);

  await hit(sql, "tokyo", Date.UTC(2026, 10, 5, 14, 30));
  assert.equal(db.prepare("SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE site_id = 'tokyo'").get().n, 2, "inactivity separates visits within the same local day");
  await hit(sql, "tokyo", Date.UTC(2026, 10, 5, 14, 40), {}, "198.51.100.8");
  const tokyo = await getSite(sql, "tokyo", late);

  const report = await buildReport(sql, tokyo, parseReportQuery(new URLSearchParams("site=tokyo&from=2026-11-05&to=2026-11-05")), Date.UTC(2026, 10, 5, 0, 10));
  const visited = report.main.buckets.filter((b) => b.pageviews > 0).map((b) => b.label);
  assert.deepEqual(visited, [8, 23]);
  assert.equal(report.main.buckets.findIndex((b) => b.future), 10, "09:10 in Tokyo: hours from 10:00 are still to come");
});

test("one visitor cannot flood a website", async () => {
  const { sql, db } = memorySql();
  await addSite(sql, "shop", "shop.example", "store");
  const start = Date.UTC(2026, 10, 4, 9);
  const outcomes = [];
  for (let i = 0; i < 40; i++) outcomes.push(await hit(sql, "shop", start + i * 100, { url: `https://shop.example/p${i}` }).catch((e) => e.status));
  assert.ok(outcomes.includes(429), "a burst from one visitor is slowed down");
  assert.ok(outcomes.filter((o) => o === "stored").length <= 30);

  for (let i = 0; i < 60; i++) await hit(sql, "shop", Date.UTC(2026, 10, 4, 10) + i * 10_000, { type: "event", name: "purchase", revenue: 10 }, "198.51.100.9");
  const goals = db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'event'").get().n;
  assert.equal(goals, 20, "goal events per visit are capped");
  assert.equal(db.prepare("SELECT SUM(revenue) AS r FROM events").get().r, 200);
});

test("retention deletes only events older than each website's setting", async () => {
  const { sql, db } = memorySql();
  await addSite(sql, "short", "short.example", "store");
  await addSite(sql, "forever", "forever.example", "store");
  await sql.run("UPDATE sites SET retention_months = 6 WHERE id = 'short'");
  await sql.run("UPDATE sites SET retention_months = 0 WHERE id = 'forever'");
  const insert = db.prepare("INSERT INTO events (site_id, at, day, hour, type, path, source, country, device, browser, visitor_id, session_id) VALUES (?, 0, ?, 0, 'pageview', '/', 'Direct', 'NL', 'Desktop', 'Safari', 'v', 's')");
  for (const site of ["short", "forever"]) for (const day of ["2025-01-10", "2026-05-03", "2026-05-04", "2026-11-01"]) insert.run(site, day);
  db.prepare("INSERT INTO salts (day, value) VALUES ('2026-10-30', 'old'), ('2026-11-03', 'recent')").run();

  const result = await runRetention(sql, Date.UTC(2026, 10, 4, 3));
  assert.equal(result.deleted, 2);
  assert.equal(result.sites, 1);
  assert.equal(result.pendingSites, 0);
  const left = (site) => db.prepare("SELECT day FROM events WHERE site_id = ? ORDER BY day").all(site).map((r) => r.day);
  assert.deepEqual(left("short"), ["2026-05-04", "2026-11-01"]);
  assert.deepEqual(left("forever"), ["2025-01-10", "2026-05-03", "2026-05-04", "2026-11-01"]);
  assert.deepEqual(db.prepare("SELECT day FROM salts").all().map((r) => r.day), ["2026-11-03"]);
});

test("the websites list counts the same 30 local days as the report", async () => {
  const { sql, db } = memorySql();
  await addSite(sql, "tokyo", "tokyo.example", "store", "Asia/Tokyo");
  const now = Date.UTC(2026, 10, 4, 17);
  const insert = db.prepare("INSERT INTO events (site_id, at, day, hour, type, path, source, country, device, browser, visitor_id, session_id) VALUES ('tokyo', 0, ?, 9, 'pageview', '/', 'Direct', 'JP', 'Desktop', 'Safari', ?, ?)");
  insert.run("2026-10-06", "outside", "s-outside");
  insert.run("2026-10-07", "first-day", "s-first");
  insert.run("2026-11-05", "today", "s-today");
  const report = await buildReport(sql, await getSite(sql, "tokyo", now), parseReportQuery(new URLSearchParams("site=tokyo&from=2026-10-07&to=2026-11-05")), now);
  const listed = (await listSites(sql, now)).find((s) => s.id === "tokyo");
  assert.equal(report.main.totals.visitors, 2);
  assert.equal(listed.visitors30d, report.main.totals.visitors);
  assert.equal((await getSite(sql, "tokyo", now)).visitors30d, report.main.totals.visitors);
});


test("shared atomic collection admission survives independent modules, expiry and clock rollback", async () => {
  const { sql, db } = memorySql();
  await addSite(sql, "shared", "shared.example", "store");
  const independent = await import("../src/ingest.ts?independent");
  const now = 1000000;
  const results = await Promise.all(Array.from({length: 80}, (_,i) => (i%2 ? takeToken : independent.takeToken)(sql,"shared","visitor",now)));
  assert.equal(results.filter(Boolean).length,20);
  assert.equal(await takeToken(sql,"shared","visitor",now-1000),false);
  assert.equal(await takeToken(sql,"shared","visitor",now+999),false);
  assert.equal(await takeToken(sql,"shared","visitor",now+1000),true);
  await runRetention(sql,now+30000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_limits").get().n,0);
  assert.equal((await Promise.all(Array.from({length:21},()=>takeToken(sql,"shared","visitor",now+30000)))).filter(Boolean).length,20);
  await hit(sql,"shared",now,{url:"https://shared.example/"},"198.51.100.88");
  const before=db.prepare("SELECT COUNT(*) n FROM collection_limits").get().n;
  await ingest(sql,{event:parseEvent({site:"shared",type:"pageview",url:"https://shared.example/"}),ip:"denied",userAgent:UA,countryCode:null,origin:null,doNotTrack:true,now,development:false});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM collection_limits").get().n,before);
});

test("bounded retention progresses fairly and preserves retained visit metrics and replay protection", async () => {
  const {sql,db}=memorySql();
  const old=Date.UTC(2024,1,29,12), now=Date.UTC(2026,7,31,12);
  for(const id of ["a","b","forever"]) {
    await addSite(sql,id,`${id}.example`,"store");
    await sql.run("UPDATE sites SET retention_months=? WHERE id=?",[id==="forever"?0:6,id]);
    for(let i=0;i<5;i++) await hit(sql,id,old+i*1000,{page:i.toString(16).padStart(32,"0")});
  }
  let result=await runRetention(sql,now,2);
  assert.equal(result.deleted,4); assert.equal(result.pendingSites,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE site_id='forever'").get().n,5);
  for(let i=0;i<8;i++) result=await runRetention(sql,now,2);
  assert.equal(result.pendingSites,0);
  assert.equal((await runRetention(sql,now,2)).deleted,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM visits WHERE site_id!='forever'").get().n,0);
  assert.equal(monthsBefore("2024-08-31",6),"2024-02-29");
  assert.equal(monthsBefore("2025-08-31",6),"2025-02-28");
  const token="f".repeat(32);
  await hit(sql,"forever",now,{page:token});
  await hit(sql,"forever",now+30000,{type:"activity",page:token,visible:30000});
  const metrics=db.prepare("SELECT visible_ms,observed FROM visits WHERE at=?").get(now);
  await runRetention(sql,now+1800001);
  await hit(sql,"forever",now+1800002,{page:token});
  await hit(sql,"forever",now+1800003,{type:"activity",page:token,visible:60000});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE page_token=?").get(token).n,1);
  assert.deepEqual(db.prepare("SELECT visible_ms,observed FROM visits WHERE at=?").get(now),metrics);
});

test("retention keeps boundary visit metrics and page goal links while any event is retained", async () => {
  const {sql,db}=memorySql();
  await addSite(sql,'boundary','boundary.example','store','America/New_York');
  await sql.run("UPDATE sites SET retention_months=6,goals=? WHERE id='boundary'",[JSON.stringify([{id:'thanks',name:'Thanks',type:'page',path:'/thanks',createdAt:0}])]);
  const old=Date.UTC(2026,1,28,20),now=Date.UTC(2026,7,31,12);
  await hit(sql,'boundary',old,{url:'https://boundary.example/thanks',page:'e'.repeat(32)});
  const session=db.prepare('SELECT session_id FROM events').get().session_id;
  await sql.run("UPDATE visits SET visible_ms=30000,observed=1,day='2026-02-27' WHERE session_id=?",[session]);
  await sql.run("UPDATE events SET day='2026-03-01' WHERE session_id=?",[session]);
  await runRetention(sql,now);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM page_goal_matches').get().n,1);
  assert.equal(db.prepare('SELECT visible_ms FROM visits WHERE session_id=?').get(session).visible_ms,30000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM visit_pages').get().n,0);
  await sql.run("UPDATE events SET day='2026-02-27'");
  await runRetention(sql,now);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM page_goal_matches').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM visits').get().n,0);
});

test("retention follows project calendar dates around the autumn DST boundary", async () => {
  const {sql,db}=memorySql();
  for(const [id,timezone] of [['ny','America/New_York'],['jp','Asia/Tokyo']]) {
    await addSite(sql,id,`${id}.example`,'store',timezone);
    await sql.run('UPDATE sites SET retention_months=6 WHERE id=?',[id]);
    await sql.run("INSERT INTO events(site_id,at,day,hour,type,path,source,country,device,browser,visitor_id,session_id) VALUES(?,0,'2026-04-30',0,'pageview','/','Direct','Unknown','Desktop','Chrome','v','s')",[id]);
  }
  await runRetention(sql,Date.UTC(2026,10,1,3,30));
  assert.deepEqual(db.prepare('SELECT site_id FROM events').all().map(r=>r.site_id),['ny']);
  await runRetention(sql,Date.UTC(2026,10,1,7,30));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,0);
});
