import { tokenCache } from '@clerk/expo/token-cache'
import { isStaleSessionError, isTransientNetworkError } from 'rides-native/staleSession'
import { exchangeClerkSession } from '@/lib/clerkBridge'
import { supabase } from '@/lib/supabase'

/**
 * One guard for every rider auth entry point (Google, Apple, Facebook,
 * email create-account, and app launch).
 *
 * The app's signed-in gate is the Supabase session (createAuth). Clerk only
 * handles social providers, and its client JWT lives in expo-secure-store via
 * tokenCache. If the Clerk JWT survives while the Supabase session or the
 * profile row does not, Clerk answers every new sign-in with `session_exists`
 * ("You're already signed in") while the app still shows the login screen.
 */

/** Same key @clerk/expo uses internally (dist/constants.js CLERK_CLIENT_JWT_KEY). */
export const CLERK_CLIENT_JWT_KEY = '__clerk_client_jwt'

export type ClerkLike = {
  session?: { id?: string; getToken: () => Promise<string | null> } | null
  user?: { id: string } | null
  signOut: () => Promise<unknown>
}

export type FreshAuthResult =
  | { status: 'fresh' } // no Clerk session: safe to start a real sign-in / sign-up
  | { status: 'signed_in' } // cached session produced a real account: go into the app
  | { status: 'reset' } // cached session was stale: Clerk signed out + token cache cleared
  | { status: 'offline'; message: string } // network failure: do not sign anyone out

let flowDepth = 0

/** True while a sign-in / sign-up attempt owns the auth state (launch guard stays out of the way). */
export function authFlowInFlight() {
  return flowDepth > 0
}

export async function clearClerkTokenCache() {
  try {
    await tokenCache?.clearToken?.(CLERK_CLIENT_JWT_KEY)
  } catch {
    // Nothing cached, or SecureStore is locked. Clerk signOut already dropped the session.
  }
}

/** Clerk signOut + token cache wipe. Never throws. */
export async function resetStaleClerk(clerk: ClerkLike | null | undefined) {
  try {
    await clerk?.signOut()
  } catch {
    // Already signed out on Clerk's side.
  }
  await clearClerkTokenCache()
}

export type AccountCheck =
  | { ok: true }
  | { ok: false; reason: 'no_session' | 'profile_error' | 'offline'; message?: string }

/**
 * The rider "/me": a Supabase session user plus a readable profiles row.
 * A missing row is created (first-login design, same as createAuth.ensureProfile);
 * ProfileRequiredGate then sends incomplete profiles to /profile-setup.
 */
export async function checkAccountLoads(): Promise<AccountCheck> {
  if (!supabase) return { ok: false, reason: 'no_session', message: 'Supabase is not configured' }
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData?.session?.user
    if (!user?.id) return { ok: false, reason: 'no_session' }
    const { data, error } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
    if (error) {
      if (isTransientNetworkError(error)) return { ok: false, reason: 'offline', message: error.message }
      return { ok: false, reason: 'profile_error', message: error.message }
    }
    if (data?.id) return { ok: true }
    const meta = (user.user_metadata || {}) as { full_name?: string; name?: string }
    const { error: insertError } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        email: user.email || null,
        full_name: meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : 'Rider'),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (insertError) {
      if (isTransientNetworkError(insertError)) return { ok: false, reason: 'offline', message: insertError.message }
      return { ok: false, reason: 'profile_error', message: insertError.message }
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isTransientNetworkError(err)) return { ok: false, reason: 'offline', message }
    return { ok: false, reason: 'profile_error', message }
  }
}

/**
 * Decide what a cached Clerk session is worth.
 * - No Clerk session: `fresh`.
 * - Clerk session + user, and the app account loads (bridging Clerk -> Supabase
 *   if the Supabase session is gone): `signed_in`.
 * - Anything else: sign Clerk out, clear the token cache, `reset`.
 */
export async function ensureFreshAuth(clerk: ClerkLike | null | undefined): Promise<FreshAuthResult> {
  if (!clerk?.session) return { status: 'fresh' }

  if (clerk.user?.id && supabase) {
    let check = await checkAccountLoads()
    if (!check.ok && check.reason === 'no_session') {
      try {
        const token = await clerk.session.getToken()
        if (token) {
          await exchangeClerkSession(supabase, { token })
          check = await checkAccountLoads()
        }
      } catch (err) {
        if (isTransientNetworkError(err)) {
          return { status: 'offline', message: err instanceof Error ? err.message : 'Network error' }
        }
        // Bridge refused this Clerk session: treat it as stale below.
      }
    }
    if (check.ok) return { status: 'signed_in' }
    if (check.reason === 'offline') return { status: 'offline', message: check.message || 'Network error' }
  }

  await resetStaleClerk(clerk)
  return { status: 'reset' }
}

/**
 * Run a real auth attempt (OAuth or sign-up) behind the guard.
 * 1. Pre-check the cached Clerk session. A working one short-circuits into the app.
 * 2. Run the attempt. On `session_exists`, re-check: go into the app if the session
 *    is real, otherwise reset and retry the attempt exactly once.
 */
export async function withFreshAuth<T>(
  clerk: ClerkLike | null | undefined,
  attempt: () => Promise<T>,
  { onSignedIn }: { onSignedIn: () => T | Promise<T> },
): Promise<T> {
  flowDepth += 1
  try {
    const pre = await ensureFreshAuth(clerk)
    if (pre.status === 'signed_in') return await onSignedIn()
    if (pre.status === 'offline') throw new Error(`No connection. ${pre.message}`)
    try {
      return await attempt()
    } catch (err) {
      if (!isStaleSessionError(err)) throw err
      const post = await ensureFreshAuth(clerk)
      if (post.status === 'signed_in') return await onSignedIn()
      if (post.status === 'offline') throw new Error(`No connection. ${post.message}`)
      if (post.status === 'fresh') await clearClerkTokenCache()
      return await attempt()
    }
  } finally {
    flowDepth -= 1
  }
}
