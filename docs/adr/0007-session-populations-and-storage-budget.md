# Exact session selection and storage budget

Status: accepted for session selection; storage follow-up implemented in ADR 0008.

## Context

Organisation duration and measurement queries selected sessions through a wide
reporting view. That view includes synthetic page-goal completions whose source
pageviews already identify the same session. It also includes eventless visits,
which must remain eligible for duration coverage. Scanning all view columns and
completion copies before selecting session keys adds avoidable work.

## Decision

Select distinct project/session keys from physical events, unioned with eligible
eventless visits. Apply the original event-window and dimension predicates to
both arms. Keep full-visit metrics and visit-start boundaries after selection.
Use the session index for correlated legacy fallbacks and occurrence counts.
Do not change event identities, visitor-day unions, privacy, authentication,
retention, collection admission or the six Insights populations.

This is a query change only. It needs no backfill, dual writes or data migration;
reverting the code restores the previous query. Existing migration and backup
contracts remain unchanged.

## Storage alternative evaluated

A separate offline layout experiment dictionary-encoded dimension tuples and
packed canonical hexadecimal identities into bytes, preserving noncanonical
strings. With a representative million-pageview fixture and indexes it occupied
359.68 MB versus 699.29 MB for the source copy. Its linear 24-month projection
is 8.63 GB, before transient peaks, maintenance and workload variation. This
fails the engineering criterion of less than 8 GB with further operational space.
It is not evidence that every compact single-D1 design fails.

The synthetic fixture uses 32-character hexadecimal identities; live collector
visitor hashes are also 32-hex (128 bits), while live sessions use UUID strings. The experiment has not
measured those shapes. The layout is not a supported schema: dimension-keyed assignment indexes do not
by themselves preserve visitor assignment across changing attribution. Neither
write adapters, concurrent backfill/cutover, resumability nor rollback have been
implemented or validated for it. Do not deploy the experiment or count its size
as the installation's steady-state footprint. No source tables were converted,
removed or automatically retired; no installation accumulates two representations.

## Consequences

The current single-database storage blocker remains. Further compaction must
measure realistic key/path cardinality, page-goal links, legacy strings, indexes,
transient writes and migration peaks, and prove exact reconstruction and recovery.
If that cannot provide a safe margin, a concrete D1 partition implementation is
required. Two years of useful history remains the requirement. No shortening,
approximate distincts or scalar-only replacement has been accepted.

ADR 0008 supersedes the experimental layout for supported storage. Its migration,
exact reconstruction and explicit retirement contract are separate from this
session-selection change.
