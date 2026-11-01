# Cloudflare D1 backend foundation

The production Cloudflare D1 database `ilac-takip-db` was created in the existing Cloudflare account, EU jurisdiction, and schema v1 applied. This directory tracks the schema in source control.

## Status
- Database and six application tables created and verified.
- A read-only health Worker (`ilac-takip-api`) is deployed at `https://ilac-takip-api.runanyrun.workers.dev/api/health` with D1 binding `DB`. No authenticated data API has been deployed. No browser data has been uploaded.
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
