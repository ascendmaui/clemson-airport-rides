import { useLocalSearchParams, useRouter } from 'expo-router'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { googleAuthButtonState } from 'rides-native/googleAuthConfig'
import { RIDER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { takeAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { useSocialSignIn } from '@/lib/socialSignIn'
import { authStorage } from '@/lib/storage'

function finish(router: ReturnType<typeof useRouter>) {
  const next = takeAuthNext()
  if (next) router.replace(next)
  else router.replace('/')
}

export default function SignUpRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{ ref?: string }>()
  const { signUp } = useAuth()
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
    <SignUpScreen
      signUp={signUp}
      storage={authStorage}
      socialProviders={socialProviders}
      onSocial={onSocial}
      mark="CR"
      initialPromo={oneParam(params.ref)}
      subtitle="Metered fares to GSP and CLT. Students save 10% on Standard."
      onSuccess={() => finish(router)}
      onSignIn={() => router.replace('/sign-in')}
      onOpenLegal={(doc) => router.push({ pathname: '/legal', params: { doc } })}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
