# Issue #5 — partial implementation, production blocked

Work is based on `develop` at `67e55a0`. No application runtime, manifest,
localStorage key, subscription, notification time, namespace or cron was changed.
No Cloudflare resource was written; no deploy or merge was performed.

## Review of existing work

- Issue #4 is the production acceptance checklist, not evidence of completion.
- Draft PR #1 (`feature/cloudflare-d1-foundation` → `develop`, head `13a8849`)
  adds a separate D1 API, enrollment, backup and Web Push experiments. It does not
  implement the mono Worker's minute scheduler. Its data mapping and multi-write
  enrollment need integration/concurrency review; do not combine it blindly with
  the mono Worker or change the installed app's origin to use it.
- Draft PR #3 (`codex/issue-2-cloudflare-migration-prep` → `develop`, head
  `9b22c3e`) contains migration scaffolding, MVP safety changes and tests, but no
  `cloudflare/mono-preview/src/index.js`. Its import script checks inventory
  hashes; it cannot establish behavior parity, verified provenance or secret-free
  source on its own. This PR adds an independent stricter gate and no replacement
  Worker/config. Reconcile gate paths when integrating PR #3.
- Neither draft was merged. GitHub `main`/`develop` MVP tests cannot certify the
  active mono Worker. Both open PRs touch MVP files; avoid a combined deployment.

## Read-only findings, 2026-11-03

Cloudflare API settings and schedules were read directly:

- Worker: `ilac-takip-mono-preview`; compatibility date `2026-10-01`.
- One returned binding: `PUSH_KV`, type `kv_namespace`.
- Active schedule: `* * * * *` (unchanged).
- Content endpoint returned a 48,619-character response. An aggregate-only scan
  found `scheduled()` and direct `PUSH_KV` call-site counts: list 1, get 8, put 7,
  delete 1. These are static textual counts across the response, not invocations,
  runtime metrics, or proof that list is reached once per minute. Aliases and
  indirect calls are not counted.
- Build-trigger read returned an undeleted GitHub trigger whose branch includes
  only `main` and whose deploy command is `npx wrangler deploy`. The API response
  did not expose a disabled flag. Therefore **Git builds being disabled is not
  verified**; the existing main-target trigger must be reviewed before any main
  update. This work publishes only a separate develop-targeted PR head, which does
  not match that branch filter. No trigger setting was changed.
- Full-source transfer was rejected by automatic security review because narrow
  VAPID-only redaction could disclose other secrets/private data. No production
  source, subscription endpoint, credentials or patient data is committed here.
- The REST schema exposed no KV analytics endpoint. GraphQL schema discovery did
  not produce usable operation dimensions through the current connector. Actual
  operation counts and the quota alert's cause remain unverified.

## Implemented offline safeguards

Run from repository root (Node 24, no packages required):

```sh
node --test tests/issue5/*.test.mjs
git ls-files -z --cached --others --exclude-standard | node scripts/issue5/check.mjs
node scripts/issue5/source-gate.mjs
```

The last command intentionally exits 1 while reviewed source is absent. CI runs
unit tests/pattern scan and the source gate in separate jobs, with read-only repo
permissions and no deploy. The draft's source-gate job must remain blocked, not
be converted into a passing skipped check. Configure required status checks via
repository settings before treating CI as an enforced merge barrier; this PR
does not change account settings. Pattern detection is defense in depth, not a
complete secret scanner or a substitute for manual review. A dedicated full-history
secret scan should also be required before source publication.

The gate expects `cloudflare/mono-preview/import-manifest.json` with `worker`,
`deploymentId`, ISO `exportedAt`, `compatibilityDate`, `cron`, and `files` entries
containing `path`/SHA-256. Preserve the active date/cron. Inventory only `src/` and
`public/`, including `src/index.js`; reject traversal, symlinks, duplicates,
unlisted source, changed hashes and recognized sensitive patterns. A successful
hash check explicitly does not assert production readiness. Obtain deployment
identity and a private raw-source hash from the authorized export process; retain
raw source in approved private storage, review all literals and bindings, then
publish only sanitized code plus separate sanitized-file hashes. Never fabricate
an import manifest or use an empty mock as production source.

## Required follow-up and actual blockers

1. Safely export/review the real Worker in private storage without displaying raw
   source. Obtain deployment ID, source hash, all modules and nonsecret settings.
   Secret values remain bindings; redact endpoints and personal records before
   publication. Current aggregate access is insufficient to implement a truthful
   change to the real `scheduled()` handler.
2. Obtain **aggregated** KV operation metrics with authorized Account Analytics
   access or dashboard export: namespace, operation type, counts, errors, sampling,
   UTC start/end. Use the current quota day and a complete prior day. Include all
   namespaces when comparing account-wide limits. Never export keys or values.
3. Integrate and test the indexed scheduler against the acquired source and API
   contract (see scheduler-design.md). Do not ship a stand-alone substitute.
4. Verify backup round trip and background push on a real installed iPhone PWA.
   A provider 201 is acceptance, not proof of handset delivery. Device access is
   absent; install/removal and data migration cannot be certified here.

These blockers leave Issue #5 open. Safe development checks are implemented;
minute-accurate production scheduler replacement and measured costs are pending.
