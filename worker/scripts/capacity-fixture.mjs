import { DatabaseSync } from 'node:sqlite';
import { statfsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { INSERT_SITE, siteRowValues } from '../src/sites.ts';

// Offline synthetic report population, never a substitute for HTTP ingestion proof.
const [file, countText = '1000000'] = process.argv.slice(2);
const count = Number(countText);
if (!file || !Number.isSafeInteger(count) || count < 50 || count > 1000000) throw Error('Usage: capacity-fixture.mjs EMPTY_MIGRATED_DB [50..1000000]');
const disk = statfsSync(file);
if (disk.bavail * disk.bsize < 12 * 1024 ** 3) throw Error('Requires 12 GiB free disk');
const db = new DatabaseSync(file);
if (db.prepare('SELECT COUNT(*) n FROM events').get().n || db.prepare('SELECT COUNT(*) n FROM sites').get().n) throw Error('Requires empty migrated fixture database');
const start = performance.now();
const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='events'").all();
db.exec('BEGIN');
for (const t of triggers) db.exec(`DROP TRIGGER ${t.name}`);
const site = db.prepare(INSERT_SITE);
for (let i=0;i<50;i++) site.run(...siteRowValues({id:`p${i}`,name:`Project ${i}`,domain:`p${i}.example`,kind:'store',currency:'USD',timezone:'UTC',created:'2026-01-01'}));
const event = db.prepare("INSERT INTO events(site_id,at,day,hour,type,name,path,entry_path,source,country,device,browser,visitor_id,session_id,measured,timezone,page_token) VALUES(?,?,?,?,?,?,?,?,?,'Unknown','Desktop','Chrome',?,?,1,'UTC',?)");
const visit = db.prepare("INSERT INTO visits(session_id,site_id,visitor_id,day,hour,timezone,at,last_at,path,entry_path,source,country,device,browser,visible_ms,observed,signals) VALUES(?,?,?,?,?,'UTC',?,?,?,? ,?,'Unknown','Desktop','Chrome',?,1,?)");
let goalCount=0;
try {
for(let i=0;i<count;i++) {
 if(i%10000===0 && statfsSync(file).bavail*statfsSync(file).bsize<10*1024**3) throw Error('Disk reserve reached');
 const project=`p${i%50}`, at=Date.UTC(2026,9,1)+Math.floor(i/50)*129600, date=new Date(at), day=date.toISOString().slice(0,10), hour=date.getUTCHours(), id=i.toString(16).padStart(32,'0'), path=`/page-${i%101}`, source=`Source ${i%13}`, duration=[15000,60000,180000,600000][i%4];
 event.run(project,at,day,hour,'pageview',null,path,path,source,id,id,id);
 visit.run(id,project,id,day,hour,at,at+duration,path,path,source,duration,Math.ceil(duration/30000)+2);
 if(i%10===0) { event.run(project,at+1000,day,hour,'event','purchase',path,path,source,id,id,null); goalCount++; }
 if(i%10000===9999) db.exec('COMMIT; BEGIN');
}
db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  for (const t of triggers) db.exec(t.sql);
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const sizes=db.prepare('SELECT name,SUM(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC').all();
console.log(JSON.stringify({pageviews:count,goals:goalCount,visits:count,projects:50,days:30,elapsedMs:performance.now()-start,sizes}));
db.close();
