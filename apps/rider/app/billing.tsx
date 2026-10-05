import { useFocusEffect, useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { Modal, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { parseCheckoutSessionId } from 'rides-native/checkoutReturn.js'
import {
  ADD_ANOTHER_PAYMENT_METHOD_ID,
  ADD_ANOTHER_PAYMENT_METHOD_LABEL,
  RIDE_PAYMENT_METHODS,
  buyPrepaidCredits,
  depositSurfaceCopy,
  loadPrepaidCredits,
  loadRiderBilling,
  prepaidPurchaseSummary,
  saveCheckoutPaymentMethod,
  startPaymentMethodSetup,
} from 'rides-native/riderMoney.js'
import { formatCents } from 'rides-native/tripTags.js'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { RequireAuth } from '@/components/RequireAuth'

type PrepaidTier = { id: string; label?: string; priceCents: number; creditCents: number }
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

function BillingScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [card, setCard] = useState<Card | null>(null)
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [rides, setRides] = useState<Ride[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creditsCents, setCreditsCents] = useState<number | null>(null)
  const [creditsUnavailable, setCreditsUnavailable] = useState(false)
  const [creditsLoaded, setCreditsLoaded] = useState(false)
  const [creditsError, setCreditsError] = useState<string | null>(null)
  const [tiers, setTiers] = useState<PrepaidTier[]>([])
  const [pending, setPending] = useState<PrepaidTier | null>(null)
  const [busy, setBusy] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  const load = useCallback(() => {
    if (!user || !supabase) {
      setCreditsLoaded(true)
      setCreditsUnavailable(true)
      setLoading(false)
      return undefined
    }
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
    loadPrepaidCredits(supabase).then((result) => {
      if (!alive) return
      setCreditsCents(result.balanceCents)
      setCreditsUnavailable(result.unavailable)
      setCreditsLoaded(true)
      setCreditsError(result.error)
      setTiers((result.tiers || []) as PrepaidTier[])
    })
    return () => {
      alive = false
    }
  }, [user])

  useFocusEffect(load)

  async function onPickMethod(methodId: string) {
    if (!supabase || busy) return
    setBusy(true)
    setNote(null)
    try {
      const returnUrl = Linking.createURL('billing')
      const session = await startPaymentMethodSetup(supabase, { paymentMethod: methodId, returnUrl })
      if (!session?.url) {
        setNote(session?.error || 'Could not open payment setup. No charge was made.')
        return
      }
      const result = await WebBrowser.openAuthSessionAsync(session.url, returnUrl)
      if (result.type !== 'success') {
        setNote('Payment setup canceled. No charge was made.')
        return
      }
      const sessionId = parseCheckoutSessionId(result.url)
      if (!sessionId) {
        setNote('Stripe did not return a setup session. No charge was made.')
        return
      }
      await saveCheckoutPaymentMethod(supabase, sessionId)
      setNote('Payment method saved.')
      load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not add that payment method. No charge was made.')
    } finally {
      setBusy(false)
    }
  }

  async function onConfirmPurchase() {
    if (!supabase || !pending || busy) return
    setBusy(true)
    setNote(null)
    try {
      await buyPrepaidCredits(supabase, pending.id)
      setPending(null)
      setNote('Credits added.')
      load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not buy credits. If the card was not charged, nothing was added.')
    } finally {
      setBusy(false)
    }
  }

  const pendingSummary = pending ? prepaidPurchaseSummary(pending) : null

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Billing" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.creditsLabel} accessibilityRole="header">credits</Text>
        <View style={[styles.card, lift(colors, 'rest')]} accessibilityLabel="credits">
          <Text style={styles.cardLast}>
            {!creditsLoaded
              ? '…'
              : creditsUnavailable || creditsCents == null
                ? 'Balance unavailable'
                : formatCents(creditsCents)}
          </Text>
          {creditsError ? <Text style={styles.error}>{creditsError}</Text> : null}
        </View>

        <Text style={styles.kicker}>PAYMENT METHODS</Text>
        <View>
          {RIDE_PAYMENT_METHODS.map((method) => (
            <View key={method.id} style={{ marginBottom: 8 }}>
              <PrimaryButton
                label={method.label}
                disabled={busy || !user}
                onPress={() => onPickMethod(method.id)}
              />
            </View>
          ))}
          <PrimaryButton
            label={ADD_ANOTHER_PAYMENT_METHOD_LABEL}
            tone="outline"
            disabled={busy || !user}
            onPress={() => onPickMethod(ADD_ANOTHER_PAYMENT_METHOD_ID)}
          />
          <Text style={styles.copy}>
            Apple Pay and Google Pay open Stripe Checkout in setup mode, which does not charge the card. Apple Pay on the website still needs this domain registered under Stripe Payment method domains.
          </Text>
        </View>

        <Text style={styles.kicker}>PREPAID CREDITS</Text>
        {tiers.map((tier) => (
          <PrimaryButton
            key={tier.id}
            label={tier.label || tier.id}
            tone="purple"
            disabled={busy || !user}
            onPress={() => setPending(tier)}
          />
        ))}

        {!user ? (
          <>
            <Text style={styles.copy}>Sign in to see the card and ride history on this account.</Text>
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
              {loading ? 'Loading card…' : 'No card on file yet. Add a card for the fare hold. This screen never asks for the full card number.'}
            </Text>
          )}
        </View>

        <Text style={styles.kicker}>DEPOSITS</Text>
        {deposits.length === 0 ? <Text style={styles.copy}>{loading ? 'Loading payments…' : 'No fare payments on this account.'}</Text> : null}
        {deposits.map((row: Deposit) => (
          <View key={row.id} style={[styles.card, lift(colors, 'rest')]}>
            <Text style={styles.rowTitle}>{formatCents(row.amount_cents || 0)}</Text>
            <Text style={styles.copy}>{row.status || 'recorded'} · {row.created_at ? new Date(row.created_at).toLocaleString() : 'deposit'}</Text>
          </View>
        ))}

        <Text style={styles.kicker}>HISTORY</Text>
        {rides.length === 0 ? <Text style={styles.copy}>{loading ? 'Loading rides…' : 'No rides yet.'}</Text> : null}
        {rides.map((row: Ride) => (
          <View key={row.id} style={[styles.card, lift(colors, 'rest')]}>
            <Text style={styles.rowTitle}>{row.dropoff_label || 'Ride'}</Text>
            <Text style={styles.copy}>
              {row.pickup_label || 'Pickup'} · {row.status || 'requested'}
            </Text>
            <Text style={styles.copy}>
              Fare {formatCents(row.fare_cents || 0)}
              {row.deposit_cents
                ? ` · ${depositSurfaceCopy({ fareCents: row.fare_cents || 0, depositCents: row.deposit_cents }, 'upcoming') || ''}`
                : ''}
            </Text>
          </View>
        ))}
        {note ? <Text style={styles.error}>{note}</Text> : null}
      </ScrollView>
      <Modal visible={Boolean(pendingSummary)} transparent animationType="slide" onRequestClose={() => { if (!busy) setPending(null) }} accessibilityViewIsModal>
        <View style={styles.modalBackdrop}>
          <View style={[styles.card, lift(colors, 'float')]}>
            <Text style={styles.rowTitle}>{pendingSummary?.title}</Text>
            <Text style={styles.copy}>{pendingSummary?.body}</Text>
            <PrimaryButton
              label={busy ? 'Charging…' : (pendingSummary?.confirmLabel || 'Charge')}
              disabled={busy}
              onPress={onConfirmPurchase}
            />
            <PrimaryButton
              label={pendingSummary?.cancelLabel || 'Cancel'}
              tone="outline"
              disabled={busy}
              onPress={() => setPending(null)}
            />
          </View>
        </View>
      </Modal>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, gap: 10, paddingBottom: 32 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 12, marginTop: 8 },
    creditsLabel: { color: colors.purple, fontWeight: '800' as const, fontSize: 13 },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'flex-end' as const,
      backgroundColor: colors.scrim,
      padding: 16,
    },
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


export default function BillingScreenRoute() {
  return (
    <RequireAuth>
      <BillingScreen />
    </RequireAuth>
  )
}
