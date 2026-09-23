import { useRouter } from 'expo-router'
import { SignInScreen } from 'rides-native/AuthScreens'
import { takeAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'

export default function SignInRoute() {
  const router = useRouter()
  const { signIn } = useAuth()
  return (
    <SignInScreen
      signIn={signIn}
      mark="CR"
      subtitle="Sign in to book airport rides. Surge applies on busy hours and game days."
      onSuccess={() => {
        const next = takeAuthNext()
        if (next) router.replace(next)
        else router.replace('/')
      }}
      onCreateAccount={() => router.push('/sign-up')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
