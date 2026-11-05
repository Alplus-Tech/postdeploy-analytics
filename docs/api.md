# PostDeploy Analytics HTTP API

The dashboard in `demo/` talks to the Worker only through these endpoints. All responses are JSON unless stated. Times are Unix milliseconds. Days are `YYYY-MM-DD` in the website's time zone.

## Access

| Endpoint group | Who may call it |
| --- | --- |
| `GET /script.js`, `POST /api/event`, `GET /api/health` | Anyone. The tracker runs on visitors' browsers. |
| `/api/auth/*` | Session/setup/login/invitation acceptance/reset endpoints. Password change and logout require a session. |
| Other GET requests under `/api/` | Active Administrator or Viewer session; `/api/users` requires Administrator. |
| Other mutations under `/api/` | Administrator session, exact configured Origin and `X-CSRF-Token`. |

Errors are `{"error": "<code>", "message": "<sentence>"}` with a matching status (400 invalid input, 403 origin or page address not allowed, 404 unknown site or endpoint, 405 wrong method, 409 conflict, 413 too large, 429 too many events from one visitor, 503 not configured).

## Authentication

See [installation access](authentication.md) for setup, email configuration and recovery. All authentication and owner responses use `Cache-Control: no-store`.

- `GET /api/auth/session` → `{ user, csrf, setupRequired, emailConfigured }` (user/CSRF are null when signed out).
- `POST /api/auth/setup` `{ email, password, secret }` initializes the first administrator once and creates a session.
- `POST /api/auth/login` `{ email, password }` creates a session.
- `POST /api/auth/logout` `{}` revokes the current session.
- `POST /api/auth/forgot` `{ email }` requests an expiring reset email with a generic public response.
- `POST /api/auth/accept` `{ token, password }` consumes an invitation/reset link and sets a password; sign in afterward.
- `POST /api/auth/password` `{ currentPassword, password }` changes the signed-in user's password, revokes other sessions and creates a replacement session.
- `GET /api/users` lists users and email readiness (Administrator only).
- `POST /api/users/invite` `{ email, role: "admin" | "viewer" }` invites or reinvites a pending user.
- `PATCH /api/users/:id` `{ role?, disabled? }` changes access and revokes sessions. The initial administrator and current user's own account are protected.

All POST/PATCH requests require `Content-Type: application/json` and the configured Origin. Session mutations also require the CSRF value returned by the session endpoint. Authentication is required in development too; 401 means sign-in needed, 403 means wrong role/origin/CSRF, and 429 means throttled. No API-key or MCP authentication exists yet.

## Health

`GET /api/health` → `{ "ok": true, "version": "0.1.0", "database": true, "mode": "development" | "production" }`

## Tracker and ingestion

`GET /script.js` returns the tracker (JavaScript, cacheable). Installed as:

```html
<script defer src="https://<your analytics host>/script.js" data-site="<site id>"></script>
```

It sends a pageview on load and on single-page navigation (`history.pushState`, `popstate`), and exposes `window.postdeploy.track(name, { revenue, currency })` for goals. It sets no cookies and stores nothing on the visitor's device. Revenue is recorded in the website's currency; `currency` is accepted by `track` but not sent.

`POST /api/event` (CORS open, `text/plain` or `application/json` body, max 4 KB)

```json
{ "site": "site id", "type": "pageview" | "event", "url": "https://example.com/pricing?utm_source=news", "referrer": "https://news.example/", "name": "purchase", "revenue": 49.5 }
```

- `name` is required when `type` is `event`; it matches a goal id (`[a-z0-9_]{1,40}`) of the website, otherwise `400 {"error":"unknown_goal"}`. A pageview takes no `name` or `revenue`.
- `revenue` is optional, a finite number from 0 to 1,000,000.
- Unknown fields are rejected. A `referrer` that is not an http(s) URL is treated as no referrer.
- Response `202` with an empty body; invalid input `400`; unknown site `404`. Requests from bots, and with `DNT: 1` or `Sec-GPC: 1` when the website respects Do Not Track, also get `202` but are not stored.
- When the request has an `Origin` other than `null`, its host must exactly match the canonical hostname or a configured alias, except in development; otherwise `403 {"error":"origin_not_allowed"}`. Outside development the `url` host must independently match a configured hostname, even without Origin, otherwise `403 {"error":"url_not_allowed"}`.
- Abuse limits: one visitor may send a burst of 20 events, then one per second, shared across Worker instances; beyond that `429 {"error":"rate_limited"}`. A visit keeps at most 500 events and 20 goal events; further events get `202` and are not stored.
- The server derives and stores: path (query string removed; `utm_source` and `utm_campaign` kept as source and campaign), referrer host, source, campaign, country (from the platform), device and browser (from the user agent), a daily visitor id and a session id. The visitor id is a hash of a salt that rotates daily, the site id, the IP address and the user agent; the IP address and user agent are never stored.
- Each event is stored with its day and hour in the website's time zone at the moment it arrives; changing the time zone applies to events received afterwards. A visit expires after 30 minutes without activity, local midnight or a timezone change. The first pageview in a session is its entry page. Source, referrer and campaign are taken from the session's first event, so every event of a session shares them.

Source classification: `utm_source` when present; otherwise the referrer host mapped to a name (search engines, social networks, known hosts), the referrer host itself, or `Direct` when there is no referrer.

## Websites

`GET /api/sites` → `[Site]`

`POST /api/sites` `{ "name", "domain", "aliases"?: string[], "kind": "store" | "saas" | "docs" }` → `201 Site`. Creates starter goals and a funnel for the kind. `409 {"error":"domain_taken"}` when the domain exists.

`PATCH /api/sites/:id` `{ "name"?, "timezone"?, "retentionMonths"?, "excludeBots"?, "respectDnt"?, "publicDashboard"?, "domain"?, "aliases"?: string[], "excludedPaths"?: string[] }` → `Site` — `timezone` is an IANA zone; `retentionMonths` is one of 0 (keep forever), 6, 12 or 24. Hourly (cron `17 * * * *`, UTC), bounded batches remove events older than that many calendar months from the project's local today; backlog is reported and resumed. Transient state expires separately; see housekeeping below. Unknown fields are rejected. New websites get an id derived from the name, a lowercased host name as domain, currency `$` and timezone `UTC`.

`DELETE /api/sites/:id` → `204` for an empty project. Returns `409 project_has_history` when events exist; history is preserved.

`GET /api/sites/:id/verify` → `{ "received": boolean, "lastEventAt": number | null, "events": number }`

```ts
type Site = {
  id: string; name: string; domain: string; kind: "store" | "saas" | "docs";
  aliases: string[]; excludedPaths: string[]; organisationId: string;
  currency: string; timezone: string; created: string; // YYYY-MM-DD
  settings: { retentionMonths: number; excludeBots: boolean; respectDnt: boolean; publicDashboard: boolean };
  goals: { id: string; name: string; revenue: boolean }[];
  funnel: { name: string; steps: { name: string; match: { page?: string; goal?: string } }[] };
  visitors30d: number; lastEventAt: number | null; // visitors30d: distinct visitors over the website's last 30 local days, the same window as a 30-day report
};
```

`page` in a funnel step is a path prefix; `goal` is a goal id.

## Reports

`GET /api/report?site=<id>&from=<day>&to=<day>[&cmpFrom=<day>&cmpTo=<day>][&f=<dim>:<value>|<dim>:<value>]`

Dimensions: `source, referrer, campaign, country, device, browser, page, entry`. Granularity is chosen by the server: `hour` for a single day, `day` up to 92 days, `week` beyond.

```ts
type Totals = { visitors: number; pageviews: number; bounceRate: number; duration: number | null; // measured visible seconds
  conversions: number; revenue: number; goals: Record<string, number> };
type Bucket = Totals & { start: number; label?: number; future: boolean }; // label = hour for hourly buckets
type Row = { name: string; note?: string; visitors: number; pageviews: number; conversions: number; purchases: number; revenue: number };
type Period = { gran: "hour" | "day" | "week"; totals: Totals; buckets: Bucket[]; breakdowns: Record<Dimension, Row[]> };
type Report = {
  goals: Site["goals"];
  main: Period & { funnel: { name: string; steps: { name: string; count: number }[] }; journeys: { path: string[]; conversions: number }[] };
  prev: Period | null; // same bucket count as main when cmpFrom/cmpTo are given
};
```

- `from`/`to` span at most 731 days; at most 8 filters. Filters on `page` keep sessions that viewed the page; other filters keep sessions with that value. Visits without a referrer appear as `Direct or unknown` in `referrer`; visits without a campaign are left out of `campaign`. `page`, `referrer` and `campaign` return at most 100 rows.
- Buckets are local days and local hours of the website's time zone; a bucket is `future` when it lies after the website's current local hour or day.
- Hourly buckets count a visit (visitors, pageviews, bounce rate, duration) in the hour it started, and goal events in the hour they happened.
- `visitors` counts distinct daily visitor ids; `bounceRate` is the share of sessions with one pageview and zero completed goals; `duration` is measured visible seconds per measured visit, or null when unknown.
- `conversions` counts goal events; `goals` counts each goal; `revenue` sums revenue on goal events; `purchases` counts events of the site's revenue goal.
- Breakdown rows sort by visitors (pages by pageviews), descending. Within one period, `source`, `country`, `device`, `browser` and `entry` rows add up to the totals.
- The funnel counts sessions that reached each step in order, each step strictly after the previous one. Journeys are the most common page sequences of sessions that reached the revenue goal (top 5): pages viewed up to the first revenue goal event, repeats in a row collapsed, last 5 pages.

## Live

`GET /api/live?site=<id>` → `{ "visitorsNow": number, "perMinute": number[30], "events": LiveEvent[] }`

`visitorsNow` is distinct visitors in the last 5 minutes; `perMinute` is pageviews per minute for the last 30 minutes, oldest first; `events` are the latest 60, newest first.

```ts
type LiveEvent = { id: string; at: number; kind: "pageview" | "goal" | "revenue"; page: string; goal: string | null;
  revenue: number; source: string; country: string; device: string; sessionId: string };
```

`GET /api/sessions/:sessionId?site=<id>` → `{ "source", "country", "device", "events": [{ "at", "kind", "label", "revenue" }] }`

## Organisations

All endpoints require the existing installation session; POST/PATCH additionally require Administrator and the existing Origin/CSRF checks.

- `GET /api/organisations`: list organisations.
- `POST /api/organisations` with `{ "name": "Portfolio" }`: create an organisation.
- `PATCH /api/organisations/:id` with `{ "name": "New name" }`: rename it.
- `GET /api/organisations/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD`: combined traffic. Optional `cmpFrom`, `cmpTo` and `f` use the project report syntax. Unknown IDs return 404; invalid ranges/filters return 400. Empty organisations return zero totals, empty projects and zero-filled daily buckets.

The report returns `organisation`, `timezone: "UTC"`, `main` and nullable `prev`. Each period has `totals` (`pageviews`, `visitorDays`), daily `buckets` and ranked `projects`. Visitor-days are sums of project-local daily identities observed in the UTC event window, not deduplicated people. Daily visitor counts need not sum to the period count. See ADR 0004.

`POST /api/sites` additionally accepts `organisationId` (defaults to `default` for older clients); `PATCH /api/sites/:id` accepts `organisationId` to move the entire project and its history. Site responses add `organisationId`. Existing tracker/report URLs remain valid. `DELETE /api/sites/:id` returns 409 for projects with events. Organisation deletion is not exposed. The browser entrypoint `/organisations` provides the overview and management forms; old project hash URLs still open project reports.

## Visible activity and metric coverage

`pageview` optionally takes `page`, a random 32-character lowercase hex token generated in page memory. Repeated project/page tokens do not create additional pageviews. `activity` takes `{site,type:"activity",url,page,visible}` where visible is a cumulative integer milliseconds counter, 0–Number.MAX_SAFE_INTEGER. It takes no goal name/revenue. Unknown page signals are ignored; existing origin, privacy, bot and size rules apply. Counters are bounded against server receipt time, replay-safe and reanchored after gaps over 90 seconds. No orphan signals create traffic. The tracker emits every 30 visible seconds and on lifecycle/navigation boundaries; `replaceState` is included. Public tracking endpoints cannot authenticate human attention.

Project totals/buckets add `visits`, `bounces`, `measuredVisits`, `visibleMs`. `duration` is rounded visible seconds per measured visit, or `null` when unknown. `bounceRate` divides goal-free single-page visits by all visits. Legacy history is preserved with unknown visible time. A timely midnight/timeout/timezone continuation can have zero pageviews and no bounce. Boundary tails are conservatively omitted; see ADR 0003.

Organisation periods add `measurement: {visits,bounces,measuredVisits,visibleMs,bounceRate,duration}`. Visits start in the UTC range, with whole-visit measurements and selected filters. Existing UTC event-based `totals`, `projects`, and pageview `buckets` remain unchanged. Sum numerators and denominators before dividing. Neither project visitor-days nor visits represent globally distinct people.

## Domain and privacy rules

Canonical hostname and aliases use exact DNS matching, not automatic subdomains. Up to 20 aliases and 20 excluded path prefixes per project. Normalisation, conflict handling, path encoding, future-only rules and upgrade sequencing are specified in ADR 0005. Excluded paths drop pageviews, goals and pulses before persistence, including old page tokens and inherited acquisition entries. DNT/GPC and bot exclusion default on in supported new-project creation paths; existing explicit flags remain. `publicDashboard: true` returns 400; the field reads false and public reports do not exist. Only utm_source/utm_campaign are retained as attribution; queries/fragments/referrer paths are discarded.

## Configurable goals and downloads

Administrator with Origin/CSRF: `POST /api/sites/:id/goals` accepts
`{name,type:"page",path:"/thank-you"}` or
`{name,type:"event",event:"contact_form_submitted"}`; returns updated Site (201).
`PATCH /api/sites/:id/goals/:goalId` accepts `{name}` and/or
`{archived:true}`, returning Site. GET sites already includes all goals.
Labels are 1–80 characters, event names 1–40 lowercase ASCII letters/digits/underscores.
At most 40 rules including archives. Duplicate normalized paths or names (including
archives) fail. A new named rule also rejects event names with retained history
that is absent from current configuration, preventing retrospective reinterpretation. Rules are immutable; archived rules cannot resume. New semantics
need a new distinct rule. Concurrent configuration writes return 409; reload.

Page paths use collection normalisation (ADR 0005), exact case-sensitive matching,
without queries/fragments. No extra page snippet: install the standard tracker.
Named goals call `postdeploy.track("contact_form_submitted")` after successful action;
existing optional revenue calls remain valid. Event name is the stable named-goal ID;
the human label can change. Page IDs are generated. Existing names, revenue and
starter IDs remain unchanged.

Migration 0007 adds page-to-goal occurrence links and reporting views; no old
events, visits, users, settings or goals are rewritten or backfilled. Links are
created within the accepted pageview's visit-assignment trigger, after limits and
deduplication, never by activity. One page rule per normalized path prevents double
counting. Page completions do not consume extra navigation/event rows. Up to 500
accepted original events per visit remains the bound; the existing 20 named-event
bound remains. Deleting retained events removes their links. Rules apply only to
future accepted occurrences, archives stop new collection and retain reports.

Project totals, buckets and breakdown rows add:
`goalRates[id]: {completions,convertedVisitorDays,visitorDays,rate}`,
`convertedVisitorDays`, `conversionVisitorDays`, `conversionRate`.
Rates are fractions; zero denominator produces zero. Counts include repeats;
numerators count distinct local-day visitor identities completing a goal. Overall
numerator unions goals. Denominators count identities with accepted pageview/named
event occurrences in the SAME completion/event window, filters and dimension.
Activity-only continuation visits are excluded from these rate populations, even
when included in visit measurement. Hourly rates use event hour, not visit-start
hour. Longer ranges sum daily identities, never pretend to count distinct people.
The existing granularity applies to goal metrics too (day through 92 days, then
week). Organisation periods add `goals[]` with projectId/goalId/name and the same
four metrics, plus overall `conversions` with these metrics. UTC event-window
filters apply; each project's local-day identity remains the deduplication unit.
Sum project numerators and denominators before dividing. These populations differ
from organisation visit-start duration/bounce measurements.

Authenticated Admin AND Viewer:
- `GET /api/export` uses the project report query, plus `dataset` = totals,
  series, goals, source, referrer, campaign, country, device, browser, page or entry.
- `GET /api/organisations/:id/export` uses the organisation report query, plus
  `dataset` = projects (default), totals, series or goals.

Downloads use the same report builder, range, filters and optional comparison;
each row identifies selected/comparison period. CSV columns are fixed across
empty datasets. Context includes scope, timezone, ranges, filters, units,
population and limits. Organisation project timezones have their own column;
export context remains UTC. UTF-8 BOM, CRLF records, quoted fields and doubled
quotes support Unicode, commas and embedded newlines. Text beginning with formula
markers after whitespace/control characters receives an apostrophe. Null duration
is blank, alongside measuredVisits/visibleMs coverage. No raw identity, IP, UA,
authentication data or tokens are exported. Responses are attachments with
`text/csv; charset=utf-8`, fixed safe filenames and `Cache-Control: no-store`.
Anonymous requests fail. Limits: 731 days, eight filters, 10,000 CSV rows (400
rather than silent truncation). Referrer/campaign/page exports explicitly contain
the same displayed top 100; other datasets export the displayed aggregate series
or table, never raw events. CSV context declares those bounds.

## Exploratory Insights

`GET /api/insights?site=<project>&from=YYYY-MM-DD&to=YYYY-MM-DD`
(or `org=<organisation>` instead of `site`) requires an active Administrator or
Viewer session. Anonymous requests fail 401. Unknown projects/organisations fail
404; no fallback destination. Read/export permissions match existing reports.
No schema migration or collection change is required.

Shared report parser bounds: inclusive ranges up to 731 days, at most eight
whitelisted exact `f=dimension:value|dimension:value` filters; optional paired
`cmpFrom`/`cmpTo`. Organisation scope reuses the organisation report boundary;
project scope reuses the project event boundary. No arbitrary expressions.
Additional options:

| Parameter | Values / behavior |
| --- | --- |
| `dimension` | `source`, `project`, `page`, `entry`, `campaign`; ranked top 20 plus Other |
| `composition` | `source` or `project`; top six plus Other |
| `goal` | JSON-encoded `[projectId,goalId]` from returned goals; absent means overall union |
| `dataset` | Download `timeline`, `composition`, `ranking`, `heatmap` or `duration` CSV instead of JSON |

Response has name/timezone/scope/goal choices and `main`/optional `prev` periods.
Each contains totals, timeline, composition, ranking, heatmap and duration.
Traffic fields are pageviews and visitorDays. Conversion fields are completion
occurrences, convertedVisitorDays, conversionVisitorDays (eligible denominator),
and fractional rate. Selecting a goal limits the conversion denominator to its
project without changing the traffic population. Overall rates union goals using
project/local-day identities. Other is grouped before DISTINCT aggregation, so
neither rates nor unique populations are naively summed. No rate exceeds one.

Project event windows and activity bins use recorded local day/hour, including
historical timezone settings; repeated DST hours merge, missing hours remain zero.
Organisation event windows and bins use UTC timestamps while visitor identity days
remain local. Visitor-days may repeat across hourly buckets; they are not additive
hourly audiences. Granularity: hourly for one day, daily through 92 days, otherwise
seven-day intervals anchored at range start. Counts and unique numerators are
recomputed at that granularity, never averages of rates. Partial final weeks keep
only selected events. Comparison is a separate period, aligned by position in UI.

Composition pageviews reconcile to all selected navigation, including labelled
Other, independently of the old report's top-100 lists. Ranking shares use total
pageviews. Page ranking groups event paths; entry ranks visit landing pages.
Heatmap is exactly 7×24 pageview totals over the range, Sunday=0, hour 0–23;
no weekday-frequency normalisation. Activity-only continuation contributes no
navigation or conversion population.

Duration selects matching full visits whose start is within the reporting range,
including activity-only continuations; page filters select matching visits. It
uses visible milliseconds from visit measurement, never event-span estimates.
Measured bins: `[0,10s)`, `[10s,30s)`, `[30s,60s)`, `[1m,3m)`, `[3m,10m)`,
`[10m,∞)`. Unknown is a separate seventh row, excluded from histogram and coverage
numerator. Measured single-page visits and measured zeroes are retained.

Queries aggregate inside D1, never transfer raw events/identities. Each period
uses six aggregate queries; metadata is bounded to 50 projects/2,000 configured
goals (including archives). Over 50 projects rejects the organisation Insights
request; select a project instead. At most 105 timeline buckets, seven composition
categories per bucket, 21 ranking rows, 168 heatmap cells and seven duration rows
per period. Queries still scan retained events; load/cost certification is pending.

CSV uses the existing protected attachment/quoting/formula-neutralisation path,
stable dataset columns (also when empty), selected/comparison period labels,
ranges, goal, timezone, dimensions, granularity, filters and population/units.
No raw identity/auth fields. The existing 10,000-row rejection remains. Tables
show selected exact counts; timeline tables also show comparison values. Downloads
include both requested periods; rates export fractions, while UI shows one decimal
percentage. UI visibility toggles affect only the chart, preserving complete tables
and downloads. View controls are restored through the URL and browser history.

## Shared collection and housekeeping

Pageviews, named goals and activity share an atomic D1 visitor/project/day limiter:
20 immediate requests, refilling one admission per second. Isolate restarts do
not reset it; concurrent requests cannot spend the same admission. A 429 response
includes `Retry-After: 1` for collection. No raw IP/UA
is stored in limiter rows. Privacy-denied traffic does not acquire collection
admissions; existing identity-matched page pause handling remains.

Hourly housekeeping deletes at most 5,000 original events per finite-retention
project and then at most 5,000 eligible visits per project. Goal links follow event
deletions. Visits are preserved while any event or page mapping references them,
including timezone/boundary visits; stored duration is never recomputed by cleanup.
Cutoffs use the project's current local date minus calendar months, clamped to
the target month's last day. Only days strictly before cutoff expire. Zero means
forever. Each project gets a batch every run. `deleted` counts actual deleted
original events, `sites` projects with event deletions, `pendingSites` projects with
expired events or event-unreferenced visits still awaiting cleanup, `visitsDeleted` actual removed
visits. No capped run claims all history was purged.

Transient cleanup separately removes at most 5,000 rows per table per run:
page mappings inactive for over 30 minutes, fully recovered visitor limiter rows,
expired auth sessions/tokens/limits, and salts older than two UTC days.
`transientDeleted` counts actual rows; `transientPending` flags remaining expired
rows. Old mappings can defer visit deletion until the next run. Expired auth
credentials fail authentication even before physical cleanup. Used links cannot
be reused while awaiting expiry. There is no persisted activity queue or cache.

Activity received 30 minutes after its mapping's last observation is ignored even
before cleanup. Removing a mapping leaves its stored visit metrics intact; retained
event page tokens continue suppressing pageview retries. Retry identity is bounded
by retained history, not permanent browser identity; after analytics itself expires
an arbitrary old token cannot be distinguished from a new forged one. Late activity
cannot establish a page mapping or create traffic. See [capacity and costs](performance.md)
for baseline and compact storage measurements; 24-month/forever choices do not override
platform storage limits.

A tab hidden or disconnected for over 30 minutes needs a fresh navigation/pageview
to establish a new page mapping before visible duration can resume. Late pulses
alone never recreate expired mappings. This bounds transient state without adding
persistent browser identity; it can undercount resumed long-lived tabs.

Apply migration 0008 before switching collectors. All collecting Worker versions
must use shared admission; an older collector still uses its former isolate-local
policy until drained. The additive migration does not rewrite analytics. Page-token
lookup and visit cleanup indexes add storage and write amplification; budget them
before migrating an installation near its database ceiling.

Report response fields, scope, filters and CSV populations are unchanged by the
session-selection optimisation. Visit metrics still select sessions from matching
events or eventless visit continuations, then apply visit-start coverage and full
stored duration. Page-goal completion copies do not independently add visits.
This does not introduce caching, change retention or certify release capacity.

## Compact storage upgrades

The optional offline upgrade in [compact storage operations](compact-storage.md)
preserves tracker/site/session identifiers, all retained event fields, completion
links and report/CSV semantics. Maintenance rejects writes while copy/verification
is in progress; rejected requests are not queued. Activation exposes the same
logical tables and API. Explicit source retirement is required for the measured
steady footprint. Rollback before retirement reconstructs accepted compact writes;
retired recovery uses an isolated verified backup. No online migration, remote
binding switch or deployed capacity certification is implied.

### Operational visit expiry

Hourly maintenance closes at most 5,000 inactive visits per project per run,
including projects retaining history forever. A visit becomes terminal at 30
minutes since its last accepted activity. This does not delete historical events,
visitor/session identities, attribution, timestamps or accepted duration. It never
reopens after clock rollback. New pageviews after timeout create a new visit;
replayed page tokens remain deduplicated against retained events. Existing midnight,
timezone-change and late-activity rules still apply. Maintenance results/logs add
`visitsClosed` (actual updates), `assignmentPendingSites` (projects with eligible
work remaining), and `dimensionValuesCleared` (unused tuple values erased). These are separate from retention deletions and transient backlog.
There is no new public maintenance endpoint or dashboard control.

Compact maintenance clears unused dimension values and reuses their rows, retaining
foreign keys and exact referenced values. Cleared rows contain no attribution data.
Their count follows peak dimension demand rather than request churn. This avoids
whole-history foreign-key checks for each unused-dimension deletion.

Reporting implementation: compact aggregate queries use private statement-local
encoded keys and sequential project groups, with global Top-N keys selected
before unioning Other. These keys never replace external session identifiers.
Report and Insights JSON/CSV shapes, filters, comparison windows, authentication
and complete-result semantics are unchanged. A response still waits for its full
result; no background job or partial-result protocol is implied. Long uncached
reads remain a local acceptance limitation; see performance.md and ADR 0010.

### Independent analytics sections

Authenticated `GET /api/insights` accepts `section=summary|timeline|composition|ranking|heatmap|duration` with the same scope, dates, selected goal and filters. Omit `section` for the unchanged complete response. Section responses retain scope metadata, goals and `main`/`prev`; only requested period fields and required dependencies are returned. Summary totals contain pageviews and visitor-days only. Timeline includes exact goal numerators/denominators; ranking includes its period totals; composition includes bucket context. Missing fields are not zero results.

`GET /api/organisations/:id/report` accepts `section=summary|series|goals|measurement`. Summary returns totals and project contributions; series returns daily traffic buckets; goals returns configured goals and exact union conversions; measurement returns visit-start bounce and visible-duration statistics. Omission preserves the complete report. Invalid sections/datasets fail before aggregate work. Existing authenticated read roles, range/filter limits and no-store responses apply.

Insights CSV requests select their dataset's computation independently of displayed UI state. Duration does not calculate traffic charts or goal rates; heatmap does not rank categories. CSV remains a complete selected/comparison export with existing metadata, quoting, formula protection and row bounds. Organisation project/series exports use traffic reads, goals use conversion facts, and totals retain all required measurements. The project overview export contract is unchanged.

`GET /api/sites/catalog` is an authenticated metadata-only selector read returning
`{id,name,organisationId}[]`. It performs no visitor/last-event computation. The
existing full `GET /api/sites` response remains unchanged. Organisation overview
uses the catalog so selector bootstrap cannot wait behind traffic aggregates.


## Streaming sections

Authenticated section GETs on `/api/insights` and organisation report endpoints
accept `Accept: application/x-ndjson`. Frames are `{state:"pending",statements:N}`,
then exactly one `{state:"complete",value:SECTION_JSON}` or `{state:"error",message:TEXT}`.
Clients must require complete; EOF is failure. Authentication occurs before stream
headers. Invalid selections/query failures after headers use an error frame.
No intermediate metrics or raw identities are sent. Query wait is 25 seconds,
section execution ten minutes/2,000 statements; cancellation prevents later SQL
but cannot interrupt submitted D1. Browser silence timeout is 30 seconds, reset
only by completed-statement progress. Default JSON and CSV contracts are unchanged.
