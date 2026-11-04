# Minute scheduler design to integrate after source review

This is a design, not deployed code and not a completed fix. Keep the existing
origin, subscription and schedule API, local times and `* * * * *` cron.

Use a D1 indexed due-work table rather than KV enumeration. Keep the old KV data
intact for rollback. Tables/columns must be reconciled with PR #1's schema before
writing a versioned local migration; no remote schema changes are authorized here.

Each device delivery has owner, subscription ID/version, plan ID/revision, UTC
occurrence minute, IANA timezone, local date/time, next-attempt timestamp, bounded
attempt count, lease token/deadline, state and expiry. Unique identity is
(plan ID, revision, occurrence minute, device ID). Index pending work on
(state, next-attempt timestamp); index device and plan ownership for edits.

Cron uses the scheduled event time, selecting only due indexed rows with a
bounded batch, then conditionally claims each row with a unique lease. Check the
active plan and subscription revision at claim/send; a schedule edit transaction
cancels future old-revision work and inserts replacement occurrences, without
mutating the user's notification times. Client update requests require ownership
and optimistic concurrency. Multiple devices get independent delivery rows.

Network delivery is external to D1 transactions: leases prevent overlapping
claims but cannot guarantee exactly-once push after a crash between provider
acceptance and database acknowledgment. Store an occurrence-based notification
tag to collapse visible duplicates where supported. Explicitly choose/document
at-least-once vs at-most-once behavior for this crash window; do not claim perfect
idempotency. Recheck cancellation immediately before send, while documenting the
remaining edit-vs-in-flight-send race.

Retry transient transport/429/5xx with bounded backoff, honoring Retry-After only
within the expiry window. Persist attempts and reclaim expired leases. Delete or
invalidate only the matching device subscription version on 404/410, so a newer
subscription is preserved. Do not retry permanent auth/config errors indefinitely.
A late cron must catch up only within a defined, user-visible grace window;
never silently move reminder times. Backlog/capacity delays need explicit metrics.

Materialize upcoming UTC occurrences from the existing timezone policy; test
Istanbul and DST gap/fold zones, midnight, leap days and timezone changes. Define
one occurrence per intended local event, including the existing behavior for DST
ambiguity, after inspecting the real scheduler. Replenish due rows ahead of time
without scanning all KV users each minute.

Migration is opt-in and staged: private backup + verified restore, local fixtures,
read-only shadow comparison without push, reconciliation of each device/plan,
then an explicitly approved single-sender cutover. Never enable both senders for
the same occurrence. Roll back to the recorded Worker deployment/config and
preserved KV; reconcile the delivery ledger first to prevent duplicate catch-up.
Do not rotate VAPID keys or re-enroll devices merely to switch queue storage.

Required integration tests: due minute boundaries, overlapping cron/lease claims,
crash windows, expired leases, retry/expiry, Retry-After, missed ticks, DST,
multiple devices/users, 404/410 vs concurrent renewal, edit/delete vs in-flight
send, owner isolation, invalid requests, migration restart, rollback and duplicate
suppression. Assert zero KV list calls with a spy that throws on `list()`, run
against the real handler, and verify SQLite query plans use the due index.
