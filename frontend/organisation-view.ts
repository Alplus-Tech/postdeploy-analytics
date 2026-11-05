export const DAY = 86400000;
export const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

export const DIMENSIONS = [
  ["source", "Source"], ["page", "Page visited"], ["country", "Country"], ["device", "Device"],
  ["browser", "Browser"], ["campaign", "Campaign"], ["referrer", "Referrer"], ["entry", "Entry page"],
] as const;
export type Dimension = typeof DIMENSIONS[number][0];
export type Filter = { dim: Dimension; value: string };
export type Selection = { org: string; from: string; to: string; compare: "prev" | "off"; filter: Filter | null };

export const PRESETS = [["7d", 7, "Last 7 days"], ["30d", 30, "Last 30 days"], ["90d", 90, "Last 90 days"], ["365d", 365, "Last 365 days"]] as const;
export type Preset = typeof PRESETS[number][0] | "custom";

const isDimension = (value: string): value is Dimension => DIMENSIONS.some(([id]) => id === value);

export function readSelection(search: string, now: number, fallbackOrg: string): Selection {
  const q = new URLSearchParams(search);
  const f = q.get("f") ?? "";
  const at = f.indexOf(":");
  const dim = at > 0 ? f.slice(0, at) : "";
  return {
    org: q.get("org") ?? fallbackOrg,
    from: q.get("from") ?? utcDay(now - 29 * DAY),
    to: q.get("to") ?? utcDay(now),
    compare: q.get("compare") === "off" ? "off" : "prev",
    filter: isDimension(dim) && f.slice(at + 1) ? { dim, value: f.slice(at + 1) } : null,
  };
}

export function comparisonRange(from: string, to: string): { from: string; to: string } | null {
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { from: utcDay(start - (end - start) - DAY), to: utcDay(start - DAY) };
}

export function reportQuery(sel: Selection): URLSearchParams {
  const query = new URLSearchParams({ from: sel.from, to: sel.to });
  if (sel.filter) query.set("f", `${sel.filter.dim}:${sel.filter.value}`);
  const cmp = sel.compare === "prev" ? comparisonRange(sel.from, sel.to) : null;
  if (cmp) { query.set("cmpFrom", cmp.from); query.set("cmpTo", cmp.to); }
  return query;
}

export function pageAddress(sel: Selection): string {
  const address = reportQuery(sel);
  address.set("org", sel.org);
  address.set("compare", sel.compare);
  return `/organisations?${address}`;
}

export function insightsAddress(sel: Selection): string {
  const query = reportQuery(sel);
  query.set("org", sel.org);
  return `/insights?${query}`;
}

export function exportAddress(sel: Selection, dataset: string): string {
  const query = reportQuery(sel);
  query.set("dataset", dataset);
  return `/api/organisations/${encodeURIComponent(sel.org)}/export?${query}`;
}

export function projectReportAddress(projectId: string, sel: Selection): string {
  const q = new URLSearchParams({ site: projectId, range: "custom", from: sel.from, to: sel.to, cmp: sel.compare === "prev" ? "prev" : "off" });
  if (sel.filter) q.set("f", `${sel.filter.dim}:${sel.filter.value}`);
  return `/dashboard#/overview?${q}`;
}

export function presetRange(preset: Exclude<Preset, "custom">, now: number): { from: string; to: string } {
  const days = PRESETS.find(([id]) => id === preset)?.[1] ?? 30;
  return { from: utcDay(now - (days - 1) * DAY), to: utcDay(now) };
}

export function presetFor(sel: Pick<Selection, "from" | "to">, now: number): Preset {
  for (const [id] of PRESETS) {
    const range = presetRange(id, now);
    if (range.from === sel.from && range.to === sel.to) return id;
  }
  return "custom";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(day: string, withYear = false): string {
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}${withYear ? ` ${y}` : ""}`;
}
export const rangeLabel = (from: string, to: string): string => `${shortDay(from, from.slice(0, 4) !== to.slice(0, 4))} to ${shortDay(to, true)}`;

export function change(current: number, previous: number): { text: string; tone: "pos" | "neg" | "" } {
  if (previous === 0) return { text: current ? "No previous traffic" : "None in either period", tone: "" };
  const d = (current - previous) / previous;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  return { text: `${sign}${Math.abs(d * 100).toFixed(1)}%`, tone: Math.abs(d) < 0.005 ? "" : d > 0 ? "pos" : "neg" };
}

export function niceMax(v: number): number {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return Math.max(4, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p);
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
