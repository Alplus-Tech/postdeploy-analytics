# Install and operate your own installation

Use Node 24+, `npm ci`, and an existing Cloudflare account/subscription. These
commands do not buy a plan. Cloud authentication belongs to the operator: arrange
Wrangler authentication externally, then inspect `npx wrangler whoami`. Never
put credentials in commands, git, screenshots or support logs. Local proof is
available with `npm run test:install`; it creates only small isolated local data.
Use [operator acceptance](acceptance.md) for finite native HTTP variation and
guarded read-only history checks before choosing an installation capacity envelope.

## Configure and inspect

Choose a unique Worker/database name prefixed `postdeploy-`, your account ID,
the exact final HTTPS origin (no trailing slash), and sender address:

```sh
npm run setup -- init --name postdeploy-team --account YOUR_32_HEX_ACCOUNT_ID --origin https://postdeploy-team.YOUR_SUBDOMAIN.workers.dev --sender analytics@example.com
npm run setup -- plan --name postdeploy-team
npm run setup -- local --name postdeploy-team
npm run setup -- dry-run --name postdeploy-team
```

`init` only creates `.self-host/postdeploy-team/wrangler.json`. The source
`wrangler.jsonc` stays a development template with a placeholder ID. The private,
ignored installation directory is 0700; generated configuration/secrets are 0600.
Paths cannot be supplied by installation names. Configuration keeps Static Assets
under `demo`, API/script Worker routing, production authentication and the hourly
`17 * * * *` retention cron. Never place databases, exports or secrets under demo.
Plan reports account, Worker, D1 ID and origin without querying Cloudflare.

For local use, `local` applies migrations and generates a separate `.dev.vars`
bootstrap secret. Read that file privately for first-owner setup. Build, then run:

```sh
npm run build
npx wrangler dev --config .self-host/postdeploy-team/wrangler.json --local --ip 127.0.0.1 --port 8787 --var ENVIRONMENT:development --var APP_ORIGIN:http://127.0.0.1:8787
```

Local persistence defaults to the configuration directory's `.wrangler/state`.
Both modes require authentication; development permits a loopback HTTP origin.
Production requires HTTPS. `dry-run` bundles locally; it does not provision,
apply remote migrations or deploy.

## Explicit remote installation

Inspect Worker ownership before proceeding: `--confirm-worker` authorizes changing
that named Worker, including replacing an existing deployment. Use a new name for
another installation. The account ID in the generated config pins subprocesses
even if the shell contains a different account override.

```sh
npm run setup -- provision --name postdeploy-team --execute postdeploy-team
npm run setup -- secret --name postdeploy-team --execute postdeploy-team --confirm-worker postdeploy-team
npm run deploy -- --name postdeploy-team --execute postdeploy-team --confirm-worker postdeploy-team
```

Provision lists D1 before creation, creates only a missing name and verifies the
result before saving its ID. Repetition verifies the same binding. If creation
was interrupted or a name already exists, inspect ownership and resume provision
with `--database-id VERIFIED_UUID`; it never silently adopts or creates another
resource. Do not run concurrent provision commands. Deploy builds, lists/applies
migrations, then uploads Worker/assets. Failure leaves resources and data intact;
there is no destructive automatic rollback. After an authentication/quota error,
fix it externally and repeat the same stage. Process output is withheld on
failure because it could contain credentials; inspect Wrangler's private local
logs carefully. Provisioning, initial compact-schema import, deployment and owner login are now verified on the existing team account. Adapter tests still cover interruption cases; arbitrary fresh-account onboarding and replacement cutover remain unverified.

`secret` generates 256 random bits, reuses its private bootstrap file on retry,
and uploads via stdin. Read `bootstrap.secret` privately, open `/auth` at the
configured origin and create the owner. Confirm login, then remove the remote
setup secret:

```sh
npm run setup -- seal --name postdeploy-team --execute postdeploy-team --confirm-worker postdeploy-team
```

Retire the local bootstrap file securely after verification. Seal does not erase
local evidence. Removing/rotating the secret never reopens owner setup. Use
[operator recovery](authentication.md#operator-recovery) with the installation
config: `npm run recover -- --remote --config .self-host/postdeploy-team/wrangler.json`
(or `--local` for local recovery). It requires a private interactive terminal.
Never recover the wrong DB.

The installed app supports organisations/projects, explicit domain rules, goals,
activity and authenticated reports/CSV. Create a project, configure aliases,
install `/script.js`, then verify collection and reports. MCP, client permissions,
public sharing and configurable funnels remain planned; demo controls simulate
operations. Bcrypt CPU and real Email delivery require account acceptance.

## Email and account prerequisites

Cloudflare DNS is required. In Compute → Email Service → Email Sending, onboard
the sender domain; review SPF, DKIM, bounce MX and DMARC records and wait for
verification. `EMAIL_FROM` must belong to that domain. Enable an `EMAIL` binding in `send_email` after onboarding; the source template leaves it disabled. This is Email Service's
native `send_email` binding and object-based `send()` API, not an alternate mail
provider. The current unrestricted binding permits verified destination addresses
in the account. Verify each intended recipient before invitations/resets; optional
binding allowlists further restrict recipients/senders. Confirm invitation and
reset delivery to an allowed mailbox before relying on email recovery. Local mail
is simulated and may contain private links in files. Do not enable remote local
bindings just to test setup. No account/DNS/login changes are performed by setup.
[Domain onboarding](https://developers.cloudflare.com/email-service/get-started/send-emails/),
[binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/),
[Workers sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

## Back up and restore in isolation

Stop every writer, including collectors, administrator/auth writes and cron,
through a maintenance deployment/routing restriction under operator control.
Removing crons alone does not stop ingestion; block API writes and wait for
in-flight requests. There is no built-in online maintenance toggle or replication.
Rejected traffic is lost, not queued. Keep writers stopped through verification
and binding cutover. A restored snapshot must never replace subsequently accepted
writes: preserve the current source and use the offline recovery/replay contract
in [compact operations](compact-storage.md). There is no general automatic replay
of arbitrary writes; without a complete journal, restart from a current stopped
source rather than attempting to merge divergent databases.

Use `umask 077`, a new private ignored backup directory, and adequate free space.
For an offline local SQLite source, the helper refuses overwrites, checks integrity,
foreign keys, schema and every physical row/rowid, and retains a 10 GiB reserve:

```sh
node worker/scripts/backup.mjs copy "$DBFILE" "$NEW_BACKUP"
node worker/scripts/backup.mjs copy "$NEW_BACKUP" "$NEW_RESTORED_FILE"
node worker/scripts/backup.mjs verify "$DBFILE" "$NEW_RESTORED_FILE"
```

For remote D1, use the explicit source config and new SQL filename:

```sh
umask 077
npx wrangler d1 export DB --remote --config "$SOURCE_CONFIG" --output "$NEW_SQL"
```

Import SQL into an isolated local SQLite file first (`sqlite3 "$NEW_LOCAL" <
"$NEW_SQL"`), validate integrity/schema/migration ledger and counts, and test
owner login, domains, known project/organisation reports, sections, CSV and another
accepted write on a separate disposable copy. Keep the baseline unchanged for
comparison. Backups include password hashes, sessions, salts and analytics;
restrict access and encrypt off-host storage with existing tools. Agree a backup
frequency/recovery-point policy; rehearse restore before depending on it.

For replacement D1: create a distinct installation/config and provision its empty
DB. Do **not** run migrations or owner setup on that target before full-schema
import. Export the validated offline source with the existing exact exporter:

```sh
npm run storage:export -- "$NEW_LOCAL" "$NEW_PARTS_DIRECTORY" --parts
# Inspect manifest.json; import every numbered part in its listed order:
npx wrangler d1 execute DB --remote --config "$REPLACEMENT_CONFIG" --file "$NEW_PARTS_DIRECTORY/000001.sql"
# Repeat for subsequent manifest entries, never skip/reorder parts.
npx wrangler d1 execute DB --remote --config "$REPLACEMENT_CONFIG" --command 'PRAGMA foreign_key_check; PRAGMA quick_check; SELECT * FROM d1_migrations; SELECT count(*) FROM events; SELECT count(*) FROM visits;'
```

If any import fails, preserve evidence and use another empty replacement; do not
blindly replay a partially imported full schema. Export the replacement back to
local isolation and compare against the baseline with `backup.mjs verify`, then
reconcile report/CSV values and identifiers through an isolated Worker. Preserve
source config/application revision and database ID. Only after verification,
explicitly change the production binding to the replacement ID and deploy compatible
code/config while writes remain stopped. Verify owner access and known reports,
then resume cron/collection and prove another accepted write. Keep the old DB
and backups until the agreed recovery period passes. No helper drops resources.

[D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/) document
create/binding IDs, execute/export and migration flags;
[migrations](https://developers.cloudflare.com/d1/reference/migrations/) track the
ledger. [Import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
requires SQL, not a raw SQLite upload; export blocks database requests and has
virtual-table and large-integer precision caveats. Verify exact identities/values,
not just successful exit. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
include 5 GB import files, 100 KB statements, 30-second queries, and 500 MB Free /
10 GB Paid database ceilings. Our exporter splits at 16 MiB but a single oversized
statement still requires attention. Remote export/import limits are not proven
by local imports. [Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
and [deployment commands](https://developers.cloudflare.com/workers/wrangler/commands/)
describe the uploaded assets/Worker configuration. Sources checked 2026-11-05.

## Upgrade without discarding history

Keep a tested restorable backup and the exact prior app/config revision. Apply
ordinary legacy migrations offline, inspecting the pending list first. For large
populated stores, run the existing headroom upgrade before migration 0009; never
build whole-history indexes blindly on near-full remote D1. Active/retired compact
stores use the offline headroom path and preserve/reconcile `d1_migrations`; never
apply legacy index SQL to compatibility views. Follow compact operations for
prepare/resume/verify and copy/activate/retire. App-only rollback is safe only
when the previous version understands the installed schema.

Fresh databases start in legacy layout. **Recommended before first production
collection:** stop the local Worker, run compact prepare/copy/verify/activate on
its empty migrated file and retain the protected backup. Retire empty originals
only explicitly after restore proof. Export/import that schema into the empty
remote DB before deploying; the preserved ledger makes migrations a no-op.
This avoids large later conversion and does not auto-convert populated installs.
The legacy two-year target exceeds D1 capacity; even compact capacity, remote
CPU and sustained variation remain unaccepted (see performance.md).

Before retirement, compact rollback reconstructs current data including newer
writes. After retirement, restore the active backup in isolation, rollback there
and verify/replay before binding cutover. An old snapshot or app-only rollback
cannot undo an incompatible schema safely. Never automatically delete the old
DB, restore over the only source or treat Time Travel as a tested replacement
for a private independently restorable export.
