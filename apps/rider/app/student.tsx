import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { STUDENT_CLAIM_COPY, STUDENT_DISCOUNT_LABEL, loadStudentProfile, markStudentVerified, studentStatus } from 'rides-native/riderMoney.js'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { RequireAuth } from '@/components/RequireAuth'

function StudentScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(user?.email || null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const styles = useThemedStyles(makeStyles)

  const load = useCallback(() => {
    if (!user || !supabase) return undefined
    let alive = true
    loadStudentProfile(supabase, user.id).then((row) => {
      if (!alive) return
      setVerifiedAt(row.studentVerifiedAt)
      setEmail(row.email || user.email || null)
      if (row.error) setNote(row.error)
    })
    return () => {
      alive = false
    }
  }, [user])

  useFocusEffect(load)

  const status = studentStatus({
    email: user?.email || email,
    studentVerifiedAt: verifiedAt,
    user,
  })

  async function onVerify() {
    if (!user || !supabase) return
    setBusy(true)
    setNote(null)
    try {
      const result = await markStudentVerified(supabase, user)
      if (result.verifiedAt) setVerifiedAt(result.verifiedAt)
      setNote(result.error || (result.verified ? 'Verified. Standard fares quote 10% off.' : 'Not verified.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Student" onBack={() => router.back()} />
      <View style={styles.body}>
        <Text style={styles.kicker}>10% OFF STANDARD</Text>
        <View style={[styles.panel, status.verified && styles.panelOn]}>
          <Text style={styles.state}>{status.verified ? 'Verified student' : 'Not verified'}</Text>
          <Text style={styles.copy}>{email || user?.email || 'No email on this account'}</Text>
          {status.verifiedAt ? (
            <Text style={styles.copy}>Verified {new Date(status.verifiedAt).toLocaleDateString()}</Text>
          ) : null}
          {status.discountLabel ? <Text style={styles.badge}>{status.discountLabel}</Text> : null}
        </View>
        <Text style={styles.copy}>{STUDENT_CLAIM_COPY}</Text>
        {status.verified ? (
          <Text style={styles.copy}>
            {STUDENT_DISCOUNT_LABEL} is on Standard quotes. Comfort, XL, Pet, and Tesla stay full price. The airport deposit uses the discounted fare.
          </Text>
        ) : (
          <Text style={styles.copy}>{status.gateCopy}</Text>
        )}
        {!user ? <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
        {user && status.verified && !verifiedAt ? (
          <PrimaryButton label={busy ? 'Saving…' : 'Save student pricing'} onPress={onVerify} disabled={busy} />
        ) : null}
        {user && !status.verified ? (
          <PrimaryButton label={busy ? 'Checking…' : 'Check Clemson email'} onPress={onVerify} disabled={busy} tone="purple" />
        ) : null}
        {status.verified ? (
          <PrimaryButton label="See it on your quote" onPress={() => router.push('/')} tone="ghost" />
        ) : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, gap: 12 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 12 },
    panel: {
      backgroundColor: colors.orangeSoft,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.orange,
      gap: 4,
    },
    panelOn: { backgroundColor: colors.onlineSoft, borderColor: colors.online },
    state: { color: colors.title, fontWeight: '800' as const, fontSize: 18 },
    badge: { color: colors.link, fontWeight: '700' as const, marginTop: 6 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    note: { color: colors.link, fontSize: 13, lineHeight: 18 },
  }
}


export default function StudentScreenRoute() {
  return (
    <RequireAuth>
      <StudentScreen />
    </RequireAuth>
  )
}
