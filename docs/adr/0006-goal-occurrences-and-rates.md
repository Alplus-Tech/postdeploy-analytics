# Goal occurrences, immutable rules and event-window rates

New goal rules are prospective. Matching paths/names cannot change, and archived
rules cannot resume or release their matching key. Labels can change without
detaching history. This trades configuration flexibility for interpretable history;
a new semantic action needs a distinct rule. Existing starter IDs and revenue stay.

Page completion links reference original accepted pageview IDs. The assignment
trigger creates links after visit assignment, bounds and token deduplication.
Reporting unions derived completions with retained events without fabricating
original events or navigation. Activity never creates completions. Retention
removes links with their source event. The additive migration backfills nothing.

Rates use completion/event windows rather than visit-start windows: distinct
(project, local day, daily visitor identity) completing a goal over the same
population with accepted pageview/named event occurrences. Activity-only visits
are excluded. Across goals the numerator is a union, not a sum. Hour buckets use
event hours; organisation windows use UTC receipt time but preserve project daily
identities. Organisation rates divide summed project counts. Zero denominator is
zero. This intentionally differs from existing visit/duration coverage, especially
at midnight and date-window edges.

Filtered exports reuse report builders, including visible top-100 limits and
comparison periods. They export bounded aggregates with context, never raw
identities. Spreadsheet formula neutralisation applies to textual fields before
CSV quoting, including whitespace/control-prefixed markers.
