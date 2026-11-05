import { organisationAggregateSql, sharedEventAggregates } from './aggregate-sql.ts';
import { selectedSessions } from './session-selection.ts';
import { parseGoals } from "./sites.ts";
import { DAY_MS, HttpError, invalid, isRecord, utcDay, type Sql, type SqlValue } from "./sql.ts";
import { parseReportQuery, type DayRange, type Filter, type ReportQuery } from "./report.ts";

export type Organisation = { id: string; name: string; created: string };
export type Traffic = { pageviews: number; visitorDays: number };
export type Conversion = { completions: number; convertedVisitorDays: number; visitorDays: number; rate: number };
export type Measurement = { visits: number; bounces: number; measuredVisits: number; visibleMs: number; bounceRate: number; duration: number | null };
export type OrganisationPeriod = {
  conversions: Conversion;
  goals: (Conversion & { projectId: string; goalId: string; name: string })[];
  measurement: Measurement;
  totals: Traffic;
  buckets: (Traffic & { day: string })[];
  projects: (Traffic & { id: string; name: string; domain: string; timezone: string })[];
};
export type OrganisationReport = { organisation: Organisation; timezone: "UTC"; main: OrganisationPeriod; prev: OrganisationPeriod | null };

export async function getOrganisation(sql: Sql, id: string): Promise<Organisation> {
  const row = (await sql.all<Organisation>("SELECT * FROM organisations WHERE id = ?", [id]))[0];
  if (!row) throw new HttpError(404, "unknown_organisation", "No organisation has this id.");
  return row;
}
export async function listOrganisations(sql: Sql): Promise<Organisation[]> {
  return sql.all<Organisation>("SELECT * FROM organisations ORDER BY created, name, id");
}
export async function saveOrganisation(sql: Sql, body: unknown, now: number, id?: string): Promise<Organisation> {
  if (!isRecord(body) || Object.keys(body).some(k => k !== "name") || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) throw invalid("Provide a name of 1 to 80 characters.");
  if (id !== undefined) {
    await getOrganisation(sql, id);
    await sql.run("UPDATE organisations SET name = ? WHERE id = ?", [body.name.trim(), id]);
  } else {
    id = crypto.randomUUID();
    await sql.run("INSERT INTO organisations (id, name, created) VALUES (?, ?, ?)", [id, body.name.trim(), utcDay(now)]);
  }
  return getOrganisation(sql, id);
}
export function parseOrganisationQuery(params: URLSearchParams): ReportQuery {
  const copy = new URLSearchParams(params);
  copy.set("site", "organisation");
  return parseReportQuery(copy);
}
const COLUMNS = { source: "source", referrer: "COALESCE(referrer_host, 'Direct or unknown')", campaign: "campaign", country: "country", device: "device", browser: "browser", entry: "entry_path" } as const;
export function organisationScope(id: string, range: DayRange, filters: readonly Filter[]): { where: string; params: SqlValue[] } {
  const start = Date.parse(range.from + "T00:00:00Z");
  const end = Date.parse(range.to + "T00:00:00Z") + DAY_MS;
  const clauses = ["e.site_id IN (SELECT id FROM sites WHERE organisation_id = ?)", "e.at >= ?", "e.at < ?"];
  const params: SqlValue[] = [id, start, end];
  for (const f of filters) {
    if (f.dim === "page") {
      clauses.push("EXISTS (SELECT 1 FROM analytics_events p WHERE p.site_id = e.site_id AND p.session_id = e.session_id AND p.at >= ? AND p.at < ? AND p.type = 'pageview' AND p.path = ?)");
      params.push(start, end, f.value);
    } else {
      clauses.push(`${COLUMNS[f.dim]} = ?`);
      params.push(f.value);
    }
  }
  return { where: clauses.join(" AND "), params };
}
async function period(sql: Sql, id: string, range: DayRange, filters: readonly Filter[], sourceSql: Sql, section?: OrganisationSection): Promise<OrganisationPeriod> {
  const s = organisationScope(id, range, filters);
  const queries = [

    {body:`SELECT site_id AS id,date(at/1000,'unixepoch') AS day,SUM(type='pageview') AS pageviews,COUNT(DISTINCT day||':'||visitor_id) AS visitorDays FROM ev GROUP BY site_id,date(at/1000,'unixepoch')`,params:[],fields:['id','day','pageviews','visitorDays']},
    {body:`SELECT site_id AS id,COUNT(DISTINCT day||':'||visitor_id) AS n FROM ev GROUP BY site_id`,params:[],fields:['id','n']},
    {body:`SELECT site_id AS id,name,COUNT(*) AS completions,COUNT(DISTINCT day||':'||visitor_id) AS converted FROM ev WHERE type='event' GROUP BY site_id,name`,params:[],fields:['id','name','completions','converted']},
    {body:`SELECT site_id AS id,COUNT(DISTINCT day||':'||visitor_id) AS n FROM ev WHERE type='event' GROUP BY site_id`,params:[],fields:['id','n']},
  ];
  const chosen = queries.flatMap((q,i)=> !section || (section === 'goals' && i > 0) || (section === 'series' && i === 0) ? [{q,i}] : []);
  const traffic = section === 'summary' ? await sql.all<{id:string;pageviews:number;n:number}>(`SELECT id,SUM(pageviews) AS pageviews,SUM(n) AS n FROM (SELECT site_id AS id,day,SUM(type='pageview') AS pageviews,COUNT(DISTINCT ''||visitor_id) AS n FROM events e WHERE ${s.where} GROUP BY site_id,day) GROUP BY id`,s.params) : [];
  const results = chosen.length ? await sharedEventAggregates(sourceSql, `WITH ev AS (SELECT * FROM analytics_events e WHERE ${s.where})`, s.params, chosen.map(c=>c.q), id) : [];
  const eventRows: Record<string,unknown>[][] = section === 'summary' ? [traffic,traffic,[],[]] : queries.map((_,i)=>results[chosen.findIndex(c=>c.i===i)] ?? []);
  const rows = eventRows[0] as (Traffic & { id: string; day: string })[];
  const uniques = eventRows[1] as {id:string;n:number}[];
  const conversionRows = eventRows[2] as {id:string;name:string;completions:number;converted:number}[];
  const unionRows = eventRows[3] as {id:string;n:number}[];
  const configured = await sql.all<{id:string;goals:string}>("SELECT id,goals FROM sites WHERE organisation_id=?",[id]);
  const goals = configured.flatMap(p => parseGoals(p.goals).map(g => {
    const r = conversionRows.find(r => r.id===p.id && r.name===g.id);
    const visitorDays = uniques.find(r => r.id===p.id)?.n ?? 0;
    const convertedVisitorDays = r?.converted ?? 0;
    return {projectId:p.id,goalId:g.id,name:g.name,completions:r?.completions??0,convertedVisitorDays,visitorDays,rate:visitorDays?convertedVisitorDays/visitorDays:0};
  }));
  const visitorDays = uniques.reduce((n,r)=>n+r.n,0);
  const convertedVisitorDays = unionRows.reduce((n,r)=>n+r.n,0);
  const conversions = {completions:conversionRows.reduce((n,r)=>n+r.completions,0),convertedVisitorDays,visitorDays,rate:visitorDays?convertedVisitorDays/visitorDays:0};
  const sites = await sql.all<{ id: string; name: string; domain: string; timezone: string }>("SELECT id, name, domain, timezone FROM sites WHERE organisation_id = ? ORDER BY name, id", [id]);
  const projects = sites.map(site => ({ ...site, pageviews: rows.filter(r => r.id === site.id).reduce((n, r) => n + r.pageviews, 0), visitorDays: uniques.find(r => r.id === site.id)?.n ?? 0 })).sort((a,b) => b.pageviews - a.pageviews || a.name.localeCompare(b.name));
  const buckets: OrganisationPeriod["buckets"] = [];
  for (let at = Date.parse(range.from + "T00:00:00Z"); at <= Date.parse(range.to + "T00:00:00Z"); at += DAY_MS) {
    const day = utcDay(at);
    const daily = rows.filter(r => r.day === day);
    buckets.push({ day, pageviews: daily.reduce((n,r) => n+r.pageviews,0), visitorDays: daily.reduce((n,r) => n+r.visitorDays,0) });
  }
  const first = Date.parse(range.from + "T00:00:00Z");
  const last = Date.parse(range.to + "T00:00:00Z") + DAY_MS;
  const selected = selectedSessions(s.where, s.params);
  const m = (!section || section === 'measurement' ? (await sql.all<{ visits: number; bounces: number; measuredVisits: number; visibleMs: number }>(`WITH selected AS (${selected.sql}),
    sessions AS (SELECT x.site_id,x.session_id,COALESCE(v.at,(SELECT MIN(e.at) FROM events e WHERE e.site_id=x.site_id AND e.session_id=x.session_id)) AS started,
      (SELECT COUNT(*) FROM events e WHERE e.site_id=x.site_id AND e.session_id=x.session_id AND e.type='pageview') AS pv,
      (SELECT COUNT(*) FROM events e WHERE e.site_id=x.site_id AND e.session_id=x.session_id AND e.type='event') +
      (SELECT COUNT(*) FROM events e JOIN page_goal_matches g ON g.event_id=e.id WHERE e.site_id=x.site_id AND e.session_id=x.session_id) AS goals
      FROM selected x LEFT JOIN visits v ON v.site_id=x.site_id AND v.session_id=x.session_id)
    SELECT COUNT(*) AS visits,COALESCE(SUM(pv=1 AND goals=0),0) AS bounces,COALESCE(SUM(v.observed),0) AS measuredVisits,COALESCE(SUM(v.visible_ms),0) AS visibleMs
    FROM sessions s LEFT JOIN visits v ON v.session_id=s.session_id AND v.site_id=s.site_id WHERE s.started>=? AND s.started<?`, [...selected.params,first,last]))[0] : undefined) ?? { visits:0,bounces:0,measuredVisits:0,visibleMs:0 };
  const measurement = {...m,bounceRate:m.visits?m.bounces/m.visits:0,duration:m.measuredVisits?Math.round(m.visibleMs/m.measuredVisits/1000):null};
  return { conversions, goals, measurement, projects, buckets, totals: projects.reduce((n,p) => ({ pageviews: n.pageviews+p.pageviews, visitorDays: n.visitorDays+p.visitorDays }), { pageviews: 0, visitorDays: 0 }) };
}
export const ORGANISATION_SECTIONS = ['summary','series','goals','measurement'] as const;
export type OrganisationSection = typeof ORGANISATION_SECTIONS[number];
export function organisationSection(value: string): OrganisationSection {
  const section = ORGANISATION_SECTIONS.find(s=>s===value);
  if (!section) throw invalid('Choose summary, series, goals or measurement.');
  return section;
}
export async function organisationReport(sql: Sql, id: string, query: ReportQuery, section?: OrganisationSection): Promise<OrganisationReport> {
  const sourceSql = sql;
  sql = await organisationAggregateSql(sql, id);
  const organisation = await getOrganisation(sql, id);
  const main = await period(sql, id, query.main, query.filters, sourceSql, section);
  const prev = query.cmp ? await period(sql, id, query.cmp, query.filters, sourceSql, section) : null;
  return { organisation, timezone: "UTC", main, prev };
}
