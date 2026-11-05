import { aggregateSql } from './aggregate-sql.ts';
import { DAY_MS, HttpError, invalid, localTime, type Sql, type SqlValue } from "./sql.ts";
import { sourceKind } from "./ingest.ts";
import { revenueGoal, type Goal, type Site, type StepMatch } from "./sites.ts";

export const DIMENSIONS = ["source", "referrer", "campaign", "country", "device", "browser", "page", "entry"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Filter = { dim: Dimension; value: string };
export type Gran = "hour" | "day" | "week";
export type DayRange = { from: string; to: string };
export type ReportQuery = { site: string; main: DayRange; cmp: DayRange | null; filters: Filter[] };

export type Totals = {
  visitors: number;
  pageviews: number;
  bounceRate: number;
  duration: number | null;
  visits: number;
  bounces: number;
  measuredVisits: number;
  visibleMs: number;
  conversions: number;
  revenue: number;
  goals: Record<string, number>;
  goalRates: Record<string, { completions: number; convertedVisitorDays: number; visitorDays: number; rate: number }>;
  convertedVisitorDays: number;
  conversionVisitorDays: number;
  conversionRate: number;
};
export type Bucket = Totals & { start: number; label?: number; future: boolean };
export type Row = { name: string; note?: string; visitors: number; pageviews: number; conversions: number; purchases: number; revenue: number; goalRates: Totals["goalRates"]; convertedVisitorDays: number; conversionVisitorDays: number; conversionRate: number };
export type Period = { gran: Gran; totals: Totals; buckets: Bucket[]; breakdowns: Record<Dimension, Row[]> };
export type Report = {
  goals: Goal[];
  main: Period & { funnel: { name: string; steps: { name: string; count: number }[] }; journeys: { path: string[]; conversions: number }[] };
  prev: Period | null;
};

type SessionDimension = Exclude<Dimension, "page">;
const SESSION_DIMENSIONS: readonly SessionDimension[] = ["source", "referrer", "campaign", "country", "device", "browser", "entry"];
const SUMMING_DIMENSIONS: readonly Dimension[] = ["source", "country", "device", "browser", "entry"];

const SESSION_COLUMN: Record<SessionDimension, string> = {
  source: "source",
  referrer: "COALESCE(referrer_host, 'Direct or unknown')",
  campaign: "campaign",
  country: "country",
  device: "device",
  browser: "browser",
  entry: "entry_path",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 731;
const MAX_FILTERS = 8;
const LONG_TAIL_LIMIT = 100;
const JOURNEY_ROW_LIMIT = 50_000;
const HOUR_MS = 3_600_000;

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function parseDay(value: string | null, key: string): string {
  if (value === null || !DAY.test(value) || !Number.isFinite(dayMs(value)) || new Date(dayMs(value)).toISOString().slice(0, 10) !== value) {
    throw invalid(`${key} must be a day as YYYY-MM-DD.`);
  }
  return value;
}

function parseRange(params: URLSearchParams, fromKey: string, toKey: string): DayRange {
  const from = parseDay(params.get(fromKey), fromKey);
  const to = parseDay(params.get(toKey), toKey);
  const days = daysIn({ from, to });
  if (days < 1) throw invalid(`${fromKey} must not be after ${toKey}.`);
  if (days > MAX_DAYS) throw invalid(`A range covers at most ${MAX_DAYS} days.`);
  return { from, to };
}

function isDimension(value: string): value is Dimension {
  return DIMENSIONS.some((d) => d === value);
}

export function parseFilters(raw: string | null): Filter[] {
  if (raw === null || raw === "") return [];
  const parts = raw.split("|");
  if (parts.length > MAX_FILTERS) throw invalid(`At most ${MAX_FILTERS} filters are allowed.`);
  return parts.map((part) => {
    const colon = part.indexOf(":");
    const dim = part.slice(0, Math.max(colon, 0));
    const value = part.slice(colon + 1);
    if (colon < 1 || !isDimension(dim)) throw invalid(`Unknown filter dimension in "${part.slice(0, 40)}".`);
    if (value.length === 0 || value.length > 300) throw invalid("A filter value must be 1 to 300 characters.");
    return { dim, value };
  });
}

export function parseReportQuery(params: URLSearchParams): ReportQuery {
  const site = params.get("site");
  if (!site) throw invalid("site is required.");
  const main = parseRange(params, "from", "to");
  const hasCmp = params.has("cmpFrom") || params.has("cmpTo");
  return { site, main, cmp: hasCmp ? parseRange(params, "cmpFrom", "cmpTo") : null, filters: parseFilters(params.get("f")) };
}

function daysIn(range: DayRange): number {
  return Math.round((dayMs(range.to) - dayMs(range.from)) / DAY_MS) + 1;
}

export function granularity(days: number): Gran {
  if (days === 1) return "hour";
  return days <= 92 ? "day" : "week";
}

type Fragment = { sql: string; params: SqlValue[] };

export function eventScope(siteId: string, range: DayRange, filters: readonly Filter[]): Fragment {
  const clauses = ["site_id = ?", "day >= ?", "day <= ?"];
  const params: SqlValue[] = [siteId, range.from, range.to];
  for (const f of filters) {
    if (f.dim === "page") {
      clauses.push("session_id IN (SELECT session_id FROM analytics_events WHERE site_id = ? AND day >= ? AND day <= ? AND type = 'pageview' AND path = ?)");
      params.push(siteId, range.from, range.to, f.value);
    } else {
      clauses.push(`${SESSION_COLUMN[f.dim]} = ?`);
      params.push(f.value);
    }
  }
  return { sql: clauses.join(" AND "), params };
}

function bucketIndex(gran: Gran, range: DayRange, hourColumn: string): Fragment {
  switch (gran) {
    case "hour":
      return { sql: hourColumn, params: [] };
    case "day":
      return { sql: "CAST(julianday(day) - julianday(?) AS INTEGER)", params: [range.from] };
    case "week":
      return { sql: "CAST((julianday(day) - julianday(?)) / 7 AS INTEGER)", params: [range.from] };
    default: {
      const never: never = gran;
      throw new Error(`unknown granularity ${String(never)}`);
    }
  }
}

const SESSION_AGG = "COUNT(DISTINCT day || visitor_id) AS visitors, COUNT(*) AS sessions, SUM(pv) AS pageviews, SUM(pv = 1 AND goals = 0) AS bounces, SUM(visible_ms) AS span, SUM(observed) AS measured";

// One row per (dimension, key) from a single GROUP BY over a json_each list of dimensions:
// D1 limits compound SELECTs, so the dimensions are not joined with UNION ALL.
function groupedByDimension(bucketSql: string, columns: Partial<Record<Dimension, string>>): { key: string; dims: string } {
  const named = DIMENSIONS.filter((dim) => columns[dim] !== undefined);
  const key = `CASE d.dim WHEN 'total' THEN '' WHEN 'bucket' THEN ${bucketSql} ${named.map((dim) => `WHEN '${dim}' THEN ${columns[dim]}`).join(" ")} END`;
  return { key, dims: JSON.stringify(["total", "bucket", ...named]) };
}

const DIMENSION_JOIN = "JOIN (SELECT value AS dim FROM json_each(?)) d";

export function sessionQuery(siteId: string, range: DayRange, gran: Gran, filters: readonly Filter[]): Fragment {
  const scope = eventScope(siteId, range, filters);
  const bucket = bucketIndex(gran, range, "first_hour");
  const g = groupedByDimension(bucket.sql, Object.fromEntries(SESSION_DIMENSIONS.map((dim) => [dim, dim])));
  return {
    sql: `WITH ev AS MATERIALIZED (SELECT * FROM report_events WHERE ${scope.sql}),
s AS (SELECT session_id, MIN(visitor_id) AS visitor_id, MIN(day) AS day, COALESCE((SELECT at FROM visits v WHERE v.session_id=ev.session_id),MIN(at)) AS first_at, MAX(at) AS last_at, COALESCE((SELECT hour FROM visits v WHERE v.session_id=ev.session_id),(SELECT hour FROM ev first WHERE first.session_id=ev.session_id ORDER BY at,id LIMIT 1)) AS first_hour,
  SUM(type = 'pageview') AS pv, SUM(type = 'event') AS goals,
  COALESCE((SELECT visible_ms FROM visits v WHERE v.session_id=ev.session_id),0) AS visible_ms,
  COALESCE((SELECT observed FROM visits v WHERE v.session_id=ev.session_id),0) AS observed, MIN(source) AS source, MIN(${SESSION_COLUMN.referrer}) AS referrer, MIN(campaign) AS campaign,
  MIN(country) AS country, MIN(device) AS device, MIN(browser) AS browser, MIN(entry_path) AS entry
  FROM ev GROUP BY session_id)
SELECT d.dim, ${g.key} AS k, ${SESSION_AGG} FROM s ${DIMENSION_JOIN} GROUP BY d.dim, k
UNION ALL SELECT 'page' AS dim, path AS k, COUNT(DISTINCT day || visitor_id), 0, COUNT(*), 0, 0, 0 FROM ev WHERE type = 'pageview' GROUP BY k`,
    params: [...scope.params, ...bucket.params, g.dims],
  };
}

export function goalQuery(siteId: string, range: DayRange, gran: Gran, filters: readonly Filter[]): Fragment {
  const scope = eventScope(siteId, range, filters);
  const bucket = bucketIndex(gran, range, "hour");
  const g = groupedByDimension(bucket.sql, { ...SESSION_COLUMN, page: "path" });
  return {
    sql: `WITH ev AS MATERIALIZED (SELECT * FROM analytics_events WHERE ${scope.sql}), grouped AS (
SELECT d.dim, ${g.key} AS k, name, type, day, visitor_id, revenue FROM ev ${DIMENSION_JOIN})
SELECT dim,k,name,COUNT(*) AS n,SUM(revenue) AS revenue,COUNT(DISTINCT day||':'||visitor_id) AS visitors FROM grouped WHERE type='event' GROUP BY dim,k,name
UNION ALL SELECT dim,k,'@population',0,0,COUNT(DISTINCT day||':'||visitor_id) FROM grouped GROUP BY dim,k
UNION ALL SELECT dim,k,'@converted',0,0,COUNT(DISTINCT CASE WHEN type='event' THEN day||':'||visitor_id END) FROM grouped GROUP BY dim,k`,
    params: [...scope.params, ...bucket.params, g.dims],
  };
}

type SessionAgg = { dim: string; k: string | number | null; visitors: number; sessions: number; pageviews: number | null; bounces: number | null; span: number | null; measured: number | null };
type GoalAgg = { dim: string; k: string | number | null; name: string; n: number; revenue: number | null; visitors: number };
type GoalTally = Map<string, { n: number; revenue: number; visitors: number }>;

const keyOf = (dim: string, k: string | number | null): string => `${dim}\u0000${String(k)}`;
const cents = (n: number): number => Math.round(n * 100) / 100;

function totalsOf(s: SessionAgg | undefined, tally: GoalTally | undefined, goals: readonly Goal[]): Totals {
  const counts: Record<string, number> = {};
  let conversions = 0;
  let revenue = 0;
  for (const goal of goals) {
    const t = tally?.get(goal.id);
    counts[goal.id] = t?.n ?? 0;
    conversions += t?.n ?? 0;
    revenue += t?.revenue ?? 0;
  }
  const conversionVisitorDays = tally?.get("@population")?.visitors ?? 0;
  const convertedVisitorDays = tally?.get("@converted")?.visitors ?? 0;
  const goalRates = Object.fromEntries(goals.map(g => {
    const t = tally?.get(g.id);
    const converted = t?.visitors ?? 0;
    return [g.id, { completions: t?.n ?? 0, convertedVisitorDays: converted, visitorDays: conversionVisitorDays, rate: conversionVisitorDays ? converted / conversionVisitorDays : 0 }];
  }));
  const sessions = s?.sessions ?? 0;
  return {
    visitors: s?.visitors ?? 0,
    pageviews: s?.pageviews ?? 0,
    bounceRate: sessions ? (s?.bounces ?? 0) / sessions : 0,
    visits: sessions,
    bounces: s?.bounces ?? 0,
    measuredVisits: s?.measured ?? 0,
    visibleMs: s?.span ?? 0,
    duration: s?.measured ? Math.round((s.span ?? 0) / s.measured / 1000) : null,
    conversions,
    revenue: cents(revenue),
    goals: counts, goalRates, convertedVisitorDays, conversionVisitorDays, conversionRate: conversionVisitorDays ? convertedVisitorDays / conversionVisitorDays : 0,
  };
}

async function period(sql: Sql, site: Site, range: DayRange, gran: Gran, bucketCount: number, filters: readonly Filter[], now: number): Promise<Period> {
  const sq = sessionQuery(site.id, range, gran, filters);
  const gq = goalQuery(site.id, range, gran, filters);
  const [sessionRows, goalRows] = await Promise.all([sql.all<SessionAgg>(sq.sql, sq.params), sql.all<GoalAgg>(gq.sql, gq.params)]);

  const sessions = new Map(sessionRows.map((r) => [keyOf(r.dim, r.k), r]));
  const tallies = new Map<string, GoalTally>();
  for (const r of goalRows) {
    const key = keyOf(r.dim, r.k);
    const tally = tallies.get(key) ?? new Map();
    tally.set(r.name, { n: r.n, revenue: r.revenue ?? 0, visitors: r.visitors });
    tallies.set(key, tally);
  }
  const totalsFor = (dim: string, k: string | number | null): Totals => totalsOf(sessions.get(keyOf(dim, k)), tallies.get(keyOf(dim, k)), site.goals);

  const size = gran === "hour" ? HOUR_MS : gran === "day" ? DAY_MS : 7 * DAY_MS;
  const start = dayMs(range.from);
  const local = localTime(now, site.timezone);
  const today = dayMs(local.day);
  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const bucketStart = start + i * size;
    const future = gran === "hour" ? start > today || (start === today && i > local.hour) : bucketStart > today;
    const bucket: Bucket = { ...totalsFor("bucket", i), start: bucketStart, future };
    if (gran === "hour") bucket.label = i;
    return bucket;
  });

  const purchaseId = revenueGoal(site.goals)?.id;
  const rowsFor = (dim: Dimension): Row[] => {
    const rows = sessionRows
      .filter((r) => r.dim === dim && r.k !== null)
      .map((r): Row => {
        const name = String(r.k);
        const t = totalsFor(dim, r.k);
        const row: Row = { name, visitors: t.visitors, pageviews: t.pageviews, conversions: t.conversions, purchases: purchaseId ? (t.goals[purchaseId] ?? 0) : 0, revenue: t.revenue, goalRates: t.goalRates, convertedVisitorDays: t.convertedVisitorDays, conversionVisitorDays: t.conversionVisitorDays, conversionRate: t.conversionRate };
        const note = dim === "source" ? sourceKind(name) : undefined;
        return note ? { ...row, note } : row;
      })
      .sort((a, b) => (dim === "page" ? b.pageviews - a.pageviews : b.visitors - a.visitors) || a.name.localeCompare(b.name));
    return SUMMING_DIMENSIONS.includes(dim) ? rows : rows.slice(0, LONG_TAIL_LIMIT);
  };
  const breakdowns: Record<Dimension, Row[]> = {
    source: rowsFor("source"),
    referrer: rowsFor("referrer"),
    campaign: rowsFor("campaign"),
    country: rowsFor("country"),
    device: rowsFor("device"),
    browser: rowsFor("browser"),
    page: rowsFor("page"),
    entry: rowsFor("entry"),
  };

  return { gran, totals: totalsFor("total", ""), buckets, breakdowns };
}

function stepCondition(match: StepMatch): Fragment {
  if ("page" in match) return { sql: "e.type = 'pageview' AND substr(e.path, 1, length(?)) = ?", params: [match.page, match.page] };
  return { sql: "e.type = 'event' AND e.name = ?", params: [match.goal] };
}

export function funnelQuery(siteId: string, range: DayRange, filters: readonly Filter[], steps: readonly { match: StepMatch }[]): Fragment {
  const scope = eventScope(siteId, range, filters);
  const params: SqlValue[] = [...scope.params];
  const ctes = steps.map((step, i) => {
    const cond = stepCondition(step.match);
    params.push(...cond.params);
    const join = i === 0 ? "" : ` JOIN f${i - 1} p ON p.session_id = e.session_id AND e.at > p.at`;
    return `f${i} AS (SELECT e.session_id, MIN(e.at) AS at FROM ev e${join} WHERE ${cond.sql} GROUP BY e.session_id)`;
  });
  return {
    sql: `WITH ev AS MATERIALIZED (SELECT session_id, at, type, path, name FROM analytics_events WHERE ${scope.sql}),
${ctes.join(",\n")}
SELECT ${steps.map((_, i) => `(SELECT COUNT(*) FROM f${i}) AS c${i}`).join(", ")}`,
    params,
  };
}

async function funnel(sql: Sql, site: Site, range: DayRange, filters: readonly Filter[]): Promise<Report["main"]["funnel"]> {
  const steps = site.funnel.steps;
  if (steps.length === 0) return { name: site.funnel.name, steps: [] };
  const q = funnelQuery(site.id, range, filters, steps);
  const row = (await sql.all<Record<string, number>>(q.sql, q.params))[0] ?? {};
  return { name: site.funnel.name, steps: steps.map((s, i) => ({ name: s.name, count: row[`c${i}`] ?? 0 })) };
}

async function journeys(sql: Sql, site: Site, range: DayRange, filters: readonly Filter[]): Promise<Report["main"]["journeys"]> {
  const goal = revenueGoal(site.goals);
  if (!goal) return [];
  const scope = eventScope(site.id, range, filters);
  const rows = await sql.all<{ session_id: string; path: string }>(
    `WITH ev AS MATERIALIZED (SELECT session_id, at, type, path, name FROM analytics_events WHERE ${scope.sql}),
c AS (SELECT session_id, MIN(at) AS at FROM ev WHERE type = 'event' AND name = ? GROUP BY session_id)
SELECT e.session_id AS session_id, e.path AS path FROM c CROSS JOIN (SELECT * FROM events WHERE ${scope.sql}) e
WHERE e.session_id=c.session_id AND e.at<=c.at AND e.type = 'pageview' ORDER BY e.session_id, e.at LIMIT ${JOURNEY_ROW_LIMIT}`,
    [...scope.params, goal.id, ...scope.params],
  );

  const paths = new Map<string, string[]>();
  for (const r of rows) {
    const path = paths.get(r.session_id) ?? [];
    if (path[path.length - 1] !== r.path) path.push(r.path);
    paths.set(r.session_id, path);
  }
  const counts = new Map<string, { path: string[]; conversions: number }>();
  for (const full of paths.values()) {
    const path = full.slice(-5);
    const key = path.join("\u0000");
    const entry = counts.get(key) ?? { path, conversions: 0 };
    entry.conversions++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.conversions - a.conversions || a.path.join().localeCompare(b.path.join())).slice(0, 5);
}

export async function buildReport(sql: Sql, site: Site, query: ReportQuery, now: number): Promise<Report> {
  sql = await aggregateSql(sql, true);
  const gran = granularity(daysIn(query.main));
  const count = gran === "hour" ? 24 : gran === "day" ? daysIn(query.main) : Math.ceil(daysIn(query.main) / 7);
  const [main, funnelResult, journeyResult, prev] = await Promise.all([
    period(sql, site, query.main, gran, count, query.filters, now),
    funnel(sql, site, query.main, query.filters),
    journeys(sql, site, query.main, query.filters),
    query.cmp ? period(sql, site, query.cmp, gran, count, query.filters, now) : Promise.resolve(null),
  ]);
  return { goals: site.goals, main: { ...main, funnel: funnelResult, journeys: journeyResult }, prev };
}

export type LiveEvent = {
  id: string;
  at: number;
  kind: "pageview" | "goal" | "revenue";
  page: string;
  goal: string | null;
  revenue: number;
  source: string;
  country: string;
  device: string;
  sessionId: string;
};

type EventRow = { id: number; at: number; type: "pageview" | "event"; name: string | null; path: string; revenue: number; source: string; country: string; device: string; session_id: string };

function kindOf(row: EventRow, goals: readonly Goal[]): LiveEvent["kind"] {
  if (row.type === "pageview") return "pageview";
  return row.revenue > 0 || goals.some((g) => g.id === row.name && g.revenue) ? "revenue" : "goal";
}

function goalName(name: string | null, goals: readonly Goal[]): string | null {
  if (name === null) return null;
  return goals.find((g) => g.id === name)?.name ?? name;
}

export async function live(sql: Sql, site: Site, now: number): Promise<{ visitorsNow: number; perMinute: number[]; events: LiveEvent[] }> {
  const minuteStart = Math.floor(now / 60_000) * 60_000 - 29 * 60_000;
  const [current, minutes, rows] = await Promise.all([
    sql.all<{ n: number }>("SELECT COUNT(DISTINCT visitor_id) AS n FROM analytics_events WHERE site_id = ? AND at >= ?", [site.id, now - 5 * 60_000]),
    sql.all<{ m: number; n: number }>(
      "SELECT CAST((at - ?) / 60000 AS INTEGER) AS m, COUNT(*) AS n FROM analytics_events WHERE site_id = ? AND at >= ? AND type = 'pageview' GROUP BY m",
      [minuteStart, site.id, minuteStart],
    ),
    sql.all<EventRow>(
      "SELECT id, at, type, name, path, revenue, source, country, device, session_id FROM analytics_events WHERE site_id = ? ORDER BY at DESC, id DESC LIMIT 60",
      [site.id],
    ),
  ]);
  const perMinute = Array.from({ length: 30 }, (_, i) => minutes.find((m) => m.m === i)?.n ?? 0);
  return {
    visitorsNow: current[0]?.n ?? 0,
    perMinute,
    events: rows.map((r) => ({
      id: String(r.id),
      at: r.at,
      kind: kindOf(r, site.goals),
      page: r.path,
      goal: goalName(r.name, site.goals),
      revenue: r.revenue,
      source: r.source,
      country: r.country,
      device: r.device,
      sessionId: r.session_id,
    })),
  };
}

export async function sessionTimeline(
  sql: Sql,
  site: Site,
  sessionId: string,
): Promise<{ source: string; country: string; device: string; events: { at: number; kind: LiveEvent["kind"]; label: string; revenue: number }[] }> {
  const rows = await sql.all<EventRow>(
    "SELECT id, at, type, name, path, revenue, source, country, device, session_id FROM analytics_events WHERE site_id = ? AND session_id = ? ORDER BY at, id LIMIT 500",
    [site.id, sessionId],
  );
  const first = rows[0];
  if (!first) throw new HttpError(404, "unknown_session", "No visit has this id.");
  return {
    source: first.source,
    country: first.country,
    device: first.device,
    events: rows.map((r) => ({ at: r.at, kind: kindOf(r, site.goals), label: r.type === "pageview" ? r.path : (goalName(r.name, site.goals) ?? ""), revenue: r.revenue })),
  };
}
