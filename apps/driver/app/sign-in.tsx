import { useRouter } from 'expo-router'
import { SignInScreen } from 'rides-native/AuthScreens'
import { googleAuthButtonState } from 'rides-native/googleAuthConfig'
import { DRIVER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { useAuth } from '@/lib/auth'
import { useSocialSignIn } from '@/lib/socialSignIn'

export default function SignInRoute() {
  const router = useRouter()
  const { signIn, resetPassword } = useAuth()
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
    <SignInScreen
      signIn={signIn}
      mark="CD"
      subtitle="Sign in with Apple, Google, or the email and password on your driver account."
      socialProviders={socialProviders}
      onSocial={onSocial}
      resetPassword={resetPassword}
      onForgotPassword={() => router.push('/forgot-password')}
      onSuccess={() => router.replace('/')}
      onCreateAccount={() => router.push('/sign-up')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
