# Partition exact organisation aggregates by project

Status: accepted locally; performance acceptance is reported separately.

## Context

Logical compatibility views preserve writable legacy identities, but expand wide
rows, decode compact identities and can materialise historical visit joins for
aggregate reads. Several chart queries repeat this work. One long D1 statement
also occupies the shared collection queue.

## Decision

Keep compatibility views and all write/recovery contracts. Aggregate-only reads
on an active compact layout shadow them with narrow statement-local projections.
Session references remain exact integer dictionary keys. Visitor references use
the SQLite type and hex of the tagged stored value, preserving blob/NUL and typed
overrides without reconstructing external identities. Only requested dimensions
are decoded. Event chart families share a narrow statement-local materialisation.
Its predicates are pushed explicitly into both physical UNION arms; a regression
plan check rejects full physical event scans below this materialisation. Synthetic page-goal occurrences remain separate occurrences.

Organisation aggregates execute sequentially in groups of at most five projects and merge sufficient
statistics. Project visitor-day populations are disjoint across projects; counts
and sums therefore merge exactly, while rates are calculated from merged counts.
UTC chart boundaries and recorded project-local visitor days remain separate.
Selected-goal denominators still include only the selected goal's project.
Visit selection still includes eventless continuations and full durations of
visits starting in range, including legacy unknown duration.

Global ranking/composition keys are selected before partitioned category queries.
A sorted merge of grouped category counts retains at most 128 rows per group
plus the requested Top N. This prevents a category omitted from every local Top N
from disappearing globally. Other is a union within each project, then summed
across disjoint project populations. Binary UTF-8 ordering preserves SQL ties.

## Consequences

No persistent derived data, schema migration, indexes, cache invalidation, extra
collection writes or storage budget is introduced. All charts and exports still
return complete results in the existing response shape. Sequential statements
allow independent collection requests between reads. This does not bound a
single very large project's query or certify arbitrary whole-history latency.
Each statement reads its current database snapshot, as the existing multi-query
builders do; concurrent mutation can occur between statements. Legacy tables
retain their logical projection with the same partition/merge procedure.

Native mixed work showed that sequential awaited RPCs can still starve incoming
fetches. A 5ms event-loop yield follows each grouped read/category page. This
changes read scheduling only; admission and accepted collection semantics stay
unchanged. It adds bounded per-statement delay, with no detached task or monitor.
Project reports use the same physical session references but retain decoded
logical visitor ordering for MIN-based session summaries. Their goal facts are
materialised once and journeys seek the existing session index. Page-filter
membership reads the physical page occurrences independently of other filters.

## Independent section reads

Section selection is an explicit builder input. Complete callers retain the
shared all-family computation; section callers select the necessary typed query
families. Traffic summary uses physical/logical base events: synthetic page-goal
occurrences copy an existing pageview's scope and visitor-day identity, so they
cannot change traffic totals or the visitor union. Named occurrences remain.
Summary groups by project and recorded local day before summing exact distinct
visitor counts. It does not substitute sessions for visitors. Daily traffic is a separate section, preserving UTC event dates and recorded
local-day visitor identity at window edges. Rate families retain synthetic occurrences and selected-project
denominators; ranking retains global selection and exact Other unions.

The browser bounds analytics to one active request per page, prioritises current
traffic, and renders each result independently. Failed sections retain successful
siblings and offer manual retry. Abort and selection generation checks prevent
old data from entering a new selection. Cancellation of a browser request does
not promise cancellation of an already executing D1 statement. Existing grouped
read yields remain necessary. More independent reads trade additional total work
for earlier usefulness; they do not promise a single database snapshot while
collection continues. No persistent state or write-path changes are introduced.


Long windows (over 92 days) reduce each organisation partition to one project.
This bounds each uninterrupted read more tightly while preserving disjoint project
populations and global category selection. Section streaming reports only actual
statement completion before the final exact result. Server query wait/section-work
limits and browser silence limits are explicit; cancellation stops subsequent
reads. This adds no persistent state, write-path work or durable continuation.
