# Terminal assignment eligibility

A retained visit is historical analytics, while eligibility to accept new activity
is operational state. Close open visits at 30 minutes since their last accepted
activity, in bounded batches per project including forever-retention projects.
Closure is terminal across clock rollback; a cumulative pulse cannot reopen one.
Only the existing closed field changes. Keep every identity, metric, timestamp,
attribution and occurrence. Midnight and timezone rules remain in force.

Index assignment and expiry only for open measured visits. Keep a separate narrow
project/day history index and exact external-session lookup. This trades one
terminal update and sparse-index removals for eliminating wide cold identity
entries. Dropping the history index was rejected because retained selection and
retention still need bounded project/day access. Upgrade old compact stores
offline with a protected backup, persisted primary-key cursor and atomic final
index replacement; do not build giant indexes on near-full D1. See compact storage
operations for recovery and reclamation requirements.


Page-to-visit lookups remove source TEXT affinity with unary `+`, retaining the
exact value while making comparisons to reconstructed session expressions
indexable. This applies to activity reads, trigger subqueries and page guards;
otherwise SQLite can scan cold visits for each activity. The populated plan
regression includes text, embedded NUL and blob sessions. See SQLite's
[expression affinity rules](https://www.sqlite.org/datatype3.html#affinity_of_expressions).
No new wide session index or altered identity representation is required.


Resolve existing assignment and first attribution before interning an event, while
retaining the final assignment/cap/goal rules. This avoids temporary identities
and dimension tuples that immediately become unreferenced. Reference counts are
validated offline before enabling reuse. Clear and reuse zero-reference dimension
rows instead of deleting them: parent deletion otherwise checks both unindexed
child tables, requiring whole-history reads per row. Foreign keys stay installed.
Cleared values are distinct JSON objects containing only the internal row number;
referenced tuples remain exact arrays. A pending partial index excludes cleared
rows, and available rows bound growth to peak simultaneous dimension demand.
