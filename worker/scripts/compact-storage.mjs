import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, statfsSync, statSync, openSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { layout, cutover } from './compact-layout.mjs';

const quote = x => '"'+x.replaceAll('"','""')+'"';
export function prepare(db) {
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='storage_migration'").get()) return;
 const objects=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'").all();
 db.exec('BEGIN IMMEDIATE');
 try {
 db.exec("CREATE TABLE storage_migration(id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL,events_cursor INTEGER NOT NULL DEFAULT -9223372036854775808,visits_cursor INTEGER NOT NULL DEFAULT -9223372036854775808,schema_json TEXT NOT NULL)");
 db.prepare("INSERT INTO storage_migration(id,state,schema_json) VALUES(1,'copying',?)").run(JSON.stringify(objects));
 db.exec(layout(db));
 for(const o of objects.filter(o=>o.type==='table')) for(const action of ['INSERT','UPDATE','DELETE']) db.exec(`CREATE TRIGGER storage_fence_${o.name}_${action} BEFORE ${action} ON ${quote(o.name)} BEGIN SELECT RAISE(ABORT,'analytics storage maintenance; retry after cutover'); END`);
 db.exec('COMMIT');
 } catch(e) {db.exec('ROLLBACK');throw e;}
}
export function copyBatch(db, table, limit=1000) {
 if(!['events','visits'].includes(table)) throw Error('Invalid copy table');
 const stateQuery=db.prepare('SELECT * FROM storage_migration'); stateQuery.setReadBigInts(true); const state=stateQuery.get();
 if(state.state!=='copying') throw Error('Not copying');
 const cols=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
 const names=table==='visits'?['rowid',...cols]:cols;
 const cursor=state[table+'_cursor'];
 const first=cursor===-9223372036854775808n&&!db.prepare(`SELECT 1 FROM compact_${table}_logical WHERE ${table==='events'?'id':'rowid'}=?`).get(cursor);
 const read=db.prepare(`SELECT ${names} FROM ${table} ${first?'':'WHERE rowid>?'} ORDER BY rowid LIMIT ?`); read.setReadBigInts(true);
 const rows=first?read.all(limit):read.all(cursor,limit);
 if(!rows.length) return 0;
 db.exec('BEGIN IMMEDIATE');
 try {
 const insert=db.prepare(`INSERT INTO compact_${table}_logical(${names}) VALUES(${names.map(()=>'?')})`);
 for(const row of rows) insert.run(...names.map(n=>row[n]));
 const last=rows.at(-1); db.prepare(`UPDATE storage_migration SET ${table}_cursor=?`).run(table==='events'?last.id:last.rowid);
 db.exec('COMMIT');return rows.length;
 } catch(e){db.exec('ROLLBACK');throw e;}
}
export function verify(db) {
 const state=db.prepare('SELECT state FROM storage_migration').get().state;
 for(const table of state==='copying'?['events','visits']:[]) {
  const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name).filter(c=>c!=='rowid');
  const original=db.prepare('SELECT state FROM storage_migration').get().state==='copying'?table:`storage_original_${table}`;
  const names=table==='visits'?['rowid',...columns]:columns;
  for(const [a,b] of [[original,`compact_${table}_logical`],[`compact_${table}_logical`,original]]) {
   if(db.prepare(`SELECT ${names} FROM ${a} EXCEPT SELECT ${names} FROM ${b} LIMIT 1`).get()) throw Error(`${table}: field/identity mismatch`);
  }
 }
 for(const [table,key,extra] of [['compact_ids','session_key','(d.visit_rowid IS NOT NULL)'],['compact_dimensions','dimension_id','COALESCE(v.n,0)']]) {
  const visits=table==='compact_dimensions'?"LEFT JOIN (SELECT dimension_id AS id,COUNT(*) AS n FROM compact_ids WHERE visit_rowid IS NOT NULL GROUP BY dimension_id) v ON v.id=d.id":"";
  if(db.prepare(`WITH uses AS (SELECT ${key} AS id,COUNT(*) AS n FROM compact_events GROUP BY ${key}) SELECT 1 FROM ${table} d LEFT JOIN uses u ON u.id=d.id ${visits} WHERE d.refs!=COALESCE(u.n,0)+${extra} LIMIT 1`).get()) throw Error('Reference count mismatch');
 }
 if(db.prepare('PRAGMA foreign_key_check').get()) throw Error('Foreign key violation');
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok') throw Error('Database integrity failure');
 return true;
}
export function activate(db) {
 if(db.prepare('SELECT state FROM storage_migration').get().state!=='copying') throw Error('Not copying');
 db.exec('BEGIN IMMEDIATE');
 try {verify(db); for(const f of db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'storage_fence_%'").all()) db.exec(`DROP TRIGGER ${quote(f.name)}`); const sql=cutover(db); db.exec(sql); db.exec("UPDATE storage_migration SET state='active'"); db.exec('COMMIT');} catch(e){db.exec('ROLLBACK');throw e;}
}
export function rollback(db) {
 const stateRead=db.prepare('SELECT * FROM storage_migration');stateRead.setReadBigInts(true);const state=stateRead.get();
 if(state.state==='retired') throw Error('Restore the verified backup into an isolated database and replay accepted writes; originals retired');
 db.exec('BEGIN IMMEDIATE');
 try {
 const objects=JSON.parse(state.schema_json);
 if(state.state==='active') {
  for(const t of ['events','visits','visit_pages','page_goal_matches']) db.exec(`CREATE TABLE storage_recovery_${t} AS SELECT ${t==='visits'?'rowid AS original_rowid,':''}* FROM ${t}`);
 }
 for(const o of db.prepare("SELECT type,name FROM sqlite_schema WHERE type IN ('view','trigger')").all()) db.exec(`DROP ${o.type} IF EXISTS ${quote(o.name)}`);
 if(state.state==='active') {
  db.exec('DROP TABLE page_goal_matches; DROP TABLE visit_pages; ALTER TABLE storage_original_events RENAME TO events; ALTER TABLE storage_original_visits RENAME TO visits; DELETE FROM events; DELETE FROM visits;');
  for(const t of ['events','visits']) {
   const names=db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name);
   db.exec(`INSERT INTO ${t}(${t==='visits'?'rowid,':''}${names}) SELECT ${t==='visits'?'original_rowid,':''}${names} FROM storage_recovery_${t}`);
  }
  for(const t of ['visit_pages','page_goal_matches']) {db.exec(objects.find(o=>o.name===t).sql);db.exec(`INSERT INTO ${t} SELECT * FROM storage_recovery_${t}`);}
  for(const o of objects.filter(o=>o.type==='index'&&['visit_pages_expiry','visit_pages_session'].includes(o.name))) db.exec(o.sql);
  for(const t of ['events','visits','visit_pages','page_goal_matches']) db.exec(`DROP TABLE storage_recovery_${t}`);
 }
 for(const o of objects.filter(o=>['view','trigger'].includes(o.type))) db.exec(o.name==='close_visits_on_timezone'&&!o.sql.includes('AND closed=0')?o.sql.replace('WHERE site_id=NEW.id','WHERE site_id=NEW.id AND closed=0'):o.sql);
 for(const t of ['compact_counters','compact_assignment','compact_inbox','compact_events','compact_visits','compact_ids','compact_dimensions']) if(db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(t)) db.exec(`DROP TABLE ${t}`);
 if(!objects.some(o=>o.name==='storage_headroom'&&o.type==='table'))db.exec('DROP TABLE IF EXISTS storage_headroom');
 db.exec('DROP INDEX IF EXISTS visits_assignment; CREATE INDEX visits_assignment ON visits(site_id,visitor_id,day,timezone,last_at) WHERE closed=0; CREATE INDEX IF NOT EXISTS visits_expiry ON visits(site_id,last_at) WHERE closed=0; DROP TABLE storage_migration; COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export async function main() {
 const [command,file,backupFile]=process.argv.slice(2);
 if(!file||!['prepare','copy','verify','activate','rollback','retire'].includes(command)) throw Error('Usage: compact-storage.mjs prepare|copy|verify|activate|rollback|retire OFFLINE_DB [NEW_BACKUP_FILE]');
 const size=statSync(file).size;
 const fs=statfsSync(file);
 if(fs.bavail*fs.bsize<10*1024**3+size*3+1024**2) throw Error('Reserve source/backup/workspace plus 10 GiB');
 if(backupFile&&['prepare','retire'].includes(command)) {const dest=statfsSync(dirname(backupFile));if(dest.bavail*dest.bsize<10*1024**3+size+1024**2) throw Error('Reserve backup destination plus 10 GiB');}
 const db=new DatabaseSync(file);
 try {
 if(command==='prepare'||command==='retire') {
  if(!backupFile||existsSync(backupFile)) throw Error('A new backup filename is required');
  closeSync(openSync(backupFile,'wx',0o600));
  await backup(db,backupFile);
  const check=new DatabaseSync(backupFile,{readOnly:true});
  if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw Error('Backup integrity failure');check.close();
 }
 if(command==='prepare') prepare(db);
 if(command==='copy') for(const t of ['visits','events']) while(copyBatch(db,t)) {if(statfsSync(file).bavail*statfsSync(file).bsize<10*1024**3) throw Error('Disk reserve reached; resume later');}
 if(command==='verify') verify(db);
 if(command==='activate') activate(db);
 if(command==='rollback') rollback(db);
 if(command==='retire') {
  if(db.prepare('SELECT state FROM storage_migration').get().state!=='active') throw Error('Not active');
  db.exec('BEGIN IMMEDIATE; DROP TABLE storage_original_events; DROP TABLE storage_original_visits; UPDATE storage_migration SET state=\'retired\'; COMMIT; VACUUM;');
 }
 console.log(JSON.stringify({command,status:'ok'}));
 } finally {db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await main();
