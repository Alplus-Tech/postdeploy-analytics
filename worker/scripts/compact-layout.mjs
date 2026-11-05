const dimensions = ['path','entry_path','referrer_host','source','campaign','country','device','browser'];
export function pack(x) {
 return `CASE WHEN typeof(${x})='blob' THEN CAST(unhex('02')||${x} AS BLOB) WHEN typeof(${x})='text' AND length(${x})=32 AND length(CAST(${x} AS BLOB))=32 AND ${x} NOT GLOB '*[^0-9a-f]*' THEN unhex('00'||${x}) WHEN typeof(${x})='text' AND length(${x})=36 AND length(CAST(${x} AS BLOB))=36 AND ${x} GLOB '????????-????-????-????-????????????' AND length(replace(${x},'-',''))=32 AND replace(${x},'-','') NOT GLOB '*[^0-9a-f]*' THEN unhex('01'||replace(${x},'-','')) ELSE ${x} END`;
}
function unpack(x) {
 const h=`lower(hex(substr(${x},2)))`;
 return `CASE WHEN typeof(${x})!='blob' THEN ${x} WHEN hex(substr(${x},1,1))='02' THEN substr(${x},2) WHEN hex(substr(${x},1,1))='00' THEN ${h} ELSE substr(${h},1,8)||'-'||substr(${h},9,4)||'-'||substr(${h},13,4)||'-'||substr(${h},17,4)||'-'||substr(${h},21) END`;
}
function packDay(x) { return `CASE WHEN length(${x})=10 AND date(${x})=${x} THEN CAST(julianday(${x})-2440587.5 AS INTEGER) ELSE ${x} END`; }
export function unpackDay(x) { return `CASE WHEN typeof(${x})='integer' THEN date(${x}+2440587.5) ELSE ${x} END`; }
// Retained overrides outlive an expired representative; 03 is not a visitor encoding.
function forgetVisitor(key) {
 return `UPDATE compact_ids SET visitor=unhex('03') WHERE id=${key} AND (visit_rowid IS NULL OR visitor_key IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM compact_events WHERE session_key=${key} AND visitor_key IS NULL);`;
}
export function dimensionIntern(value) {
 return `UPDATE compact_dimensions SET value=${value} WHERE id=(SELECT id FROM compact_dimensions INDEXED BY compact_unused_dimensions WHERE refs=0 LIMIT 1) AND NOT EXISTS(SELECT 1 FROM compact_dimensions WHERE value=${value}); INSERT OR IGNORE INTO compact_dimensions(value) VALUES(${value});`;
}
export function layout(db) {
 const result=[];
 const visitCols=db.prepare('PRAGMA table_info(visits)').all().filter(c=>!dimensions.includes(c.name)&&!['visitor_id','session_id'].includes(c.name));
 const visitNames=visitCols.map(c=>c.name);
 const required=visitCols.filter(c=>c.notnull).map(c=>`NEW.${c.name} IS NULL`).join(' OR ');
 const requiredVisit=`SELECT CASE WHEN ${required} THEN RAISE(ABORT,'required visit field') END;`;
 const physicalVisits=`CREATE VIEW compact_visits AS SELECT visit_rowid AS id,${visitNames},dimension_id,visitor_key,visitor AS default_visitor,id AS session_key FROM compact_ids WHERE visit_rowid IS NOT NULL;`;
 result.push(physicalVisits);
 result.push(`CREATE TABLE compact_counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT INTO compact_counters VALUES('visit',0);`);
 const setVisit=`(${visitNames},dimension_id,visitor_key,visit_rowid)=(${visitNames.map(c=>'NEW.'+c)},NEW.dimension_id,NEW.visitor_key,COALESCE(NEW.id,(SELECT value FROM compact_counters WHERE name='visit')))`;
 result.push(`CREATE TRIGGER compact_visit_insert INSTEAD OF INSERT ON compact_visits BEGIN ${requiredVisit} UPDATE compact_counters SET value=MAX(value+(NEW.id IS NULL),COALESCE(NEW.id,0)) WHERE name='visit'; SELECT CASE WHEN EXISTS(SELECT 1 FROM compact_ids WHERE id=NEW.session_key AND visit_rowid IS NOT NULL) THEN RAISE(ABORT,'duplicate visit') END; UPDATE compact_ids SET ${setVisit},refs=refs+1 WHERE id=NEW.session_key; END;`);
 result.push(`CREATE TRIGGER compact_visit_update INSTEAD OF UPDATE ON compact_visits BEGIN ${requiredVisit} SELECT CASE WHEN NEW.session_key!=OLD.session_key THEN RAISE(ABORT,'visit identity is immutable') END; UPDATE compact_ids SET ${setVisit} WHERE id=OLD.session_key; END;`);
 result.push(`CREATE TRIGGER compact_visit_delete INSTEAD OF DELETE ON compact_visits BEGIN UPDATE compact_ids SET visit_rowid=NULL,dimension_id=NULL,visitor_key=NULL,${visitNames.map(c=>c+'=NULL')},refs=refs-1 WHERE id=OLD.session_key; ${forgetVisitor('OLD.session_key')} END;`);
 result.push(`CREATE TRIGGER compact_visit_dimensions AFTER UPDATE OF dimension_id ON compact_ids BEGIN UPDATE compact_dimensions SET refs=refs-1 WHERE id=OLD.dimension_id; UPDATE compact_dimensions SET refs=refs+1 WHERE id=NEW.dimension_id; END;`);
 for(const table of ['events','visits']) {
  const cols=db.prepare(`PRAGMA table_info(${table})`).all();
  const physical=cols.filter(c=>!dimensions.includes(c.name)&&!['visitor_id','session_id'].includes(c.name));
  const name=`compact_${table}`;
  if(table==='events') result.push(`CREATE TABLE ${name} (${physical.map(c=>`${c.name} ${c.name==='day'?'BLOB':c.type}${c.name==='site_id'?' REFERENCES sites(id)':''}${c.name==='type'?" CHECK(type IN ('pageview','event'))":''}${c.pk?' PRIMARY KEY':''}${c.notnull?' NOT NULL':''}${c.dflt_value!==null?' DEFAULT '+c.dflt_value:''}`).join(',')},dimension_id INTEGER NOT NULL REFERENCES compact_dimensions(id),visitor_key BLOB,session_key INTEGER NOT NULL REFERENCES compact_ids(id));`);
  const visitor=table==='visits'?'COALESCE(b.visitor_key,b.default_visitor)':'COALESCE(b.visitor_key,si.visitor)';
  const expressions=cols.map(c=>dimensions.includes(c.name)?`json_extract(d.value,'$[${dimensions.indexOf(c.name)}]') AS ${c.name}`:c.name==='visitor_id'?`${unpack(visitor)} AS visitor_id`:c.name==='session_id'?`${unpack('si.value')} AS session_id`:c.name==='day'?`${unpackDay('b.day')} AS day`:c.name==='page_token'?`${unpack('b.page_token')} AS page_token`:`b.${c.name}`);
  const view=`compact_${table}_logical`;
  result.push(`CREATE VIEW ${view} AS SELECT ${table==='visits'?'b.id AS rowid,':''}${expressions.join(',')} FROM ${name} b JOIN compact_dimensions d ON d.id=b.dimension_id JOIN compact_ids si ON si.id=b.session_key;`);
  const dim=`json_array(${dimensions.map(c=>'NEW.'+c).join(',')})`;
  const intern=`SELECT CASE WHEN NEW.visitor_id IS NULL OR NEW.session_id IS NULL THEN RAISE(ABORT,'required identity') END; ${dimensionIntern(dim)} INSERT OR IGNORE INTO compact_ids(value,visitor) VALUES(${pack('NEW.session_id')},${pack('NEW.visitor_id')});`;
  const keys=`(SELECT id FROM compact_dimensions WHERE value=${dim}),CASE WHEN ${pack('NEW.visitor_id')}=(SELECT visitor FROM compact_ids WHERE ${unpack('value')}=NEW.session_id) THEN NULL ELSE ${pack('NEW.visitor_id')} END,(SELECT id FROM compact_ids WHERE ${unpack('value')}=NEW.session_id)`;
  const values=physical.map(c=>c.name==='day'?packDay('NEW.day'):c.name==='page_token'?pack('NEW.page_token'):c.dflt_value!==null?`COALESCE(NEW.${c.name},${c.dflt_value})`:`NEW.${c.name}`);
  result.push(`CREATE TRIGGER ${view}_insert INSTEAD OF INSERT ON ${view} BEGIN ${intern} INSERT INTO ${name}(${table==='visits'?'id,':''}${physical.map(c=>c.name)},dimension_id,visitor_key,session_key) VALUES(${table==='visits'?'NEW.rowid,':''}${values},${keys}); END;`);
  const where=table==='events'?'id=OLD.id':`session_key=(SELECT id FROM compact_ids WHERE ${unpack('value')}=OLD.session_id)`;
  result.push(`CREATE TRIGGER ${view}_update INSTEAD OF UPDATE ON ${view} BEGIN ${intern} UPDATE ${name} SET (${physical.map(c=>c.name)},dimension_id,visitor_key,session_key)=(${values},${keys}) WHERE ${where}; END;`);
  result.push(`CREATE TRIGGER ${view}_delete INSTEAD OF DELETE ON ${view} BEGIN DELETE FROM ${name} WHERE ${where}; END;`);
 }
 result.push(`CREATE TRIGGER compact_forget_event_visitor AFTER DELETE ON compact_events WHEN OLD.visitor_key IS NULL BEGIN ${forgetVisitor('OLD.session_key')} END;`);
 for(const action of ['INSERT','UPDATE','DELETE']) {
  const delta = (alias,sign) => `UPDATE compact_dimensions SET refs=refs${sign}1 WHERE id=${alias}.dimension_id; UPDATE compact_ids SET refs=refs${sign}1 WHERE id=${alias}.session_key;`;
  result.push(`CREATE TRIGGER compact_events_refs_${action} AFTER ${action} ON compact_events BEGIN ${action!=='INSERT'?delta('OLD','-'):''}${action!=='DELETE'?delta('NEW','+'):''} END;`);
 }
 return `CREATE TABLE compact_dimensions(id INTEGER PRIMARY KEY,value TEXT NOT NULL UNIQUE,refs INTEGER NOT NULL DEFAULT 0); CREATE TABLE compact_ids(id INTEGER PRIMARY KEY,value BLOB NOT NULL,visitor BLOB NOT NULL,refs INTEGER NOT NULL DEFAULT 0,visit_rowid INTEGER,${visitCols.map(c=>c.name+' '+(c.name==='day'?'BLOB':c.type)+(c.name==='site_id'?' REFERENCES sites(id)':''))},dimension_id INTEGER REFERENCES compact_dimensions(id),visitor_key BLOB); CREATE UNIQUE INDEX compact_ids_exact ON compact_ids(${unpack('value')}); CREATE INDEX compact_unused_ids ON compact_ids(refs) WHERE refs=0; CREATE INDEX compact_unused_dimensions ON compact_dimensions(refs) WHERE refs=0; CREATE INDEX compact_dimensions_cleanup ON compact_dimensions(id) WHERE refs=0 AND substr(value,1,1)='[';\n`+result.join('\n')+`\nCREATE INDEX compact_events_day ON compact_events(site_id,${unpackDay('day')}); CREATE INDEX compact_events_at ON compact_events(site_id,at); CREATE INDEX compact_events_session ON compact_events(session_key,site_id); CREATE INDEX compact_events_token ON compact_events(site_id,page_token) WHERE page_token IS NOT NULL; CREATE INDEX compact_visits_assignment ON compact_ids(site_id,${unpackDay('day')},${unpack('COALESCE(visitor_key,visitor)')},timezone,last_at) WHERE visit_rowid IS NOT NULL AND closed=0; CREATE INDEX compact_visits_expiry ON compact_ids(site_id,last_at) WHERE visit_rowid IS NOT NULL AND closed=0; CREATE INDEX compact_visits_retention ON compact_ids(site_id,${unpackDay('day')}) WHERE visit_rowid IS NOT NULL;`;
}
export function storeTrigger(columns) {
 const eligible="SELECT session_id FROM visits WHERE NEW.measured=1 AND site_id=NEW.site_id AND visitor_id=+NEW.visitor_id AND day=+NEW.day AND timezone=NEW.timezone AND closed=0 AND last_at>NEW.at-1800000 ORDER BY last_at DESC,at DESC LIMIT 1";
 const attribution=['entry_path','referrer_host','source','campaign'];
 const values=columns.map(c=>c==='session_id'?'COALESCE(v.session_id,NEW.session_id)':attribution.includes(c)?`CASE WHEN v.session_id IS NOT NULL THEN v.${c} ELSE NEW.${c} END`:'NEW.'+c);
 return `CREATE TRIGGER compact_store AFTER INSERT ON compact_inbox BEGIN INSERT INTO compact_events_logical(${columns}) SELECT ${values} FROM (SELECT 1) LEFT JOIN visits v ON v.session_id=(${eligible}); INSERT INTO compact_assignment SELECT NEW.id WHERE NEW.measured=1; DELETE FROM compact_inbox WHERE id=NEW.id; END`;
}
export function cutover(db) {
 const objects=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('view','trigger') AND name NOT LIKE 'compact_%' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'storage_fence_%'").all();
 const tableSql=db.prepare("SELECT sql FROM sqlite_schema WHERE name='events'").get().sql;
 const assign=objects.find(o=>o.name==='assign_visit').sql.split('BEGIN')[1].replace(/END;?\s*$/,'');
 const dedup=objects.find(o=>o.name==='deduplicate_page').sql;
 const eventColumns=db.prepare('PRAGMA table_info(events)').all().map(c=>c.name);
 const visitColumns=db.prepare('PRAGMA table_info(visits)').all().map(c=>c.name);
 let sql=objects.map(o=>`DROP ${o.type} "${o.name}";`).join('\n');
 // Foreign keys on transient mappings and goal links must target the new physical rows.
 sql+=`CREATE TABLE compact_saved_pages AS SELECT * FROM visit_pages; DROP TABLE visit_pages; CREATE TABLE compact_saved_goals AS SELECT * FROM page_goal_matches; DROP TABLE page_goal_matches;`;
 sql+='ALTER TABLE events RENAME TO storage_original_events; ALTER TABLE visits RENAME TO storage_original_visits;';
 sql+=`CREATE VIEW events AS SELECT ${eventColumns} FROM compact_events_logical; CREATE VIEW visits AS SELECT rowid,${visitColumns} FROM compact_visits_logical;`;
 sql+=`CREATE TRIGGER compact_visits_insert INSTEAD OF INSERT ON visits BEGIN INSERT INTO compact_visits_logical(${visitColumns}) VALUES(${visitColumns.map(c=>'NEW.'+c)}); END;`;
 sql+=tableSql.replace('CREATE TABLE events','CREATE TABLE compact_inbox')+';';
 sql+=dedup.replace('BEFORE INSERT ON events','BEFORE INSERT ON compact_inbox').replace('FROM events WHERE site_id=NEW.site_id AND page_token=NEW.page_token',`FROM compact_events WHERE site_id=NEW.site_id AND page_token=${pack('NEW.page_token')}`)+';';
 sql+=`CREATE TRIGGER compact_accept INSTEAD OF INSERT ON events BEGIN INSERT INTO compact_inbox(${eventColumns}) VALUES(${eventColumns.map(c=>c==='id'?'COALESCE(NEW.id,(SELECT COALESCE(MAX(id),0)+1 FROM compact_events))':`NEW.${c}`)}); END;`;
 // Default values must be applied by the physical inbox rather than nulls from a view.
 const defaults=new Map(db.prepare('PRAGMA table_info(events)').all().map(c=>[c.name,c.dflt_value]));
 sql=sql.replace(`VALUES(${eventColumns.map(c=>c==='id'?'COALESCE(NEW.id,(SELECT COALESCE(MAX(id),0)+1 FROM compact_events))':`NEW.${c}`)})`,`VALUES(${eventColumns.map(c=>c==='id'?'COALESCE(NEW.id,(SELECT COALESCE(MAX(id),0)+1 FROM compact_events))':defaults.get(c)?`COALESCE(NEW.${c},${defaults.get(c)})`:`NEW.${c}`)})`);
 sql+='CREATE TABLE compact_assignment(id INTEGER PRIMARY KEY);'+storeTrigger(eventColumns)+';';
 sql+=`CREATE TRIGGER compact_assign AFTER INSERT ON compact_assignment BEGIN ${assign.replaceAll('NEW.', '(SELECT_PLACEHOLDER.').replace(/\(SELECT_PLACEHOLDER\.(\w+)/g,(_,c)=>`(SELECT ${['visitor_id','day'].includes(c)?'+':''}${c} FROM compact_inbox WHERE id=NEW.id)`)} DELETE FROM compact_assignment WHERE id=NEW.id; END;`;
 for(const table of ['events','visits']) {
 const cols=table==='events'?eventColumns:visitColumns;
 const where=table==='events'?'id=OLD.id':'session_id=OLD.session_id';
 sql+=`CREATE TRIGGER compact_${table}_update INSTEAD OF UPDATE ON ${table} BEGIN UPDATE compact_${table}_logical SET (${cols})=(${cols.map(c=>'NEW.'+c)}) WHERE ${where}; END; CREATE TRIGGER compact_${table}_delete INSTEAD OF DELETE ON ${table} BEGIN ${table==='visits'?"SELECT CASE WHEN EXISTS(SELECT 1 FROM visit_pages WHERE session_id=OLD.session_id) THEN RAISE(ABORT,'visit is referenced by page') END;":''} DELETE FROM compact_${table}_logical WHERE ${where}; END;`;
 }
 sql+=`CREATE TABLE visit_pages(site_id TEXT NOT NULL,token TEXT NOT NULL,session_id TEXT NOT NULL,day TEXT NOT NULL,visitor_id TEXT NOT NULL,path TEXT NOT NULL,at INTEGER NOT NULL,visible INTEGER NOT NULL DEFAULT 0,privacy_paused INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(site_id,token)); INSERT INTO visit_pages SELECT * FROM compact_saved_pages; DROP TABLE compact_saved_pages; CREATE INDEX visit_pages_expiry ON visit_pages(at); CREATE INDEX visit_pages_session ON visit_pages(session_id); CREATE TABLE page_goal_matches(event_id INTEGER PRIMARY KEY REFERENCES compact_events(id) ON DELETE CASCADE,goal_id TEXT NOT NULL); INSERT INTO page_goal_matches SELECT * FROM compact_saved_goals; DROP TABLE compact_saved_goals;`;
 for(const action of ['INSERT','UPDATE']) sql+=`CREATE TRIGGER compact_page_session_${action} BEFORE ${action} ON visit_pages WHEN NOT EXISTS(SELECT 1 FROM visits WHERE session_id=+NEW.session_id) BEGIN SELECT RAISE(ABORT,'unknown visit'); END;`;
 for(const o of objects.filter(o=>!['assign_visit','deduplicate_page'].includes(o.name))) {
  let s=o.name==='close_visits_on_timezone'&&!o.sql.includes('AND closed=0')?o.sql.replace('WHERE site_id=NEW.id','WHERE site_id=NEW.id AND closed=0'):o.sql;
  if(o.type==='trigger') s=s.replace(/AFTER DELETE ON events/,'AFTER DELETE ON compact_events');
  sql+=s+';';
 }
 return sql;
}
