import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { decidePayoutApproval, loadPayoutApprovalQueue } from './payoutApprovalsClient.js'

function usd(cents) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Driver app Admin section: payout approval queue. Renders nothing unless the
 * server says this account is the payout approver (403 otherwise).
 */
export function PayoutApprovalsPanel({ supabase, colors }) {
  const [data, setData] = useState(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [reasons, setReasons] = useState({})
  const ink = colors?.title || '#522D80'
  const muted = colors?.inkSecondary || '#666'

  const reload = useCallback(() => {
    return loadPayoutApprovalQueue(supabase)
      .then((d) => { setData(d); setError('') })
      .catch((err) => {
        if (err?.status === 403 || err?.status === 401) setHidden(true)
        else setError(err?.message || 'Could not load payout requests')
      })
  }, [supabase])

  useEffect(() => { reload() }, [reload])

  async function run(row, decision) {
    setBusy(row.id)
    try {
      const res = await decidePayoutApproval(supabase, { id: row.id, decision, reason: reasons[row.id] })
      if (decision === 'approve' && res?.result && res.result.ok === false) {
        Alert.alert('Approved, not sent yet', `${res.result.error || 'Stripe did not accept it'}. It will retry.`)
      }
      await reload()
    } catch (err) {
      Alert.alert('Not saved', err?.message || 'Could not save the decision')
    } finally {
      setBusy('')
    }
  }

  function confirmApprove(row) {
    Alert.alert(
      'Approve payout?',
      `Send ${usd(row.amountCents)} (${row.kindLabel}) to ${row.driverName || row.driverEmail || 'this driver'}. This moves real money.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Approve', onPress: () => { void run(row, 'approve') } }],
    )
  }

  if (hidden) return null
  const pending = data?.pending || []
  return (
    <ScrollView style={{ maxHeight: 380, flexGrow: 0 }} contentContainerStyle={{ padding: 16, gap: 10 }} testID="payout-approvals-panel">
      <Text style={{ color: ink, fontWeight: '800', fontSize: 18 }}>Payout approvals ({pending.length})</Text>
      {error ? <Text style={{ color: colors?.danger || '#B42318' }}>{error}</Text> : null}
      {!data && !error ? <Text style={{ color: muted }}>Loading…</Text> : null}
      {data && pending.length === 0 ? <Text style={{ color: muted }}>No payout requests waiting.</Text> : null}
      {pending.map((row) => (
        <View key={row.id} style={{ borderWidth: 1, borderColor: 'rgba(82,45,128,0.15)', borderRadius: 12, padding: 12, gap: 6 }}>
          <Text style={{ color: ink, fontWeight: '800' }}>{row.driverName || row.driverEmail || 'Driver'} · {usd(row.amountCents)}</Text>
          <Text style={{ color: muted }}>{row.kindLabel} · {when(row.requestedAt)}</Text>
          <TextInput
            placeholder="Reason if rejecting (optional)"
            value={reasons[row.id] || ''}
            onChangeText={(text) => setReasons((r) => ({ ...r, [row.id]: text }))}
            style={{ borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)', borderRadius: 8, padding: 8, color: colors?.ink || '#111' }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable accessibilityRole="button" disabled={busy === row.id} onPress={() => confirmApprove(row)}
              style={{ backgroundColor: '#522D80', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 }}>
              <Text style={{ color: 'white', fontWeight: '700' }}>{busy === row.id ? 'Working…' : 'Approve'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy === row.id} onPress={() => { void run(row, 'reject') }}
              style={{ borderColor: '#B42318', borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 }}>
              <Text style={{ color: '#B42318', fontWeight: '700' }}>Reject</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  )
}
