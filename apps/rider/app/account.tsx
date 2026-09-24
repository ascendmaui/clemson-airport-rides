import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill, PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { loadAccount, saveProfile } from '@/lib/accountApi'
import { useAuth } from '@/lib/auth'
import { playTigerCue, setSoundsEnabled, soundsEnabled, tapHaptic } from '@/lib/feedback'
import { displayFirstName, isClemsonEmail } from 'rides-native/authErrors'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'
import { FAVORITE_SPOTS } from 'rides-native/riderShell.js'
import { loadRatingSummary } from 'rides-native/PartyScreens'
import { supabase } from '@/lib/supabase'

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
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [spots, setSpots] = useState<string[]>([])
  const [fullName, setFullName] = useState('')
  const [bio, setBio] = useState('')
  const [soundsOn, setSoundsOn] = useState(true)
  const [ratingLine, setRatingLine] = useState('New · no ratings yet')
  const [pendingTrip, setPendingTrip] = useState<string | null>(null)
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Rider') : null

  useEffect(() => {
    let alive = true
    soundsEnabled().then((on) => {
      if (alive) setSoundsOn(on)
    })
    if (!user?.id) {
      setSpots([])
      return () => {
        alive = false
      }
    }
    loadAccount(user.id).then((account) => {
      if (!alive) return
      setSpots(account.profile?.favorite_spots || [])
      setFullName(account.profile?.full_name || user.user_metadata?.full_name || '')
      setBio(account.profile?.bio || '')
      if (account.error) setError(account.error)
    })
    if (supabase) {
      loadRatingSummary(supabase, user.id).then((summary) => {
        if (!alive) return
        setRatingLine(summary.line)
        setPendingTrip(summary.pending?.id || null)
      }).catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [user?.id])

  function toggleSpot(spot: string) {
    void tapHaptic()
    setSpots((prev) => (prev.includes(spot) ? prev.filter((item) => item !== spot) : [...prev, spot].slice(0, 6)))
  }

  async function onSaveSpots() {
    if (!user?.id) {
      router.push('/sign-in')
      return
    }
    setBusy(true)
    setNote(null)
    try {
      await saveProfile(user.id, {
        full_name: fullName || user.user_metadata?.full_name || '',
        bio,
        favorite_spots: spots,
      })
      setNote('Favorite spots saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save spots')
    } finally {
      setBusy(false)
    }
  }

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
        {user ? <Text style={styles.badge}>{ratingLine}</Text> : null}
        {pendingTrip ? (
          <PrimaryButton label="Rate your last ride" onPress={() => router.push({ pathname: '/rate', params: { trip: pendingTrip } })} />
        ) : null}
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
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Favorite spots</Text>
          <Text style={styles.copy}>Pick up to six, including White C and Bigsby.</Text>
          <View style={styles.pills}>
            {FAVORITE_SPOTS.map((spot) => (
              <Pill key={spot} label={spot} active={spots.includes(spot)} onPress={() => toggleSpot(spot)} />
            ))}
          </View>
          <PrimaryButton label={busy ? 'Saving…' : 'Save spots'} onPress={onSaveSpots} disabled={busy} tone="ghost" />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Sounds</Text>
          <Text style={styles.copy}>Tiger sounds use expo-audio and stay quiet when the phone is on silent or vibrate.</Text>
          <PrimaryButton
            label={soundsOn ? 'Tiger sounds · On' : 'Tiger sounds · Off'}
            tone={soundsOn ? 'orange' : 'ghost'}
            onPress={async () => {
              const next = !soundsOn
              await setSoundsEnabled(next)
              setSoundsOn(next)
              void tapHaptic()
              if (next) await playTigerCue()
            }}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
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
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  note: { color: PURPLE, fontWeight: '700', fontSize: 13 },
  error: { color: '#B42318', fontSize: 13 },
})
