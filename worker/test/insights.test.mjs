import test from 'node:test';
import assert from 'node:assert/strict';
import {memorySql,addSite} from './sqlite.mjs';
import {buildInsights,insightsCsv,selectInsightSection} from '../src/insights.ts';
import {parseReportQuery} from '../src/report.ts';
const now=Date.UTC(2026,10,5,12);
async function dataset(){
 const {sql,db}=memorySql();await addSite(sql,'large','large.example','store','America/New_York');await addSite(sql,'small','small.example','store','Asia/Tokyo');await addSite(sql,'outside','outside.example','store');
 await sql.run("INSERT INTO organisations VALUES('elsewhere','Elsewhere','2026-01-01')");await sql.run("UPDATE sites SET organisation_id='elsewhere' WHERE id='outside'");
 const insert=async(site,visitor,source,type='pageview',at=Date.UTC(2026,10,1,5,30),day='2026-11-01',hour=1,measured=0)=>{
  await sql.run("INSERT INTO events(site_id,at,day,hour,type,name,path,entry_path,source,campaign,country,device,browser,visitor_id,session_id,measured,timezone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[site,at,day,hour,type,type==='event'?'purchase':null,'/pricing','/landing',source,'launch','US','Desktop','Chrome',visitor,site+'-'+visitor,measured,site==='small'?'Asia/Tokyo':'America/New_York']);
 };
 for(let i=0;i<24;i++)await insert('large','v'+i,'Source '+(i%8),'pageview',Date.UTC(2026,10,1,5,30)+i*1000,'2026-11-01',1,i<6?1:0);
 for(let i=0;i<6;i++)await sql.run('UPDATE visits SET observed=1,visible_ms=? WHERE visitor_id=?',[ [0,10000,30000,60000,180000,600000][i],'v'+i]);
 await insert('large','v0','Source 0','event');await insert('large','v0','Source 0','event');
 await insert('small','s0','Source 0','pageview',Date.UTC(2026,10,1,23,30),'2026-11-02',8);
 await insert('small','s0','Source 0','event',Date.UTC(2026,10,1,23,30),'2026-11-02',8);
 await insert('outside','x','Secret');
 return {sql,db,insert};
}
test('insights reconcile composition, weighted union rates, duration coverage, local/UTC heatmaps and protected scopes',async()=>{
 const {sql,insert}=await dataset();const query=parseReportQuery(new URLSearchParams({site:'large',from:'2026-11-01',to:'2026-11-01',cmpFrom:'2026-10-31',cmpTo:'2026-10-31'}));
 const org=await buildInsights(sql,query,new URLSearchParams(),now,'default');
 assert.equal(org.main.totals.pageviews,25);assert.equal(org.main.totals.completions,3);assert.equal(org.main.totals.visitorDays,25);assert.equal(org.main.totals.convertedVisitorDays,2);assert.equal(org.main.totals.rate,2/25);
 assert.equal(org.main.composition.reduce((s,r)=>s+r.pageviews,0),25);assert.equal(org.main.composition.filter(r=>r.key==='other').reduce((s,r)=>s+r.pageviews,0),6);
 assert.equal(org.main.heatmap.find(r=>r.weekday===0&&r.hour===5).pageviews,24);assert.equal(org.main.heatmap.find(r=>r.weekday===0&&r.hour===23).pageviews,1);
 assert.deepEqual(org.main.duration.map(r=>r.visits),[1,1,1,1,1,1,19]);
 assert.equal(org.prev.totals.pageviews,0);
 const project=await buildInsights(sql,query,new URLSearchParams(),now);
 assert.equal(project.main.heatmap.find(r=>r.weekday===0&&r.hour===1).pageviews,24);
 assert.equal(project.main.duration.at(-1).visits,18);
 await sql.run("INSERT INTO visits(session_id,site_id,visitor_id,day,hour,timezone,at,last_at,path,entry_path,source,campaign,country,device,browser,visible_ms,observed) SELECT 'continuation',site_id,'activity-only',day,hour,timezone,at,last_at,path,entry_path,source,campaign,country,device,browser,12000,1 FROM visits LIMIT 1");
 const activity=await buildInsights(sql,query,new URLSearchParams(),now);
 assert.equal(activity.main.totals.pageviews,24);assert.equal(activity.main.totals.completions,2);assert.equal(activity.main.duration[1].visits,2);
 const smallGoal=org.goals.find(g=>g.key==='["small","purchase"]');assert.ok(smallGoal);
 const goal=await buildInsights(sql,query,new URLSearchParams({goal:smallGoal.key,dimension:'source'}),now,'default');
 assert.equal(goal.main.totals.rate,1);assert.equal(goal.main.totals.conversionVisitorDays,1);assert.equal(goal.main.totals.completions,1);
 const filtered=await buildInsights(sql,{...query,filters:[{dim:'source',value:'Source 0'}]},new URLSearchParams(),now,'default');assert.equal(filtered.main.totals.pageviews,4);assert.equal(filtered.main.totals.rate,2/4);
 const empty=await buildInsights(sql,{...query,filters:[{dim:'page',value:'/absent'}]},new URLSearchParams(),now);assert.equal(empty.main.heatmap.reduce((s,r)=>s+r.pageviews,0),0);assert.equal(empty.main.totals.rate,0);
 const csv=await insightsCsv(org,query,'heatmap').text();assert.match(csv,/"weekday","hour","pageviews"/);assert.match(csv,/"selected","0","5","24"/);
 await assert.rejects(buildInsights(sql,query,new URLSearchParams({dimension:'constructor'}),now));await assert.rejects(buildInsights(sql,query,new URLSearchParams({goal:'["outside","purchase"]'}),now,'default'));
 assert.throws(()=>parseReportQuery(new URLSearchParams({site:'large',from:'2020-01-01',to:'2026-11-01'})));
 await insert('large','v0','Source 0','event',Date.UTC(2026,10,2,5),'2026-11-02',0);
 const long=await buildInsights(sql,{...query,main:{from:'2026-01-01',to:'2026-11-02'},cmp:null},new URLSearchParams(),now);
 for(let i=0;i<24;i++){await insert('large','tail'+i,'Tail '+i);await insert('large','tail'+i,'Tail '+i,'event');await insert('large','tail'+i,'Tail '+i,'event');}
 const tail=await buildInsights(sql,query,new URLSearchParams({dimension:'source'}),now);
 assert.equal(tail.main.ranking.length,21);assert.equal(tail.main.ranking.reduce((s,r)=>s+r.pageviews,0),48);
 const other=tail.main.ranking.find(r=>r.key==='other');assert.ok(other.visitorDays>0);assert.equal(other.rate,other.convertedVisitorDays/other.conversionVisitorDays);
 await insert('large','dst','Source 0','pageview',Date.UTC(2026,10,1,6,30),'2026-11-01',1);
 const dst=await buildInsights(sql,query,new URLSearchParams(),now);assert.equal(dst.main.heatmap.find(r=>r.weekday===0&&r.hour===1).pageviews,49);
 const unknown=await buildInsights(sql,{...query,filters:[{dim:'source',value:'Tail 0'}]},new URLSearchParams(),now);assert.deepEqual(unknown.main.duration.map(r=>r.visits),[0,0,0,0,0,0,1]);
 assert.equal(long.main.granularity,'week');assert.equal(long.main.timeline.reduce((s,r)=>s+r.completions,0),3);assert.ok(long.main.timeline.every(r=>r.rate<=1));
});

test('independent sections reconcile to complete results and avoid unrelated query work',async()=>{
 const {sql,insert}=await dataset();
 await insert('large',new Uint8Array([118,48]),'Source 0');
 await insert('large','legacy\0visitor','Source 0');
 const {organisationReport}=await import('../src/organisations.ts');
 for(const filters of [[],[{dim:'source',value:'Source 0'}],[{dim:'page',value:'/absent'}]]) {
 const query={...parseReportQuery(new URLSearchParams({site:'large',from:'2026-11-01',to:'2026-11-01',cmpFrom:'2026-10-31',cmpTo:'2026-10-31'})),filters};
 for(const org of [undefined,'default']) {
 const params=new URLSearchParams({goal:'["large","purchase"]'});
 const full=await buildInsights(sql,query,params,now,org);
 for(const section of ['summary','timeline','composition','ranking','heatmap','duration']) {
 const queries=[];const traced={...sql,all:(q,p)=>{queries.push(q);return sql.all(q,p);}};
 const part=await buildInsights(traced,query,params,now,org,section);
 const packet=selectInsightSection(part,section);
 if(section==='summary') assert.equal(packet.main.totals.rate,undefined);
 if(section==='composition') assert.equal(packet.main.timeline[0]?.rate,undefined);
 for(const period of ['main','prev']) {
 if(section==='summary') for(const metric of ['pageviews','visitorDays']) assert.equal(part[period].totals[metric],full[period].totals[metric]);
 else assert.deepEqual(part[period][section],full[period][section]);
 }
 if(section==='summary'||section==='duration') assert.ok(queries.every(q=>!q.includes('top AS')&&!q.includes('category_key')&&!q.includes('AS weekday')));
 if(section==='summary') assert.ok(queries.every(q=>!q.includes('AS completions')&&!q.includes('visible_ms')));
 if(section!=='summary') assert.equal(await insightsCsv(part,query,section).text(),await insightsCsv(full,query,section).text());
 }
 }
 const full=await organisationReport(sql,'default',query);
 for(const [section,fields] of [['summary',['totals','projects']],['series',['buckets']],['goals',['conversions','goals']],['measurement',['measurement']]]) {
 const part=await organisationReport(sql,'default',query,section);
 for(const period of ['main','prev']) for(const field of fields) assert.deepEqual(part[period][field],full[period][field]);
 }
 }
});

test('scope catalog reads metadata without traffic scans',async()=>{
 const {sql}=await dataset();const {listSiteMetadata}=await import('../src/sites.ts');
 const rows=await listSiteMetadata({...sql,all:(q,p)=>{assert.doesNotMatch(q,/events|visits|visitor/i);return sql.all(q,p);}});
 assert.equal(rows.length,3);assert.deepEqual({...rows.find(r=>r.id==='large')},{id:'large',name:'large',organisationId:'default'});
});
