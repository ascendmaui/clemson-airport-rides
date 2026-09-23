import { useRouter } from 'expo-router'
import { SignInScreen } from 'rides-native/AuthScreens'
import { useAuth } from '@/lib/auth'

export default function SignInRoute() {
  const router = useRouter()
  const { signIn } = useAuth()
  return (
    <SignInScreen
      signIn={signIn}
      mark="CD"
      subtitle="Sign in to go online. Apple and Google sign-in are off — email and password only."
      onSuccess={() => router.replace('/')}
      onCreateAccount={() => router.push('/sign-up')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
