# Build & blocker fixes log

Persistent knowledge base for recurring failures. When a matching issue appears, apply the saved fix first.

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
- **Still open:** Re-price drift is fixed: a fresh server quote is charged exactly, and an expired or mismatched quote is re-quoted for review without a charge. The Stripe idempotency key `friend:<ride>:<participant>:<fare_cents>` still includes the fare, so a retry after a later fare change is not deduplicated for an unpaid (e.g. requires_action) participant. That key format is not changed here.

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
