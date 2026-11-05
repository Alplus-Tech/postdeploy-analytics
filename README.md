<img src="assets/icon.svg" width="64" height="64" alt="">

# PostDeploy Analytics

Privacy-first web analytics, designed to run in your own Cloudflare account.

A Cloudflare Worker with a D1 database collects pageviews and goals through a small cookieless tracking script and serves the dashboard and reports. The public homepage explains the product; `/auth` opens installation access, and `/organisations` and `/dashboard` are private workspaces. `/demo?demo=1` offers public sample reports. The same dashboard also opens straight from disk as an offline demo with generated sample data.

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Alplus-Tech/postdeploy-analytics)

Install from the public GitHub source into your own Cloudflare account. Cloudflare copies the repository, configures Workers Builds and provisions D1. Provide your installation’s exact `APP_ORIGIN` and a private random `BOOTSTRAP_SECRET`; the deploy command builds assets and migrates the `DB` binding before uploading the Worker. Open `/auth`, create the owner, confirm login and remove the setup secret. Native Email needs separate configuration. No plan is purchased automatically.

Read [the button guide](docs/deploy-to-cloudflare.md) for prerequisites, updates and recovery.

## Self-host installation

Use the [installation and operations guide](docs/operations.md) for private per-install configuration, explicit Cloudflare provisioning/deployment, owner setup, backups, isolated restore and upgrades. `npm run setup -- plan --name postdeploy-team` inspects an existing configuration without remote calls. `npm run test:install` rehearses a complete small installation locally. The team installation runs at [analytics.postdeploy.dev](https://analytics.postdeploy.dev). Initial D1 provisioning/import, deployment and owner password login are verified on the existing Workers Paid account. Real Email delivery, Free-plan password CPU and sustained capacity remain unverified.

## Open the offline demo

Open `demo/index.html` in a browser. It works straight from disk, after `npm ci && npm run build`, with no runtime network access (checked in Chrome).

If your browser restricts pages opened from local files, serve the repository root instead and open `http://localhost:8000/demo/?demo=1`:

```sh
python3 -m http.server 8000
```

Websites you create, and the sample pageviews sent to them, are kept in that browser until you choose **Reset the demo**. Team members, keys and other changes reset on reload. The selected website, date range, comparison and filters are kept in the URL.

## Run the Worker locally

The backend is a Cloudflare Worker with a D1 database. It serves the dashboard in `demo/` as static assets, the tracker at `/script.js` and the API described in [docs/api.md](docs/api.md). Everything below runs on your machine; nothing is created in a Cloudflare account.

```sh
npm ci
npm run build
npm run db:migrate   # create the tables in the local D1 database
npm run seed         # 90 days of sample events for the three sample websites
npm run dev          # http://127.0.0.1:8787 with ENVIRONMENT=development
npm test
npm run typecheck
```

`SEED_SCALE` (default `0.05`) sets the seed volume relative to each sample website's daily visitors, and `SEED_DATE=YYYY-MM-DD` fixes the last seeded day.

Before starting, create an ignored `.dev.vars` with a generated `BOOTSTRAP_SECRET` (at least 32 random characters) and `EMAIL_FROM` for local simulated email. Sign in at `/auth` to securely create the first administrator. Both development and production require authentication; Administrators manage the installation and Viewers read all websites. See [installation access](docs/authentication.md) for email, sessions, invitations and operator recovery.

Retention runs hourly (cron `17 * * * *`, UTC). To try it locally on a throwaway database, start `npx wrangler dev --test-scheduled --persist-to <temporary folder>` and open `/__scheduled?cron=17+*+*+*+*`.

`wrangler.jsonc` holds a placeholder D1 `database_id`. The owner creates the database and sets the real id when deploying.

## What it covers

- **Overview**: visitors, pageviews, bounce rate, visit duration, conversions and revenue, with a trend chart and period comparison.
- **Audience**: sources, referrers, campaigns, countries, devices, browsers and pages, sortable and filterable.
- **Conversions**: page/named goals, completion rates and revenue. Starter funnel/path views do not provide a configurable funnel builder.
- **Live**: current visitors, a stream of events and a timeline for any visit.
- **Manage**: projects, tracking code, team and settings. API keys, MCP and in-app deployment remain planned.
- **First-run setup**: check the installation, add a website, install the tracking code and wait for its first event.

Date ranges, comparisons, filters and the selected website live in the URL, so any view can be bookmarked. In the offline demo, the **Demo controls** menu shows loading failures and a failed deployment. In the app, Administrators manage real users through Team. API keys and agent access remain planned.

The [first-release roadmap](docs/roadmap.md) and [glossary](GLOSSARY.md) define the direction. What works today, what is locked and what is planned is listed in [PRODUCT_FACTS.md](PRODUCT_FACTS.md); how the product speaks is in [VOICE.md](VOICE.md).

## Tests

```sh
npm test                          # Worker: ingestion validation, origin rule, report calculations
node --test demo/test/*.test.js   # offline demo: sample data stays consistent
```

## Credits

Typeface: [Onest](https://github.com/simpals/onest), SIL Open Font License 1.1 (`demo/fonts/OFL.txt`).

Wordmark typeface: [Open Runde](https://fontsource.org/fonts/open-runde), SIL Open Font License 1.1 (`demo/fonts/OFL-open-runde.txt`).

Existing or empty installations can opt into [compact analytics storage](docs/compact-storage.md) during an offline maintenance window. Activation, retirement and recovery are explicit operator stages.

## License and source package

Project-owned code is available under [MIT](LICENSE). Third-party code and fonts
retain their own rights and licenses; see [notices](THIRD_PARTY_NOTICES.md).
`private: true` prevents accidental npm publication. It does not restrict source use.

Use Node 24.22.x and npm 11.x. [Source distribution](docs/source-distribution.md)
describes the reproducible archive, checksums and clean extracted installation.
The local candidate includes product sources, lockfile, migrations, operator
scripts, tests, assets and docs, without Git history or private installation data.
No public release or real Cloudflare deployment has been performed.

[Operator acceptance](docs/acceptance.md) provides reproducible native HTTP and
guarded offline full-history commands, with explicit evidence boundaries.
