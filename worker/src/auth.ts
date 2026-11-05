import { compare, hash, truncates } from "bcryptjs";
import { HttpError, invalid, isRecord, type Sql } from "./sql.ts";

export type Role = "admin" | "viewer";
export type User = { id: string; email: string; role: Role };
type UserRow = User & { password_hash: string | null; disabled: number; revision: number };
export interface AuthEnv {
  APP_ORIGIN?: string;
  BOOTSTRAP_SECRET?: string;
  EMAIL_FROM?: string;
  EMAIL?: { send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
  ENVIRONMENT?: string;
}
export type Identity = { user: User; csrf: string; tokenHash: string };
const SESSION_MS = 7 * 86_400_000;
const DUMMY_HASH = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Ttx9ITlxwQSU8wJCZqJ1RGxnD2Ha";

export function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function equalSecrets(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}

export function origin(env: AuthEnv): string {
  try {
    const url = new URL(env.APP_ORIGIN ?? "");
    const loopback = env.ENVIRONMENT === "development" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) throw new Error();
    return url.origin;
  } catch {
    throw new HttpError(503, "auth_not_configured", "Configure APP_ORIGIN with this installation's HTTPS origin.");
  }
}

export function requireOrigin(request: Request, env: AuthEnv): void {
  if (request.headers.get("origin") !== origin(env)) throw new HttpError(403, "origin_not_allowed", "Submit this request from this installation.");
}

function object(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(body) || Object.keys(body).some((k) => !keys.includes(k))) throw invalid("Send the expected fields only.");
  return body;
}

export function emailAddress(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) throw invalid("Enter a valid email address.");
  return value.trim().toLowerCase();
}

function password(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || truncates(value)) throw invalid("Use at least 12 characters and at most 72 UTF-8 bytes for your password.");
  return value;
}

export async function rateLimit(sql: Sql, key: string, now: number, maximum = 10, windowMs = 900_000): Promise<void> {
  const bucket = Math.floor(now / windowMs);
  const keyHash = await digest(`${key}|${bucket}`);
  const rows = await sql.all<{ attempts: number }>(
    "INSERT INTO auth_limits (key_hash, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key_hash) DO UPDATE SET attempts = attempts + 1 RETURNING attempts",
    [keyHash, (bucket + 1) * windowMs],
  );
  if ((rows[0]?.attempts ?? maximum + 1) > maximum) throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.");
}

export async function hasOwner(sql: Sql): Promise<boolean> {
  return (await sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM auth_users"))[0]?.n !== 0;
}

function publicUser(row: User): User {
  return { id: row.id, email: row.email, role: row.role };
}

export async function identity(sql: Sql, request: Request, now: number): Promise<Identity | null> {
  const token = request.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith("pd_session="))?.slice(11);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await digest(token);
  const row = (await sql.all<User>(
    "SELECT u.id, u.email, u.role FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0 AND u.password_hash IS NOT NULL AND u.revision = s.revision",
    [tokenHash, now],
  ))[0];
  return row ? { user: publicUser(row), csrf: await digest(`csrf:${token}`), tokenHash } : null;
}

export async function requireIdentity(sql: Sql, request: Request, now: number, env: AuthEnv): Promise<Identity> {
  const who = await identity(sql, request, now);
  if (!who) throw new HttpError(401, "sign_in_required", "Sign in to open this installation.");
  if (!["GET", "HEAD"].includes(request.method)) {
    requireOrigin(request, env);
    if (!await equalSecrets(request.headers.get("x-csrf-token") ?? "", who.csrf)) throw new HttpError(403, "csrf_failed", "Refresh the page and try again.");
  }
  return who;
}

export function requireAdmin(who: Identity): void {
  if (who.user.role !== "admin") throw new HttpError(403, "admin_required", "An administrator must make this change.");
}

function cookie(token: string, env: AuthEnv, age = SESSION_MS / 1000): string {
  const secure = new URL(origin(env)).protocol === "https:" ? "; Secure" : "";
  return `pd_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
}

async function session(sql: Sql, user: UserRow, env: AuthEnv, now: number): Promise<Response> {
  const token = randomToken();
  await sql.run("INSERT INTO auth_sessions (token_hash, user_id, revision, expires_at) VALUES (?, ?, ?, ?)", [await digest(token), user.id, user.revision, now + SESSION_MS]);
  return response({ user: publicUser(user), csrf: await digest(`csrf:${token}`) }, { "Set-Cookie": cookie(token, env) });
}

function response(body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { headers: { "Cache-Control": "no-store", ...headers } });
}

async function userByEmail(sql: Sql, email: string): Promise<UserRow | undefined> {
  return (await sql.all<UserRow>("SELECT id, email, role, password_hash, disabled, revision FROM auth_users WHERE email = ?", [email]))[0];
}

async function sendLink(sql: Sql, env: AuthEnv, user: User, purpose: "invite" | "reset", now: number): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new HttpError(503, "email_not_configured", "Configure Cloudflare Email and EMAIL_FROM before sending links.");
  const base = origin(env);
  const raw = randomToken();
  const tokenHash = await digest(raw);
  await sql.run("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?", [user.id, purpose]);
  await sql.run("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [tokenHash, user.id, purpose, now + (purpose === "invite" ? 86_400_000 : 3_600_000)]);
  const link = `${base}/auth#auth=${purpose}&token=${raw}`;
  try {
    await env.EMAIL.send({ from: env.EMAIL_FROM, to: user.email, subject: purpose === "invite" ? "Your PostDeploy Analytics invitation" : "Reset your PostDeploy Analytics password", text: `${purpose === "invite" ? "Choose a password to join" : "Choose a new password for"} PostDeploy Analytics:\n\n${link}\n\nThis link expires in ${purpose === "invite" ? "24 hours" : "one hour"} and can be used once. If you did not expect it, ignore this email.` });
  } catch {
    await sql.run("DELETE FROM auth_tokens WHERE token_hash = ?", [tokenHash]);
    throw new HttpError(503, "email_unavailable", "The email could not be sent. Check the email configuration and try again.");
  }
}

export async function authRoute(sql: Sql, request: Request, env: AuthEnv, body: unknown, now: number): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/auth/session") {
    origin(env);
    const who = await identity(sql, request, now);
    return response({ user: who?.user ?? null, csrf: who?.csrf ?? null, setupRequired: !await hasOwner(sql), emailConfigured: !!env.EMAIL && !!env.EMAIL_FROM });
  }
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "This endpoint does not accept that method.");
  if (!["/api/auth/logout", "/api/auth/setup", "/api/auth/login", "/api/auth/forgot", "/api/auth/accept", "/api/auth/password"].includes(path)) throw new HttpError(404, "not_found", "No such endpoint.");
  requireOrigin(request, env);
  if (path === "/api/auth/logout") {
    const who = await requireIdentity(sql, request, now, env);
    await sql.run("DELETE FROM auth_sessions WHERE token_hash = ?", [who.tokenHash]);
    return response({ ok: true }, { "Set-Cookie": cookie("", env, 0) });
  }
  if (path === "/api/auth/password") {
    const who = await requireIdentity(sql, request, now, env);
    await rateLimit(sql, `password:${who.user.id}`, now, 5);
    const b = object(body, ["currentPassword", "password"]);
    const user = await userByEmail(sql, who.user.email);
    if (!user?.password_hash || typeof b.currentPassword !== "string" || truncates(b.currentPassword) || !await compare(b.currentPassword, user.password_hash)) throw new HttpError(403, "invalid_password", "The current password is incorrect.");
    const hashed = await hash(password(b.password), 12);
    const updated = (await sql.all<UserRow>("UPDATE auth_users SET password_hash = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND disabled = 0 RETURNING *", [hashed, user.id, user.revision]))[0];
    if (!updated) throw new HttpError(409, "account_changed", "Your account changed. Sign in again.");
    await sql.run("DELETE FROM auth_tokens WHERE user_id = ?", [user.id]);
    return session(sql, updated, env, now);
  }
  await rateLimit(sql, `ip:${path}:${request.headers.get("cf-connecting-ip") ?? "local"}`, now, 30);
  if (path === "/api/auth/setup") {
    if (await hasOwner(sql)) throw new HttpError(409, "setup_closed", "This installation already has an administrator.");
    const b = object(body, ["email", "password", "secret"]);
    if (!env.BOOTSTRAP_SECRET || env.BOOTSTRAP_SECRET.length < 32) throw new HttpError(503, "setup_not_configured", "Configure a random BOOTSTRAP_SECRET of at least 32 characters.");
    if (typeof b.secret !== "string" || !await equalSecrets(b.secret, env.BOOTSTRAP_SECRET)) throw new HttpError(403, "invalid_setup_secret", "The setup secret is incorrect.");
    const email = emailAddress(b.email);
    const hashed = await hash(password(b.password), 12);
    const rows = await sql.all<UserRow>("INSERT INTO auth_users (id, email, role, password_hash, created_at) SELECT 'owner', ?, 'admin', ?, ? WHERE NOT EXISTS (SELECT 1 FROM auth_users) RETURNING *", [email, hashed, now]);
    const user = rows[0];
    if (!user) throw new HttpError(409, "setup_closed", "This installation already has an administrator.");
    return session(sql, user, env, now);
  }
  if (path === "/api/auth/login") {
    const b = object(body, ["email", "password"]);
    const email = emailAddress(b.email);
    await rateLimit(sql, `login:${email}`, now);
    if (typeof b.password !== "string" || truncates(b.password)) throw invalid("Enter your email and password.");
    const user = await userByEmail(sql, email);
    const match = await compare(b.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || user.disabled || !user.password_hash || !match) throw new HttpError(401, "invalid_credentials", "The email or password is incorrect.");
    return session(sql, user, env, now);
  }
  if (path === "/api/auth/forgot") {
    const b = object(body, ["email"]);
    const email = emailAddress(b.email);
    await rateLimit(sql, `forgot:${email}`, now, 3, 3_600_000);
    if (!env.EMAIL || !env.EMAIL_FROM) throw new HttpError(503, "email_not_configured", "Password email is not configured. Ask the installation administrator for help.");
    const user = await userByEmail(sql, email);
    if (user && !user.disabled && user.password_hash) {
      try { await sendLink(sql, env, user, "reset", now); }
      catch { console.error(JSON.stringify({ msg: "password_email_failed" })); }
    }
    return response({ message: "If this email belongs to an active user, a password reset link will arrive shortly." });
  }
  if (path === "/api/auth/accept") {
    const b = object(body, ["token", "password"]);
    if (typeof b.token !== "string" || !/^[a-f0-9]{64}$/.test(b.token)) throw invalid("This link is invalid or expired. Request a new one.");
    const tokenHash = await digest(b.token);
    const valid = (await sql.all<{ user_id: string }>("SELECT t.user_id FROM auth_tokens t JOIN auth_users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ? AND u.disabled = 0", [tokenHash, now]))[0];
    if (!valid) throw invalid("This link is invalid or expired. Request a new one.");
    const hashed = await hash(password(b.password), 12);
    const consumed = (await sql.all<{ user_id: string }>("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM auth_users WHERE id = user_id AND disabled = 0) RETURNING user_id", [now, tokenHash, now]))[0];
    if (!consumed) throw invalid("This link is invalid or expired. Request a new one.");
    await sql.run("UPDATE auth_users SET password_hash = ?, revision = revision + 1 WHERE id = ? AND disabled = 0", [hashed, consumed.user_id]);
    await sql.run("DELETE FROM auth_tokens WHERE user_id = ?", [consumed.user_id]);
    return response({ message: "Password saved. Sign in with your email and new password." });
  }
  throw new HttpError(404, "not_found", "No such endpoint.");
}

export async function usersRoute(sql: Sql, request: Request, env: AuthEnv, who: Identity, body: unknown, now: number): Promise<Response> {
  requireAdmin(who);
  const path = new URL(request.url).pathname;
  if (path === "/api/users" && request.method === "GET") {
    const users = await sql.all<User & { disabled: number; pending: number }>("SELECT id, email, role, disabled, password_hash IS NULL AS pending FROM auth_users ORDER BY created_at, email");
    return response({ users, emailConfigured: !!env.EMAIL && !!env.EMAIL_FROM });
  }
  if (path === "/api/users/invite" && request.method === "POST") {
    const b = object(body, ["email", "role"]);
    const email = emailAddress(b.email);
    if (b.role !== "admin" && b.role !== "viewer") throw invalid("Choose Administrator or Viewer.");
    if (!env.EMAIL || !env.EMAIL_FROM) throw new HttpError(503, "email_not_configured", "Configure Cloudflare Email and EMAIL_FROM before inviting users.");
    await rateLimit(sql, `invite:${who.user.id}`, now, 20, 3_600_000);
    let user = await userByEmail(sql, email);
    if (user && (user.password_hash || user.disabled)) throw new HttpError(409, "user_exists", "This user already exists.");
    if (!user) {
      await sql.run("INSERT INTO auth_users (id, email, role, created_at) VALUES (?, ?, ?, ?)", [crypto.randomUUID(), email, b.role, now]);
      user = await userByEmail(sql, email);
    }
    if (!user) throw new Error("invited user missing");
    await sql.run("UPDATE auth_users SET role = ? WHERE id = ? AND password_hash IS NULL", [b.role, user.id]);
    await sendLink(sql, env, user, "invite", now);
    return response({ message: "Invitation sent. The link expires in 24 hours." });
  }
  const id = path.match(/^\/api\/users\/([a-zA-Z0-9-]+)$/)?.[1];
  if (id && request.method === "PATCH") {
    const b = object(body, ["role", "disabled"]);
    if (Object.keys(b).length === 0 || (b.role !== undefined && b.role !== "admin" && b.role !== "viewer") || (b.disabled !== undefined && typeof b.disabled !== "boolean")) throw invalid("Choose a valid role and enabled state.");
    if (id === "owner" || id === who.user.id) throw new HttpError(409, "protected_user", "The initial administrator and your own account cannot be changed here.");
    const rows = await sql.all<User>("UPDATE auth_users SET role = COALESCE(?, role), disabled = COALESCE(?, disabled), revision = revision + 1 WHERE id = ? RETURNING id, email, role", [typeof b.role === "string" ? b.role : null, typeof b.disabled === "boolean" ? Number(b.disabled) : null, id]);
    if (!rows[0]) throw new HttpError(404, "unknown_user", "No user has this id.");
    return response({ user: rows[0] });
  }
  throw new HttpError(405, "method_not_allowed", "This endpoint does not accept that method.");
}

export async function cleanAuth(sql: Sql, now: number): Promise<void> {
  await sql.run("DELETE FROM auth_sessions WHERE rowid IN (SELECT rowid FROM auth_sessions WHERE expires_at <= ? LIMIT 5000)", [now]);
  await sql.run("DELETE FROM auth_tokens WHERE rowid IN (SELECT rowid FROM auth_tokens WHERE expires_at <= ? LIMIT 5000)", [now]);
  await sql.run("DELETE FROM auth_limits WHERE rowid IN (SELECT rowid FROM auth_limits WHERE expires_at <= ? LIMIT 5000)", [now]);
}
