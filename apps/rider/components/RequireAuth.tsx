import { usePathname, useRouter, type Href } from 'expo-router'
import { useEffect, type ReactNode } from 'react'
import { BootScreen } from '@/components/BootScreen'
import { useAuth } from '@/lib/auth'
import { setAuthNext } from '@/lib/authNext'

/**
 * Hard gate for account-owned screens. While auth is loading, show BootScreen.
 * If there is no session, stash the current href and replace with /sign-in.
 * Soft booking gates (SignInToBookSheet on confirm/tiers/pick-driver/friends) stay separate.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (loading) return
    if (user) return
    const next = (pathname || '/') as Href
    setAuthNext(next)
    router.replace('/sign-in')
  }, [loading, user, pathname, router])

  if (loading || !user) return <BootScreen />
  return <>{children}</>
}
