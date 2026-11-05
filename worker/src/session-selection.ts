import type { SqlValue } from './sql.ts';

export function selectedSessions(where: string, params: readonly SqlValue[]): { sql: string; params: SqlValue[] } {
  // Page-goal copies cannot add sessions; only eventless visits need the second arm.
  return {
    sql: `SELECT site_id,session_id FROM events e WHERE ${where}
      UNION SELECT site_id,session_id FROM visits e WHERE ${where}
      AND NOT EXISTS(SELECT 1 FROM events p WHERE p.site_id=e.site_id AND p.session_id=e.session_id)`,
    params: [...params, ...params],
  };
}
