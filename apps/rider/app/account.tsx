import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { useAuth } from '@/lib/auth'
import { displayFirstName, isClemsonEmail } from 'rides-native/authErrors'
import { INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

export default function AccountScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, configured, signOut } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Rider') : null

  async function onSignOut() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      router.replace('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.body}>
        <Text style={styles.kicker}>ACCOUNT</Text>
        <Text style={styles.title}>{name || 'Guest'}</Text>
        {user?.email ? <Text style={styles.copy}>{user.email}</Text> : null}
        {user && isClemsonEmail(user.email) ? (
          <Text style={styles.badge}>Clemson student · 10% off Standard</Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.push('/safety')} style={styles.safety}>
          <Text style={styles.safetyKicker}>SAFETY</Text>
          <Text style={styles.safetyTitle}>SOS, live location, emergency contacts</Text>
          <Text style={styles.safetyBody}>Share a trip link and confirm an alert before anyone is called.</Text>
        </Pressable>
        <Text style={styles.copy}>
          {configured
            ? 'Supabase Auth is configured for this build.'
            : 'Supabase anon key is missing. Add EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable, then rebuild.'}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {user ? (
          <PrimaryButton label={busy ? 'Signing out…' : 'Sign out'} onPress={onSignOut} disabled={busy} tone="purple" />
        ) : (
          <View style={{ gap: 10 }}>
            <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />
            <PrimaryButton label="Create account" onPress={() => router.push('/sign-up')} tone="ghost" />
          </View>
        )}
      </View>
      <MainTabs active="account" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  body: { flex: 1, padding: 20, gap: 12 },
  kicker: { color: '#F56600', fontWeight: '800', letterSpacing: 1.2, fontSize: 12 },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE, letterSpacing: -0.4 },
  copy: { fontSize: 15, lineHeight: 22, color: INK_SECONDARY },
  badge: { color: PURPLE, fontWeight: '700' },
  safety: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(82,45,128,0.14)',
  },
  safetyKicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 },
  safetyTitle: { color: PURPLE, fontWeight: '800', fontSize: 16, marginTop: 4 },
  safetyBody: { color: INK_SECONDARY, fontSize: 13, lineHeight: 18, marginTop: 4 },
  error: { color: '#B42318', fontSize: 13 },
})
