import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { digest } from "../src/auth.ts";
import { memorySql } from "./sqlite.mjs";

const ORIGIN = "https://analytics.example.com";
const PASSWORD = "test-only-password-for-local-checks";
const SECRET = "disposable-test-bootstrap-not-a-real-secret";

function installation() {
  const { sql, db } = memorySql();
  const emails = [];
  const env = {
    APP_ORIGIN: ORIGIN, BOOTSTRAP_SECRET: SECRET, EMAIL_FROM: "analytics@example.com",
    EMAIL: { async send(message) { emails.push(message); } },
    DB: { prepare(query) { return { bind(...params) { return {
      async all() { return { results: db.prepare(query).all(...params) }; },
      async run() { db.prepare(query).run(...params); },
    }; } }; } },
    ASSETS: { async fetch() { return new Response("dashboard shell"); } },
  };
  async function request(path, { method = "GET", body, cookie, csrf, origin = ORIGIN } = {}) {
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.10" };
    if (method !== "GET") headers.Origin = origin;
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    return worker.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  }
  async function post(path, body, session) { return request(path, { method: "POST", body, ...session }); }
  async function setup() {
    const result = await post("/api/auth/setup", { email: "owner@example.com", password: PASSWORD, secret: SECRET });
    assert.equal(result.status, 200);
    const data = await result.json();
    return { cookie: result.headers.get("set-cookie").split(";")[0], csrf: data.csrf };
  }
  function token() { return emails.at(-1).text.match(/token=([a-f0-9]{64})/)[1]; }
  return { sql, db, env, emails, request, post, setup, token };
}

test("HTTP access stays closed in every environment; setup, sessions, CSRF and roles hold", async () => {
  const app = installation();
  for (const mode of ["development", "production"]) {
    app.env.ENVIRONMENT = mode;
    assert.equal((await app.request("/api/sites")).status, 401);
  }
  assert.equal((await app.post("/api/auth/setup", { email: "owner@example.com", password: PASSWORD, secret: "wrong" })).status, 403);
  assert.equal((await app.post("/api/auth/setup", {}, { origin: "https://attacker.example" })).status, 403);
  const owner = await app.setup();
  assert.equal((await app.post("/api/auth/setup", { email: "other@example.com", password: PASSWORD, secret: SECRET })).status, 409);
  const login = await app.post("/api/auth/login", { email: "owner@example.com", password: PASSWORD });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
  assert.equal(login.headers.get("cache-control"), "no-store");
  assert.equal((await app.post("/api/sites", { name: "Example", domain: "example.com", kind: "docs" }, { cookie: owner.cookie })).status, 403);
  assert.equal((await app.post("/api/sites", { name: "Example", domain: "example.com", kind: "docs" }, owner)).status, 201);
  assert.equal((await app.post("/api/users/invite", { email: "viewer@example.com", role: "viewer" }, owner)).status, 200);
  const invite = app.token();
  assert.equal((await app.post("/api/auth/accept", { token: invite, password: PASSWORD })).status, 200);
  const viewerLogin = await app.post("/api/auth/login", { email: "viewer@example.com", password: PASSWORD });
  const viewer = { cookie: viewerLogin.headers.get("set-cookie").split(";")[0], csrf: (await viewerLogin.json()).csrf };
  assert.equal((await app.request("/api/sites", viewer)).status, 200);
  const malicious='  \t=HYPERLINK("x"),雪\nNext';
  assert.equal((await app.request("/api/sites/example/goals/star_repo",{method:"PATCH",body:{name:malicious},...owner})).status,200);
  const insightsPath='/api/insights?org=default&from=2026-11-01&to=2026-11-03';
  assert.equal((await app.request(insightsPath)).status,401);
  assert.equal((await app.request(insightsPath+'&dataset=heatmap')).status,401);
  for(const session of [owner,viewer]) {
    assert.equal((await app.request(insightsPath,session)).status,200);
    const csv=await app.request(insightsPath+'&dataset=heatmap',session);
    assert.equal(csv.status,200);assert.match(csv.headers.get('content-disposition'),/attachment/);
    assert.match(await csv.text(),/weekday/);
    assert.equal((await app.request(insightsPath+'&dimension=sql',session)).status,400);
  }
  const exportPath="/api/export?site=example&from=2026-11-01&to=2026-11-03&dataset=goals";
  assert.equal((await app.request(exportPath)).status,401);
  for(const session of [owner,viewer]) {
    const csv=await app.request(exportPath,session);
    assert.equal(csv.status,200);assert.match(csv.headers.get("content-type"),/^text\/csv/);
    assert.match(csv.headers.get("content-disposition"),/attachment; filename="postdeploy-goals.csv"/);
    assert.equal(csv.headers.get("cache-control"),"no-store");
    const bytes=new Uint8Array(await csv.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
    assert.match(new TextDecoder().decode(bytes),/"goalId"/);
    assert.ok(new TextDecoder().decode(bytes).includes(`"'=HYPERLINK(""x""),雪\nNext"`));
    assert.equal((await app.request("/api/organisations/default/export?from=2026-11-01&to=2026-11-03&dataset=projects",session)).status,200);
  }
  assert.equal((await app.post("/api/sites/example/goals",{name:"Page",type:"page",path:"/thanks"},viewer)).status,403);
  assert.equal((await app.post("/api/sites/example/goals",{name:"Page",type:"page",path:"/thanks"},{cookie:owner.cookie})).status,403);
  assert.equal((await app.post("/api/sites/example/goals",{name:"Page",type:"page",path:"/thanks"},owner)).status,201);
  assert.equal((await app.request("/api/sites/example/goals/star_repo",{method:"PATCH",body:{name:"Blocked"},...viewer})).status,403);

  assert.equal((await app.request("/api/organisations")).status, 401);
  assert.equal((await app.request("/api/organisations/default/report?from=2026-11-01&to=2026-11-03", viewer)).status, 200);
  assert.equal((await app.post("/api/organisations", { name: "Forbidden" }, viewer)).status, 403);
  assert.equal((await app.request("/api/organisations/default", {method:"PATCH",body:{name:"Forbidden"},...viewer})).status, 403);
  assert.equal((await app.post("/api/organisations", {name:"CSRF"}, {cookie:owner.cookie})).status, 403);
  const orgResponse = await app.post("/api/organisations", {name:"Allowed"}, owner);
  assert.equal(orgResponse.status, 201);
  const org = await orgResponse.json();
  assert.equal((await app.request("/api/sites/example", {method:"PATCH",body:{organisationId:org.id},...viewer})).status, 403);
  assert.equal((await app.request(`/api/organisations/${org.id}`, {method:"PATCH",body:{name:"Renamed"},...owner})).status, 200);
  assert.equal((await app.request("/api/organisations/default", {method:"DELETE",...owner})).status, 405);

  for (const body of [{aliases:['www.example.com']},{excludedPaths:['/private']}]) {
    assert.equal((await app.request('/api/sites/example',{method:'PATCH',body,...viewer})).status,403);
    assert.equal((await app.request('/api/sites/example',{method:'PATCH',body,cookie:owner.cookie})).status,403);
  }
  assert.equal((await app.request("/api/users", viewer)).status, 403);
  assert.equal((await app.post("/api/sites", { name: "Forbidden", domain: "forbidden.example", kind: "docs" }, viewer)).status, 403);
  const id = (await app.sql.all("SELECT id FROM auth_users WHERE email = ?", ["viewer@example.com"]))[0].id;
  assert.equal((await app.request("/api/users/owner", { method: "PATCH", body: { disabled: true }, ...owner })).status, 409);
  assert.equal((await app.request("/api/users/" + id, { method: "PATCH", body: { disabled: true }, ...owner })).status, 200);
  assert.equal((await app.request("/api/sites", viewer)).status, 401);
  const change = await app.post("/api/auth/password", { currentPassword: PASSWORD, password: PASSWORD + "-changed" }, owner);
  assert.equal(change.status, 200);
  assert.equal((await app.request("/api/sites", owner)).status, 401);
  const changed = { cookie: change.headers.get("set-cookie").split(";")[0], csrf: (await change.json()).csrf };
  assert.equal((await app.post("/api/auth/logout", {}, changed)).status, 200);
  assert.equal((await app.request("/api/sites", owner)).status, 401);
  assert.equal((await app.request("/api/health")).status, 200);
  assert.equal((await app.request("/script.js")).status, 200);
  app.db.close();
});

test("setup and emailed tokens are single use; reset revokes sessions; failures disclose no token", async () => {
  const app = installation();
  const setups = await Promise.all([app.post("/api/auth/setup", { email: "owner@example.com", password: PASSWORD, secret: SECRET }), app.post("/api/auth/setup", { email: "owner@example.com", password: PASSWORD, secret: SECRET })]);
  assert.deepEqual(setups.map((r) => r.status).sort(), [200, 409]);
  const initialized = setups.find((r) => r.status === 200);
  const owner = { cookie: initialized.headers.get("set-cookie").split(";")[0], csrf: (await initialized.json()).csrf };
  const known = await app.post("/api/auth/forgot", { email: "owner@example.com" });
  const raw = app.token();
  const unknown = await app.post("/api/auth/forgot", { email: "unknown@example.com" });
  assert.deepEqual(await known.json(), await unknown.json());
  const stored = await app.sql.all("SELECT token_hash FROM auth_tokens");
  assert.equal(stored[0].token_hash, await digest(raw));
  assert.ok(!JSON.stringify(stored).includes(raw));
  assert.equal((await app.post("/api/auth/accept", { token: raw, password: "short" })).status, 400);
  const results = await Promise.all([app.post("/api/auth/accept", { token: raw, password: PASSWORD + "1" }), app.post("/api/auth/accept", { token: raw, password: PASSWORD + "2" })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal((await app.request("/api/sites", owner)).status, 401);
  assert.equal((await app.post("/api/auth/accept", { token: raw, password: PASSWORD })).status, 400);
  await app.post("/api/auth/forgot", { email: "owner@example.com" });
  const expired = app.token();
  await app.sql.run("UPDATE auth_tokens SET expires_at = 0");
  assert.equal((await app.post("/api/auth/accept", { token: expired, password: PASSWORD })).status, 400);
  app.env.EMAIL.send = async () => { throw new Error("test provider failure"); };
  assert.equal((await app.post("/api/auth/forgot", { email: "owner@example.com" })).status, 200);
  assert.equal((await app.sql.all("SELECT COUNT(*) AS n FROM auth_tokens"))[0].n, 0);
  for (let i = 0; i < 11; i++) await app.post("/api/auth/login", { email: "nobody@example.com", password: "not-the-password" });
  const blocked = await app.post("/api/auth/login", { email: "nobody@example.com", password: "not-the-password" });
  assert.equal(blocked.status, 429);
  app.db.close();
});

test("public product and sample pages stay separate from private dashboard documents", async () => {
  const app = installation();
  const assets = [];
  app.env.ASSETS.fetch = async request => { assets.push(new URL(request.url).pathname); return new Response('asset'); };
  assert.equal((await app.request('/')).status, 200);
  assert.equal(assets.at(-1), '/marketing');
  assert.equal((await app.request('/demo?demo=1')).status, 200);
  assert.equal(assets.at(-1), '/dashboard');
  for (const path of ['/dashboard', '/dashboard.html', '/organisations', '/insights']) {
    const denied = await app.request(path);
    assert.equal(denied.status, 302);
    assert.equal(denied.headers.get('location'), '/auth');
    assert.equal(denied.headers.get('cache-control'), 'no-store');
  }
  const owner = await app.setup();
  const allowed = await app.request('/dashboard', owner);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  assert.equal(allowed.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(assets.at(-1), '/dashboard');
});
