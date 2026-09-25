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
  const googleState = googleAuthButtonState(process.env, { scheme: 'clemsonrides-driver' })

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
      subtitle="Create a driver account. You can set up billing and your profile while an admin reviews the application."
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
