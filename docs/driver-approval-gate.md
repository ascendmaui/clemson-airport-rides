# Driver approval gate map

Inventory of every path that offers a trip to a driver, matches or assigns a driver, notifies a driver about a trip, or lets a driver accept. This document does not change behavior.

**Rule intended by product:** only a driver with `driver_applications.onboarding_status = 'approved'` may receive or accept rides. Admins (`public.is_admin()` in SQL; `loadStaffAccess` in `server/staffAccess.js`) are the only planned exception.

**Shared predicate today:** `canReceiveRides(status)` in `shared/driverOnboarding.js` is `status === 'approved'`. It does not treat admin/staff as approved. `server/driverApproval.js` re-exports it and wraps the DB lookup as `driverApprovalStatus(sb, profileId)`. As of t2, `driverApprovalStatus` and `receivableDriverIds` also allow a profile when `loadStaffAccess` says they are admin or support. `receivableDriverIds` reads `driver_applications` once for the whole candidate list.

**Statuses** (`shared/driverOnboarding.js` `ONBOARDING_STATUSES`): `pending_info`, `pending_docs`, `pending_review` (UI: under review), `approved`, `rejected`. Missing application row is treated as not approved.

## How to read the table

| Checks approval today? | Meaning |
| --- | --- |
| yes | This path itself reads `onboarding_status` / `canReceiveRides` / `driver_is_approved` / `list_approved_driver_ids` before offering, assigning, notifying, or accepting. |
| no | This path does not read approval. An unapproved driver can reach it if they already have a `driver_status` row, `profiles.role = driver`, or a leftover `online = true`. |
| sql-only | JavaScript does not check. A Postgres trigger/function in `supabase/driver_onboarding_approval.sql` would, **if that file is applied**. It is not a dated file under `supabase/migrations/`. |
| n/a | Does not assign or offer to a driver. |

Admin exception: **not implemented** on `canReceiveRides` or `public.driver_is_approved(uid)`. As of t2, `driverApprovalStatus` and `receivableDriverIds` do allow admin/staff via `loadStaffAccess`. An admin without `onboarding_status = 'approved'` is still not approved by the SQL helper.

---

## Inventory

| # | Path | Kind | Checks approval today? | Notes |
| --- | --- | --- | --- | --- |
| 1 | `packages/rides-native/drivers.js` `fetchOnlineDrivers` | offer (rider picker) | yes | Filters `driver_status.online = true` through RPC `list_approved_driver_ids`, then one `driver_applications` read drops any id whose `onboarding_status` is not `approved`. Unapproved ids never become `visibleIds`. |
| 2 | `packages/rides-native/drivers.js` `fetchDriversByIds` | offer (saved drivers) | yes | Same RPC plus the same application-row drop. Unapproved favorites are omitted. |
| 3 | `src/lib/supabase.js` `fetchOnlineDrivers` | offer | yes | Delegates to (1). |
| 4 | `packages/rides-native/drivers.js` `setDriverOnline` | presence (enables claims) | yes | Going online requires `onboarding_status === 'approved'`. Going offline skips the gate. |
| 5 | `src/lib/supabase.js` `setDriverOnline` | presence | yes | Same check; web copy differs (`Admin approval is required…`). |
| 6 | `packages/rides-native/driverDesk.js` `acceptTrip` | accept | yes | Reads `driver_applications.onboarding_status`. Synthetic ids are rejected with the same copy. No admin bypass. |
| 7 | `apps/driver/app/(tabs)/index.tsx` `onAccept` / `toggle` | offer UI + accept + presence | yes | Real offers only when `status === 'approved'`. Pending review sees `syntheticOffers()` only. Accept and Go Online both refuse if not approved. |
| 8 | `src/screens/DriverHome.jsx` offer load / `acceptOffer` | offer UI + accept | yes | Open-pool query and Realtime subscribe run only when approved. Unapproved with no live trip renders `DriverApprovalGate`. |
| 9 | `server/friendRideRoutes.js` `handleFriendRideCreate` | match (student-driver carpool) | yes | `kind === 'carpool'` calls `driverApprovalStatus`. Friends-only creates skip this gate. |
| 10 | `server/friendRideLib.js` `maybeBookFriendRide` | match / assign | yes | If a driver is assigned at book time, `driverApprovalStatus` must be approved or the book returns `driver_not_approved`. Marketplace carpools with no `driver_profile_id` skip the check and insert `status: searching`. |
| 11 | SQL `public.driver_is_approved(uid)` | helper | yes | `onboarding_status = 'approved'` only. Defined in `supabase/driver_onboarding_approval.sql`. No `is_admin()` or. |
| 12 | SQL `public.list_approved_driver_ids(ids)` | helper | yes | Same file. Used by (1)(2). |
| 13 | SQL `enforce_driver_online_approval` / trigger `driver_status_require_approval` | presence | sql-only | Blocks `driver_status.online = true` unless `driver_is_approved`. Does not flip an existing `online = true` row when onboarding later changes. |
| 14 | SQL `enforce_trip_approved_driver` / trigger `trips_require_approved_driver` | accept / assign | sql-only | On insert (non-canceled with `driver_id`) or on assign / searching\|offered → accepted. No admin bypass. Not in `supabase/migrations/`. |
| 15 | `packages/rides-native/driverDesk.js` `loadDriverDesk` | offer | yes | Open-pool and unassigned scheduled rows are omitted unless `onboarding_status` is `approved`. The result includes `approvalGate` (the existing approval-gate copy). Already-accepted live trips still load. No admin bypass on this client query. |
| 16 | `apps/driver/app/queue.tsx` | offer UI + notify-adjacent | no (list) / yes (accept) | Always calls `loadDriverDesk`. Pending review **merges real desk offers with synthetic cards**. Accept goes through `acceptTrip` (6). |
| 17 | `apps/driver/app/(tabs)/index.tsx` `notifyNewRequest` effect | notify | no | Fires on `desk.offers` for approved **and** `pending_review` (desk is loaded for both). Filters out synthetic ids, so a pending-review driver can get a local Expo ping for a real open-pool row. |
| 18 | `src/screens/DriverHome.jsx` `loadScheduled` / toasts | offer + notify | no | Runs whenever `driverId` is set, including before / behind the approval gate. New scheduled rows toast `New scheduled ride`. Accept UI is behind the gate unless an `activeTrip` already exists. |
| 19 | `src/screens/DriverHome.jsx` `acceptScheduled` | accept | no | Calls `acceptScheduledTrip` RPC with no `onboarding_status` check. Relies on (8) hiding the queue, or on (21) once that migration is applied. |
| 20 | `src/lib/scheduledRides.js` `listOpenScheduledTrips` / `acceptScheduledTrip` | offer + accept | no | List uses RLS (22). Accept is `rpc('accept_scheduled_trip')` only. The RPC body in (21) is the approval gate after John applies it. |
| 21 | SQL `accept_scheduled_trip(p_trip_id)` | accept | no (file written, not applied) | Live body is still `supabase/migrations/20260924233000_block_unpaid_airport_deposit_accept.sql`: role `driver` or `admin`, plus the unpaid-deposit check. `supabase/migrations/20260925120000_driver_approval_accept_gate.sql` replaces the function and calls `assert_driver_may_accept` after that deposit check. NOT APPLIED. |
| 22 | SQL `trips_driver_scheduled_select` | offer (RLS) | no | Open scheduled rows are visible to `is_driver_or_admin_role()` (`profiles.role` driver or admin). Approval is not in the policy. Latest: `supabase/migrations/20260925015500_fix_profiles_trips_rls_recursion.sql`. |
| 23 | SQL `trips_online_driver_claim` | accept (RLS) | no | UPDATE of `searching`/`offered` with null `driver_id` allowed when `driver_status.online = true`. No `onboarding_status` clause. `supabase/driver_alerts_queue_tips.sql`. |
| 24 | SQL `trip_update_is_accept` / `block_unpaid_airport_deposit_accept` | accept (trigger) | no (approval file written, not applied) | Deposit trigger is unchanged and still applied. `trips_block_unapproved_driver_accept` in `supabase/migrations/20260925120000_driver_approval_accept_gate.sql` calls `assert_driver_may_accept` on the same accept predicate. NOT APPLIED. Until then a direct UPDATE can still claim. |
| 25 | `src/lib/driverOffers.js` `claimTrip` | accept | no | Direct `trips.update` to accepted. No application lookup. Not referenced by current screens (dead client helper). Would hit (24) after that migration is applied. |
| 26 | `server/endpoints/requestDriverTrip.js` | match / assign | yes | `receivableDriverIds` before insert. Unapproved preferred drivers return `driver_not_approved`. Staff/admin still assign. |
| 27 | `server/endpoints/scheduleTrip.js` | match | n/a | Inserts `scheduled` or `searching` with `driver_id` null. Later claimed via open pool / scheduled RPC. |
| 28 | `server/endpoints/tripOfferPreview.js` | offer preview | yes | Open `searching`/`offered` (and any not-yet-accepted assignment) requires `receivableDriverIds`. Response is the approval-gate copy with `driver_not_approved`. A trip already `accepted` / `arriving` / `arrived` / `in_progress` / `completed` for this driver still previews. |
| 29 | `src/lib/driverOffers.js` `fetchOfferPreview` | offer preview | no | Calls `/api/driver?action=offer-preview` (28). |
| 30 | `server/carpoolService.js` `matchRider` / `handleCarpoolMatch` | match (riders) | n/a | Rider-to-rider marketplace. No driver assigned. Booked trip is `searching` for the open pool. |
| 31 | `server/carpoolService.js` `createGroupRide` (`driving: true`) | match | yes | `receivableDriverIds` before insert. Unapproved drivers get `driver_not_approved` and no `driver_profile_id`. Marketplace creates (`driving: false`) still assign no driver. |
| 32 | `packages/rides-native/driverDesk.js` `publishDriverLocation` | presence | no | Upserts `driver_status.online` (default true). No application lookup. SQL (13) would reject unapproved online if applied. |
| 33 | `src/lib/driverTrack.js` `publishDriverLocation` | presence | no | Same as (32) for web. |
| 34 | `apps/driver/app/trip.tsx` location watch | presence | no | Calls (32) with `online: true` while a live trip is open, even if onboarding later flipped. |
| 35 | `packages/rides-native/driverDesk.js` `setPriorityMode` | presence | no | Upserts `driver_status` without touching approval. Leaves a pre-existing `online = true` in place. |
| 36 | `apps/driver/lib/push.ts` `registerDriverPush` | notify setup | no | Upserts `driver_status.expo_push_token` or `driver_push_tokens`. No approval check. **No server Expo fan-out exists** in this repo. |
| 37 | `apps/mobile/app/(tabs)/driver.tsx` | notify | no | Polls `trips` in `searching`/`offered` and plays `alertNewRide`. No application lookup. |
| 38 | `packages/rides-native/syntheticOffers.js` | offer (demo) | n/a | Cards with `isSynthetic: true` for pending-review UI. `acceptTrip` refuses them. Not dispatch. |
| 39 | `packages/rides-native/tripTags.js` | copy | n/a | Labels, `acceptNeedsDriverOnline`, unpaid-deposit copy. Does not gate approval. |
| 40 | SQL `review_driver_application` | admin | partial | Reject sets `driver_status.online = false`. Approve does not require the driver to be admin. Does not by itself prevent a later client upsert from turning online back on except via (13). |

---

## Presence leak (why offers still reach unapproved drivers)

Going online is gated in the native/web helpers (4)(5) and, if applied, in SQL (13). That is not enough:

1. A `driver_status` row with `online = true` can be written **before** the application exists, or survive a later `pending_review` / `rejected` change. Reject handling (40) turns online off; other status writes do not.
2. `publishDriverLocation` (32)(33)(34) upserts `online: true` with no JS approval check.
3. Open-pool claim RLS (23) keys off `driver_status.online`, not `onboarding_status`.
4. Native open-pool load (15) now drops those rows for an unapproved driver, so the queue (16) no longer merges real open-pool cards during `pending_review`. Web scheduled list (18) and scheduled-select RLS (22) still do not re-check approval.
5. Preferred-driver assign (26) now re-checks approval on the server, including staff.
6. Accept UPDATE and `accept_scheduled_trip` stay open until John applies `supabase/migrations/20260925120000_driver_approval_accept_gate.sql`. That file is in the repo and is not applied.

`loadDriverDesk` still returns an already-accepted trip. The native home still subscribes to `trips` Realtime for `pending_review`, but `desk.offers` is empty unless the driver is approved, so (17) no longer pings a real open-pool row.

---

## SQL vs JS

| Mechanism | File | Applied as dated migration? |
| --- | --- | --- |
| `driver_is_approved`, `list_approved_driver_ids`, `enforce_driver_online_approval`, `enforce_trip_approved_driver`, `review_driver_application` | `supabase/driver_onboarding_approval.sql` | no |
| Function bodies only (no `CREATE TRIGGER`) | `supabase/driver_pending_approval.sql` | no |
| `accept_scheduled_trip` + unpaid-deposit accept trigger | `supabase/migrations/20260924233000_block_unpaid_airport_deposit_accept.sql` | yes |
| `assert_driver_may_accept`, `trips_block_unapproved_driver_accept`, replaced `accept_scheduled_trip` (deposit check kept) | `supabase/migrations/20260925120000_driver_approval_accept_gate.sql` | no — written, NOT APPLIED. Version prefix clashes with `20260925120000_ambassador_payout_unique.sql`. |
| `trips_driver_scheduled_select` | `supabase/migrations/20260925015500_fix_profiles_trips_rls_recursion.sql` | yes |
| `trips_online_driver_claim` | `supabase/driver_alerts_queue_tips.sql` | no dated migration in this tree |

Client `fetchOnlineDrivers` already depends on `list_approved_driver_ids`. If that RPC is missing, the picker errors rather than showing unapproved drivers.

---

## Admin exception (intended, not wired)

- SQL: `public.is_admin()` (`supabase/driver_onboarding_approval.sql`, replaced in `supabase/migrations/20260924190000_admin_support.sql`).
- Server staff: `loadStaffAccess` in `server/staffAccess.js` (`isAdminIdentity` + `admin_users.access_role`).
- `accept_scheduled_trip` on the live database allows `profiles.role = 'admin'` without onboarding, which is a role check, not `is_admin()`. The unapplied t3 migration adds `public.is_admin()` as the accept exception (`assert_driver_may_accept`).
- `canReceiveRides` / `driver_is_approved` do **not** or-in admin. `driverApprovalStatus` and `receivableDriverIds` do, via `loadStaffAccess`.

---

## Tests for this map

`server/driverApproval.test.js` pins `canReceiveRides` for every `ONBOARDING_STATUSES` value plus `null` / `undefined` / garbage, and `driverApprovalStatus` against a fake `sb` (approved, `pending_review`, missing row, DB error, admin exception). t2 adds fake-sb coverage that a `pending_review` driver is skipped on preferred assign, offer preview, and driving carpool create, while an approved driver is not. `packages/rides-native/drivers.test.js` covers the online list and open-pool desk the same way.
