import { useRouter } from 'expo-router'
import { ForgotPasswordScreen } from 'rides-native/AuthScreens'
import { useAuth } from '@/lib/auth'

export default function ForgotPasswordRoute() {
  const router = useRouter()
  const { resetPassword } = useAuth()
  return (
    <ForgotPasswordScreen
      resetPassword={resetPassword}
      onSignIn={() => router.replace('/sign-in')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/sign-in')
      }}
    />
  )
}
