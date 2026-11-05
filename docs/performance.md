# Capacity envelope

Local evidence dated 2026-11-05. The initial workload is 50 projects and one
million monthly pageviews with two years of history, plus named goals, page
matches and activity. This is a measured installation scenario, not a universal
volume-only promise or deployed capacity certification.

## Current storage

The final compact million-pageview fixture is physically 328,716,288 bytes.
The full two-year corpus plus preserved live trials is physically 8,022,323,200
bytes: 26.4 million original events, 24 million visits, 1.2 million page-goal links,
plus 12,006 new events/6,003 visits/6,003 links. Every original identity/history
row survives. These are files, not linear projections or freelist-subtracted sizes.

The decimal 10 GB hard database ceiling leaves 1,977,676,800 bytes. Eight GB was
an engineering working guide; its 22,323,200-byte miss is not an independently
accepted user SLA. Free's 500 MB ceiling cannot fit this two-year case. Forever
retention is not infinite capacity. Legacy monthly storage was 699,224,064 bytes;
its 24-month linear projection exceeds a single database ceiling. Fresh installs
should evaluate compact conversion while empty; see operations.md.

The original corpus averages approximately 334 bytes per retained pageview
including its associated visits/named/page-goal population. At 24 million retained
pageviews the hard ceiling permits approximately 417 bytes per pageview including
all storage. About 82 additional average bytes per retained pageview would consume
the observed margin. These ratios describe this corpus, not ingestion constants.
Long unique paths, campaign/source combinations, multiple pageviews per visit,
goals, real UUID sessions and fragmentation change that ratio.

Prior full-store native-shaped cohorts retained 4,000 new visits, including 2,000
with 384-character suffixes and distinct source/campaign keys. Their observed
increment was 19,529,728 bytes including fragmentation/transients. Do not multiply
that short increment into a universal month estimate, or use the cold bulk-built
334-byte average as a bound for those shapes. The final physical store has
1,486,848 freelist bytes; free pages and internal B-tree slack do not shrink it.
A second full reclaim is not assumed: safe output/workspace/reserve refused it.

## Operator sizing

Measure a representative retained population with actual attribution cardinality,
page/visit ratio, goal matches and visible-time pulses. Record physical bytes,
freelist/index bytes and transient peaks before/after repeated retention/expiry
cycles and fresh fragmented writes. Use a stopped, verified backup for lifecycle
changes. Preserve both history and failure evidence; do not vacuum or copy a
near-full store without enough independent output/workspace plus reserve.

A usable installation envelope requires retained physical size plus observed
incremental/transient headroom below the database ceiling, and actual report and
collection behavior within its workload. High-cardinality new traffic can consume
the 1.978 GB margin even while monthly pageviews stay constant. Evaluate retention
tradeoffs explicitly with the operator; the app never silently shortens the accepted
two years or reduces identity entropy. Reducing retention changes historical
availability and is not an automatic solution. There is no evidence that arbitrary
50-project/million-month workloads fit universally.

## Current reporting and collection

Exact narrow compact projections, global category selection and cooperative
project partitions preserve complete populations. Organisation/Insights dashboards
request independent sections through one slot, prioritize traffic and retain
successful siblings when another section fails. These are current reads, not a
single transaction or cache. More sections can increase total scans.

Prior native/browser month evidence: organisation summary 5.267 seconds, complete
32.141 seconds; Insights summary 5.866 seconds, complete 49.047 seconds. Five seconds
was an internal usability guide, not a user SLA. Prior finite mixed traffic accepted
60/60 requests with p95 1.630 seconds and exact persisted metrics; separate abuse
traffic accepted 20/rejected 60. Neither is steady-state certification.

A guarded offline two-year organisation Insights summary returned exactly
24,000,000 pageviews/visitor-days in 158.688 seconds. Its five-project statements
included a 23.532-second read. The former browser 30-second total deadline could
not complete that scope. The guarded five-project measurement attempt interrupted
a statement at 25.008 seconds; it is a failed probe, not zero analytics.

After single-project partitioning, the actual full-corpus organisation measurement
completed through the real stream protocol in 398.562 seconds: 24 million visits,
20.52 million bounces, 24 million measured visits, 5,130,000,000,000 visible ms,
85.5% bounce and 214 seconds rounded duration. Its 56 progress frames had a maximum
19.135-second gap; the maximum SQL was 19.129 seconds. This is offline full-corpus
execution, not native HTTP or remote capacity. The earlier 180-second diagnostic
guard also interrupted an intermediate single-project run; that evidence is retained.

Full project p0 Insights completed offline across every family in 18.635 seconds:
480,000 pageviews/visitor-days/completions/converted visitor-days. A subsequent
same-scope export proof produced exact complete table row counts for timeline105,
composition735, ranking13, heatmap168 and duration7; no raw identity export.
All five full organisation Insights families and overview series/goals also
completed individually through the current stream. Their exact CSV cells match
tables. Each traffic family reconciles to 24 million pageviews; timeline/ranking
also reconcile 24 million visitor-days, 3.6 million completion occurrences and
3.48 million converted visitor-days. Duration bins total 24 million visits.
An independent generator oracle reconciles every timeline/composition/ranking/
heatmap count, including global Top N and Other.

| Offline full organisation section | Completion seconds | Max progress gap seconds | CSV rows |
| --- | ---: | ---: | ---: |
| Insights timeline | 234.461 | 7.794 | 105 |
| Insights composition | 294.250 | 5.643 | 735 |
| Insights ranking | 361.269 | 10.283 | 21 |
| Insights heatmap | 130.556 | 4.035 | 168 |
| Insights duration | 190.724 | 4.430 | 7 |
| Overview series | 203.830 | 6.212 | 730 |
| Overview goals | 209.413 | 7.515 | 151 |

These are separate completed reads, not one combined request, native full-corpus
HTTP or deployed D1. The full-corpus HTTP proof remains unavailable in the current
local environment without copying or writable mounting preserved data; neither
was attempted. Existing native small-fixture proof remains separately scoped.

Long windows now use single-project statements and progress streams, with exact
results only on completion, cancellation before subsequent reads and existing
retries. Query waits are bounded at 25 seconds, whole sections at ten minutes /
2,000 statements, and browser silence at 30 seconds. This does not make a single
large project arbitrarily cheap or certify every full-history family. Complete
JSON/CSV remains available. See [acceptance](acceptance.md) for reproducible
commands, safety guards and interpretation of failed or unfinished probes.

Small native HTTP variation runs use 36 visits, skewed project traffic, distinct
long-path/source/campaign tuples and 180 legitimate collection requests plus a
domain-denied probe. Both layouts persisted exactly 36 pageviews, 36 named goals,
36 visits and 33,500 visible milliseconds after replay and cleanup. Compact
collection p50/p95/max was 48.1/124.9/207.5 ms; legacy 45.1/107.0/138.8 ms. Compact
physical file grew from 352,256 to 425,984 bytes; legacy 200,704 to 311,296 bytes. Fixed compact metadata dominates
this tiny case; it is not evidence that compact large-store compression regressed.
One visit includes a real paced 30-second activity signal.
This cohort is a short native test, separate from the offline full corpus.
It does not prove high-cardinality steady state, a monthly projection, sustained
pulse pacing or deployed throughput. D1 write counters were not captured in this
HTTP harness; request counts and physical rows are not billed writes.

## Request and operation overhead

One million pageviews with 10% named events, two lifecycle signals per pageview
and D average visible minutes implies approximately `(3.1 + 2D)` million collector
requests/month before retries, reports, auth, scripts and housekeeping. The actual
tracker pulses every 30 visible seconds. Hidden/SPA behavior and multi-page visits
change the estimate. No activity event is stored as a pageview or completion.

Prior compact local binding samples measured reused page/named/activity at roughly
54/34/14 written rows and 191/171/58 reads; a fresh dimension page used 55 writes.
Indexes/triggers, page goals, dimension reuse, limiter expiry, closure, retention,
retries and reporting add workload. Samples are not universal constants. Dashboard
scans can dominate reads; comparisons and CSV recompute. SQLite VM instruction
counts are not D1 billed rows, and local wall time is not Workers CPU or billing.

Remote D1 limits include 30-second SQL statements, bound-parameter/query budgets,
row-accounted operations and import/export limits. Workers CPU/memory, bcrypt,
Email delivery, sustained mixed scheduling and the actual account's limits still
need deployed acceptance. Check current [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
before installation decisions. No new plan, paid service or live account was used.
