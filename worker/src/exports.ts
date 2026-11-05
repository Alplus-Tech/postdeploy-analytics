import { invalid } from "./sql.ts";
import type { Report, ReportQuery } from "./report.ts";
import { DIMENSIONS } from "./report.ts";
import type { OrganisationReport } from "./organisations.ts";

type Cell = string | number | boolean | null | undefined;
type RecordRow = Record<string, Cell>;
function cell(value: Cell): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\p{White_Space}\p{C}\p{Z}]*[=+\-@]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csvResponse(rows: RecordRow[], context: RecordRow, dataset: string): Response {
  if (rows.length > 10000) throw invalid("Export exceeds 10,000 rows. Narrow the range or filters.");
  const records = rows.map(row => ({ ...context, ...row }));
  const metrics = ["visitors","pageviews","visits","bounces","bounceRate","measuredVisits","visibleMs","duration","conversions","convertedVisitorDays","conversionVisitorDays","conversionRate","revenue"];
  const fields = dataset === "goals" ? ["projectId","goalId","name","archived","completions","convertedVisitorDays","visitorDays","rate"]
    : dataset === "projects" ? ["id","name","domain","timezone_project","pageviews","visitorDays"]
    : dataset === "series" ? ["granularity","start","label","future","day","visitorDays",...metrics]
    : dataset === "totals" ? [...metrics,"completions","visitorDays","rate"]
    : ["name","note","visitors","pageviews","conversions","convertedVisitorDays","conversionVisitorDays","conversionRate","purchases","revenue"];
  const insightFields: Record<string,string[]> = {
    'insights-timeline':['label','key','pageviews','visitorDays','conversionVisitorDays','completions','convertedVisitorDays','rate'],
    'insights-ranking':['label','key','pageviews','visitorDays','conversionVisitorDays','completions','convertedVisitorDays','rate'],
    'insights-composition':['bucket','category','key','pageviews'],
    'insights-heatmap':['weekday','hour','pageviews'],
    'insights-duration':['label','visits'],
  };
  const columns = [...new Set([...Object.keys(context), "period", ...(insightFields[dataset] ?? fields).filter(k=>!(k in context))])];
  const text = "\uFEFF" + [columns.map(cell).join(","), ...records.map(row => columns.map(k => cell(row[k])).join(","))].join("\r\n") + "\r\n";
  return new Response(text, { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="postdeploy-${dataset}.csv"`,
    "Cache-Control": "no-store",
  } });
}
function context(query: ReportQuery, timezone: string, scope: string, dataset: string): RecordRow {
  return { scope, timezone, from: query.main.from, to: query.main.to, filters: JSON.stringify(query.filters), dataset,
    units: "daily visitor-days; completions are occurrences; duration seconds; rates fractions",
    limits: "731 days; 10000 export rows; breakdowns referrer,campaign,page capped at displayed top 100",
    population: "completion/event window; daily identity uses project local day; duration uses measured visits" };
}
export function projectCsv(report: Report, query: ReportQuery, timezone: string, dataset: string): Response {
  const periods = [{label:"selected",value:report.main,range:query.main}, ...(report.prev && query.cmp ? [{label:"comparison",value:report.prev,range:query.cmp}] : [])];
  const rows: RecordRow[] = [];
  for (const p of periods) {
    const common = {period:p.label,from:p.range.from,to:p.range.to};
    if(dataset === "goals") {
      for(const g of report.goals) rows.push({...common,projectId:query.site,goalId:g.id,name:g.name,archived:g.archived??false,...p.value.totals.goalRates[g.id]});
    } else if(dataset === "series") {
      for(const b of p.value.buckets) {
        const {goals: _goals,goalRates:_rates,...metrics}=b;
        rows.push({...common,granularity:p.value.gran,...metrics});
      }
    } else if(dataset === "totals") {
      const {goals:_goals,goalRates:_rates,...metrics}=p.value.totals;
      rows.push({...common,...metrics});
    } else {
      const dim = DIMENSIONS.find(d=>d===dataset);
      if(!dim) throw invalid("Choose totals, goals, series or a supported dimension.");
      for(const r of p.value.breakdowns[dim]) {
        const {goalRates:_rates,...metrics}=r;
        rows.push({...common,...metrics});
      }
    }
  }
  return csvResponse(rows,context(query,timezone,query.site,dataset),dataset);
}
export function organisationCsv(report: OrganisationReport, query: ReportQuery, dataset: string): Response {
  const rows: RecordRow[]=[];
  for(const p of [{label:"selected",value:report.main,range:query.main},...(report.prev&&query.cmp?[{label:"comparison",value:report.prev,range:query.cmp}]:[])]) {
    const common={period:p.label,from:p.range.from,to:p.range.to};
    if(dataset==="goals") for(const row of p.value.goals) rows.push({...common,...row});
    else if(dataset==="projects") for(const row of p.value.projects) { const {timezone,...metrics}=row; rows.push({...common,...metrics,timezone_project:timezone}); }
    else if(dataset==="series") for(const row of p.value.buckets) rows.push({...common,...row});
    else if(dataset==="totals") rows.push({...common,...p.value.totals,...p.value.measurement,...p.value.conversions});
    else throw invalid("Choose totals, goals, projects or series.");
  }
  return csvResponse(rows,context(query,"UTC",report.organisation.id,dataset),dataset);
}
