# Compact analytics storage

This is an offline expand/copy/verify/activate/contract upgrade. It keeps the same
tracker, API identifiers, event identities, report fields and retention rules.
Use Node 24+. Never point these commands at a running database. Stop collection,
settings writes and the retention scheduler for the entire upgrade. Rejected
collection is not queued or later reconstructed; choose a maintenance window.

## Upgrade a local installation

Make an independently restorable copy first. Set DBFILE to the installation's
local SQLite database and BACKUP to a new protected backup filename. The prepare
command also requires a new backup filename and checks its integrity before
changing anything:

```
node worker/scripts/compact-storage.mjs prepare "$DBFILE" "$BACKUP"
node worker/scripts/compact-storage.mjs copy "$DBFILE"
node worker/scripts/compact-storage.mjs verify "$DBFILE"
node worker/scripts/compact-storage.mjs activate "$DBFILE"
```

Prepare is additive. It installs database write fences on original tables; SQL
writes abort with a maintenance error. Existing reads remain available. Copy uses
1,000-row transactions with persisted cursors; stop/restart `copy` safely after an
interruption. Retrying prepare is idempotent. Never edit fenced source rows.
Verification compares every logical column and visit row identity in both
directions, checks foreign keys, and runs again inside the atomic activation
transaction. Incomplete copies cannot activate. After activation, `verify` checks
reference counts, foreign keys and database integrity; it no longer compares
against stale originals after accepted new writes. The empty events staging table
exists only for atomic normal collection and retains no second event history.

After activation, restart the local Worker and verify normal collection, goals,
activity, project/organisation reports, Live, Insights, CSV and operator sign-in.
The source tables remain available for recovery but are no longer written.
Do not count this state as steady compact storage. Ordinary auth/CSRF/roles/domain
validation and collection admission remain unchanged.

## Rollback and retirement

Before retirement, stop the Worker and scheduler, then run:

```
node worker/scripts/compact-storage.mjs rollback "$DBFILE"
```

Rollback during copying removes the expansion and fences. Rollback after activation
reconstructs original tables from current compact logical rows, including writes
accepted after activation, restores original triggers/views and transient mappings,
and removes compact tables. It does not restore an old snapshot over new analytics.
Back up the current file before rollback as operational protection.

After testing recovery and verifying a protected backup, stop writers again:

```
node worker/scripts/compact-storage.mjs retire "$DBFILE" "$NEW_ACTIVE_BACKUP"
```

This explicit operator stage backs up the active database and checks integrity,
then drops redundant original events/visits and vacuums free pages. It never runs
automatically. Retain both backups until the installation's recovery policy allows
retirement. Once originals are retired, in-place rollback refuses. Restore the
verified active backup to an isolated file, roll it back there, validate it and
switch while writers remain stopped. If collection resumed after that backup,
preserve the current compact file and replay those accepted changes before
switching; never discard it or silently revert history. Application code rollback
alone is insufficient after schema activation.

## D1 export/import boundary

The tool operates on an offline SQLite file, never remote resources. For D1,
export the database with Wrangler, load the SQL into an isolated SQLite database,
run the steps above and export using:

```
node worker/scripts/compact-export.mjs "$DBFILE" "$NEW_EXPORT_DIRECTORY" --parts
```

The exporter preserves blobs, arbitrary strings, floating values, integer IDs and
rowids, omits Cloudflare-internal tables, creates indexes while tables are empty, emits rows before triggers, and uses
bounded streaming. Numbered parts avoid a single whole-history SQL file. Import into an empty isolated D1 binding using Wrangler's SQL
file import. Parts are bounded to 16 MiB (apart from any single larger SQL statement);
import the numbered SQL files sequentially in manifest order, then validate it through the Worker before an explicitly authorized
binding switch. Never import this full schema into a populated binding or overwrite
the sole source. Source D1 export, import into the replacement binding and final
binding switch need a coordinated stopped-writer window; there is no online
cross-database replication protocol here. This feature does not provision or
switch production bindings. A local D1 import is covered by local proof; remote
D1 import, quotas, rollout timing and restoration remain operator acceptance work.

## Space and operational limits

Budget source + compact expansion + copy journals + independently retained backup
and vacuum/export space during migration. The CLI requires 12 GiB free initially
and stops copying below a 10 GiB reserve. These local reserves are not a D1 quota
workaround. An existing near-full D1 must export/copy into another empty binding;
it cannot safely expand in place. No dual retained store is required after
retirement. Fresh installations may activate an empty schema before collection
and immediately retire its empty originals.

Identity packing is reversible: canonical lowercase 32-hex strings and canonical
lowercase UUID strings use separate binary tags; arbitrary other strings stay
text. No entropy is removed and case, punctuation and legacy formats survive.
An expression index resolves exact external identities. Dimension tuples retain
JSON null/string distinctions. Visits keep an internal integer identity, independent
of dimension changes, and the assignment index is project/visitor/day/timezone/time.
Retained event tokens survive transient expiry. Reference counts and bounded
unused-dictionary cleanup prevent expiry from leaving permanent identity metadata.

Organisation query latency and mixed collection/report capacity are separate
unfinished work. Local storage measurements do not certify deployed throughput,
D1 billing or mixed-workload capacity.

Unused representative visitor values are cleared when legacy session overrides
outlive them. Unused identity removals count as transient cleanup. Unused dimension
values are erased in bounded batches and their rows reused; cleared tuples have
no retained references. Dimension clears and pending backlog are reported separately. Existing logical visitor fields and session identities remain exact.

## Assignment headroom upgrade

Upgrade installed compact stores **before** deploying the bounded-expiry code.
Stop collection, settings writes and cron throughout. Work on an independent
local copy of an export, retaining the untouched source. Both active and retired
compact stores are supported; finish any copying/cutover stage first.

```
node worker/scripts/storage-headroom.mjs prepare "$DBFILE" "$NEW_BACKUP"
node worker/scripts/storage-headroom.mjs resume "$DBFILE"
node worker/scripts/storage-headroom.mjs verify "$DBFILE" "$NEW_BACKUP"
node worker/scripts/storage-headroom.mjs status "$DBFILE"
```

Prepare creates a protected, integrity-checked backup before persisting a fixed
clock cutoff. Resume scans primary-key ranges in 1,000-row transactions, closing
only open visits whose last accepted activity is at least 30 minutes old.
Cursor, scanned and closed counts commit with each batch. Status emits the exact
64-bit cursor as a string. Verify compares every
source table row/field against the protected backup, allowing only eligible
terminal closures, and checks foreign keys and integrity. Reopening and repeating
resume is safe; status.complete must equal 1 before restarting writers. Completion
atomically replaces the assignment index with `WHERE visit_rowid IS NOT NULL AND
closed=0`, adds a sparse project/last-activity expiry index and a narrow retained
project/day index. Index construction is offline and may be long; it is not a
bounded D1 cron statement. No events, identities, attribution, times or accepted
visible duration are removed or rewritten. Closure is terminal even if clocks
subsequently move backwards. Existing local-midnight and timezone-change rules
still split visits; expiry uses elapsed UTC milliseconds, independent of DST.

Fresh legacy installations apply migration 0009. Existing legacy stores can run
the same offline tool before applying that migration to drain a large backlog.
Do not apply legacy index SQL to compact compatibility views. When an exported
compact store includes d1_migrations, successful completion records migration
0009 there; preserve that ledger during import and verify it before deployment.
Exports without a migration ledger require reconciling the target ledger with
the already installed migrations before enabling automatic migration commands.
Fresh compact conversion uses the new indexes directly. Original migration
files remain unchanged. Compact rollback now restores sparse legacy indexes;
it preserves operational closure and all writes accepted after activation.

Retain the verified pre-upgrade backup. To abandon an interrupted offline upgrade,
restore it into another isolated file, validate and switch while writers remain
stopped. Never overwrite the sole current copy. After writers restart, a backup
restore requires replaying subsequently accepted writes, as with compact recovery.
An index-only reversal does not require reopening terminal visits.

Budget backup, main file, index build/sort and reclamation output separately.
The tool reserves backup bytes plus 12 GiB initially and checks 10 GiB between
batches. Freed SQLite pages are reusable but do not shrink the file. For a large
local store use `VACUUM INTO` a new file with room for the output and the reserve;
in-place VACUUM may additionally need a full rollback journal. Verify the new
file before switching. A near-full D1 must use offline conversion/export and
an empty replacement binding: no blind remote whole-history CREATE INDEX or
in-place schema expansion. Export builds indexes while target tables are empty.
Remote import, limits, binding switch and deployed capacity remain unverified.


Activity/page-session predicates strip source column affinity without changing
values, so exact expression indexes serve blob, NUL and ordinary sessions. Visit
assignment resolves an eligible session and its first attribution before event
interning; final assignment, caps and goals still execute. This avoids provisional
unused identities and tuples. Installed upgrades update these adapters atomically.

Before enabling reusable dimension rows, the offline upgrade validates dimension
reference counts in a whole-store pass. Normal reference triggers remain atomic
and every foreign key remains installed. Only zero-reference tuple values can be
cleared or reused. A narrow pending index excludes already cleared rows, so cron
does not rescan the pool. Reuse changes no referenced attributes or external IDs.
The logical views and packed identity formats remain unchanged.

After verified upgrade, reclaim into a new file with:

```
node worker/scripts/storage-headroom.mjs reclaim "$DBFILE" "$NEW_RECLAIMED_FILE"
```

This conservatively reserves an input-sized workspace and the complete output
plus 10 GiB, checks source/destination filesystems and keeps SQLite temporary work
in the input directory. It creates mode-0600 output with
VACUUM INTO, checks integrity/foreign keys and compares every source row/field
including closed state exactly. It preserves the input and backups. Insufficient
reserve refuses before creating the output. The physically populated live case
could not be reclaimed again on the validation host while retaining all evidence;
its observed file bloat remains part of the reported result. Do not substitute
allocated dbstat pages for actual file size or claim the 8 GB budget passed.

Copy and maintenance checkpoints include the full signed 64-bit rowid range.
Rollback preserves a headroom checkpoint that already existed in the legacy
source; headroom operations refuse an unfinished compact cutover.

Aggregate-only reporting may read narrow physical projections and integer session
references (ADR 0010); external identities and writable compatibility views remain
unchanged. This read-path change adds no migration, index, durable facts or recovery
step. Existing activation, rollback, retention and headroom procedures still apply.
