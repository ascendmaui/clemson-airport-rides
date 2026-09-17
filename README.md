# Clemson RIDES (web)

Vite + React rider/driver shell · Clemson orange `#F56600` · purple `#522D80`.

**Production SoT:** https://github.com/ascendmaui/clemson-airport-rides  
**Live:** https://clemson-airport-rides.vercel.app  
**Deploy rule:** production ships only via `git push` to `main` (SHA-tracked Vercel). Do not CLI-deploy over SoT.  
**Supabase:** `awktabuhijrshmsmagpq` (do not migrate/drop schema)

## Stack

| Layer | Wiring |
|-------|--------|
| Auth | **Supabase Auth only** · `AuthProvider` · `#/sign-in` `#/sign-up` · protected rider/driver routes |
| Payments | Vercel `/api/create-checkout-session` + `/api/stripe-webhook` · 25% deposit · writes `payments` when service role + trip metadata present |
| Data | Real Supabase queries · online drivers from `driver_status` · trips Realtime · **no demo fleet** |
| UI | Lyft-style soft shadows, spring sheets, Clemson brand |

## Env

Copy `.env.example`. Vite reads `VITE_*`. Server secrets (`STRIPE_*`, `SUPABASE_SERVICE_ROLE_KEY`) belong only on Vercel `/api`.

Placeholder Stripe keys are OK for build; checkout returns `{ stub: true }` until a real `sk_` key is set.

## Dev / build

```bash
npm install
npm run build
npm run dev
```

## Mobile

See `apps/mobile` (Expo + EAS). Supabase Auth — no Clerk.
