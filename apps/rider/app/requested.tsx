import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { oneParam } from '@/lib/oneParam'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

export default function Requested() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; trip?: string; driver?: string }>()
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24 }]}>
      <View style={styles.mark}>
        <Text style={styles.markText}>CR</Text>
      </View>
      <Text style={styles.title}>Ride requested</Text>
      <Text style={styles.body}>
        {oneParam(params.driver, 'Your driver')} has the request to {oneParam(params.dest, 'your destination')}.
        Trip {oneParam(params.trip)}.
      </Text>
      <Text style={styles.note}>
        The 25% airport deposit (Stripe PaymentSheet), driver accept, and live tracking ship in the next phases. This request is a real Supabase trip row, the same insert the web app uses.
      </Text>
      <PrimaryButton label="Back to rides" onPress={() => router.replace('/')} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE, padding: 24 },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  markText: { color: '#fff', fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE, letterSpacing: -0.4 },
  body: { marginTop: 10, fontSize: 16, lineHeight: 22, color: INK },
  note: { marginTop: 14, marginBottom: 22, fontSize: 14, lineHeight: 20, color: INK_SECONDARY },
})
