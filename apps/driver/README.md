# Clemson RIDES — driver (Expo)

Version **1.1.0**. Bundle id `com.ascendmaui.clemsonrides.driver`.

Separate binary, icon, `eas.json`, and Expo project from the rider app and from TestFlight 1.0.0 (1) `com.ascendmaui.clemsonairportrides`.

Going online calls the same approval gate as the web app: `driver_applications.onboarding_status` must be `approved`. Email and password only. The session stays in SecureStore.

## EAS environment variables

Replace the placeholder `extra.eas.projectId` with `eas init`. Do not reuse `1440e29e-13f0-4571-8f32-596ec81f3369`.

```bash
npx eas-cli init
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://awktabuhijrshmsmagpq.supabase.co --environment production --visibility plaintext
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --visibility sensitive
```

Repeat for `preview` and `development`.

```bash
cp .env.example .env
npm install
npx expo start
```

Optional API base (defaults to production):

```bash
npx eas-cli env:create --name EXPO_PUBLIC_API_BASE --value https://clemson-airport-rides.vercel.app --environment production --visibility plaintext
```

## Phase 2

Shipped in this app, using the same Supabase tables and `/api/driver` routes as the web app:

- Driver onboarding (account quiz, documents, employment, W-9 via `save_driver_tax_info`, IC agreement, submit for review)
- Go online so rider Pick a driver can see name, vehicle, and location
- Queue for chosen-driver requests, open matches, student-discount trips, game-day trips, and scheduled weekend/party rides
- Live trip map with arriving → I'm here → start → complete (`/api/driver?action=wait` and `/api/stripe-payment-methods?action=settle`)
- Earnings and 25% deposit status from `/api/driver?action=earnings` and payout status from `/api/driver?action=payouts`

Stub only:

- Tesla Model 3 self-driving. The badge can show on a profile. `autonomous_capable` stays false. "Request a self-driving trip" does not dispatch a car.

Not in this build: in-trip chat, Stripe PaymentSheet, and document camera review by an admin (review stays on the web admin queue).

## TestFlight smoke

1. Sign in with a Supabase driver account. An unapproved account should open the application and refuse Go online.
2. Finish or resume onboarding. Confirm the progress percent moves and a saved W-9 shows only the last four digits.
3. With an approved account, go online, then open the rider app Pick a driver and confirm this driver is listed.
4. From the rider app, request that driver. Accept on the driver queue and open the live trip. Step Arriving → I'm here → Start → Complete.
5. Open Queue filters for Student, Game day, and Weekend. Accept a scheduled ride if one is open.
6. Open Tesla fleet, show the badge, and tap Request a self-driving trip. Confirm the stub message and that no trip was created.
7. Open Earnings. Deposit lines appear when `/api/driver?action=earnings` can see payment rows. A missing service role should show the API error, not a fake paid deposit.
