import { hostname, safePath, pathExcluded } from "./privacy.ts";
import { DAY_MS, HttpError, invalid, isRecord, localTime, utcDay, type Sql } from "./sql.ts";
import { parseGoals, SITE_ID } from "./sites.ts";

export const MAX_BODY_BYTES = 4096;
const GOAL_ID = /^[a-z0-9_]{1,40}$/;
const MAX_URL = 2048;
const EVENT_KEYS = ["site", "type", "url", "referrer", "name", "revenue", "page", "visible"];

export type EventInput = {
  site: string;
  type: "pageview" | "event" | "activity";
  page: string | null;
  visible: number;
  url: URL;
  referrer: URL | null;
  name: string | null;
  revenue: number;
};

type KnownSource = { name: string; kind: string; host: RegExp | null; utm: string[] };

const KNOWN_SOURCES: KnownSource[] = [
  { name: "Google", kind: "Search", host: /(^|\.)google\.[a-z.]+$/, utm: ["google"] },
  { name: "Bing", kind: "Search", host: /(^|\.)bing\.com$/, utm: ["bing"] },
  { name: "DuckDuckGo", kind: "Search", host: /(^|\.)duckduckgo\.com$/, utm: ["duckduckgo", "ddg"] },
  { name: "Yahoo", kind: "Search", host: /(^|\.)yahoo\.com$/, utm: ["yahoo"] },
  { name: "Ecosia", kind: "Search", host: /(^|\.)ecosia\.org$/, utm: ["ecosia"] },
  { name: "Brave Search", kind: "Search", host: /^search\.brave\.com$/, utm: [] },
  { name: "Yandex", kind: "Search", host: /(^|\.)yandex\.[a-z.]+$/, utm: ["yandex"] },
  { name: "Baidu", kind: "Search", host: /(^|\.)baidu\.com$/, utm: ["baidu"] },
  { name: "Facebook", kind: "Social", host: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/, utm: ["facebook", "fb"] },
  { name: "Instagram", kind: "Social", host: /(^|\.)instagram\.com$/, utm: ["instagram", "ig"] },
  { name: "X", kind: "Social", host: /^t\.co$|(^|\.)(twitter\.com|x\.com)$/, utm: ["twitter", "x"] },
  { name: "LinkedIn", kind: "Social", host: /(^|\.)linkedin\.com$|^lnkd\.in$/, utm: ["linkedin"] },
  { name: "Pinterest", kind: "Social", host: /(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, utm: ["pinterest"] },
  { name: "Reddit", kind: "Social", host: /(^|\.)reddit\.com$/, utm: ["reddit"] },
  { name: "Hacker News", kind: "Social", host: /^news\.ycombinator\.com$/, utm: ["hackernews", "hn"] },
  { name: "YouTube", kind: "Social", host: /(^|\.)youtube\.com$|^youtu\.be$/, utm: ["youtube"] },
  { name: "Bluesky", kind: "Social", host: /(^|\.)bsky\.app$/, utm: ["bluesky"] },
  { name: "GitHub", kind: "Referral", host: /(^|\.)github\.com$/, utm: ["github"] },
  { name: "Newsletter", kind: "Email", host: null, utm: ["newsletter", "email"] },
];

const BOT = /bot|crawl|spider|slurp|scrape|headless|lighthouse|pagespeed|preview|uptime|monitor|facebookexternalhit|embedly|curl\/|wget|python|httpclient|okhttp|go-http|java\/|axios|node-fetch|undici|phantomjs|puppeteer|playwright|selenium/i;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function sourceKind(name: string): string | undefined {
  if (name === "Direct") return "Direct";
  return KNOWN_SOURCES.find((s) => s.name === name)?.kind;
}

export function sameSite(host: string, domain: string): boolean {
  try { return hostname(host) === hostname(domain); } catch { return false; }
}

export function originAllowed(origin: string | null, domain: string | readonly string[], development: boolean): boolean {
  if (development || origin === null || origin === "null") return true;
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && (typeof domain === "string" ? [domain] : domain).some(h => sameSite(url.hostname, h));
  } catch {
    return false;
  }
}

export function isBot(userAgent: string): boolean {
  return userAgent.length < 10 || BOT.test(userAgent);
}

export function deviceOf(userAgent: string): "Mobile" | "Tablet" | "Desktop" {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "Tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return "Mobile";
  return "Desktop";
}

export function browserOf(userAgent: string): string {
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/Edg(?:e|A|iOS)?\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera|YaBrowser|Vivaldi/.test(userAgent)) return "Other";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return "Safari";
  return "Other";
}

export function countryName(code: unknown): string {
  if (typeof code !== "string" || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return "Unknown";
  try {
    return regionNames.of(code) ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

function utmValue(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)?.trim().slice(0, 100);
  return value ? value : null;
}

export function classifySource(url: URL, referrer: URL | null, domain: string | readonly string[]): { source: string; referrerHost: string | null; campaign: string | null } {
  const host = referrer?.hostname ?? null;
  const internal = host && (typeof domain === "string" ? [domain] : domain).some(h => sameSite(host, h));
  const referrerHost = host && !internal ? host.replace(/^www\./, "") : null;
  const campaign = utmValue(url, "utm_campaign");
  const utm = utmValue(url, "utm_source");
  if (utm) {
    const known = KNOWN_SOURCES.find((s) => s.utm.includes(utm.toLowerCase()));
    return { source: known?.name ?? utm, referrerHost, campaign };
  }
  if (referrerHost) {
    const known = KNOWN_SOURCES.find((s) => s.host?.test(referrerHost));
    return { source: known?.name ?? referrerHost, referrerHost, campaign };
  }
  return { source: "Direct", referrerHost: null, campaign };
}

function httpUrl(value: string): URL | null {
  if (value.length > MAX_URL || !URL.canParse(value)) return null;
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : null;
}

export function parseEvent(body: unknown): EventInput {
  if (!isRecord(body)) throw invalid("Expected a JSON object.");
  const extra = Object.keys(body).find((k) => !EVENT_KEYS.includes(k));
  if (extra !== undefined) throw invalid(`Unknown field: ${extra}.`);

  const { site, type, url, referrer, name, revenue } = body;
  if (typeof site !== "string" || !SITE_ID.test(site)) throw invalid("site must be a website id.");
  if (type !== "pageview" && type !== "event" && type !== "activity") throw invalid("type must be pageview, event or activity.");
  const pageUrl = typeof url === "string" ? httpUrl(url) : null;
  if (!pageUrl) throw invalid("url must be an http or https URL of at most 2048 characters.");
  if (referrer !== undefined && referrer !== null && typeof referrer !== "string") throw invalid("referrer must be a string.");

  if (type === "event") {
    if (typeof name !== "string" || !GOAL_ID.test(name)) throw invalid("name must be a goal id: 1 to 40 of a-z, 0-9 and _.");
  } else if (name !== undefined || revenue !== undefined) {
    throw invalid("A pageview takes no name or revenue.");
  }
  if (revenue !== undefined && (typeof revenue !== "number" || !Number.isFinite(revenue) || revenue < 0 || revenue > 1_000_000)) {
    throw invalid("revenue must be a number from 0 to 1,000,000.");
  }

  if (body.page !== undefined && (typeof body.page !== "string" || !/^[a-f0-9]{32}$/.test(body.page))) throw invalid("Invalid page signal.");
  if (type === "activity" && (typeof body.page !== "string" || !Number.isSafeInteger(body.visible) || Number(body.visible) < 0 || Number(body.visible) > Number.MAX_SAFE_INTEGER)) throw invalid("Invalid visible time.");
  if (type !== "activity" && body.visible !== undefined) throw invalid("visible requires activity.");
  return {
    page: typeof body.page === "string" ? body.page : null,
    visible: typeof body.visible === "number" ? body.visible : 0,
    site,
    type,
    url: pageUrl,
    referrer: typeof referrer === "string" ? httpUrl(referrer) : null,
    name: type === "event" && typeof name === "string" ? name : null,
    revenue: typeof revenue === "number" ? Math.round(revenue * 100) / 100 : 0,
  };
}

export async function readLimitedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, "too_large", `The body must be at most ${limit} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw invalid("The body must be UTF-8 text.");
  }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(digest)).slice(0, 32);
}

const saltCache = new Map<string, string>();

// Salts are keyed by a website's local day. Every time zone's "today" falls within one day of
// the UTC date, so salts older than two UTC days are never needed again; deleting them means
// past visitor ids can never be recomputed from an IP address.
export function oldestSaltDay(now: number): string {
  return utcDay(now - 2 * DAY_MS);
}

async function dailySalt(sql: Sql, day: string, now: number): Promise<string> {
  const cached = saltCache.get(day);
  if (cached) return cached;
  await sql.run("INSERT OR IGNORE INTO salts (day, value) VALUES (?, ?)", [day, hex(crypto.getRandomValues(new Uint8Array(32)))]);
  const row = (await sql.all<{ value: string }>("SELECT value FROM salts WHERE day = ?", [day]))[0];
  if (!row) throw new Error("daily salt missing after insert");
  if (saltCache.size > 8) saltCache.clear();
  saltCache.set(day, row.value);
  return row.value;
}

// Atomic virtual scheduling time: twenty immediate admissions, then one per second.
export async function takeToken(sql: Sql, site: string, visitorId: string, now: number): Promise<boolean> {
  const rows = await sql.all<{ available_at: number }>(`
    INSERT INTO collection_limits(site_id,visitor_id,available_at,expires_at) VALUES (?,?,?,?)
    ON CONFLICT(site_id,visitor_id) DO UPDATE SET
      available_at=MAX(collection_limits.available_at,?-19000)+1000,
      expires_at=MAX(collection_limits.available_at,?-19000)+21000
    WHERE collection_limits.available_at<=?
    RETURNING available_at`, [site, visitorId, now - 18000, now + 2000, now, now, now]);
  return rows.length === 1;
}

export type IngestRequest = {
  event: EventInput;
  ip: string;
  userAgent: string;
  countryCode: unknown;
  origin: string | null;
  doNotTrack: boolean;
  now: number;
  development: boolean;
};

export async function ingest(sql: Sql, req: IngestRequest): Promise<"stored" | "dropped"> {
  const { event, now } = req;
  const site = (await sql.all<{ domain: string; aliases: string; excluded_paths: string; timezone: string; goals: string; exclude_bots: number; respect_dnt: number }>(
    "SELECT domain, aliases, excluded_paths, timezone, goals, exclude_bots, respect_dnt FROM sites WHERE id = ?",
    [event.site],
  ))[0];
  if (!site) throw new HttpError(404, "unknown_site", "No website has this id.");
  const hosts = [site.domain, ...JSON.parse(site.aliases) as string[]];
  const rules = JSON.parse(site.excluded_paths) as string[];
  const path = safePath(event.url.pathname);
  if (!originAllowed(req.origin, hosts, req.development)) {
    throw new HttpError(403, "origin_not_allowed", "Events for this website must come from its domain.");
  }
  if (!req.development && !hosts.some(h => sameSite(event.url.hostname, h))) {
    throw new HttpError(403, "url_not_allowed", "The page address must be on this website's domain.");
  }
  const drop = async (): Promise<"dropped"> => {
    if (event.type === "activity") {
      const page = (await sql.all<{ day: string; visitor_id: string }>("SELECT day, visitor_id FROM visit_pages WHERE site_id=? AND token=?", [event.site, event.page]))[0];
      const salt = page ? (await sql.all<{ value: string }>("SELECT value FROM salts WHERE day=?", [page.day]))[0] : undefined;
      if (page && salt && page.visitor_id === await sha256(`${salt.value}|${event.site}|${req.ip}|${req.userAgent}`)) await sql.run("UPDATE visit_pages SET privacy_paused=1 WHERE site_id=? AND token=?", [event.site, event.page]);
    }
    return "dropped";
  };
  if (event.name !== null && !parseGoals(site.goals).some((g) => g.id === event.name && g.type !== "page" && !g.archived && (g.createdAt === undefined || now >= g.createdAt))) {
    throw new HttpError(400, "unknown_goal", "name is not a goal of this website.");
  }
  if (site.exclude_bots === 1 && isBot(req.userAgent)) return drop();
  if (site.respect_dnt === 1 && req.doNotTrack) return drop();

  if (path === null || pathExcluded(path, rules)) return drop();
  const { day, hour } = localTime(now, site.timezone);
  const salt = await dailySalt(sql, day, now);
  const visitorId = await sha256(`${salt}|${event.site}|${req.ip}|${req.userAgent}`);
  const prior = rules.length === 0 ? undefined : (await sql.all<{ entry_path: string | null; path: string }>("SELECT entry_path, path FROM visits WHERE site_id=? AND visitor_id=? AND day=? AND timezone=? AND closed=0 AND last_at>? ORDER BY last_at DESC LIMIT 1", [event.site, visitorId, day, site.timezone, now - 1800000]))[0];
  if (prior && pathExcluded(safePath(prior.entry_path ?? prior.path) ?? '/', rules)) return drop();
  if (event.type === "activity") {
    // Unary + removes column affinity without changing the session value.
    const page = (await sql.all<{ day: string; visitor_id: string; path: string; entry_path: string | null; privacy_paused: number; at: number }>("SELECT p.day, p.visitor_id, p.path, v.entry_path, p.privacy_paused, p.at FROM visit_pages p JOIN visits v ON v.session_id=+p.session_id WHERE p.site_id = ? AND p.token = ?", [event.site, event.page]))[0];
    if (page && (pathExcluded(safePath(page.path) ?? "/", rules) || pathExcluded(safePath(page.entry_path ?? page.path) ?? "/", rules))) return drop();
    if (!await takeToken(sql, event.site, visitorId, now)) throw new HttpError(429, "rate_limited", "Too many events from this visitor. Slow down.");
    if (!page || now - page.at >= 1800000 || page.day < oldestSaltDay(now) || page.visitor_id !== await sha256(`${await dailySalt(sql, page.day, now)}|${event.site}|${req.ip}|${req.userAgent}`)) return "dropped";
    if (page.privacy_paused === 1) {
      await sql.run("UPDATE visit_pages SET privacy_paused=0, at=MAX(at,?), visible=MAX(visible,?) WHERE site_id=? AND token=?", [now, event.visible, event.site, event.page]);
      return "dropped";
    }
    let boundary = now;
    let lo = now - 26 * 3600000;
    while (boundary - lo > 1) {
      const mid = Math.floor((lo + boundary) / 2);
      if (localTime(mid, site.timezone).day === day) boundary = mid; else lo = mid;
    }
    await sql.run("INSERT INTO activity (site_id, token, at, day, hour, timezone, visitor_id, visible, boundary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [event.site, event.page, now, day, hour, site.timezone, visitorId, event.visible, boundary]);
    return "stored";
  }
  if (!await takeToken(sql, event.site, visitorId, now)) throw new HttpError(429, "rate_limited", "Too many events from this visitor. Slow down.");
  const origin = classifySource(event.url, event.referrer, hosts);
  await sql.run(
    `INSERT INTO events (site_id, at, day, hour, type, name, path, entry_path, referrer_host, source, campaign, country, device, browser, visitor_id, session_id, revenue, measured, timezone, page_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [event.site, now, day, hour, event.type, event.name, path, path, origin.referrerHost, origin.source, origin.campaign,
      countryName(req.countryCode), deviceOf(req.userAgent), browserOf(req.userAgent), visitorId, crypto.randomUUID(), event.revenue, site.timezone, event.page],
  );
  return "stored";
}
