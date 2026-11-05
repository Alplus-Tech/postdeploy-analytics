type User = { id: string; email: string; role: "admin" | "viewer" };
type Session = { user: User | null; csrf: string | null; setupRequired: boolean; emailConfigured: boolean };
let current: Session = { user: null, csrf: null, setupRequired: false, emailConfigured: false };
const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function user(value: unknown): value is User {
  return record(value) && typeof value.id === "string" && typeof value.email === "string" && (value.role === "admin" || value.role === "viewer");
}
async function call(path: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (current.csrf) headers["X-CSRF-Token"] = current.csrf;
  const result = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data: unknown = await result.json();
  if (!result.ok) {
    if (result.status === 401 && location.pathname !== "/auth") location.assign("/auth");
    throw new Error(record(data) && typeof data.message === "string" ? data.message : "The request failed. Try again.");
  }
  if (!record(data)) throw new Error("The server returned an unexpected response.");
  return data;
}
async function refresh(): Promise<Session> {
  const data = await call("/api/auth/session");
  if (!(data.user === null || user(data.user))) throw new Error("The server returned an unexpected session.");
  current = { user: data.user, csrf: typeof data.csrf === "string" ? data.csrf : null, setupRequired: data.setupRequired === true, emailConfigured: data.emailConfigured === true };
  return current;
}
async function logout(): Promise<void> {
  await call("/api/auth/logout", "POST", {});
  location.replace("/auth");
}

async function mountTeam(root: HTMLElement): Promise<void> {
  if (current.user?.role !== "admin") { root.innerHTML = '<p class="muted">An administrator manages users. Your Viewer account can read all websites.</p>'; return; }
  root.innerHTML = '<p role="status">Loading users…</p>';
  try {
    const data = await call("/api/users");
    const users = Array.isArray(data.users) ? data.users.filter(user) : [];
    root.innerHTML = `<p class="muted">Every active user can read all websites. Administrators also manage users, websites and settings.</p>
      ${data.emailConfigured ? "" : '<div class="notice err">Cloudflare Email is not configured. Configure the email binding and sender before inviting users.</div>'}
      <form class="form-row" data-auth-invite>
        <div class="field"><label for="team-email">Email address</label><input class="input input-lg" id="team-email" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="team-role">Role</label><select class="select input-lg" id="team-role" name="role"><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></div>
        <button class="btn btn-primary" type="submit" ${data.emailConfigured ? "" : "disabled"}>Send invitation</button>
      </form><p data-auth-message role="status" aria-live="polite"></p>
      <div class="table-scroll"><table class="table auth-users"><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Access</th></tr></thead><tbody>
      ${users.map((u) => {
        const row: Record<string, unknown> = u;
        const protectedUser = u.id === "owner" || u.id === current.user?.id;
        return `<tr><td data-label="Email">${esc(u.email)}</td><td data-label="Role"><label class="visually-hidden" for="team-${esc(u.id)}">Role for ${esc(u.email)}</label><select class="select" id="team-${esc(u.id)}" data-user-role="${esc(u.id)}" ${protectedUser ? "disabled" : ""}><option value="viewer" ${u.role === "viewer" ? "selected" : ""}>Viewer</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrator</option></select></td><td data-label="Status">${row.disabled ? "Disabled" : row.pending ? "Invitation pending" : "Active"}</td><td data-label="Access">${protectedUser ? "Protected administrator" : `<button type="button" class="btn btn-sm" data-user-toggle="${esc(u.id)}" data-disabled="${row.disabled ? "0" : "1"}">${row.disabled ? "Enable" : "Disable"}</button>`}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    const message = root.querySelector<HTMLElement>("[data-auth-message]");
    const show = (value: string): void => { if (message) message.textContent = value; };
    root.querySelector<HTMLFormElement>("[data-auth-invite]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!(form instanceof HTMLFormElement)) return;
      const values = new FormData(form);
      const button = form.querySelector<HTMLButtonElement>("button");
      if (button) button.disabled = true;
      show("Sending invitation…");
      try {
        const result = await call("/api/users/invite", "POST", { email: values.get("email"), role: values.get("role") });
        await mountTeam(root);
        const next = root.querySelector<HTMLElement>("[data-auth-message]");
        if (next) next.textContent = String(result.message);
      } catch (error) { show(error instanceof Error ? error.message : "Invitation failed."); if (button) button.disabled = false; }
    });
    root.querySelectorAll<HTMLSelectElement>("[data-user-role]").forEach((select) => select.addEventListener("change", async () => {
      select.disabled = true;
      try { await call("/api/users/" + select.dataset.userRole, "PATCH", { role: select.value }); await mountTeam(root); }
      catch (error) { show(error instanceof Error ? error.message : "Role change failed."); select.disabled = false; }
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-user-toggle]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await call("/api/users/" + button.dataset.userToggle, "PATCH", { disabled: button.dataset.disabled === "1" }); await mountTeam(root); }
      catch (error) { show(error instanceof Error ? error.message : "Access change failed."); button.disabled = false; }
    }));
  } catch (error) { root.innerHTML = `<p role="alert">${esc(error instanceof Error ? error.message : "Users could not be loaded.")}</p><button class="btn" type="button" data-auth-retry>Try again</button>`; root.querySelector("[data-auth-retry]")?.addEventListener("click", () => { void mountTeam(root); }); }
}

window.PostDeployAuth = { refresh, call, logout, mountTeam, get user() { return current.user; }, get csrf() { return current.csrf; } };

declare global {
  interface Window {
    PostDeployAuth: { refresh: typeof refresh; call: typeof call; logout: typeof logout; mountTeam: typeof mountTeam; readonly user: User | null; readonly csrf: string | null };
  }
}

const host = document.querySelector<HTMLElement>("#auth-view");
if (host) {
  const root = host;
  const params = new URLSearchParams(location.hash.slice(1));
  let token = params.get("token");
  let mode = params.get("auth") === "invite" || params.get("auth") === "reset" ? "accept" : params.get("auth") === "password" ? "password" : "login";
  history.replaceState(null, "", location.pathname);
  const field = (name: string, label: string, type: string, autocomplete: string): string => `<div class="field"><label for="auth-${name}">${label}</label><input class="input input-lg" id="auth-${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" required ${name === "password" && mode !== "login" ? 'minlength="12" aria-describedby="password-help"' : ""}></div>`;
  function render(message = ""): void {
    const setup = mode === "setup";
    const accept = mode === "accept";
    const forgot = mode === "forgot";
    const change = mode === "password";
    const title = change ? "Change your password" : setup ? "Set up your installation" : accept ? "Choose your password" : forgot ? "Reset your password" : "Sign in";
    document.title = `${title} · PostDeploy Analytics`;
    root.innerHTML = `<h1>${title}</h1><p class="muted">${change ? "Changing your password signs out your other sessions." : setup ? "Create the first administrator using the setup secret from your deployment." : accept ? "Use at least 12 characters. This link can be used once." : forgot ? "We'll email a reset link if this address belongs to an active user." : "Open your websites' analytics."}</p>
      <form class="stack" id="auth-form">
        ${setup ? field("secret", "Setup secret", "password", "off") : ""}
        ${change || accept ? "" : field("email", "Email address", "email", "username")}
        ${change ? field("currentPassword", "Current password", "password", "current-password") : ""}
        ${forgot ? "" : field("password", "Password", "password", mode === "login" ? "current-password" : "new-password")}
        ${!forgot && mode !== "login" ? '<p class="help" id="password-help">At least 12 characters; up to 72 UTF-8 bytes.</p>' : ""}
        <p id="auth-message" role="status" aria-live="polite">${esc(message)}</p>
        <button class="btn btn-primary input-lg" type="submit">${change ? "Save password" : setup ? "Create administrator" : accept ? "Save password" : forgot ? "Send reset link" : "Sign in"}</button>
      </form>
      <div class="auth-links">${mode === "login" ? '<button class="btn btn-ghost" type="button" data-mode="forgot">Forgot password?</button>' : setup ? "" : '<button class="btn btn-ghost" type="button" data-mode="login">Back to sign in</button>'}</div>`;
    root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.addEventListener("click", () => { mode = button.dataset.mode ?? "login"; token = null; render(); root.querySelector<HTMLInputElement>("input")?.focus(); }));
    root.querySelector<HTMLFormElement>("#auth-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!(form instanceof HTMLFormElement)) return;
      const values = new FormData(form);
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
      const messageNode = root.querySelector<HTMLElement>("#auth-message");
      if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
      if (messageNode) messageNode.textContent = "Please wait…";
      try {
        const payload = mode === "accept" ? { token, password: values.get("password") } : Object.fromEntries(values);
        const result = await call("/api/auth/" + mode, "POST", payload);
        if (mode === "setup" || mode === "login" || mode === "password") { location.replace("/organisations"); return; }
        if (mode === "accept") { token = null; mode = "login"; render(String(result.message)); }
        else if (messageNode) messageNode.textContent = String(result.message);
      } catch (error) { if (messageNode) { messageNode.setAttribute("role", "alert"); messageNode.textContent = error instanceof Error ? error.message : "The request failed. Try again."; } }
      finally { if (button) { button.disabled = false; button.removeAttribute("aria-busy"); } }
    });
  }
  void refresh().then((session) => {
    if (mode === "password" && !session.user) mode = "login";
    if (mode !== "accept" && mode !== "password" && session.user) { location.replace("/organisations"); return; }
    if (session.setupRequired) mode = "setup";
    render();
  }).catch((error: unknown) => {
    root.innerHTML = `<h1>Installation needs attention</h1><p role="alert">${esc(error instanceof Error ? error.message : "The installation could not be reached.")}</p><button type="button" class="btn" id="auth-retry">Try again</button>`;
    root.querySelector("#auth-retry")?.addEventListener("click", () => location.reload());
  });
}
export {};
