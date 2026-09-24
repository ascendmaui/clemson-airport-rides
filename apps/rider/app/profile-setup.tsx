import { useRouter } from 'expo-router'
import { ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ProfileSetupScreen, partyColorsFromPalette } from 'rides-native/PartyScreens'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

export default function ProfileSetupRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, signOut } = useAuth()
  const { colors } = useTheme()

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      <ProfileSetupScreen
        supabase={supabase}
        user={user}
        colors={partyColorsFromPalette(colors)}
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
