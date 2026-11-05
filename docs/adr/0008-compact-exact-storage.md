# Compact exact analytics storage

Status: implemented locally; deployed capacity acceptance remains open.

## Context

Repeated text identities and dimension strings plus their indexes make the
original event/visit schema exceed the single-D1 two-year budget in the local
million-pageview workload. A dimension-keyed visit assignment would change visit
semantics. Scalar rollups cannot preserve arbitrary-filter exact identity unions.

## Decision

Keep one D1 database and exact retained occurrences. Intern sessions by their
complete external identity, sharing their first visitor representation and visit
state. Events reference integer session/dimension keys. Exceptional event/visit
visitor values remain explicit overrides, including legacy sessions containing
different visitors. Visit assignment continues to use project, visitor, recorded
day, timezone, activity time and closed state, independently of paths/attribution.

Canonical lowercase 32-hex identities encode all 128 bits; canonical UUID strings
encode the same complete bits with a different tag. Other strings stay text; existing blobs receive a separate reversible escape tag.
The collector produces 32-hex visitor hashes. Storage retains all current
identity bits and applies no further truncation.
Canonical days use integer day numbers; noncanonical legacy dates stay text.
Expression indexes serve logical day and external identity predicates. Retained
page tokens use tagged exact storage and a physical token lookup for replay checks.
Dimension JSON tuples distinguish null and empty strings. Physical event IDs and
existing visit row identities survive conversion, preserving synthetic completion
and eventless-activity IDs. Legacy events need not acquire measured visits.

Writable compatibility views reconstruct original event/visit columns. A transient
inbox runs visit assignment and page-goal matching atomically with normal writes;
it retains zero events after a statement. Report/Live/Insights/CSV continue to use
the original logical identities. Page-goal links reference compact physical rows.
Dictionary reference counts support bounded unused-entry collection with retention.
Expired representative visitors are cleared when retained legacy overrides outlive
them; they do not become permanent extra visitor state.
Authentication, domain checks, privacy, admission and membership are unchanged.

## Migration and recovery

The operator tool performs additive expansion under an enforced stopped-writer
fence, transactionally resumable copy, bidirectional every-field verification and
atomic activation. It retains originals until explicit retirement. It deliberately
rejects concurrent writes during copying rather than claiming an unverified online
replication protocol. Restore/rollback and D1 export/import instructions are in
[compact storage operations](../compact-storage.md). Local original tables are
never automatically discarded. An activated upgrade requires this application's
view-compatible queries; code rollback alone is insufficient.

Retirement creates and verifies a backup, then removes redundant originals and
vacuums. Before retirement, rollback reconstructs originals from current compact
rows, preserving accepted new writes. After retirement, recovery uses the verified
active backup in isolation; later writes must be replayed before switching.

## Consequences

This is a larger schema/operational change than compressing only events, but
preserves exact filters, rates, attribution, unknown duration and retained history.
Migration peak includes source, compact copy, journals, independent backup and
vacuum/import space; it is not the retired steady footprint. Near-full remote D1
needs an exported copy in another empty binding and a coordinated binding switch.
No external service, paid fallback, lossy sketch or shorter retention is introduced.

Native local collection and small differential/recovery suites validate the
contract. One-month projection and a separate physical 24-month fixture are both measured;
retained size depends on identity/path/session cardinality. Organisation query
latency and mixed report/collection workload are explicitly separate remaining
work. No remote import or deployed throughput is certified. The physical two-year
fixture proves local retained size, with transient/variation acceptance still open.

ADR 0009 refines assignment eligibility and index lifecycle without changing
retained analytics or exact reconstruction. Its operations and measurements
supersede the broad-index retained-size baseline above.
