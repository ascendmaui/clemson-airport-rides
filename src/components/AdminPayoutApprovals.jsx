import { useCallback, useEffect, useState } from 'react'
import { decidePayoutRequest, fetchPayoutApprovalQueue } from '../lib/payoutApprovals'

function usd(cents) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const card = { background: 'white', borderRadius: 14, padding: 14, border: '1px solid rgba(82,45,128,0.12)', marginTop: 10 }

/** Payout approval queue. Only the sole approver gets data; everyone else sees a 403 message. */
export function AdminPayoutApprovals() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    fetchPayoutApprovalQueue()
      .then((d) => { setData(d); setError('') })
      .catch((err) => setError(err.status === 403 ? 'Only the payout approver can see this queue.' : (err.message || 'Could not load payout requests')))
  }, [])

  useEffect(() => { load() }, [load])

  async function decide(row, decision) {
    let reason
    if (decision === 'reject') {
      reason = window.prompt(`Reject ${row.kindLabel} ${usd(row.amountCents)} for ${row.driverName || row.driverEmail || 'this driver'}? Optional reason:`, '')
      if (reason === null) return
    } else if (!window.confirm(`Approve and send ${usd(row.amountCents)} (${row.kindLabel}) to ${row.driverName || row.driverEmail || 'this driver'}? This moves real money.`)) {
      return
    }
    setBusy(row.id)
    try {
      const res = await decidePayoutRequest(row.id, decision, reason)
      if (decision === 'approve' && res?.result && res.result.ok === false) {
        window.alert(`Approved, but sending failed: ${res.result.error || 'unknown error'}. It will retry.`)
      }
    } catch (err) {
      window.alert(err.message || 'Could not save the decision')
    } finally {
      setBusy('')
      load()
    }
  }

  if (error) return <div style={{ ...card, color: 'var(--danger)' }}>{error}</div>
  if (!data) return <div style={{ ...card, color: 'var(--ink-secondary)' }}>Loading payout requests…</div>

  return (
    <div data-testid="admin-payout-approvals">
      <p style={{ color: 'var(--ink-secondary)', fontSize: 13, marginTop: 14 }}>
        Live money to drivers waits here. Approve sends it once through Stripe. Reject returns it to the driver&apos;s balance.
      </p>
      <h3 style={{ color: '#522D80', margin: '12px 0 0' }}>Pending ({data.pending.length})</h3>
      {data.pending.length === 0 && <div style={card}>No payout requests waiting.</div>}
      {data.pending.map((row) => (
        <div key={row.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800 }}>{row.driverName || row.driverEmail || row.driverId}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{row.kindLabel} · {when(row.requestedAt)}{row.driverEmail && row.driverName ? ` · ${row.driverEmail}` : ''}</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{usd(row.amountCents)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="pressable" disabled={busy === row.id} onClick={() => decide(row, 'approve')}
              style={{ padding: '8px 14px', borderRadius: 999, background: '#522D80', color: 'white', fontWeight: 700 }}>
              {busy === row.id ? 'Working…' : 'Approve'}
            </button>
            <button type="button" className="pressable" disabled={busy === row.id} onClick={() => decide(row, 'reject')}
              style={{ padding: '8px 14px', borderRadius: 999, background: 'white', color: '#B42318', border: '1px solid #B42318', fontWeight: 700 }}>
              Reject
            </button>
          </div>
        </div>
      ))}
      <h3 style={{ color: '#522D80', margin: '18px 0 0' }}>Recent decisions</h3>
      {data.recent.length === 0 && <div style={card}>None yet.</div>}
      {data.recent.map((row) => (
        <div key={row.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{row.driverName || row.driverEmail || row.driverId} · {row.kindLabel}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
              {row.statusLabel}{row.decidedByEmail ? ` · by ${row.decidedByEmail}` : ''} · {when(row.decidedAt || row.requestedAt)}{row.lastError && row.status === 'failed' ? ` · ${row.lastError}` : ''}
            </div>
          </div>
          <div style={{ fontWeight: 700 }}>{usd(row.amountCents)}</div>
        </div>
      ))}
    </div>
  )
}
