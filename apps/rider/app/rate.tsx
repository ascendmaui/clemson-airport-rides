import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, Text } from 'react-native'
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}>
        <Text style={{ color: colors.link, fontSize: 13, fontWeight: '800' }}>← Back</Text>
      </Pressable>
      {user && tripId ? (
        <RateTripPanel
          supabase={supabase}
          userId={user.id}
          tripId={tripId}
          colors={partyColorsFromPalette(colors)}
          onDone={() => router.replace('/')}
          onLater={() => router.back()}
        />
      ) : (
        <Text style={{ color: colors.inkSecondary }}>Sign in to rate this ride.</Text>
      )}
    </ScrollView>
  )
}
