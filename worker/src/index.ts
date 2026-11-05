import { sectionStream } from './section-stream.ts';
/*!
MIT License

Copyright (c) 2026 PostDeploy Analytics contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Third-party bcryptjs 3.0.3 (BSD-3-Clause):
bcrypt.js
---------
Copyright (c) 2012 Nevins Bartolomeo <nevins.bartolomeo@gmail.com>
Copyright (c) 2012 Shane Girish <shaneGirish@gmail.com>
Copyright (c) 2025 Daniel Wirtz <dcode@dcode.io>

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
import { buildInsights, insightsCsv, insightSection, selectInsightSection } from "./insights.ts";
import { projectCsv, organisationCsv } from "./exports.ts";
import { listOrganisations, saveOrganisation, organisationReport, parseOrganisationQuery, organisationSection } from "./organisations.ts";
import { authRoute, requireAdmin, requireIdentity, usersRoute, type AuthEnv } from "./auth.ts";
import { ingest, MAX_BODY_BYTES, parseEvent, readLimitedText } from "./ingest.ts";
import { buildReport, live, parseReportQuery, sessionTimeline } from "./report.ts";
import { runRetention } from "./retention.ts";
import { createSite, deleteSite, getSite, listSites, listSiteMetadata, updateSite, verifySite, saveGoal } from "./sites.ts";
import { HttpError, invalid, type Sql } from "./sql.ts";
import { TRACKER } from "./tracker.ts";

export interface Env extends AuthEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT?: string;
}

const VERSION = "0.1.0";
const MAX_OWNER_BODY_BYTES = 16_384;
const PUBLIC_CORS = { "Access-Control-Allow-Origin": "*" };

type Context = { request: Request; env: Env; url: URL; params: string[]; sql: Sql; now: number };
type Route = { method: string; pattern: RegExp; owner: boolean; handle: (ctx: Context) => Promise<Response> };

function d1(db: D1Database): Sql {
  return {
    async all<T>(query: string, params: readonly (string | number | null)[] = []): Promise<T[]> {
      return (await db.prepare(query).bind(...params).all<T>()).results;
    },
    async run(query: string, params: readonly (string | number | null)[] = []): Promise<void> {
      await db.prepare(query).bind(...params).run();
    },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: code, message }, status, headers);
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw invalid("Send the body as application/json.");
  const text = await readLimitedText(request.body, MAX_OWNER_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw invalid("The body must be JSON.");
  }
}

function param(ctx: Context, index: number): string {
  return decodeURIComponent(ctx.params[index] ?? "");
}

function requiredSite(ctx: Context): string {
  const site = ctx.url.searchParams.get("site");
  if (!site) throw invalid("site is required.");
  return site;
}

async function handleEvent(ctx: Context): Promise<Response> {
  const { request } = ctx;
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (contentType !== "text/plain" && contentType !== "application/json") {
    throw invalid("Send the event as text/plain or application/json.");
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new HttpError(413, "too_large", `The body must be at most ${MAX_BODY_BYTES} bytes.`);
  }
  let body: unknown;
  try {
    body = JSON.parse(await readLimitedText(request.body, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw invalid("The body must be JSON.");
  }
  await ingest(ctx.sql, {
    event: parseEvent(body),
    ip: request.headers.get("cf-connecting-ip") ?? "",
    userAgent: request.headers.get("user-agent") ?? "",
    countryCode: request.cf?.country,
    origin: request.headers.get("origin"),
    doNotTrack: request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1",
    now: ctx.now,
    development: ctx.env.ENVIRONMENT === "development",
  });
  return new Response(null, { status: 202, headers: PUBLIC_CORS });
}

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/insights$/, owner: true, handle: async ctx => {
    const org=ctx.url.searchParams.get('org')??undefined;
    const siteId=ctx.url.searchParams.get('site');
    if((org!==undefined&&siteId!==null)||!(org??siteId)||String(org??siteId).length>128) throw invalid('Choose exactly one project or organisation id, up to 128 characters.');
    const query=org?parseOrganisationQuery(ctx.url.searchParams):parseReportQuery(ctx.url.searchParams);
    if(org) query.site=org;
    const dataset=ctx.url.searchParams.get('dataset');
    const section=dataset!==null ? insightSection(dataset) : ctx.url.searchParams.has('section') ? insightSection(ctx.url.searchParams.get('section')??'') : undefined;
    if(dataset === 'summary') throw invalid('Choose a chart dataset.');
    const data=await buildInsights(ctx.sql,query,ctx.url.searchParams,ctx.now,org,section);
    return ctx.url.searchParams.has('dataset')?insightsCsv(data,query,ctx.url.searchParams.get('dataset')??''):json(section ? selectInsightSection(data,section) : data);
  }},
  { method: "POST", pattern: /^\/api\/sites\/([^/]+)\/goals$/, owner: true, handle: async ctx => json(await saveGoal(ctx.sql,param(ctx,0),await readJson(ctx.request),ctx.now),201) },
  { method: "PATCH", pattern: /^\/api\/sites\/([^/]+)\/goals\/([^/]+)$/, owner: true, handle: async ctx => json(await saveGoal(ctx.sql,param(ctx,0),await readJson(ctx.request),ctx.now,param(ctx,1))) },
  { method: "GET", pattern: /^\/api\/export$/, owner: true, handle: async ctx => {
    const query=parseReportQuery(ctx.url.searchParams);
    const site=await getSite(ctx.sql,query.site,ctx.now);
    return projectCsv(await buildReport(ctx.sql,site,query,ctx.now),query,site.timezone,ctx.url.searchParams.get("dataset")??"totals");
  }},
  { method: "GET", pattern: /^\/api\/organisations\/([^/]+)\/export$/, owner: true, handle: async ctx => {
    const query=parseOrganisationQuery(ctx.url.searchParams);
    const dataset=ctx.url.searchParams.get('dataset')??'projects';
    if(!['projects','series','goals','totals'].includes(dataset)) throw invalid('Choose totals, goals, projects or series.');
    return organisationCsv(await organisationReport(ctx.sql,param(ctx,0),query,dataset==='totals'?undefined:dataset==='goals'?'goals':dataset==='series'?'series':'summary'),query,dataset);
  }},
  { method: "GET", pattern: /^\/api\/organisations$/, owner: true, handle: async ({sql}) => json(await listOrganisations(sql)) },
  { method: "POST", pattern: /^\/api\/organisations$/, owner: true, handle: async (ctx) => json(await saveOrganisation(ctx.sql, await readJson(ctx.request), ctx.now), 201) },
  { method: "PATCH", pattern: /^\/api\/organisations\/([^/]+)$/, owner: true, handle: async (ctx) => json(await saveOrganisation(ctx.sql, await readJson(ctx.request), ctx.now, param(ctx,0))) },
  { method: "GET", pattern: /^\/api\/organisations\/([^/]+)\/report$/, owner: true, handle: async (ctx) => (async()=>{
    const section=ctx.url.searchParams.has('section')?organisationSection(ctx.url.searchParams.get('section')??''):undefined;
    const data=await organisationReport(ctx.sql,param(ctx,0),parseOrganisationQuery(ctx.url.searchParams),section);
    const pick=(p: typeof data.main): unknown => section==='summary'?{totals:p.totals,projects:p.projects}:section==='series'?{buckets:p.buckets}:section==='goals'?{conversions:p.conversions,goals:p.goals}:{measurement:p.measurement};
    return json(section?{...data,main:pick(data.main),prev:data.prev?pick(data.prev):null}:data);
  })() },
  {
    method: "GET",
    pattern: /^\/api\/health$/,
    owner: false,
    handle: async ({ sql, env }) => {
      let database = false;
      try {
        await sql.all("SELECT 1");
        database = true;
      } catch (error) {
        console.error(JSON.stringify({ msg: "health_database_failed", error: String(error) }));
      }
      return json({ ok: true, version: VERSION, database, mode: env.ENVIRONMENT === "development" ? "development" : "production" });
    },
  },
  {
    method: "GET",
    pattern: /^\/script\.js$/,
    owner: false,
    handle: async () =>
      new Response(TRACKER, {
        headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", ...PUBLIC_CORS },
      }),
  },
  {
    method: "OPTIONS",
    pattern: /^\/api\/event$/,
    owner: false,
    handle: async () =>
      new Response(null, {
        status: 204,
        headers: { ...PUBLIC_CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
      }),
  },
  { method: "POST", pattern: /^\/api\/event$/, owner: false, handle: handleEvent },
  { method: "GET", pattern: /^\/api\/sites\/catalog$/, owner: true, handle: async ({sql}) => json(await listSiteMetadata(sql)) },
  { method: "GET", pattern: /^\/api\/sites$/, owner: true, handle: async ({ sql, now }) => json(await listSites(sql, now)) },
  {
    method: "POST",
    pattern: /^\/api\/sites$/,
    owner: true,
    handle: async (ctx) => json(await createSite(ctx.sql, await readJson(ctx.request), ctx.now), 201),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/sites\/([^/]+)$/,
    owner: true,
    handle: async (ctx) => json(await updateSite(ctx.sql, param(ctx, 0), await readJson(ctx.request), ctx.now)),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/sites\/([^/]+)$/,
    owner: true,
    handle: async (ctx) => {
      await deleteSite(ctx.sql, param(ctx, 0), ctx.now);
      return new Response(null, { status: 204 });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/sites\/([^/]+)\/verify$/,
    owner: true,
    handle: async (ctx) => json(await verifySite(ctx.sql, param(ctx, 0), ctx.now)),
  },
  {
    method: "GET",
    pattern: /^\/api\/report$/,
    owner: true,
    handle: async (ctx) => {
      const query = parseReportQuery(ctx.url.searchParams);
      const site = await getSite(ctx.sql, query.site, ctx.now);
      return json(await buildReport(ctx.sql, site, query, ctx.now));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/live$/,
    owner: true,
    handle: async (ctx) => json(await live(ctx.sql, await getSite(ctx.sql, requiredSite(ctx), ctx.now), ctx.now)),
  },
  {
    method: "GET",
    pattern: /^\/api\/sessions\/([A-Za-z0-9_-]{1,64})$/,
    owner: true,
    handle: async (ctx) => json(await sessionTimeline(ctx.sql, await getSite(ctx.sql, requiredSite(ctx), ctx.now), param(ctx, 0))),
  },
];

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const page = (path: string): Promise<Response> => {
    const target = new URL(request.url);
    target.pathname = path;
    return env.ASSETS.fetch(new Request(target, request));
  };
  if (url.pathname === "/") return page("/marketing");
  if (url.pathname === "/demo") {
    if (url.searchParams.get("demo") !== "1") return Response.redirect(new URL("/demo?demo=1", url).toString(), 302);
    return page("/dashboard");
  }
  const privatePage = ["/dashboard", "/dashboard.html", "/organisations", "/organisations.html", "/insights", "/insights.html"].includes(url.pathname);
  if (!privatePage && !url.pathname.startsWith("/api/") && url.pathname !== "/script.js") return env.ASSETS.fetch(request);

  const sql = d1(env.DB);
  const now = Date.now();
  try {
    if (privatePage) {
      try { await requireIdentity(sql, request, now, env); }
      catch (error) {
        if (error instanceof HttpError && error.status === 401) return new Response(null, { status: 302, headers: { Location: "/auth", "Cache-Control": "no-store" } });
        throw error;
      }
      const response = await page(url.pathname.replace(/\.html$/, ""));
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname.startsWith("/api/auth/")) {
      return await authRoute(sql, request, env, request.method === "POST" ? await readJson(request) : null, now);
    }
    if (url.pathname === "/api/users" || url.pathname.startsWith("/api/users/")) {
      const who = await requireIdentity(sql, request, now, env);
      return await usersRoute(sql, request, env, who, request.method === "POST" || request.method === "PATCH" ? await readJson(request) : null, now);
    }
    const matches = routes.filter((r) => r.pattern.test(url.pathname));
    const owner = matches.length === 0 || matches.some((r) => r.owner);
    const cors = owner ? {} : PUBLIC_CORS;
    if (owner) {
      const who = await requireIdentity(sql, request, now, env);
      if (!["GET", "HEAD"].includes(request.method)) requireAdmin(who);
    }
    const match = matches.find((r) => r.method === request.method);
    if (!match) {
      return matches.length === 0
        ? errorResponse(404, "not_found", "No such endpoint.")
        : errorResponse(405, "method_not_allowed", "This endpoint does not accept that method.", cors);
    }

    const params = url.pathname.match(match.pattern)?.slice(1) ?? [];
    const context = { request, env, url, params, sql, now };
    if (request.method==='GET' && request.headers.get('Accept')==='application/x-ndjson' && url.searchParams.has('section') && !url.searchParams.has('dataset') && (url.pathname==='/api/insights' || /^\/api\/organisations\/[^/]+\/report$/.test(url.pathname))) {
      return sectionStream(sql,request.signal,readSql=>match.handle({...context,sql:readSql}));
    }
    return await match.handle(context);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, { ...(url.pathname === "/api/event" ? PUBLIC_CORS : {}), ...(error.status === 429 && url.pathname === "/api/event" ? { "Retry-After": "1" } : {}) });
    console.error(JSON.stringify({ msg: "request_failed", path: url.pathname, error: String(error) }));
    return errorResponse(500, "internal_error", "Something went wrong on our side.", url.pathname === "/api/event" ? PUBLIC_CORS : {});
  }
}

async function scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
    runRetention(d1(env.DB), Date.now()).then(
      (result) => console.log(JSON.stringify({ msg: "retention_done", ...result })),
      (error: unknown) => console.error(JSON.stringify({ msg: "retention_failed", error: String(error) })),
    ),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result = await route(request, env);
    const headers = new Headers(result.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    if (headers.get("Content-Type")?.includes("text/html")) headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  },
  scheduled,
} satisfies ExportedHandler<Env>;
