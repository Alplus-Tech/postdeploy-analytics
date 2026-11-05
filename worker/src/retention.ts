import { localTime, type Sql } from "./sql.ts";
import { oldestSaltDay } from "./ingest.ts";

export function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export type RetentionResult = { deleted: number; sites: number; pendingSites: number; visitsDeleted: number; transientDeleted: number; transientPending: boolean; visitsClosed: number; assignmentPendingSites: number; dimensionValuesCleared: number };

export async function runRetention(sql: Sql, now: number, batch = 5000): Promise<RetentionResult> {
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 5000) throw new Error("Invalid retention batch");
  const sites = await sql.all<{ id: string; timezone: string; retention_months: number }>(
    "SELECT id, timezone, retention_months FROM sites WHERE retention_months > 0 ORDER BY id",
  );
  const result: RetentionResult = { deleted: 0, sites: 0, pendingSites: 0, visitsDeleted: 0, transientDeleted: 0, transientPending: false, visitsClosed: 0, assignmentPendingSites: 0, dimensionValuesCleared: 0 };
  const projects = await sql.all<{ id: string }>("SELECT id FROM sites ORDER BY id");
  for (const site of projects) {
    const expired = "site_id=? AND closed=0 AND last_at<=?";
    const params = [site.id, now - 1800000];
    result.visitsClosed += (await sql.all(`UPDATE visits SET closed=1 WHERE session_id IN (SELECT session_id FROM visits WHERE ${expired} ORDER BY last_at LIMIT ?) AND ${expired} RETURNING session_id`, [...params, batch, ...params])).length;
    if ((await sql.all(`SELECT 1 FROM visits WHERE ${expired} LIMIT 1`, params)).length) result.assignmentPendingSites++;
  }
  // One event and one visit batch per project gives every project progress on each run.
  for (const site of sites) {
    const cutoff = monthsBefore(localTime(now, site.timezone).day, site.retention_months);
    const removed = await sql.all("DELETE FROM events WHERE id IN (SELECT id FROM events WHERE site_id=? AND day<? ORDER BY day,id LIMIT ?) RETURNING id", [site.id, cutoff, batch]);
    result.deleted += removed.length;
    if (removed.length) result.sites++;
    // Keep boundary/timezone visits and their full stored metrics while any retained event needs them.
    const eligible = "site_id=? AND day<? AND NOT EXISTS(SELECT 1 FROM events e WHERE e.site_id=visits.site_id AND e.session_id=visits.session_id) AND NOT EXISTS(SELECT 1 FROM visit_pages p WHERE p.session_id=visits.session_id)";
    result.visitsDeleted += (await sql.all(`DELETE FROM visits WHERE session_id IN (SELECT session_id FROM visits WHERE ${eligible} LIMIT ?) RETURNING session_id`, [site.id, cutoff, batch])).length;
    if ((await sql.all("SELECT 1 FROM events WHERE site_id=? AND day<? LIMIT 1", [site.id, cutoff])).length || (await sql.all("SELECT 1 FROM visits WHERE site_id=? AND day<? AND NOT EXISTS(SELECT 1 FROM events e WHERE e.site_id=visits.site_id AND e.session_id=visits.session_id) LIMIT 1", [site.id, cutoff])).length) result.pendingSites++;
  }
  const transient: [string, string, number | string][] = [
    ["visit_pages", "at", now - 1800000], ["collection_limits", "expires_at", now],
    ["auth_sessions", "expires_at", now], ["auth_tokens", "expires_at", now],
    ["auth_limits", "expires_at", now], ["salts", "day", oldestSaltDay(now)],
  ];
  for (const [table, field, cutoff] of transient) {
    result.transientDeleted += (await sql.all(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${field}<? LIMIT ?) RETURNING rowid`, [cutoff, batch])).length;
    if ((await sql.all(`SELECT 1 FROM ${table} WHERE ${field}<? LIMIT 1`, [cutoff])).length) result.transientPending = true;
  }
  if ((await sql.all("SELECT 1 FROM sqlite_schema WHERE name='storage_migration' AND type='table'")).length) {
    for (const table of ["compact_ids"]) {
      result.transientDeleted += (await sql.all(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE refs=0 LIMIT ?) RETURNING id`, [batch])).length;
      if ((await sql.all(`SELECT 1 FROM ${table} WHERE refs=0 LIMIT 1`)).length) result.transientPending = true;
    }
  }
  if ((await sql.all("SELECT 1 FROM sqlite_schema WHERE name='compact_dimensions_cleanup'")).length) {
    const pending = "refs=0 AND substr(value,1,1)='['";
    result.dimensionValuesCleared = (await sql.all(`UPDATE compact_dimensions SET value=json_object('unused',id) WHERE id IN (SELECT id FROM compact_dimensions INDEXED BY compact_dimensions_cleanup WHERE ${pending} LIMIT ?) RETURNING id`, [batch])).length;
    if ((await sql.all(`SELECT 1 FROM compact_dimensions INDEXED BY compact_dimensions_cleanup WHERE ${pending} LIMIT 1`)).length) result.transientPending = true;
  }
  return result;
}
