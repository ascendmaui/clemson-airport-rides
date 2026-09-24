import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { useAuth } from '@/lib/auth'
import { displayFirstName, isClemsonEmail } from 'rides-native/authErrors'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

const LINKS: { href: '/billing' | '/student' | '/promo' | '/notifications' | '/history' | '/schedule'; label: string; hint: string }[] = [
  { href: '/billing', label: 'Billing', hint: 'Card on file, deposits, and ride history' },
  { href: '/student', label: 'Student', hint: 'Verify a Clemson email · 10% off Standard' },
  { href: '/promo', label: 'Promo codes', hint: 'Apply a friend code or share yours' },
  { href: '/notifications', label: 'Notifications', hint: 'Ride, billing, friends, and promo alerts' },
  { href: '/history', label: 'Your rides', hint: 'Fare and deposit on each trip' },
  { href: '/schedule', label: 'Airport deposit', hint: '25% Stripe checkout for GSP and CLT' },
]

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
      <ScrollView contentContainerStyle={styles.body}>
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
            ? 'Payments, student pricing, promos, and alerts use the same account as the web app.'
            : 'Supabase anon key is missing. Add EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable, then rebuild.'}
        </Text>
        {LINKS.map((link) => (
          <Pressable key={link.href} onPress={() => router.push(link.href)} style={styles.row} accessibilityRole="button">
            <Text style={styles.rowTitle}>{link.label}</Text>
            <Text style={styles.copy}>{link.hint}</Text>
          </Pressable>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {user ? (
          <PrimaryButton label={busy ? 'Signing out…' : 'Sign out'} onPress={onSignOut} disabled={busy} tone="purple" />
        ) : (
          <View style={{ gap: 10 }}>
            <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />
            <PrimaryButton label="Create account" onPress={() => router.push('/sign-up')} tone="ghost" />
          </View>
        )}
      </ScrollView>
      <MainTabs active="account" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  body: { padding: 20, gap: 12, paddingBottom: 24 },
  kicker: { color: '#F56600', fontWeight: '800', letterSpacing: 1.2, fontSize: 12 },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE, letterSpacing: -0.4 },
  copy: { fontSize: 14, lineHeight: 20, color: INK_SECONDARY },
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
  row: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.1)',
    gap: 4,
  },
  rowTitle: { color: INK, fontWeight: '800', fontSize: 16 },
  error: { color: '#B42318', fontSize: 13 },
})
