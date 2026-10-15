import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Linking, Text, View } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'
import { loadEarnings } from 'rides-native/driverDesk'
import { type as typeScale } from 'rides-native/shared/theme.js'
import { cashOutPayout, loadPayoutDesk, startPayoutSetup } from 'rides-native/driverPayoutsClient'
import { payoutChipLabel } from '../../../shared/driverPayoutMethods.js'
import { CASHOUT_COPY } from '../../../shared/cashout.js'
import { quiet } from '@/lib/softFail'

type Pending = {
  tripId?: string
  amountCents?: number
  status?: string
  lastError?: string | null
  dropoffLabel?: string | null
  nextRetryAt?: string | null
  kind?: string
}

type Method = {
  id?: string | null
  kind: 'bank' | 'card'
  last4: string | null
  brand?: string | null
  default?: boolean
  instant?: boolean
}

type HistoryRow = {
  id: string
  amountCents: number
  status: 'pending' | 'in_transit' | 'paid' | 'failed'
  method?: 'instant' | 'standard' | null
  createdAt?: string | null
}

type Quote = {
  state?: string
  method?: string
  grossCents?: number
  feeCents?: number
  netCents?: number
  last4?: string | null
}

type Desk = {
  availableCents?: number
  pendingCents?: number
  methods?: Method[]
  history?: HistoryRow[]
  setupUrl?: string | null
  dashboardUrl?: string | null
  instant?: Quote
  standard?: Quote
  stripeConnect?: boolean
  detailsSubmitted?: boolean
}

function money(cents?: number) {
  return `$${((cents || 0) / 100).toFixed(2)}`
}

export default function PayoutsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors, earningsPrivate } = useTheme()
  const [paid, setPaid] = useState(0)
  const [tipsPaid, setTipsPaid] = useState(0)
  const [tipsPending, setTipsPending] = useState(0)
  const [pending, setPending] = useState<Pending[]>([])
  const [desk, setDesk] = useState<Desk | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const [data, methods] = await Promise.all([
      loadEarnings(supabase, user.id),
      loadPayoutDesk(supabase).catch((err: unknown) => {
        throw err
      }),
    ])
    setPaid(Number(data.payouts?.paidCents) || 0)
    setTipsPaid(Number((data.payouts as { tipsPaidCents?: number } | null)?.tipsPaidCents) || 0)
    setTipsPending(Number((data.payouts as { tipsPendingCents?: number } | null)?.tipsPendingCents) || 0)
    const rows = Array.isArray(data.payouts?.pending) ? data.payouts.pending as Pending[] : []
    setPending(rows)
    setDesk(methods)
    if (data.payoutError) setError(data.payoutError)
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load payout methods'))
  }, [refresh]))

  function openUrl(url: string | null | undefined) {
    if (!url) return
    Linking.openURL(url).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not open Stripe')
    })
  }

  async function setup() {
    if (!supabase) return
    if (desk?.setupUrl) {
      openUrl(desk.setupUrl)
      return
    }
    setBusy('setup')
    setError(null)
    try {
      const started = await startPayoutSetup(supabase)
      if (started?.url) openUrl(started.url)
      else setError('Stripe did not return a setup link')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Stripe')
    } finally {
      setBusy(null)
    }
  }

  function confirmCashOut(kind: 'instant' | 'standard') {
    if (!supabase || !desk) return
    const quote = kind === 'instant' ? desk.instant : desk.standard
    if (!quote || quote.state !== 'ready') return
    const instant = kind === 'instant'
    const lines = [
      `Balance ${money(quote.grossCents)}`,
      instant ? `Instant fee ${money(quote.feeCents)}` : 'Standard (free, 1-2 days)',
      `You get ${money(quote.netCents)}${quote.last4 ? ` to •••• ${quote.last4}` : ''}`,
      'One cash-out per day.',
    ]
    Alert.alert(instant ? 'Instant cash out' : 'Standard cash out', lines.join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: instant ? `Instant cash out ${money(quote.netCents)}` : `Standard cash out ${money(quote.netCents)}`,
        onPress: () => { void sendCashOut(kind, quote.feeCents || 0) },
      },
    ])
  }

  async function sendCashOut(kind: 'instant' | 'standard', feeCents: number) {
    if (!supabase) return
    setBusy(kind)
    setError(null)
    try {
      const result = await cashOutPayout(supabase, { method: kind, feeCents })
      if (result?.ok) {
        setNote(result.method === 'instant'
          ? `${money(result.netCents)} is on its way to your debit card or bank.`
          : `${money(result.netCents)} is on a standard payout (free, 1-2 days).`)
      } else {
        const code = String(result?.error || '')
        setError(CASHOUT_COPY[code as keyof typeof CASHOUT_COPY] || 'Cash out was not sent.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cash out was not sent.')
    } finally {
      setBusy(null)
      refresh().catch(quiet('payouts refresh'))
    }
  }

  async function retryDue() {
    if (!supabase) return
    setBusy('retry')
    setNote(null)
    setError(null)
    try {
      const result = await authedJson(supabase, '/api/driver?action=payouts', { method: 'POST', body: {} })
      const results = Array.isArray(result.results) ? result.results.length : 0
      setNote(results ? `Retried ${results} due payout${results === 1 ? '' : 's'}.` : 'No payout was due for a retry.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry payouts')
    } finally {
      setBusy(null)
    }
  }

  const instantReady = desk?.instant?.state === 'ready'
  const standardReady = desk?.standard?.state === 'ready'
  const history = desk?.history || []
  const methods = desk?.methods || []

  return (
    <StackPage title="Payout methods" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.inkSecondary, ...typeScale.kicker }}>Available balance</Text>
        <Text style={{ color: colors.ink, ...typeScale.amount }}>{shownCents(desk?.availableCents || 0, earningsPrivate)}</Text>
        <Text style={{ color: colors.inkSecondary, ...typeScale.kicker }}>Pending balance</Text>
        <Text style={{ color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>{shownCents(desk?.pendingCents || 0, earningsPrivate)}</Text>
        <Text style={{ color: colors.inkSecondary, ...typeScale.body }}>
          Available is on Stripe now. Pending is still settling. Paid out {shownCents(paid, earningsPrivate)}.
        </Text>
        {tipsPaid + tipsPending > 0 ? (
          <Text style={{ color: colors.ink, fontWeight: '700' }} accessibilityLabel="Tips, 100 percent yours">
            Tips (100% yours): {shownCents(tipsPaid, earningsPrivate)} paid{tipsPending > 0 ? ` · ${shownCents(tipsPending, earningsPrivate)} pending` : ''}
          </Text>
        ) : null}
      </Card>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Cash out</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          Instant cash out sends to a linked debit card or bank. The fee is shown before you confirm. Standard is free and arrives in 1-2 days.
        </Text>
        <Primary
          label={busy === 'instant' ? 'Sending…' : 'Instant cash out'}
          onPress={() => confirmCashOut('instant')}
          disabled={Boolean(busy) || !instantReady}
          accessibilityLabel="Instant cash out"
        />
        {desk?.instant?.state === 'ready' ? (
          <Text style={{ color: colors.inkSecondary }}>Instant fee {money(desk.instant.feeCents)}. You get {money(desk.instant.netCents)}.</Text>
        ) : desk?.instant?.state && desk.instant.state !== 'ready' ? (
          <Text style={{ color: colors.inkSecondary }}>{CASHOUT_COPY[desk.instant.state as keyof typeof CASHOUT_COPY] || 'Instant cash out is not available for the linked account yet.'}</Text>
        ) : null}
        <Primary
          label={busy === 'standard' ? 'Sending…' : 'Standard (free, 1-2 days)'}
          tone="purple"
          onPress={() => confirmCashOut('standard')}
          disabled={Boolean(busy) || !standardReady}
          accessibilityLabel="Standard cash out, free, 1 to 2 days"
        />
      </Card>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Linked accounts</Text>
        {methods.length === 0 ? (
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>No bank or debit card on file yet.</Text>
        ) : methods.map((method) => (
          <View key={method.id || `${method.kind}-${method.last4}`} style={{ gap: 2 }}>
            <Text style={{ color: colors.ink, fontWeight: '800' }}>
              {method.kind === 'card' ? 'Debit card' : 'Bank'} · {method.brand || 'Account'} · •••• {method.last4 || '····'}
              {method.default ? ' · Default' : ''}
            </Text>
          </View>
        ))}
        <Primary
          label={busy === 'setup' ? 'Opening…' : desk?.stripeConnect ? 'Add bank account' : 'Set up direct deposit'}
          onPress={() => { void setup() }}
          disabled={Boolean(busy) || !user}
          accessibilityLabel="Set up direct deposit in Stripe"
        />
        <Primary
          label="Manage or remove in Stripe"
          tone="ghost"
          onPress={() => openUrl(desk?.dashboardUrl)}
          disabled={!desk?.dashboardUrl}
          accessibilityLabel="Open the Stripe Express dashboard to manage or remove a payout method"
        />
      </Card>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Payout history</Text>
        {history.length === 0 ? (
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Payouts show up here after Stripe sends them.</Text>
        ) : history.map((row) => (
          <Text key={row.id} style={{ color: colors.ink, fontWeight: '700' }}>
            {shownCents(row.amountCents, earningsPrivate)} · {payoutChipLabel(row.status)}
            {row.method === 'instant' ? ' · Instant' : row.method === 'standard' ? ' · Standard' : ''}
          </Text>
        ))}
      </Card>
      {note ? <Text style={{ color: colors.title, fontWeight: '700' }}>{note}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {pending.map((row: Pending, index: number) => (
        <Card key={row.tripId || row.dropoffLabel || index}>
          <Text style={{ color: colors.title, ...typeScale.cardTitle }}>{row.dropoffLabel || 'Trip'}</Text>
          <Text style={{ color: colors.ink }}>{row.kind === 'tip' ? 'Tip · ' : ''}{shownCents(row.amountCents || 0, earningsPrivate)} · {row.status || 'pending'}</Text>
          {row.nextRetryAt ? <Text style={{ color: colors.inkSecondary }}>Retry {new Date(row.nextRetryAt).toLocaleString()}</Text> : null}
          {row.lastError ? <Text style={{ color: colors.danger }}>{row.lastError}</Text> : null}
        </Card>
      ))}
      <Primary label={busy === 'retry' ? 'Working…' : 'Retry due transfers'} tone="ghost" onPress={() => { void retryDue() }} disabled={Boolean(busy) || !user} />
      {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
    </StackPage>
  )
}
