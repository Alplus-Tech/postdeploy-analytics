import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const configArgs = configIndex >= 0 ? args.splice(configIndex, 2) : [];
if (configArgs.length && (!configArgs[1] || configArgs[1].startsWith('--'))) throw Error('Missing config path');
if (![1, 3].includes(args.length) || !["--local", "--remote"].includes(args[0]) || (args.length === 3 && (args[1] !== "--persist-to" || args[0] !== "--local")) || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Usage: npm run recover -- --local|--remote [--persist-to <local directory>] [--config <installation config>] (interactive terminal required)");
  process.exit(1);
}
const account = configArgs.length ? JSON.parse(readFileSync(configArgs[1], 'utf8')).account_id : undefined;
const subprocessEnv = { ...process.env, ...(account ? { CLOUDFLARE_ACCOUNT_ID: account } : {}) };
const local = args[0] === "--local";
const targetArgs = [...configArgs, local ? "--local" : "--remote", ...args.slice(1)];
const status = JSON.parse(execFileSync("node_modules/.bin/wrangler", ["d1", "execute", "DB", ...targetArgs, "--command", "SELECT id FROM auth_users WHERE id = 'owner'", "--json"], { env: subprocessEnv, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }));
if (!Array.isArray(status) || !status.some((result) => result.results?.some((row) => row.id === "owner"))) {
  console.error("No initial administrator exists. Complete installation setup first.");
  process.exit(1);
}
const temporaryPassword = randomBytes(24).toString("base64url");
const hashed = await hash(temporaryPassword, 12);
mkdirSync(".scratch", { recursive: true });
const dir = mkdtempSync(join(process.cwd(), ".scratch", "recovery-"));
try {
  const file = join(dir, "recover.sql");
  writeFileSync(file, `UPDATE auth_users SET password_hash = '${hashed.replaceAll("'", "''")}', disabled = 0, revision = revision + 1 WHERE id = 'owner';\nDELETE FROM auth_tokens WHERE user_id = 'owner';\n`, { mode: 0o600 });
  execFileSync("node_modules/.bin/wrangler", ["d1", "execute", "DB", local ? "--local" : "--remote", "--file", file, ...args.slice(1), ...configArgs], { env: subprocessEnv, stdio: ["inherit", "ignore", "inherit"] });
  console.log("Initial administrator password reset; existing sessions revoked.");
  console.log("Temporary password (keep this terminal private): " + temporaryPassword);
  console.log("Sign in, then use Change password in the account menu to choose your own password.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
