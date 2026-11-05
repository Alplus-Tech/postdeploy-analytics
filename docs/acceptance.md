# Operator acceptance

Run with installed locked dependencies, Node 24.22.x/npm 11.x and Python 3
(for guarded offline history reads). Use only isolated disposable local data.
No command below provisions an account, sends email or publishes anything.

```sh
npm run build
npm run test:acceptance -- .scratch/acceptance-compact
ACCEPTANCE_LAYOUT=legacy npm run test:acceptance -- .scratch/acceptance-legacy
npm run test:install
npm test
COMPACT_STORAGE=1 npm test
npm run typecheck
node --test demo/test/*.test.js
```

Each acceptance directory must be new. Port 8798 must be free. The command
creates private local Wrangler persistence, migrates it, optionally activates
compact storage while empty, seeds disposable Administrator/Viewer sessions,
then exercises the real Worker over HTTP. Setup/login, invitation/reset and
backup/restore have separate real-interface coverage in `test:install` and the
security suite; seeded sessions do not prove login or email delivery.

The finite collection run uses three projects across two organisations, skewed
9:2:1 visitor cohorts, random 128-bit page tokens, collector-generated 128-bit
visitor hashes/UUID sessions, long paths and distinct source/campaign values.
Three concurrent visitors send each bounded burst; 100 ms cumulative activity
is paced before delivery; one visit sends a real paced 30-second cumulative pulse. Page and activity replays must not inflate counts.
Sections and an export run concurrently with collection. Three maintenance
cycles advance expiry eligibility one hour without expiring retained analytics.
The final file must contain exactly 36 visits, 36 pageviews, 36 named completions
and 33,500 visible milliseconds. Organisation totals must be 33 versus 3.

Anonymous denial, Administrator CSRF denial, Viewer mutation denial, production
Origin rejection, Viewer export, invalid range/section responses, foreign keys,
physical file/freelist/index sizes and section stream/JSON equality are asserted.
`result.json` contains statuses, request p50/p95/max and actual persisted metrics.
The short signals and one real 30-second pulse exercise the activity path;
they are not a sustained pulse population or a monthly-capacity certification. Named completions
are deliberately 100% of pageviews. Maintenance cycles retain history; they do
not prove steady-state deletion/storage plateau. Prior lifecycle suites cover
actual dimension reuse and retention deletion.

The harness reserves 10 GiB plus 100 MiB before fixture work and rechecks each
cycle. Typical fixture output is a few MiB. It refuses a reused directory and
stops its own Worker. Preserve failures and databases; do not run against real
installation persistence. Local measured latency is not remote CPU or billing.

## Full physical history, offline and guarded

```sh
npm run test:history -- "$READONLY_DB" org summary
npm run test:history -- "$READONLY_DB" overview measurement --stream
npm run test:history -- "$READONLY_DB" project complete --stream
# Run each organisation family independently, one at a time:
npm run test:history -- "$READONLY_DB" org timeline --stream
npm run test:history -- "$READONLY_DB" org composition --stream
npm run test:history -- "$READONLY_DB" org ranking --stream
npm run test:history -- "$READONLY_DB" org heatmap --stream
npm run test:history -- "$READONLY_DB" org duration --stream
npm run test:history -- "$READONLY_DB" overview series --stream
npm run test:history -- "$READONLY_DB" overview goals --stream
```

Use an existing complete compact corpus; this command neither creates nor copies
one. `org` selects default-organisation Insights; `overview` its report;
`project` selects project p0. The explicit corpus contract is November 2024
through October 2026. Choose an implemented section; this fixture tool is not a
general arbitrary-installation discovery tool. It calls current real builders
through a read-only SQLite adapter, with actual query plans/times. Python opens
`mode=ro`, enables query-only and memory temporary storage, limits address space
to 512 MiB/cache to 8 MiB, interrupts each statement at 25 seconds and terminates
the whole probe after ten minutes. Outputs over 10,000 rows fail. An interrupted
or memory-limited probe is a failure, never a completed population.

The fixture assertions reconcile each family to its known population and compare
every exported CSV cell with the corresponding table value. Organisation
timeline/ranking totals include 3.6 million completion occurrences and 3.48 million
converted visitor-days; distinct denominators remain 24 million. Duration bins
reconcile to all 24 million visits. These assertions apply to this documented
synthetic corpus, not arbitrary operator data.

Offline full-corpus reads and native HTTP small-fixture reads prove different
things. Neither certifies native HTTP on the full corpus or deployed D1 limits.
Do not mount an earlier acceptance database as writable Wrangler persistence.

## Pending long reads

The dashboard requests exact section streams using `Accept: application/x-ndjson`.
Only completed statements emit progress, without intermediate analytics or raw
visitor/session arrays. A final complete frame carries the ordinary section
object. Totals remain pending until that frame; errors preserve sibling sections
and offer Retry. Browser silence beyond 30 seconds aborts, even after progress.
There is no periodic heartbeat hiding a stalled query.

The server bounds each query wait to 25 seconds and section execution to ten
minutes/2,000 statements. Cancellation prevents subsequent SQL; it cannot cancel
an already submitted D1 statement. Long organisation ranges use one project per
statement rather than five; exact project/day visitor unions and global Top N
selection are preserved. No UTC-day summation replaces visitor unions. The
existing complete JSON APIs and CSV downloads remain available with unchanged
results and ranges. A stream error has HTTP 200 after headers: consumers must
require `state: complete`, never treat connection closure as success. Retrying
starts fresh current reads; no durable resumable job or snapshot is promised.

## Current local candidate

All five organisation Insights families and overview series/goals completed
individually on the full read-only corpus, with known-population and exact CSV
reconciliation; timings and scope are in [performance](performance.md). Prior
full-project and organisation measurement proofs are retained. Native small-fixture
HTTP, clean extracted installation and recovery evidence are separate proofs.
Native full-corpus HTTP remains an environmental gap: do not copy or writable
mount preserved databases to manufacture that proof under a disk constraint.

## Release boundary

Use [performance](performance.md) for measured envelopes and [operations](operations.md)
for install/backup/cutover. Real account provisioning, Email delivery, bcrypt CPU,
remote SQL/import/export limits, deployed mixed capacity and native window
occlusion require separate evidence. Source packaging and successful local
commands do not establish these. Never shorten history or reduce identities to
fit a capacity claim.
