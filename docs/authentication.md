# Installation access

All users can read every website. Administrators manage users, websites and settings; Viewers cannot change them. There is no public signup, client-specific access or anonymous report sharing. The first administrator is protected from role changes/disabling through the API. Ordinary role changes or disabling a user invalidate their existing sessions immediately.

## Local setup

Use Node.js 24 or later. Install dependencies, build the browser module and apply local migrations:

```sh
npm install
npm run build
npm run db:migrate
```

Create an ignored `.dev.vars` file. Generate your setup secret with `openssl rand -hex 32`; put it in `BOOTSTRAP_SECRET`. Set `EMAIL_FROM` to an example sender for local simulation. Do not commit this file. `npm run dev` supplies the loopback development origin and serves the app at `http://127.0.0.1:8787`.

Open the app, enter your setup secret, email and a password of at least 12 characters (maximum 72 UTF-8 bytes). Setup accepts exactly one first administrator, even with simultaneous requests. After setup, remove `BOOTSTRAP_SECRET` from the installation's secrets. Removing or rotating it never reopens setup.

The backend has no development authentication bypass. Open `/?demo=1` to explicitly use fictional, offline data on an HTTP server, or open `demo/index.html` directly after building. A missing backend does not silently switch the installed dashboard to sample data.

## Cloudflare configuration

Before an authorized deployment:

- Set `APP_ORIGIN` to the exact HTTPS origin, without a path, query or credentials. Emails and request-origin checks use this value, not a request's Host header.
- Set the random `BOOTSTRAP_SECRET` through the deployment secrets flow.
- Onboard a sender domain in Cloudflare Email Service and set `EMAIL_FROM` to an address on it. `wrangler.jsonc` binds `EMAIL` with `send_email`.
- Configure permitted recipients/senders in the binding for your installation where appropriate. Cloudflare's account/recipient verification and plan requirements still apply.
- Provision/bind D1 and apply migrations. Use the explicit per-install [setup and operations flow](operations.md). Deploy requires the named target and Worker confirmation; it builds, lists/applies remote migrations, then deploys. Fresh-account provisioning remains unverified.

Cloudflare Email configuration: https://developers.cloudflare.com/email-service/configuration/send-bindings/

Worker sending API: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/

**Local sending is simulated by default.** Wrangler saves message bodies in local files and logs their paths. Keep those files/logs private: the bodies contain invitation/reset links. Do not set `remote: true` merely to test a flow; that sends real mail.

## Invitations and password recovery

Administrators invite users from Manage → Team. Invitations expire after 24 hours; password-reset links expire after one hour. Both are single-use. Pending invitations can be resent from the same form. Failed sends invalidate their links and show an actionable error to the administrator. Password-reset requests return the same public message for known and unknown addresses; delivery failures are logged without addresses, tokens or provider errors.

Email links carry the token in a fragment. The access page removes it from the URL immediately and keeps it in memory until submission. Setting or changing a password invalidates existing sessions and outstanding links. The account menu also supports changing a password using the current password, without email.

Sessions use random 256-bit tokens; only their hashes are stored. Cookies are HttpOnly, SameSite=Strict, Secure on HTTPS and expire after seven days. Logout revokes the session server-side. Mutations require the configured Origin plus a session-specific CSRF header. Anonymous authentication attempts and password-reset/invitation sending have D1-backed fixed-window limits shared across Worker instances. Passwords use bcrypt cost 12; benchmark its CPU cost on the intended Workers plan. Free-plan CPU compatibility is not claimed.

## Operator recovery

From a trusted interactive terminal with access to the installation's Wrangler configuration:

```sh
npm run recover -- --local
# For a separate local test database:
npm run recover -- --local --persist-to .scratch/example-database
# Remote recovery changes production credentials; use only when authorized:
npm run recover -- --remote --config .self-host/postdeploy-team/wrangler.json
```

The command resets and enables the initial administrator, revokes their sessions/links and prints a generated temporary password only in that terminal. It does not send email. Sign in, then choose Change password in the account menu. The email address stays unchanged. Temporary SQL is private, contains only a password hash and is removed after execution. A failed command preserves the database; it does not bypass authentication. Apply migrations before recovery.

## Verification

```sh
npm test
npm run typecheck
npm run build
node --test demo/test/*.test.js
```

HTTP tests cover setup races, authentication in both modes, CSRF, role denials, session revocation, single-use/expired links, email errors and rate limiting. Live Cloudflare delivery and fresh-account deployment require separate verification.
