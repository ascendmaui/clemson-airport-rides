# Build & blocker fixes log

Persistent knowledge base for recurring failures. When a matching issue appears, apply the saved fix first.
## 2026-09-25 — Wire offerCard unit tests into npm test [t3]

- **Date:** 2026-09-25
- **Track / machine:** Clemson RIDES DRIVER · worktree `deputy-pkg-driver-offer-card-polish`
- **What was wrong:** `packages/rides-native/offerCard.test.js` was not listed in the `package.json` `test` script, so `npm test` did not execute the driver offer card view-model and accessibility test suite.
- **What changed:** Appended `packages/rides-native/offerCard.test.js` as the last entry of the `test` script in `package.json`. No existing entries were altered.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`
- **Verified:** `npm test` runs 803 tests across all suites (including 10/10 in `packages/rides-native/offerCard.test.js`) with 0 failures.

## 2026-09-25 — Refactor driver offer card UI with safe area insets and accessibility polish [t2]

- **Track / machine:** Clemson RIDES DRIVER · worktree `deputy-pkg-driver-offer-card-polish`
- **What was wrong:** Driver offer card UI in `apps/driver/app/(tabs)/index.tsx` was directly formatting raw card fields, lacked structured accessibility descriptions for assistive technologies, had a cramped Decline touch target (< 44pt), lacked explicit button accessibility roles and labels, and did not take advantage of the unified `offerCardViewModel`.
- **What changed:**
  - Integrated `offerCardViewModel` into `RideCard` in `apps/driver/app/(tabs)/index.tsx`, making net pay the primary prominent number with net label and subtext.
  - Added `offerAccessibilityLabel` in `packages/rides-native/offerCard.js` (and exported in `offerCard.d.ts` and tested in `offerCard.test.js`) providing a combined offer summary for assistive tech.
  - Applied `accessibilityRole="summary"` and `accessibilityLabel={vm.accessibilityLabel}` to the offer card.
  - Upgraded Accept (`Primary`) and Decline buttons with `accessibilityRole="button"`, descriptive `accessibilityLabel`s, and guaranteed minimum 44pt touch targets (`minHeight: 48` on `Primary`, `minHeight: 44` on `decline`).
  - Preserved safe area insets via `useSafeAreaInsets` (`dockTop = insets.top + 8` and `bottom: insets.bottom + 72`) ensuring the card never overlaps the status bar or the tab bar.
  - Left accept and decline logic unchanged.
- **Files touched:**
  - `apps/driver/app/(tabs)/index.tsx`
  - `apps/driver/components/chrome.tsx`
  - `packages/rides-native/offerCard.js`
  - `packages/rides-native/offerCard.d.ts`
  - `packages/rides-native/offerCard.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/offerCard.test.js` (10/10 pass, 0 fail); full suite `npm test` (793/793 pass, 0 fail).

## 2026-09-25 — Extract offerCard view-model helpers and tests

- **Track / machine:** Clemson RIDES DRIVER · worktree `deputy-pkg-driver-offer-card-polish`
- **What was wrong:** Driver offer card formatting logic was inline in `apps/driver/app/(tabs)/index.tsx`, making presentation logic hard to unit test and inconsistent across Home, Queue, and other driver views.
- **What changed:** Extracted pure formatting and view-model helpers into `packages/rides-native/offerCard.js` (with TypeScript definitions in `packages/rides-native/offerCard.d.ts` and test suite in `packages/rides-native/offerCard.test.js`). Includes pickup/dropoff short label normalization (airports, street addresses, bullets, fallbacks), driver net earnings (reusing `fareCollection`, `driverNetCents`, `formatCents` without inventing numbers), distance/ETA text, seats, airport/deposit badges, time-left-to-accept countdowns, and a unified `offerCardViewModel`.
- **Files touched:**
  - `packages/rides-native/offerCard.js`
  - `packages/rides-native/offerCard.d.ts`
  - `packages/rides-native/offerCard.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/offerCard.test.js` (9/9 pass, 0 fail).

## 2026-09-25 — Expiry cron wired: CRON_SECRET + Supabase pg_cron/pg_net; prod redeployed at 111c607

- **Track / machine:** Clemson RIDES · I9 (61b11c89) Vercel CLI + Supabase awktabuhijrshmsmagpq · approved by John 1:05 AM ET 9/25.
- **Problem:** Nothing called `/api/expire-unpaid-airport-holds`, and `CRON_SECRET` was unset in production, so the handler fell back to accepting `x-vercel-cron: 1`.
- **Fix:**
  - A random 64-hex `CRON_SECRET` is set on clemson-rides **Production** as a Sensitive value. It is not set on Preview because only prod is called.
  - The same value is in Supabase Vault as `clemson_cron_secret`, added with `vault.create_secret`. It is not in any migration, not in `cron.job`, and not in the repo.
  - Migration `20260925160000_expire_holds_pg_cron.sql` enables pg_cron + pg_net and adds `private.trigger_expire_unpaid_airport_holds()` (SECURITY DEFINER, not executable by anon/authenticated). The function reads the Vault secret and `net.http_get`s the route with `Authorization: Bearer …`. The migration also schedules cron job `expire-unpaid-airport-holds` at `7,22,37,52 * * * *` (UTC, so the same minutes in ET).
  - Production redeployed from 111c607 (`clemson-rides-fw2ho37ak`, READY 1:06:50 AM ET), which puts #94–#97 live.
- **Verified:** `x-vercel-cron: 1` without a bearer → 401; a wrong bearer → 401; the real bearer with `?dry_run=1` → 200 `wouldExpire: 2, skipped: 1`.
- **Side effect:** with `CRON_SECRET` set, the daily Vercel cron `/api/driver-payouts` (12:00 UTC) now runs payout retries instead of returning `skipped`. There were 0 pending payouts when it was switched on.
- **Rotate:** `vercel env rm CRON_SECRET production` + `vercel env add CRON_SECRET production --sensitive` (value from stdin), then `select vault.update_secret((select id from vault.secrets where name='clemson_cron_secret'), '<new>')`, then redeploy.
- **Inspect runs:** `select * from cron.job_run_details order by start_time desc limit 5;` and `select id, status_code, left(content, 300) from net._http_response order by created desc limit 5;`

## 2026-09-25 — wire apiClient + carpoolApi tests; sweep stale checkout domain [t3]

- **Track / machine:** Deputy · pkg-domain-tests-92-93 t3 · deputy/domain-tests-92-93
- **What was wrong:** Draft PRs #92 (`origin/deputy/api-client-tests`) and #93 (`origin/deputy/carpool-api-tests`) were skipped because they still expected `https://clemson-airport-rides.vercel.app`. The replacement suites landed on this branch (`packages/rides-native/apiClient.test.js`, `packages/rides-native/shared/carpoolApi.test.js`) but were not listed in the root `npm test` script. `packages/rides-native/checkoutReturn.test.js` was already listed and still built fixture URLs on the old host. Production checkout returns use `NATIVE_CHECKOUT_ORIGIN` (`WEB_ORIGIN` in `shared/productLinks.js`, `https://clemson-rides.vercel.app`).
- **What changed:** This package supersedes #92 and #93. Both replacement test files are appended to the `test` script. Checkout-return fixtures now use `NATIVE_CHECKOUT_ORIGIN` and assert that origin is `https://clemson-rides.vercel.app`. No production source file still hardcodes `clemson-airport-rides.vercel.app`, so `shared/productLinks.js` was not changed. `apps/mobile/app/(tabs)/schedule.tsx` still inlines the current `https://clemson-rides.vercel.app` fallback; that is the live origin, not the old host.
- **Files touched:**
  - `package.json`
  - `packages/rides-native/checkoutReturn.test.js`
  - `docs/FIXES.md`
- **Verified:** `npm test` (836 pass, 0 fail), including `packages/rides-native/checkoutReturn.test.js`, `packages/rides-native/apiClient.test.js`, and `packages/rides-native/shared/carpoolApi.test.js`.

## 2026-09-25 — carpoolApi tests on clemson-rides.vercel.app [t2]

- **Track / machine:** Deputy · pkg-domain-tests-92-93 t2 · deputy/domain-tests-92-93
- **What was wrong:** `packages/rides-native/shared/carpoolApi.test.js` from draft PR #93 (`origin/deputy/carpool-api-tests`) still expected `https://clemson-airport-rides.vercel.app`, and its non-OK cases expected the old inline client (`HTTP 500`, `HTTP 503`, `API unavailable` on an HTML 502). `setCarpoolApiBase` on main still used `.replace(/\/$/, '')`, so an override with two or more trailing slashes kept a leftover slash and joined a bad URL. That one-line `/\/+$/` fix from the draft branch was not on main.
- **What changed:** Brought the test file onto this branch. The default host now comes from `DEFAULT_API_BASE` in `packages/rides-native/apiOrigin.js` (`https://clemson-rides.vercel.app`). 500/502 assertions follow `friendlyApiError` generic copy; 503 follows the unavailable copy. `apiErrorMessage` on a non-JSON 502 still returns the raw HTML stored on `payload.message` when the friendly kind is not auth or unavailable. `setCarpoolApiBase` now strips every trailing slash.
- **Files touched:**
  - `packages/rides-native/shared/carpoolApi.js`
  - `packages/rides-native/shared/carpoolApi.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/shared/carpoolApi.test.js` (13/13 passing).

## 2026-09-25 — apiClient tests expect clemson-rides.vercel.app [t1]

- **Track / machine:** Deputy · pkg-domain-tests-92-93 t1 · deputy/domain-tests-92-93
- **What was wrong:** The apiClient tests brought over from draft PR #92 still expected `https://clemson-airport-rides.vercel.app`. One case hardcoded the joined URL as `vercel.appapi/trips` against that old host. Other assertions described the pre-#90 client: raw server messages, `getSession` errors thrown out of `authedJson`, a missing `getSession` throwing `TypeError`, and `JSON.stringify` failures wrapped as network errors. The `getSession` cases called live `fetch` because nothing was mocked.
- **What changed:** Expected bases now come from `DEFAULT_API_BASE` in `packages/rides-native/apiOrigin.js` (`https://clemson-rides.vercel.app`, the `WEB_ORIGIN` `apiClient.js` uses when `EXPO_PUBLIC_API_BASE` is unset). A path with no leading slash is asserted as `` `${apiBase()}${path}` ``, which is the real join. Error assertions follow `friendlyApiError` (auth copy on 401, unavailable copy on 503, generic copy on 422/500/502). `getSession` failures and a supabase object with no `getSession` continue without a token, against a fake fetch. A circular body throws `TypeError` before fetch. Production source was not changed.
- **Files touched:**
  - `packages/rides-native/apiClient.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/apiClient.test.js` (30/30 passing).

## 2026-09-25 — wire driverGateView tests into npm test (pkg-driver-pending-ux t3)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-driver-pending-ux · pkg-driver-pending-ux t3
- **Problem:** `packages/rides-native/driverGateView.test.js` was created to validate driver approval gate capabilities and status view copy across onboarding states, but was not wired into root `package.json`'s `test` script, so `npm test` omitted the suite during standard runs.
- **Fix:** Appended `packages/rides-native/driverGateView.test.js` as the last entry of the `test` script in `package.json`.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`
- **Verified:** `npm test` (803/803 passing, including all 10 tests in `packages/rides-native/driverGateView.test.js`).

## 2026-09-25 — driver home/queue respect approval status (pkg-driver-pending-ux t2)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-driver-pending-ux · pkg-driver-pending-ux t2
- **Problem:** Drivers whose onboarding status is pending_review, pending_info, pending_docs, or rejected saw confusing offer cards or queue lists on driver home and queue screens, and the Go online toggle was not disabled with the reason. Screens also lacked next steps guidance and pull-to-refresh re-reading of the application status.
- **Fix:**
  - Created `apps/driver/components/DriverStatusCard.tsx` rendering application status copy from `driverGateView`, an accessible "Next steps" section covering finish info, upload documents, wait for review, and contact support, along with primary action and refresh capability.
  - Enhanced `GoButton` in `apps/driver/components/shell.tsx` with `disabled` and `disabledReason` props, supplying accessible labels (`accessibilityRole="button"`, `accessibilityState={{ disabled }}`, `accessibilityLabel="Go online disabled: ..."`) and disabled visual styling.
  - Updated `apps/driver/app/(tabs)/index.tsx` to derive status with `driverGateView`, hide offer cards when `!canSeeOffers`, disable `GoButton` with reason, show `DriverStatusCard` in the dock inside a pull-to-refresh `ScrollView`, and update `statusLine`.
  - Updated `apps/driver/app/queue.tsx` to hide queue list and filters when `!canSeeOffers`, render `DriverStatusCard`, and provide `RefreshControl` on the queue scroll view to re-read the driver application status.
- **Files touched:**
  - `apps/driver/components/DriverStatusCard.tsx`
  - `apps/driver/components/shell.tsx`
  - `apps/driver/app/(tabs)/index.tsx`
  - `apps/driver/app/queue.tsx`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/driverGateView.test.js` (10/10 pass), `npm run --prefix apps/driver typecheck` (clean pass), and `npm test` (793/793 pass).

## 2026-09-25 — driverGateView helper + tests (pkg-driver-pending-ux t1)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-driver-pending-ux · pkg-driver-pending-ux t1
- **Problem:** Drivers whose `driver_applications.onboarding_status` is pending_review, pending_info, or rejected saw a confusing home screen and queue states where offer/queue UI rendered despite not being approved. A shared client-side helper was missing to compute driver gate capabilities (`canGoOnline`, `canSeeOffers`), card titles, bodies, and primary actions for all onboarding statuses.
- **Fix:** Added `packages/rides-native/driverGateView.js` implementing `driverGateView(onboardingStatus, { rejectionReason, missingItems })` returning `{ canGoOnline, canSeeOffers, title, body, primaryAction }` for all `ONBOARDING_STATUSES` (+ null), strictly restricting `canGoOnline` and `canSeeOffers` to `approved` status, and reusing `APPROVAL_GATE` copy from `syntheticOffers.js` / `driverDesk.js`. Added unit tests covering all statuses and options in `packages/rides-native/driverGateView.test.js` and TypeScript types in `packages/rides-native/driverGateView.d.ts`.
- **Files touched:**
  - `packages/rides-native/driverGateView.js`
  - `packages/rides-native/driverGateView.d.ts`
  - `packages/rides-native/driverGateView.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/driverGateView.test.js` (10/10 passing) and `npm run typecheck` (passing).


## 2026-09-25 — Wire driver a11y scan into test script and record offender counts [t3]

- **Track / machine:** Clemson RIDES DRIVER · deputy/driver-a11y · pkg-driver-a11y t3
- **What was wrong:** `tests/a11yDriver.test.js` was created and verified against driver screens and components, but was not wired into the root `package.json` `"test"` script, meaning `npm test` would not automatically execute the driver accessibility scanner during standard CI/test runs.
- **What changed:**
  - Appended `tests/a11yDriver.test.js` to the `"test"` script in `package.json`.
  - Recorded driver a11y offender counts:
    - **Before remediation (t1 baseline):** 51 touchable / image accessibility offenders detected across `apps/driver/app` and `apps/driver/components`.
    - **After remediation (t2 fixes):** 9 remaining offenders (42 touchables fixed across core driver flows including sign-in/account, onboarding, home online toggle/controls, queue, live trip navigation, and earnings).
    - **Remaining offenders allowlist (9):** `apps/driver/app/(tabs)/discover.tsx:83`, `apps/driver/app/(tabs)/inbox.tsx:200`, `apps/driver/app/(tabs)/index.tsx:664` (home offer card decline button preserved for concurrent package `pkg-driver-offer-card-polish`), `apps/driver/app/bug-report.tsx:81`, `apps/driver/app/bug-report.tsx:90`, `apps/driver/app/fleet.tsx:98`, `apps/driver/app/fleet.tsx:102`, `apps/driver/app/learning.tsx:166`, `apps/driver/app/settings/[section].tsx:163`.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`

## 2026-09-25 — Fix core driver flow accessibility offenders [t2]

- **Track / machine:** Clemson RIDES DRIVER · deputy/driver-a11y · pkg-driver-a11y t2
- **What was wrong:** Core driver flow screens (sign-in/account, onboarding, home online toggle & controls, queue, live trip navigation, earnings) contained 42 touchable elements missing accessibilityRole, accessibilityLabel, accessibilityHint, accessibilityState (for disabled, checked, selected), adequate hit target sizes (<44pt), or dynamic announcements for status changes (online/offline, incoming ride offers).
- **What changed:**
  - Added accessibilityRole, accessibilityLabel, accessibilityHint, accessibilityState, and 44pt hitSlop across core driver flow components and screens (`apps/driver/components/chrome.tsx`, `apps/driver/components/shell.tsx`, `apps/driver/components/SignaturePad.tsx`, `apps/driver/app/(tabs)/index.tsx`, `apps/driver/app/onboarding.tsx`, `apps/driver/app/queue.tsx`, `apps/driver/app/trip.tsx`, `apps/driver/app/(tabs)/earnings.tsx`, `apps/driver/app/earnings-activity.tsx`, `apps/driver/app/earnings-details.tsx`, `apps/driver/app/account.tsx`, `packages/rides-native/AuthScreens.jsx`).
  - Added accessibility announcements for new offer arrival and online/offline status toggling (`AccessibilityInfo.announceForAccessibility`) and polite live regions on home status indicators (`accessibilityLiveRegion="polite"`).
  - Preserved home offer card (`RideCard` decline button) untouched as owned by `pkg-driver-offer-card-polish`.
  - Shrunk the driver a11y static scanner allowlist in `tests/a11yDriver.test.js` from 51 down to 9 remaining offenders.
- **Files touched:**
  - `apps/driver/components/chrome.tsx`
  - `apps/driver/components/shell.tsx`
  - `apps/driver/components/SignaturePad.tsx`
  - `apps/driver/app/(tabs)/index.tsx`
  - `apps/driver/app/onboarding.tsx`
  - `apps/driver/app/queue.tsx`
  - `apps/driver/app/trip.tsx`
  - `apps/driver/app/(tabs)/earnings.tsx`
  - `apps/driver/app/earnings-activity.tsx`
  - `apps/driver/app/earnings-details.tsx`
  - `apps/driver/app/account.tsx`
  - `packages/rides-native/AuthScreens.jsx`
  - `tests/a11yDriver.test.js`
  - `docs/FIXES.md`

## 2026-09-25 — Add driver a11y static scan test [t1]

- **Track / machine:** Clemson RIDES DRIVER · deputy/driver-a11y · pkg-driver-a11y t1
- **What was wrong:** The driver app lacked automated static accessibility scanning, allowing Pressable, TouchableOpacity, and Button elements lacking accessibilityLabel or accessibilityRole, as well as Image elements without accessibilityLabel or accessible={false}, to slip into production.
- **What changed:** Added `tests/a11yDriver.test.js`, a static AST scanner (using Babel parser with TypeScript/JSX, reading .tsx files under `apps/driver/app` and `apps/driver/components` with fs, no RN runtime). Initialized an allowlist of 51 current driver offenders so the suite passes while printing the offender count and blocking any new unallowlisted accessibility regressions.
- **Files touched:**
  - `tests/a11yDriver.test.js`
  - `docs/FIXES.md`

## 2026-09-25 — Google sign-in setup documentation and test wiring [t3]

- **Track / machine:** Clemson RIDES · deputy/google-signin-prep · pkg-google-signin-prep t3
- **Problem:** `packages/rides-native/googleAuthConfig.test.js` was created in t1 and extended in t2 to validate Google OAuth readiness gating and error mapping, but was not wired into root `package.json`'s `test` script. Furthermore, enabling Google Sign-In requires external setup in Google Cloud Console and Supabase Auth that cannot be automated in code and was previously undocumented.
- **Fix:**
  - Created `docs/google-signin-setup.md` detailing the complete manual setup steps for John: Google Cloud Console OAuth consent screen and client IDs (Web client with Supabase callback URL `https://awktabuhijrshmsmagpq.supabase.co/auth/v1/callback` and production web origin `https://clemson-rides.vercel.app`, iOS clients for `com.ascendmaui.clemsonrides.rider` and `com.ascendmaui.clemsonrides.driver`, and Android clients), Supabase Auth provider toggle and redirect allowlist (`clemsonrides://**`, `clemsonrides-driver://**`, `https://clemson-rides.vercel.app/**`), and environment variable placement table for EAS build profiles (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`), local `.env` files, and the Supabase Dashboard secret.
  - Appended `packages/rides-native/googleAuthConfig.test.js` to the `test` script in root `package.json`.
- **Files touched:**
  - `docs/google-signin-setup.md`
  - `package.json`
  - `docs/FIXES.md`
- **Verified:** `npm test` (822/822 passing, including all 29 tests in `googleAuthConfig.test.js`), `node --test tests/no*.test.js` (clean), `npm run typecheck` (clean).

## 2026-09-25 — Gate Google button on config readiness in sign-in screens [t2]

- **Track / machine:** Clemson RIDES · deputy/google-signin-prep · pkg-google-signin-prep t2
- **Problem:** Native rider and driver sign-in screens showed an active Google button even when Google OAuth client IDs (`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) were unconfigured, leading to runtime failures upon tapping. Additionally, raw errors from `googleAuth` could leak internal developer details (such as EAS build flags or Supabase redirect allowlists) to users instead of friendly messages, and `.env.example` templates were missing placeholder names for the client IDs.
- **Fix:**
  - Gated the Google button in `apps/rider/app/sign-in.tsx`, `apps/rider/app/sign-up.tsx`, `apps/driver/app/sign-in.tsx`, and `apps/driver/app/sign-up.tsx` using `googleAuthButtonState` / `googleAuthConfig`: active only when configured, otherwise disabled with honest copy ("Google sign-in is coming soon").
  - Updated `packages/rides-native/AuthScreens.jsx` `SocialButtons` and `SignInScreen` / `SignUpScreen` to support disabled social providers with the honest copy and hint styling, blocking tap actions and mapping errors.
  - Implemented `mapGoogleAuthError`, `googleAuthErrorMessage`, and `resolveSocialProviders` in `packages/rides-native/googleAuthConfig.js` (and `.d.ts`) to map unconfigured provider, missing Supabase config, session/redirect issues, rate limits, existing accounts, and user cancellations to friendly user-facing messages without leaking internal traces or env names.
  - Caught and mapped Google errors in `apps/rider/lib/socialSignIn.ts` and `apps/driver/lib/socialSignIn.ts`.
  - Added empty placeholder keys `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=` with comments in `.env.example`, `apps/rider/.env.example`, and `apps/driver/.env.example`.
  - Added unit tests in `packages/rides-native/googleAuthConfig.test.js`.
- **Files touched:**
  - `packages/rides-native/googleAuthConfig.js`
  - `packages/rides-native/googleAuthConfig.d.ts`
  - `packages/rides-native/googleAuthConfig.test.js`
  - `packages/rides-native/AuthScreens.jsx`
  - `packages/rides-native/AuthScreens.d.ts`
  - `packages/rides-native/socialAuth.d.ts`
  - `apps/rider/app/sign-in.tsx`
  - `apps/rider/app/sign-up.tsx`
  - `apps/rider/lib/socialSignIn.ts`
  - `apps/driver/app/sign-in.tsx`
  - `apps/driver/app/sign-up.tsx`
  - `apps/driver/lib/socialSignIn.ts`
  - `.env.example`
  - `apps/rider/.env.example`
  - `apps/driver/.env.example`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/googleAuthConfig.test.js` (29/29 passing), `npm run typecheck` (clean), `npm test` (793/793 passing).

## 2026-09-25 — Add googleAuthConfig readiness helper and tests [t1]

- **Track / machine:** Clemson RIDES · deputy/google-signin-prep · pkg-google-signin-prep t1
- **Problem:** Native rider and driver apps lacked a readiness helper to detect whether public Google OAuth client IDs (`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) are configured before initiating OAuth. Without this, the UI cannot distinguish unconfigured Google Sign-In from a runtime error, risking tap-time failures instead of honestly informing users with "Google sign-in is coming soon".
- **Fix:** Added `packages/rides-native/googleAuthConfig.js` (and `.d.ts`), exporting `googleAuthConfig` / `getGoogleAuthConfig` returning `{ enabled, missing: [...], redirectUri }`, along with `isGoogleAuthEnabled`, `googleAuthStatusMessage`, `googleAuthButtonState`, and constants. Trims env values, handles aliases, and generates app-specific redirect URIs based on app schemes. Added comprehensive unit tests in `packages/rides-native/googleAuthConfig.test.js` using isolated fake env objects.
- **Files touched:**
  - `packages/rides-native/googleAuthConfig.js`
  - `packages/rides-native/googleAuthConfig.d.ts`
  - `packages/rides-native/googleAuthConfig.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/googleAuthConfig.test.js` (22/22 passing).

## 2026-09-25 — Shared unpaid airport-hold TTL and rider countdown [t1]

- **What was wrong:** `UNPAID_AIRPORT_HOLD_TTL_MS` lived only in `server/abandonedCheckout.js`. The rider client had no pure helper for the same 20-minute deadline, so an unpaid airport hold could be canceled (`unpaid_hold_ttl`) with no shared remaining-time label.
- **What changed:** The 20-minute value now lives in `shared/airportHold.js`. `server/abandonedCheckout.js` re-exports it; the number is unchanged (`20 * 60 * 1000`). `packages/rides-native/holdExpiry.js` counts down from the later of `created_at` and `metadata.stripe_checkout_created_at`. `msLeft <= 0` is expired, matching the server cutoff. Labels: `Pay within 12 min to keep your ride` (whole minutes floored), `Less than a minute left`, `This hold expired — request again`. A missing start time returns `{ msLeft: null, expired: false, label: '' }` because the server skips a hold with no anchor.
- **Files touched:** `shared/airportHold.js`, `server/abandonedCheckout.js`, `packages/rides-native/holdExpiry.js`, `packages/rides-native/holdExpiry.d.ts`, `packages/rides-native/holdExpiry.test.js`, `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/holdExpiry.test.js` (13/13) and the server boundary test `an unpaid airport hold is canceled at 20 minutes and kept one millisecond earlier`.

## 2026-09-25 — merge_trip_metadata trip_status enum cast applied (#100)

- **Problem:** `public.merge_trip_metadata` (#80) failed on every call with `operator does not exist: trip_status = text`, which broke the airport-checkout session bind, abandon-checkout release and the unpaid-hold expiry cancel.
- **Fix:** migration `20260925150000_merge_trip_metadata_enum_cast.sql` (`status::text = ANY(p_expected_statuses)`, `COALESCE(p_new_status::public.trip_status, status)`). Applied to awktabuhijrshmsmagpq at 12:51 AM ET 9/25 with John's approval. anon/authenticated still cannot execute it; service_role can. No redeploy was needed.
- **Verified in prod (test mode):** airport-checkout 200, and the session is now bound (`stripe_checkout_session_id` / `stripe_checkout_created_at` stamped); reconcile-checkout on the unpaid session 200 `paid:false`; abandon-checkout 200 `released:true, status:canceled`; no `trip_status = text` in the runtime logs. Throwaway user and trip deleted.
- **Lesson:** fake Supabase clients in the unit tests cannot catch Postgres type errors. Call any new RPC once against the real DB (a no-op id works) before shipping.

## 2026-09-25 — partyProfile tests run from the root npm test script

- **Track / machine:** Clemson RIDES · deputy/party-profile-tests · pkg-party-profile-tests t3
- **What was wrong:** `packages/rides-native/partyProfile.test.js` was added on this branch in t1/t2. The root `npm test` script is an explicit file list, so a missing entry would skip the signup, draft-merge, and rating checks.
- **What changed:** The `test` script in `package.json` already lists `packages/rides-native/partyProfile.test.js` once, immediately after `packages/rides-native/riderMoney.test.js`. Left that entry in place. No other `package.json` field changed.
- **Files touched:**
  - `docs/FIXES.md`
- **Verified:** `npm test` (816/816 passing). The partyProfile file is tests 295–325 (31/31).

## 2026-09-25 — signup draft fills whitespace-only profile metadata

- **Track / machine:** Clemson RIDES · deputy/party-profile-tests · pkg-party-profile-tests t2
- **What was wrong:** `userWithDraft` used `||`, so a whitespace-only `user_metadata` field (a space in `full_name`, `phone`, `bio`, `ride_style`, or `promo_code`) counted as present. A stored signup draft could not fill that field. `ensureProfile` then built the profile from the blank metadata and dropped the draft name, phone, bio, and ride style.
- **What changed:** `userWithDraft` skips whitespace-only strings and uses the next candidate (metadata `name`, then the draft). Non-blank values are unchanged, and the input user is not mutated.
- **Files touched:**
  - `packages/rides-native/partyProfile.js`
  - `packages/rides-native/partyProfile.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/partyProfile.test.js` (31/31 passing).

## 2026-09-25 — partyProfile unit tests cover every export

- **Track / machine:** Clemson RIDES · deputy/party-profile-tests · pkg-party-profile-tests t1
- **What was wrong:** `packages/rides-native/partyProfile.test.js` checked signup, ensure, draft merge, route gates, counterpart ids, and the rating happy path, but never called the async loaders or several pure helpers (`digits`, `formatPhone`, `hasRideStyle`, `asSpotList`, `vehicleLabelFromRow`, and the profile constants).
- **What changed:** Extended `packages/rides-native/partyProfile.test.js` only. Did not edit `packages/rides-native/partyProfile.js`. The suite now locks the export list and each helper. Suspicious current behavior stays asserted with `// BUG?:`: `validateStars(true)` and scientific notation count as stars; `formatRatingLine` prints negative, fractional, and out-of-range values and rounds 4.85 to 4.8; `asSpotList` keeps untrimmed spots; whitespace-only metadata blocks `userWithDraft`; `readSignupDraft` accepts JSON arrays and stringifies non-strings; a one-character name and a too-short phone are stored and then not repaired by `buildEnsureProfilePatch`; `ratingBlockReason` tells non-parties the trip is unfinished and reports a missing rider as "Cannot rate yourself"; `findPendingRating` interpolates `userId` into `.or()`, swallows query errors, and only requests five trips; `loadPublicProfile` treats an RPC error that mentions "function" as a missing RPC; `loadOwnProfile` retries the narrow select for any error that mentions "column"; an empty-string `rating_avg` becomes 0 and any truthy `student_verified_at` marks a student.
- **Files touched:**
  - `packages/rides-native/partyProfile.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/partyProfile.test.js` (31/31 passing).

## 2026-09-25 — Build 19 shipped to production (#91); merge_trip_metadata enum bug found in smoke test

- **Track / machine:** Clemson RIDES · Max (merges, tests) + MacBookPro-1096 (Vercel CLI, team john-matveyev-macbooki9, project clemson-rides) · approved by John 12:19 AM ET 9/25.
- **What shipped:**
  - Migrations applied to awktabuhijrshmsmagpq: `hold_claim_atomic` (#80: `trips.hold_expire_claimed_at`, `public.merge_trip_metadata`, EXECUTE revoked from anon/authenticated, granted to service_role) then `card_brand_and_trip_created_at` (#82: `profiles.stripe_card_brand`, `profiles.stripe_card_last4`, `trips.created_at` backfilled from requested_at, NOT NULL default now()). #78 RLS fix was already live (`20260925015128 fix_profiles_trips_rls_recursion`) and was not reapplied. Pre-apply count: 2 unpaid airport holds past the 20-minute TTL that the expiry job would cancel.
  - #91 squash-merged as 327a304; #72–#90 closed as shipped in #91 (#75/#76 superseded by #77).
  - Production deploy `clemson-rides-1wy0w9c4y` from 327a304 via `vercel deploy --prod --scope john-matveyev-macbooki9` (no git-integration deploy fired).
  - Test PRs #94, #95, #96, #97 merged after syncing with main (package.json test list union, FIXES.md keep-both). #92 and #93 skipped: their assertions expect the old `clemson-airport-rides.vercel.app` default and pre-#90 apiClient error shapes (13 and 12 failures after syncing with main).
- **Smoke test (prod):** `/` 200; setup-intent 200 (also via `/api/stripe-setup-intent`); quote 200; airport-checkout 200 (cs_test session); reconcile-checkout on the unpaid session 200 `{ok:true, paid:false}`; reconcile-checkout unauthenticated 401; expire-unpaid-airport-holds without cron auth 401; unsigned webhook 400. Throwaway user and trip deleted.
- **Bug found:** `public.merge_trip_metadata` fails on every call with `operator does not exist: trip_status = text`. `trips.status` is the `trip_status` enum but the function compares it to `p_expected_statuses text[]` and assigns `COALESCE(p_new_status text, status)`. The unit tests use a fake Supabase client, so they could not catch it. Affected: airport-checkout session bind (logs `[airport-checkout] session bind operator does not exist: trip_status = text`, response still 200), abandon-checkout release (200 with `released:false, reason:update_failed`), and the unpaid-hold expiry sweep's cancel. Paid deposits are unaffected because `recordDeposit` stamps `fare_paid_cents`/`checkout_deposit` with a plain update.
- **Fix (pending John's approval, not applied):** compare `status::text = ANY(p_expected_statuses)` and set `status = COALESCE(p_new_status::public.trip_status, status)`. See the follow-up migration PR.

## 2026-09-24 — Run the drivers unit tests as the last npm test entry

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-drivers-tests
- **Problem:** `packages/rides-native/drivers.test.js` sat in the middle of the root `test` script, ahead of later suites (live trip, marketing, ambassador, carpool settle). The drivers file has to be the last entry so `npm test` finishes on that suite.
- **Fix:** Moved `packages/rides-native/drivers.test.js` to the final argument of the `test` script in `package.json`. The file still runs once.

## 2026-09-24 — Wire accountDeletion tests into npm test

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-account-deletion-tests
- **Problem:** `packages/rides-native/accountDeletion.test.js` existed but was not listed in the root `package.json` `test` script, so `npm test` never ran the account-deletion suite.
- **Fix:** Appended `packages/rides-native/accountDeletion.test.js` as the last entry of the `test` script. No other `package.json` fields changed.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`
- **Verified:** `npm test` (377/377 passing, including `packages/rides-native/accountDeletion.test.js`).

## 2026-09-24 — Export safe buildAccountDeletionTicket helper in accountDeletion.js

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-account-deletion-tests
- **Problem:** `packages/rides-native/accountDeletion.js` only re-exported the raw `ACCOUNT_DELETION_TICKET` template without any helper function (e.g. `buildAccountDeletionTicket`), forcing callers in rider app and web screens to manually string-interpolate account emails into ticket bodies (`${ACCOUNT_DELETION_TICKET.body} Account email: ${user?.email || 'on file'}.`). Additionally, `ACCOUNT_DELETION_TICKET` hardcoded `roleVariant: 'rider'`, requiring manual overrides for driver deletion requests.
- **Root cause:** Missing ticket builder utility in the module public API.
- **Fix:** Added `buildAccountDeletionTicket({ email, roleVariant = 'rider', subject } = {})` in `packages/rides-native/accountDeletion.js` that trims and normalizes emails (falling back to `'on file'` if blank/null), safely handles `roleVariant` ('rider' or 'driver'), accepts optional custom subjects, keeps existing `ACCOUNT_DELETION_TICKET` valid-input behavior, and returns a frozen immutable ticket payload ready for `validateTicket` and `supportTicketRequest`.
- **Files touched:**
  - `packages/rides-native/accountDeletion.js`
  - `packages/rides-native/accountDeletion.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/accountDeletion.test.js` (26/26 passing) and `npm test` (351/351 passing).

## 2026-09-24 — wire agentChips tests into npm test

- **Track / machine:** Clemson RIDES · deputy/agent-chips-tests · pkg-agent-chips-tests t3
- **What was wrong:** `packages/rides-native/agentChips.test.js` covered native help chips, support chips, and `categoryLabel`, but the root `npm test` script never listed that file, so the suite could pass while those checks were skipped.
- **What changed:** Appended `packages/rides-native/agentChips.test.js` as the last entry of the `test` script in `package.json`. No production source change.
- **Files touched:** `package.json`, `docs/FIXES.md`

## 2026-09-24 — native categoryLabel trims string categories

- **Track / machine:** Clemson RIDES · deputy/agent-chips-tests · pkg-agent-chips-tests t2
- **What was wrong:** `packages/rides-native/agentChips.js` re-exported `categoryLabel` unchanged. A whitespace-only category is truthy, so the label came back as blank spaces. Padded canonical keys such as `' bug'` and `'safety '` missed the switch and echoed the raw string, including the spaces.
- **What changed:** The native module trims string categories before the server lookup. `'   '` and other blank strings become `Other`. `' bug'` becomes `Bug` and `'safety '` becomes `Safety`. Unknown text keeps its inner characters (`'  lost_and_found  '` → `lost_and_found`). Non-strings are unchanged (`0` and `false` still become `Other`; an empty array still becomes `''`). `server/agentChips.js` is untouched, so web support and help still use the untrimmed function.
- **Files touched:** `packages/rides-native/agentChips.js`, `packages/rides-native/agentChips.test.js`, `docs/FIXES.md`

## 2026-09-24 — agentChips unit tests leave production source unchanged

- **Track / machine:** Clemson RIDES · deputy/agent-chips-tests · pkg-agent-chips-tests t1
- **What was wrong:** `packages/rides-native/agentChips.js` only re-exports `HELP_CHIPS`, `SUPPORT_CHIPS`, and `categoryLabel`. The first test pass checked labels and support prompts, but a help-copy change could still pass, and `categoryLabel` trim/case/falsy behavior was only partly pinned.
- **What changed:** Extended `packages/rides-native/agentChips.test.js` only. Did not edit `packages/rides-native/agentChips.js` or `server/agentChips.js`. Tests now lock help prompt text, the re-export list, and chip `{label, text}` shape. Quirks stay asserted with `// BUG?:`: `0` and `false` become `Other`; canonical keys are not trimmed or lowercased; a whitespace-only category is returned unchanged; `NaN` becomes `Other`; an empty array becomes `''`.
- **Files touched:** `packages/rides-native/agentChips.test.js`, `docs/FIXES.md`

## 2026-09-24 — iOS build 19 (rider + driver) integration: contents

- **Track / machine:** Clemson RIDES · Max / 1.1.0(19), branch integration/b19 (worktree ~/Projects/wt/clemson-b19) from main d3a3fe1 (#71). Build 19 = main + #83 (approval bundle of #72, #73, #74, #77, #78, #79, #80, #81, #82) + #84 profile-ensure + #85 driver offer-card safe area + #86 checkout-reconcile + #87 lostfound-tests + #88 driver-onboarding-tests + #89 trip-messages-tests + #90 error-messages (incl. 60e6111 vite-build import fix). #75/#76 not merged separately (bundled via #77 in #83). buildNumber/CFBundleVersion/CURRENT_PROJECT_VERSION = 19. Integration fixes: ensureProfile test mock gained `.in()`/`rpc()`; apiErrors dropped the removed-auth vendor token (noClerk guard); driverDesk test expects #90 friendly copy. Migrations from #78/#80/#82 are NOT applied by this build; the app build does not depend on them, but the server side of #80 does.

## 2026-09-24 — Sanitize removed auth vendor name in INTEGRATION_BUNDLE.md [t2]

- **Track / machine:** Deputy · pkg-integration-72-82 t2 · integration/approval-bundle
- **What was wrong:** `tests/noClerk.test.js` failed because `docs/INTEGRATION_BUNDLE.md` contained the removed auth vendor token in the PR #73 summary.
- **What changed:** Replaced the removed auth vendor token with `removed-auth` in `docs/INTEGRATION_BUNDLE.md` so the guard in `tests/noClerk.test.js` passes cleanly.
- **Files touched:**
  - `docs/INTEGRATION_BUNDLE.md`
  - `docs/FIXES.md`

## 2026-09-24 — Integration bundle for PRs #72–#82

- **Track / machine:** Deputy · pkg-integration-72-82 t1 · integration/approval-bundle
- **What was wrong:** PRs #72, #73, #74, #77, #78, #79, #80, #81, and #82 needed to be merged into a single integration branch for review and approval. Several PRs conflicted on `docs/FIXES.md` and `package.json`.
- **What changed:**
  - Merged PR heads in exact sequence via `git merge --no-ff`: #72, #73, #74, #77, #78, #79, #80, #81, #82 (PRs #75 and #76 excluded as superseded by #77).
  - Reconciled `package.json` test script to the union of main's test file list plus each PR's added test entries in merge order without duplicates, keeping all other scripts (such as `"typecheck"` from #73).
  - Reconciled `docs/FIXES.md` preserving all entries across all PRs with zero dropped notes.
  - Created `docs/INTEGRATION_BUNDLE.md` detailing merge order, head SHAs, conflict resolutions, and unapplied migrations (#78, #80, #82).
- **Files touched:**
  - `docs/INTEGRATION_BUNDLE.md`
  - `docs/FIXES.md`
  - `package.json`

## 2026-09-24 — Atomic hold claim & metadata merge design and migration requirement documented [t3]

- **Track / machine:** Deputy · pkg-pro-hold-claim-atomic · deputy/hold-claim-atomic
- **Context & Design Decision:** Addressed reviewer note on PR #74 regarding race conditions in `/api/expire-unpaid-airport-holds` where reading `trips.metadata`, modifying in JS, and updating the entire object clobbered concurrent writes (e.g. Stripe webhooks adding `receipt_url` or rider updates).
  - Selected hybrid Design A + Design B:
    - **Design A (Claim column):** Added `trips.hold_expire_claimed_at timestamptz` (nullable) with partial index `trips_hold_expire_claimed_at_idx`. Claiming and releasing operate directly on this dedicated column via conditional UPDATEs without touching `trips.metadata`.
    - **Design B (Atomic metadata merge):** Added Postgres RPC `public.merge_trip_metadata(p_trip_id uuid, p_patch jsonb, ...)` (SECURITY DEFINER, `search_path = public`, granted to `service_role` only) which merges patches via `metadata = coalesce(metadata, '{}'::jsonb) || p_patch` alongside conditional status updates and claim clearing in a single atomic statement.
- **Migration File:** `supabase/migrations/20260925140000_hold_claim_atomic.sql`
- **Pre-Ship Requirement:** Migration `supabase/migrations/20260925140000_hold_claim_atomic.sql` **MUST** be applied to the database before this code ships. If the application code is deployed before the migration is run, `/api/expire-unpaid-airport-holds` will fail with 500 errors because the column `hold_expire_claimed_at` and the RPC function `public.merge_trip_metadata` will not exist.
- **Files:** `docs/FIXES.md`, `SHIP_NOTES.md`

## 2026-09-24 — Hold claim and cancel race conditions verified with concurrency tests [t2]

- **Track / machine:** Deputy · pkg-pro-hold-claim-atomic · deputy/hold-claim-atomic
- **Problem:** Needed test coverage verifying that concurrent metadata writes (such as Stripe webhooks adding `receipt_url` between the sweep's read and write) survive claim, release, and cancel steps without being clobbered; that overlapping sweeps produce exactly one cancel, one trip_event, and one Stripe expire; and that stale claims (>2 min) can be taken over.
- **Fix:** Added targeted test suite in `server/abandonedCheckout.test.js`:
  1. Verified concurrent webhook metadata writes (`metadata.receipt_url`) between the sweep's initial read and the claim update survive both claim and cancel.
  2. Verified concurrent metadata writes during an active claim survive claim release when Stripe session expiration fails.
  3. Verified concurrent metadata writes between Stripe expire and cancel write survive the atomic merge.
  4. Verified two overlapping sweeps concurrently processing an open hold result in exactly one Stripe session expiration, one trip cancel, and one `trip_events` insert.
  5. Verified fresh claims (<2 min) block subsequent sweeps, and stale claims (>2 min) are successfully taken over and processed to completion.
- **Files:** `server/abandonedCheckout.test.js`, `docs/FIXES.md`

## 2026-09-24 — Unpaid airport hold claim and cancel metadata writes made atomic

- **Track / machine:** Deputy · pkg-pro-hold-claim-atomic · deputy/hold-claim-atomic
- **Problem:** In `/api/expire-unpaid-airport-holds` and `server/abandonedCheckout.js`, sweep claim/release and cancel steps read `trips.metadata`, modified the in-memory JavaScript object, and wrote the entire object back (`.update({ metadata: nextMeta })`). If a concurrent writer (such as a Stripe webhook or rider status change) updated `trips.metadata` during that window, its keys were lost/overwritten.
- **Fix:** Implemented atomic claim and metadata merge:
  1. Added migration `supabase/migrations/20260925140000_hold_claim_atomic.sql` adding nullable `trips.hold_expire_claimed_at timestamptz` with a partial index, and security definer SQL function `public.merge_trip_metadata(p_trip_id uuid, p_patch jsonb, ...)`. Execution is granted to `service_role` only.
  2. In `server/abandonedCheckout.js`, `claimStripeExpire` now performs a conditional update directly setting `hold_expire_claimed_at = now` where `id = ?` and `(hold_expire_claimed_at IS NULL OR hold_expire_claimed_at < now - 2min)` and in-pool, unassigned, and unabandoned. `releaseExpireClaim` sets `hold_expire_claimed_at = NULL`. Neither touches `trips.metadata`.
  3. `writeCanceled` and metadata stamp writes use `sb.rpc('merge_trip_metadata', ...)` to concatenate `checkout_abandoned` / `checkout_deposit` into `trips.metadata` via Postgres `metadata = coalesce(metadata, '{}'::jsonb) || p_patch`, updating status to `canceled` and clearing `hold_expire_claimed_at` in a single atomic statement without clobbering other metadata keys.
  4. Updated fake Supabase client in `server/abandonedCheckout.test.js` to support `.or()` filter clauses and `rpc('merge_trip_metadata')`. Added tests verifying concurrent metadata writes during claim, cancel, and error release are preserved.
- **Files:** `supabase/migrations/20260925140000_hold_claim_atomic.sql`, `server/abandonedCheckout.js`, `server/abandonedCheckout.test.js`, `SHIP_NOTES.md`, `docs/FIXES.md`

## 2026-09-24 — Wire vehicle.js and places.js unit test suites into package.json test runner

- **Track / machine:** Clemson RIDES · deputy/vehicle-places-tests
- **What was wrong:** `packages/rides-native/shared/vehicle.js` and `packages/rides-native/places.js` lacked test coverage and test suite registration in root `package.json`.
- **What changed:** Confirmed both test suites (`packages/rides-native/shared/vehicle.test.js` and `packages/rides-native/places.test.js`, with vehicle first) are wired as the last entries in the `package.json` `test` script. Verified full offline isolation (no real network or API keys) and confirmed full `npm test` suite passes cleanly (416 tests passing).
## 2026-09-24 — Wire lostFoundClient tests into root test script

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-lostfound-tests
- **Problem:** `packages/rides-native/lostFoundClient.js` had unit tests (`packages/rides-native/lostFoundClient.test.js`) created in t1 and robustness fixes applied in t2, but the test suite was not wired into the root `package.json` `npm test` script, leaving it out of standard CI and regression test runs.
- **Fix:** Appended `packages/rides-native/lostFoundClient.test.js` as the last entry in the `test` script in `package.json`. Verified all tests in the full test suite pass cleanly.
## 2026-09-24 — Wire tripMessagesClient unit tests to package.json test script

- **Track / machine:** Clemson RIDES · pkg-trip-messages-tests
- **Problem:** `packages/rides-native/tripMessagesClient.js` unit tests in `packages/rides-native/tripMessagesClient.test.js` needed to be wired as the last entry of the `test` script in `package.json` so the entire test suite runs them on `npm test`.
- **Fix:** Appended `packages/rides-native/tripMessagesClient.test.js` as the last test file in the `package.json` `test` command. Verified all 377 tests pass cleanly via `npm test`.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`

## 2026-09-24 — Support both { lat, lng } and { latitude, longitude } in driverApproach and requestDriverTrip

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-drivers-tests
- **Problem:** `requestDriverTrip` expected `{ latitude, longitude }` on `destPoint` and `pickupPoint`, while `driverApproach` expected `{ lat, lng }`. Passing standard geolocation objects with `{ lat, lng }` into `requestDriverTrip` omitted coordinates from the backend payload (`destLat: undefined`, `pickupLat: undefined`), while passing place constants like `STADIUM` or `GSP` into `driverApproach` returned `{ etaMin: null, distanceMi: null }`.
- **Root cause:** Coordinate format mismatch between `places.js` (`{ latitude, longitude }`) and coordinate math utilities (`{ lat, lng }`).
- **Fix:** In `packages/rides-native/drivers.js`, normalized coordinates in both `driverApproach` and `requestDriverTrip` to fall back between `lat` / `latitude` and `lng` / `longitude`. Added unit tests in `packages/rides-native/drivers.test.js` validating both formats.
- **Files touched:**
  - `packages/rides-native/drivers.js`
  - `packages/rides-native/drivers.test.js`

## 2026-09-24 — saveRegisteredVehicle threw unhandled TypeError on missing payload

- **Track / machine:** Clemson RIDES · deputy/vehicle-places-tests
- **What was wrong:** `saveRegisteredVehicle` in `packages/rides-native/shared/vehicle.js` accessed `payload.make` without checking if `payload` was null, undefined, or malformed, causing an unhandled `TypeError` instead of a user-facing validation error.
- **What changed:** Safely defaulted `payload` to an empty object when null, undefined, or non-object so the existing required field checks cleanly throw `Error('Make, model, and plate are required.')`. Updated unit tests in `packages/rides-native/shared/vehicle.test.js` to assert the validation error.
- **Files touched:**
  - `packages/rides-native/shared/vehicle.js`
  - `packages/rides-native/shared/vehicle.test.js`
  - `docs/FIXES.md`

## 2026-09-24 ~9:52 PM ET — Apple sign-in hit profiles/trips RLS recursion

- **Symptom:** Apple sign-in on TestFlight build 18 errored with `infinite recursion detected in policy for relation profiles`.
- **Root cause:** A cycle existed between the profiles SELECT policy `profiles_trip_counterpart_select`, which queries trips, and the trips SELECT policy `trips_driver_scheduled_select`, which queried profiles directly.
- **Fix:** Replaced that profiles subquery with the SECURITY DEFINER function `is_driver_or_admin_role()`, which sets `row_security` off.
- **Applied:** Already applied to the live Supabase project `awktabuhijrshmsmagpq` via migration.
- **Verified:** As user `jmat2019@icloud.com`, profiles and trips selects plus the profile insert work in a rolled-back transaction. An audit of all public policies found no other cycles.

## 2026-09-24 — Unpaid airport hold expiry is safe for an external cron

- **Track / machine:** I9 · Deputy · deputy/hold-expiry-hardening
- **Problem:** `GET`/`POST /api/expire-unpaid-airport-holds` treated a spoofable `x-vercel-cron: 1` header as authorization whenever `CRON_SECRET` was unset, compared the bearer token with `===`, and could expire the same Stripe Checkout session twice when an external cron and another sweep overlapped. A Stripe expire failure was not reported as a per-trip error, and a 500 response could echo the internal error message. The route also answered browser CORS preflight.
- **Fix:** The bearer secret is trimmed and compared with `crypto.timingSafeEqual` on equal-length buffers. `x-vercel-cron` is accepted only when `CRON_SECRET` is unset or a placeholder and `VERCEL` is set. An open-session expire is claimed with a conditional metadata update. The cancel updates a row only while its status is still searching/offered/scheduled, `driver_id` is null, and `checkout_abandoned` is unset; only that winner inserts `trip_events`. A Stripe expire error is stored on that trip's result, the claim is released, and the batch continues. The handler returns 405, 401, 503, and a generic 500 (detail logged server-side), with counts `scanned` / `expired` / `skipped` / `errors`. `?dry_run=1` reports `wouldExpire` and does not write. Browser CORS is not set. The batch stays capped at 40. `vercel.json` was not changed.
- **Files:** `server/endpoints/expireUnpaidAirportHolds.js`, `server/abandonedCheckout.js`, `server/abandonedCheckout.test.js`, `api/expire-unpaid-airport-holds.js`, `SHIP_NOTES.md`, `docs/FIXES.md`

## 2026-09-24 — Post-auth cleanup: residue guard and a root typecheck

- **Track / machine:** I9 · Deputy · deputy/post71-auth-typecheck
- **Problem:** After social sign-in moved to Supabase Auth, the driver README still described email/password or Google only. `GOOGLE_PROVIDER` / `DRIVER_GOOGLE_PROVIDER` were unused exports (both apps use `RIDER_SOCIAL_PROVIDERS` / `DRIVER_SOCIAL_PROVIDERS`). There was no root typecheck, and nothing stopped the removed auth vendor name from coming back in tracked files.
- **Fix:**
  - Driver README now matches the apps: Apple via `signInWithIdToken`, Google via `signInWithOAuth` and `clemsonrides-driver://auth/callback`. Root README and both app `.env.example` files name the same `auth/callback` deep links.
  - Dropped the unused Google provider constants from `packages/rides-native/googleAuth.js` and `googleAuth.d.ts`.
  - Root `npm run typecheck` runs `scripts/typecheck.mjs`: each app's own `tsc --noEmit` (installs that app with `npm ci` only when `apps/*/node_modules` is missing) plus `node --check` on `api/**/*.js` and `server/**/*.js` (test files skipped).
  - `tests/noClerk.test.js` (`node:test`, wired as `tests/no*.test.js` so the script does not reintroduce the token) fails if that name appears, case-insensitively, in any `git ls-files` path other than `docs/FIXES.md` and package-lock files.
- **Audit:** no other code, test, script, README, auth contract, ship notes, env example, `app.json` / `eas.json`, `vite.config.js`, or `vercel.json` rewrite still pointed at the removed provider, bridge, or `sso-callback` route. `apps/*/patches` left untouched (React Native `facebook.jsi`, not a login provider). Historical entries below are unchanged.
- **Files:** `apps/driver/README.md`, `README.md`, `apps/rider/.env.example`, `apps/driver/.env.example`, `packages/rides-native/googleAuth.js`, `packages/rides-native/googleAuth.d.ts`, `package.json`, `scripts/typecheck.mjs`, `tests/noClerk.test.js`, `docs/FIXES.md`.
- **Verified:** `npm ci --no-audit --no-fund --loglevel=error && npm test && npm run typecheck` — 352/352 tests. With both app `node_modules` folders absent, typecheck installed them, then `tsc --noEmit` and `node --check` exited 0. No type errors to fix.

## 2026-09-24 — Apps still pointed at the old clemson-airport-rides.vercel.app domain

- **Track / machine:** Clemson RIDES · Johns-iMac (worktree fix/clemson-rides-domain) · edits by Google Anti-Gravity CLI (`agy -p`), reviewed and finished by hand
- **Problem:** Production web/API moved to the new Vercel project `https://clemson-rides.vercel.app`, but native API calls, Stripe Checkout return origins, share/carpool/promo links, server email links and docs still used `https://clemson-airport-rides.vercel.app`.
- **Root cause:** The origin was hardcoded in ~20 places (native `apiClient`, `carpoolApi`, `safety`, `riderMoney`, rider `_layout`/`apiAuth`, mobile `schedule`, server checkout/friend/carpool/driver-approval fallbacks, web link helpers) instead of one constant.
- **Fix:**
  - `shared/productLinks.js` `WEB_ORIGIN` is the single source: `https://clemson-rides.vercel.app`.
  - New `packages/rides-native/apiOrigin.js` (+ `.d.ts`): `DEFAULT_API_BASE = WEB_ORIGIN`, `resolveApiBase()` = `EXPO_PUBLIC_API_BASE` or the default, trailing slash stripped. Used by `apiClient.js`, `shared/carpoolApi.js`, rider `app/_layout.tsx` and `lib/apiAuth.ts`.
  - `safety.js` `SHARE_ORIGIN`, `riderMoney.js` `NATIVE_CHECKOUT_ORIGIN` and promo share URL use `WEB_ORIGIN`.
  - Server/web fallbacks (`buyCredits`, `airportCheckout`, `create-checkout-session`, `friendRideRoutes`, `carpoolRoutes`, `driverApproval`, `src/lib/{navigation,friendRides,riderPromo}.js`) import `WEB_ORIGIN`; env overrides (`VITE_APP_URL`, `APP_URL`, `body.origin`) still win.
  - `apps/mobile` (frozen TestFlight app) keeps its inline fallback, now the new domain.
  - Tests, READMEs and `.env.example` files updated. Older entries in this log are history and keep the old domain.
- **External config still on the old domain (dashboards, not code):** Vercel `VITE_APP_URL` / `APP_URL` if set (they override the fallback), EAS `EXPO_PUBLIC_API_BASE` for rider/driver, Stripe webhook endpoint (`/api/stripe-webhook`), Supabase Auth Site URL / redirect URLs, Google OAuth authorized origins.
## 2026-09-24 — "Sign in required" on deposit / add card: SUPABASE_SERVICE_ROLE_KEY missing on the new Vercel project

- **Track / machine:** Clemson RIDES · iOS TestFlight build 18 (1.1.0) · Vercel project `clemson-rides` (team `john-matveyev-macbooki9`, domain `clemson-rides.vercel.app`)
- **Symptom:** Signed in with Supabase auth, tapping Pay on the airport deposit showed "Sign in required"; Billing could not add a card ("Supabase service role key on Vercel is not configured").
- **Root cause:** The new `clemson-rides` Vercel project had no `SUPABASE_SERVICE_ROLE_KEY`. `userFromAuth()` (`server/friendRideLib.js`) needs `admin()` to call `auth.getUser(token)`; with no key it returns null, so `api/create-checkout-session.js` answers **401 "Sign in required"** (masking the real problem) and the setup-intent route in `server/stripePaymentRoutes.js` answers **503 "SUPABASE_SERVICE_ROLE_KEY not configured"**. Not the old domain: `clemson-airport-rides.vercel.app` (still on `af87b60`) already verified Supabase tokens and had the key.
- **Fix (no app build):** Added `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview sensitive, Development encrypted) to `clemson-rides`, then redeployed the current production deployment (`dpl_udfb4nTmj4z5npSHETddSW9tV32F` → `clemson-rides-9atbwgh0y`, same source) with John's approval, ~10:00 PM ET.
- **Verified:** Throwaway Supabase user on `clemson-rides.vercel.app`: `action=setup-intent` 200 (client_secret), `action=airport-checkout` 200 (Stripe Checkout session), `create-checkout-session` 200. User and its trips deleted afterwards.
- **Next time:** When a new Vercel project/domain is created, diff env var NAMES against the old project before pointing apps at it. Consider making `userFromAuth` return a 503 (not 401) when the service key is missing so the error is not mistaken for an auth problem.
- **Still open:** `profiles.stripe_card_brand` / `stripe_card_last4` and `trips.created_at` missing (migration `20260925020500_card_brand_and_trip_created_at.sql`, not applied); Stripe webhook endpoint for `clemson-rides.vercel.app/api/stripe-webhook` not registered; Stripe is in test mode (`cs_test_`); `SUPABASE_URL` is Production-only on `clemson-rides` (code falls back to the project URL).
## 2026-09-24 — Wire ensureProfile tests into test script (t3)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-profile-ensure / branch deputy/profile-ensure
- **Symptom:** `server/ensureProfile.test.js` was not executed during standard `npm test`, risking test regression in CI.
- **Root cause:** The `"test"` script in `package.json` had not yet appended the new `server/ensureProfile.test.js` test suite.
- **Fix:** Appended `server/ensureProfile.test.js` as the last entry of the `"test"` script in `package.json`.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`
- **Verified:** Ran full `npm test` with 371/371 tests passing (including all 20 tests in `server/ensureProfile.test.js`).

## 2026-09-24 — Ensure profile before trip inserts across server endpoints (t2)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-profile-ensure / branch deputy/profile-ensure
- **Symptom:** Brand-new users without a `public.profiles` row encountered foreign key violation errors (`trips_rider_id_fkey`) when attempting to create trips.
- **Root cause:** Endpoints created `trips` rows referencing `user.id` as `rider_id` before verifying that a corresponding `public.profiles` row existed.
- **Fix:** Called `ensureProfile(sb, user)` immediately prior to `trips.insert(...)` across all trip-inserting endpoints:
  - `api/create-checkout-session.js`
  - `server/endpoints/airportCheckout.js`
  - `server/endpoints/scheduleTrip.js`
  - `server/endpoints/requestDriverTrip.js`
  If `ensureProfile` returns `ok: false`, immediately respond 500 with `{ error: 'Could not create your rider profile', code: 'profile_missing' }` and halt execution before inserting into `trips`.
  Supported dependency injection (`deps`) for `sb`, `user`, `ensureProfile`, `stripeOk`, and `stripe` across all four endpoints.
  Added unit and end-to-end integration tests in `server/ensureProfile.test.js` proving `ensureProfile` executes before `trips.insert` and that upsert failures abort the insert and return 500.
- **Files touched:**
  - `api/create-checkout-session.js`
  - `server/endpoints/airportCheckout.js`
  - `server/endpoints/scheduleTrip.js`
  - `server/endpoints/requestDriverTrip.js`
  - `server/ensureProfile.test.js`
  - `docs/FIXES.md`
- **Verified:** All tests in `server/ensureProfile.test.js`, `server/abandonedCheckout.test.js`, `tests/apiRoutes.test.js`, and full `npm test` suite passing (351/351 tests).

## 2026-09-24 — Ensure minimal profile row for new Supabase auth users (t1)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-profile-ensure / branch deputy/profile-ensure
- **Symptom:** Brand-new user signing in via Apple or Google on Supabase Auth (#71) has an `auth.users` row but no `public.profiles` row. `trips.rider_id` foreign key references `profiles(id)` (`trips_rider_id_fkey`), causing initial trip creation to fail with 500.
- **Root cause:** Native social auth flows sign into Supabase Auth but may not populate `public.profiles` prior to the user's first trip request.
- **Fix:** Created `server/ensureProfile.js` (`ensureProfile(sb, user)`):
  - Validates `sb` and `user?.id`, safely returning `{ ok: false, reason: 'no_user' }` without throwing if missing.
  - Queries `profiles` with `.select('id').eq('id', user.id).maybeSingle()`; if profile exists, returns `{ ok: true, created: false }` with zero writes.
  - Upserts minimal profile row `{ id: user.id, email: user.email ?? null, full_name: user.user_metadata?.full_name || user.user_metadata?.name || null, role: 'rider' }` with options `{ onConflict: 'id', ignoreDuplicates: true }` so existing profiles and roles are never overwritten.
  - Catches Postgres 23505 unique violations on race conditions and returns `{ ok: true, created: false }`.
  - Retries once with `{ id: user.id, email: user.email ?? null }` if schema or column errors occur.
  - Returns `{ ok: false, reason: 'profile_upsert_failed', message }` on other errors.
- **Files touched:**
  - `server/ensureProfile.js`
  - `server/ensureProfile.test.js`
  - `docs/FIXES.md`
- **Verified:** 10/10 tests in `server/ensureProfile.test.js` passing via `node --experimental-strip-types --test server/ensureProfile.test.js`.
## 2026-09-24 — Driver Home offer card ran under the status bar / Dynamic Island

- **Track / machine:** Clemson RIDES DRIVER · worktree `fix/driver-offer-card-safe-area` (MacBookPro-1097)
- **Symptom:** TestFlight build 18, driver Home map: the incoming ride offer card (fare, pickup/drop-off, Fare breakdown, Accept / Decline) extended up under the clock, Dynamic Island and battery; its top lines (net fare, tags, rider, pickup) were clipped off-screen. Worse on iPhone SE / mini. The copy under the fare read like developer notes (Stripe, "calls settle on the server", "Apple Pay sheet").
- **Root cause:** `apps/driver/app/(tabs)/index.tsx` — the floating `dock` (`styles.dock`, `position: 'absolute'`) was anchored only with `bottom: tabClearance`, with no `top`. It grew upward to fit its children (pending-review gate card + `RideCard` + side tools + GO + status bar), and nothing capped its height or respected `insets.top`, so a tall offer pushed the card past the top safe area. `RideCard` rendered everything in a plain `Card` with no scroll container, so there was no way for it to shrink.
- **Fix:**
  - Dock is now pinned between `insets.top + 8` (`useSafeAreaInsets`) and the tab bar (`top: dockTop, bottom: tabClearance`, `justifyContent: 'flex-end'`), so content still stacks from the bottom but can never cross the safe area.
  - `RideCard` is `flexShrink: 1`; the offer details + Fare breakdown live in an inner `ScrollView` (`flexGrow: 0, flexShrink: 1`) that only scrolls when it overflows (flashes the indicator, hairline divider above the actions). Accept and Decline sit outside the scroll and are always visible.
  - While an offer is showing for a pending-review driver, the gate text moves into the card as one orange line instead of a separate card stacked above it.
  - Floating controls on one grid: `[shield / sparkle] · GO · [stats / locate]` in a single row, `EDGE = 16` gutter (matches the top row) and `GAP = 12` between every floating piece. GO no longer takes its own row, which gives the card ~100 pt more room.
  - Driver copy: `APPLE_PAY_DRIVER_COPY` → "The rider already paid a 25% deposit. The rest is charged to their card automatically when you complete the trip." New `driverFareNote(depositCents)` drops the deposit sentence when no deposit was taken (`NO_DEPOSIT_DRIVER_COPY`). Used by `FarePanel` (Home, Queue, Trip, Trip details).
- **Verified:** driver `tsc --noEmit` clean; `npm test` 352/352 (351 on main + new `driverFareNote` test); iOS Simulator (Expo Go, mocked pending-review driver + synthetic offer, screenshot-only mock not committed) on iPhone 17 Pro Max and iPhone SE (3rd gen), light + dark: card starts below the status bar / Dynamic Island, breakdown scrolls, Accept/Decline and all four side buttons visible.
## 2026-09-24 — Append checkout reconcile test files to test script and note fallback architecture

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-checkout-reconcile / branch deputy/checkout-reconcile
- **Problem:** New checkout reconciliation test suites (`server/checkoutReconcile.test.js` and `packages/rides-native/checkoutReturn.test.js`) were not wired into `package.json`'s `test` script, and documentation needed to specify that the webhook is the primary path while reconciliation is an on-demand fallback.
- **Root cause:** Test files added in t1 and t3 were not yet appended to the `test` script, and `SHIP_NOTES.md` had not recorded the webhook vs reconcile relationship.
- **Fix:**
  - Appended `server/checkoutReconcile.test.js` and `packages/rides-native/checkoutReturn.test.js` as the last entries of the `"test"` script in `package.json` (leaving all other script entries untouched).
  - Added a note in `SHIP_NOTES.md` under Payments (failure handling) explaining that the Stripe webhook remains the primary path for recording deposits and restoring trips, and `action=reconcile-checkout` serves as the idempotent fallback.
  - Verified full test suite passes with `npm test`.
- **Files touched:**
  - `package.json`
  - `SHIP_NOTES.md`
  - `docs/FIXES.md`

## 2026-09-24 — Trigger checkout reconciliation on return from Stripe Checkout (web & rider app)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-checkout-reconcile / branch deputy/checkout-reconcile
- **Problem:** When a rider completed payment on Stripe Checkout and returned to either the web application or rider app, the airport deposit would not be recognized if the webhook was delayed or misconfigured, and the rider app could prematurely abandon/cancel the ride as unpaid.
- **Root cause:** Neither client called `/api/stripe-payment-methods?action=reconcile-checkout` upon returning from Checkout; the web app only polled Supabase for trip status updates, and the rider app assumed the deposit was unsettled if webhook had not written to the DB by the time WebBrowser closed.
- **Fix:**
  - Implemented `packages/rides-native/checkoutReturn.js` (`parseCheckoutSessionId`, `parseCheckoutReturn`) and `packages/rides-native/checkoutReturn.d.ts` to parse `session_id` from web hashes, full URLs, and native deep links.
  - Added unit test suite in `packages/rides-native/checkoutReturn.test.js` verifying URL, hash, and deep link parsing along with session ID validation.
  - Added `reconcileCheckout(supabase, sessionId)` to `packages/rides-native/riderMoney.js` using `authedJson`, calling `/api/stripe-payment-methods?action=reconcile-checkout`.
  - Added `reconcileCheckoutSession({ sessionId })` to `src/lib/stripeCheckout.js`.
  - In `src/screens/ScheduleAirport.jsx` and `src/screens/Requested.jsx`, read `session_id` on return from checkout and trigger fire-and-forget reconciliation once (errors logged, never blocking the UI), refreshing trip data upon completion. Updated `src/App.jsx` to pass `sessionId` to `Requested`.
  - In `apps/rider/app/schedule.tsx`, invoke `reconcileCheckout(supabase, sessionId)` upon WebBrowser closing before checking deposit status, preventing premature cancellation if the webhook hasn't arrived.
  - In `apps/rider/app/_layout.tsx`, added `CheckoutDeepLink` listener to capture incoming deep links with `session_id` and reconcile checkout once fire-and-forget.
  - In `apps/rider/app/requested.tsx`, trigger `reconcileCheckout` if navigated to with `session_id`.
- **Files touched:**
  - `packages/rides-native/checkoutReturn.js`
  - `packages/rides-native/checkoutReturn.d.ts`
  - `packages/rides-native/checkoutReturn.test.js`
  - `packages/rides-native/riderMoney.js`
  - `packages/rides-native/riderMoney.d.ts`
  - `src/lib/stripeCheckout.js`
  - `src/screens/ScheduleAirport.jsx`
  - `src/screens/Requested.jsx`
  - `src/App.jsx`
  - `apps/rider/app/schedule.tsx`
  - `apps/rider/app/_layout.tsx`
  - `apps/rider/app/requested.tsx`
  - `docs/FIXES.md`

## 2026-09-24 — Add action=reconcile-checkout endpoint and carry session_id on success_url

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-checkout-reconcile / branch deputy/checkout-reconcile
- **Problem:** If Stripe webhook delivery failed or was delayed, riders returning from Checkout to the app after paying an airport deposit had no fallback mechanism to trigger reconciliation and mark the deposit paid.
- **Root cause:** There was no API route/action to request checkout reconciliation on demand, and checkout success URLs did not include the Stripe `{CHECKOUT_SESSION_ID}` placeholder needed by the client to request reconciliation.
- **Fix:**
  - Implemented `server/endpoints/reconcileCheckout.js`: POST endpoint accepting `{ sessionId }` (or `session_id`), authenticating via `userFromAuth` (401 if unauthenticated, 503 if Stripe/Supabase service role is unconfigured), and delegating to `reconcileCheckoutSession` for idempotent reconciliation.
  - Added `action=reconcile-checkout` to `api/stripe-payment-methods.js` routing table and handler dispatch without increasing Vercel function count.
  - Appended `&session_id={CHECKOUT_SESSION_ID}` to `success_url` in `api/create-checkout-session.js` and `server/endpoints/airportCheckout.js`.
  - Updated `tests/apiRoutes.test.js` to include `reconcile-checkout` in `pay.allowed` and verify route resolution and non-400 dispatch.
  - Added automated test cases in `server/checkoutReconcile.test.js` verifying 405 on non-POST, 503 on unconfigured Stripe/service role, 401 on unauthenticated, 400 on missing/malformed sessionId, 403 on mismatched rider ownership, 200 on unpaid/paid idempotent execution, and `session_id={CHECKOUT_SESSION_ID}` carry on success_urls.
- **Files touched:**
  - `server/endpoints/reconcileCheckout.js`
  - `api/stripe-payment-methods.js`
  - `api/create-checkout-session.js`
  - `server/endpoints/airportCheckout.js`
  - `tests/apiRoutes.test.js`
  - `server/checkoutReconcile.test.js`
  - `docs/FIXES.md`

## 2026-09-24 — Extract checkout deposit reconciliation and add fallback on-demand reconcile

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-checkout-reconcile / branch deputy/checkout-reconcile
- **Problem:** A paid airport deposit was only marked paid by `api/stripe-webhook.js` (`checkout.session.completed` / `async_payment_succeeded`). If the webhook endpoint or secret was misconfigured, delayed, or missed, the rider paid but the trip never showed the deposit.
- **Root cause:** The deposit marking logic was embedded directly in `api/stripe-webhook.js` without an idempotent standalone module or an on-demand reconciliation endpoint function. Furthermore, `recordDeposit` did not guard against duplicate payments rows or repeated `fare_paid_cents` increments on repeated calls.
- **Fix:**
  - Created `server/checkoutReconcile.js`:
    - `recordDeposit(supabase, session, deps)`: Idempotently inserts deposit into `public.payments` keyed on `stripe_payment_intent_id` / session ID / trip deposit, prevents duplicate payment rows, stamps `checkout_deposit` on `trips.metadata`, and only increments `fare_paid_cents` once.
    - `applyPaidCheckoutSession(serviceClient, session, deps)`: Applies the exact deposit side effects as the webhook (payments deposit insert, restoring canceled live trip, and referral social grant).
    - `reconcileCheckoutSession({ stripe, sb, sessionId, userId })`: Validates `cs_` session ID, retrieves Stripe Checkout session, enforces rider ownership on `trip.rider_id` (403 if mismatched), skips `credit_purchase` sessions, returns `{ ok: true, paid: false }` with no writes if unpaid, and applies deposit reconciliation if paid.
  - Refactored `api/stripe-webhook.js` to delegate checkout deposit marking to `applyPaidCheckoutSession` while preserving existing webhook responses, logging, and regex compatibility with test suites.
  - Added comprehensive tests in `server/checkoutReconcile.test.js` covering first-time paid, second-time paid idempotency, unpaid session, unauthorized rider session, invalid session IDs, Stripe API errors, and webhook integration.
- **Files touched:**
  - `server/checkoutReconcile.js`
  - `server/checkoutReconcile.test.js`
  - `api/stripe-webhook.js`
## 2026-09-24 — lostFoundClient updateReport missing requireClient validation

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-lostfound-tests
- **Problem:** When `supabase` was null or undefined, `updateReport` (used by `confirmFound`, `confirmNotFound`, `markReturned`, `closeLostFoundReport`, and `saveSupportNote`) threw an unhandled `TypeError: Cannot read properties of ...` instead of the standard `'Supabase is not configured'` error thrown by all other client functions.
- **Root cause:** `updateReport(supabase, id, patch)` directly accessed `supabase.from(...)` without calling `requireClient(supabase)`.
- **Fix:** Added `requireClient(supabase)` check at the top of `updateReport(supabase, id, patch)` in `packages/rides-native/lostFoundClient.js`. Updated corresponding unit tests in `packages/rides-native/lostFoundClient.test.js` to assert `Supabase is not configured`.
- **Files touched:**
  - `packages/rides-native/lostFoundClient.js`
  - `packages/rides-native/lostFoundClient.test.js`
  - `docs/FIXES.md`
## 2026-09-24 — Wire driverOnboardingClient unit tests into package.json test script (task t3)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-driver-onboarding-tests
- **Problem:** `packages/rides-native/driverOnboardingClient.test.js` needed to be wired into the repository-wide test runner as the final test entry in `package.json` so full test runs and CI validate driver onboarding client workflows on every run.
- **Fix:** Confirmed and verified `packages/rides-native/driverOnboardingClient.test.js` is appended as the last entry of the `"test"` script in `package.json`.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`
- **Verified:** Full `npm test` passes all 372/372 tests (including 21/21 tests in `packages/rides-native/driverOnboardingClient.test.js`).

## 2026-09-24 — Guard agreementPlainText against null inputs (task t2)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-driver-onboarding-tests
- **Problem:** `agreementPlainText` in `packages/rides-native/driverOnboardingClient.js` coerced falsy input directly with `String(html)`, causing `agreementPlainText(null)` to evaluate to `"null"` instead of returning an empty string.
- **Fix:** Added a null/undefined guard (`if (html == null) return ''`) before processing string replacements in `agreementPlainText`. Updated test in `packages/rides-native/driverOnboardingClient.test.js` to assert `agreementPlainText(null) === ''`.
- **Files touched:**
  - `packages/rides-native/driverOnboardingClient.js`
  - `packages/rides-native/driverOnboardingClient.test.js`
  - `docs/FIXES.md`
- **Verified:** `node --experimental-strip-types --test packages/rides-native/driverOnboardingClient.test.js` passes 21/21 tests; `npm test` passes 372/372.

## 2026-09-24 — Add unit test coverage for driverOnboardingClient (task t1)

- **Track / machine:** Clemson RIDES · worktree deputy-pkg-driver-onboarding-tests
- **Problem:** `packages/rides-native/driverOnboardingClient.js` lacked dedicated unit test coverage for its exports, Supabase query chains, RPC handling, API fallbacks, schema-error degradation, and TIN confidentiality guarantee.
- **Fix:** Created `packages/rides-native/driverOnboardingClient.test.js` covering every export without requiring a real device, Supabase instance, or network:
  - Validated version constants and shared re-exports.
  - Formatted agreement plain text from HTML, preserving headings/paragraphs and marking edge cases.
  - Verified requireClient-style error checks on save paths and documented `fetch*` null-return behavior with `// BUG?:` annotations.
  - Tested chained Supabase queries for applications, documents, tax profile, and contractor agreement, including schema cache error fallback paths.
  - Validated `loadOnboarding` aggregation for empty vs fully-completed states.
  - Verified `saveDriverTaxInfo` and `saveDriverW9` payload shapes to RPC/database, strictly asserting that raw TIN digits are never printed to console logs.
  - Tested `signDriverAgreement` and `submitDriverReview` happy paths and auth-missing/API-unavailable direct fallback paths.
  - Tested `uploadDriverDocument` validations, storage upload, document upsert, old file cleanup, and schema fallback.
  - Tested `saveDriverInfo` quiz validations and API signup with direct save fallback.
  - Added test suite to root `package.json` test script.
- **Files touched:**
  - `packages/rides-native/driverOnboardingClient.test.js`
  - `package.json`
  - `docs/FIXES.md`
- **Verified:** 21/21 tests pass via `node --experimental-strip-types --test packages/rides-native/driverOnboardingClient.test.js`; full test suite passes 372/372.

## 2026-09-24 — sendTripQuickReply validates phrase before checking supabase client

- **Track / machine:** Clemson RIDES · pkg-trip-messages-tests
- **Problem:** `sendTripQuickReply(supabase, { tripId, phrase })` checked `canonicalQuickReply(phrase)` before validating that the Supabase client was provided, unlike `fetchTripChat`, `listTripMessages`, and `sendTripMessage` which all call `requireClient(supabase)` first. Calling `sendTripQuickReply` with an unconfigured client and an unknown phrase threw "Unknown quick reply" instead of "Supabase is not configured", while calling it with a known phrase threw "Supabase is not configured".
- **Fix:** Added `requireClient(supabase)` at the start of `sendTripQuickReply` in `packages/rides-native/tripMessagesClient.js`, matching the behavior of the other exported client functions. Updated test in `packages/rides-native/tripMessagesClient.test.js`.
- **Files touched:**
  - `packages/rides-native/tripMessagesClient.js`
  - `packages/rides-native/tripMessagesClient.test.js`
  - `docs/FIXES.md`

## 2026-09-24 — Remove Clerk: Apple + Google social sign-in directly on Supabase Auth

- **Track / machine:** Clemson RIDES · worktree feat/supabase-auth-remove-clerk
- **Symptom:** "Clerk session token was rejected" on social sign-in.
- **Root cause:** iOS build 17 shipped a `pk_test` publishable key for the Clerk dev instance `choice-gibbon-3653` while the production server only had the `sk_live` `CLERK_SECRET_KEY`, so the `/api/clerk-supabase-session` bridge rejected every token.
- **Fix:** Removed Clerk entirely. Apple and Google now go directly through Supabase Auth, eliminating the bridge and secret mismatch:
  - Apple sign-in uses native `expo-apple-authentication` with a SHA-256 hashed nonce exchanged via `supabase.auth.signInWithIdToken`, saving name and email to `profiles` on first sign-in without overwriting existing data.
  - Google sign-in uses Supabase `signInWithOAuth` + `WebBrowser.openAuthSessionAsync` and `completeGoogleSession` with deep-link redirects `clemsonrides://auth/callback` and `clemsonrides-driver://auth/callback`.
  - Dropped Facebook provider entirely.
  - `createAuth` `ensureProfile` runs on `SIGNED_IN` and may write the email local-part (or `Rider`) as a placeholder `full_name` before the Apple name arrives; the Apple path treats those placeholders as empty so the real first-sign-in name still lands.
  - Profile gate open routes: `sso-callback` replaced by `auth` (the `auth/callback` Google/Apple web redirect; `useSegments()[0]` is `auth`).
  - Removed all Clerk dependencies (`@clerk/backend`, `@clerk/expo`, `@clerk/expo-google-signin`, `expo-auth-session`).
- **Deleted files:**
  - `api/clerk-supabase-session.js`
  - `server/clerkSupabaseBridge.js`
  - `server/clerkSupabaseBridge.test.js`
  - `apps/rider/lib/clerkBridge.ts`
  - `apps/rider/lib/clerkEnv.ts`
  - `apps/rider/lib/clerkSocial.tsx`
  - `apps/rider/lib/freshAuth.ts`
  - `apps/rider/components/StaleSessionGuard.tsx`
  - `apps/rider/app/sso-callback.tsx`
  - `apps/driver/lib/clerkBridge.ts`
  - `apps/driver/lib/clerkEnv.ts`
  - `apps/driver/lib/clerkSocial.tsx`
  - `apps/driver/lib/freshAuth.ts`
  - `apps/driver/components/StaleSessionGuard.tsx`
  - `apps/driver/app/sso-callback.tsx`
  - `packages/rides-native/staleSession.js`
  - `packages/rides-native/staleSession.d.ts`
  - `packages/rides-native/staleSession.test.js`
- **Verified:** no Clerk references outside this log; rider + driver `tsc --noEmit` clean; `npm test` 351/351; `vite build`; `expo config` + `expo prebuild --no-install` for both apps (Apple entitlement present).
- **External config still required (dashboards, not code):** Supabase Apple provider (client IDs `com.ascendmaui.clemsonrides.rider`, `com.ascendmaui.clemsonrides.driver`, team `L85AF3V872`); Supabase Google provider (ascendmaui Google OAuth web client); redirect allow list `clemsonrides://**`, `clemsonrides-driver://**`; Resend SMTP in Supabase; remove `CLERK_SECRET_KEY` from Vercel after deploy.

## 2026-09-24 — Fare in the idempotency key opened a second PaymentIntent

- **Track / machine:** Clemson RIDES · Pro (Grok Build, worktree fix/idem-key)
- **Problem:** A friend-share charge that stopped in `requires_action` (3DS) was not deduped when the fare moved before retry. A second PaymentIntent could be created. A first fix that dropped the amount from the trip key also made every later charge of that same kind look already paid.
- **Root cause:** The idempotency key was `friend:<ride>:<participant>:<fare_cents>`. Stripe also rejects reuse of a key when the amount parameter changes, so dropping the fare from the key is not enough: the retry has to retrieve the existing PaymentIntent instead of calling `paymentIntents.create` again. The same amount-in-key shape was on trip settle (`trip:kind:amount`), the collect-payment fallback, and wait charges (`clemson-wait-<trip>-<waitFee>-<cancelFee>`). A key with no generation at all collides with the next legitimate balance charge after `fare_paid_cents` moves.
- **Fix:** Friend-share keys are `friend_share:<rideId>:<userId>:charge`. Trip keys are `trip:<tripId>:<userId>:<kind>:paid<N>:charge`, where N is `trips.metadata.fare_paid_cents` before the attempt (admin uses `<kind>:admin` in that same shape). N does not move while a PaymentIntent is open, and it does move after a successful charge, so the next balance due is a new key. No charge amount is in the key. A stored PaymentIntent is retrieved: `requires_action` / `requires_payment_method` / `requires_confirmation` are returned, and the amount is updated only when the intent is still updatable and the server fare changed; `succeeded` / `processing` / `requires_capture` count as paid; a canceled intent is replaced under a new attempt suffix, including when an older payments row still says succeeded. Wait uses `wait:<tripId>:<userId>:charge`. Card and credits keys stay suffixes (`:card`, `:credits`). `midride_cancel_<tripId>` already had no amount; a stored intent on that path is reused through `collectPayment`.

## 2026-09-24 — Friend confirm charged a few cents off the reviewed share

- **Track / machine:** Clemson RIDES · Pro (Grok Build, worktree fix/quote-ttl)
- **Problem:** Confirming a friend ride re-priced the route on the server and charged that new share. Friend fares use traffic-aware routes billed per minute, so the charged share could differ by a few cents from the share the organizer had just reviewed.
- **Root cause:** `confirm-charges` always called `recomputeRideFares`. The 10-minute review memo in `reviewedFriendQuoteFresh` only skipped the client re-price. The server did not keep the reviewed cents.
- **Fix:** Pricing a friend ride stores `fare_breakdown.friend_quote` (quote id, per-participant share cents, signature, created_at, expires_at, 10-minute TTL). Confirm sends that quote id. A fresh quote for the same ride and the same participant set is charged exactly, and the server does not re-price. A missing, expired, mismatched, or participant-changed quote is re-priced, stored, and returned as `review_required` with no charge. Shipped rider builds that call confirm-charges with no quote id still charge a fresh stored quote; that path is logged as `legacy_no_quote_id`. A quote id that is present but does not match, or a signature that does not match, still requires review and does not charge. Web `FriendRide.jsx` and native `carpool/[token].tsx` show a new quote once in the existing review UI, then the next confirm charges it. Client amount fields are ignored. The Stripe idempotency key format is unchanged.

## 2026-09-24 — iOS build 17 (rider + driver) local Archive on Max: notes

- **Track / machine:** Clemson RIDES · Max / TestFlight 1.1.0(17) from main a795b18 (PRs #59–#66)
- **Build number:** `ios.buildNumber` in apps/{rider,driver}/app.json is the source of CFBundleVersion after prebuild (Info.plist is written with the literal value). Bumped 16 → 17 in both; `CURRENT_PROJECT_VERSION` is also set by the signing patch script.
- **Recipe (same as b16, worked first try):** `npm install` per app (postinstall re-applies `expo-modules-jsi+57.1.0.patch`) → `CI=1 npx expo prebuild -p ios --clean` (restore `ios/.xcode.env.local` afterwards, and revert the `package.json` script rewrite / lockfile churn prebuild and npm leave behind) → patch Release config of the app target only to Manual signing (`iPhone Distribution: John Mathews (L85AF3V872)`, profile UUID) → `xcodebuild archive` + `-exportArchive` (method app-store-connect, manual) → `xcrun altool --upload-app --apiKey 4848BPQ54J --apiIssuer …`. Scripts in /tmp/clemson-archives/b17/.
- **Problem:** A build started with `nohup bash -c '…' &` from a non-interactive remote shell was killed when that shell call returned (log stopped at "Resolve Package Graph", no xcodebuild process left).
- **Fix:** Run the archive in a managed background job (or keep the call in the foreground) instead of a detached `nohup … &`.
- **TestFlight groups:** "App Store Connect Users" (both apps) and "Tonight Internal" (rider) have `hasAccessToAllBuilds = true`, so a VALID build joins them on its own. `POST /v1/betaGroups/{id}/relationships/builds` answers 422 "Cannot add internal group to a build". That is expected, not a failure. Check with `GET /v1/builds?filter[app]=…&filter[version]=N&include=betaGroups`.

## 2026-09-24 — Ambassador payout ledger could record the same trip twice

- **Track / machine:** Clemson RIDES · Pro (Grok Build, worktree fix/payout-unique)
- **Problem:** Settling a carpool could insert two `public.ambassador_payout_ledger` rows for the same trip and ambassador code, so one completed trip could be paid out twice.
- **Root cause:** `settleCarpoolSideEffects` in `server/carpoolSettle.js` did a plain `.insert()` on every run. The table had no unique key on `(trip_id, code)`. The ambassador identity column is `code` (`profile_id` is nullable and is not written). `ambassadorStats` in `server/carpoolService.js` only reads the ledger.
- **Fix:** Additive unique index `ambassador_payout_ledger_trip_code_uniq` on `(trip_id, code)`, mirrored in `supabase/carpool_flagship.sql`. The settle path upserts with `onConflict: 'trip_id,code'` and `ignoreDuplicates: true` (`INSERT ... ON CONFLICT DO NOTHING`) and reports `ledgered` or `already_ledgered`. A Postgres 23505 unique violation is `already_ledgered`. A read-only check of production found 0 ledger rows and 0 duplicate `(trip_id, code)` pairs, so the unique index is safe to add.

## 2026-09-24 — Rider tsc fails on ambassador attribution (PR #65)

- **Track / machine:** Clemson RIDES · Max (/tmp worktree) / PR review
- **Problem:** `tsc --noEmit` in apps/rider failed with 3 errors: TS18047 `'user' is possibly 'null'` twice in app/friends.tsx (`loadAmbassadorCode(user.id)`), and TS2345 in lib/ambassadorCode.ts (`string | null` not assignable to `null | undefined`).
- **Root cause:** `packAttribution(code, userId = null)` and `attributionForUser(raw, userId)` in packages/rides-native/shared/ambassadorAttribution.js had no JSDoc, so tsc inferred the `userId` parameter as the literal `null` from the default. friends.tsx dereferenced `user` after `requireUser`, which TypeScript cannot narrow.
- **Fix:** JSDoc `string | null | undefined` on `packAttribution`, `unpackAttribution`, `attributionForUser`; `user?.id` in friends.tsx (loadAmbassadorCode already treats a missing id as signed out). No behavior change.

## 2026-09-24 — Friend confirm could ask for review forever (PR #63)

- **Track / machine:** Clemson RIDES · Max (/tmp worktree) / PR review
- **Problem:** PR #63 re-priced the friend ride on every Confirm tap and held the charge whenever the refreshed shares differed from the screen. Friend fares use `computeRoutes` with `routingPreference: 'TRAFFIC_AWARE'` and bill 18¢/min, so each re-price can drift by a cent. A legitimate payment could be held with "Review each share" on every tap.
- **Root cause:** The gate compared against a fresh re-price each time instead of remembering which server quote the organizer had already been shown.
- **Fix:** `markFriendQuoteReviewed` stores the id:fare signature of the quote put on screen for review. On the next Confirm, `reviewedFriendQuoteFresh` (same signature, within 10 min) skips the client re-price and goes straight to confirm-charges. At most one review round. Web `FriendRide.jsx` and native `carpool/[token].tsx`. Tests in `src/lib/friendSplitPreview.test.js`.
- **Still open:** Both the re-price drift and the fare-in-key idempotency bug are fixed. A fresh server quote is charged exactly, and an expired or mismatched quote is re-quoted for review without a charge. The friend-share key no longer includes the fare, and a retry reuses the open PaymentIntent instead of creating a second one.

## 2026-09-24 — Friend lobby preview disagreed with the charged share

- **Track / machine:** Clemson RIDES · Pro
- **Symptom:** Friends lobby showed a two-rider haversine guess (cents passed through `formatUsd` after dividing by 100) and the native lobby priced friend rides with the carpool engine. Confirm charges `participant.fare_cents`.
- **Root cause:** Preview math was client-side and separate from `recomputeRideFares` / confirm-charges. `formatUsd` already expects cents.
- **Fix:** Recompute stores `fare_breakdown.friend_split`. The lobby renders those shares, strikes this-route-alone only when the stored share still matches `fare_cents`, and holds the charge until that quote is on screen. Payment stays saved-card off-session or Payment Element.
- **Reuse:** Do not invent a friend-ride dollar amount from `quoteRide` or `quoteCarpool`. If `friend_split.share_cents` does not match `fare_cents`, show the share and omit the struck solo.

## 2026-09-24 — Driver earnings showed 80% of fare on carpool trips

- **Track / machine:** Clemson RIDES · Pro
- **Symptom:** Driver app earnings, recent activity, and trip details showed 80% of fare_cents and hid driver_carpool_bonus.
- **Root cause:** Period totals, the earnings list, and trip cards used driverNetCents(fare). loadEarnings did not select trips.metadata.
- **Fix:** Recent earnings and trip net use metadata.driver_payout_cents when set. Screens show base net, carpool bonus id driver_carpool_bonus, and that total.
- **Reuse:** Carpool driver take is trips.metadata.driver_payout_cents. Do not recompute 80% of the rider gross for those rows.

## 2026-09-24 — Rider tsc fails on dueScheduleReminders(ScheduledRow[]) (PR #59)
- **Problem:** `tsc --noEmit` in apps/rider failed with 2 × TS2345 in app/index.tsx and app/schedule.tsx: `ScheduledRow[]` not assignable to the `dueScheduleReminders` parameter (`status: string | null` vs `string | undefined`).
- **Root cause:** The JSDoc `@param` on `dueScheduleReminders` in src/lib/scheduledRideModel.js typed trip fields as `string | undefined`, but Supabase rows (`ScheduledRow`) use `string | null`. With `allowJs` + `strict`, tsc enforces the JSDoc type.
- **Fix:** Widened the JSDoc field types to `string | null` (runtime already handles null). No behavior change. Rider and driver `tsc --noEmit` are clean.
- **Machine/track:** Max (/tmp worktree) / PR review

## 2026-09-24 — Rider home misses live game day; scheduled reminders never surface
- **Problem:** Rider home folded `game_day_events` into the map caption, which stays hidden while busy spots load and does not reload on pull-to-refresh. Scheduled rides stored reminder windows (`m15` / `h1` / `h24`) but the rider app never showed a due reminder.
- **Root cause:** `loadGameDay` ran once on mount and only fed a pill. `nextReminder` was used by the web toast watcher, not by rider home or Schedule.
- **Fix:** Home shows a live card from `gameDayNotice` (pickup zone + rider fare multiplier) and reloads it with the map. `dueScheduleReminders` turns `REMINDER_WINDOWS` into an in-app card on home and Schedule. No push infra.
- **Machine/track:** Max / Clemson rider

## 2026-09-24 — Driver EAS Bundle JS: Unable to resolve `expo-router` from `rides-native`

- **Track / machine:** Clemson RIDES Track 1 · Max; EAS iOS driver
- **Symptom:** EAS Bundle JavaScript failed with Unable to resolve module expo-router from packages/rides-native/PartyScreens.jsx (build e394dd9a)
- **Root cause:** Metro hierarchical lookup from the shared package missed apps/driver/node_modules (same for rider)
- **Fix:** In apps/driver/metro.config.js and apps/rider/metro.config.js: nodeModulesPaths → app node_modules, disableHierarchicalLookup = true, map expo-router in extraNodeModules
- **Commit:** 5d7ced3 on main
- **Reuse:** Any monorepo app failing to resolve a dep imported only from packages/* — apply this Metro pattern before retrying EAS

## 2026-09-24 — iMac Grok Build not signed in

- **Track / machine:** Pool · Johns-iMac.lan
- **Symptom:** grok 1.0.41 installed but not signed in
- **Root cause:** Fresh CLI install, no auth session
- **Fix:** grok login --device-code (or XAI_API_KEY), then restart Track Grok sessions
- **Reuse:** New machine after x.ai CLI install always needs login first

## 2026-09-24 — Max Archive blocked by rejected Apple ID + missing Dist private key
- **Problem:** `xcodebuild archive` failed: Apple ID `jmat2019@icloud.com` login rejected; no Clemson provisioning profiles; existing ASC `IOS_DISTRIBUTION` cert had no matching private key on Max.
- **Root cause:** Xcode session expired; Distribution cert was created elsewhere (EAS/other Mac).
- **Fix:** Create new `IOS_DISTRIBUTION` via ASC API + local CSR (key `6H7HDQ63GC`), import p12 with OpenSSL legacy PBE, create `IOS_APP_STORE` profiles for driver (`8C2AYZQR49`) and rider (`JHVL57MM9D`), Archive with `CODE_SIGN_STYLE=Manual` + Dist identity. ASC API key `4848BPQ54J` / issuer `0b967e85-198f-44c7-a585-81aa3cc13ea7` (DictasteNotary profile).
- **Machine/track:** Max / Clemson rider+driver

## 2026-09-24 — ExpoModulesJSI Archive fail on Xcode 26 (RuntimeScheduler SWIFT_RETURNS_*)
- **Problem:** Archive failed in `ExpoModulesJSI` script / header: `RuntimeScheduler` constructors annotated `SWIFT_RETURNS_RETAINED` but type is not `SWIFT_SHARED_REFERENCE` (Xcode 26.2 / iOS SDK 26.2).
- **Root cause:** expo-modules-jsi 57.1.0 headers incompatible with stricter Swift interop in Xcode 26.
- **Fix:** Strip `SWIFT_RETURNS_RETAINED` / `SWIFT_RETURNS_UNRETAINED` from `node_modules/expo-modules-jsi/.../RuntimeScheduler.h` in driver + rider before Archive. Prefer lasting patch-package or Expo bump when available.
- **Machine/track:** Max / Clemson driver+rider local Archive

## 2026-09-24 — EAS free iOS quota exhausted + Xcode 26 ExpoModulesJSI blocks tip rebuild
- **Problem:** Cannot queue new EAS iOS production builds until ~Oct 1 2026 (free plan used). Local `xcodebuild archive` on Max (Xcode 26.3) fails in `ExpoModulesJSI` (`JavaScriptRuntime.swift` Swift 6 send/data-race + prior SWIFT_RETURNS_RETAINED).
- **Workaround shipped:** Delivered existing Internal TF 1.1.0(13) for driver (ASC 6815445517) and rider (ASC 6815430021) + admin URL on bf7330c.
- **Unblock tip rebuild:** (1) `eas billing:subscribe starter` or wait for Oct reset, or (2) install Xcode 16 side-by-side for Archive, or (3) Expo bump that builds clean on Xcode 26. Dist identity `6H7HDQ63GC` + App Store profiles already on Max for manual Archive.
- **Machine/track:** Max / Clemson


## 2026-09-24 — ExpoModulesJSI fails to compile on Xcode 26.3 (Swift 6.2.4) — FIXED via patch-package
- **Problem:** `[CP-User] Build ExpoModulesJSI xcframework` (nested SwiftPM `xcodebuild` of `node_modules/expo-modules-jsi/apple/Package.swift`) fails:
  - `apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h:53:26` and `:61:26` — `'RuntimeScheduler' cannot be annotated with either SWIFT_RETURNS_RETAINED or SWIFT_RETURNS_UNRETAINED because it is not returning a SWIFT_SHARED_REFERENCE type`
  - `apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift:193:43, 786:22, 787:66, 789:58, 829:66, 830:27, 831:58` — `sending 'resultPtr'/'thisPtr'/'argumentsPtr' risks causing data races` (`nonisolated(unsafe) let` pointer captured by `JavaScriptActor.assumeIsolated` closure).
- **Root cause:** Expo SDK 56/57 require Xcode 26.4+ (Swift 6.3). expo-modules-jsi 57.1.0 (latest 57.1.1 unchanged) uses constructs that Swift 6.3 accepts but Swift 6.2.x rejects. Package sets `swiftLanguageModes: [.v6]` + upcoming features, so Podfile `SWIFT_VERSION`/`SWIFT_STRICT_CONCURRENCY` or expo-build-properties do not reach it (separate SwiftPM build). Swift 5 mode breaks other files. Passing `OTHER_SWIFT_FLAGS` on the nested xcodebuild wipes the C++ interop flags (`'exception' file not found`). Xcode 16 is not an option (`swift-tools-version: 6.2`); Xcode 26.4+ needs Apple ID download.
- **Fix:** `apps/{driver,rider}/patches/expo-modules-jsi+57.1.0.patch` (patch-package, `postinstall`): drop `SWIFT_RETURNS_RETAINED` on the two constructors (same as upstream SDK 58) and wrap the three raw pointers in a zero-cost `@unchecked Sendable` struct (`UnsafeSendablePointer`) instead of `nonisolated(unsafe) let`. Verified by compiling only ExpoModulesJSI (`build-xcframework.sh`, PLATFORM_NAME=iphoneos), then full Archive.
- **Also:** `ios/` was stale vs app.json (`userInterfaceStyle` automatic) → re-ran `npx expo prebuild -p ios`. Global `PROVISIONING_PROFILE=` on the xcodebuild command line breaks SwiftPM resource targets (Clerk, PhoneNumberKit) → set Manual signing on the app target's Release config only, with full identity `iPhone Distribution: John Mathews (L85AF3V872)` (plain "iPhone Distribution" picks the Apple Distribution cert).
- **Remove when:** Xcode ≥26.4 installed on Max, or expo-modules-jsi bump (patch file name is version-pinned; patch-package fails loudly on mismatch).
- **Machine/track:** Max / Clemson driver+rider

## 2026-09-24 — Rider stuck auth: "You're already signed in" but app shows login (Google, Apple, Facebook, create-account)
- **Problem:** Rider TestFlight: Continue with Google / Apple (Face ID) / Facebook answered "You're already signed in" while the app still showed the login screen; the account icon did nothing. Create-account left the stale state in place.
- **Root cause:** The app's signed-in gate is the Supabase session (`createAuth`), but Clerk (social only, `single_session_mode: true` on instance choice-gibbon-3653) restores its own client JWT from expo-secure-store (`tokenCache`, key `__clerk_client_jwt`). When the Supabase session or profile row was gone (failed bridge, expired refresh, sign-out that missed Clerk), nothing reconciled the two, so Clerk kept rejecting new sign-ins with `session_exists` while the UI treated the rider as signed out.
- **Fix (branch `fix/rider-stale-session`, uncommitted):**
  - `apps/rider/lib/freshAuth.ts`: one shared guard. `ensureFreshAuth()` proves a cached Clerk session produces an account (Supabase session, bridging Clerk -> Supabase if needed, plus a profiles row, created on first login like `ensureProfile`); otherwise Clerk `signOut()` + `tokenCache.clearToken('__clerk_client_jwt')`. `withFreshAuth()` runs it before an attempt and again on `session_exists`, then goes into the app or retries the real flow once. Network errors never sign a rider out.
  - `lib/clerkSocial.tsx`: Google, Apple, and Facebook (all three providers in `RIDER_SOCIAL_PROVIDERS`) go through `withFreshAuth`. After `setActive` + bridge, success only once `checkAccountLoads()` passes.
  - `app/sign-up.tsx`: email create-account (Supabase `auth.signUp`; there is no Clerk `signUp.create` in the rider app) runs behind the same guard.
  - `components/StaleSessionGuard.tsx` + `app/_layout.tsx`: launch check (once per Clerk session id, at most one forced reset per launch, skipped while a sign-in is running). A reset signs out of Supabase and Clerk, clears the cache, and routes to `/sign-in`. App sign-out now also clears the Clerk token cache.
  - `app/index.tsx` avatar + `components/MainTabs.tsx` Account tab: no loaded account -> `/sign-in` (with `/account` as next).
  - `packages/rides-native/staleSession.js` (+ test): `isStaleSessionError`, `isTransientNetworkError`.
- **Driver:** does not use Clerk (Supabase-only Google OAuth, no `@clerk/*` dependency), so the Clerk guard does not apply there.
- **Machine/track:** Max / Clemson rider (worktree /Users/john/Projects/clemson-rides-authfix)
- **Ships via:** commit + PR, then new rider TestFlight build (needs approval)

## 2026-09-24 — Driver Google / Apple / Facebook sign-in + sign-up -> "error code 400"
- **Problem:** Driver TF 1.1.0(15): social sign-in and create-account fail with "error code 400". (Code on main only ever shipped a Google button, via Supabase OAuth; no driver branch has Apple/Facebook buttons.)
- **Root cause:** Driver social auth used Supabase Auth OAuth, and every external provider is off in Supabase project awktabuhijrshmsmagpq (`/auth/v1/settings` external: google=false, apple=false, facebook=false, email=true). `/auth/v1/authorize?provider={google|apple|facebook}&redirect_to=clemsonrides-driver://auth/callback` all return `400 {"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`. The rider works because it uses Clerk (choice-gibbon-3653, dev instance: google + facebook enabled, apple NOT enabled) and bridges into Supabase via `/api/clerk-supabase-session`.
- **Fix (worktree, uncommitted):** Driver moved onto the rider's Clerk path. Added `@clerk/expo` 4.6.9, `@clerk/expo-google-signin`, `expo-apple-authentication`, `expo-auth-session`, `expo-crypto` (same versions as rider); `apps/driver/lib/{clerkEnv,clerkBridge,clerkSocial,freshAuth}.ts(x)` + `components/StaleSessionGuard.tsx` (copies of the rider files, redirect `clemsonrides-driver://sso-callback`); `app/_layout.tsx` ClerkProvider + tokenCache + sign-out sync + launch guard; `app/sign-in.tsx` / `app/sign-up.tsx` use `DRIVER_SOCIAL_PROVIDERS` (Apple, Google, Facebook) through `withFreshAuth`; new `app/sso-callback.tsx`; `app.json` adds `@clerk/expo`, `@clerk/expo-google-signin` plugins + `ios.usesAppleSignIn`; removed Supabase-OAuth `lib/googleSignIn.ts`.
- **Bridge for drivers:** role-agnostic. It verifies the Clerk JWT, requires a verified email, and issues a Supabase magic-link hash for that email, so a driver gets the same auth.users row as email sign-up. `profiles.role` defaults to `rider` either way (no auth.users trigger); driver status comes from `driver_applications` / approval. So social and email drivers behave the same.
- **Needs native build:** new native modules + Clerk plugin (raises iOS deployment target to 17.0) -> new driver TestFlight build.
- **Dashboard (not done):** Clerk -> SSO connections: enable **Apple** (for both apps; native Apple needs bundle IDs `com.ascendmaui.clemsonrides.driver` and `.rider` in the Apple connection). Clerk -> Native applications: register the driver iOS app (Team ID + bundle `com.ascendmaui.clemsonrides.driver`) and allowlist `clemsonrides-driver://sso-callback`. Native Google needs an iOS OAuth client in Google Cloud for the driver bundle, added to Clerk's Google connection, with `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` on the driver EAS env; otherwise Google falls back to the browser SSO flow. Driver EAS env needs `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`. The Vercel bridge needs `CLERK_SECRET_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (already live for the rider).
- **Dashboard-only alternative (works on build 15, no rebuild, Google only):** Supabase -> Auth -> Providers -> Google on (Google Cloud **Web application** client, redirect URI `https://awktabuhijrshmsmagpq.supabase.co/auth/v1/callback`), and Supabase Redirect URLs add `clemsonrides-driver://auth/callback`.
- **Machine/track:** Max / Clemson driver

## 2026-09-24 — Rider social sign-in: Clerk works, bridge rejects the session (instance key mismatch)
- **Problem:** Rider TF 1.1.0(15): Google / Facebook / Apple all fail; hypothesis was "Clerk is the shared cause".
- **Evidence:**
  - Build 15 (both apps) was archived 15:49 ET from the main checkout (branch fix/expo-modules-jsi-xcode26, same code as main 5bca959). Rider Hermes bundle: 38 `clerk` strings, oauth_apple/google/facebook, `sso-callback`, `/api/clerk-supabase-session`, a pk_test for choice-gibbon-3653. It has no `EXPO_PUBLIC_CLERK_GOOGLE_*_CLIENT_ID` values, so native Google falls back to browser SSO. Driver bundle: 0 `clerk`, 0 oauth_* strings, `DRIVER_GOOGLE_PROVIDER` + Supabase `/auth/callback`, so the driver is Google-only via Supabase OAuth.
  - Clerk FAPI (dev instance ins_3JkxnM…): oauth_google / oauth_facebook sign_ins + sign_ups -> 200 for `clemsonrides://`, `clemsonrides-rider://`, and `clemsonrides-driver://sso-callback` (no redirect allowlist enforced), and the Google/Facebook consent pages load (Clerk shared dev creds). oauth_apple, oauth_token_apple, google_one_tap -> 422 `form_param_value_invalid` "... does not match one of the allowed values for parameter strategy".
  - Vercel `CLERK_SECRET_KEY` is `sk_live_` for the **production** instance ins_3JkydZ… (JWKS kid ins_3JkydZ…, domain clemson-airport-rides.vercel.app, `/__clerk` proxy not live, 0 redirect URLs). The apps' pk_test tokens are signed by kid ins_3JkxnM…, so `verifyToken` in `/api/clerk-supabase-session` can never verify them -> 401 "Clerk session token was rejected".
- **Root cause:** Clerk dev/prod instance mismatch: the apps authenticate against the development instance, but the Vercel bridge holds the production instance's secret, so every Google/Facebook sign-in dies at the bridge after Clerk succeeds. Apple is additionally disabled on the dev instance (422). The driver's 400 is separate (Supabase providers off; build 15 has no Clerk).
- **Fix (worktree, uncommitted, not deployed):** `server/clerkSupabaseBridge.js` `clerkSecrets()` + `verifyWithAnySecret()`; `api/clerk-supabase-session.js` tries `CLERK_SECRET_KEY` then `CLERK_SECRET_KEY_DEV` and loads the user with whichever secret verified; tests added. README documents `CLERK_SECRET_KEY_DEV`.
- **To ship:** add Vercel env `CLERK_SECRET_KEY_DEV` = dev instance (choice-gibbon-3653) `sk_test_…` from Clerk dashboard -> API keys (Development), then deploy. No app rebuild needed for rider Google/Facebook. Enable Apple on the dev instance (dashboard) for Apple.
- **Machine/track:** Max / Clemson rider + bridge

## 2026-09-24 — tripWait rejects blank ids and bad fee / clock inputs

- **Date:** 2026-09-24
- **What was wrong:** `assertAction` accepted a whitespace-only `tripId`. `applyTripWait` accepted a whitespace-only or non-string `actorId`. `chargeWaitFees` threw or charged on a missing trip, and it forwarded negative or fractional fee cents. An unparseable `server_now` was passed into `quoteWait`, so elapsed time and the clock could become NaN.
- **What changed:** Blank `tripId` and `actorId` now fail with the existing 400 / 401 errors. `chargeWaitFees` skips a null, non-object, or id-less trip (`nothing_to_charge`) and clamps each fee to a non-negative integer cent amount. Quote math uses `Date.now()` when `server_now` is not a finite timestamp; the raw `serverNow` string is still returned.
- **Files touched:** `server/tripWait.js`, `server/tripWait.test.js`, `docs/FIXES.md`

## 2026-09-25 — wire tripWait tests into npm test

- **Date:** 2026-09-25
- **What was wrong:** `server/tripWait.test.js` was not listed in the `package.json` `test` script, so `npm test` never ran the trip-wait unit tests.
- **What changed:** Appended `server/tripWait.test.js` as the last entry of the `test` script. The script still uses `node --experimental-strip-types --test` and does not change any other file list entry.
- **Files touched:** `package.json`, `docs/FIXES.md`

## 2026-09-24 — Demand heat helper had no unit tests

- **What was wrong:** `packages/rides-native/heat.js` exported the demand heat helpers with no tests. Two behaviours look wrong and are pinned for the current code, not changed in this task:
  - `barCurve` checks `hour < 16` before `hour < 2`, so midnight and 1am use the daytime-quiet intensity (Fri/Sat 0.08, otherwise 0.04) instead of the late-night branch (Fri/Sat 0.78, Thursday 0.45, otherwise 0.16). Friday midnight downtown stays "Picking up" instead of "Packed".
  - `previewDate('weekday_am')` on Saturday uses delta -5 and lands on Monday 08:30. Every other day anchors on Wednesday 08:30.
- **What changed:** Added `packages/rides-native/heat.test.js` for every export (normal cases, intensity and clock boundaries, unknown window ids, returned shapes). Suspected bugs are asserted as current behaviour with `// BUG?:` comments. Registered the file on the root `npm test` script.
- **Files touched:** `packages/rides-native/heat.test.js`, `package.json`, `docs/FIXES.md`.

## 2026-09-24 — Saturday weekday-morning preview landed on Monday

- **What was wrong:** `previewDate('weekday_am')` special-cased Saturday (`getDay() === 6`) with delta -5, so 2026-09-26 previewed Monday 2026-09-21 08:30. Every other day anchors on Wednesday 08:30 (`day === 0 ? -4 : 3 - day`). Rider and driver busy-spot maps only use that date for `downtownNow` / `typicalSpots`. Hour 8 on Monday and Wednesday already share the same curve outputs, so the map colors do not change; the calendar date does.
- **What changed:** Saturday now uses `3 - day` (delta -3) and lands on Wednesday 08:30, same as Thursday and Friday. Sunday still goes back four days to the previous Wednesday. The midnight `barCurve` branch (`hour < 16` before `hour < 2`) is unchanged: those curves are shared with `src/lib/downtownHeat.js`, and fixing them would change live "now" intensities at midnight.
- **Files touched:** `packages/rides-native/heat.js`, `packages/rides-native/heat.test.js`, `docs/FIXES.md`.

## 2026-09-24 — Heat helper tests listed with the vehicle catalog

- **What t2 fixed:** `previewDate('weekday_am')` special-cased Saturday (`getDay() === 6`) with delta -5, so 2026-09-26 previewed Monday 2026-09-21 08:30. Every other non-Sunday day already anchored on Wednesday 08:30 (`3 - day`). Saturday now uses that same delta (-3) and lands on Wednesday 2026-09-23 08:30. Sunday still goes back four days to the previous Wednesday. The midnight `barCurve` branch (`hour < 16` before `hour < 2`) was left unchanged because those curves are shared with `src/lib/downtownHeat.js`.
- **Tests:** `packages/rides-native/heat.test.js` covers `heatColor`, `downtownNow`, `previewDate`, `typicalSpots`, `resolveDemandRange`, `DOWNTOWN_VENUES`, and `CAMPUS_ANCHORS` with injected `Date` objects (no `Date.now()`). The Saturday case expects Wednesday 08:30 and the same `typicalSpots` intensities as that Wednesday morning. Color thresholds, curve hour and weekday boundaries, unknown window ids, and returned shapes are covered. The midnight bar intensity is still asserted as the current daytime floor.
- **What changed here:** The root `npm test` script lists `packages/rides-native/heat.test.js` immediately after `packages/rides-native/vehicleCatalog.test.js` (it had been inserted later, after `mapsLink.test.js`).
- **Files touched:** `package.json`, `docs/FIXES.md`.

## 2026-09-24 — Notification prefs had no unit tests

- **What was wrong:** `packages/rides-native/notificationPrefs.js` (categories, defaults, `quietFromPrefs`, `normalizePrefs`, local read/write, profile fetch/save) had no tests. A few current behaviors look wrong and are locked by the new tests with `// BUG?:` comments instead of being changed: `HH:MM` only checks two digits (`99:99` is kept); `Boolean("false")` turns promotions, DND, and new-request tones on; ride/billing/friends/system stay on for every value except boolean `false`; arrays and other non-plain objects pass the `typeof === "object"` check; unknown keys are copied through and would be written back to `profiles`; a stored `{}` replaces a richer device mirror with defaults; a Supabase error with no `message` sets fetch `softFail` to `undefined` (save uses a fallback string); `writeLocalPrefs` stores its argument without normalizing.
- **What changed:** Added `packages/rides-native/notificationPrefs.test.js` with in-memory storage and a fake Supabase client, including error paths. Did not change `notificationPrefs.js`.
- **Files:** `packages/rides-native/notificationPrefs.test.js`, `package.json` (test script), `docs/FIXES.md`

## 2026-09-24 — Quiet-hour clocks accepted impossible times

- **What was wrong:** `hhmm` in `packages/rides-native/notificationPrefs.js` kept any `\d{2}:\d{2}` string. `99:99` and `24:61` were stored on the quiet window and written back to the profile. A time input cannot display those values, and a later quiet-window check would treat them as real minutes.
- **What changed:** Hours must be `00`–`23` and minutes `00`–`59`. Valid clocks such as `00:00`, `21:30`, and `23:59` are unchanged. Anything else, including `24:00` and `23:60`, falls back to the default start (`22:00`) or end (`07:00`). Other flagged behaviors (string `"false"` switches, array records, unknown keys, empty profile objects, missing error messages) are unchanged.
- **Files:** `packages/rides-native/notificationPrefs.js`, `packages/rides-native/notificationPrefs.test.js`, `docs/FIXES.md`

## 2026-09-24 — Notification prefs tests run with the vehicle catalog suite

- **What was wrong:** `hhmm` in `packages/rides-native/notificationPrefs.js` kept any `\d{2}:\d{2}` string, so `99:99` and `24:61` were stored on the quiet window and written back to `profiles.notification_prefs`. The module also had no unit tests. The new `notificationPrefs.test.js` was on the `npm test` list after `mapsLink.test.js` instead of immediately after `vehicleCatalog.test.js`.
- **What changed:** Quiet-hour hours must be `00`–`23` and minutes `00`–`59`. Valid clocks (`00:00`, `21:30`, `23:59`) stay as entered. Impossible times, including `24:00` and `23:60`, fall back to the default start `22:00` or end `07:00`. `packages/rides-native/notificationPrefs.test.js` covers `NOTIFICATION_CATEGORIES`, `DEFAULT_QUIET`, `DEFAULT_NOTIFICATION_PREFS`, `quietFromPrefs`, `normalizePrefs`, `readLocalPrefs`, `writeLocalPrefs`, `fetchNotificationPrefs`, and `saveNotificationPrefs` with in-memory storage and a fake Supabase client, including malformed input and error paths. The root `test` script now lists that file once, immediately after `packages/rides-native/vehicleCatalog.test.js`. String `"false"` switches, array records, unknown keys, empty profile objects, missing fetch error messages, and un-normalized `writeLocalPrefs` stay as they were.
- **Files:** `package.json` (test script only), `docs/FIXES.md`

## 2026-09-24 — Combine heat and notification-prefs test lists

- **What was wrong:** PRs #75 and #76 both inserted their test file immediately after `packages/rides-native/vehicleCatalog.test.js` in `package.json`, causing a merge conflict.
- **What changed:** This branch combines #75 and #76 and resolves their package.json test-list conflict (supersedes merging them separately).
- **Files:** `package.json`, `docs/FIXES.md`

## 2026-09-24 — Driver desk test suite (pkg-i9-driverdesk-tests t1)
- **Problem:** `packages/rides-native/driverDesk.js` had zero unit tests covering its driver desk helpers (availability, PickDriver requests, queue management, status advances, and earnings).
- **What was changed:** Created `packages/rides-native/driverDesk.test.js` covering all 18 exported functions (`formatCents`, `riderFacingCard`, `loadGameDay`, `loadVehicle`, `loadDriverProfile`, `setPriorityMode`, `publishDriverLocation`, `setTeslaListing`, `subscribeTrips`, `listPassedTripIds`, `publishDriverCapacity`, `acceptTrip`, `declineTrip`, `loadRiderFix`, `advanceTrip`, `loadTrip`, `loadDriverDesk`, `loadEarnings`) using an in-memory fake Supabase query builder. Covered happy paths, empty results, Supabase error results, missing/invalid arguments, and returned object shapes without network calls or non-deterministic date dependencies. Updated `package.json` test script to include the new test file.
- **Suspicious behaviors documented (`// BUG?:`):**
  - `riderFacingCard`: if `vehicle` is `{}` or lacks color/make/model, `vehicleLabel` evaluates to `""` instead of `'Vehicle TBD'`.
  - `publishDriverCapacity`: `Math.max(1, ...)` ensures `count` is always >= 1, so `if (!count)` is unreachable dead code; passing 0 or null seats sets seats to 1 rather than clearing them.
  - `loadDriverDesk`: missing `facing`, `lat`, `lng`, and `warning` keys when `driverId` or `supabase` is null/missing compared to full return object.
  - `acceptTrip`: checks `trip.status` rather than `fresh.status` from DB for online check and scheduled routing.
  - `loadTrip`: condition checking `driverId !== row.driver_id` returns `toDriverCard(row)` in both branches, making it a no-op.
  - `declineTrip`: passing a string `tripId` defaults status to `'requested'`, canceling the trip rather than releasing it to the open pool.
- **Files touched:**
  - `packages/rides-native/driverDesk.test.js`
  - `package.json`
  - `docs/FIXES.md`

## 2026-09-24 — Guard empty or sparse vehicle row in riderFacingCard (pkg-i9-driverdesk-tests t2)
- **Problem:** In `packages/rides-native/driverDesk.js`, `riderFacingCard` checked `vehicle ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ') : 'Vehicle TBD'`. When `vehicle` was an empty or sparse object (e.g. `{}` or missing `color`, `make`, and `model` from a newly initiated onboarding row), the joined string evaluated to `""` instead of falling back to `'Vehicle TBD'`, causing rider- and fleet-facing cards to display an empty vehicle string or broken plate-only text.
- **What was changed:** Updated `vehicleLabel` computation to `[vehicle?.color, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'Vehicle TBD'`, properly guarding empty and sparse vehicle rows while preserving full vehicle descriptions for valid inputs. Updated `packages/rides-native/driverDesk.test.js` to assert the `'Vehicle TBD'` fallback for empty and sparse vehicle objects.
- **Files touched:**
  - `packages/rides-native/driverDesk.js`
  - `packages/rides-native/driverDesk.test.js`
  - `docs/FIXES.md`

## 2026-09-24 — Register driverDesk.test.js in package.json test script (pkg-i9-driverdesk-tests t3)
- **Problem:** `packages/rides-native/driverDesk.test.js` needed to be registered as the last entry of the "test" script list in `package.json` and verified so that the entire test suite runs and passes cleanly.
- **What was changed:** Confirmed `packages/rides-native/driverDesk.test.js` is the last entry in `package.json`'s "test" script list. Resolved local environment test dependencies (`@electric-sql/pglite`, `qrcode`) and verified the entire test suite passes (`npm test` passes all 415 tests with 0 failures).
## 2026-09-24 — Friendly API error mapper (packages/rides-native/apiErrors)
- **Problem:** When server payment configuration was missing or failed, riders were exposed to raw technical messages such as 'STRIPE_SECRET_KEY is not configured.' or 'SUPABASE_SERVICE_ROLE_KEY not configured', or confusing 'Sign in required' auth messages.
- **What was wrong:** API response errors from server routes (503 for missing payment keys, 401 for auth, 402 for card failures) lacked a shared client-side mapper to sanitize technical config/env details and present safe, user-friendly error messages.
- **What was changed:** Created `packages/rides-native/apiErrors.js` and `packages/rides-native/apiErrors.d.ts` exporting `friendlyApiError(status, body)`.
  - 503 or body matching `/not configured|STRIPE_|SUPABASE_|service role|Payments unavailable/i` returns kind `'unavailable'` with message `'Payments are temporarily unavailable, please try again shortly'`, ensuring no raw environment variable names leak to users.
  - 401 returns kind `'auth'` with message `'Please sign in again to continue.'`.
  - 402 and card errors retain the server message if user-facing, or fall back to `'Something went wrong. Please try again.'`.
  - 5xx other returns kind `'server'` with generic message `'Something went wrong. Please try again.'`.
  - Network errors (status 0/undefined) return kind `'network'` with message `'Check your connection and try again.'`.
  - Added comprehensive test suite in `packages/rides-native/apiErrors.test.js`.
- **Files touched:**
  - `packages/rides-native/apiErrors.js`
  - `packages/rides-native/apiErrors.d.ts`
  - `packages/rides-native/apiErrors.test.js`
  - `docs/FIXES.md`

## 2026-09-24 — Authed fetch session refresh & friendly config error handling (t2)
- **Problem:** When server payment configuration was broken or missing (503/config errors), riders saw raw server configuration text (e.g. 'STRIPE_SECRET_KEY is not configured.' / 'SUPABASE_SERVICE_ROLE_KEY not configured') or 'Sign in required'. Expired or missing auth tokens immediately surfaced auth errors without attempting to refresh the session first.
- **What was wrong:** The authed fetch client (`authedJson` in `packages/rides-native/apiClient.js`) threw raw server error strings from response bodies without sanitizing them via `friendlyApiError`, and on 401 HTTP responses it did not attempt to refresh the Supabase session before failing.
- **What was changed:**
  - Updated `packages/rides-native/apiClient.js` `authedJson`:
    - On 401 status, calls `supabase.auth.refreshSession()` once; if a refreshed session with an access token is yielded, retries the request once with the new access token.
    - If refresh fails or yields no session (or retry fails), surfaces safe auth error (`Please sign in again to continue.`).
    - On 503 and server configuration errors (or bodies matching missing config patterns), throws an Error with friendly copy (`Payments are temporarily unavailable, please try again shortly`), keeping `status` and `code` on the error object without refreshing.
  - Re-exported `authedJson` from `packages/rides-native/riderMoney.js` and updated type definitions in `packages/rides-native/riderMoney.d.ts` and `packages/rides-native/apiClient.d.ts`.
  - Exported `authedJson` from `apps/rider/lib/apiAuth.ts`.
  - Updated `packages/rides-native/shared/carpoolApi.js` to delegate `authedJson` to `apiClient.js` and sanitize error messages using `friendlyApiError`.
  - Added unit test suite in `packages/rides-native/riderMoney.test.js` covering fake fetch + fake supabase.auth: 401 refresh succeeds and retries once, 401 refresh fails and surfaces auth error, 503 config error throws friendly message without refresh, 401 retry failure does not refresh a second time, and 500 config error returns friendly copy.
- **Files touched:**
  - `packages/rides-native/apiClient.js`
  - `packages/rides-native/apiClient.d.ts`
  - `packages/rides-native/riderMoney.js`
  - `packages/rides-native/riderMoney.d.ts`
  - `packages/rides-native/riderMoney.test.js`
  - `packages/rides-native/shared/carpoolApi.js`
  - `apps/rider/lib/apiAuth.ts`
  - `docs/FIXES.md`

## 2026-09-24 — Web authed fetch session refresh & friendly payment error handling (t3)
- **Problem:** On web (src/), when the server's payment config was broken (e.g. STRIPE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY missing, returning 503 or 500), riders could see raw config text ('STRIPE_SECRET_KEY is not configured.' / 'SUPABASE_SERVICE_ROLE_KEY not configured') or a hardcoded 'sign in required'. Stale/expired auth tokens on 401 caused failures without attempting to refresh the session first.
- **What was wrong:** Fetch helpers in `src/lib/payments.js`, `src/lib/stripeCheckout.js`, `src/lib/billingApi.js`, `src/lib/friendRides.js`, `src/lib/tripWaitApi.js`, and `src/lib/midrideCancel.js` threw raw server response errors or hardcoded strings without sanitizing via `friendlyApiError`, and on 401 responses they did not call `supabase.auth.refreshSession()` before failing.
- **What was changed:**
  - Added `src/lib/apiErrors.js` (re-exporting `friendlyApiError` and constants from `packages/rides-native/apiErrors.js`) and unit tests in `src/lib/apiErrors.test.js`.
  - Added `src/lib/apiClient.js` exporting `authedJson` (with `authedFetch` alias):
    - Automatically attaches Supabase session Bearer token from `supabase.auth.getSession()`.
    - On 401 status, calls `supabase.auth.refreshSession()` once and retries the request once if a refreshed token is returned.
    - On 503 / config errors, formats error messages using `friendlyApiError` so riders see "Payments are temporarily unavailable, please try again shortly" without leaking secrets/env vars.
    - Sets `.unavailable = true` on 503/unavailable and `.auth = true` on 401/auth errors.
  - Updated `src/lib/payments.js` `api()` to delegate to `authedJson`.
  - Updated `src/lib/billingApi.js` `api()` to delegate to `authedJson`.
  - Updated `src/lib/stripeCheckout.js` `createCheckoutSession` and `abandonCheckoutSession` to delegate to `authedJson` and sanitize 503 stubs/failures.
  - Updated `src/lib/friendRides.js`, `src/lib/tripWaitApi.js`, and `src/lib/midrideCancel.js` to route requests through `authedJson`.
  - Updated `src/screens/ScheduleAirport.jsx` to fall back to `UNAVAILABLE_COPY` and ensure error.message is shown.
  - Added unit test suites `src/lib/apiClient.test.js` and `src/lib/webPayments.test.js` verifying 401 refresh retries and 503 friendly error copy.
- **Files touched:**
  - `src/lib/apiErrors.js`
  - `src/lib/apiErrors.test.js`
  - `src/lib/apiClient.js`
  - `src/lib/apiClient.test.js`
  - `src/lib/payments.js`
  - `src/lib/billingApi.js`
  - `src/lib/stripeCheckout.js`
  - `src/lib/friendRides.js`
  - `src/lib/tripWaitApi.js`
  - `src/lib/midrideCancel.js`
  - `src/lib/supabase.js`
  - `src/screens/ScheduleAirport.jsx`
  - `src/lib/webPayments.test.js`
  - `docs/FIXES.md`

## 2026-09-24 — Wire new error-messages test suites into package.json test script (t4)
- **Problem:** Newly created unit test suites for friendly API errors and authedJson 401 retry / 503 friendly error handling (`packages/rides-native/apiErrors.test.js`, `src/lib/apiErrors.test.js`, `src/lib/apiClient.test.js`, and `src/lib/webPayments.test.js`) were not executed as part of `npm test`.
- **What was wrong:** The `"test"` script in `package.json` did not include the new error handling and auth retry test suites added in tasks t1 and t3.
- **What was changed:**
  - Appended `packages/rides-native/apiErrors.test.js`, `src/lib/apiErrors.test.js`, `src/lib/apiClient.test.js`, and `src/lib/webPayments.test.js` as the last entries of the `"test"` script in `package.json`.
  - Verified that all 385 tests pass under `npm test`.
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`





## 2026-09-24 — keep src/lib/supabase.js a static import (Chief of Staff review)
- What was wrong: the error-messages change turned `import { createClient } from '@supabase/supabase-js'` into a top-level `await import(...)`.
  Vite's build target (es2020 / safari14) has no top-level await, so `vite build` failed ("Top-level await is not available").
- What changed: restored the original static import. `npm test` (385/385) and `vite build` both pass.
- Files: src/lib/supabase.js
