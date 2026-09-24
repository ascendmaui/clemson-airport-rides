import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  claimPromoCode,
  describeRiderSocialRewards,
  loadPromoDesk,
  promoClaimMessage,
  riderPromoShareText,
  riderPromoShareUrl,
} from 'rides-native/riderMoney.js'
import { normalizePromoCode } from 'rides-native/authErrors'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

type Desk = {
  code: string | null
  config: { referrer_credit_cents?: number; referred_discount_kind?: string; referred_percent_off?: number; referred_cents_off?: number } | null
  sent: { id: string; status: string | null }[]
  received: { code?: string | null; status?: string | null } | null
  error: string | null
}

export default function PromoScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [desk, setDesk] = useState<Desk | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!user || !supabase) return undefined
    let alive = true
    loadPromoDesk(supabase, user.id).then((row) => {
      if (!alive) return
      setDesk(row as Desk)
    })
    return () => {
      alive = false
    }
  }, [user])

  useFocusEffect(load)

  async function onClaim() {
    if (!supabase) return
    setBusy(true)
    setNote(null)
    try {
      const result = await claimPromoCode(supabase, code)
      setNote(promoClaimMessage(result))
      setCode('')
      if (user) {
        const row = await loadPromoDesk(supabase, user.id)
        setDesk(row as Desk)
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not apply that code')
    } finally {
      setBusy(false)
    }
  }

  async function onShare() {
    if (!desk?.code) return
    const message = `${riderPromoShareText(desk.code)} ${riderPromoShareUrl(desk.code)}`
    try {
      await Share.share({ message })
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not open the share sheet')
    }
  }

  const rewards = describeRiderSocialRewards(desk?.config)
  const pending = (desk?.sent || []).filter((row) => row.status === 'pending').length
  const rewarded = (desk?.sent || []).filter((row) => row.status === 'rewarded').length

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Promo codes" onBack={() => router.back()} />
      <View style={styles.body}>
        <Text style={styles.copy}>
          Rewards are added only after a friend finishes their first ride. A signup alone does not pay out.
        </Text>
        {!user ? <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
        {user ? (
          <>
            <Text style={styles.label}>Have a code?</Text>
            <TextInput
              value={code}
              onChangeText={(value) => setCode(normalizePromoCode(value))}
              autoCapitalize="characters"
              placeholder="FRIEND CODE"
              placeholderTextColor="#8B939E"
              style={styles.input}
            />
            <PrimaryButton label={busy ? 'Applying…' : 'Apply code'} onPress={onClaim} disabled={busy || !code} />
            <View style={styles.codeCard}>
              <Text style={styles.kicker}>YOUR CODE</Text>
              <Text style={styles.code}>{desk?.code || '—'}</Text>
              {desk?.code ? <Text style={styles.link}>{riderPromoShareUrl(desk.code)}</Text> : null}
            </View>
            <PrimaryButton label="Share code" onPress={onShare} disabled={!desk?.code} tone="purple" />
            <Text style={styles.copy}>
              You get {rewards.referrer} when a friend completes their first ride. They get {rewards.referred}.
            </Text>
            <Text style={styles.copy}>
              {pending} waiting on a first ride · {rewarded} rewarded.
              {desk?.received?.code ? ` You used ${desk.received.code} (${desk.received.status || 'pending'}).` : ''}
            </Text>
          </>
        ) : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {desk?.error ? <Text style={styles.error}>{desk.error}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  body: { padding: 20, gap: 12 },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  label: { fontWeight: '700', color: INK },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.16)',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
    color: INK,
  },
  codeCard: {
    marginTop: 8,
    borderRadius: 16,
    padding: 16,
    backgroundColor: 'rgba(245,102,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,102,0,0.35)',
    gap: 4,
  },
  kicker: { color: PURPLE, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  code: { color: ORANGE, fontSize: 28, fontWeight: '800', letterSpacing: 1.4 },
  link: { color: PURPLE, fontSize: 12 },
  note: { color: PURPLE, fontSize: 13, lineHeight: 18 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
})
