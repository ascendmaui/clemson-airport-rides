# Clemson RIDES — rider (Expo)

Version **1.1.0**. Bundle id `com.ascendmaui.clemsonrides.rider`.

This is a separate binary from TestFlight 1.0.0 (1) `com.ascendmaui.clemsonairportrides` in `apps/mobile`. Do not point EAS at that project.

Map-first home uses Clemson orange `#F56600` / `#F66733` and purple `#522D80`, with the same campus anchors as the web Campus map. Sign-in calls Supabase `signInWithPassword`. The session is persisted with `expo-secure-store` (chunked so the full session fits the keychain limit). There is no `Alert` stub on the booking path.

## EAS environment variables

Cloud builds do not see a local `.env`. Create these on the **rider** Expo project after `eas init` replaces the placeholder project id in `app.json`:

```bash
npx eas-cli init
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://awktabuhijrshmsmagpq.supabase.co --environment production --visibility plaintext
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --visibility sensitive
```

Repeat for `preview` and `development`. The anon key is public in the app binary by design; it still stays out of git.

Local:

```bash
cp .env.example .env
npm install
npx expo start
```

## Follow-ups

Stripe 25% PaymentSheet, driver offer accept, student pricing checkout, gameday carpool, and scheduled airport holds are not in this binary yet. Campus ride requests already insert a `trips` row the same way the web app does. Live location sharing, the trip link, SOS, and emergency contacts are on Safety and the ride-requested screen.

## Safety smoke

1. Sign in, then open Safety from Account or the home pill.
2. With no contacts, the list says "No emergency contacts yet". Add a name and phone, edit it, and confirm it is listed.
3. Request a ride so a trips row exists. On Ride requested, tap Share my location. The link looks like `https://clemson-airport-rides.vercel.app/share/<token>` and a location_shares row is active.
4. Tap Share trip link and send that same URL from the share sheet.
5. While the trip is accepted, arriving, or in progress, tap SOS, then Confirm SOS, then Call 911. The first step does not dial. A sos_events row is stored with channel banner.
6. On a finished trip, live share shows "This ride is finished" instead of a new token.
