import { useRouter } from 'expo-router'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { DRIVER_GOOGLE_PROVIDER } from 'rides-native/googleAuth'
import { useAuth } from '@/lib/auth'
import { signInWithGoogle } from '@/lib/googleSignIn'
import { authStorage } from '@/lib/storage'

export default function SignUpRoute() {
  const router = useRouter()
  const { signUp } = useAuth()
  return (
    <SignUpScreen
      signUp={signUp}
      storage={authStorage}
      mark="CD"
      showPromo={false}
      subtitle="Create a driver account. You can set up billing and your profile while an admin reviews the application."
      socialProviders={DRIVER_GOOGLE_PROVIDER}
      onSocial={() => signInWithGoogle()}
      onSuccess={() => router.replace('/')}
      onSignIn={() => router.replace('/sign-in')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
