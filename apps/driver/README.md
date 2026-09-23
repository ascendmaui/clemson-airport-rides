# Clemson RIDES — driver (Expo)

Version **1.1.0**. Bundle id `com.ascendmaui.clemsonrides.driver`.

Separate binary, icon, `eas.json`, and Expo project from the rider app and from TestFlight 1.0.0 (1) `com.ascendmaui.clemsonairportrides`.

Going online calls the same approval gate as the web app: `driver_applications.onboarding_status` must be `approved`. Email and password only.

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

## Follow-ups

Offer accept, trip status, chat, payouts, document upload, and live location publish stay on the web until the next driver builds. This app signs in and toggles online when an admin has approved the account.
