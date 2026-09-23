import { useLocalSearchParams, useRouter } from 'expo-router'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { takeAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { authStorage } from '@/lib/storage'

export default function SignUpRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{ ref?: string }>()
  const { signUp } = useAuth()
  return (
    <SignUpScreen
      signUp={signUp}
      storage={authStorage}
      mark="CR"
      initialPromo={oneParam(params.ref)}
      subtitle="Metered fares to GSP and CLT. Students save 10% on Standard."
      onSuccess={() => {
        const next = takeAuthNext()
        if (next) router.replace(next)
        else router.replace('/')
      }}
      onSignIn={() => router.replace('/sign-in')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/')
      }}
    />
  )
}
