# Rider auth contract

Client auth for `apps/rider` is **Supabase Auth** (email/password + session) plus **Clerk** for social providers. Do not replace either with a from-scratch custom backend.

## Client API (`createAuth` → `useAuth`)

Wired in `apps/rider/lib/auth.tsx` via `rides-native/createAuth`:

| Method | Behavior |
| --- | --- |
| `signIn(email, password)` | Supabase `auth.signInWithPassword` |
| `signUp(email, password, …)` | Supabase `auth.signUp` + profile ensure / promo claim |
| `resetPassword(email)` | Supabase `auth.resetPasswordForEmail` with redirect |
| `updatePassword(password)` | Supabase `auth.updateUser({ password })` |
| `signOut()` | Supabase `auth.signOut`, then optional Clerk sign-out |

Session persistence uses the app storage adapter + `supabase.auth.getSession` / `onAuthStateChange` inside `createAuth`.

## Social (Clerk)

- Publishable key: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `ClerkProvider` + `tokenCache` in `app/_layout.tsx`
- Social buttons on sign-in / sign-up via `useClerkSocialSignIn` (`lib/clerkSocial.tsx`)

## Required env

| Variable | Role |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk social (`pk_test_` / `pk_live_`) |

Optional build-time for native Google: `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME`.

See `apps/rider/.env.example`. Never commit secrets or Clerk secret keys.

## Password reset

- Client redirect constant: `PASSWORD_RESET_REDIRECT` = `clemsonrides://set-password` (`rides-native/riderShell.js`)
- Deep link lander: `app/set-password.tsx` (must stay reachable before a session exists so the recovery link can establish one)
- Server: configure Supabase Auth **email templates** and **redirect URL allowlist** to include `clemsonrides://set-password` (and any staging variants)

## Route protection

- **Hard gate:** `components/RequireAuth.tsx` — boot while loading; if no user, `setAuthNext(current href)` + `router.replace('/sign-in')`.
  Wrapped: account, billing, history, schedule, notifications, profile-setup, student.
- **Soft gate:** `SignInToBookSheet` on confirm / tiers / pick-driver / friends (and browse-without-login home). Intentional for booking only.
- **Promo** stays soft (sign-in CTA in-screen) so codes can be browsed.
- **set-password** is not hard-gated so recovery deep links can apply a session first.

## Brand

Auth UI colors stay Clemson orange `#F56600` and purple `#522D80` (`rides-native/places.js`). Auth cards use a subtle iOS shadow + Android elevation.
