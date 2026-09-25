# TypeScript Typecheck Report: apps/rider & apps/driver

**Date:** September 25, 2026  
**Environment:** macOS / Node.js `v22.22.3` / TypeScript `v6.0.3`  
**Repository Branch:** `deputy/apps-typecheck`

---

## 1. Typecheck Configuration Overview

TypeScript checking across the monorepo is configured and executed through a tiered setup:

### 1.1 Root `package.json` & `scripts/typecheck.mjs`
- **Root Script:**
  ```json
  "scripts": {
    "typecheck": "node scripts/typecheck.mjs"
  }
  ```
- **Execution Script (`scripts/typecheck.mjs`):**
  1. Inspects `apps/rider` and `apps/driver` dependencies. If local `node_modules` is missing, runs `npm ci --no-audit --no-fund --loglevel=error`.
  2. Runs `npm exec -- tsc --noEmit -p .` in `apps/rider` using Rider's local TypeScript compiler.
  3. Runs `npm exec -- tsc --noEmit -p .` in `apps/driver` using Driver's local TypeScript compiler.
  4. Runs `node --check <file>` across all production JavaScript sources in `api/` and `server/` to verify JS syntax.

### 1.2 App Configurations (`tsconfig.json`)

#### `apps/rider/tsconfig.json`
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./*"],
      "rides-native/*": ["../../packages/rides-native/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts"]
}
```

#### `apps/driver/tsconfig.json`
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./*"],
      "rides-native/*": ["../../packages/rides-native/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts"]
}
```

#### Base Configuration (`expo/tsconfig.base.json`)
Both applications extend `expo/tsconfig.base`, which sets:
- `moduleResolution: "bundler"`
- `module: "preserve"`
- `target: "ESNext"`
- `lib: ["DOM", "ESNext"]`
- `customConditions: ["react-native"]`
- `resolveJsonModule: true`
- `skipLibCheck: true`
- `noEmit: true`
- `esModuleInterop: true`

Both apps specify `strict: true` and `allowJs: true`, with `@/*` path aliases pointing to the respective app root and `rides-native/*` pointing to `../../packages/rides-native/*`.

---

## 2. Typecheck Execution Results Summary

| Target | Command | Files Checked | Error Count | Exit Status |
| :--- | :--- | :---: | :---: | :---: |
| **`apps/rider`** | `tsc --noEmit -p .` | 85 app files (+ 44 shared/server files) | **0** | Pass (0) |
| **`apps/driver`** | `tsc --noEmit -p .` | 63 app files (+ 26 shared files) | **0** | Pass (0) |
| **`api/` & `server/`** | `node --check <file>` | 18 JS sources | **0** | Pass (0) |
| **Root Suite** | `npm run typecheck` | Full monorepo | **0** | Pass (0) |

---

## 3. Error Counts by File

### 3.1 `apps/rider` (Total Errors: 0)

#### `apps/rider/app/` (Routes / Screens)
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/rider/app/+not-found.tsx` | 0 | Clean |
| `apps/rider/app/_layout.tsx` | 0 | Clean |
| `apps/rider/app/a/[code].tsx` | 0 | Clean |
| `apps/rider/app/account.tsx` | 0 | Clean |
| `apps/rider/app/auth/callback.tsx` | 0 | Clean |
| `apps/rider/app/billing.tsx` | 0 | Clean |
| `apps/rider/app/carpool/[token].tsx` | 0 | Clean |
| `apps/rider/app/carpool/_layout.tsx` | 0 | Clean |
| `apps/rider/app/carpool/add-vehicle.tsx` | 0 | Clean |
| `apps/rider/app/carpool/offer.tsx` | 0 | Clean |
| `apps/rider/app/confirm.tsx` | 0 | Clean |
| `apps/rider/app/delete-account.tsx` | 0 | Clean |
| `apps/rider/app/forgot-password.tsx` | 0 | Clean |
| `apps/rider/app/friends.tsx` | 0 | Clean |
| `apps/rider/app/help.tsx` | 0 | Clean |
| `apps/rider/app/history.tsx` | 0 | Clean |
| `apps/rider/app/index.tsx` | 0 | Clean |
| `apps/rider/app/legal.tsx` | 0 | Clean |
| `apps/rider/app/lost-found.tsx` | 0 | Clean |
| `apps/rider/app/notifications.tsx` | 0 | Clean |
| `apps/rider/app/pick-driver.tsx` | 0 | Clean |
| `apps/rider/app/profile-setup.tsx` | 0 | Clean |
| `apps/rider/app/promo.tsx` | 0 | Clean |
| `apps/rider/app/rate.tsx` | 0 | Clean |
| `apps/rider/app/requested.tsx` | 0 | Clean |
| `apps/rider/app/reset-password.tsx` | 0 | Clean |
| `apps/rider/app/safety.tsx` | 0 | Clean |
| `apps/rider/app/schedule.tsx` | 0 | Clean |
| `apps/rider/app/set-password.tsx` | 0 | Clean |
| `apps/rider/app/sign-in.tsx` | 0 | Clean |
| `apps/rider/app/sign-up.tsx` | 0 | Clean |
| `apps/rider/app/student.tsx` | 0 | Clean |
| `apps/rider/app/support.tsx` | 0 | Clean |
| `apps/rider/app/tiers.tsx` | 0 | Clean |

#### `apps/rider/components/` (UI Components)
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/rider/components/ApproachAlert.tsx` | 0 | Clean |
| `apps/rider/components/AssistChat.tsx` | 0 | Clean |
| `apps/rider/components/BootScreen.tsx` | 0 | Clean |
| `apps/rider/components/Button.tsx` | 0 | Clean |
| `apps/rider/components/CampusMap.native.tsx` | 0 | Clean |
| `apps/rider/components/CampusMap.tsx` | 0 | Clean |
| `apps/rider/components/ClemsonLoader.tsx` | 0 | Clean |
| `apps/rider/components/EmergencyContactsCard.tsx` | 0 | Clean |
| `apps/rider/components/LiveShareCard.tsx` | 0 | Clean |
| `apps/rider/components/MainTabs.tsx` | 0 | Clean |
| `apps/rider/components/RequireAuth.tsx` | 0 | Clean |
| `apps/rider/components/RideMessages.tsx` | 0 | Clean |
| `apps/rider/components/SignInToBookSheet.tsx` | 0 | Clean |
| `apps/rider/components/Skeleton.tsx` | 0 | Clean |
| `apps/rider/components/SosSheet.tsx` | 0 | Clean |
| `apps/rider/components/StackHeader.tsx` | 0 | Clean |
| `apps/rider/components/carpool/CarpoolCompare.tsx` | 0 | Clean |
| `apps/rider/components/carpool/NeighborhoodPicker.tsx` | 0 | Clean |
| `apps/rider/components/carpool/ui.tsx` | 0 | Clean |
| `apps/rider/components/mapTypes.ts` | 0 | Clean |

#### `apps/rider/lib/` (Application Logic & State)
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/rider/lib/accountApi.ts` | 0 | Clean |
| `apps/rider/lib/ambassadorCode.ts` | 0 | Clean |
| `apps/rider/lib/apiAuth.ts` | 0 | Clean |
| `apps/rider/lib/approachAlert.ts` | 0 | Clean |
| `apps/rider/lib/auth.tsx` | 0 | Clean |
| `apps/rider/lib/authNext.ts` | 0 | Clean |
| `apps/rider/lib/busySpots.ts` | 0 | Clean |
| `apps/rider/lib/elevation.ts` | 0 | Clean |
| `apps/rider/lib/feedback.ts` | 0 | Clean |
| `apps/rider/lib/friendsApi.ts` | 0 | Clean |
| `apps/rider/lib/oneParam.ts` | 0 | Clean |
| `apps/rider/lib/openCheckout.ts` | 0 | Clean |
| `apps/rider/lib/palette.ts` | 0 | Clean |
| `apps/rider/lib/passwordRecovery.tsx` | 0 | Clean |
| `apps/rider/lib/readLivePosition.ts` | 0 | Clean |
| `apps/rider/lib/recovery.ts` | 0 | Clean |
| `apps/rider/lib/scheduleApi.ts` | 0 | Clean |
| `apps/rider/lib/socialSignIn.ts` | 0 | Clean |
| `apps/rider/lib/solar.ts` | 0 | Clean |
| `apps/rider/lib/sosEngaged.ts` | 0 | Clean |
| `apps/rider/lib/storage.ts` | 0 | Clean |
| `apps/rider/lib/supabase.ts` | 0 | Clean |
| `apps/rider/lib/theme.tsx` | 0 | Clean |
| `apps/rider/lib/tripWatch.ts` | 0 | Clean |
| `apps/rider/lib/useDriverApproach.ts` | 0 | Clean |
| `apps/rider/lib/useLiveShare.ts` | 0 | Clean |
| `apps/rider/lib/useRegisteredVehicle.ts` | 0 | Clean |
| `apps/rider/lib/useRiderTrip.ts` | 0 | Clean |
| `apps/rider/lib/useStudentStatus.ts` | 0 | Clean |
| `apps/rider/lib/useThemedStyles.ts` | 0 | Clean |

#### Root Declarations
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/rider/wav.d.ts` | 0 | Clean |

---

### 3.2 `apps/driver` (Total Errors: 0)

#### `apps/driver/app/` (Routes / Screens)
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/driver/app/(tabs)/_layout.tsx` | 0 | Clean |
| `apps/driver/app/(tabs)/discover.tsx` | 0 | Clean |
| `apps/driver/app/(tabs)/earnings.tsx` | 0 | Clean |
| `apps/driver/app/(tabs)/inbox.tsx` | 0 | Clean |
| `apps/driver/app/(tabs)/index.tsx` | 0 | Clean |
| `apps/driver/app/(tabs)/menu.tsx` | 0 | Clean |
| `apps/driver/app/+not-found.tsx` | 0 | Clean |
| `apps/driver/app/_layout.tsx` | 0 | Clean |
| `apps/driver/app/about.tsx` | 0 | Clean |
| `apps/driver/app/account.tsx` | 0 | Clean |
| `apps/driver/app/auth/callback.tsx` | 0 | Clean |
| `apps/driver/app/bug-report.tsx` | 0 | Clean |
| `apps/driver/app/documents.tsx` | 0 | Clean |
| `apps/driver/app/driving-time.tsx` | 0 | Clean |
| `apps/driver/app/earnings-activity.tsx` | 0 | Clean |
| `apps/driver/app/earnings-details.tsx` | 0 | Clean |
| `apps/driver/app/fleet.tsx` | 0 | Clean |
| `apps/driver/app/forgot-password.tsx` | 0 | Clean |
| `apps/driver/app/insurance.tsx` | 0 | Clean |
| `apps/driver/app/learning.tsx` | 0 | Clean |
| `apps/driver/app/onboarding.tsx` | 0 | Clean |
| `apps/driver/app/payouts.tsx` | 0 | Clean |
| `apps/driver/app/profile-photo.tsx` | 0 | Clean |
| `apps/driver/app/profile-setup.tsx` | 0 | Clean |
| `apps/driver/app/queue.tsx` | 0 | Clean |
| `apps/driver/app/rate.tsx` | 0 | Clean |
| `apps/driver/app/refer.tsx` | 0 | Clean |
| `apps/driver/app/set-password.tsx` | 0 | Clean |
| `apps/driver/app/settings/[section].tsx` | 0 | Clean |
| `apps/driver/app/settings/index.tsx` | 0 | Clean |
| `apps/driver/app/sign-in.tsx` | 0 | Clean |
| `apps/driver/app/sign-up.tsx` | 0 | Clean |
| `apps/driver/app/switch-account.tsx` | 0 | Clean |
| `apps/driver/app/tax.tsx` | 0 | Clean |
| `apps/driver/app/trip-details.tsx` | 0 | Clean |
| `apps/driver/app/trip.tsx` | 0 | Clean |
| `apps/driver/app/vehicles.tsx` | 0 | Clean |

#### `apps/driver/components/` (UI Components)
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/driver/components/BootScreen.tsx` | 0 | Clean |
| `apps/driver/components/CampusMap.native.tsx` | 0 | Clean |
| `apps/driver/components/CampusMap.tsx` | 0 | Clean |
| `apps/driver/components/FarePanel.tsx` | 0 | Clean |
| `apps/driver/components/SignaturePad.tsx` | 0 | Clean |
| `apps/driver/components/charts.tsx` | 0 | Clean |
| `apps/driver/components/chrome.tsx` | 0 | Clean |
| `apps/driver/components/day.tsx` | 0 | Clean |
| `apps/driver/components/shell.tsx` | 0 | Clean |

#### `apps/driver/lib/` (Application Logic & State)
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/driver/lib/auth.tsx` | 0 | Clean |
| `apps/driver/lib/busySpots.ts` | 0 | Clean |
| `apps/driver/lib/earningsMath.ts` | 0 | Clean |
| `apps/driver/lib/feedback.tsx` | 0 | Clean |
| `apps/driver/lib/oneParam.ts` | 0 | Clean |
| `apps/driver/lib/openMaps.ts` | 0 | Clean |
| `apps/driver/lib/palette.ts` | 0 | Clean |
| `apps/driver/lib/passwordRecovery.tsx` | 0 | Clean |
| `apps/driver/lib/push.ts` | 0 | Clean |
| `apps/driver/lib/shown.ts` | 0 | Clean |
| `apps/driver/lib/socialSignIn.ts` | 0 | Clean |
| `apps/driver/lib/solar.ts` | 0 | Clean |
| `apps/driver/lib/storage.ts` | 0 | Clean |
| `apps/driver/lib/supabase.ts` | 0 | Clean |
| `apps/driver/lib/theme.tsx` | 0 | Clean |
| `apps/driver/lib/useDriverLocation.ts` | 0 | Clean |

#### Root Declarations
| File | Error Count | Status |
| :--- | :---: | :---: |
| `apps/driver/wav.d.ts` | 0 | Clean |

---

### 3.3 Shared Monorepo Dependencies (`packages/rides-native`)
Both apps import shared components and definitions via `rides-native/*`. All type declarations resolve cleanly without errors:

| File | Type / Declaration | Referenced By | Error Count | Status |
| :--- | :--- | :--- | :---: | :---: |
| `packages/rides-native/AuthScreens.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/LivePhase.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/PartyScreens.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/accountDeletion.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/agentChips.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/apiClient.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/apiOrigin.d.ts` | Typed Declarations | Rider | 0 | Clean |
| `packages/rides-native/assistClient.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/authErrors.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/authUrl.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/checkoutReturn.d.ts` | Typed Declarations | Rider | 0 | Clean |
| `packages/rides-native/createAuth.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/documentReview.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/driverDesk.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/driverKnowledgeQuiz.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/driverOnboardingClient.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/drivers.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/gameDayNotice.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/googleAuth.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/heat.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/legalCopy.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/liveTrip.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/lostFoundClient.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/mapsLink.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/notificationPrefs.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/partyProfile.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/places.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/riderMoney.d.ts` | Typed Declarations | Rider | 0 | Clean |
| `packages/rides-native/riderShell.d.ts` | Typed Declarations | Rider | 0 | Clean |
| `packages/rides-native/safety.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/secureStore.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/shared/ambassadorAttribution.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/shared/carpool.d.ts` | Typed Declarations | Rider | 0 | Clean |
| `packages/rides-native/shared/carpoolApi.d.ts` | Typed Declarations | Rider | 0 | Clean |
| `packages/rides-native/shared/split.d.ts` | Typed Declarations | Rider | 0 | Clean |
| `packages/rides-native/shared/vehicle.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/socialAuth.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/syntheticOffers.d.ts` | Typed Declarations | Driver | 0 | Clean |
| `packages/rides-native/tripMessagesClient.js` | Implementation | Rider | 0 | Clean |
| `packages/rides-native/tripTags.d.ts` | Typed Declarations | Rider, Driver | 0 | Clean |
| `packages/rides-native/vehicleCatalog.d.ts` | Typed Declarations | Driver | 0 | Clean |

---

## 4. Observations & Notes

1. **`allowJs` vs. `--checkJs` Behavior:**
   - Both `apps/rider` and `apps/driver` enable `allowJs: true` and `strict: true`.
   - In `apps/driver`, all imported modules have `.d.ts` typing definitions or are written in TypeScript, resulting in 0 errors even if `--checkJs` is passed.
   - In `apps/rider`, some legacy or untyped JS files from `packages/rides-native` and `src/lib` are imported without `.d.ts` files (e.g., `tripMessagesClient.js`, `scheduledRideModel.js`). Under default `tsconfig.json` (`allowJs: true`, no `checkJs`), these pass typechecking cleanly with 0 errors. If `--checkJs` is explicitly forced, untyped JS files report implicit `any` parameter errors. Adding `.d.ts` declarations or converting these files to TypeScript would allow full strict JS checking in the future.
2. **`apps/mobile` Status:**
   - `apps/mobile` is not included in `scripts/typecheck.mjs` (which only checks `rider` and `driver`).
   - If `apps/mobile` is checked separately (`cd apps/mobile && npm exec -- tsc --noEmit -p .`), it currently reports 4 `TS18047: 'supabase' is possibly 'null'` errors in `app/(tabs)/driver.tsx`.
3. **Reproducibility:**
   - To re-run the full typecheck suite from repo root:
     ```bash
     npm run typecheck
     ```
   - To run each application individually:
     ```bash
     npm --prefix apps/rider run typecheck
     npm --prefix apps/driver run typecheck
     ```
