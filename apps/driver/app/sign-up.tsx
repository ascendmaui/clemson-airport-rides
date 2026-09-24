import { useRouter } from 'expo-router'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { useAuth } from '@/lib/auth'
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
      subtitle="Create the driver account and ride profile. Admin approval is still required before you can go online."
      onSuccess={() => router.replace('/')}
      onSignIn={() => router.replace('/sign-in')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
