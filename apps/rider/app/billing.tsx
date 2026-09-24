import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { loadRiderBilling } from 'rides-native/riderMoney.js'
import { formatCents } from 'rides-native/tripTags.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type Card = { brand: string; last4: string | null; billingActivatedAt: string | null }
type Deposit = { id: string; amount_cents: number | null; status: string | null; created_at: string | null; trip_id: string | null }
type Ride = {
  id: string
  status: string | null
  pickup_label: string | null
  dropoff_label: string | null
  fare_cents: number | null
  deposit_cents: number | null
  created_at: string | null
}

export default function BillingScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [card, setCard] = useState<Card | null>(null)
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [rides, setRides] = useState<Ride[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  const load = useCallback(() => {
    if (!user || !supabase) return undefined
    let alive = true
    setLoading(true)
    loadRiderBilling(supabase, user.id).then((result) => {
      if (!alive) return
      setCard(result.card)
      setDeposits(result.deposits || [])
      setRides(result.rides || [])
      const problems = [result.profileError, result.paymentsError, result.ridesError].filter(Boolean)
      setNote(problems.length ? problems.join(' ') : null)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [user])

  useFocusEffect(load)

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Billing" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        {!user ? (
          <>
            <Text style={styles.copy}>Sign in to see the card, deposits, and ride history on this account.</Text>
            <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} />
          </>
        ) : null}
        <Text style={styles.kicker}>CARD</Text>
        <View style={[styles.card, lift(colors, 'rest')]}>
          {card ? (
            <>
              <Text style={styles.cardBrand}>{String(card.brand || 'card').toUpperCase()}</Text>
              <Text style={styles.cardLast}>{card.last4 ? `···· ${card.last4}` : 'Card on file'}</Text>
              {card.billingActivatedAt ? (
                <Text style={styles.copy}>Saved {new Date(card.billingActivatedAt).toLocaleDateString()}</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.copy}>
              {loading ? 'Loading card…' : 'No card on file yet. Airport deposits use Stripe Checkout. This screen never asks for the full card number.'}
            </Text>
          )}
        </View>

        <Text style={styles.kicker}>DEPOSITS</Text>
        {deposits.length === 0 ? <Text style={styles.copy}>{loading ? 'Loading deposits…' : 'No deposit payments on this account.'}</Text> : null}
        {deposits.map((row) => (
          <View key={row.id} style={[styles.card, lift(colors, 'rest')]}>
            <Text style={styles.rowTitle}>{formatCents(row.amount_cents || 0)}</Text>
            <Text style={styles.copy}>{row.status || 'recorded'} · {row.created_at ? new Date(row.created_at).toLocaleString() : 'deposit'}</Text>
          </View>
        ))}

        <Text style={styles.kicker}>HISTORY</Text>
        {rides.length === 0 ? <Text style={styles.copy}>{loading ? 'Loading rides…' : 'No rides yet.'}</Text> : null}
        {rides.map((row) => (
          <View key={row.id} style={[styles.card, lift(colors, 'rest')]}>
            <Text style={styles.rowTitle}>{row.dropoff_label || 'Ride'}</Text>
            <Text style={styles.copy}>
              {row.pickup_label || 'Pickup'} · {row.status || 'requested'}
            </Text>
            <Text style={styles.copy}>
              Fare {formatCents(row.fare_cents || 0)} · deposit {formatCents(row.deposit_cents || 0)}
            </Text>
          </View>
        ))}
        {note ? <Text style={styles.error}>{note}</Text> : null}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, gap: 10, paddingBottom: 32 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 12, marginTop: 8 },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    cardBrand: { color: colors.link, fontWeight: '800' as const, letterSpacing: 0.6 },
    cardLast: { color: colors.ink, fontSize: 22, fontWeight: '800' as const },
    rowTitle: { color: colors.ink, fontWeight: '800' as const, fontSize: 16 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  }
}
