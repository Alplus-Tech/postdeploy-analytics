import { DatabaseSync } from 'node:sqlite';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';

const [file, output, mode] = process.argv.slice(2);
const parts = mode === '--parts';
if (mode && !parts) throw Error('Unknown export option');
const partBytes = Number(process.env.COMPACT_EXPORT_PART_BYTES ?? 16 * 1024 * 1024);
if (!Number.isSafeInteger(partBytes) || partBytes < 1024 || partBytes > 16 * 1024 * 1024) throw Error('Invalid part size');
if (!file || !output || existsSync(output)) throw Error('Usage: compact-export.mjs OFFLINE_DB NEW_SQL_FILE|NEW_DIRECTORY [--parts]');
const db = new DatabaseSync(file, { readOnly: true });
if (parts) mkdirSync(output, { mode: 0o700 });
const files = []; let bytes = 0;
function openPart() { const name = parts ? String(files.length + 1).padStart(6, '0') + '.sql' : output; files.push(name); return createWriteStream(parts ? output + '/' + name : output, { flags: 'wx', mode: 0o600 }); }
let out = openPart();
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return value.includes('\0') ? `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)` : "'" + value.replaceAll("'", "''") + "'";
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw Error('Unsupported SQLite value');
}
async function write(sql) {
  const line = sql + ';\n', size = Buffer.byteLength(line);
  if (parts && bytes > 0 && bytes + size > partBytes) { out.end(); await once(out, 'finish'); out = openPart(); bytes = 0; }
  if (!out.write(line)) await once(out, 'drain');
  bytes += size;
}
try {
  const objects = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type,name").all();
  await write('PRAGMA defer_foreign_keys=ON');
  for (const o of objects.filter(o => o.type === 'table')) await write(o.sql);
  for (const o of objects.filter(o => o.type === 'index')) await write(o.sql);
  const priority = ['organisations','sites','auth_users','compact_dimensions','compact_ids','compact_visits','compact_events'];
  const tables = objects.filter(o => o.type === 'table').sort((a,b) => (priority.includes(a.name)?priority.indexOf(a.name):999)-(priority.includes(b.name)?priority.indexOf(b.name):999));
  for (const table of tables) {
    const statement = db.prepare(`SELECT rowid AS storage_export_rowid,* FROM ${quote(table.name)}`);
    statement.setReadBigInts(true);
    for (const row of statement.iterate()) {
      const {storage_export_rowid,...fields}=row;
      await write(`INSERT INTO ${quote(table.name)}(rowid,${Object.keys(fields).map(quote)}) VALUES(${literal(storage_export_rowid)},${Object.values(fields).map(literal)})`);
    }
  }
  for (const o of objects.filter(o => o.type !== 'table' && o.type !== 'index').sort((a,b) => (a.type==='trigger'?1:0)-(b.type==='trigger'?1:0))) await write(o.sql);
  out.end(); await once(out,'finish');
  if (parts) writeFileSync(output + '/manifest.json', JSON.stringify({ files, partBytes }, null, 2), { mode: 0o600 });
} finally { db.close(); }
