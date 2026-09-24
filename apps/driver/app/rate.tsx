import { useLocalSearchParams, useRouter } from 'expo-router'
import { ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RateTripPanel, partyColorsFromPalette } from 'rides-native/PartyScreens'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

export default function RateRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ trip?: string }>()
  const tripId = oneParam(params.trip)
  const { user } = useAuth()
  const { colors } = useTheme()

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}>
      {user && tripId ? (
        <RateTripPanel
          supabase={supabase}
          userId={user.id}
          tripId={tripId}
          colors={partyColorsFromPalette(colors)}
          onDone={() => router.replace('/')}
          onLater={() => router.back()}
        />
      ) : null}
    </ScrollView>
  )
}
