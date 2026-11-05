import test from 'node:test';
import assert from 'node:assert/strict';
import { memorySql, addSite } from './sqlite.mjs';
import { prepare, activate, copyBatch } from '../scripts/compact-storage.mjs';
import { organisationAggregateSql, compactAggregateQuery, sharedEventAggregates, aggregateSql } from '../src/aggregate-sql.ts';
import { buildReport, parseReportQuery, goalQuery } from '../src/report.ts';
import { getSite } from '../src/sites.ts';
import { organisationScope } from '../src/organisations.ts';

// Real aggregate seam: global Top N must precede partitioning, including Other unions.
test('partitioned compact aggregates preserve global ranking and typed visitor populations with bounded plans', async () => {
  const { db, sql } = memorySql();
  const sites = ['a','b','c','d','e','f'];
  for (const site of sites) await addSite(sql, site, site+'.example', 'store');
  for (const site of sites) for (let i = 0; i < 160; i++) {
    await sql.run("INSERT INTO events(site_id,at,day,hour,type,path,source,country,device,browser,visitor_id,session_id) VALUES(?,1790812800000,'2026-10-01',0,'pageview','/',?,'US','Desktop','Chrome',?,?)", [site, i % 3 ? 'shared' : 'source'+i, 'visitor'+(i%11), site+i]);
  }
  if (process.env.COMPACT_STORAGE !== '1') { prepare(db); for (const table of ['events','visits']) while(copyBatch(db,table)) {} activate(db); }
  const scope = organisationScope('default', {from:'2026-10-01',to:'2026-10-01'}, []);
  const query = `WITH ev AS (SELECT *,day AS bucket FROM analytics_events e WHERE ${scope.where}), top AS (SELECT source AS k FROM ev GROUP BY k ORDER BY SUM(type='pageview') DESC,k LIMIT 20), grouped AS (SELECT *,CASE WHEN source IN (SELECT k FROM top) THEN 'v:'||source ELSE 'other' END AS category_key FROM ev) SELECT category_key AS key,MIN(source) AS label,SUM(type='pageview') AS pageviews,COUNT(DISTINCT site_id||':'||day||':'||visitor_id) AS visitorDays FROM grouped GROUP BY category_key ORDER BY pageviews DESC,category_key`;
  const actual = await organisationAggregateSql(sql, 'default');
  assert.deepEqual(await actual.all(query, scope.params), JSON.parse(JSON.stringify(await sql.all(query, scope.params))));
  const totals = `SELECT COUNT(DISTINCT day||':'||visitor_id) AS n FROM analytics_events e WHERE ${scope.where}`;
  const plan = db.prepare('EXPLAIN QUERY PLAN '+compactAggregateQuery(totals)).all(...scope.params).map(r=>r.detail).join('\n');
  assert.doesNotMatch(plan, /compact_dimensions|compact_.*logical/);
  const observed = [];
  const tracing = { ...sql, all: async (q,p=[]) => {
    if(q.includes('r0 AS')) observed.push(db.prepare('EXPLAIN QUERY PLAN '+q).all(...p).map(r=>r.detail).join('\n'));
    return sql.all(q,p);
  }};
  const [shared] = await sharedEventAggregates(tracing, `WITH ev AS (SELECT * FROM analytics_events e WHERE ${scope.where})`,scope.params,[{body:'SELECT COUNT(*) AS n FROM ev',params:[],fields:['n']}],'default');
  assert.equal(shared[0].n,960);
  assert.equal(observed.length,2);
  observed.length=0;
  const longScope=organisationScope('default',{from:'2024-11-01',to:'2026-10-31'},[]);
  const [longRows]=await sharedEventAggregates(tracing,`WITH ev AS (SELECT * FROM analytics_events e WHERE ${longScope.where})`,longScope.params,[{body:'SELECT COUNT(*) AS n FROM ev',params:[],fields:['n']}],'default');
  assert.equal(longRows[0].n,960);
  assert.equal(observed.length,6);
  assert.deepEqual(await actual.all(query,longScope.params),JSON.parse(JSON.stringify(await sql.all(query,longScope.params))));
  assert.ok(observed.every(plan=>!plan.includes('SCAN b') && plan.includes('compact_events_at')));
  const reportPlans = [];
  await buildReport({ ...sql, all: async(q,p=[])=>{
    if(q.startsWith('WITH')) reportPlans.push(db.prepare('EXPLAIN QUERY PLAN '+q).all(...p).map(r=>r.detail).join('\n'));
    return sql.all(q,p);
  }}, await getSite(sql,'a',1790812800000), parseReportQuery(new URLSearchParams('site=a&from=2026-10-01&to=2026-10-01&f=source:shared')),1790812800000);
  assert.ok(reportPlans.every(plan=>!plan.includes('SCAN b')));
  assert.ok(reportPlans.at(-1).includes('compact_events_session'));
  await sql.run("INSERT INTO events(site_id,at,day,hour,type,path,source,country,device,browser,visitor_id,session_id) VALUES('a',1790812800000,'2026-10-01',0,'pageview','/other','different','US','Desktop','Chrome','legacy','inconsistent')");
  await sql.run("INSERT INTO events(site_id,at,day,hour,type,name,path,source,country,device,browser,visitor_id,session_id) VALUES('a',1790812800000,'2026-10-01',0,'event','purchase','/','shared','US','Desktop','Chrome','legacy','inconsistent')");
  const filtered = goalQuery('a',{from:'2026-10-01',to:'2026-10-01'},'hour',[{dim:'source',value:'shared'},{dim:'page',value:'/other'}]);
  const direct = await aggregateSql(sql,true);
  assert.deepEqual(await direct.all(filtered.sql,filtered.params),await sql.all(filtered.sql,filtered.params));
  db.close();
});
