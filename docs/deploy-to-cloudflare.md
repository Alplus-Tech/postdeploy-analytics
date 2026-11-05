# Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Alplus-Tech/postdeploy-analytics)

This button starts Cloudflare's guided installation from the public GitHub source.
It does not sign you into this team's analytics installation.

## Before you begin

Use your own Cloudflare account and authorize GitHub or GitLab when Cloudflare
asks. The flow copies the repository to your account and connects Workers Builds.
Review the Worker name, account and D1 binding before accepting. Keep the Worker
name prefixed `postdeploy-`. Node 24.22.x and npm 11.x are the supported toolchain. `.node-version` and
`packageManager` pin the verified versions for Workers Builds.
The team deployment is verified on an existing Workers Paid plan. No subscription
is purchased automatically, and Free-plan password CPU is not certified.

Cloudflare provisions the `DB` D1 binding and updates its database ID in Wrangler
configuration. The deploy script builds assets, applies pending migrations to
`DB` and then deploys the Worker. It rejects the unprovisioned placeholder ID.
Database names may differ; migrations use the binding, not the source database name.

## Configuration and first owner

The `.dev.vars.example` keys describe the Worker values Cloudflare asks you to
provide. These are deployment secrets, never source-code defaults:

- `APP_ORIGIN`: the exact HTTPS origin of **your** deployment, with no trailing
  slash or path. Use the Worker URL displayed by Cloudflare, or your configured
  custom domain. Never copy this team's `analytics.postdeploy.dev` origin.
- `BOOTSTRAP_SECRET`: at least 32 random characters. Generate it privately, for
  example with `openssl rand -hex 32`, or use a password manager.

If the final URL is not known during configuration, set `APP_ORIGIN` in the
Worker's settings as soon as Cloudflare displays the URL, then redeploy. Until it
is correct, authentication fails closed. Do not turn on development mode to bypass
production origin checks.

Open `/auth` on your deployment and create the first administrator with that
secret and your own email/password. Confirm password login, then remove
`BOOTSTRAP_SECRET` from the Worker's settings and its deployment configuration.
Setup stays closed once an owner exists. Passwords need at least 12 characters
and must fit 72 UTF-8 bytes. Additional users are invitation-only.

Add a project, enter its exact production hostname and any aliases, and install
its tracking snippet. The public marketing page's example report is sample data;
your new dashboard starts empty. Reports use your own D1 binding.

Native Email is optional and disabled in the source template. Before invitations
or password-reset emails, onboard a sender domain, configure `EMAIL_FROM` and add
an `EMAIL` `send_email` binding as described in [operations](operations.md).
Operator recovery is available independently of email. No delivery is implied
by successful Worker deployment.

## Updates, backups and capacity

Cloudflare connects Builds to the copy created in your Git provider account.
Subsequent configured branch pushes build and deploy **your copy**. Changes in the
upstream repository are not automatically merged into it. Review and bring in
upstream changes deliberately, back up first and follow the offline upgrade
instructions when schema/storage changes require maintenance. Do not deploy an
older app against an incompatible schema or overwrite a database with a stale copy.

Ordinary migrations are tracked by D1. Existing compact installations require the
specific upgrade procedure in [compact storage](compact-storage.md), rather than
blindly applying legacy SQL to compatibility views. A new button installation
starts in the legacy layout. Consider the documented empty-database compact
conversion before production collection when planning long history. Default
retention is not a promise of unlimited capacity or free usage.

Use [operations](operations.md) for exports, isolated restore, owner recovery,
custom-domain changes and verification. Keep Cloudflare credentials and backups
private. Capacity depends on cardinality, visit/activity volume, retention and the
account's limits; see [performance](performance.md). Local proofs do not certify
fresh-account UI onboarding, real Email, sustained traffic or full-corpus remote
queries.

## Guided operator CLI

For explicit named installations, the original guarded path remains available:

```sh
npm ci
npm run setup -- init --name postdeploy-team --account YOUR_ACCOUNT_ID --origin https://YOUR_FINAL_HOST --sender analytics@example.com
npm run setup -- plan --name postdeploy-team
```

Follow [operations](operations.md) for its provision/secret/deploy/seal sequence.
`npm run deploy -- --name ... --execute ... --confirm-worker ...` keeps those
explicit target checks. `npm run deploy` without arguments is the provisioned
Cloudflare-template path and never creates a database from the placeholder.

Sources: [Cloudflare Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/),
[Workers Builds Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/),
[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/),
[Workers build image and version overrides](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).
