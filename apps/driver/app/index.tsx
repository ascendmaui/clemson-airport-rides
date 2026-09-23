import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap } from '@/components/CampusMap'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { fetchDriverApplication, setDriverOnline } from 'rides-native/drivers'
import { displayFirstName } from 'rides-native/authErrors'
import { INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

const GATE: Record<string, { title: string; body: string }> = {
  pending_info: {
    title: 'Finish driver signup',
    body: 'Add your info and vehicle, then upload your documents. New drivers are not approved automatically.',
  },
  pending_docs: {
    title: 'Upload your documents',
    body: 'License, insurance, registration, and car photos are required before an admin can review you.',
  },
  pending_review: {
    title: 'Application in review',
    body: 'You cannot go online or accept rides until the application is approved.',
  },
  rejected: {
    title: 'Application needs changes',
    body: 'Update your documents and submit again. You still cannot receive rides.',
  },
  none: {
    title: 'Become a driver',
    body: 'Create your driver profile on the web and upload documents. An admin approves every new driver before they can receive rides.',
  },
}

export default function DriverHome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, configured } = useAuth()
  const [online, setOnline] = useState(false)
  const [status, setStatus] = useState<string>('none')
  const [reason, setReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const approved = status === 'approved'
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : 'Driver'

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const application = await fetchDriverApplication(supabase, user.id)
    setStatus(application.application?.onboarding_status || 'none')
    setReason(application.application?.rejection_reason || null)
    if (application.error) setError(application.error)
    const { data } = await supabase.from('driver_status').select('online').eq('driver_id', user.id).maybeSingle()
    setOnline(Boolean(data?.online))
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function toggle() {
    if (!user) {
      router.push('/sign-in')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setDriverOnline(supabase, user.id, !online)
      setOnline(!online)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update online status')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const gate = GATE[status] || GATE.none

  return (
    <View style={styles.screen}>
      <CampusMap />
      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: insets.top + 10 }]}>
        <View style={styles.brand}>
          <Text style={styles.kicker}>DRIVER</Text>
          <Text style={styles.brandTitle}>Clemson RIDES</Text>
        </View>
        <View style={styles.sheet}>
          {!configured ? (
            <Text style={styles.error}>Add EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable, then rebuild.</Text>
          ) : null}
          {!user ? (
            <>
              <Text style={styles.title}>Sign in to drive</Text>
              <Text style={styles.copy}>Email and password only. The same Supabase project as the web app.</Text>
              <Pressable onPress={() => router.push('/sign-in')} style={styles.primary}>
                <Text style={styles.primaryText}>Sign in</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>{approved ? (online ? 'You’re online' : 'You’re offline') : gate.title}</Text>
              <Text style={styles.copy}>
                {approved
                  ? `${name}, airport and campus requests show up after you go online.`
                  : gate.body}
              </Text>
              {reason ? <Text style={styles.error}>{reason}</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable onPress={toggle} disabled={busy || !approved} style={[styles.primary, (!approved || busy) && styles.disabled]}>
                <Text style={styles.primaryText}>
                  {busy ? 'Saving…' : approved ? (online ? 'Go offline' : 'Go online') : 'Approval required'}
                </Text>
              </Pressable>
            </>
          )}
          <Pressable onPress={() => router.push('/account')} style={styles.link}>
            <Text style={styles.linkText}>Account</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  brand: {
    alignSelf: 'flex-start',
    marginLeft: 16,
    backgroundColor: PURPLE,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  kicker: { color: ORANGE, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  brandTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 4 },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 28,
    gap: 10,
  },
  title: { fontSize: 24, fontWeight: '800', color: PURPLE, letterSpacing: -0.3 },
  copy: { color: INK_SECONDARY, fontSize: 15, lineHeight: 21 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  primary: { backgroundColor: ORANGE, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  disabled: { opacity: 0.55 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: PURPLE, fontWeight: '700' },
})
