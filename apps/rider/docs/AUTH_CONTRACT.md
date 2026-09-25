# Rider auth contract

Client auth for `apps/rider` is built entirely on **Supabase Auth**: email/password, session storage, and Supabase-native Apple and Google social sign-in.

## Client API (`createAuth` → `useAuth`)

Wired in `apps/rider/lib/auth.tsx` via `rides-native/createAuth`:

| Method | Behavior |
| --- | --- |
| `signIn(email, password)` | Supabase `auth.signInWithPassword` |
| `signUp(email, password, …)` | Supabase `auth.signUp` + profile ensure / promo claim |
| `resetPassword(email)` | Supabase `auth.resetPasswordForEmail` with redirect |
| `updatePassword(password)` | Supabase `auth.updateUser({ password })` |
| `signOut()` | Supabase `auth.signOut` |

Session persistence uses the app storage adapter (`rides-native/secureStore`) + `supabase.auth.getSession` / `onAuthStateChange` inside `createAuth`.

## Social Authentication (Supabase Native)

- **Apple sign-in**: Uses `expo-apple-authentication` with a SHA-256 hashed nonce on iOS. The resulting identity token is passed to `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })`. On first sign-in, any returned full name or email is saved to user metadata and the user's `profiles` row without overwriting existing data.
- **Google sign-in**: Uses Supabase OAuth flow via `startGoogleOAuth` (`supabase.auth.signInWithOAuth({ provider: 'google', ... })`) and `WebBrowser.openAuthSessionAsync`, completing the session with `completeGoogleSession` on redirect back to `clemsonrides://auth/callback`.
- Social hook: `useSocialSignIn` in `apps/rider/lib/socialSignIn.ts`.

## Required Configuration

### App Environment Variables

| Variable | Role |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |

### Supabase Dashboard Configuration

- **Apple Provider**: Client ID `com.ascendmaui.clemsonrides.rider`, Team ID `L85AF3V872`.
- **Google Provider**: Google OAuth web client credentials under `ascendmaui` (iOS client ID optional).
- **Redirect URLs**: Add `clemsonrides://**`, `clemsonrides://set-password`, and `clemsonrides://auth/callback`.
- **Transactional Email**: Configure Resend SMTP in Supabase Auth.

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
