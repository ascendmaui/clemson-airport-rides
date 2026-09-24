import { useRouter } from 'expo-router'
import { ResetPasswordScreen } from 'rides-native/AuthScreens'
import { useAuth } from '@/lib/auth'

export default function ResetPasswordRoute() {
  const router = useRouter()
  const { updatePassword } = useAuth()
  return (
    <ResetPasswordScreen
      updatePassword={updatePassword}
      mark="CR"
      onSuccess={() => router.replace('/')}
      onBack={() => {
        if (router.canGoBack()) router.back()
        else router.replace('/sign-in')
      }}
    />
  )
}
