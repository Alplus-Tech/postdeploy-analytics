import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, statfsSync, statSync, openSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { unpackDay, storeTrigger, dimensionIntern } from './compact-layout.mjs';

export function startHeadroom(db, now) {
 if (!Number.isSafeInteger(now)) throw Error('Invalid maintenance clock');
 const state=db.prepare("SELECT 1 FROM sqlite_schema WHERE name='storage_migration'").get();
 if(state && !['active','retired'].includes(db.prepare('SELECT state FROM storage_migration').get().state)) throw Error('Finish compact cutover first');
 if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='storage_headroom'").get()) return;
 db.exec('BEGIN IMMEDIATE');
 try {
 db.exec('CREATE TABLE storage_headroom(id INTEGER PRIMARY KEY CHECK(id=1), cutoff INTEGER NOT NULL, cursor INTEGER NOT NULL, scanned INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0)');
 db.prepare('INSERT INTO storage_headroom(id,cutoff,cursor) VALUES(1,?,-9223372036854775808)').run(now-1800000);
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function upgradeSessionLookups(db) {
 for(const name of ['apply_activity','compact_page_session_INSERT','compact_page_session_UPDATE','compact_assign']) {
 const trigger=db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name);
 if(!trigger) continue;
 const sql=trigger.sql.replaceAll('v.session_id=p.session_id','v.session_id=+p.session_id').replaceAll('SELECT session_id FROM visit_pages','SELECT +session_id FROM visit_pages').replaceAll('WHERE session_id=NEW.session_id','WHERE session_id=+NEW.session_id').replaceAll('SELECT visitor_id FROM compact_inbox','SELECT +visitor_id FROM compact_inbox').replaceAll('SELECT day FROM compact_inbox','SELECT +day FROM compact_inbox').replaceAll('visitor_id=NEW.visitor_id','visitor_id=+NEW.visitor_id').replaceAll('day=NEW.day','day=+NEW.day');
 if(sql!==trigger.sql) db.exec(`DROP TRIGGER ${name};`+sql);
 }
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='compact_dimensions'").get()) {
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='compact_dimensions_cleanup'").get()) {
 const mismatch=db.prepare("WITH uses AS (SELECT dimension_id id,count(*) n FROM (SELECT dimension_id FROM compact_events UNION ALL SELECT dimension_id FROM compact_ids WHERE visit_rowid IS NOT NULL) GROUP BY dimension_id) SELECT d.id FROM compact_dimensions d LEFT JOIN uses u ON u.id=d.id WHERE d.refs!=COALESCE(u.n,0) UNION ALL SELECT u.id FROM uses u LEFT JOIN compact_dimensions d ON d.id=u.id WHERE d.id IS NULL LIMIT 1").get();
 if(mismatch)throw Error('Dimension reference count mismatch');
 db.exec("CREATE INDEX compact_dimensions_cleanup ON compact_dimensions(id) WHERE refs=0 AND substr(value,1,1)='['");
 }
 for(const {name,sql} of db.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('compact_events_logical_insert','compact_events_logical_update','compact_visits_logical_insert','compact_visits_logical_update')").all()) {
 let updated=sql;if(!sql.includes('UPDATE compact_dimensions SET value=')){updated=sql.replace(/INSERT OR IGNORE INTO compact_dimensions\(value\) VALUES\((json_array\([^)]*\))\);/,(_,value)=>dimensionIntern(value));if(updated===sql)throw Error('Unsupported dimension adapter');}else updated=sql.replaceAll('SELECT id FROM compact_dimensions WHERE refs=0 LIMIT 1','SELECT id FROM compact_dimensions INDEXED BY compact_unused_dimensions WHERE refs=0 LIMIT 1');if(updated!==sql)db.exec('DROP TRIGGER '+name+';'+updated);
 }
 }
 const store=db.prepare("SELECT sql FROM sqlite_schema WHERE name='compact_store'").get();
 if(store){const definition=storeTrigger(db.prepare('PRAGMA table_info(events)').all().map(c=>c.name));if(store.sql!==definition)db.exec('DROP TRIGGER compact_store;'+definition);}
}
export function headroomBatch(db, limit=1000) {
 if(!Number.isSafeInteger(limit)||limit<1||limit>5000) throw Error('Invalid batch');
 const compact=!!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='compact_ids'").get();
 if(compact&&!['active','retired'].includes(db.prepare('SELECT state FROM storage_migration').get()?.state))throw Error('Finish compact cutover first');
 const table=compact?'compact_ids':'visits';
 db.exec('BEGIN IMMEDIATE');
 try {
 const query=db.prepare('SELECT * FROM storage_headroom');query.setReadBigInts(true);const state=query.get();
 upgradeSessionLookups(db);
 if(state.complete) {db.exec('COMMIT');return {scanned:0,closed:0,complete:true};}
 const first=state.scanned===0n;
 const read=db.prepare(`SELECT rowid AS cursor FROM ${table} ${first?'':'WHERE rowid>?'} ORDER BY rowid LIMIT ?`);read.setReadBigInts(true);
 const rows=first?read.all(limit):read.all(state.cursor,limit);
 if(rows.length) {
 const end=rows.at(-1).cursor;
 const changed=db.prepare(`UPDATE ${table} SET closed=1 WHERE ${first?'':'rowid>? AND '}rowid<=? AND closed=0 AND last_at<=? ${compact?'AND visit_rowid IS NOT NULL':''}`).run(...(first?[end,state.cutoff]:[state.cursor,end,state.cutoff])).changes;
 db.prepare('UPDATE storage_headroom SET cursor=?, scanned=scanned+?,closed=closed+?').run(end,rows.length,changed);
 db.exec('COMMIT');return {scanned:rows.length,closed:Number(changed),complete:false};
 }
 const name=compact?'compact_visits_assignment':'visits_assignment';
 const old=db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name).sql;
 db.exec(`DROP INDEX ${name}`);
 db.exec(old.replace(/;?\s*$/,'')+(old.includes('WHERE')?(old.includes('closed=0')?'':' AND closed=0'):' WHERE closed=0'));
 if(compact) {
 db.exec(`CREATE INDEX IF NOT EXISTS compact_visits_retention ON compact_ids(site_id,${unpackDay('day')}) WHERE visit_rowid IS NOT NULL; CREATE INDEX IF NOT EXISTS compact_visits_expiry ON compact_ids(site_id,last_at) WHERE visit_rowid IS NOT NULL AND closed=0`);
 } else db.exec('CREATE INDEX IF NOT EXISTS visits_expiry ON visits(site_id,last_at) WHERE closed=0');
 const timezone=db.prepare("SELECT sql FROM sqlite_schema WHERE name='close_visits_on_timezone'").get();
 if(timezone&&!timezone.sql.includes('AND closed=0')) db.exec("DROP TRIGGER close_visits_on_timezone;"+timezone.sql.replace('WHERE site_id=NEW.id','WHERE site_id=NEW.id AND closed=0'));
 if(compact && db.prepare("SELECT 1 FROM sqlite_schema WHERE name='d1_migrations'").get()) db.prepare("INSERT INTO d1_migrations(name) SELECT '0009_assignment_headroom.sql' WHERE NOT EXISTS(SELECT 1 FROM d1_migrations WHERE name='0009_assignment_headroom.sql')").run();
 db.exec('UPDATE storage_headroom SET complete=1; COMMIT');
 return {scanned:0,closed:0,complete:true};
 } catch(e) {db.exec('ROLLBACK');throw e;}
}
export function verifyHeadroom(db, backupFile, allowClosures=true) {
 if(!backupFile||!existsSync(backupFile)) throw Error('Protected pre-upgrade backup required');
 const state=db.prepare('SELECT complete,cutoff FROM storage_headroom').get();
 if(!state?.complete) throw Error('Finish upgrade before verification');
 db.prepare('ATTACH DATABASE ? AS headroom_original').run(backupFile);
 try {
 const tables=db.prepare("SELECT name FROM headroom_original.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' "+(allowClosures?" AND name NOT IN ('storage_headroom','d1_migrations')":'')).all();
 for(const {name} of tables) {
 const table='"'+name.replaceAll('"','""')+'"';
 const columns=db.prepare(`PRAGMA headroom_original.table_info(${table})`).all().map(c=>c.name);
 const operational=['visits','compact_ids'].includes(name);
 const mismatches=columns.filter(c=>!(operational&&allowClosures&&c==='closed')).map(c=>`a."${c}" IS NOT b."${c}"`).join(' OR ');
 if(db.prepare(`SELECT 1 FROM ${table} a LEFT JOIN headroom_original.${table} b ON a.rowid=b.rowid WHERE b.rowid IS NULL OR ${mismatches} LIMIT 1`).get() || db.prepare(`SELECT (SELECT count(*) FROM ${table})!=(SELECT count(*) FROM headroom_original.${table}) bad`).get().bad) throw Error('Original data mismatch: '+name);
 if(operational && allowClosures && db.prepare(`SELECT 1 FROM ${table} a JOIN headroom_original.${table} b ON a.rowid=b.rowid WHERE a.closed IS NOT b.closed AND (a.closed IS NOT 1 OR b.closed IS NOT 0 OR b.last_at IS NULL OR b.last_at>?) LIMIT 1`).get(state.cutoff)) throw Error('Invalid terminal closure: '+name);
 }
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get()) throw Error('Integrity failure');
 return true;
 }finally{db.exec('DETACH headroom_original');}
}
function reserve(file) {const fs=statfsSync(file);if(fs.bavail*fs.bsize<10*1024**3) throw Error('10 GiB reserve reached; preserve files and resume later');}
export async function main() {
 const [command,file,backupFile,clock]=process.argv.slice(2);
 if(!file||!['prepare','resume','status','verify','reclaim'].includes(command)||!existsSync(file)) throw Error('Usage: storage-headroom.mjs prepare|resume|status|verify|reclaim OFFLINE_DB [NEW_BACKUP_FILE [NOW_MS]]');
 if(command==='reclaim')process.env.SQLITE_TMPDIR=resolve(dirname(file));
 const db=new DatabaseSync(file,{readOnly:['status','verify','reclaim'].includes(command)});db.exec('PRAGMA cache_size=-262144');
 try {
 if(command==='prepare') {
 reserve(file);
 const size=db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size;
 const fs=statfsSync(file);if(fs.bavail*fs.bsize<size*3+10*1024**3+1024**2) throw Error('Reserve backup/workspace plus 10 GiB before upgrade');
 if(backupFile) {const dest=statfsSync(dirname(backupFile));if(dest.bavail*dest.bsize<size+10*1024**3+1024**2) throw Error('Reserve backup destination plus 10 GiB');}
 if(!backupFile||existsSync(backupFile)) throw Error('New protected backup required');
 closeSync(openSync(backupFile,'wx',0o600));await backup(db,backupFile);
 const check=new DatabaseSync(backupFile,{readOnly:true});try {check.exec('PRAGMA cache_size=-262144');if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw Error('Backup integrity failure');}finally{check.close();}
 startHeadroom(db,clock===undefined?Date.now():Number(clock));
 }
 if(command==='verify') verifyHeadroom(db,backupFile);
 if(command==='reclaim') {
 const state=db.prepare('SELECT complete FROM storage_headroom').get();if(!state?.complete)throw Error('Finish and verify upgrade first');
 if(!backupFile||existsSync(backupFile))throw Error('New reclamation output required');
 const fs=statfsSync(file),destination=statfsSync(dirname(backupFile)),size=db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size;
 const sameDevice=statSync(file,{bigint:true}).dev===statSync(dirname(backupFile),{bigint:true}).dev;
 if(fs.bavail*fs.bsize<size*(sameDevice?2:1)+10*1024**3+1024**2||destination.bavail*destination.bsize<size+10*1024**3+1024**2)throw Error('Reserve reclamation output/workspace plus 10 GiB; preserve current file and backups');
 closeSync(openSync(backupFile,'wx',0o600));db.prepare('VACUUM INTO ?').run(backupFile);
 const output=new DatabaseSync(backupFile,{readOnly:true});try{verifyHeadroom(output,file,false);}finally{output.close();}
 reserve(file);reserve(backupFile);
 }
 if(command==='resume') {let result;do {reserve(file);result=headroomBatch(db);}while(!result.complete);}
 console.log(JSON.stringify(db.prepare('SELECT id,cutoff,CAST(cursor AS TEXT) cursor,scanned,closed,complete FROM storage_headroom').get()));
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await main();
