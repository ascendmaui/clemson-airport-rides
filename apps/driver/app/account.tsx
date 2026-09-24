import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { registerDriverPush, type PushState } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { displayFirstName } from 'rides-native/authErrors'
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

  useEffect(() => {
    if (!user) return
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
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={() => router.back()} style={styles.back}>
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
          <Pressable onPress={() => router.push('/onboarding')} style={styles.linkRow}>
            <Text style={styles.linkText}>Driver application</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/queue')} style={styles.linkRow}>
            <Text style={styles.linkText}>Ride queue</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/earnings')} style={styles.linkRow}>
            <Text style={styles.linkText}>Earnings and deposits</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/fleet')} style={styles.linkRow}>
            <Text style={styles.linkText}>Tesla Model 3 fleet</Text>
          </Pressable>
        </>
      ) : null}
      {user ? (
        <Pressable onPress={onSignOut} disabled={busy} style={styles.primary}>
          <Text style={styles.primaryText}>{busy ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={() => router.push('/sign-in')} style={styles.primary}>
          <Text style={styles.primaryText}>Sign in</Text>
        </Pressable>
      )}
    </View>
  )
}

function accountStyles(colors: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 20, gap: 12 },
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
