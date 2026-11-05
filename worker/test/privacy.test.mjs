import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { memorySql, addSite } from './sqlite.mjs';
import { hostname, safePath, pathExcluded } from '../src/privacy.ts';
import { createSite, updateSite, saveGoal } from '../src/sites.ts';
import { ingest, parseEvent } from '../src/ingest.ts';

const UA='Mozilla/5.0 Chrome/130 Safari/537.36';
test('exact domain ownership, bounded paths and populated upgrade preserve explicit privacy choices', async()=>{
 assert.equal(hostname('BÜCHER.Example.'),'xn--bcher-kva.example');
 for(const h of ['https://example.com','example.com/path','example.com:80','u@example.com','a..com','*.example.com','example.com%2f',' example.com']) assert.throws(()=>hostname(h));
 assert.equal(safePath('/%2561ccount//reset'),'/account/reset');
 assert.equal(pathExcluded('/accounting',['/account']),false);
 for(const p of ['/bad%','/x%255cy','/%00','/x%253fy','/x'.repeat(300)])assert.equal(safePath(p),null);
 const {sql}=memorySql();
 const s=await createSite(sql,{name:'One',domain:'One.Example.',kind:'docs',aliases:['www.one.example']},0);
 assert.equal(s.settings.respectDnt,true);assert.equal(s.settings.excludeBots,true);
 const other=await createSite(sql,{name:'Two',domain:'two.example',kind:'docs'},0);
 await assert.rejects(updateSite(sql,other.id,{aliases:['www.one.example']},0),e=>e.status===409);
 await assert.rejects(createSite(sql,{name:'Clash',domain:'www.one.example',kind:'docs'},0),e=>e.status===409);
 await assert.rejects(updateSite(sql,s.id,{publicDashboard:true},0),e=>e.status===400);
 await assert.rejects(updateSite(sql,s.id,{excludedPaths:['/x?token']},0),e=>e.status===400);
 const db=new DatabaseSync(':memory:');
 for(const f of readdirSync('migrations').sort().filter(f=>f<'0006'))db.exec(readFileSync('migrations/'+f,'utf8'));
 db.exec(`INSERT INTO sites(id,name,domain,kind,currency,created,goals,funnel,respect_dnt,exclude_bots) VALUES ('old','Old','old.example','docs','$','2026-01-01','[]','{}',0,0);
 INSERT INTO events(site_id,at,day,type,path,source,country,device,browser,visitor_id,session_id) VALUES ('old',1,'2026-01-01','pageview','/private/old','Direct','Unknown','Desktop','Other','v','s');`);
 db.exec(`INSERT INTO auth_users(id,email,role,created_at) VALUES('old-owner','owner@example.test','admin',1);
 INSERT INTO events(site_id,at,day,type,path,source,country,device,browser,visitor_id,session_id,measured,timezone,page_token) VALUES('old',2,'2026-01-01','pageview','/retained','Direct','Unknown','Desktop','Other','v','measured',1,'UTC','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');`);
 const snapshots = ['visits','visit_pages','auth_users','organisations'].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]);
 const before=db.prepare('SELECT * FROM sites').get(), events=db.prepare('SELECT * FROM events').all();
 db.exec(readFileSync('migrations/0006_domain_privacy.sql','utf8'));
 const after=db.prepare('SELECT * FROM sites').get();delete after.aliases;delete after.excluded_paths;
 for(const [table,rows] of snapshots){const actual=db.prepare(`SELECT * FROM ${table}`).all();if(table==='visit_pages')actual.forEach(row=>{assert.equal(row.privacy_paused,0);delete row.privacy_paused;});assert.deepEqual(actual,rows);}
 assert.deepEqual(after,before);assert.deepEqual(db.prepare('SELECT * FROM events').all(),events);db.close();
});

test('all collector types respect exact hosts, signals and excluded paths without secondary leaks',async()=>{
 const {sql,db}=memorySql();await addSite(sql,'privacy','example.com','store');
 await updateSite(sql,'privacy',{aliases:['www.example.com'],excludedPaths:['/account','/reset','/private']},0);
 await saveGoal(sql,'privacy',{name:'Public page',type:'page',path:'/public'},0);
 let now=Date.UTC(2026,10,5,12),ip=0;
 const send=(body={},extra={})=>ingest(sql,{event:parseEvent({site:'privacy',type:'pageview',url:'https://example.com/public?token=SECRET&utm_source=newsletter&utm_campaign=launch#SECRET',referrer:'https://www.example.com/private/SECRET?q=SECRET',...body}),ip:`198.51.100.${++ip}`,userAgent:UA,countryCode:'GB',origin:null,development:false,doNotTrack:false,now:now+=1000,...extra});
 for(const type of ['pageview','event','activity']){
  const b=type==='event'?{type,name:'purchase'}:type==='activity'?{type,page:'a'.repeat(32),visible:1000}:{type};
  for(const host of ['staging.example.com','unrelated.example'])await assert.rejects(send({...b,url:`https://${host}/`}),e=>e.status===403);
  await assert.rejects(send(b,{origin:'https://staging.example.com'}),e=>e.status===403);
  for(const path of ['/account','/%61ccount/reset','/%2561ccount/reset','/private/person','/reset/token'])assert.equal(await send({...b,url:'https://example.com'+path}),'dropped');
  assert.equal(await send(b,{doNotTrack:true}),'dropped');
  assert.equal(await send(b,{userAgent:'Mozilla/5.0 bingbot/2.0'}),'dropped');
 }
 assert.equal(db.prepare('SELECT COUNT(*) n FROM page_goal_matches').get().n,0);
 const page='b'.repeat(32);const identity={ip:'198.51.100.200'};
 await send({url:'https://www.example.com/public?token=SECRET&utm_source=newsletter&utm_campaign=launch#SECRET',page},identity);
 await send({type:'event',name:'purchase'},identity);
 await send({type:'activity',page,visible:1000},identity);
 assert.equal(db.prepare('SELECT SUM(visible_ms) n FROM visits').get().n,1000);
 const beforePause=db.prepare('SELECT SUM(visible_ms) n FROM visits').get().n;
 await send({type:'activity',page,visible:3000},{...identity,doNotTrack:true});
 await send({type:'activity',page,visible:5000},identity);
 assert.equal(db.prepare('SELECT SUM(visible_ms) n FROM visits').get().n,beforePause,'resumed collection must not backfill a privacy gap');
 const data=JSON.stringify(['events','visits','visit_pages','activity'].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
 assert.ok(!/SECRET|token=|private|\?/.test(data));assert.ok(data.includes('Newsletter'));assert.ok(data.includes('launch'));
 assert.equal(db.prepare('SELECT referrer_host FROM events LIMIT 1').get().referrer_host,null);
 await updateSite(sql,'privacy',{excludedPaths:['/public']},now);
 const before=JSON.stringify(db.prepare('SELECT * FROM visits').all());
 assert.equal(await send({type:'activity',url:'https://example.com/innocent',page,visible:3000},identity),'dropped');
 assert.equal(await send({url:'https://example.com/next'},identity),'dropped');
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM visits').all()),before);
});
