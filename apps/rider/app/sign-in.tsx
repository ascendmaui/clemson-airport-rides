import { useRouter } from 'expo-router'
import { SignInScreen } from 'rides-native/AuthScreens'
import { googleAuthButtonState } from 'rides-native/googleAuthConfig'
import { RIDER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { takeAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { useSocialSignIn } from '@/lib/socialSignIn'

function finish(router: ReturnType<typeof useRouter>) {
  const next = takeAuthNext()
  if (next) router.replace(next)
  else router.replace('/')
}

export default function SignInRoute() {
  const router = useRouter()
  const { signIn, resetPassword } = useAuth()
  const onSocial = useSocialSignIn()
  const googleState = googleAuthButtonState(process.env, { scheme: 'clemsonrides' })

  const socialProviders = RIDER_SOCIAL_PROVIDERS.map((provider) => {
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
      resetPassword={resetPassword}
      socialProviders={socialProviders}
      onSocial={onSocial}
      mark="CR"
      subtitle="Sign in to book airport rides. Surge applies on busy hours and game days."
      onSuccess={() => finish(router)}
      onCreateAccount={() => router.push('/sign-up')}
      onForgotPassword={() => router.push('/forgot-password')}
      onOpenLegal={(doc) => router.push({ pathname: '/legal', params: { doc } })}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
