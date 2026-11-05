import test from 'node:test';
import assert from 'node:assert/strict';
import { memorySql, addSite } from './sqlite.mjs';
import { runRetention } from '../src/retention.ts';
import { ingest, parseEvent } from '../src/ingest.ts';

 test('terminal expiry is bounded per project, exact at timeout and preserves all nonoperational history', async()=>{
 const {db,sql}=memorySql();
 const now=Date.UTC(2026,10,1,6,30);
 for(const id of ['a','b']) {
  await addSite(sql,id,`${id}.example`,'store','America/New_York');
  await sql.run('UPDATE sites SET retention_months=0 WHERE id=?',[id]);
  for(let i=0;i<4;i++) await sql.run("INSERT INTO visits(session_id,site_id,visitor_id,day,hour,timezone,at,last_at,path,source,country,device,browser,visible_ms,observed) VALUES(?,?,?,'2026-11-01',1,'America/New_York',?,?,'/','Direct','US','Desktop','Other',30000,1)",[[id+'0',id+'\0one',new Uint8Array([0,id.charCodeAt(0),255]),id+'3'][i],id,id+i,now-3600000,now-1800000+i]);
 }
 db.exec(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='compact_ids'").get()?"UPDATE compact_ids SET id=-9223372036854775808 WHERE value='a0'":"UPDATE visits SET rowid=-9223372036854775808 WHERE session_id='a0'");
 const minimumEvent=db.prepare("INSERT INTO events(id,site_id,at,day,type,path,source,country,device,browser,visitor_id,session_id) VALUES(-9223372036854775808,'a',?,'2026-11-01','pageview','/legacy-min','Direct','US','Desktop','Other','a0','a0')");minimumEvent.setReadBigInts(true);minimumEvent.run(now);
 for(const row of db.prepare('SELECT site_id,visitor_id,session_id FROM visits').all()) db.prepare("INSERT INTO visit_pages(site_id,token,session_id,day,visitor_id,path,at) VALUES(?,?,?,'2026-11-01',?,'/',?)").run(row.site_id,row.visitor_id,row.session_id,row.visitor_id,now);
 assert.equal(db.prepare('SELECT count(*) n FROM visit_pages p JOIN visits v ON v.session_id=+p.session_id').get().n,8);
 const snapshot=()=>{const names=db.prepare('PRAGMA table_info(visits)').all().map(c=>c.name).filter(c=>c!=='rowid');return db.prepare(`SELECT ${names} FROM visits ORDER BY session_id`).all().map(({closed,...r})=>({...r}));};
 const before=snapshot();
 let result=await runRetention(sql,now,1);
 assert.equal(result.visitsClosed,2);
 assert.equal(result.assignmentPendingSites,0);
 assert.deepEqual(snapshot(),before);
 result=await runRetention(sql,now+3,1);
 assert.equal(result.visitsClosed,2); assert.equal(result.assignmentPendingSites,2);
 for(let i=0;i<3;i++) result=await runRetention(sql,now+3,1);
 assert.equal(result.visitsClosed,0); assert.equal(result.assignmentPendingSites,0);
 assert.deepEqual(snapshot(),before);
 await runRetention(sql,now-3600000,1);
 assert.equal(db.prepare('SELECT sum(closed) n FROM visits').get().n,8);
 const plan=db.prepare('EXPLAIN QUERY PLAN SELECT session_id FROM visits WHERE site_id=? AND closed=0 AND last_at<=? ORDER BY last_at LIMIT 1').all('a',now);
 assert.match(plan.map(r=>r.detail).join('\n'),/expiry.*site_id=\? AND last_at<\?/);
 const history=db.prepare('EXPLAIN QUERY PLAN SELECT session_id FROM visits WHERE site_id=? AND day>=? AND day<=?').all('a','2026-10-01','2026-11-02');
 assert.match(history.map(r=>r.detail).join('\n'),/visits_retention/);
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='compact_ids'").get()){
 const pages=db.prepare("EXPLAIN QUERY PLAN SELECT p.day,p.visitor_id,p.path,v.entry_path,p.privacy_paused,p.at FROM visit_pages p JOIN visits v ON v.session_id=+p.session_id WHERE p.site_id=? AND p.token=?").all('a','token');
 assert.match(pages.map(r=>r.detail).join('\n'),/compact_ids_exact/);
 assert.doesNotMatch(pages.map(r=>r.detail).join('\n'),/SCAN compact_ids/);
 const removal=db.prepare("EXPLAIN QUERY PLAN DELETE FROM visits WHERE session_id IN (SELECT session_id FROM visits WHERE site_id=? AND day<? AND NOT EXISTS(SELECT 1 FROM events e WHERE e.site_id=visits.site_id AND e.session_id=visits.session_id) AND NOT EXISTS(SELECT 1 FROM visit_pages p WHERE p.session_id=visits.session_id) LIMIT ?) RETURNING session_id").all('a','2024-01-01',500);
 assert.doesNotMatch(removal.map(r=>r.detail).join('\n'),/SCAN compact_ids/);
 }
 const {startHeadroom,headroomBatch}=await import('../scripts/storage-headroom.mjs');
 startHeadroom(db,now+3);let complete=false;for(let n=0;n<10&&!complete;n++)complete=headroomBatch(db,1).complete;assert.equal(complete,true);
 assert.equal(db.prepare('SELECT scanned FROM storage_headroom').get().scanned,8);
 assert.deepEqual(snapshot(),before);
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='compact_ids'").get()){
 const {prepare,copyBatch,activate,rollback}=await import('../scripts/compact-storage.mjs');prepare(db);assert.throws(()=>startHeadroom(db,now),/Finish compact/);assert.throws(()=>headroomBatch(db,1),/Finish compact/);rollback(db);assert.equal(db.prepare('SELECT complete FROM storage_headroom').get().complete,1);
 prepare(db);for(const table of ['visits','events']){let n=0;while(copyBatch(db,table,1)){if(++n>10)throw Error('Copy did not terminate');}}activate(db);assert.deepEqual(snapshot(),before);assert.equal(db.prepare("SELECT CAST(id AS TEXT) id FROM events").get().id,'-9223372036854775808');rollback(db);assert.deepEqual(snapshot(),before);assert.equal(db.prepare('SELECT complete FROM storage_headroom').get().complete,1);assert.equal(db.prepare("SELECT CAST(rowid AS TEXT) id FROM visits WHERE session_id='a0'").get().id,'-9223372036854775808');
 }
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='compact_ids'").get()) {
 const unused=db.prepare("INSERT INTO compact_dimensions(value) VALUES(json_array('/unused','/unused',NULL,'Direct',NULL,'US','Desktop','Other')) RETURNING id").get().id;
 const cleared=await runRetention(sql,now+3,1);assert.equal(cleared.dimensionValuesCleared,1);
 assert.deepEqual(snapshot(),before);
 assert.equal(db.prepare("SELECT count(*) n FROM visits WHERE path='/unused'").get().n,0);
 db.prepare("INSERT INTO visits(session_id,site_id,visitor_id,day,hour,timezone,at,last_at,path,source,country,device,browser) VALUES('pool-reused','a','new','2026-11-01',1,'America/New_York',?,?,'/reused','Direct','US','Desktop','Other')").run(now,now);
 assert.equal(db.prepare("SELECT dimension_id FROM compact_ids WHERE value='pool-reused'").get().dimension_id,unused);
 assert.equal(db.prepare('PRAGMA foreign_key_check').get(),undefined);
 assert.deepEqual(snapshot().filter(v=>v.session_id!=='pool-reused'),before);
 }
 db.close();
});

test('upgrade resumes across reopen and preserves exact populated history, rollback and export', async()=>{
 const {mkdtempSync,mkdirSync,readFileSync}=await import('node:fs');
 const {DatabaseSync,backup}=await import('node:sqlite');
 const {startHeadroom,headroomBatch,verifyHeadroom}=await import('../scripts/storage-headroom.mjs');
 const {prepare,activate,copyBatch,rollback}=await import('../scripts/compact-storage.mjs');
 const {execFileSync}=await import('node:child_process');
 const prior=process.env.COMPACT_STORAGE;delete process.env.COMPACT_STORAGE;
 const {db,sql}=memorySql();if(prior)process.env.COMPACT_STORAGE=prior;
 await addSite(sql,'exact','exact.example','store');
 const now=Date.UTC(2026,10,1,12);
 const hit=async(type,page,t,visible=0)=>ingest(sql,{event:parseEvent({site:'exact',type,url:'https://exact.example/thanks',page,...(type==='activity'?{visible}:{}),...(type==='event'?{name:'purchase'}:{})}),now:t,ip:'192.0.2.1',userAgent:'Mozilla/5.0 Safari/605.1 Version/17.0',countryCode:'US',origin:null,doNotTrack:false,development:false});
 await sql.run('UPDATE sites SET retention_months=0,goals=?',[JSON.stringify([{id:'thanks',name:'Thanks',type:'page',path:'/thanks',createdAt:0},{id:'purchase',name:'Purchase',type:'event',createdAt:0}])]);
 const page='a'.repeat(32);await hit('pageview',page,now);await hit('event',undefined,now+1000);await hit('activity',page,now+30000,30000);
 prepare(db);for(const t of ['visits','events'])while(copyBatch(db,t));activate(db);
 // Recreate the installed broad index to test the actual upgrade contract.
 const old=db.prepare("SELECT sql FROM sqlite_schema WHERE name='compact_visits_assignment'").get().sql.replace(' AND closed=0','');
 db.exec('DROP INDEX compact_visits_assignment; DROP INDEX compact_visits_expiry; DROP INDEX compact_visits_retention;'+old);
 const snapshot=()=>Object.fromEntries(['events','visits','report_events','page_goal_matches'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY ${t==='visits'?'session_id':'1'}`).all().map(({closed,rowid,...r})=>({...r}))]));
 const {buildReport,parseReportQuery}=await import('../src/report.ts');
 const {buildInsights}=await import('../src/insights.ts');
 const {organisationReport}=await import('../src/organisations.ts');
 const {getSite}=await import('../src/sites.ts');
 const {projectCsv}=await import('../src/exports.ts');
 const query=parseReportQuery(new URLSearchParams('site=exact&from=2026-11-01&to=2026-11-01'));
 const site=await getSite(sql,'exact',now);
 const reports=async()=>[await buildReport(sql,site,query,now),await buildInsights(sql,query,new URLSearchParams(),now),await organisationReport(sql,'default',query),await buildInsights(sql,query,new URLSearchParams(),now,'default'),await projectCsv(await buildReport(sql,site,query,now),query,'UTC','totals').text()];
 const known=await reports();
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 for(const {name,sql:definition} of db.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('apply_activity','compact_page_session_INSERT','compact_page_session_UPDATE')").all()) db.exec('DROP TRIGGER '+name+';'+definition.replaceAll('v.session_id=+p.session_id','v.session_id=p.session_id').replaceAll('SELECT +session_id FROM visit_pages','SELECT session_id FROM visit_pages').replaceAll('WHERE session_id=+NEW.session_id','WHERE session_id=NEW.session_id'));
 db.exec('DROP INDEX compact_dimensions_cleanup');
 for(const {name,sql:definition} of db.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('compact_events_logical_insert','compact_events_logical_update','compact_visits_logical_insert','compact_visits_logical_update')").all()) db.exec('DROP TRIGGER '+name+';'+definition.replace(/UPDATE compact_dimensions SET value=[^;]*; /,''));
 const before=snapshot();
 startHeadroom(db,now+1830000);db.exec('UPDATE compact_dimensions SET refs=refs+1');assert.throws(()=>headroomBatch(db,1),/Dimension reference count mismatch/);db.exec('UPDATE compact_dimensions SET refs=refs-1');assert.equal(headroomBatch(db,1).closed,1);
 mkdirSync('.scratch/storage-headroom',{recursive:true});
 const dir=mkdtempSync('.scratch/storage-headroom/recovery-');await backup(db,dir+'/resume.sqlite');
 const resumed=new DatabaseSync(dir+'/resume.sqlite');while(!headroomBatch(resumed,1).complete);assert.equal(headroomBatch(resumed,1).closed,0);resumed.close();
 while(!headroomBatch(db,1).complete);
 assert.deepEqual(snapshot(),before);
 assert.deepEqual(await reports(),known);
 assert.equal(db.prepare("SELECT count(*) n FROM d1_migrations WHERE name='0009_assignment_headroom.sql'").get().n,1);
 await hit('activity',page,now+1830000,60000);assert.deepEqual(snapshot(),before);
 await hit('pageview',page,now+1830001);assert.deepEqual(snapshot(),before);
 await hit('pageview','b'.repeat(32),now+1830002);assert.equal(db.prepare('SELECT count(*) n FROM visits').get().n,2);
 await hit('event',undefined,now+1831000);assert.equal(db.prepare('SELECT count(*) n FROM compact_ids WHERE refs=0').get().n,0);
 const accepted=snapshot();await backup(db,dir+'/export-source.sqlite');
 execFileSync(process.execPath,['worker/scripts/storage-headroom.mjs','prepare',dir+'/export-source.sqlite',dir+'/protected.sqlite']);
 execFileSync(process.execPath,['worker/scripts/storage-headroom.mjs','resume',dir+'/export-source.sqlite']);
 execFileSync(process.execPath,['worker/scripts/storage-headroom.mjs','reclaim',dir+'/export-source.sqlite',dir+'/reclaimed.sqlite']);
 const verification=new DatabaseSync(dir+'/export-source.sqlite');assert.equal(verifyHeadroom(verification,dir+'/protected.sqlite'),true);verification.exec('UPDATE compact_events SET revenue=revenue+1');assert.throws(()=>verifyHeadroom(verification,dir+'/protected.sqlite'),/mismatch/);verification.exec('UPDATE compact_events SET revenue=revenue-1');verification.close();
 const protectedDb=new DatabaseSync(dir+'/protected.sqlite',{readOnly:true});assert.equal(protectedDb.prepare('PRAGMA integrity_check').get().integrity_check,'ok');protectedDb.close();
 execFileSync(process.execPath,['worker/scripts/compact-export.mjs',dir+'/export-source.sqlite',dir+'/export.sql']);
 const restored=new DatabaseSync(dir+'/restore.sqlite');restored.exec(readFileSync(dir+'/export.sql','utf8'));assert.equal(restored.prepare('SELECT count(*) n FROM events').get().n,4);restored.close();
 rollback(db);assert.deepEqual(snapshot(),accepted);db.close();
});
