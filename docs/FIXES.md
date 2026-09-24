# Build & blocker fixes log

Persistent knowledge base for recurring failures. When a matching issue appears, apply the saved fix first.

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
