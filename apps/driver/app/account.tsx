import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { registerDriverPush, type PushState } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { displayFirstName } from 'rides-native/authErrors'
import { WomenOnlyCard } from 'rides-native/WomenOnlyCard'
import { loadComfortPreference, saveComfortPreference } from 'rides-native/comfortPreference.js'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

export default function AccountScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, configured, signOut } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => accountStyles(colors), [colors])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [push, setPush] = useState<PushState | null>(null)
  const [genderIdentity, setGenderIdentity] = useState('unspecified')
  const [womenOnly, setWomenOnly] = useState(false)
  const [comfortAvailable, setComfortAvailable] = useState(false)
  const [comfortNote, setComfortNote] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    loadComfortPreference(supabase, user.id).then((comfort) => {
      setGenderIdentity(comfort.genderIdentity)
      setWomenOnly(comfort.womenOnlyMatching)
      setComfortAvailable(comfort.available)
    }).catch(() => {})
    registerDriverPush(supabase, user.id).then(setPush).catch((err) => {
      setPush({
        granted: false,
        token: null,
        stored: false,
        detail: err instanceof Error ? err.message : 'Could not register notifications',
      })
    })
  }, [user])
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : null

  async function persistComfort(nextGender: string, nextWomenOnly: boolean) {
    if (!user?.id || !supabase) return
    setComfortNote(null)
    try {
      const saved = await saveComfortPreference(supabase, user.id, {
        genderIdentity: nextGender,
        womenOnly: nextWomenOnly,
      })
      setGenderIdentity(saved.genderIdentity)
      setWomenOnly(saved.womenOnlyMatching)
      setComfortNote('Comfort preference saved')
    } catch (err) {
      setComfortNote(err instanceof Error ? err.message : 'Could not save the comfort preference')
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
    <ScrollView style={[styles.screen, { paddingTop: insets.top + 12 }]} contentContainerStyle={styles.list}>
      <Pressable
        onPress={() => router.back()}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Back"
        accessibilityHint="Navigates to previous screen"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.backText}>←</Text>
      </Pressable>
      <Text style={styles.title}>{name || 'Guest'}</Text>
      {user?.email ? <Text style={styles.copy}>{user.email}</Text> : <Text style={styles.copy}>Sign in with email and password.</Text>}
      <Text style={styles.copy}>
        {configured ? 'Supabase Auth is configured for this build.' : 'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY on this build.'}
      </Text>
      {push?.detail ? <Text style={styles.copy}>{push.detail}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {user ? (
        <>
          <Pressable
            onPress={() => router.push('/onboarding')}
            style={styles.linkRow}
            accessibilityRole="button"
            accessibilityLabel="Driver application"
            accessibilityHint="Navigates to driver application and onboarding flow"
          >
            <Text style={styles.linkText}>Driver application</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/queue')}
            style={styles.linkRow}
            accessibilityRole="button"
            accessibilityLabel="Ride queue"
            accessibilityHint="Navigates to driver ride queue"
          >
            <Text style={styles.linkText}>Ride queue</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/earnings')}
            style={styles.linkRow}
            accessibilityRole="button"
            accessibilityLabel="Earnings and deposits"
            accessibilityHint="Navigates to earnings and deposit breakdown"
          >
            <Text style={styles.linkText}>Earnings and deposits</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/fleet')}
            style={styles.linkRow}
            accessibilityRole="button"
            accessibilityLabel="Extra Comfort fleet"
            accessibilityHint="Navigates to Extra Comfort fleet options"
          >
            <Text style={styles.linkText}>Extra Comfort fleet</Text>
          </Pressable>
        </>
      ) : null}
      {user ? (
        <WomenOnlyCard
          role="driver"
          genderIdentity={genderIdentity}
          womenOnlyMatching={womenOnly}
          available={comfortAvailable}
          note={comfortNote}
          colors={colors}
          onGender={(next: string) => persistComfort(next, next === 'woman' ? womenOnly : false)}
          onToggle={(next: boolean) => persistComfort(genderIdentity, next)}
        />
      ) : null}
      {user ? (
        <Pressable
          onPress={onSignOut}
          disabled={busy}
          style={styles.primary}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.primaryText}>{busy ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.push('/sign-in')}
          style={styles.primary}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityHint="Navigates to sign in screen"
        >
          <Text style={styles.primaryText}>Sign in</Text>
        </Pressable>
      )}
    </ScrollView>
  )
}

function accountStyles(colors: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { padding: 20, gap: 12, paddingBottom: 40 },
    back: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
    backText: { color: colors.title, fontSize: 18, fontWeight: '700' },
    title: { fontSize: 28, fontWeight: '800', color: colors.title },
    copy: { color: colors.inkSecondary, fontSize: 15, lineHeight: 21 },
    error: { color: colors.danger },
    linkRow: { backgroundColor: colors.card, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16 },
    linkText: { color: colors.title, fontWeight: '800' },
    primary: { backgroundColor: colors.orange, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    primaryText: { color: colors.onAccent, fontWeight: '700', fontSize: 16 },
  })
}
