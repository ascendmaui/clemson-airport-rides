import { useRouter } from 'expo-router'
import { ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ProfileSetupScreen } from 'rides-native/PartyScreens'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function ProfileSetupRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, signOut } = useAuth()

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F7F4F0' }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <ProfileSetupScreen
        supabase={supabase}
        user={user}
        mark="CR"
        onDone={() => router.replace('/')}
        onSignOut={async () => {
          await signOut()
          router.replace('/sign-in')
        }}
      />
    </ScrollView>
  )
}
