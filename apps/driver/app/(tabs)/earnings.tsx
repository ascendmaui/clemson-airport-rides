import { LinearGradient } from 'expo-linear-gradient'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DonutChart, legendColor } from '@/components/charts'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { DayHeader, EmptyState, FadeIn, SoftNote } from '@/components/day'
import { SectionLabel } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { currentWeekLabel, tipCentsFromPayments, type TipPayment } from '@/lib/earningsMath'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { carpoolPayFromTrip, tripEarnedCents, tripPayoutCents, weekNetCents } from 'rides-native/tripTags'
import { driverBoostShareCents, readBoostCents } from '../../../../shared/scheduledBoost.js'
import { instantCashout, loadCashoutQuote, loadEarnings, type CashoutQuote } from 'rides-native/driverDesk'
import { CASHOUT_COPY } from '../../../../shared/cashout.js'
import { readPrepaidTipCents } from '../../../../shared/prepaidTip.js'

type EarningsState = Awaited<ReturnType<typeof loadEarnings>> | null

export default function EarningsHub() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors, earningsPrivate } = useTheme()
  const [data, setData] = useState<EarningsState>(null)
  const [ready, setReady] = useState(!user)
  const [error, setError] = useState<string | null>(null)

  const [quote, setQuote] = useState<CashoutQuote | null>(null)
  const [cashing, setCashing] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    setData(await loadEarnings(supabase, user.id))
    setQuote(await loadCashoutQuote(supabase).catch(() => null))
  }, [user])

  const money = (cents?: number) => `$${((cents || 0) / 100).toFixed(2)}`
  const runCashout = useCallback(() => {
    if (!quote || !supabase) return
    if (quote.state === 'needs_setup') {
      router.push('/payouts')
      return
    }
    if (quote.state !== 'ready') return
    const instant = quote.method === 'instant'
    const lines = [
      `Balance ${money(quote.grossCents)}`,
      instant ? `Instant fee ${money(quote.feeCents)}` : 'No fee (standard payout, 1-2 business days)',
      `You get ${money(quote.netCents)}${quote.last4 ? ` to •••• ${quote.last4}` : ''}`,
      'One cash-out per day.',
    ]
    Alert.alert(instant ? 'Instant cash-out' : 'Cash out', lines.join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Cash out ${money(quote.netCents)}`,
        onPress: async () => {
          setCashing(true)
          try {
            const r = await instantCashout(supabase, quote.feeCents || 0)
            if (r.ok) {
              Alert.alert('Cash-out sent', r.method === 'instant'
                ? `${money(r.netCents)} is on its way to your debit card.`
                : `${money(r.netCents)} is on its way by standard payout${r.fallbackReason ? ' (instant was not available for this card)' : ''}.`)
            } else {
              Alert.alert('Cash-out not sent', CASHOUT_COPY[r.error as keyof typeof CASHOUT_COPY] || 'Try again in a few minutes.')
            }
          } catch (err) {
            Alert.alert('Cash-out not sent', err instanceof Error ? err.message : 'Try again in a few minutes.')
          } finally {
            setCashing(false)
            refresh().catch(() => {})
          }
        },
      },
    ])
  }, [quote, refresh, router])

  useFocusEffect(useCallback(() => {
    if (!user) {
      setReady(true)
      return undefined
    }
    let alive = true
    refresh()
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load earnings')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [refresh, user]))

  const payouts = data?.payouts
  const week = weekNetCents(data?.trips || [])
  const pending = Number(payouts?.pendingCents) || 0
  const nextRetry = payouts?.pending?.find((row: unknown) => row && typeof row === 'object' && 'nextRetryAt' in row) as { nextRetryAt?: string } | undefined
  let you = 0
  let platform = 0
  let other = 0
  let boostSum = 0
  let tips = 0
  let carpoolBonus = false
  for (const trip of data?.trips || []) {
    if (trip.status === 'cancelled_wait') {
      const net = tripEarnedCents(trip)
      you += net
      platform += Math.max(0, (trip.wait_fee_cents || 0) + (trip.cancel_fee_cents || 0) - net)
      continue
    }
    if (trip.status !== 'completed') continue
    const fare = Math.max(0, Math.round(Number(trip.fare_cents) || 0))
    const net = tripEarnedCents(trip)
    const boost = driverBoostShareCents(readBoostCents(trip))
    if (carpoolPayFromTrip(trip)?.showBonus) carpoolBonus = true
    you += net
    boostSum += boost
    platform += Math.max(0, fare + (trip.wait_fee_cents || 0) - net)
    const payments = (data?.paymentsByTrip?.[trip.id] || []) as TipPayment[]
    // Tips (after-ride and prepaid tip boost) are 100% the driver's, shown on their own slice.
    tips += tipCentsFromPayments(payments) + readPrepaidTipCents(trip)
  }
  const standard = you + platform + other + boostSum + tips <= 0
  const segments = standard
    ? [
        { label: 'You', value: 80, color: legendColor(colors, 'you') },
        { label: 'Clemson RIDES', value: 20, color: legendColor(colors, 'platform') },
        { label: 'Other', value: 0, color: legendColor(colors, 'other') },
      ]
    : [
        { label: 'You', value: you, color: legendColor(colors, 'you') },
        { label: 'Clemson RIDES', value: platform, color: legendColor(colors, 'platform') },
        { label: 'Boost', value: boostSum, color: '#F56600' },
        { label: 'Tips (100% yours)', value: tips, color: '#22A04B' },
        { label: 'Other', value: other, color: legendColor(colors, 'other') },
      ]

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <FadeIn style={{ gap: 12 }}>
          <DayHeader kicker="CLEMSON RIDES" title="Earnings" />
          {!user ? (
            <EmptyState
              icon="cash"
              title="Sign in to see earnings"
              body="Completed trips, the 80% you keep, and your payout balance appear after you sign in."
              action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
            />
          ) : null}
          {user && !ready ? (
            <Card>
              <Text style={{ color: colors.title, fontWeight: '800' }}>Loading earnings</Text>
              <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Checking completed trips and payout balance.</Text>
            </Card>
          ) : null}
          {user && ready ? (
            <>
              <WeekHero
                label={currentWeekLabel()}
                amount={shownCents(week, earningsPrivate)}
                onDetails={() => router.push('/earnings-details')}
              />
              {week <= 0 ? (
                <SoftNote>No completed trips this week. You keep 80% of each fare once a ride finishes. Carpool trips add a carpool bonus to your payout.</SoftNote>
              ) : (
                <SoftNote>
                  {carpoolBonus
                    ? 'This week includes carpool payouts. Totals include the carpool bonus.'
                    : 'This week’s total is the 80% you keep. Open details for day, week, month, and year.'}
                </SoftNote>
              )}
              <SectionLabel>Wallet</SectionLabel>
              <Card>
                <Text style={[styles.kicker, { color: colors.orange }]}>BALANCE</Text>
                <Text style={[styles.amount, { color: colors.ink }]}>{shownCents(pending, earningsPrivate)}</Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  {nextRetry?.nextRetryAt
                    ? `Next payout retry ${new Date(nextRetry.nextRetryAt).toLocaleString()}`
                    : pending > 0
                      ? 'This balance pays out when a Stripe transfer is due.'
                      : 'Nothing is waiting to pay out. Completed trips land here after Stripe records them.'}
                </Text>
                <Pressable
                  onPress={runCashout}
                  disabled={cashing || !quote || (quote.state !== 'ready' && quote.state !== 'needs_setup')}
                  style={[styles.cash, { backgroundColor: quote?.state === 'ready' ? colors.orange : colors.track, opacity: cashing ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Instant cash-out"
                  accessibilityHint="Shows the fee and asks you to confirm before sending your balance"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: quote?.state === 'ready' ? '#FFFFFF' : colors.title, fontWeight: '800' }}>
                    {cashing ? 'Sending…' : quote?.state === 'needs_setup' ? 'Set up payouts to cash out' : 'Instant cash-out'}
                  </Text>
                </Pressable>
                {quote && quote.state !== 'ready' && quote.state !== 'needs_setup' ? (
                  <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{CASHOUT_COPY[quote.state]}</Text>
                ) : quote?.state === 'ready' ? (
                  <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                    {quote.method === 'instant' ? `Instant fee ${money(quote.feeCents)}. One cash-out per day.` : 'Standard payout, no fee. One cash-out per day.'}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => router.push('/payouts')}
                  style={[styles.cash, { backgroundColor: colors.track }]}
                  accessibilityRole="button"
                  accessibilityLabel="Payouts and more"
                  accessibilityHint="Navigates to payout setup and history"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: colors.title, fontWeight: '800' }}>Payouts and more</Text>
                </Pressable>
              </Card>
              <SectionLabel>Customer fare breakdown</SectionLabel>
              <Card>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  {standard
                    ? 'No completed trips yet. The chart shows the standard split until one is on file. You keep 80%.'
                    : carpoolBonus
                      ? 'Completed trips on this account. Carpool totals are your base net plus the carpool bonus. Tips are 100% yours and shown on their own.'
                      : 'Completed trips on this account. You keep 80% of the fare. Boost is shown separately and is not in the platform fee. Tips are 100% yours and shown on their own.'}
                </Text>
                {earningsPrivate ? (
                  <SoftNote>Amounts are hidden on this phone. Turn off Make earnings private in Settings to see the split.</SoftNote>
                ) : (
                  <DonutChart segments={segments} />
                )}
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  Paid out {shownCents(Number(payouts?.paidCents) || 0, earningsPrivate)} stays in payout history.
                </Text>
              </Card>
            </>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          {data?.apiError ? <ErrorText>{`Deposit rows: ${data.apiError}`}</ErrorText> : null}
          {data?.payoutError ? <ErrorText>{`Payout status: ${data.payoutError}`}</ErrorText> : null}
        </FadeIn>
      </ScrollView>
    </View>
  )
}

function WeekHero({
  label,
  amount,
  onDetails,
}: {
  label: string
  amount: string
  onDetails: () => void
}) {
  const { colors } = useTheme()
  return (
    <LinearGradient
      colors={[colors.purple, colors.orange]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.hero}
    >
      <Text style={styles.heroKicker}>THIS WEEK</Text>
      <Text style={styles.heroAmount}>{amount}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
      <Pressable
        onPress={onDetails}
        style={styles.heroBtn}
        accessibilityRole="button"
        accessibilityLabel="See earnings details"
        accessibilityHint="Navigates to detailed earnings by day, week, month, and year"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.heroBtnText}>See details</Text>
      </Pressable>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, paddingBottom: 36 },
  kicker: { fontWeight: '800', letterSpacing: 1.1, fontSize: 12 },
  amount: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  cash: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  hero: {
    borderRadius: 22,
    padding: 18,
    gap: 4,
    shadowColor: '#F56600',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  heroKicker: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 1.1, fontSize: 12, opacity: 0.9 },
  heroAmount: { color: '#FFFFFF', fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  heroLabel: { color: '#FFFFFF', fontWeight: '700', opacity: 0.92 },
  heroBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  heroBtnText: { color: '#FFFFFF', fontWeight: '800' },
})
