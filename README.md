# Clemson RIDES (web)

Vite + React rider/driver shell · Clemson orange `#F56600` · purple `#522D80`.

**Production SoT:** https://github.com/ascendmaui/clemson-airport-rides  
**Live:** https://clemson-airport-rides.vercel.app · preview https://clemson-rides-lyft-preview.vercel.app  
**Supabase:** `awktabuhijrshmsmagpq` (do not migrate/drop schema)

## Stack (this pass)

| Layer | Wiring |
|-------|--------|
| Auth | `@clerk/clerk-react` · `ClerkProvider` in `main.jsx` · `#/sign-in` `#/sign-up` · protected `#/home` `#/driver` `#/schedule` `#/confirm` `#/tiers` (and pick-driver / onboarding) |
| Payments | Client `src/lib/stripeStub.js` · Vercel serverless `/api/create-checkout-session` + `/api/stripe-webhook` · 25% deposit GSP `7500→1875` · CLT `17500→4375` |
| Data | Real Supabase client · online drivers from `driver_status` + `profiles` + `vehicles` · trips Realtime · **no demo fleet** |
| Screens | `DriverOnboarding`, `PickDriver`, Tesla tier in `RideTiers`, geofence + game-day/student pricing helpers |

## Hash routes

| Route | Screen |
|-------|--------|
| `#/landing` | Marketing |
| `#/sign-in` `#/sign-up` | Clerk |
| `#/home` | Rider home (auth) |
| `#/confirm` | Confirm pickup (auth) |
| `#/tiers` | Ride tiers + Tesla (auth) |
| `#/pick-driver` | Live online drivers (auth) |
| `#/schedule` | Airport deposit checkout (auth) |
| `#/driver` | Driver map shell (auth) |
| `#/driver-onboarding` | Driver profile/vehicle → Supabase (auth) |

## Env

Copy `.env.example`. Vite reads `VITE_*`. `NEXT_PUBLIC_*` aliases are documented for a future Next migration. Server secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) belong only on Vercel `/api`.

Placeholder keys are OK for build; without `STRIPE_SECRET_KEY` the checkout API returns `{ stub: true, message }` with HTTP 200.

## Dev / build

```bash
npm install
npm run build
npm run dev
```

## Coordinate

Another executor may add `apps/mobile` — `git pull --rebase` before push; never delete `apps/mobile`.

## Still stubbed / next

- Live Stripe keys + Clerk production instance
- Clerk↔Supabase user sync (JWT template)
- Expo native apps + push
- Full dispatch matching
