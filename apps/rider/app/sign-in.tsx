import { useRouter } from 'expo-router'
import { SignInScreen } from 'rides-native/AuthScreens'
import { RIDER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { takeAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { clerkPublishableKey, missingClerkPublishableMessage } from '@/lib/clerkEnv'
import { useClerkSocialSignIn } from '@/lib/clerkSocial'

function finish(router: ReturnType<typeof useRouter>) {
  const next = takeAuthNext()
  if (next) router.replace(next)
  else router.replace('/')
}

function SignInForm({
  onSocial,
}: {
  onSocial: (providerId: 'apple' | 'google' | 'facebook') => Promise<{ cancelled?: boolean } | void>
}) {
  const router = useRouter()
  const { signIn, resetPassword } = useAuth()
  return (
    <SignInScreen
      signIn={signIn}
      resetPassword={resetPassword}
      socialProviders={RIDER_SOCIAL_PROVIDERS}
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

function ClerkSignInForm() {
  const onSocial = useClerkSocialSignIn()
  return <SignInForm onSocial={onSocial} />
}

export default function SignInRoute() {
  if (!clerkPublishableKey()) {
    return (
      <SignInForm
        onSocial={async () => {
          throw new Error(missingClerkPublishableMessage())
        }}
      />
    )
  }
  return <ClerkSignInForm />
}
