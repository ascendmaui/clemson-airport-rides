# Build & blocker fixes log

Persistent knowledge base for recurring failures. When a matching issue appears, apply the saved fix first.

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
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`

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
- **Files touched:**
  - `package.json`
  - `docs/FIXES.md`

