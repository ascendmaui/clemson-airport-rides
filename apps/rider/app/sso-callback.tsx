import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { BootScreen } from '@/components/BootScreen'

/**
 * Landing route for clemsonrides://sso-callback.
 * ClerkProvider completes the browser session on web. Native SSO uses
 * openAuthSessionAsync, which returns the URL to useSSO directly.
 */
export default function SsoCallback() {
  const router = useRouter()
  useEffect(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/sign-in')
  }, [router])
  return <BootScreen />
}
