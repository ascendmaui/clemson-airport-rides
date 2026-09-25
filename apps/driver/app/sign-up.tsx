import { useRouter } from 'expo-router'
import { SignUpScreen } from 'rides-native/AuthScreens'
import { DRIVER_SOCIAL_PROVIDERS } from 'rides-native/socialAuth'
import { useAuth } from '@/lib/auth'
import { useSocialSignIn } from '@/lib/socialSignIn'
import { authStorage } from '@/lib/storage'

export default function SignUpRoute() {
  const router = useRouter()
  const { signUp } = useAuth()
  const onSocial = useSocialSignIn()

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
