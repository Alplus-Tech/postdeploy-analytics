import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, openSync, closeSync, statfsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const quote = s => '"' + s.replaceAll('"', '""') + '"';
export function validate(db) {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity failed');
  for (const table of ['sites', 'auth_users', 'organisations', 'events', 'visits']) db.prepare(`SELECT * FROM ${quote(table)} LIMIT 0`).all();
}
export function compare(source, restored) {
  const db = new DatabaseSync(source, { readOnly: true });
  const other = new DatabaseSync(restored, { readOnly: true });
  try {
    validate(db); validate(other);
    db.prepare('ATTACH DATABASE ? AS restored').run(resolve(restored));
    const schema = "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'";
    const otherSchema = schema.replace('sqlite_schema', 'restored.sqlite_schema');
    if (db.prepare(`${schema} EXCEPT ${otherSchema}`).get() || db.prepare(`${otherSchema} EXCEPT ${schema}`).get()) throw new Error('Schema mismatch');
    const counts = {};
    for (const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'").all()) {
      const table = quote(name);
      const count = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
      if (count !== db.prepare(`SELECT count(*) AS n FROM restored.${table}`).get().n || db.prepare(`SELECT rowid,* FROM ${table} EXCEPT SELECT rowid,* FROM restored.${table} LIMIT 1`).get() || db.prepare(`SELECT rowid,* FROM restored.${table} EXCEPT SELECT rowid,* FROM ${table} LIMIT 1`).get()) throw new Error(`Row mismatch: ${name}`);
      counts[name] = count;
    }
    return counts;
  } finally { other.close(); db.close(); }
}
export async function protectedCopy(source, destination) {
  if (existsSync(destination)) throw new Error('Destination exists; never overwrite a backup or installation');
  const parent = dirname(resolve(destination));
  if (realpathSync(parent) !== parent || lstatSync(parent).mode & 0o077) throw new Error('Destination directory must be real and private (0700)');
  const fs = statfsSync(parent, { bigint: true });
  const input = BigInt(lstatSync(source).size);
  if (fs.bavail * fs.bsize < 10n * 1024n ** 3n + input * 2n) throw new Error('Insufficient space above 10 GiB reserve');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    validate(db);
    closeSync(openSync(destination, 'wx', 0o600));
    await backup(db, destination);
  } finally { db.close(); }
  return compare(source, destination);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, source, destination, ...extra] = process.argv.slice(2);
    if (!['copy', 'verify'].includes(action) || !source || !destination || extra.length) throw new Error('Usage: backup.mjs copy|verify OFFLINE_SOURCE NEW_COPY');
    console.log(JSON.stringify(action === 'copy' ? await protectedCopy(source, destination) : compare(source, destination)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
