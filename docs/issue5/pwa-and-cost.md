# One PWA, data preservation and operation budget

## PWA audit and user-verified migration

No manifest or service worker identity was changed in this PR. MVP metadata is
`id=/ilac-takip`, `start_url=./index.html`, `scope=./`; this does not establish the
live Worker's identity. Inventory each installed icon's actual origin, resolved
manifest ID/start URL/scope, SW script URL/scope and cache version privately.
Compare metadata with `auditPwa()` in `scripts/issue5/pwa-audit.mjs`. Do not pass
patient records, subscription endpoints or credentials to the audit function.
Its result never authorizes uninstalling an application.

For an in-place update retain origin, manifest identity and SW registration scope.
Deploy only after the separate production approval/rollback process. Cache new
shell resources completely before activation; use versioned **application-owned**
cache names and delete only obsolete caches in that namespace. Do not clear
localStorage, IndexedDB or subscriptions on SW upgrade. Do not cache API/auth/push
responses. Audit actual live SW behavior before making any cache change; the MVP
SW currently deletes unrelated cache names on activation and is not approved as
a production replacement.

Different origins cannot automatically read each other's localStorage. An ID
change on the same origin can also create a second install; preserve the old ID
unless a reviewed browser-specific migration proves continuity.

Device procedure, not yet performed:

1. Keep both existing installs until their data is identified. In each app,
   export a backup to user-controlled private storage, with origin/date labels.
   Never attach that file to GitHub. Verify drugs, unchanged dose times, stock,
   taken/skipped records, history, settings and optional fields. Verify the live
   export format first; the MVP's version-2 format is not proof of compatibility.
2. Verify a restore with a copy in an isolated test context. Preserve unknown
   fields and raw source backup. Do not normalize/rewrite times or IDs during
   transfer. Invalid/unsupported backups must fail before any writes. Confirm
   replacement explicitly; retain an independently verified undo backup and
   handle quota/partial-write failure without destroying the previous state.
3. Select the canonical existing origin with the user. Import only after format
   and lossless mapping are tested; compare the complete data and notification
   schedule before/after. Conflicting records require a reviewed merge policy,
   never last-writer-wins by assumption. Retain source installation data.
4. On the canonical installed iPhone PWA, verify permission, existing/recreated
   subscription as applicable, multiple device behavior, offline reopen, SW
   update and background push while closed. Reusing a subscription across origins
   is not possible; preserve its original registration until the new one works.
5. Only after independent backup/restore and delivery verification, obtain explicit
   user confirmation to remove the obsolete installation. This work does not
   provide that confirmation and does not advise deleting an app now.

## Hypothetical KV cost model

Cloudflare pricing retrieved 2026-11-03:
https://developers.cloudflare.com/kv/platform/pricing/
Free daily limits: read 100,000; write, delete and list **each** 1,000. Reset is
00:00 UTC (03:00 Europe/Istanbul on this date); limits are account-wide and must
include other namespaces. These are distinct operation budgets.

Let U=users, D=devices/user, R=reminders/user/day, P=list pages/tick,
G=keys read/device/tick, W=writes/delivery including retries,
E=expired devices/day and S=schedule update key writes/day.

- Ticks/day = 1,440, unchanged.
- Delivery attempts modeled = U × D × R (increase W/read assumptions for retry work).
- KV list = 1,440 × P; KV read = 1,440 × U × D × G.
- KV write = U × D × R × W + S; KV delete = E.

This model deliberately exposes assumptions, not a claim about the live code.
Pagination, other API reads/writes, failed requests, retries, dedupe key writes,
retention deletes and background activity need their own measured additions.

| Hypothetical load (R=3, G=1, W=1, E=S=0, P=1) | Reads/day | Writes/day | Lists/day |
| --- | ---: | ---: | ---: |
| 1 user, 1 device | 1,440 | 3 | 1,440 |
| 10 users, 2 devices/user | 28,800 | 60 | 1,440 |
| 100 users, 2 devices/user | 288,000 | 600 | 1,440 |

Even zero users would exceed the list limit if a single list executes each tick.
This conditional statement is not a measured root cause. The D1 indexed design
has zero scheduler KV operations only after integration removes all relevant KV
calls; D1 reads/writes, storage, retries and Worker execution have their own cost
budgets and must be measured. Setting model parameters to zero does not prove it.

Example local calculation (does not contact Cloudflare):

```sh
node --input-type=module -e 'import {estimateDaily} from "./scripts/issue5/kv-cost.mjs"; console.log(estimateDaily({users:10,devicesPerUser:2,remindersPerUser:3}))'
```

For actual evidence retain only namespace/operation/time-window aggregate counts
and errors, plus sampling/truncation metadata. Report partial-day counts as partial;
do not label extrapolations as observed daily usage. Compare before/after at equal
loads and windows. Do not query KV.list just to measure usage: use analytics.
