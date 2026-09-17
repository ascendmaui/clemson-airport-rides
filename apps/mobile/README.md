# Clemson RIDES — mobile (Expo)

Expo Router app for Clemson Airport Rides.

- **Bundle ID / package:** `com.ascendmaui.clemsonairportrides`
- **Scheme:** `clemsonrides`
- **Brand:** orange `#F56600`, purple `#522D80`

## Setup

```bash
cd apps/mobile
npm install
cp .env.example .env   # fill Clerk + Supabase public keys only
npx expo start
```

## EAS

```bash
npm i -g eas-cli
eas login
eas build:configure   # fills projectId in app.json if empty
eas build --platform ios --profile preview
```

Do not commit `.env`, keystores, or service-role keys.
