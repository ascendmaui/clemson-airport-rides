# Clemson RIDES (web skeleton)

Vite + React marketing + rider/driver shell matching Clemson Lyft-fidelity designs.

## Screens (hash routes)

| Route | Screen |
|-------|--------|
| `#/landing` | Marketing + iOS/Android QR placeholders |
| `#/home` | Rider home (Memorial Stadium hero) |
| `#/confirm` | Confirm pickup (drag note) |
| `#/tiers` | Ride tiers + Extra Comfort / Tesla upsell |
| `#/schedule` | Airport GSP $75 / CLT $175 · 25% deposit (Stripe stub) |
| `#/driver` | Driver online map · Priority · Unlock Silver · Accept |
| `#/friends` · `#/account` | Tab stubs |

## Env

See `.env.example`. Supabase project `awktabuhijrshmsmagpq` — do not migrate/drop schema.

## Dev

```bash
npm install && npm run dev
```

## Stubbed

- Stripe live charge (console TODO)
- Real Supabase auth / session
- Expo native apps + push
- Live ride dispatch
