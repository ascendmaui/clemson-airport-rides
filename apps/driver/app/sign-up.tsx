import { useRouter } from 'expo-router'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { googleAuthButtonState } from 'rides-native/googleAuthConfig'
import { DRIVER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { useAuth } from '@/lib/auth'
import { useSocialSignIn } from '@/lib/socialSignIn'
import { authStorage } from '@/lib/storage'

export default function SignUpRoute() {
  const router = useRouter()
  const { signUp } = useAuth()
  const onSocial = useSocialSignIn()
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

  return (
    <SignUpScreen
      signUp={signUp}
      storage={authStorage}
      mark="CD"
      showPromo={false}
      subtitle="Drive with Clemson RIDES. You keep 80% of the fare. Boosts and backup pay on scheduled rides are extra. New drivers are never auto-approved."
      socialProviders={socialProviders}
      onSocial={onSocial}
      onSuccess={() => router.replace('/')}
      onSignIn={() => router.replace('/sign-in')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
