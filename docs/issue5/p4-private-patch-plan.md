# P4 removal candidate and private validation plan

Status: **offline patch preparation only**. The real private source has not been
transferred, patched or executed here. No production or `main` change, deployment,
remote migration, schedule change or subscription modification is authorized by
this package. The production source-import gate remains blocked.

## Exact P4 edit

The target is the standalone awaited PUT statement identified as P4 in the
2026-11-03 private audit: scheduled-only metadata, outside loops/conditionals,
with no earlier control exit in its callback. Remove **that whole expression
statement only**. Do not merely remove `await`, swallow its exception, rename its
key, lengthen TTL, write it from a GET, or slow down cron. Those alternatives retain
the daily write or make its outcome less observable.

No replacement persistence operation is added. Optional diagnostics should use
existing invocation logging/metrics without endpoint, medication or credential
payloads; new logging configuration is not enabled by this work.

The source and key are deliberately not reproduced in a public diff. Instead,
`scripts/issue5/p4-private-patch.mjs` provides a concrete offline AST patch for an
**already-authorized private export**, pinned to the reviewer's SHA-256. It has no
network, Cloudflare API, deployment or secret-extraction code. It never executes
the input Worker. It produces a fixed comment at the removed statement and leaves
all other source bytes unchanged; the remaining six direct PUT expressions must
also remain byte-identical after parsing.

Before using it, a private reviewer must confirm P4's record is **diagnostic-only**:
inspect all read consumers and helper/alias calls, verify that no delivery,
lease, dedup, retry, timezone or ownership logic depends on it, and review argument
side effects. A status consumer must tolerate the absence/staleness of the old
heartbeat, with an explicit “not recorded” state rather than falsely declaring
cron stopped. If those consumers cannot be adapted without functional changes,
stop and prepare a separately reviewed patch. Do not delete the existing KV record
or change its TTL; it may age naturally under its existing policy.

## Private operator procedure (no deployment)

Use a trusted Node 24+ installation and the pinned dependencies from this
`develop` revision. Never copy the private source into this checkout, a public
issue, logs, chat, CI artifacts or a shell command. Work in a reviewer-controlled
private directory outside Git checkouts, mode 0700, with source mode 0600. The
source must be the reviewed JavaScript entry module, not an opaque multipart
response. Record deployment/module provenance and the original SHA-256 privately.

Check only, without creating a candidate:

```sh
node scripts/issue5/p4-private-patch.mjs \
  --source /approved-private/worker.mjs \
  --expected-sha256 REVIEWED_64_CHARACTER_LOWERCASE_SHA256 \
  --diagnostic-only-reviewed
```

After the diagnostic-only review, explicitly request a **new sibling file**:

```sh
node scripts/issue5/p4-private-patch.mjs \
  --source /approved-private/worker.mjs \
  --expected-sha256 REVIEWED_64_CHARACTER_LOWERCASE_SHA256 \
  --diagnostic-only-reviewed \
  --candidate /approved-private/worker-p4-candidate.mjs
```

The hash placeholder is intentionally invalid: supply the independently reviewed
hash, not a guessed value. The review flag is an operator attestation, **not** a
machine proof of diagnostic-only semantics, privacy approval or deploy permission.

The tool requires the audited seven-PUT baseline and P4 structural footprint,
a standalone statement and a narrow whitelist of inert arguments. It refuses
unknown calls, compound expressions, changed input, a repeated patch, symlink
input, permissive file/directory access and source/output in Git worktrees. Empty
reserved `.git` directories in managed filesystems are not treated as repositories;
a `.git` worktree file, symlink or repository metadata is rejected. Candidate
creation is exclusive (`wx`, mode 0600), in the same private directory. The input
file is never overwritten. If the real source has a different expression shape,
**do not weaken the guards or add a force option**; a private reviewer must create
and test a source-specific edit instead.

Stdout contains only counts, hashes and `readyForDeployment:false`; failures emit
a fixed redacted message. Hashes identify artifacts but do not validate provenance
or secret separation. No import manifest is generated and no source gate is passed.

## P3 / P5 / P6 / P7 safety decisions

| Site | Concrete requirement before a real-source patch | Failure/retry rule | Preservation test |
| --- | --- | --- | --- |
| P3 sync | Separate stable subscription/plan payload from volatile timestamps. Compare stable content under a single writer or a transactional revision check; retain original field values, endpoint and VAPID identity. Treat TTL renewal within an agreed margin as a real transition. | Separate invalid input (400) from transient storage failure (503, or 429 only when quota classification is known). Await the write; do not return saved or advance the acknowledged revision on failure. A timeout with unknown commit outcome requires reconciliation/idempotent replay, not a blind second update. | Repeated identical sync writes 0 before renewal margin; a required renewal writes once; concurrent clients cannot overwrite newer plan/subscription data; quota/error preserves previous records and returns no false success. |
| P5 delivery status | Privately establish whether the status write is diagnostic or required for delivery state. Isolate/remove it only after diagnostic-only proof; otherwise persist it as part of a durable transition. | A P5 failure must not silently erase or conceal provider acceptance. Classify an uncommitted accepted attempt as uncertain; do not turn it into a fresh occurrence on the next minute. | Inject failure before provider I/O, after acceptance and before each state commit; compare retry and notification identity. |
| P6 dedup | Preserve the occurrence identity and marker semantics. Do not delete, thin or blindly skip dedup writes to reduce quota. Atomically claim work where the selected storage supports it; KV get-then-put is not CAS. | External provider acceptance and KV/database commit are not one transaction. The accepted-but-uncommitted window must have an explicit duplicate/loss policy and reconciliation path. Stable notification tags reduce visible duplicates but do not prove exactly-once delivery. | Duplicate/overlapping cron events, expired leases, crash after acceptance, marker 429, multiple devices and a retry after uncertain outcome. |
| P7 record maintenance | Determine exactly which durable fields change. Remove only redundant timestamp-only maintenance, after reviewing status consumers and expiry; persist real delivery/plan changes using ownership + expected revision. Avoid a scheduled whole-record snapshot overwriting a concurrent P3 renewal. | Never swallow a real state write failure and report persistence success. Do not retry a stale snapshot. Keep cleanup version-specific when 404/410 races with renewal. | Sync/renewal during send, P7 write after concurrent P3, unchanged payload with expiring TTL, old endpoint 410 after a newer subscription, and two-device isolation. |

TTL policy values, renewal margin, outage grace and device retention are **not
chosen here**; the private source/current policy must supply them. Tests should
use the existing policy at its boundary, not introduce a new medication schedule.
The existing `cloudflare/push-queue/` implementation is reference development work
only; it remains disconnected. No new queue, D1 binding or schema is enabled.

Reference: Cloudflare documents KV's eventual consistency, last-writer-wins,
1-write/key/second limit and the requirement to await `put()`:
https://developers.cloudflare.com/kv/api/write-key-value-pairs/
A process-local flag or cached equality check is not a distributed lock, and a
429 alone does not distinguish same-key rate limiting from daily quota exhaustion.

## Actual private Worker acceptance matrix

Run the **real original and candidate module** in an approved isolated local
Workers harness, with fake bindings, fake provider transport and outbound network
blocked. Do not import/run private source in public GitHub Actions. All fixtures
must be synthetic, with no copied KV values/subscriptions. Record only redacted
counts, pass/fail and artifact hashes.

1. Verify original/candidate hashes and the single-statement diff privately. Check
   all remaining source bytes, static assets, manifest, API routes, cron config,
   compatibility flags and bindings are unchanged. Inventory all P4 read consumers.
2. For zero users, invoke exactly 1,440 scheduled events. Original trace contains
   the heartbeat; candidate contains **zero P4 attempts**. With P4 configured to
   throw 429 in the original, demonstrate candidate still reaches useful work.
3. For 1, 2 and 100 devices, compare original/candidate P3/P5/P6/P7 call traces,
   values, TTL/expiration options, provider payloads, due times and persisted state.
   The only intended difference in this narrow patch is one P4 attempt per tick;
   useful work that was previously aborted by P4 failure may now proceed. Measure
   that separately rather than promising a whole-account zero-PUT result.
4. Repeat original timezone/DST boundary, delayed-event and no-due scenarios.
   Preserve existing cron/event timing and medication times exactly. Do not change
   event-time vs wall-time behavior as part of the P4-only edit.
5. Inject 429/network/storage failure independently at P3/P5/P6/P7 and provider
   acceptance. Check API statuses, acknowledged revisions, bounded Retry-After/
   backoff, uncertain delivery state and no tight-loop retry. The narrow P4 removal
   **does not claim to fix** these existing behaviors.
6. Run the table's concurrency, renewal, cleanup and duplicate cases. Document
   unresolved failures and block wider integration until their source-specific
   fixes pass. A naive read-compare-write KV optimization is not an acceptable fix.
7. Validate private candidate build and reviewed sanitized import separately.
   Keep original source/config hashes for rollback, with preserved KV and a
   delivery-ledger reconciliation plan. No live rollback, deploy, subscription
   migration or record deletion is performed by these instructions.

Current public tests use only a **synthetic seven-site fixture**, not the real
Worker. They verify single-statement removal, unchanged other traces/TTL, 1,440
idle ticks, 1/2/100 devices, rejection guards and private file handling. Passing
these tests cannot certify production parity or physical iPhone push receipt.

## Remaining blocker

The approved private source artifact, diagnostic-only/read-consumer review and
real-handler tests are not available in this workspace. The tool is prepared for
that environment; it has **not** generated a candidate from the actual Worker.
The existing source-import gate remains fail-closed. Safe options are to run this
package where the owner already has authorized private source access, or prepare
a manually reviewed one-statement edit there if the strict matcher refuses it.
Neither option involves bypassing source security, public source transfer or
changing the live application.

## Validation of the public preparation package

- `npm test`: 70 passed; 5 real-source-dependent scenarios remain skipped.
- Desktop Chromium suite: 5 passed.
- Seven new P4 tests passed. The synthetic baseline attempted 1,440 heartbeat PUTs;
  the candidate attempted 0 for the same empty-tick workload. Other PUT call traces
  and TTL values matched for 1/2/100 synthetic devices.
- Synthetic CLI smoke checks passed for both check-only and exclusive candidate
  creation; source bytes and candidate mode 0600 were verified.
- Secret-pattern scan and whitespace checks passed.
- `npm run check:import` still exits 1 because reviewed live source is absent.
  This package does not turn that missing-source gate green.
