import { useRouter } from 'expo-router'
import { SignInScreen } from 'rides-native/AuthScreens'
import { DRIVER_GOOGLE_PROVIDER } from 'rides-native/googleAuth'
import { useAuth } from '@/lib/auth'
import { signInWithGoogle } from '@/lib/googleSignIn'

export default function SignInRoute() {
  const router = useRouter()
  const { signIn } = useAuth()
  return (
    <SignInScreen
      signIn={signIn}
      mark="CD"
      subtitle="Sign in with Google or with the email and password on your driver account."
      socialProviders={DRIVER_GOOGLE_PROVIDER}
      onSocial={() => signInWithGoogle()}
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
