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

## Driver track

Same Supabase tables and `/api/driver` routes as the web app. The rider app is a separate binary.

- Onboarding matches the web steps (quiz, documents, employment, W-9 last four, IC agreement). A saved application refills name, phone, and vehicle.
- Go online / Go offline. Online publishes `driver_status` and, when the column exists, seat capacity. The home card shows the name, vehicle, and seats riders can select.
- Queue with live trip updates. Chosen-driver requests can be declined (canceled). Open matches are released back to searching. Student, game-day, and weekend filters stay on the queue.
- Scheduled weekend and party rides have their own section. Accept calls `accept_scheduled_trip`. “Not this one” only hides that card on this phone.
- Live trip map: your pin, pickup, drop-off, and the rider pin when `location_shares` / `location_points` (or trip metadata) has a fix. Apple Maps and Google Maps open directions for the current stop.
- Stripe stays on the existing settle route. The fare panel shows the 25% deposit, the remainder collected on complete, the 80/20 split, and carpool share lines. Apple Pay is the rider’s wallet charged off-session. This phone does not present a PaymentSheet.
- Earnings reads `/api/driver?action=earnings` and `/api/driver?action=payouts`: today, this week, pending balance, paid out, deposit lines, and trip history.
- Tesla Model 3 is a profile toggle. `autonomous_capable` stays false. “Request a self-driving trip” does not dispatch a car.
- Expo notifications register a push token (best effort on `driver_status.expo_push_token` or `driver_push_tokens`) and schedule a local alert when a new request arrives while the app is running. A closed app gets a remote push only after a sender uses that token.
- Haptics plus a short chime from `expo-audio`. Playback is silent-mode aware (`playsInSilentMode: false`).

Not in this build: in-trip chat, a driver-side Apple Pay sheet, and admin review of document photos (review stays on the web admin queue).

## TestFlight smoke

1. Sign in with a Supabase driver account. An unapproved account should open the application and refuse Go online.
2. Finish or resume onboarding. Confirm the progress percent moves, saved name and vehicle refill, and a saved W-9 shows only the last four digits.
3. With an approved account, go online. Confirm the “Riders can pick you” card lists name, vehicle, and seats, then open the rider app Pick a driver and confirm this driver is listed.
4. From the rider app, request that driver. The driver app should haptic, chime (unless the phone is on silent), and show a notification. Accept and open the live trip.
5. On the live trip, confirm pickup and drop-off pins. If the rider shares location, their pin appears. Tap Apple Maps and Google Maps and confirm each opens directions. Step Arriving → I'm here → Start → Complete. Complete should call settle and show the collection line, or the API error if payment is still required.
6. Open Queue filters for Student, Game day, and Weekend. Accept a scheduled ride if one is open. Decline an open match and confirm it is not canceled for every driver.
7. Open Tesla fleet, show the badge, and tap Request a self-driving trip. Confirm the stub message and that no trip was created.
8. Open Earnings. Today, this week, balance, and paid out use real rows. A missing service role should show the API error, not a fake paid deposit.
9. Open Account and confirm the notification line. A simulator may say the push token is unavailable; the in-app alert path still runs on a new request.
