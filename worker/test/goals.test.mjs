import test from 'node:test';
import assert from 'node:assert/strict';
import { memorySql,addSite } from './sqlite.mjs';
import { saveGoal,getSite } from '../src/sites.ts';
import { ingest,parseEvent } from '../src/ingest.ts';
import { buildReport,parseReportQuery } from '../src/report.ts';
import { organisationReport } from '../src/organisations.ts';
import { runRetention } from '../src/retention.ts';
const now=Date.UTC(2026,10,4,12),ua='Mozilla/5.0 Chrome/130 Safari/537.36';
test('prospective exact page and named goals preserve history, deduplicate pages, rate visitor-days and retention',async()=>{
 const {sql,db}=memorySql();await addSite(sql,'shop','shop.example','store','Asia/Tokyo');await addSite(sql,'other','other.example','store');
 const send=(path,type='pageview',name,page,at=now,ip='203.0.113.93')=>ingest(sql,{event:parseEvent({site:'shop',type,url:'https://shop.example'+path,...(name?{name}:{}),...(page?{page}:{})}),ip,userAgent:ua,countryCode:'JP',origin:'https://shop.example',doNotTrack:false,development:false,now:at});
 await send('/thank-you', 'pageview',undefined,'0'.repeat(32),now-1000);
 let site=await saveGoal(sql,'shop',{name:'Thanks',type:'page',path:'/thank-you'},now);
 const goal=site.goals.at(-1);
 await saveGoal(sql,'shop',{name:'Contact',type:'event',event:'contact_form_submitted'},now);
 await assert.rejects(saveGoal(sql,'shop',{name:'Duplicate',type:'page',path:'/%74hank-you'},now));
 await assert.rejects(saveGoal(sql,'shop',{name:'Bad',type:'page',path:'/thanks?secret=1'},now));
 await Promise.all(Array.from({length:5},()=>send('/%74hank-you','pageview',undefined,'1'.repeat(32),now+10)));
 await send('/thank-you/','pageview',undefined,'2'.repeat(32),now+20);
 await send('/thank-you','pageview',undefined,'3'.repeat(32),now+30);
 await send('/','event','contact_form_submitted',undefined,now+40);
 await send('/','event','contact_form_submitted',undefined,now+50);
 await send('/ordinary','pageview',undefined,'4'.repeat(32),now+60,'203.0.113.94');
 const query=parseReportQuery(new URLSearchParams({site:'shop',from:'2026-11-04',to:'2026-11-04'}));
 const report=async()=>buildReport(sql,await getSite(sql,'shop',now),query,now+100);
 let r=await report();
 assert.equal(r.main.totals.pageviews,5);
 assert.equal(r.main.totals.conversions,4);
 assert.deepEqual(r.main.totals.goalRates[goal.id],{completions:2,convertedVisitorDays:1,visitorDays:2,rate:0.5});
 assert.equal(r.main.totals.goalRates.contact_form_submitted.completions,2);
 assert.equal(r.main.totals.conversionRate,0.5);
 assert.equal(r.main.totals.bounces,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM page_goal_matches').get().n,2);
 const filtered=await buildReport(sql,await getSite(sql,'shop',now),{...query,filters:[{dim:'page',value:'/ordinary'}]},now);
 assert.equal(filtered.main.totals.conversions,0);assert.equal(filtered.main.totals.conversionVisitorDays,1);
 const empty=await buildReport(sql,await getSite(sql,'other',now),{...query,site:'other'},now);
 assert.equal(empty.main.totals.conversionRate,0);
 await saveGoal(sql,'shop',{name:'Renamed'},now,goal.id);
 await saveGoal(sql,'shop',{archived:true},now,goal.id);
 await send('/thank-you','pageview',undefined,'5'.repeat(32),now+200);
 assert.equal((await report()).main.totals.goals[goal.id],2);
 await assert.rejects(saveGoal(sql,'shop',{path:'/different'},now,goal.id));
 await assert.rejects(saveGoal(sql,'shop',{archived:false},now,goal.id));
 const org=await organisationReport(sql,'default',query);
 assert.equal(org.main.conversions.completions,4);assert.equal(org.main.conversions.rate,0.5);
 assert.equal(org.main.goals.find(g=>g.goalId===goal.id).name,'Renamed');
 await send('/','event','contact_form_submitted',undefined,now+31*60000);
 const repeatVisit=await report();
 assert.equal(repeatVisit.main.totals.goalRates.contact_form_submitted.convertedVisitorDays,1);
 assert.equal(repeatVisit.main.totals.goalRates.contact_form_submitted.completions,3);
 await send('/','event','contact_form_submitted',undefined,now+86400000);
 const next=await buildReport(sql,await getSite(sql,'shop',now),{...query,main:{from:'2026-11-04',to:'2026-11-05'}},now+86400000);
 assert.equal(next.main.totals.goalRates.contact_form_submitted.convertedVisitorDays,2);
 assert.equal(next.main.totals.conversionVisitorDays,3);
 await runRetention(sql,Date.UTC(2029,0,1));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM page_goal_matches').get().n,0);
});

test('populated additive goal migration changes no retained rows and fabricates no completions',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync,readdirSync}=await import('node:fs');
 const db=new DatabaseSync(':memory:');
 for(const f of readdirSync('migrations').sort().filter(f=>f<'0007'))db.exec(readFileSync('migrations/'+f,'utf8'));
 db.exec(`INSERT INTO sites(id,name,domain,kind,currency,created,goals,funnel) VALUES('old','Old','old.example','store','$','2026-01-01','[{"id":"purchase","name":"Purchase","revenue":true}]','{}');
 INSERT INTO events(site_id,at,day,type,name,path,source,country,device,browser,visitor_id,session_id,revenue) VALUES('old',1,'2026-01-01','event','purchase','/','Direct','Unknown','Desktop','Other','v','legacy',12);
 INSERT INTO events(site_id,at,day,type,path,source,country,device,browser,visitor_id,session_id,measured,timezone,page_token) VALUES('old',2,'2026-01-01','pageview','/thanks','Direct','Unknown','Desktop','Other','v','measured',1,'UTC','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');`);
 const tables=['sites','events','visits','visit_pages','organisations','auth_users'];const before=tables.map(t=>db.prepare('SELECT * FROM '+t).all());
 db.exec(readFileSync('migrations/0007_goals.sql','utf8'));
 assert.deepEqual(tables.map(t=>db.prepare('SELECT * FROM '+t).all()),before);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM page_goal_matches').get().n,0);
 assert.deepEqual(db.prepare('SELECT * FROM analytics_events').all(),db.prepare('SELECT * FROM events').all());
 db.close();
});
test('conversion windows use local identity days inside organisation UTC scope, with colliding names isolated',async()=>{
 const{sql}=memorySql();await addSite(sql,'tokyo','tokyo.example','store','Asia/Tokyo');await addSite(sql,'elsewhere','elsewhere.example','store');
 await sql.run("INSERT INTO organisations(id,name,created) VALUES('other-org','Other','2026-01-01')");
 await sql.run("UPDATE sites SET organisation_id='other-org' WHERE id='elsewhere'");
 for(const [site,at]of[['tokyo',Date.UTC(2026,10,4,14,59)],['tokyo',Date.UTC(2026,10,4,15,1)],['elsewhere',Date.UTC(2026,10,4,15,1)]]){
  await ingest(sql,{event:parseEvent({site,type:'event',name:'purchase',revenue:4,url:'https://'+site+'.example/'}),ip:'203.0.113.99',userAgent:ua,origin:null,countryCode:'JP',doNotTrack:false,development:false,now:at});
 }
 const query=parseReportQuery(new URLSearchParams({site:'tokyo',from:'2026-11-04',to:'2026-11-05'}));
 const report=await buildReport(sql,await getSite(sql,'tokyo',now),query,now+86400000);
 assert.deepEqual(report.main.totals.goalRates.purchase,{completions:2,convertedVisitorDays:2,visitorDays:2,rate:1});
 const org=await organisationReport(sql,'default',{...query,main:{from:'2026-11-04',to:'2026-11-04'}});
 assert.deepEqual(org.main.conversions,{completions:2,convertedVisitorDays:2,visitorDays:2,rate:1});
 assert.equal(org.main.goals.filter(g=>g.goalId==='purchase').length,1);
 assert.equal((await organisationReport(sql,'other-org',query)).main.conversions.completions,1);
});
test('CSV neutralises whitespace/control formula prefixes and quotes multiline Unicode',async()=>{
 const{csvResponse}=await import('../src/exports.ts');
 for(const name of ['  \t=1','\u0000\u001f+1','\u200b@x','-SUM(1,2)','雪,"quoted"\nline']){
  const response=csvResponse([{name}],{scope:'fixture'},'source');
  const text=await response.text();
  assert.ok(text.includes('"'+(/^[雪]/u.test(name)?'':"'")+name.replaceAll('"','""')+'"'));
 }
});
