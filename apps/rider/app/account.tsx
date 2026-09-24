import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill, PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { loadAccount, saveProfile } from '@/lib/accountApi'
import { useAuth } from '@/lib/auth'
import { playTigerCue, setSoundsEnabled, soundsEnabled, tapHaptic } from '@/lib/feedback'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme, type DisplayMode } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { displayFirstName, isClemsonEmail } from 'rides-native/authErrors'
import { FAVORITE_SPOTS } from 'rides-native/riderShell.js'

const DISPLAY: { id: DisplayMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

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
  const { colors, displayMode, setDisplayMode, solarPlace } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [spots, setSpots] = useState<string[]>([])
  const [fullName, setFullName] = useState('')
  const [bio, setBio] = useState('')
  const [soundsOn, setSoundsOn] = useState(true)
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
        {user && isClemsonEmail(user.email) ? (
          <Text style={styles.badge}>Clemson student · 10% off Standard</Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.push('/safety')} style={[styles.safety, lift(colors, 'rest')]}>
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
          <Pressable key={link.href} onPress={() => router.push(link.href)} style={[styles.row, lift(colors, 'rest')]} accessibilityRole="button">
            <Text style={styles.rowTitle}>{link.label}</Text>
            <Text style={styles.copy}>{link.hint}</Text>
          </Pressable>
        ))}
        <View style={[styles.row, lift(colors, 'rest')]}>
          <Text style={styles.rowTitle}>Display</Text>
          <Text style={styles.copy}>
            Auto follows sunrise and sunset for {solarPlace}. Clemson orange and purple stay the same at night.
          </Text>
          <View style={styles.pills}>
            {DISPLAY.map((option) => (
              <Pill
                key={option.id}
                label={option.label}
                active={displayMode === option.id}
                onPress={() => {
                  void tapHaptic()
                  setDisplayMode(option.id)
                }}
              />
            ))}
          </View>
        </View>
        <View style={[styles.row, lift(colors, 'rest')]}>
          <Text style={styles.rowTitle}>Favorite spots</Text>
          <Text style={styles.copy}>Pick up to six, including White C and Bigsby.</Text>
          <View style={styles.pills}>
            {FAVORITE_SPOTS.map((spot) => (
              <Pill key={spot} label={spot} active={spots.includes(spot)} onPress={() => toggleSpot(spot)} />
            ))}
          </View>
          <PrimaryButton label={busy ? 'Saving…' : 'Save spots'} onPress={onSaveSpots} disabled={busy} tone="ghost" />
        </View>
        <View style={[styles.row, lift(colors, 'rest')]}>
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

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, gap: 12, paddingBottom: 24 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.2, fontSize: 12 },
    title: { fontSize: 28, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.4 },
    copy: { fontSize: 14, lineHeight: 20, color: colors.inkSecondary },
    badge: { color: colors.link, fontWeight: '700' as const },
    safety: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    safetyKicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    safetyTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16, marginTop: 4 },
    safetyBody: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
    row: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    rowTitle: { color: colors.ink, fontWeight: '800' as const, fontSize: 16 },
    pills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
    note: { color: colors.link, fontWeight: '700' as const, fontSize: 13 },
    error: { color: colors.danger, fontSize: 13 },
  }
}
