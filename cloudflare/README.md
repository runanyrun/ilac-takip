# Cloudflare D1 backend foundation

The production Cloudflare D1 database `ilac-takip-db` was created in the existing Cloudflare account, EU jurisdiction, and schema v1 applied. This directory tracks the schema in source control.

## Status
- Database and six application tables created and verified.
- A staged Worker (`ilac-takip-api`) with health and authenticated medication routes is deployed at `https://ilac-takip-api.runanyrun.workers.dev/api/health` with D1 binding `DB`. Registration remains disabled because `REGISTRATION_SECRET` has not been configured. The browser frontend is not integrated and no browser data has been uploaded.
- Existing GitHub Pages frontend continues using browser `localStorage`; do not delete or overwrite it.
- Other Cloudflare Workers are unrelated and must not be modified.
- D1 UUID is `caf7a440-cf3c-40f7-aba5-af1c86f04fa9`. This is a resource identifier, not a secret.

## Safe rollout plan
1. Implement an authenticated Worker API. Each read/write must derive user ID from a verified session, not a caller-supplied ID. Add rate limiting, strict CORS for the production origin, validation and per-user authorization.
2. Implement explicit, consent-based import of existing localStorage medications and history with idempotent writes and a rollback/backup option. Never clear localStorage as part of initial sync.
3. Create a VAPID keypair securely. Keep private key as Worker secret; expose only public key. Register Web Push subscriptions with authenticated users.
4. Use UTC timestamps for due occurrences and timezone-aware conversion of local medication times; use an indexed due-work queue, deduplication and retry controls. Respect Cloudflare Free Cron and request quotas.
5. Sync ALDIM acknowledgments from clients and never equate 'not acknowledged' with 'not taken'. Test Android and installed iOS Home Screen PWA separately.
6. Test end-to-end before enabling push for real users. Browser push is best-effort and is not a sole safety-critical medication alarm.

## Schema
`schema.sql` is the versioned schema. Avoid putting medication data, VAPID private keys or credentials in this repository. D1 backups and migration procedures must be defined before importing real user records.

## Current API safety gates
- `GET /api/health` checks D1.
- `POST /api/devices` requires a server-side registration secret and is disabled until securely configured. Do not embed this secret in public frontend code.
- `GET /api/medications` and `POST /api/medications` require a per-device bearer token; user ownership is derived from its SHA-256 digest in D1.
- Browser CORS is restricted to `https://runanyrun.github.io`. Browser access alone is not authentication.
- Real registration needs a secure invite/identity and abuse-control design; never expose the registration secret to public clients.
- Production sync, history import, push dispatch, recovery, rate limiting, and live end-to-end testing are still pending.

## Backup safety work (feature branch only)
The frontend's JSON export now includes medication history, and importing a backup first asks for confirmation and downloads an undo backup. Legacy backups without `history` remain supported without erasing existing history. Import is still a replacement, not a cloud sync or merge. These changes are **not live** until the draft PR is reviewed and merged; test with sample records and verify the undo download before rollout.

## Medication API caveats (2026-11-01)
- The Worker is deployed with a fixed registration gate; public device signup remains disabled. Existing bearer credentials would be checked independently of signup configuration.
- Medication IDs are stored with a user-specific prefix to prevent collisions across accounts; GET returns the original client-facing ID and scheduled times.
- The current API is **not a lossless backup format**: frontend drug records also contain stock, photo, doctor, hospital, start date, duration, days and alarm flags, and history is separate. Do not automatically upload/replace localStorage with this API until the schema and round-trip mapping preserve all fields.
- The Cloudflare upload API reported success. Independent HTTP smoke test and authenticated integration tests are pending.
