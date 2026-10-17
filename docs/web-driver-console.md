# Web driver console (bridge until the Driver app is approved)

URL: https://clemsonrides.com/driver (sign-in: https://clemsonrides.com/driver/sign-in, also `/driver/login`).

## Who gets in
- Sign in with the same Supabase account used in the Driver app: email + password, Google, or Sign in with Apple (behind `VITE_APPLE_WEB_SIGNIN=1`, see below).
- Only `driver_applications.onboarding_status = 'approved'` gets the console. Everyone else sees the approval status page (`DriverApprovalGate`). The server enforces the same rule on accept (`server/endpoints/tripStatus.js`).
- Admin controls (Edit driver incentives, /admin) stay gated by the server admin identity (sole admin: johnmatveyev@gmail.com, `server/adminRoster.js`).

## What it does (no forked logic)
| Step | Code path |
|---|---|
| Go online/offline | `setDriverOnline` → `driver_status` (same row the Driver app writes) |
| Incoming requests | `visibleOfferQuery` + Supabase realtime on `trips` + 12 s poll; chime; browser notification when the tab is hidden |
| Accept / decline | `packages/rides-native/driverDesk.js` `acceptTrip` / pass-offer (same as native) |
| Navigate | `packages/rides-native/mapsLink.js` Google / Apple Maps links |
| Arriving, arrive, start | `/api/driver?action=trip-status` |
| Trip code | `/api/pickup-beacon` code; Start unlocks when the driver enters the code shown on the rider's phone |
| Complete | `/api/driver?action=trip-status` op `complete` → `settleTrip` captures the card hold |
| Today's earnings | header shows today's driver share (`todayDriverEarnings`, America/New_York) |

Web bookings use `/api/stripe-payment-methods?action=request-driver`, the same endpoint and dispatch as the native Rider app. Tests: `tests/webDriverConsole.test.js`.

## Sign in with Apple on the web
Supabase has the Apple provider on for native ID tokens, but web OAuth answers `Unsupported provider: missing OAuth secret`. To turn it on:
1. Apple Developer → Identifiers → Services IDs → new, e.g. `com.clemsonrides.web` (Team ID as for the iOS apps). Enable Sign in with Apple, primary App ID = the Rider/Driver App ID.
2. Domains and subdomains: `awktabuhijrshmsmagpq.supabase.co`, `clemsonrides.com`. Return URL: `https://awktabuhijrshmsmagpq.supabase.co/auth/v1/callback`.
3. Keys → new key with Sign in with Apple (or reuse the existing one) → download the `.p8` once; note Key ID and Team ID.
4. Supabase → Authentication → Providers → Apple: add the Services ID to Client IDs (keep the native bundle IDs), and paste the secret key (JWT generated from the .p8, Team ID, Key ID; Supabase's generator works; it expires every 6 months).
5. Supabase → Authentication → URL configuration: `https://clemsonrides.com/` is already an allowed redirect (Google uses it).
6. Set `VITE_APPLE_WEB_SIGNIN=1` in the web build env and redeploy.
