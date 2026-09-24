import { useLocalSearchParams, useRouter } from 'expo-router'
import { ScrollView, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RateTripPanel } from 'rides-native/PartyScreens'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { INK_SECONDARY, PURPLE, SURFACE } from 'rides-native/places.js'

export default function RateRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ trip?: string }>()
  const tripId = oneParam(params.trip)
  const { user } = useAuth()

  return (
    <ScrollView style={{ flex: 1, backgroundColor: SURFACE }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <Text style={{ color: PURPLE, fontSize: 13, fontWeight: '800' }} onPress={() => router.back()}>← Back</Text>
      {user && tripId ? (
        <RateTripPanel
          supabase={supabase}
          userId={user.id}
          tripId={tripId}
          onDone={() => router.replace('/')}
          onLater={() => router.back()}
        />
      ) : (
        <Text style={{ color: INK_SECONDARY }}>Sign in to rate this ride.</Text>
      )}
    </ScrollView>
  )
}
