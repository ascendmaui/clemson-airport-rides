import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { BootScreen } from '@/components/BootScreen'

/**
 * Landing route for clemsonrides-driver://sso-callback (Clerk useSSO redirect).
 * Native SSO uses openAuthSessionAsync, which returns the URL to useSSO directly;
 * this only catches a cold deep link and sends the driver back.
 */
export default function SsoCallback() {
  const router = useRouter()
  useEffect(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/sign-in')
  }, [router])
  return <BootScreen />
}
