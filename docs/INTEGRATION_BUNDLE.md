# Integration Bundle: PRs #72 – #82

This document details the integration branch `integration/approval-bundle` combining PRs #72, #73, #74, #77, #78, #79, #80, #81, and #82 onto main (`d3a3fe184cbdd2cb879939cd263d2d312f373aae`).

> **Note:** PR #75 and PR #76 were excluded per instructions as their changes were superseded by combined PR #77.

## Merge Order & Head SHAs

In exact merge sequence:

1. **PR #72**: `7cecb8dff75daddc7a52cc4c14b56df3a22da5f4` (`fix/clemson-rides-domain`)
   - Title: point apps at clemson-rides.vercel.app
2. **PR #73**: `7ef9bf3787b3ae9bbccdbeae5fb5584113b09835` (`deputy/post71-auth-typecheck`)
   - Title: post-#71 auth doc cleanup, root typecheck, no-Clerk guard test
3. **PR #74**: `c7c9a83ad3684b2827b9cb693130760fee34e195` (`deputy/hold-expiry-hardening`)
   - Title: harden expire-unpaid-airport-holds for an external 15-minute cron
4. **PR #77**: `6e55a513aa3ce6336b1035ef0d41766b6040d711` (`deputy/tests-75-76-combined`)
   - Title: combine #75 heat tests + #76 notification-prefs tests (resolve package.json test-list conflict)
5. **PR #78**: `3da5d25d37312cd60401c7a9e7c26870111ded39` (`fix/rls-profiles-trips-recursion`)
   - Title: fix profiles/trips RLS recursion (already applied to live DB)
6. **PR #79**: `eba978f0572aa24029dca2bf6cf13b8a93bd7f10` (`deputy/vehicle-places-tests`)
   - Title: rides-native shared/vehicle.js + places.js unit tests (+ one small safe fix)
7. **PR #80**: `b56ce1e288febabe7c9e52c63f271edb561b7deb` (`deputy/hold-claim-atomic`)
   - Title: hold-expiry claim without the metadata read-modify-write race flagged in #74
8. **PR #81**: `8adb245a72ecbd26a84c49d8681a192a5e61c686` (`deputy/driverdesk-tests`)
   - Title: rides-native driverDesk.js unit tests (+ one small safe fix)
9. **PR #82**: `8e65db6a3935387b594d5a0876e006b9c02e3634` (`fix/service-role-key-notes`)
   - Title: log service role key fix + card brand / trip created_at migration

## Conflicted Files and Resolutions

### 1. `docs/FIXES.md`
- **Conflicts encountered during:** PR #73, PR #74, PR #78, PR #79, PR #80, PR #81, PR #82.
- **Resolution:** Retained all entries from both sides across all PR merges in chronological / reverse-chronological order with zero dropped notes, stripping all conflict markers.

### 2. `package.json`
- **Conflicts encountered during:** PR #77, PR #79, PR #81.
- **Resolution:** Reconciled the `"test"` script to maintain the strict union of all test files:
  1. Main's test suite in its original order (from `scripts/carpoolEngine.test.mjs` through `tests/ambassadorPayoutUnique.test.js`).
  2. Each PR's newly added test files in merge order:
     - PR #73: `tests/no*.test.js`
     - PR #77: `packages/rides-native/heat.test.js packages/rides-native/notificationPrefs.test.js`
     - PR #79: `packages/rides-native/shared/vehicle.test.js packages/rides-native/places.test.js`
     - PR #81: `packages/rides-native/driverDesk.test.js`
  3. Preserved scripts from all PRs, including `"typecheck": "node scripts/typecheck.mjs"` introduced in PR #73.

## Notable Items: Database Migrations (Included but NOT Applied)

The following database migrations are included in this bundle repository but **MUST NOT** be automatically applied to production until approved and ready for migration rollout:

1. **PR #78:**
   - `supabase/migrations/20260925015500_fix_profiles_trips_rls_recursion.sql`
   - *Note:* While the RLS policy fix was previously executed directly on the live Supabase database (`awktabuhijrshmsmagpq`) to unblock Apple sign-in recursion, this migration file is tracked in git for schema migration parity.

2. **PR #80:**
   - `supabase/migrations/20260925140000_hold_claim_atomic.sql`
   - *Note:* Adds `trips.hold_expire_claimed_at timestamptz` with partial index `trips_hold_expire_claimed_at_idx`, and security definer function `public.merge_trip_metadata(p_trip_id uuid, p_patch jsonb, ...)`. **Pre-ship requirement:** this migration MUST be applied to the database before the `/api/expire-unpaid-airport-holds` worker runs this code, or it will error with 500 when calling the RPC or column.

3. **PR #82:**
   - `supabase/migrations/20260925020500_card_brand_and_trip_created_at.sql`
   - *Note:* Adds `profiles.stripe_card_brand`, `profiles.stripe_card_last4`, and `trips.created_at`. Not yet applied to the database.

## Verification

- **Acceptance check:**
  - `git merge-base --is-ancestor` passes for all PR heads (72, 73, 74, 77, 78, 79, 80, 81, 82).
  - No merge conflict markers present across the entire tree (`git grep -nE '^(<<<<<<<|>>>>>>>)' -- .` exits cleanly).
  - `package.json` parses as valid JSON (`node -e 'JSON.parse(...)'`).
- **Test suite (`npm test`):**
  - All 536 tests passing across 19 suites, 0 failures.
- **Root typecheck (`npm run typecheck`):**
  - Both `apps/rider` and `apps/driver` pass TypeScript checking (`tsc --noEmit`), and all API/server scripts pass syntax checks (`node --check`).
