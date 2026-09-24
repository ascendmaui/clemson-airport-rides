import { useLocalSearchParams, useRouter } from 'expo-router'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { RIDER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { takeAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { clerkPublishableKey, missingClerkPublishableMessage } from '@/lib/clerkEnv'
import { useClerkSocialSignIn } from '@/lib/clerkSocial'
import { oneParam } from '@/lib/oneParam'
import { authStorage } from '@/lib/storage'

function finish(router: ReturnType<typeof useRouter>) {
  const next = takeAuthNext()
  if (next) router.replace(next)
  else router.replace('/')
}

function SignUpForm({
  onSocial,
}: {
  onSocial: (
    providerId: 'apple' | 'google' | 'facebook',
    extra?: { promo?: string; fullName?: string },
  ) => Promise<{ cancelled?: boolean } | void>
}) {
  const router = useRouter()
  const params = useLocalSearchParams<{ ref?: string }>()
  const { signUp } = useAuth()
  return (
    <SignUpScreen
      signUp={signUp}
      storage={authStorage}
      socialProviders={RIDER_SOCIAL_PROVIDERS}
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

function ClerkSignUpForm() {
  const onSocial = useClerkSocialSignIn()
  return <SignUpForm onSocial={onSocial} />
}

export default function SignUpRoute() {
  if (!clerkPublishableKey()) {
    return (
      <SignUpForm
        onSocial={async () => {
          throw new Error(missingClerkPublishableMessage())
        }}
      />
    )
  }
  return <ClerkSignUpForm />
}
