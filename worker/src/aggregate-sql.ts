import type { Sql, SqlValue } from './sql.ts';

const dimensions = ['path', 'entry_path', 'referrer_host', 'source', 'campaign', 'country', 'device', 'browser'] as const;
const columns = ['id', 'site_id', 'at', 'day', 'type', 'name', ...dimensions, 'visitor_id', 'session_id', 'revenue', 'hour', 'measured', 'timezone', 'page_token'] as const;
const day = (value: string): string => `CASE WHEN typeof(${value})='integer' THEN date(${value}+2440587.5) ELSE ${value} END`;
const identity = (value: string): string => `typeof(${value})||':'||hex(${value})`;

// Aggregate-only identities are opaque and typed; they never leave the builder.
export function compactAggregateQuery(query: string, logicalVisitors = false): string {
  // Page membership must remain independent of the other selected attributes.
  query = query.replaceAll('SELECT session_id FROM analytics_events', 'SELECT session_id FROM events').replaceAll('FROM analytics_events p', 'FROM events p');
  let parameter = 0;
  query = query.replace(/\?/g, () => `?${++parameter}`);
  const materializedScope = /FROM (?:analytics_events|report_events)(?: e)? WHERE ([\s\S]*?)\),\s*(?:r0|s|f0|c|grouped|top) AS/.exec(query)?.[1]?.replaceAll('FROM analytics_events', 'FROM events');
  const uses = (column: string): boolean => new RegExp(`\\b${column}\\b`).test(query);
  const needed = columns.filter(c => c === 'id' || uses(c));
  const needsDimensions = dimensions.some(uses);
  const dimensionJoin = needsDimensions ? ' JOIN compact_dimensions d ON d.id=b.dimension_id' : '';
  const project = (visit: boolean, synthetic = false): string => needed.map(c => {
    let value: string;
    if (c === 'id') value = visit ? 'b.visit_rowid' : synthetic ? '-b.id' : 'b.id';
    else if (c === 'session_id') value = visit ? 'b.id' : 'b.session_key';
    else if (c === 'visitor_id') {
      const visitor = visit ? 'COALESCE(b.visitor_key,b.visitor)' : 'COALESCE(b.visitor_key,si.visitor)';
      value = logicalVisitors ? logicalIdentity(visitor) : identity(visitor);
    }
    else if (c === 'day') value = day('b.day');
    else if (c === 'type' && synthetic) value = "'event'";
    else if (c === 'name' && synthetic) value = 'm.goal_id';
    else if (c === 'revenue' && synthetic) value = '0';
    else if (dimensions.some(d => d === c)) {
      const extracted = `json_extract(d.value,'$[${dimensions.findIndex(d => d === c)}]')`;
      value = visit ? `(SELECT ${extracted} FROM compact_dimensions d WHERE d.id=b.dimension_id)` : extracted;
    }
    else if (visit && ['type', 'name', 'revenue', 'page_token', 'measured'].includes(c)) value = 'NULL';
    else value = 'b.' + c;
    return `${value} AS ${c}`;
  }).join(',');
  const idJoin = uses('visitor_id') ? ' JOIN compact_ids si ON si.id=b.session_key' : '';
  const event = `SELECT ${project(false)} FROM compact_events b${idJoin}${dimensionJoin}`;
  const synthetic = `SELECT ${project(false, true)} FROM compact_events b JOIN page_goal_matches m ON m.event_id=b.id${idJoin}${dimensionJoin}`;
  const visitColumns = ['visible_ms', 'observed', 'last_at', 'closed', 'signals'].filter(uses).map(c => `,b.${c}`).join('');
  const visits = `SELECT ${project(true)},b.visit_rowid AS rowid${visitColumns} FROM compact_ids b WHERE b.visit_rowid IS NOT NULL`;
  const scoped = (source: string): string => materializedScope ? `SELECT * FROM (${source}) e WHERE ${materializedScope}` : source;
  const activity = `SELECT ${needed.map(c => c === 'id' ? '-1000000000000-rowid AS id' : c === 'type' ? "'activity' AS type" : c === 'revenue' ? '0 AS revenue' : c === 'measured' ? '1 AS measured' : c).join(',')} FROM visits v WHERE NOT EXISTS(SELECT 1 FROM events e WHERE e.site_id=v.site_id AND e.session_id=v.session_id)`;
  const eventAccess = query.includes('FROM c CROSS JOIN') ? event.replace('FROM compact_events b', 'FROM compact_events b INDEXED BY compact_events_session') : event;
  const prefix = `events AS NOT MATERIALIZED (${eventAccess}),visits AS NOT MATERIALIZED (${visits}),analytics_events AS NOT MATERIALIZED (${scoped(event)} UNION ALL ${scoped(synthetic)}),report_events AS NOT MATERIALIZED (SELECT * FROM analytics_events UNION ALL ${scoped(activity)})`;
  return query.startsWith('WITH ') ? `WITH ${prefix},${query.slice(5)}` : `WITH ${prefix} ${query}`;
}

export async function aggregateSql(sql: Sql, logicalVisitors = false): Promise<Sql> {
  const compact = await sql.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='view' AND name='events'");
  if (!compact.length) return sql;
  return {
    all<T>(query: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return sql.all<T>(/\b(analytics_events|report_events|events|visits)\b/.test(query) ? compactAggregateQuery(query, logicalVisitors) : query, params);
    },
    run: (query, params) => sql.run(query, params),
  };
}

const organisationSelection = 'IN (SELECT id FROM sites WHERE organisation_id = ?)';
const topSelection = /top AS \(SELECT (source|path|entry_path|campaign|site_id) AS k FROM ev (WHERE type='pageview' )?GROUP BY k ORDER BY (COUNT\(\*\)|SUM\(type='pageview'\)) DESC,k LIMIT (6|20)\)/;
const placeholderCount = (text: string): number => (text.match(/\?/g) ?? []).length;

function mergeRows<T>(parts: T[][]): T[] {
  const rows = new Map<string, Record<string, unknown>>();
  const measures = new Set(['pageviews', 'visitorDays', 'conversionVisitorDays', 'completions', 'convertedVisitorDays', 'visits', 'bounces', 'measuredVisits', 'visibleMs', 'n', 'converted']);
  for (const part of parts) for (const value of part) {
    const row = value as Record<string, unknown>;
    const key = JSON.stringify(Object.entries(row).filter(([k]) => !measures.has(k) && k !== 'label' && k !== 'category'));
    const current = rows.get(key);
    if (!current) rows.set(key, { ...row });
    else for (const [k, v] of Object.entries(row)) {
      if (measures.has(k) && typeof v === 'number') current[k] = Number(current[k] ?? 0) + v;
      else if ((k === 'label' || k === 'category') && typeof v === 'string' && (typeof current[k] !== 'string' || compareSqlKeys(v, current[k] as string) < 0)) current[k] = v;
    }
  }
  return [...rows.values()] as T[];
}

export async function organisationAggregateSql(sql: Sql, id: string): Promise<Sql> {
  const direct = await aggregateSql(sql);
  const projects = await sql.all<{ id: string }>('SELECT id FROM sites WHERE organisation_id=? ORDER BY id', [id]);
  const groups = projectGroups(projects);
  return {
    async all<T>(query: string, params: readonly SqlValue[] = []): Promise<T[]> {
      if (!query.includes(organisationSelection) || projects.length === 0) return direct.all<T>(query, params);
      const top = topSelection.exec(query);
      let bound = [...params];
      if (top) {
        const evEnd = query.indexOf(', top AS');
        const prefix = query.slice(0, evEnd);
        const prefixParams = bound.slice(0, placeholderCount(prefix));
        const counts = await globalTop(direct, projects, prefix, prefixParams, top[1] ?? '', top[2] ?? '', top[3] ?? '', Number(top[4]));
        const index = top.index;
        const offset = placeholderCount(query.slice(0, index));
        query = query.slice(0, index) + `top AS (SELECT value AS k FROM json_each(?))` + query.slice(index + top[0].length);
        bound.splice(offset, 0, JSON.stringify(counts.map(r => r.k)));
      }
      const parts: T[][] = [];
      for (const group of (longWindow(bound) ? projectGroups(projects,1) : groups)) {
        const partial = partition(query, bound, group);
        parts.push(await direct.all<T>(partial.query, partial.params));
        await yieldToCollection();
      }
      const rows = mergeRows(parts);
      if (query.includes('ORDER BY pageviews DESC,category_key')) rows.sort((a, b) => {
        const x = a as { pageviews: number; key: string }, y = b as { pageviews: number; key: string };
        return y.pageviews - x.pageviews || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
      });
      return rows;
    },
    run: (query, params) => sql.run(query, params),
  };
}

function partition(query: string, params: readonly SqlValue[], project: readonly string[]): { query: string; params: SqlValue[] } {
  const bound = [...params];
  let offset = 0;
  while (true) {
    const index = query.indexOf(organisationSelection, offset);
    if (index < 0) break;
    bound[placeholderCount(query.slice(0, index))] = JSON.stringify(project);
    query = query.slice(0, index) + 'IN (SELECT value FROM json_each(?))' + query.slice(index + organisationSelection.length);
    offset = index + 'IN (SELECT value FROM json_each(?))'.length;
  }
  return { query, params: bound };
}

export function compareSqlKeys(a: SqlValue, b: SqlValue): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const encoder = new TextEncoder(), x = encoder.encode(String(a)), y = encoder.encode(String(b));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference) return difference;
  }
  return x.length - y.length;
}

type CategoryCount = { k: SqlValue; n: number };
async function globalTop(sql: Sql, projects: { id: string }[], prefix: string, params: SqlValue[], column: string, where: string, measure: string, limit: number): Promise<CategoryCount[]> {
  const cursors = projectGroups(projects,longWindow(params)?1:5).map(project => ({ project, rows: [] as CategoryCount[], last: undefined as SqlValue | undefined, done: false }));
  async function fill(cursor: typeof cursors[number]): Promise<void> {
    if (cursor.rows.length || cursor.done) return;
    const having = cursor.last === undefined ? '' : cursor.last === null ? ' HAVING k IS NOT NULL' : ' HAVING k>?';
    const partial = partition(`${prefix} SELECT ${column} AS k,${measure} AS n FROM ev ${where}GROUP BY k${having} ORDER BY k LIMIT 128`, [...params, ...(cursor.last === undefined || cursor.last === null ? [] : [cursor.last])], cursor.project);
    cursor.rows = await sql.all<CategoryCount>(partial.query, partial.params);
    await yieldToCollection();
    cursor.done = cursor.rows.length < 128;
    cursor.last = cursor.rows.at(-1)?.k;
  }
  const best: CategoryCount[] = [];
  while (true) {
    for (const cursor of cursors) await fill(cursor);
    const heads = cursors.flatMap(c => c.rows.length ? [c.rows[0] as CategoryCount] : []);
    if (!heads.length) break;
    const smallest = heads.reduce((a, b) => compareSqlKeys(a.k, b.k) <= 0 ? a : b).k;
    let n = 0;
    for (const cursor of cursors) if (cursor.rows.length && compareSqlKeys(cursor.rows[0]?.k ?? null, smallest) === 0) n += cursor.rows.shift()?.n ?? 0;
    best.push({ k: smallest, n });
    best.sort((a, b) => b.n - a.n || compareSqlKeys(a.k, b.k));
    if (best.length > limit) best.pop();
  }
  return best;
}

type SharedQuery = { body: string; params: SqlValue[]; fields: string[] };
export async function sharedEventAggregates(sql: Sql, cte: string, params: SqlValue[], queries: SharedQuery[], org?: string): Promise<Record<string, unknown>[][]> {
  const direct = await aggregateSql(sql);
  const projects = org ? await sql.all<{ id: string }>('SELECT id FROM sites WHERE organisation_id=? ORDER BY id', [org]) : [{ id: '' }];
  const prepared: SharedQuery[] = [];
  for (const input of queries) {
    const top = topSelection.exec(input.body);
    if (!org || !top) { prepared.push(input); continue; }
    const counts = await globalTop(direct, projects, cte, params, top[1] ?? '', top[2] ?? '', top[3] ?? '', Number(top[4]));
    prepared.push({ ...input, body: input.body.replace(top[0], 'top AS (SELECT value AS k FROM json_each(?))'), params: [JSON.stringify(counts.map(r => r.k)), ...input.params] });
  }
  const parts: Record<string, unknown>[][][] = queries.map(() => []);
  for (const group of projectGroups(projects,longWindow(params)?1:5)) {
    const bodies = prepared.map((q, i) => `r${i} AS (${q.body.startsWith(', ') ? 'WITH '+q.body.slice(2) : q.body})`);
    const output = prepared.map((q, i) => `SELECT ${i} AS family,json_object(${q.fields.flatMap(f => [`'${f}'`, f]).join(',')}) AS payload FROM r${i}`).join(' UNION ALL ');
    const query = `${cte.replace('ev AS (', 'ev AS MATERIALIZED (')},${bodies.join(',')} ${output}`;
    const bound = [...params, ...prepared.flatMap(q => q.params)];
    const partial = org ? partition(query, bound, group) : { query, params: bound };
    const rows = await direct.all<{ family: number; payload: string }>(partial.query, partial.params);
    await yieldToCollection();
    for (let i = 0; i < queries.length; i++) parts[i]?.push(rows.filter(r => r.family === i).map(r => JSON.parse(r.payload) as Record<string, unknown>));
  }
  return parts.map(mergeRows);
}

function longWindow(params: readonly SqlValue[]): boolean {
  const times = params.flatMap(value => typeof value==='number' && value>1e12 ? [value] : typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? [Date.parse(value)] : []);
  return times.length>1 && Math.max(...times)-Math.min(...times)>92*86400000;
}
function projectGroups(projects: { id: string }[], size=5): string[][] {
  return Array.from({ length: Math.ceil(projects.length / size) }, (_, i) => projects.slice(i * size, i * size + size).map(p => p.id));
}

function logicalIdentity(value: string): string {
  const hex = `lower(hex(substr(${value},2)))`;
  return `CASE WHEN typeof(${value})!='blob' THEN ${value} WHEN hex(substr(${value},1,1))='02' THEN substr(${value},2) WHEN hex(substr(${value},1,1))='00' THEN ${hex} ELSE substr(${hex},1,8)||'-'||substr(${hex},9,4)||'-'||substr(${hex},13,4)||'-'||substr(${hex},17,4)||'-'||substr(${hex},21) END`;
}

async function yieldToCollection(): Promise<void> {
  // Give incoming collection fetches an event-loop turn between read statements.
  await new Promise<void>(resolve => setTimeout(resolve, 5));
}
