# Clemson RIDES — rider (Expo)

Version **1.1.0**. Bundle id `com.ascendmaui.clemsonrides.rider`.

This is a separate binary from TestFlight 1.0.0 (1) `com.ascendmaui.clemsonairportrides` in `apps/mobile`. Do not point EAS at that project. Do not add these Clerk settings to `apps/driver`.

Map-first home uses Clemson orange `#F56600` / `#F66733` and purple `#522D80`, with the same campus anchors as the web Campus map. Email, password, and forgot-password call Supabase Auth (`signInWithPassword`, `signUp`, `resetPasswordForEmail`). The session is persisted with `expo-secure-store` (chunked so the full session fits the keychain limit). There is no `Alert` stub on the booking path.

Apple, Google, and Facebook use Clerk (`@clerk/expo`). After Clerk creates a session, the app calls `POST /api/clerk-supabase-session`. That route checks the Clerk session and returns a one-time Supabase magic-link hash. The app exchanges it with `verifyOtp`, so the stored session is a Supabase JWT and `auth.uid()` stays the `auth.users` UUID that RLS already uses. The Clerk user id is not a UUID, so the app does not send the Clerk JWT as the Supabase `accessToken`.

## EAS environment variables

Cloud builds do not see a local `.env`. Create these on the **rider** Expo project. Repeat each `env:create` for `preview` and `development`. Never commit key values.

```bash
npx eas-cli init
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://awktabuhijrshmsmagpq.supabase.co --environment production --visibility plaintext
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --visibility sensitive
npx eas-cli env:create --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value <pk_test_ or pk_live_> --environment production --visibility plaintext
npx eas-cli env:create --name EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME --value <reversed iOS client id> --environment production --visibility plaintext
```

| Name | Where | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Rider EAS | `pk_test_` or `pk_live_`. Required before the social buttons call Clerk. Email still works when it is missing; the buttons explain this checklist. |
| `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` | Rider EAS | Reversed iOS OAuth client id (`com.googleusercontent.apps.…`). Native Google Sign-In reads it at build time. Without it, Google falls back to the browser SSO flow. |
| `EXPO_PUBLIC_SUPABASE_URL` | Rider EAS | Already used for email auth. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Rider EAS | Public in the binary. Stays out of git. |
| `CLERK_SECRET_KEY` | Vercel only | `sk_test_` or `sk_live_`. Never `EXPO_PUBLIC_` and never in EAS. The bridge rejects the Clerk session without it. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel only | Already required by other `/api` routes. The bridge uses it to mint the Supabase session. |

The anon key and the Clerk publishable key are public in the app binary by design. Secret keys stay on Vercel.

### Clerk dashboard

1. Turn on the Native API.
2. Enable Apple, Google, and Facebook social connections. Production needs each provider's own credentials. Add the iOS bundle `com.ascendmaui.clemsonrides.rider` and the Android package `com.ascendmaui.clemsonrides.rider`.
3. Allow redirect URL `clemsonrides://sso-callback` (the value `AuthSession.makeRedirectUri` builds for scheme `clemsonrides`).
4. Native Google also needs the iOS URL scheme above. Native Apple uses Sign in with Apple (`ios.usesAppleSignIn` and the `@clerk/expo` config plugin). Facebook uses browser SSO (`oauth_facebook`).

### Supabase

Allow redirect URLs `clemsonrides://set-password` and `clemsonrides://reset-password` under Authentication URL configuration. Forgot password emails use `clemsonrides://set-password`. Linking an Apple, Google, or Facebook account uses the verified email. The same email keeps the existing Supabase user, so `auth.uid()` and profile rows stay put. A new email gets a new `auth.users` UUID.

### Vercel

```bash
# set in the Vercel project, not in git
CLERK_SECRET_KEY=<sk_test_ or sk_live_>
SUPABASE_SERVICE_ROLE_KEY=<service role>
```

If either secret is missing, social sign-in shows the missing names and email/password still works.

Local:

```bash
cp .env.example .env
npm install
npx expo start
```

Native Apple and Google buttons need a development build (`npx expo run:ios` / `npx expo run:android`), not Expo Go. Browser SSO for Facebook, and the Apple/Google fallback, run through `useSSO`.

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
6. On a trip that is accepted, arriving, or arrived, with a driver_status lat/lng and location permission on, the rider sees "Driver N ft away" (meters underneath). Inside about 500, 200, and 100 feet the screen pulses Clemson orange and the phone haptics. Getting closer from farther out pulses once, then rests. in_progress does not alert.
7. On a finished trip, live share shows "This ride is finished" instead of a new token. Share my location still creates the same link as before.

The ride-requested screen keeps SOS and live share, and shows the driver pin when a location is available. Campus ride requests already insert a `trips` row the same way the web app does.
