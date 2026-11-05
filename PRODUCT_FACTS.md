# Product facts

The single source for anything PostDeploy Analytics copy states as true. Copy may say what is listed under **Works today**. Anything under **Planned** is said as intent ("designed to", "will"), never as a shipped feature. Anything under **Not claimed** is not said at all.

Last checked against the code: the Worker in `worker/`, the dashboard in `demo/`, run locally with `wrangler dev` and a local D1 database.

## What exists

PostDeploy Analytics is a Cloudflare Worker with a D1 database, a tracking script and a dashboard. The team installation runs at https://analytics.postdeploy.dev on Cloudflare Workers and D1. Production owner password login and initial schema import are verified; Email and sustained capacity are not. The dashboard also opens straight from disk as an offline demo with generated sample data.

## Works today

Each fact was verified by running the app locally in a browser, by `curl`, or by the tests in `worker/test/` and `demo/test/`.

**Collection**
- A tracking script (`/script.js`) sends a pageview on load and on single-page navigation, and `postdeploy.track(name, { revenue })` records goals and revenue.
- The tracker sets no cookies and uses only ephemeral page memory on the visitor's device.
- The server stores the path, referrer host, source, campaign, country, device and browser. It does not store IP addresses or user agents; visitors are counted with a hash that uses a salt rotating daily.
- New projects exclude known bots and respect Do Not Track and Global Privacy Control by default. Existing projects retain their explicit settings.
- Event input is validated and size-limited; production pageviews, goals and activity require the canonical hostname or an explicit alias, with independent page URL and Origin checks. CORS is not authentication.
- Abuse limits: one visitor can send a burst of 20 events and then about one per second; a visit keeps at most 500 events and 20 goal events.

- Visible pages send activity every 30 seconds and on navigation, hiding and departure. Signals never count as pageviews or goals. The script exceeds 1 KB; request overhead is two pulses per visible minute plus lifecycle signals.

**Reports**
- Overview, Audience, Conversions and Live are computed from stored events: visitors, pageviews, bounce rate, visit duration, conversions and revenue, by source, referrer, campaign, country, device, browser, page and entry page.
- Visits expire after 30 minutes without activity, local midnight or timezone changes. A bounce has exactly one pageview and no goal event. Visible duration averages only measured visits; legacy/unmeasured duration is unknown. See the measurement ADR for conservative boundary loss and concurrency limits.
- Days and hours follow each website's time zone; a time zone change applies to visits recorded after it.
- Date ranges (today, 7, 30 and 90 days, 12 months, custom), comparison with the previous period or last year, and combinable filters.
- Pageviews and visit numerators aggregate across breakdown groups. Daily uniques can repeat across groups when the same daily visitor has visits with different attribution.
- A funnel per website counts visits that reach each step in order; paths to purchase list the most common page sequences before a payment.
- Live shows visitors in the last five minutes, pageviews per minute and the latest events, with a timeline for any visit.

**Domains and privacy**
- Administrators manage canonical hostnames, up to 20 aliases and up to 20 excluded path prefixes in Settings. Viewers read rules and copy snippets. Unlisted staging/subdomains cannot collect in production; hostname claims cannot overlap projects.
- Matching paths and descendants are excluded before persistence, including encoded paths and activity. Rules apply to future collection; existing history is preserved. See ADR 0005 for normalisation and migration rules.
- Only utm_source/utm_campaign attribution survives. The tracker strips other queries, fragments and referrer paths before sending. Campaign values and unexcluded paths still need site-specific privacy review. No automatic personal-data detection or legal compliance is claimed.
- Public sharing is unavailable; reports remain authenticated.

**Websites**
- Add a website with starter goals and a funnel, rename it, change its settings, check that its tracking code is sending events, and remove it when it has no event history. Projects with history are protected from deletion.
- Retention: hourly bounded cleanup removes events older than the website's setting (6, 12 or 24 months, or forever) are deleted, along with visitor-id salts older than two days.

**Organisations and projects**
- An installation contains organisations, each grouping multiple projects. A project retains its existing website and tracking identifier.
- Administrators create and rename organisations, create projects within them and move projects with their full history. Viewers read all organisations and projects.
- Organisation visit summaries use visit starts within the UTC range and sum bounce/duration numerators and denominators; existing traffic counts remain event-based.
- The organisation home shares the dashboard workspace chrome, six-figure ledger and correctly sized chart, with UTC daily pageviews, previous-period comparison, ranked project contribution, keyboard tooltips and exact tables. Administrator management has its own view. Date and exact dimension filters apply to the combined report.
- Project visitor-days sum per-project local-day visitor identities observed within the selected UTC event window. These figures do not deduplicate people across projects or days. Project reports retain their configured timezone, so date-edge totals can differ.
- Existing installations migrate websites to a default organisation without changing their event history, settings, users or tracker IDs. Existing project report URLs and collection endpoints remain supported.

**Installation access**
- Email/password authentication in development and production, without public registration.
- One-time first-administrator setup protected by an installer-held secret.
- Administrator and Viewer roles; all users can read every website, only administrators can change them.
- Cloudflare Email invitations/reset links; expiring single-use links, password changes and operator recovery.
- Hashed session tokens, HTTPS secure cookies, CSRF checks and D1-backed authentication rate limits.
- Cloudflare delivery is simulated locally; delivery to real recipients has not been verified.

**Dashboard**
- Kept in the URL: website, date range, comparison, filters and chart metric.
- Keyboard operable; text and control colours meet WCAG 2.2 AA contrast, measured from the colour tokens; works at phone width (390 px) and desktop width without sideways scrolling.

## Not available yet

These screens show the intended design but are locked in the app.

- API keys and agent access over MCP. Client-specific access and public dashboard sharing are not implemented.
- Payment provider webhooks; revenue currently comes from `track()` calls on the website.
- Updating an installation from the dashboard; updates deploy from the repository.

## Offline demo

Opened from disk, the dashboard runs on generated sample data for three fictional websites. Deployment, invitations, API keys and MCP are simulated there, and a **Demo controls** menu shows failure states.

## Planned (not built)

Say these only as intent.

- Fresh-account acceptance of the guided deployment CLI; local installation/restore, process-adapter tests and one existing-account production provisioning/deployment exist; the full button onboarding flow on a separate account remains unverified.
- Final mixed-workload and deployed acceptance of the two-year capacity target; no lossy daily rollups are implemented.
- A token-authenticated API and an MCP server, so AI assistants can answer questions about traffic and revenue within the access they are given.
- Product-only source is publicly available on GitHub; private local instruction history and installation data are excluded.

## Not claimed

- Any unmeasured speed, capacity or cost figure. Tracker size and periodic request overhead are measured separately.
- Compliance with GDPR, ePrivacy or any other regulation.
- "One click" deployment.
- Customers, usage numbers, testimonials or comparisons with named products.

## Configurable goals and CSV
- Administrators add exact normalised page-path goals or named events, rename labels and archive rules. Matching rules stay immutable and prospective; archived history stays reportable. Maximum 40 goals including archives, one rule per normalized path/event name. Existing starter IDs, event API and revenue remain supported.
- Page goals need no extra snippet and never add navigation pageviews; page tokens deduplicate retries. Named events use postdeploy.track after successful actions. Activity never completes goals. Bounce includes page and named completions.
- Completion counts include repeats. Daily-unique rates deduplicate goal-completing visitor-days against visitor-days in the same event window, range and filters. Overall rates union goals; organisation rates divide summed project numerators by summed denominators. Empty denominators give zero.
- Authenticated Administrators and Viewers download filtered project series/goals/tables and organisation series/projects/goals/totals as CSV. Exports include context, coverage and bounds; unknown duration stays blank. Up to 731 days and 10,000 rows; selected top-100 breakdowns remain explicitly bounded. No raw-event/identity export.

## Exploratory insights
- Organisation and project reports link to Insights: selectable traffic area/line trends and previous-period comparisons, stacked source/project pageviews, ranked acquisition/project/page/landing/campaign bars, weekday/hour activity heatmap, daily-unique conversion trends, and measured visible-duration histogram.
- Tables and guarded CSV provide exact counts. Conversion rates expose converted and eligible visitor-days plus repeat completion occurrences. A selected goal uses only its project's eligible visitor-days; overall conversion unions goals and sums project populations. No averaging rates or stacking audiences.
- Composition includes top six categories and a complete Other; rankings include top 20 plus Other, with unioned rate denominators. These Insights aggregations do not inherit older report top-100 truncation. Heatmaps total pageviews without normalising for weekday frequency. Duration uses fixed measured-only bins and separately states unknown visits and coverage.
- Insights allows 731 days, eight exact filters and up to 50 organisation projects. Buckets are hourly for one day, daily through 92 days, then seven-day intervals anchored at the range start. Organisation event times are UTC; project bins retain recorded local day/hour. No cross-day people, retention cohorts, payment attribution or funnel builder is inferred.


## Collection and retention
- Collection uses a shared atomic D1 limiter per project/daily visitor: burst 20, one request per second refill, across pageviews, named goals and activity. Privacy gates precede admission. 429 includes Retry-After.
- Hourly bounded cleanup reports actual deletions and remaining work, preserves metadata required by retained events, and separately expires transient page/rate/auth/salt state. Retention remains 6/12/24 months or forever, subject to storage limits.
- The original layout exceeded the single-database two-year storage budget. Compact storage and terminal assignment expiry provide a measured replacement; see docs/performance.md for current retained-size, workload, limitations and pulse-inclusive cost assumptions. Overall deployed/mixed capacity remains unaccepted.

Session selection includes physical events and eventless visits, preserving
filtered visit populations and unknown legacy duration. Compact storage has
protected offline prepare/copy/verify/activate/rollback/retire/export operations.
Terminal assignment expiry changes only operational closed state, in bounded
batches. Zero-reference dimensions clear/reuse with foreign keys intact. Logical
fields and packed identities remain exact; no history is removed for compaction.

Physical storage evidence is 328,716,288 bytes for a million-pageview fixture and
8,022,323,200 bytes for a separate actual two-year corpus plus collector writes,
including indexes/metadata/fragmentation. The latter has 1.978 GB below the hard
10 GB ceiling; the 8 GB engineering guide misses by 22.32 MB. Free pages do not
shrink the measured file. Cardinality, pulse/visit rate, fragmentation and retention
change an installation's envelope. No universal 50-project/million-month fit or
deployed capacity is claimed; see docs/performance.md.

Organisation reports/Insights use narrow exact compact projections, shared
statement-local facts, global rankings and correct Other unions, with cooperative
project partitions. No persistent cache, schema or collection writes are added.
Current browser month summary/full completion was 5.267/32.141 seconds for
organisation overview and 5.866/49.047 seconds for Insights. The five-second
first-open guide is not a user SLA. Selected guarded full-history results and
finite native mixed/variation evidence are documented separately in performance.md;
local wall time is not deployed CPU, throughput or billing evidence.

Organisation overview and Insights progressively show exact sections. Traffic
summary loads first; goals, visit measurements and individual chart families have
separate loading/error states and manual retries. Pending fields are omitted,
not displayed as zero. Apply commits date/filter controls; a new selection aborts
old browser requests and guards late responses. One analytics request per page
runs at a time. Comparison traffic summary can finish separately and is dated.
Charts retain exact tables and complete server-generated CSV downloads.

These are independent current reads, not a transactional snapshot across all
sections. Collection can change totals between reads. No cached results,
persistent derived state, schema changes or new collection writes are added.
First useful summary latency and complete chart latency are different measures;
progressive rendering does not certify full-month, whole-year or deployed speed.

## Operator tooling

Private per-install configuration, nonmutating plans, explicit D1 provisioning/binding, migrations/build/deploy and stdin bootstrap secrets are implemented. A local end-to-end rehearsal covers authentication, collection, reports/CSV, backup, isolated D1 restore, accepted continuation writes and populated compact rollback. Protected offline copies verify integrity/schema/rows. No automatic live replication, resource deletion, remote restore or real account delivery is claimed. See docs/operations.md.

## Source licensing and packaging

Project-owned code now carries MIT. bcryptjs 3.0.3 remains BSD-3-Clause; Onest
and Open Runde remain OFL-1.1. Exact lock metadata is inventoried, including
optional tooling packages that are not redistributed in the source archive.
A committed allowlist produces a bounded deterministic source archive with a
revision/file manifest and SHA-256 checksums. Extracted sources can independently
install, build, test and rehearse local installation. Built static assets carry
license notices; the Worker carries the full bcrypt notice in a legal comment.
Asset provenance limits are recorded in THIRD_PARTY_NOTICES.md. This packages a
source candidate. Public GitHub snapshots use separate audited history; private
local ancestors remain excluded. Packaging does not certify remote CPU, Email,
restore/cutover or capacity variation.


## Bounded long sections and operator acceptance

Exact section streams emit progress only after actual completed reads. Pending
values remain pending until a complete frame arrives. Browser inactivity is bounded
to 30 seconds; query waits to 25 seconds; sections to ten minutes/2,000 statements.
Cancellation stops later reads but cannot cancel an already running D1 query.
Long organisation windows use single-project partitions without changing unions,
filters, global ranking or CSV semantics. JSON callers keep their response shape.
There is no durable job, cached partial result or transactional snapshot.

`test:acceptance` runs finite real HTTP collection/report/export and access checks
with exact persisted metrics on isolated small fixtures in both layouts.
`test:history` calls actual builders on an existing corpus read-only with query,
memory, temporary-storage and total-time guards. See docs/acceptance.md. Local
checks include completion of every full organisation Insights family and overview
series/goals on the documented 24-million-visit corpus, separately through the
stream, with known-population and exact table/CSV reconciliation. These offline
reads do not establish native full-corpus HTTP. Bounded explicit errors and local
checks are not a claim that every 731-day scope completes on every workload or
that sustained/deployed capacity is certified.

## Public site and private workspace

The public site has a homepage, `/features`, `/self-host` and `/privacy`, with explicitly labelled sample report figures and a separate sample-data demo at `/demo?demo=1`. Deploy to Cloudflare is the primary public action; GitHub provides the source. `/auth` signs in to the invitation-only installation; `/organisations`, `/dashboard` and `/insights` require an authenticated session, and report APIs remain protected. Successful login opens the organisation workspace. Public source uses an explicit product-file allowlist, without private configuration or local instruction history. The installation measures public pageviews and deploy, GitHub, demo and team-sign-in clicks with its own tracker. Email remains optional and requires operator configuration before invitations or resets can be delivered.
