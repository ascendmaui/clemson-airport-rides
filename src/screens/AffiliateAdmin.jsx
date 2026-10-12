import { useCallback, useEffect, useState } from 'react'
import { affiliateAdmin, formatCents } from '../lib/affiliates'
import { AFFILIATE_PARTNER_LABELS } from '../../shared/affiliates/config.js'
import { ORANGE, PURPLE, card } from './Affiliates'

const btn = (bg = ORANGE) => ({ minHeight: 36, padding: '0 12px', borderRadius: 10, background: bg, color: '#fff', fontWeight: 800, fontSize: 13 })
const th = { textAlign: 'left', padding: '8px 6px', fontSize: 12, color: '#6b6478', borderBottom: '1px solid #eee' }
const td = { padding: '8px 6px', fontSize: 14, borderBottom: '1px solid #f3f1f6', verticalAlign: 'top' }

/** /affiliate-admin — approve partners, edit placeholder rates, approve and pay batches. */
export function AffiliateAdmin() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState(null)
  const [rates, setRates] = useState({})
  const load = useCallback(() => affiliateAdmin('overview').then((d) => { setData(d); setRates(d.rates || {}) }).catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])
  const run = async (action, body, done) => {
    setNote(null); setErr(null)
    try { const out = await affiliateAdmin(action, body); setNote(done ? done(out) : 'Saved'); await load() } catch (e) { setErr(e.message) }
  }
  if (err && !data) return <div style={{ padding: 24 }} role="alert">{err}</div>
  if (!data) return <div style={{ padding: 24 }}>Loading…</div>
  return (
    <div style={{ padding: '24px 16px', background: 'var(--surface, #f7f6fa)', minHeight: '100%' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 16 }}>
        <h1 style={{ color: PURPLE, margin: 0 }}>Affiliates admin</h1>
        {note && <div role="status" style={{ ...card, padding: 12, color: PURPLE }}>{note}</div>}
        {err && <div role="alert" style={{ ...card, padding: 12, color: '#c0392b' }}>{err}</div>}

        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Option C {rates.multipliers_pending_confirmation && <span style={{ color: ORANGE, fontSize: 13 }}>(partner bonuses — John to confirm)</span>}</h2>
          <p style={{ fontSize: 13, color: '#6b6478', marginTop: 0 }}>{rates.multipliers_note}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {[['rider_first_ride_cents', 'Rider bounty (¢)'], ['rider_min_fare_cents', 'Rider min fare (¢)'], ['driver_first_trip_cents', 'Driver first trip (¢)'], ['hold_days', 'Hold days'], ['monthly_cap', 'Monthly cap'], ['min_payout_cents', 'Min payout (¢)']].map(([k, l]) => (
              <label key={k} style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 700 }}>{l}
                <input type="number" min="0" value={rates[k] ?? ''} onChange={(e) => setRates((r) => ({ ...r, [k]: e.target.value }))} style={{ padding: 8, borderRadius: 10, border: '1px solid #ddd', width: 140 }} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            {[['student', 'Student bps (10000 = 1x)'], ['campus_org', 'Campus group bps — John to confirm'], ['local_business', 'Business bps — John to confirm'], ['influencer', 'Creator bps — John to confirm']].map(([k, l]) => (
              <label key={k} style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 700 }}>{l}
                <input type="number" min="0" value={rates.partner_type_bps?.[k] ?? ''} onChange={(e) => setRates((r) => ({ ...r, partner_type_bps: { ...r.partner_type_bps, [k]: e.target.value } }))} style={{ padding: 8, borderRadius: 10, border: '1px solid #ddd', width: 220 }} />
              </label>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 14, fontWeight: 700 }}>
            <input type="checkbox" checked={rates.multipliers_pending_confirmation !== false} onChange={(e) => setRates((r) => ({ ...r, multipliers_pending_confirmation: e.target.checked }))} />
            Bonuses still awaiting John's confirmation
          </label>
          <button type="button" className="pressable" style={{ ...btn(PURPLE), marginTop: 12 }} onClick={() => run('rates', { rates })}>Save rates</button>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Payout batches · {data.pending_entries} pending entries</h2>
          <p style={{ fontSize: 13, color: '#6b6478', marginTop: 0 }}>Approve still runs the hold, minimum, and duplicate-payment gates. Approving then transfers verified Connect accounts in test mode. Ride credit, retries, and a live key still use Pay — a live key refuses to transfer.</p>
          <button type="button" className="pressable" style={btn()} onClick={() => run('batch-create', {}, (o) => (o.batch ? `Draft batch ${formatCents(o.batch.total_cents)} · ${o.batch.entry_count} entries${o.voided ? ` · ${o.voided} voided as duplicate payment` : ''}` : 'Nothing past the hold period yet'))}>Create batch from pending</button>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr><th style={th}>Created</th><th style={th}>Entries</th><th style={th}>Total</th><th style={th}>Status</th><th style={th} /></tr></thead>
            <tbody>
              {data.batches.map((b) => (
                <tr key={b.id}>
                  <td style={td}>{new Date(b.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</td>
                  <td style={td}>{b.entry_count}</td>
                  <td style={td}>{formatCents(b.total_cents)}</td>
                  <td style={td}>{b.status}</td>
                  <td style={td}>
                    {b.status === 'draft' && <button type="button" className="pressable" style={btn(PURPLE)} onClick={() => run('batch-approve', { batch_id: b.id }, (o) => `Batch ${o.batch?.status || 'approved'}`)}>Approve & pay Connect</button>}
                    {(b.status === 'approved' || b.status === 'failed') && <button type="button" className="pressable" style={btn()} onClick={() => run('batch-pay', { batch_id: b.id }, (o) => `Batch ${o.status}`)}>Pay (test mode / credit)</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={{ ...card, overflowX: 'auto' }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Partners ({data.affiliates.length})</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Partner', 'Type', 'Code', 'Clicks', 'Signups', 'Qualified', 'Pending', 'Paid', 'Payout', 'Connect', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.affiliates.map((a) => (
                <tr key={a.id}>
                  <td style={td}><strong>{a.org_name || a.display_name}</strong><div style={{ fontSize: 12, color: '#6b6478' }}>{a.contact_email}{a.website ? ` · ${a.website}` : ''}</div></td>
                  <td style={td}>{AFFILIATE_PARTNER_LABELS[a.partner_type]}</td>
                  <td style={td}><code>{a.code}</code></td>
                  <td style={td}>{a.clicks}</td>
                  <td style={td}>{a.signups}</td>
                  <td style={td}>{a.qualified}{a.rejected ? <span style={{ color: '#c0392b' }}> / {a.rejected} rej</span> : null}</td>
                  <td style={td}>{formatCents(a.earnings.pending_cents + a.earnings.approved_cents)}</td>
                  <td style={td}>{formatCents(a.earnings.paid_cents)}</td>
                  <td style={td}>
                    <select value={a.payout_method} onChange={(e) => run('status', { affiliate_id: a.id, status: a.status, payout_method: e.target.value })}>
                      <option value="ride_credit">Ride credit</option>
                      <option value="stripe_connect">Stripe Connect (test)</option>
                    </select>
                  </td>
                  <td style={td}>{a.connect_status || 'not_started'}</td>
                  <td style={td}>{a.status}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {a.status !== 'active' && <button type="button" className="pressable" style={btn()} onClick={() => run('status', { affiliate_id: a.id, status: 'active' })}>Approve</button>}
                    {a.status === 'active' && <button type="button" className="pressable" style={btn('#6b6478')} onClick={() => run('status', { affiliate_id: a.id, status: 'paused' })}>Pause</button>}
                    {a.status === 'pending' && <button type="button" className="pressable" style={{ ...btn('#c0392b'), marginLeft: 6 }} onClick={() => run('status', { affiliate_id: a.id, status: 'rejected' })}>Reject</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
