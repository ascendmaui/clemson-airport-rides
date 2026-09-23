import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { useAuth } from '@/lib/auth'
import { displayFirstName } from 'rides-native/authErrors'
import { INK_SECONDARY, PURPLE, SURFACE } from 'rides-native/places.js'

export default function FriendsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Tiger') : null
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.body}>
        <Text style={styles.kicker}>GAME DAY</Text>
        <Text style={styles.title}>Carpool · split the surge</Text>
        <Text style={styles.copy}>About $10–$15 each instead of $30–$40.</Text>
        <Text style={styles.copy}>
          Friend rides and carpool matching stay on the web for this phase. Sign-in here is the same Supabase account.
        </Text>
        {name ? <Text style={styles.copy}>Signed in as {name}.</Text> : <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />}
      </View>
      <MainTabs active="friends" />
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
