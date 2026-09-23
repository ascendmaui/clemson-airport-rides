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
| Rider promos | Account → Refer friends · signup `?ref=` code · rewards after first completed ride (`supabase/rider_social_promo.sql`, type `rider_social`) |

## Env

Copy `.env.example`. Vite reads `VITE_*`. Server secrets (`STRIPE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`) belong only on Vercel `/api`.

### Help and Support agents

Account → Help (`/api/help-chat`) explains the product. It does not create tickets.

Account → Support (`/api/support-chat` and `/api/support-ticket`) diagnoses problems and files a row in `support_tickets` only after the user confirms. Apply `supabase/migrations/20260923120000_support_tickets.sql` before filing will succeed.

Set **one** of these on Vercel:

| Env | Use |
|-----|-----|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway (`openai/gpt-4o-mini` by default). Used when this is set, even if `OPENAI_API_KEY` is also set. |
| `OPENAI_API_KEY` | Direct OpenAI (`gpt-4o-mini` by default). |
| `HELP_CHAT_MODEL` | Optional model id. Prefix `openai/` yourself for the gateway if you override it. |
| `SUPPORT_ADMIN_EMAILS` | Optional. Comma-separated. Defaults to `john@gmail.com` for a full ticket list. |
| `SUPABASE_SERVICE_ROLE_KEY` | Already required for other `/api` routes. Help and Support use it to read the signed-in user's profile, trips, billing flags, and vehicle. The browser sends the Supabase access token as `Authorization: Bearer`. |

If neither AI key is set, both chats still answer from the curated knowledge base and whatever account context loaded. They do not call a model.

Peer riders and drivers are shown by first name only (`displayFirstName` from `src/lib/privacyDisplay.js` when that file is present). Last names are removed from chat replies and from support tickets.

Placeholder Stripe keys are OK for build; checkout returns `{ stub: true }` until a real `sk_` key is set.

## Dev / build

```bash
npm install
npm run build
npm run dev
```

## Two-way ratings

Riders rate drivers and drivers rate riders on the post-ride screen (`#/rate?trip=`). One rating per person per completed trip. Both directions write `ratings` and the refresh triggers recompute `profiles.rating_avg` and `profiles.rating_count` for whoever was rated, then set `profiles.standing`.

| `standing` | Rule | Effect |
| --- | --- | --- |
| `good` | Anything else, including fewer ratings than the floors below | Matchable |
| `watch` | Average **below 3.0** and at least **3** ratings | Soft flag. Still matchable. UI shows “Low rating”. |
| `restricted` | Average **below 2.5** and at least **5** ratings | Hidden from match. Drivers drop out of the online list. Riders are not offered. `profiles.standing` is the admin flag. |

Clients cannot overwrite `standing`, `rating_avg`, or `rating_count` on their own profile. Thresholds match `src/lib/standing.js` and `public.profile_standing`.

## Mobile

Two native apps, version **1.1.0**. They do not replace TestFlight **1.0.0 (1)** for `com.ascendmaui.clemsonairportrides` (`apps/mobile`, frozen).

| App | Path | Bundle id |
|-----|------|-----------|
| Rider | `apps/rider` | `com.ascendmaui.clemsonrides.rider` |
| Driver | `apps/driver` | `com.ascendmaui.clemsonrides.driver` |

Auth matches the web `AuthProvider`: email and password via `signInWithPassword` / `signUp`. The session is stored in the iOS keychain / Android keystore through `expo-secure-store` (chunked, because a Supabase session is larger than one SecureStore item). Confirm-email is off on the project. Apple and Google sign-in are not used.

EAS builds do not read a gitignored `.env`. Set these as EAS environment variables on **each** new project (production, preview, and development) before a cloud build:

```bash
cd apps/rider   # repeat in apps/driver after eas init
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://awktabuhijrshmsmagpq.supabase.co --environment production --visibility plaintext
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --visibility sensitive
```

Repeat for `--environment preview` and `--environment development`. Do not commit the anon key. `app.json` `extra.eas.projectId` values are placeholders — run `eas init` in each app and do not reuse `1440e29e-13f0-4571-8f32-596ec81f3369`.

See `apps/rider/README.md` and `apps/driver/README.md`.
