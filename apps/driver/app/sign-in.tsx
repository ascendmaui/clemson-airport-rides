import { useRouter } from 'expo-router'
import { SignInScreen } from 'rides-native/AuthScreens'
import { DRIVER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { useAuth } from '@/lib/auth'
import { clerkPublishableKey, missingClerkPublishableMessage } from '@/lib/clerkEnv'
import { useClerkSocialSignIn } from '@/lib/clerkSocial'

function SignInForm({
  onSocial,
}: {
  onSocial: (providerId: 'apple' | 'google' | 'facebook') => Promise<{ cancelled?: boolean } | void>
}) {
  const router = useRouter()
  const { signIn } = useAuth()
  return (
    <SignInScreen
      signIn={signIn}
      mark="CD"
      subtitle="Sign in with Apple, Google, Facebook, or the email and password on your driver account."
      socialProviders={DRIVER_SOCIAL_PROVIDERS}
      onSocial={onSocial}
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

function ClerkSignInForm() {
  // Same Clerk social path + stale-session guard + Clerk -> Supabase bridge as the rider app.
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
