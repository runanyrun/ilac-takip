# Indexed delivery queue — local integration component

This module is **not connected to the production Worker**. It is not a substitute
for importing/reviewing the live source. No Worker entrypoint, cron, D1 binding,
remote migration, KV migration or API route is enabled by these files.

`queue.mjs` accepts a D1 binding and a caller-supplied Web Push sender. Apply
`schema.sql` only to a local disposable database for development. The test adapter
uses Node 24 SQLite and serialized transactions with the same prepare/bind/batch
shape. Cloudflare D1 runtime integration is still pending.

- `putPlan` / `putDevice`: canonical JSON comparison avoids writes on unchanged
  sync. Expected revisions provide optimistic concurrency. CAS and stale-work
  cancellation execute in a single D1 batch transaction. No blind KV read-then-put
  emulation: KV is eventually consistent and does not provide CAS.
- `enqueue`: materializes one delivery per owner/plan revision/device revision/UTC
  minute, with a unique constraint. Existing drug payloads, local times and extra
  fields are retained; this module does not interpret/rewrite dose times.
- `dispatchDue`: indexed, bounded due-query; conditional leases; retries with
  backoff and Retry-After; grace expiry; version-specific 404/410 cleanup. An idle
  tick executes one read query and no D1 writes. No KV methods exist in the module.
  Stale-revision work is cancelled transactionally when plans/devices change.

**Caller responsibilities before integration:** verify authentication/owner
isolation and subscription URL allowlist; build UTC occurrences with the real
scheduler's unchanged timezone/DST policy; supply the existing sender and VAPID
bindings; use `event.scheduledTime` for eligibility while respecting actual
execution/expiry time; arrange bounded future occurrence replenishment and
terminal-row retention; apply migration/rollback acceptance checks from
`docs/issue5/scheduler-design.md`. None of these are silently auto-enabled.

`send(subscription,{occurrenceId,dueAt})` must return a provider response and use
`occurrenceId` as a stable notification tag where supported. Never log endpoints,
keys, patient data or raw database/provider errors. Transport acceptance is not
handset delivery proof.

The lease provides exclusion during its lifetime, not exactly-once external I/O.
A process crash after provider acceptance but before acknowledgment can cause
redelivery after lease expiry; a plan edit during a send can race with delivery.
The adapter must enforce a bounded provider timeout shorter than the lease and
reconcile this crash window. Max batch defaults to 500; beyond that, backlog can
miss minute precision and needs a measured capacity plan. No unbounded scaling
or production-delivery guarantee is made here.

Local measured workload: for each of 1, 2 and 100 owners, populate a plan/device
and pending future occurrence, then run 1,440 idle ticks. Each run observed 1,440
SELECTs and **0 write statements**, with all due deliveries sent at their test
minute and no repeat send on the repeated event. Repeated identical plan/device
sync also executed 0 write statements. These are local component results, not
Cloudflare production operation measurements.

Run `npm test`. No credentials, real data or live network is used by queue tests.
