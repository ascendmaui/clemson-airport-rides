import { useState } from 'react'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { googleAuthButtonState } from 'rides-native/googleAuthConfig'
import { DRIVER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { DriverClickwrap } from 'rides-native/DriverClickwrap'
import {
  CLICKWRAP_STORAGE_KEY,
  DRIVER_CLICKWRAP_VERSION,
  submitDriverClickwrap,
} from 'rides-native/driverClickwrapClient'
import { mayCreateDriverAccount } from '../../../shared/driverClickwrap.js'
import { useAuth } from '@/lib/auth'
import { useSocialSignIn } from '@/lib/socialSignIn'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

function appVersion() {
  return Constants.expoConfig?.version || '1.1.0'
}

async function recordClickwrap() {
  if (!supabase) return
  const saved = await submitDriverClickwrap(supabase, { appVersion: appVersion() })
  if (saved?.accepted && saved.acceptance?.agreementVersion === DRIVER_CLICKWRAP_VERSION) {
    await authStorage.setItem(CLICKWRAP_STORAGE_KEY, DRIVER_CLICKWRAP_VERSION)
  }
}

export default function SignUpRoute() {
  const router = useRouter()
  const { signUp } = useAuth()
  const onSocial = useSocialSignIn()
  const { colors } = useTheme()
  const [agreed, setAgreed] = useState(false)
  const googleState = googleAuthButtonState(process.env, { scheme: 'clemsonrides-driver', provider: 'supabase' })

  const socialProviders = DRIVER_SOCIAL_PROVIDERS.map((provider) => {
    if (provider.id === 'google') {
      return {
        ...provider,
        enabled: googleState.enabled,
        disabled: googleState.disabled,
        message: googleState.message,
        disabledLabel: 'Continue with Google (coming soon)',
      }
    }
    return provider
  })

  if (!mayCreateDriverAccount(agreed)) {
    return (
      <DriverClickwrap
        colors={colors}
        onBack={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/')
        }}
        onAgree={() => setAgreed(true)}
      />
    )
  }

  return (
    <SignUpScreen
      signUp={async (email, password, fullName, promo, profile) => {
        if (!mayCreateDriverAccount(agreed)) {
          throw new Error('Agree to the Driver Agreement before creating an account.')
        }
        const result = await signUp(email, password, fullName, promo, profile)
        if (result?.session) {
          try { await recordClickwrap() } catch { /* next launch asks until the row exists */ }
        }
        return result
      }}
      storage={authStorage}
      mark="CD"
      showPromo={false}
      subtitle="Drive with Clemson Rides. You keep 80% of the fare. Boosts and backup pay on scheduled rides are extra. New drivers are never auto-approved."
      socialProviders={socialProviders}
      onSocial={async (providerId, extra) => {
        if (!mayCreateDriverAccount(agreed)) {
          throw new Error('Agree to the Driver Agreement before creating an account.')
        }
        const result = await onSocial(providerId, extra)
        if (result && !result.cancelled) {
          try { await recordClickwrap() } catch { /* next launch asks until the row exists */ }
        }
        return result
      }}
      onSuccess={() => router.replace('/')}
      onSignIn={() => router.replace('/sign-in')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
