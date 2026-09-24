import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'
import { loadEarnings } from 'rides-native/driverDesk'

type Pending = {
  tripId?: string
  amountCents?: number
  status?: string
  lastError?: string | null
  dropoffLabel?: string | null
  nextRetryAt?: string | null
}

export default function PayoutsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors, earningsPrivate } = useTheme()
  const [paid, setPaid] = useState(0)
  const [pendingCents, setPendingCents] = useState(0)
  const [pending, setPending] = useState<Pending[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const data = await loadEarnings(supabase, user.id)
    setPaid(Number(data.payouts?.paidCents) || 0)
    setPendingCents(Number(data.payouts?.pendingCents) || 0)
    const rows = Array.isArray(data.payouts?.pending) ? data.payouts.pending as Pending[] : []
    setPending(rows)
    if (data.payoutError) setError(data.payoutError)
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load payouts'))
  }, [refresh]))

  async function cashOut() {
    if (!supabase) return
    setBusy(true)
    setNote(null)
    setError(null)
    try {
      const result = await authedJson(supabase, '/api/driver?action=payouts', { method: 'POST', body: {} })
      const results = Array.isArray(result.results) ? result.results.length : 0
      setNote(results ? `Retried ${results} due payout${results === 1 ? '' : 's'}.` : 'No payout was due for a retry.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cash out')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StackPage title="Payouts" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.inkSecondary, fontWeight: '700' }}>Balance</Text>
        <Text style={{ color: colors.ink, fontSize: 36, fontWeight: '800' }}>{shownCents(pendingCents, earningsPrivate)}</Text>
        <Text style={{ color: colors.inkSecondary }}>Paid out {shownCents(paid, earningsPrivate)}. Cash out retries Stripe transfers that are already due. It does not move money early.</Text>
        <Primary label={busy ? 'Working…' : 'Cash out'} onPress={cashOut} disabled={busy || !user} />
      </Card>
      {note ? <Text style={{ color: colors.title, fontWeight: '700' }}>{note}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {pending.map((row) => (
        <Card key={row.tripId || row.dropoffLabel}>
          <Text style={{ color: colors.title, fontWeight: '800' }}>{row.dropoffLabel || 'Trip'}</Text>
          <Text style={{ color: colors.ink }}>{shownCents(row.amountCents || 0, earningsPrivate)} · {row.status || 'pending'}</Text>
          {row.nextRetryAt ? <Text style={{ color: colors.inkSecondary }}>Retry {new Date(row.nextRetryAt).toLocaleString()}</Text> : null}
          {row.lastError ? <Text style={{ color: colors.danger }}>{row.lastError}</Text> : null}
        </Card>
      ))}
      {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
    </StackPage>
  )
}
