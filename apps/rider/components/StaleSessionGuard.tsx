import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/expo'
import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import {
  authFlowInFlight,
  clearClerkTokenCache,
  ensureFreshAuth,
  resetStaleClerk,
  type ClerkLike,
} from '@/lib/freshAuth'

/**
 * Launch-time half of the stale-session fix. When Clerk restores a session from
 * tokenCache, prove it still produces a rider account (Supabase session + profile
 * row, bridging Clerk -> Supabase if needed). If it can't, sign out of both,
 * clear the Clerk token cache, and show the login screen.
 *
 * Loop guards: each Clerk session id is checked once, at most one forced reset
 * per app launch, and nothing runs while a sign-in / sign-up owns the auth state.
 */
export function StaleSessionGuard() {
  const clerk = useClerk() as unknown as ClerkLike
  const { isLoaded, isSignedIn, sessionId } = useClerkAuth()
  const { isLoaded: userLoaded, user: clerkUser } = useUser()
  const { loading, signOut } = useAuth()
  const router = useRouter()
  const checkedSession = useRef<string | null>(null)
  const resets = useRef(0)

  useEffect(() => {
    if (!isLoaded || !userLoaded || loading) return
    if (!isSignedIn || !sessionId) {
      checkedSession.current = null
      return
    }
    if (authFlowInFlight() || checkedSession.current === sessionId || resets.current >= 1) return
    checkedSession.current = sessionId

    let alive = true
    void (async () => {
      const result = clerkUser
        ? await ensureFreshAuth(clerk)
        : (await resetStaleClerk(clerk), { status: 'reset' as const })
      if (!alive || result.status !== 'reset') return
      resets.current += 1
      try {
        await signOut() // drops any half Supabase session, then Clerk again (no-op)
      } catch {
        // No Supabase session to clear.
      }
      await clearClerkTokenCache()
      router.replace('/sign-in')
    })()
    return () => {
      alive = false
    }
  }, [clerk, clerkUser, isLoaded, isSignedIn, loading, router, sessionId, signOut, userLoaded])

  return null
}
