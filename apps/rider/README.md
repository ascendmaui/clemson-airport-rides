# Clemson RIDES — rider (Expo)

Version **1.1.0**. Bundle id `com.ascendmaui.clemsonrides.rider`.

This is a separate binary from TestFlight 1.0.0 (1) `com.ascendmaui.clemsonairportrides` in `apps/mobile`. Do not point EAS at that project.

Map-first home uses Clemson orange `#F56600` / `#F66733` and purple `#522D80`, with the same campus anchors as the web Campus map. Email, password, and forgot-password call Supabase Auth (`signInWithPassword`, `signUp`, `resetPasswordForEmail`). The session is persisted with `expo-secure-store` (chunked so the full session fits the keychain limit). There is no `Alert` stub on the booking path.

Social sign-in uses Supabase-native Apple and Google auth:
- **Apple sign-in**: Uses native `expo-apple-authentication` on iOS with a SHA-256 hashed nonce, exchanged directly with `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })`. When Apple returns the user's name on first sign-in, the app saves it to the profile row and user metadata without overwriting existing data.
- **Google sign-in**: Uses Supabase OAuth via `startGoogleOAuth` and `WebBrowser.openAuthSessionAsync`, completing the session with `completeGoogleSession` on redirect to `clemsonrides://auth/callback`.

## EAS environment variables

Cloud builds do not see a local `.env`. Create these on the **rider** Expo project. Repeat each `env:create` for `preview` and `development`. Never commit key values.

```bash
npx eas-cli init
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://awktabuhijrshmsmagpq.supabase.co --environment production --visibility plaintext
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --visibility sensitive
```

| Name | Where | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Rider EAS | Supabase project URL. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Rider EAS | Public in the binary. Stays out of git. |
| `EXPO_PUBLIC_API_BASE` | Rider EAS | Optional. Defaults to production web app URL. |

### Supabase Configuration

1. **Apple Provider**: Enable Apple in Supabase Auth. Set client ID to `com.ascendmaui.clemsonrides.rider` and Team ID to `L85AF3V872`.
2. **Google Provider**: Enable Google in Supabase Auth using the Google OAuth web client under `ascendmaui` (iOS client ID optional).
3. **Redirect allowlist**: In Authentication → URL Configuration, add `clemsonrides://**`, `clemsonrides://set-password`, and `clemsonrides://auth/callback`.
4. **Email SMTP**: Configure Resend SMTP in Supabase Auth for transactional confirmation and password reset emails.
5. **Vercel**: Remove legacy social bridge secrets from Vercel environment variables after deploy.

Local:

```bash
cp .env.example .env
npm install
npx expo start
```

Native Apple and Google buttons work in a development build (`npx expo run:ios` / `npx expo run:android`) and simulators.

## Rider shell

Tabs are Rides, Schedule, Friends, and Account. The Rides header avatar opens Account. The campus map has locate, Busy Areas, a draggable welcome card, and Roadmap, Satellite, and Hybrid. Choose-driver plays a short Clemson loader over a map theater of preview cars. Friends keeps the carpool hub and also adds a rider, ride together, activity, and a fare split. Account keeps Billing, Student, Promo codes, Notifications, and Safety, and adds favorite spots plus the tiger-sound toggle. Password reset uses Supabase `resetPasswordForEmail` and `clemsonrides://set-password`. Tiger sounds use expo-audio and stay quiet on silent or vibrate.

## Payments, discounts, and alerts

Schedule quotes `/api/stripe-payment-methods?action=quote` and recomputes the 25% deposit whenever the airport, date, time, or student status changes. If that route is not on the server yet, the screen uses the shared fare card and Pay calls `/api/create-checkout-session` with that deposit. When the route is present, Pay calls `action=airport-checkout` (surge, student 10% on Standard, ride credits). A deposit is shown as received only after a succeeded `payments` row exists.

Account → Student writes `profiles.student_verified_at` for `@clemson.edu` / `@g.clemson.edu`. Account → Promo codes calls `claim_rider_social_promo` and `ensure_rider_social_code`. Account → Billing reads the saved card, deposit rows, and ride fares. Account → Notifications reads and writes `profiles.notification_prefs`.

Live location sharing, the trip link, SOS, and emergency contacts stay on Safety and the ride-requested screen. Game-day carpool (neighborhood match, fare split, offer-a-car, and vehicle seats) calls the same `/api/carpool` and `/api/friend-rides` routes as the web flagship. Campus ride requests already insert a `trips` row the same way the web app does.

## Smoke

```bash
npm test
cd apps/rider && npx tsc --noEmit
```

On a device or simulator (`npx expo start` from `apps/rider`):

1. Schedule: switch GSP and CLT, and edit the date or time. The deposit line leaves the previous fare, then shows 25% of the new quote. Pay stays disabled while that quote is in flight.
2. Sign in and pay. Stripe Checkout opens. Closing it does not say the deposit was received unless `payments.status` is succeeded.
3. Account → Student: a Clemson email shows verified and can save `student_verified_at`. Return to Schedule and confirm the student line is on the new quote.
4. Account → Promo codes: apply a code and share the account code. Rewards stay pending until the first completed ride.
5. Account → Billing: card last4 (when one is saved), deposit rows, and ride history with fare and deposit.
6. Account → Notifications: toggle ride, billing, and promotions. The note says the prefs were saved. Relaunch and confirm the switches stick.

## Safety smoke

1. Sign in, then open Safety from Account or the home pill.
2. With no contacts, the list says "No emergency contacts yet". Add a name and phone, edit it, and confirm it is listed.
3. Request a ride so a trips row exists. On Ride requested, tap Share my location. The link looks like `https://clemson-airport-rides.vercel.app/share/<token>` and a location_shares row is active.
4. Tap Share trip link and send that same URL from the share sheet.
5. While the trip is accepted, arriving, or in progress, tap SOS. The screen is full-bleed red and says to press the button to call police. The first press on Call 911 or Call Clemson Police does not dial. A sos_events row is stored with channel banner. Press Call 911 again to dial.
