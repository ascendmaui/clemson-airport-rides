import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { useAuth } from '@/lib/auth'
import { INK_SECONDARY, PURPLE, SURFACE } from 'rides-native/places.js'

export default function ScheduleScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.body}>
        <Text style={styles.kicker}>AIRPORT</Text>
        <Text style={styles.title}>Schedule a ride</Text>
        <Text style={styles.copy}>
          Plan a pickup ahead of time, or hold an airport ride with a 25% deposit. GSP and CLT flat rates stay on the web schedule until PaymentSheet lands in the rider app.
        </Text>
        <Text style={styles.copy}>
          {user
            ? `Signed in as ${user.email}. Deposit checkout is the next phase — this screen will not pretend a hold was placed.`
            : 'Browse freely. Sign in when you are ready to hold a ride.'}
        </Text>
        {user ? null : <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />}
      </View>
      <MainTabs active="schedule" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  body: { flex: 1, padding: 20 },
  kicker: { color: '#F56600', fontWeight: '800', letterSpacing: 1.2, fontSize: 12 },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE, marginTop: 8, letterSpacing: -0.4 },
  copy: { marginTop: 12, fontSize: 15, lineHeight: 22, color: INK_SECONDARY },
})
