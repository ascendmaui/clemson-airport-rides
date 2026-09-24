# Build & blocker fixes log

Persistent knowledge base for recurring failures. When a matching issue appears, apply the saved fix first.

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
