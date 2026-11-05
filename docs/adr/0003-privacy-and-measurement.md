# Cookieless analytics with explicit measurement rules

## Implemented measurement contract

Daily unique visitors use server-derived project/local-day salted hashes, with no stored raw IP/user agent or persistent browser identity. Reports sum daily identities across days. Shared networks and matching user agents can merge people; changing either can split them. Installation session cookies are separate from visitor collection.

Migration 0005 adds visits, page signal state and database triggers without rewriting events. A single event insertion assigns its visit, preserves first-event acquisition and enforces the 500-event/20-goal limits atomically in SQLite/D1. Visits end at 30 minutes without accepted activity, project-local midnight, or a configured timezone change. A timezone change never rewrites history. Legacy events retain their original grouping; they cannot be reliably split retrospectively. Old trackers still collect events under the new boundaries, with unknown visible duration.

Bounce means exactly one pageview and zero named goal events. Pulses never complete goals or add pageviews. Page-visit goals remain a separate planned feature. Reports expose visits, bounces, measuredVisits and visibleMs, with bounceRate=bounces/visits and duration=visibleMs/measuredVisits in seconds (rounded once). No observed activity means duration=null, including legacy history. Zero duration is not substituted for unknown. The offline demo remains fictional.

## Visible time and boundaries

The tracker keeps a random page signal token and cumulative visible milliseconds in page memory only. It sends every 30 seconds while visible, on hiding/departure and before SPA navigation (pushState, replaceState, popstate). Each navigation has a new token. No visitor/session token is stored in cookies, localStorage, sessionStorage or IndexedDB. A server page mapping is project-bound and checked against the daily visitor hash; knowing another project's token cannot apply it here. Duplicate page tokens suppress repeated pageviews.

Activity uses cumulative high-water marks. Duplicate and lower counters add nothing; server receipt time bounds every increment, with a maximum 90-second gap. Stale signals only reanchor the baseline; lost/delayed requests can undercount. At most 6,000 accepted positive signals per visit update duration. The existing origin/domain, bot/privacy rules, payload limit and per-isolate throttle apply before signals are accepted. Activity rows are transient within their trigger, not an append-only pulse log. Retention removes page state and visits along with expired events.

An established visible page can continue across local midnight without navigation: the first positive timely pulse starts a new zero-pageview visit, retaining known acquisition. It contributes a daily identity but cannot be a bounce or a conversion. Duration begins at this receipt: the unobserved tail of the preceding visit and the initial part of the next day are deliberately omitted, rather than assigned across boundaries. Pulse-only intervals appear in project reports through a synthetic reporting view, never as stored pageviews/events. Hidden gaps of more than 90 seconds reanchor on return; subsequent visible pulses measure the resumed visit. Timezone changes use the same conservative boundary policy, including when the calendar date is unchanged.

Concurrent tabs share a derived visit and distinct page tokens; accepted visible time is capped by visit wall-clock elapsed time. This caps inflation but does not calculate an exact union of visible intervals. A public collector cannot prove human attention or prevent an allowed-origin caller forging plausible elapsed visible time. Browser shutdown, throttling, blockers and failed beacons cause undercount; duration is an estimate, not a stopwatch or fraud guarantee.

## Organisation policy

Existing UTC timestamp pageview trends and summed project visitor-days stay event-based. Pulses do not inflate them. Additional measurement summaries select visits whose first recorded observation falls inside the UTC range and apply filters to select whole visits. They include full-visit numerators and denominators, including legacy visits with unknown duration, then calculate rates once. They can differ from project-local date ranges and from activity observed in an adjacent UTC day. They do not average project percentages, deduplicate people across projects, or sum money across currencies.

## Pending privacy and capacity work

New-project DNT/GPC defaults, exact aliases and future-only sensitive-path exclusions are implemented in ADR 0005; existing explicit privacy flags remain. Configurable page/event goals and exact daily goal rates are implemented in ADR 0006. Collection has a 4,096-byte request limit. The minimising tracker measures 1,982 raw bytes / 963 gzip bytes; capacity validation must include two periodic requests per visible minute plus boundary/departure requests. Shared collection throttles and bounded cleanup are implemented; measured storage failure and costs are documented in performance.md. No rollups are implemented. No unlimited/free-hosting claims.


## Shared state and capacity validation

Collection admission now uses atomic D1 virtual scheduling time, preserving the
20-request burst/one-per-second refill across isolates. This adds a D1 write per
admitted request in exchange for reliable shared enforcement. No raw IP/UA is
persisted in this state. Inactive page mappings expire independently of analytics;
retained event tokens preserve retry suppression, and stored visit metrics survive
mapping cleanup. Hourly bounded retention preserves referenced visits and reports
actual deletion/backlog counts. No approximate rollups replace exact populations.

The local million-pageview month projects to 16.78 GB over two years, beyond the
single-database D1 ceiling. The target remains unmet. Partitioning or schema
compaction needs another implementation/validation step; no retention reduction
has been chosen. See ../performance.md for the dated sources and cost model.
