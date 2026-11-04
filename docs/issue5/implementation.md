> Yönetici devamı: [tek özel erişim engeli, risk takibi ve rollback kabul kapısı](remaining-private-work.md).
> [iPhone kontrol listesi](iphone-kontrol-listesi.md) yalnız okuma/dışa aktarım
> doğrulaması içindir; kurulum silme veya veri taşıma istemez.

> P4 follow-up: [private candidate patch and acceptance matrix](p4-private-patch-plan.md).
> An offline, hash-pinned single-statement remover is prepared; only synthetic
> fixtures have been patched/tested. Actual private-source validation is pending.

> Latest follow-up: [private PUT audit and aggregate metrics](put-audit-2026-11-03.md).
> Seven sites are now classified without transferring source; a per-tick metadata
> write path is identified. Aggregate telemetry is available again. The historical
> rate-limit/source findings below describe the earlier integration stage.
> No real-Worker patch, deployment or approved source import has been performed.

# Issues #4/#5: integrated development, production blocked

The user's latest instruction authorizes integrating safe work into `develop`
and preserving all history before deleting extra branches. It does not authorize
production deployment, changes to `main`, data migration, deletion of app data,
notification time changes or Cloudflare configuration changes.

## Integration

Original review heads are retained as ancestors of the develop integration:

| PR | Original head | Disposition |
| --- | --- | --- |
| #1 | `13a88491904e703398befb8e1a058b14804c3dc8` | Full history retained; independent D1 API/test files preserved as development-only; safe frontend history undo retained |
| #3 | `9b22c3e9f6cf0f86dec6def5970a379043b545fa` | MVP data safeguards, backup/XSS/offline tests and source staging integrated |
| #6 | `b30b260217aa2425cc4548878b56bae56bab9ee4` | PWA/cost/secret checks and per-tick PUT regression tests integrated |

All three are multi-parent merges, not squashes. PR #1 predates the current
approved layout; its older CSS/FAB/cache-version changes were not allowed to
revert the newer layout or PR #3 safeguards. Its original versions remain in
Git history. No separate API is deployed or automatically connected by this work.
No remote D1 schema or bindings changed. Every removed branch head must pass
`git merge-base --is-ancestor <head> develop` before deletion. The redundant
`codex/cloudflare-live-baseline` head is already the original develop/main base.
`main` remains `67e55a04e39101df2f51e833320d4af23b0a93a5`.

## Implemented and tested

- Both import commands now invoke the same stronger hash/provenance/path/secret
  gate. Missing real source still blocks readiness; no empty mock is substituted.
- Root `npm test` includes MVP safeguards, PR #1 API, Issue #5 checks and the local
  indexed queue. CI runs development tests on `develop`, with no deploy step.
- `cloudflare/push-queue/` contains a D1-compatible implementation and SQL schema
  for changed-only plan/device persistence, revision CAS, indexed due work,
  conditional leases, bounded retries/expiry and version-safe 404/410 cleanup.
  **It is not wired to the production scheduler.** See its README for caller
  responsibilities, actual local measurements, capacity and crash-window limits.
- 1, 2 and 100 owners each underwent 1,440 idle tick tests: 1,440 SELECTs,
  0 D1 write statements. Repeated unchanged sync writes nothing. KV operations are
  absent from this module. This is component evidence, not measured live KV usage.
- PWA manifest ID/start URL/scope and localStorage keys remain unchanged. SW shell
  cache matching now supports a subpath install and excludes API/auth/unrelated
  requests. Old application-owned caches are cleaned without deleting other caches
  or local data. SW/app versions advance together on the development branch only.
- Browser tests cover CRUD, taken/skip/undo, history, offline, backup round trip,
  XSS, corrupt storage and quota-error rollback. This is desktop Chromium evidence,
  not iPhone background delivery certification.
- PR #1's VAPID base64url escaping bug is fixed and verified with an actual
  generated ES256 signature, using a synthetic subscription and stubbed fetch.

## Current PUT incident and live evidence

The latest Issue #5 comment reports Cloudflare's quota email: daily free **KV PUT**
limit exceeded, with 429 writes. List quota is not the established incident.
The precise source of excessive writes has not been traced yet.

Read-only Cloudflare API findings on 2026-11-03:

- Worker `ilac-takip-mono-preview`, compatibility date `2026-10-01`, binding
  `PUSH_KV`, active cron `* * * * *` remain unchanged.
- Namespace inventory returned `ilac-takip-push-v1`. No keys/values were listed.
- Content aggregate scan: 48,619-character response; direct call sites list 1,
  get 8, put 7, delete 1; scheduled marker present. These are lexical counts, not
  dynamic execution counts, call graph analysis or confirmed heartbeat frequency.
- Build-trigger read still returns an undeleted trigger matching only `main`.
  Disabled status was not exposed. Do not update main or assume builds are off.
  Develop does not match that filter. No trigger setting was written.
- Full raw source return was rejected by automatic security review because narrow
  VAPID redaction could expose other secrets/private data. Only nonsecret summaries
  were returned subsequently. No raw Worker source, endpoints, keys or patient data
  is committed here.
- The attempted aggregate GraphQL operation query was rejected with `Rate limiter
  budget depleted` and a 5-minute retry instruction. No production operation series
  was obtained; an account quota email is incident evidence, not per-call telemetry.

## Verification and remaining gates

Run from root with Node 24:

```sh
npm ci --ignore-scripts
npm test
npm run check:secrets
npm run test:browser
npm run check:import
```

Browser tests require Playwright Chromium; local runs may use
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. The source command intentionally
exits 1 until reviewed source exists. CI source-import-gate stays separate and
blocked; do not rename this failure to a pass or remove skipped live scenarios.
Pattern scanning is defense in depth, not a complete secret/history audit.

Actual blockers for completing #4/#5:

1. A private, safely reviewed export of the deployed Worker with deployment ID,
   raw-source hash, all modules and sanitized-file inventory. Inspect each of the
   7 PUT sites and its call graph; eliminate per-minute metadata/heartbeat writes
   and unchanged sync writes, handle TTL renewal without silently expiring a live
   subscription, and never return success when persistence fails. The local queue
   needs a real authenticated API/scheduler mapping, unchanged timezone/DST policy,
   Web Push sender, migration/reconciliation and rollback testing before adoption.
2. Aggregated production operation counts by namespace/type/error/window, including
   sampling/truncation and the account's other KV usage, to verify the write source
   and the post-integration operation budget. Do not enumerate keys for telemetry.
3. Real installed iPhone testing with verified backup/restore, unchanged times,
   offline/update and actual background receipt. Never remove an old installation
   until the user has verified the backup and explicitly confirmed removal.

These issues remain open. Development integration and branch cleanup do not mean
that the active application's PUT incident or production readiness is solved.
