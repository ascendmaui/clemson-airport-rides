import { useClerk } from '@clerk/expo'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { DRIVER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { useAuth } from '@/lib/auth'
import { clerkPublishableKey, missingClerkPublishableMessage } from '@/lib/clerkEnv'
import { useClerkSocialSignIn } from '@/lib/clerkSocial'
import { withFreshAuth, type ClerkLike } from '@/lib/freshAuth'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'

type SignUpFn = ReturnType<typeof useAuth>['signUp']
type SignUpResult = Awaited<ReturnType<SignUpFn>>

function SignUpForm({
  onSocial,
  guardSignUp,
}: {
  /** Wraps email create-account in the shared stale-session guard (Clerk builds only). */
  guardSignUp?: (signUp: SignUpFn) => SignUpFn
  onSocial: (
    providerId: 'apple' | 'google' | 'facebook',
    extra?: { promo?: string; fullName?: string },
  ) => Promise<{ cancelled?: boolean } | void>
}) {
  const router = useRouter()
  const { signUp: rawSignUp } = useAuth()
  const signUp = guardSignUp ? guardSignUp(rawSignUp) : rawSignUp
  return (
    <SignUpScreen
      signUp={signUp}
      storage={authStorage}
      mark="CD"
      showPromo={false}
      subtitle="Create a driver account. You can set up billing and your profile while an admin reviews the application."
      socialProviders={DRIVER_SOCIAL_PROVIDERS}
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

function ClerkSignUpForm() {
  const onSocial = useClerkSocialSignIn()
  const clerk = useClerk() as unknown as ClerkLike
  const guardSignUp = useCallback((signUp: SignUpFn): SignUpFn => (
    (...args) => withFreshAuth<SignUpResult>(clerk, () => signUp(...args), {
      onSignedIn: async () => {
        const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
        return { session: data.session, user: data.session?.user ?? null, promoClaim: null } as SignUpResult
      },
    })
  ), [clerk])
  return <SignUpForm onSocial={onSocial} guardSignUp={guardSignUp} />
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
