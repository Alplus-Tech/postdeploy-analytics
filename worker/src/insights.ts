import { aggregateSql, organisationAggregateSql, sharedEventAggregates, compareSqlKeys } from './aggregate-sql.ts';
import { selectedSessions } from './session-selection.ts';
import { eventScope, granularity, type ReportQuery, type DayRange } from './report.ts';
import { getOrganisation, organisationScope } from './organisations.ts';
import { getSite, parseGoals } from './sites.ts';
import { DAY_MS, invalid, type Sql, type SqlValue } from './sql.ts';
import { csvResponse } from './exports.ts';

export type InsightRow = { label: string; key: string; pageviews: number; visitorDays: number; completions: number; conversionVisitorDays: number; convertedVisitorDays: number; rate: number };
export type InsightPeriod = { granularity: string; totals: InsightRow; timeline: InsightRow[]; composition: { bucket: string; category: string; key: string; pageviews: number }[]; ranking: InsightRow[]; heatmap: { weekday: number; hour: number; pageviews: number }[]; duration: { label: string; visits: number }[] };
export type Insights = { name: string; selectedGoal: string; timezone: string; organisation: boolean; dimension: string; compositionDimension: string; goals: { key: string; name: string }[]; main: InsightPeriod; prev: InsightPeriod | null };
const RANK = { source: 'source', page: 'path', entry: 'entry_path', campaign: 'campaign', project: 'site_id' } as const;
const key = (project: string, goal: string): string => JSON.stringify([project, goal]);
const rate = (row: Omit<InsightRow, 'rate'>): InsightRow => ({ ...row, rate: row.conversionVisitorDays ? row.convertedVisitorDays / row.conversionVisitorDays : 0 });

export const INSIGHT_SECTIONS = ['summary','timeline','composition','ranking','heatmap','duration'] as const;
export type InsightSection = typeof INSIGHT_SECTIONS[number];
export function insightSection(value: string): InsightSection {
  const section = INSIGHT_SECTIONS.find(s => s === value);
  if (!section) throw invalid('Choose summary, timeline, composition, ranking, heatmap or duration.');
  return section;
}
type InsightSectionPeriod = Omit<Partial<InsightPeriod>,'totals'|'timeline'> & {totals?:Partial<InsightRow>;timeline?:(InsightRow|Pick<InsightRow,'key'|'label'|'pageviews'>)[]};
export type InsightSectionResponse = Omit<Insights,'main'|'prev'> & {
  section: InsightSection;
  main: InsightSectionPeriod;
  prev: InsightSectionPeriod | null;
};
export function selectInsightSection(data: Insights, section: InsightSection): InsightSectionResponse {
  const select = (p: InsightPeriod): InsightSectionResponse['main'] => {
    if(section === 'summary') return {granularity:p.granularity,totals:{pageviews:p.totals.pageviews,visitorDays:p.totals.visitorDays}};
    return {granularity:p.granularity,[section]:p[section],...(section==='ranking'?{totals:p.totals}:{}),...(section==='composition'?{timeline:p.timeline.map(b=>({key:b.key,label:b.label,pageviews:p.composition.filter(r=>r.bucket===b.key).reduce((n,r)=>n+r.pageviews,0)}))}:{})};
  };
  return {...data,section,main:select(data.main),prev:data.prev?select(data.prev):null};
}
export async function buildInsights(sql: Sql, query: ReportQuery, params: URLSearchParams, now: number, org?: string, section?: InsightSection): Promise<Insights> {
  const sourceSql = sql;
  sql = org ? await organisationAggregateSql(sql, org) : await aggregateSql(sql);
  const projects = org ? await sql.all<{ id: string; name: string; timezone: string; goals: string }>('SELECT id,name,timezone,goals FROM sites WHERE organisation_id=? ORDER BY name,id LIMIT 51', [org]) : [];
  const site = org ? null : await getSite(sql, query.site, now);
  const organisation = org ? await getOrganisation(sql, org) : null;
  if (projects.length > 50) throw invalid('Insights supports up to 50 projects per organisation. Select a project.');
  const names = new Map(projects.map(p => [p.id, p.name]));
  const goals = org ? projects.flatMap(p => parseGoals(p.goals).map(g => ({ key: key(p.id, g.id), name: `${p.name} · ${g.name}${g.archived ? ' (archived)' : ''}` }))) : (site?.goals ?? []).map(g => ({ key: key(query.site, g.id), name: g.name + (g.archived ? ' (archived)' : '') }));
  const selected = params.get('goal') ?? '';
  if (selected && !goals.some(g => g.key === selected)) throw invalid('Choose a goal from this report scope.');
  const goalPair = selected ? JSON.parse(selected) as [string, string] : null;
  const dimension = params.get('dimension') ?? (org ? 'project' : 'source');
  if (!(dimension in RANK) || !Object.hasOwn(RANK, dimension)) throw invalid('Choose source, page, entry, campaign or project.');
  const rankColumn = RANK[dimension as keyof typeof RANK];
  const compositionDimension = params.get('composition') ?? 'source';
  if (!['source', 'project'].includes(compositionDimension)) throw invalid('Composition must be source or project.');
  const timezone = org ? 'UTC' : site?.timezone ?? 'UTC';
  const label = (value: string, project: boolean): string => project ? names.get(value) ?? site?.name ?? value : value || '(not set)';
  async function period(range: DayRange): Promise<InsightPeriod> {
    const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY_MS) + 1;
    const gran = granularity(days);
    const scope = org ? organisationScope(org, range, query.filters) : eventScope(query.site, range, query.filters);
    const where = 'where' in scope ? scope.where : scope.sql;
    const date = org ? "date(at/1000,'unixepoch')" : 'day';
    const hour = org ? "CAST(strftime('%H',at/1000,'unixepoch') AS INTEGER)" : 'hour';
    const bucket = gran === 'hour' ? hour : gran === 'day' ? date : `CAST((julianday(${date})-julianday(?))/7 AS INTEGER)`;
    const bucketParams: SqlValue[] = gran === 'week' ? [range.from] : [];
    const cte = `WITH ev AS (SELECT *, ${date} AS chart_day, ${hour} AS chart_hour, ${bucket} AS bucket FROM analytics_events${org ? ' e' : ''} WHERE ${where})`;
    const bound = [...bucketParams, ...scope.params];
    const match = goalPair ? "type='event' AND site_id=? AND name=?" : "type='event'";
    const goalParams: SqlValue[] = goalPair ? [...goalPair] : [];
    const identity = "site_id||':'||day||':'||visitor_id";
    const denominator = goalPair ? `COUNT(DISTINCT CASE WHEN site_id=? THEN ${identity} END)` : `COUNT(DISTINCT ${identity})`;
    const denominatorParams: SqlValue[] = goalPair ? [goalPair[0]] : [];
    const agg = `SUM(type='pageview') AS pageviews, COUNT(DISTINCT ${identity}) AS visitorDays, ${denominator} AS conversionVisitorDays, SUM(${match}) AS completions, COUNT(DISTINCT CASE WHEN ${match} THEN ${identity} END) AS convertedVisitorDays`;
    const aggParams = [...denominatorParams, ...goalParams, ...goalParams];
    const compColumn = compositionDimension === 'project' ? 'site_id' : 'source';
    const queries = [
      {body:` SELECT '' AS label,'' AS key,COALESCE(SUM(type='pageview'),0) AS pageviews,COUNT(DISTINCT ${identity}) AS visitorDays,${denominator} AS conversionVisitorDays,COALESCE(SUM(${match}),0) AS completions,COUNT(DISTINCT CASE WHEN ${match} THEN ${identity} END) AS convertedVisitorDays FROM ev`,params:aggParams,fields:['label','key','pageviews','visitorDays','conversionVisitorDays','completions','convertedVisitorDays']},
      {body:` SELECT bucket AS key,'' AS label,${agg} FROM ev GROUP BY bucket`,params:aggParams,fields:['key','label','pageviews','visitorDays','conversionVisitorDays','completions','convertedVisitorDays']},
      {body:`, top AS (SELECT ${compColumn} AS k FROM ev WHERE type='pageview' GROUP BY k ORDER BY COUNT(*) DESC,k LIMIT 6), grouped AS (SELECT *,CASE WHEN ${compColumn} IN (SELECT k FROM top) THEN 'v:'||${compColumn} ELSE 'other' END AS category_key FROM ev WHERE type='pageview') SELECT bucket,category_key AS key,MIN(${compColumn}) AS category,COUNT(*) AS pageviews FROM grouped GROUP BY bucket,category_key`,params:[],fields:['bucket','key','category','pageviews']},
      {body:`, top AS (SELECT ${rankColumn} AS k FROM ev GROUP BY k ORDER BY SUM(type='pageview') DESC,k LIMIT 20), grouped AS (SELECT *,CASE WHEN ${rankColumn} IN (SELECT k FROM top) THEN 'v:'||${rankColumn} ELSE 'other' END AS category_key FROM ev) SELECT category_key AS key,MIN(${rankColumn}) AS label,${agg} FROM grouped GROUP BY category_key ORDER BY pageviews DESC,category_key`,params:aggParams,fields:['key','label','pageviews','visitorDays','conversionVisitorDays','completions','convertedVisitorDays']},
      {body:` SELECT CAST(strftime('%w',chart_day) AS INTEGER) AS weekday,chart_hour AS hour,COUNT(*) AS pageviews FROM ev WHERE type='pageview' GROUP BY weekday,chart_hour`,params:[],fields:['weekday','hour','pageviews']}
    ];
    const families = ['summary','timeline','composition','ranking','heatmap'];
    const chosen = queries.flatMap((q,i) => !section || (families[i] === section || (section === 'ranking' && i === 0)) ? [{q,i}] : []);
    const results = section === 'summary' ? [await sql.all<Record<string,unknown>>(`SELECT '' AS label,'' AS key,COALESCE(SUM(pageviews),0) AS pageviews,COALESCE(SUM(visitorDays),0) AS visitorDays FROM (SELECT site_id,day,SUM(type='pageview') AS pageviews,COUNT(DISTINCT ''||visitor_id) AS visitorDays FROM events${org ? ' e' : ''} WHERE ${where} GROUP BY site_id,day)`,scope.params)] : chosen.length ? await sharedEventAggregates(sourceSql, cte, bound, chosen.map(c=>c.q), org) : [];
    const eventRows = queries.map((_,i)=>results[chosen.findIndex(c=>c.i===i)] ?? []);
    const totalsRows = eventRows[0] as Omit<InsightRow, 'rate'>[];
    const timelineRows = eventRows[1] as Omit<InsightRow, 'rate'>[];
    const compositionRows = eventRows[2] as { bucket: string; category: string; key: string; pageviews: number }[];
    const rankingRows = eventRows[3] as Omit<InsightRow, 'rate'>[];
    rankingRows.sort((a,b)=>b.pageviews-a.pageviews || compareSqlKeys(a.key,b.key));
    compositionRows.sort((a,b)=>(gran==='day'?compareSqlKeys(a.bucket,b.bucket):Number(a.bucket)-Number(b.bucket)) || compareSqlKeys(a.key,b.key));
    const heatRows = eventRows[4] as { weekday: number; hour: number; pageviews: number }[];
    const totals = totalsRows[0];

    const count = gran === 'hour' ? 24 : gran === 'week' ? Math.ceil(days / 7) : days;
    const timeline = Array.from({ length: count }, (_, i) => {
      const k = gran === 'day' ? new Date(Date.parse(range.from) + i * DAY_MS).toISOString().slice(0, 10) : String(i);
      const label = gran === 'hour' ? `${range.from} ${String(i).padStart(2,'0')}:00` : new Date(Date.parse(range.from) + i * (gran === 'week' ? 7 : 1) * DAY_MS).toISOString().slice(0,10);
      return rate({ pageviews: 0, visitorDays: 0, conversionVisitorDays: 0, completions: 0, convertedVisitorDays: 0, ...timelineRows.find(r => String(r.key) === k), key: k, label });
    });

    const composition = compositionRows.map(r => ({...r, bucket: String(r.bucket), category: r.key === 'other' ? 'Other (remaining categories)' : label(r.category, compositionDimension === 'project')}));

    const ranking = rankingRows.map(r => rate({...r, label: r.key === 'other' ? 'Other (remaining categories)' : label(r.label,dimension === 'project')}));

    const heatmap = Array.from({length:168},(_,i)=>({weekday:Math.floor(i/24),hour:i%24,pageviews:heatRows.find(r=>r.weekday===Math.floor(i/24)&&r.hour===i%24)?.pageviews??0}));
    const first = Date.parse(range.from), last = Date.parse(range.to)+DAY_MS;
    const visitBoundary = org ? 'started>=? AND started<?' : 'start_day>=? AND start_day<=?';
    const sessions = selectedSessions(where, scope.params);
    const durationRows = !section || section === 'duration' ? await sql.all<{ bin: number; visits: number }>(`WITH selected AS (${sessions.sql}), sessions AS (SELECT s.site_id,s.session_id,COALESCE(v.at,(SELECT MIN(e.at) FROM events e WHERE e.site_id=s.site_id AND e.session_id=s.session_id)) AS started,COALESCE(v.day,(SELECT MIN(e.day) FROM events e WHERE e.site_id=s.site_id AND e.session_id=s.session_id)) AS start_day,COALESCE(v.observed,0) AS observed,COALESCE(v.visible_ms,0) AS visible_ms FROM selected s LEFT JOIN visits v ON v.site_id=s.site_id AND v.session_id=s.session_id) SELECT CASE WHEN observed=0 THEN 6 WHEN visible_ms<10000 THEN 0 WHEN visible_ms<30000 THEN 1 WHEN visible_ms<60000 THEN 2 WHEN visible_ms<180000 THEN 3 WHEN visible_ms<600000 THEN 4 ELSE 5 END AS bin,COUNT(*) AS visits FROM sessions WHERE ${visitBoundary} GROUP BY bin`, [...sessions.params,...(org?[first,last]:[range.from,range.to])]) : [];
    const duration = ['0–<10 seconds','10–<30 seconds','30–<60 seconds','1–<3 minutes','3–<10 minutes','10+ minutes','Unknown (unmeasured)'].map((label,i)=>({label,visits:durationRows.find(r=>r.bin===i)?.visits??0}));
    return {granularity:gran,totals:rate(totals ?? {label:'',key:'',pageviews:0,visitorDays:0,conversionVisitorDays:0,completions:0,convertedVisitorDays:0}),timeline,composition,ranking,heatmap,duration};
  }
  const main = await period(query.main);
  const prev = query.cmp ? await period(query.cmp) : null;
  return { selectedGoal: selected, name: organisation?.name ?? site?.name ?? '', timezone, organisation: !!org, dimension, compositionDimension, goals, main, prev };
}

export function insightsCsv(data: Insights, query: ReportQuery, dataset: string): Response {
  if (!['timeline','composition','ranking','heatmap','duration'].includes(dataset)) throw invalid('Choose timeline, composition, ranking, heatmap or duration.');
  const rows = [{period:'selected',value:data.main},...(data.prev?[{period:'comparison',value:data.prev}]:[])].flatMap(p => {
    const value = p.value[dataset as 'timeline'|'composition'|'ranking'|'heatmap'|'duration'];
    return value.map(row=>({period:p.period,granularity:p.value.granularity,...row}));
  });
  return csvResponse(rows,{scope:query.site,goal:data.selectedGoal,timezone:data.timezone,from:query.main.from,to:query.main.to,cmpFrom:query.cmp?.from,cmpTo:query.cmp?.to,filters:JSON.stringify(query.filters),dimension:data.dimension,composition:data.compositionDimension,granularity:data.main.granularity,units:'pageviews; visitor-days; completion occurrences; rates fractions; duration bins measured visits only',population:'event window; project/local-day identity; full duration of visits starting in range; heatmap totals (not normalised)'},`insights-${dataset}`);
}
