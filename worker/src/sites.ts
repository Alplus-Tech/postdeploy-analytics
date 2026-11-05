import { hostname, aliases, excludedPaths, safePath } from "./privacy.ts";
import { getOrganisation } from "./organisations.ts";
import { DAY_MS, HttpError, invalid, isRecord, localTime, utcDay, type Sql } from "./sql.ts";

export const KINDS = ["store", "saas", "docs"] as const;
export type Kind = (typeof KINDS)[number];
export type Goal = { id: string; name: string; revenue: boolean; type?: "event" | "page"; path?: string; createdAt?: number; archived?: boolean };
export type StepMatch = { page: string } | { goal: string };
export type Funnel = { name: string; steps: { name: string; match: StepMatch }[] };
export type Settings = { retentionMonths: number; excludeBots: boolean; respectDnt: boolean; publicDashboard: boolean };

export type Site = {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
  organisationId: string;
  kind: Kind;
  currency: string;
  timezone: string;
  created: string;
  excludedPaths: string[];
  settings: Settings;
  goals: Goal[];
  funnel: Funnel;
  visitors30d: number;
  lastEventAt: number | null;
};

export type SiteRow = {
  id: string;
  name: string;
  domain: string;
  aliases: string;
  excluded_paths: string;
  organisation_id: string;
  kind: Kind;
  currency: string;
  timezone: string;
  created: string;
  retention_months: number;
  exclude_bots: number;
  respect_dnt: number;
  public_dashboard: number;
  goals: string;
  funnel: string;
};

export const STARTERS: Record<Kind, { goals: Goal[]; funnel: Funnel }> = {
  store: {
    goals: [
      { id: "purchase", name: "Purchase", revenue: true },
      { id: "add_to_cart", name: "Add to cart", revenue: false },
      { id: "newsletter", name: "Newsletter signup", revenue: false },
    ],
    funnel: {
      name: "Checkout",
      steps: [
        { name: "Visited a product", match: { page: "/products/" } },
        { name: "Added to cart", match: { goal: "add_to_cart" } },
        { name: "Started checkout", match: { page: "/checkout" } },
        { name: "Purchased", match: { goal: "purchase" } },
      ],
    },
  },
  saas: {
    goals: [
      { id: "subscription", name: "Paid subscription", revenue: true },
      { id: "trial", name: "Started trial", revenue: false },
      { id: "demo", name: "Booked a demo", revenue: false },
    ],
    funnel: {
      name: "Trial to paid",
      steps: [
        { name: "Visited pricing", match: { page: "/pricing" } },
        { name: "Started trial", match: { goal: "trial" } },
        { name: "Subscribed", match: { goal: "subscription" } },
      ],
    },
  },
  docs: {
    goals: [
      { id: "pro_upgrade", name: "Pro license", revenue: true },
      { id: "copy_install", name: "Copied install command", revenue: false },
      { id: "star_repo", name: "Opened repository", revenue: false },
    ],
    funnel: {
      name: "Upgrade to Pro",
      steps: [
        { name: "Read the docs", match: { page: "/docs" } },
        { name: "Viewed pricing", match: { page: "/pricing" } },
        { name: "Purchased Pro", match: { goal: "pro_upgrade" } },
      ],
    },
  },
};

export const SITE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RETENTION_MONTHS = [0, 6, 12, 24];

export function isKind(value: unknown): value is Kind {
  return KINDS.some((k) => k === value);
}

export function revenueGoal(goals: readonly Goal[]): Goal | undefined {
  return goals.find((g) => g.revenue);
}

export function parseGoals(json: string): Goal[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error("goals column is not an array");
  return value.filter(isRecord).map((g) => ({ id: String(g.id), name: String(g.name), revenue: g.revenue === true, type: g.type === "page" ? "page" : "event", ...(typeof g.path === "string" ? { path: g.path } : {}), ...(typeof g.createdAt === "number" ? { createdAt: g.createdAt } : {}), archived: g.archived === true }));
}

export function parseFunnel(json: string): Funnel {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || !Array.isArray(value.steps)) throw new Error("funnel column is malformed");
  const steps = value.steps.filter(isRecord).map((s) => {
    const m = isRecord(s.match) ? s.match : {};
    const match: StepMatch = typeof m.page === "string" ? { page: m.page } : { goal: String(m.goal) };
    return { name: String(s.name), match };
  });
  return { name: String(value.name), steps };
}

function toSite(row: SiteRow & { visitors30d: number; last_event_at: number | null }): Site {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    aliases: JSON.parse(row.aliases) as string[],
    excludedPaths: JSON.parse(row.excluded_paths) as string[],
    organisationId: row.organisation_id,
    kind: row.kind,
    currency: row.currency,
    timezone: row.timezone,
    created: row.created,
    settings: {
      retentionMonths: row.retention_months,
      excludeBots: row.exclude_bots === 1,
      respectDnt: row.respect_dnt === 1,
      publicDashboard: false,
    },
    goals: parseGoals(row.goals),
    funnel: parseFunnel(row.funnel),
    visitors30d: row.visitors30d,
    lastEventAt: row.last_event_at,
  };
}

// Each website's last 30 days end on its own local today, the same window a 30-day report uses.
const SITE_SELECT = `SELECT s.*,
  (SELECT COUNT(DISTINCT e.visitor_id) FROM events e
    JOIN (SELECT json_extract(value, '$[0]') AS id, json_extract(value, '$[1]') AS first, json_extract(value, '$[2]') AS last FROM json_each(?)) w
      ON w.id = e.site_id
    WHERE e.site_id = s.id AND e.day >= w.first AND e.day <= w.last) AS visitors30d,
  (SELECT MAX(at) FROM events e WHERE e.site_id = s.id) AS last_event_at
  FROM sites s`;

async function last30Days(sql: Sql, now: number, id?: string): Promise<string> {
  const zones = await sql.all<{ id: string; timezone: string }>(
    id === undefined ? "SELECT id, timezone FROM sites" : "SELECT id, timezone FROM sites WHERE id = ?",
    id === undefined ? [] : [id],
  );
  return JSON.stringify(zones.map((z) => {
    const today = localTime(now, z.timezone).day;
    return [z.id, utcDay(Date.parse(`${today}T00:00:00Z`) - 29 * DAY_MS), today];
  }));
}

export type SiteMetadata = {id:string;name:string;organisationId:string};
export async function listSiteMetadata(sql: Sql): Promise<SiteMetadata[]> {
  return sql.all<SiteMetadata>('SELECT id,name,organisation_id AS organisationId FROM sites ORDER BY created,name,id');
}

export async function listSites(sql: Sql, now: number): Promise<Site[]> {
  const rows = await sql.all<SiteRow & { visitors30d: number; last_event_at: number | null }>(
    `${SITE_SELECT} ORDER BY s.created, s.name`,
    [await last30Days(sql, now)],
  );
  return rows.map(toSite);
}

export async function getSite(sql: Sql, id: string, now: number): Promise<Site> {
  const site = SITE_ID.test(id)
    ? (await sql.all<SiteRow & { visitors30d: number; last_event_at: number | null }>(`${SITE_SELECT} WHERE s.id = ?`, [await last30Days(sql, now, id), id]))[0]
    : undefined;
  if (!site) throw new HttpError(404, "unknown_site", "No website has this id.");
  return toSite(site);
}

export function siteRowValues(input: { id: string; name: string; domain: string; kind: Kind; currency: string; timezone: string; created: string }): (string | number)[] {
  const starter = STARTERS[input.kind];
  return [input.id, input.name, input.domain, input.kind, input.currency, input.timezone, input.created, JSON.stringify(starter.goals), JSON.stringify(starter.funnel)];
}

export const INSERT_SITE = "INSERT INTO sites (id, name, domain, kind, currency, timezone, created, goals, funnel, respect_dnt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)";

function requireString(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    throw invalid(`${key} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function rejectUnknownKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(body).find((k) => !allowed.includes(k));
  if (extra !== undefined) throw invalid(`Unknown field: ${extra}.`);
}

function slug(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return base || "site";
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSite(sql: Sql, body: unknown, now: number): Promise<Site> {
  if (!isRecord(body)) throw invalid("Expected a JSON object.");
  rejectUnknownKeys(body, ["name", "domain", "aliases", "kind", "organisationId"]);
  const organisationId = body.organisationId === undefined ? "default" : requireString(body, "organisationId", 80);
  await getOrganisation(sql, organisationId);
  const name = requireString(body, "name", 80);
  const domain = hostname(body.domain);
  const hosts = aliases(body.aliases ?? [], domain);
  const kind = body.kind;
  if (!isKind(kind)) throw invalid("kind must be store, saas or docs.");

  const taken = await sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM sites WHERE domain = ?", [domain]);
  if ((taken[0]?.n ?? 0) > 0) throw new HttpError(409, "domain_taken", "A website with this domain already exists.");

  let id = slug(name);
  const clash = await sql.all<{ id: string }>("SELECT id FROM sites WHERE id = ?", [id]);
  if (clash.length > 0) id = `${id}-${randomHex(3)}`;

  try {
    await sql.run("INSERT INTO sites (id, name, domain, kind, currency, timezone, created, goals, funnel, organisation_id, aliases, respect_dnt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", [...siteRowValues({ id, name, domain, kind, currency: "$", timezone: "UTC", created: utcDay(now) }), organisationId, JSON.stringify(hosts)]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new HttpError(409, "domain_taken", "A website with this domain already exists.");
    }
    throw error;
  }
  return getSite(sql, id, now);
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function updateSite(sql: Sql, id: string, body: unknown, now: number): Promise<Site> {
  const current = await getSite(sql, id, now);
  if (!isRecord(body)) throw invalid("Expected a JSON object.");
  rejectUnknownKeys(body, ["name", "timezone", "retentionMonths", "excludeBots", "respectDnt", "publicDashboard", "organisationId", "domain", "aliases", "excludedPaths"]);
  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (body.domain !== undefined || body.aliases !== undefined) {
    const domain = body.domain === undefined ? current.domain : hostname(body.domain);
    sets.push("domain = ?", "aliases = ?");
    params.push(domain, JSON.stringify(aliases(body.aliases ?? current.aliases, domain)));
  }
  if (body.excludedPaths !== undefined) {
    sets.push("excluded_paths = ?");
    params.push(JSON.stringify(excludedPaths(body.excludedPaths)));
  }
  if (body.publicDashboard === true) throw invalid("Public dashboards are unavailable in v1.");
  if (body.organisationId !== undefined) {
    const org = requireString(body, "organisationId", 80);
    await getOrganisation(sql, org);
    sets.push("organisation_id = ?");
    params.push(org);
  }
  if (body.name !== undefined) {
    sets.push("name = ?");
    params.push(requireString(body, "name", 80));
  }
  if (body.timezone !== undefined) {
    const tz = requireString(body, "timezone", 64);
    if (!isTimeZone(tz)) throw invalid("timezone must be an IANA time zone such as Europe/London.");
    sets.push("timezone = ?");
    params.push(tz);
  }
  if (body.retentionMonths !== undefined) {
    const months = body.retentionMonths;
    if (typeof months !== "number" || !RETENTION_MONTHS.includes(months)) {
      throw invalid(`retentionMonths must be one of ${RETENTION_MONTHS.join(", ")}.`);
    }
    sets.push("retention_months = ?");
    params.push(months);
  }
  for (const [key, column] of [["excludeBots", "exclude_bots"], ["respectDnt", "respect_dnt"], ["publicDashboard", "public_dashboard"]] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw invalid(`${key} must be true or false.`);
    sets.push(`${column} = ?`);
    params.push(value ? 1 : 0);
  }
  if (sets.length === 0) throw invalid("Nothing to update.");

  try {
    await sql.run(`UPDATE sites SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new HttpError(409, "domain_taken", "A hostname already belongs to another project.");
    throw error;
  }
  return getSite(sql, id, now);
}

export async function deleteSite(sql: Sql, id: string, now: number): Promise<void> {
  await getSite(sql, id, now);
  const removed = await sql.all<{ id: string }>("DELETE FROM sites WHERE id = ? AND NOT EXISTS (SELECT 1 FROM events WHERE site_id = ?) RETURNING id", [id, id]);
  if (removed.length === 0) throw new HttpError(409, "project_has_history", "Projects with history cannot be deleted. Move the project to another organisation instead.");
}

export async function verifySite(sql: Sql, id: string, now: number): Promise<{ received: boolean; lastEventAt: number | null; events: number }> {
  await getSite(sql, id, now);
  const rows = await sql.all<{ n: number; last: number | null }>("SELECT COUNT(*) AS n, MAX(at) AS last FROM events WHERE site_id = ?", [id]);
  const n = rows[0]?.n ?? 0;
  return { received: n > 0, lastEventAt: rows[0]?.last ?? null, events: n };
}

export async function saveGoal(sql: Sql, siteId: string, body: unknown, now: number, id?: string): Promise<Site> {
  await getSite(sql, siteId, now);
  if (!isRecord(body)) throw invalid("Expected a JSON object.");
  rejectUnknownKeys(body, id ? ["name", "archived"] : ["name", "type", "event", "path"]);
  const snapshot = (await sql.all<{goals:string}>("SELECT goals FROM sites WHERE id=?", [siteId]))[0]?.goals;
  if (snapshot === undefined) throw invalid("Project unavailable.");
  const goals = parseGoals(snapshot);
  if (id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) throw new HttpError(404, "unknown_goal", "No goal has this id.");
    if (body.name !== undefined) goal.name = requireString(body, "name", 80);
    if (body.archived !== undefined) {
      if (body.archived !== true) throw invalid("Archived rules cannot be reactivated. Create a new rule.");
      goal.archived = true;
    }
  } else {
    if (goals.length >= 40) throw invalid("At most 40 goals including archived goals per project.");
    const name = requireString(body, "name", 80);
    if (body.type !== "event" && body.type !== "page") throw invalid("Choose event or page.");
    const path = body.type === "page" && typeof body.path === "string" ? safePath(body.path) : null;
    if (body.type === "page" && (!path || !String(body.path).startsWith("/") || String(body.path).includes("?") || String(body.path).includes("#"))) throw invalid("Provide a page path without a query or fragment.");
    const event = body.type === "event" ? requireString(body, "event", 40) : "page_" + crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    if (!/^[a-z0-9_]{1,40}$/.test(event)) throw invalid("Event names use 1–40 lowercase letters, digits or underscores.");
    if (goals.some(g => g.id === event || (path !== null && g.path === path))) throw invalid("This matching rule already exists, including archived history.");
    if (body.type === "event" && (await sql.all<{id:number}>("SELECT id FROM events WHERE site_id=? AND type='event' AND name=? LIMIT 1", [siteId,event])).length) throw invalid("This event name has retained history. Choose a new event name for a prospective rule.");
    goals.push({ id: event, name, revenue: false, type: body.type, ...(path ? { path } : {}), createdAt: now });
  }
  const updated = await sql.all<{id:string}>("UPDATE sites SET goals=? WHERE id=? AND goals=? RETURNING id", [JSON.stringify(goals), siteId, snapshot]);
  if (!updated.length) throw new HttpError(409, "goal_conflict", "Goals changed. Reload and try again.");
  return getSite(sql, siteId, now);
}
