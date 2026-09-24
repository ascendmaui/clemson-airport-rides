import { useClerk } from '@clerk/expo'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback } from 'react'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { RIDER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { takeAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { clerkPublishableKey, missingClerkPublishableMessage } from '@/lib/clerkEnv'
import { useClerkSocialSignIn } from '@/lib/clerkSocial'
import { withFreshAuth, type ClerkLike } from '@/lib/freshAuth'
import { oneParam } from '@/lib/oneParam'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'

function finish(router: ReturnType<typeof useRouter>) {
  const next = takeAuthNext()
  if (next) router.replace(next)
  else router.replace('/')
}

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
  const params = useLocalSearchParams<{ ref?: string }>()
  const { signUp: rawSignUp } = useAuth()
  const signUp = guardSignUp ? guardSignUp(rawSignUp) : rawSignUp
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
  const clerk = useClerk() as unknown as ClerkLike
  // Email sign-up is Supabase Auth (no Clerk signUp.create), but a stale Clerk
  // JWT would still poison the next social tap, so create-account runs behind
  // the same guard: a live cached account goes straight in, a stale one is cleared.
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
