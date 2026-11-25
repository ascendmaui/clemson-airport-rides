import { useCallback, useEffect, useState } from 'react'
import { AdCreative } from './AdCreative'
import { adsAdmin, fetchAdsAdmin } from '../lib/adsApi'
import { describeTargeting } from '../../shared/ads/targeting.js'
import { formatEt } from '../../shared/ads/metrics.js'
import '../styles/ads.css'

const money = (c) => (c ? `$${(c / 100).toFixed(2)}` : '—')

function CreativeEditor({ creative, onSave }) {
  const [d, setD] = useState({ headline: creative.headline || '', deal_text: creative.deal_text || '', qr_url: creative.qr_url || '', theme: creative.theme || 'purple' })
  const set = (k) => (e) => setD((p) => ({ ...p, [k]: e.target.value }))
  return (
    <div className="ads-grid2">
      <div className="ads-preview-wrap"><AdCreative creative={{ ...creative, ...d }} preview /></div>
      <div style={{ display: 'grid', gap: 8 }}>
        <input aria-label="Headline" value={d.headline} onChange={set('headline')} />
        <input aria-label="Deal text" value={d.deal_text} onChange={set('deal_text')} />
        <input aria-label="QR link" value={d.qr_url} onChange={set('qr_url')} />
        <select aria-label="Colors" value={d.theme} onChange={set('theme')}>
          <option value="purple">Purple</option><option value="orange">Orange</option><option value="light">Light</option>
        </select>
        <div className="ads-actions">
          <button type="button" onClick={() => onSave({ id: creative.id, ...d })}>Save edits</button>
          <button type="button" className="primary" onClick={() => onSave({ id: creative.id, ...d, decision: 'approved' })}>Approve</button>
          <button type="button" onClick={() => onSave({ id: creative.id, decision: 'rejected', note: window.prompt('Reason for the partner?') || '' })}>Reject</button>
        </div>
      </div>
    </div>
  )
}

/** Ads admin (owner account only, enforced by /api/ads). */
export function AdsAdminPanel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [pairing, setPairing] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchAdsAdmin().then((d) => { setData(d); setError('') }).catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const run = async (fn) => {
    setBusy(true)
    try { await fn(); load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (error && !data) return <p role="alert" style={{ padding: 20 }}>{error}</p>
  if (!data) return <p style={{ padding: 20 }}>Loading ads…</p>
  const partner = (id) => data.partners.find((p) => p.id === id)

  return (
    <div className="ads-panel" style={{ marginTop: 16 }} aria-busy={busy}>
      {error ? <p role="alert">{error}</p> : null}
      <section className="ads-row">
        <h4>Campaigns ({data.campaigns.length})</h4>
        {data.campaigns.map((c) => (
          <div key={c.id} className="ads-row">
            <strong>{c.name}</strong>
            <span>{partner(c.partner_id)?.email} · {partner(c.partner_id)?.phone}</span>
            <span><span className={`ads-chip ads-chip--${c.status}`}>{c.status}</span> · {money(c.price_cents)} · QR scans {c.metrics?.scans ?? 0} ({c.metrics?.scanRate ?? 0}% of rides) · rides {c.metrics?.rides ?? c.rides_served}{c.rides_purchased ? `/${c.rides_purchased}` : ''} · impressions {c.metrics?.impressions ?? 0} · ad runs {c.metrics?.runs ?? c.stats.impressions}</span>
            <span>Targeting: {describeTargeting(c.targeting)}{c.game_day_boost ? ' · game-day boost' : ''}{c.destination_url ? ` · QR lands on ${c.destination_url}` : ''}</span>
            {(c.boosts || []).map((b) => (
              <span key={b.id} className="ads-actions" style={{ alignItems: 'center' }}>
                Boost +{b.rides_added} rides · {money(b.price_cents)} · {b.status}
                {b.status === 'pending_payment' || b.status === 'paid' ? <button type="button" className="primary" onClick={() => run(() => adsAdmin('boost', { id: b.id, action: 'apply' }))}>Apply boost</button> : null}
                {b.status === 'pending_payment' ? <button type="button" onClick={() => run(() => adsAdmin('boost', { id: b.id, action: 'cancel' }))}>Cancel</button> : null}
              </span>
            ))}
            <span>{c.starts_at ? `Runs ${new Date(c.starts_at).toLocaleDateString()} – ${c.ends_at ? new Date(c.ends_at).toLocaleDateString() : 'open'}` : 'Not started'}</span>
            {c.payment_url ? <a href={c.payment_url} target="_blank" rel="noreferrer">Payment link</a> : null}
            <div className="ads-actions">
              {c.status !== 'active' ? <button type="button" className="primary" onClick={() => run(() => adsAdmin('campaign', { id: c.id, action: c.status === 'paused' ? 'resume' : 'activate' }))}>{c.status === 'paused' ? 'Resume' : 'Activate'}</button> : null}
              {c.status === 'active' ? <button type="button" onClick={() => run(() => adsAdmin('campaign', { id: c.id, action: 'pause' }))}>Pause</button> : null}
              {c.status !== 'ended' ? <button type="button" onClick={() => run(() => adsAdmin('campaign', { id: c.id, action: 'end' }))}>End</button> : null}
              <button type="button" onClick={() => {
                const cents = window.prompt('Quoted price in dollars (founding partner)?', c.price_cents ? String(c.price_cents / 100) : '')
                if (cents) run(() => adsAdmin('campaign', { id: c.id, action: 'edit', price_cents: Math.round(Number(cents) * 100) }))
              }}>Set price</button>
              <button type="button" className="purple" onClick={() => run(async () => { const r = await adsAdmin('bill', { campaignId: c.id, mode: 'invoice' }); if (r.skipped) setError(`Billing is off: ${r.reason}`) })}>Send invoice</button>
              <button type="button" onClick={() => run(() => adsAdmin('creative', { campaignId: c.id, kind: 'built', headline: partner(c.partner_id)?.business_name || 'New ad' }))}>Build an ad</button>
            </div>
            {(c.ad_creatives || []).map((cr) => (
              <div key={cr.id} className="ads-row">
                <span><span className={`ads-chip ads-chip--${cr.approval_status}`}>{cr.approval_status}</span> {cr.kind}</span>
                {cr.kind === 'built' ? <CreativeEditor creative={cr} onSave={(b) => run(() => adsAdmin('creative', b))} /> : (
                  <>
                    <div className="ads-preview-wrap"><AdCreative creative={cr} preview /></div>
                    <div className="ads-actions">
                      <button type="button" className="primary" onClick={() => run(() => adsAdmin('creative', { id: cr.id, decision: 'approved' }))}>Approve</button>
                      <button type="button" onClick={() => run(() => adsAdmin('creative', { id: cr.id, decision: 'rejected', note: window.prompt('Reason?') || '' }))}>Reject</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="ads-row">
        <h4>Founding-partner applications ({(data.applications || []).filter((a) => a.status === 'pending').length} pending)</h4>
        {(data.applications || []).map((a) => (
          <div key={a.id} className="ads-row">
            <strong>{a.business_name} <span className={`ads-chip ads-chip--${a.status === 'pending' ? 'pending_review' : a.status === 'approved' ? 'live' : 'completed'}`}>{a.status}</span></strong>
            <span>{a.category} · {a.address} · {a.contact_name} · {a.email}{a.phone ? ` · ${a.phone}` : ''}{a.website ? ` · ${a.website}` : ''}</span>
            <span>Promote: {a.promote}</span>
            {a.offer ? <span>Offer: {a.offer}</span> : null}
            <span className="adv-fine">Applied {formatEt(a.created_at)}</span>
            {a.status === 'pending' ? (
              <div className="ads-actions">
                <button type="button" className="primary" onClick={() => run(() => adsAdmin('application', { id: a.id, decision: 'approved' }))}>Approve: unlock founding rates</button>
                <button type="button" onClick={() => run(() => adsAdmin('application', { id: a.id, decision: 'declined', note: window.prompt('Note (internal)?') || '' }))}>Decline</button>
              </div>
            ) : null}
          </div>
        ))}
      </section>

      <section className="ads-row">
        <h4>Partners ({data.partners.length})</h4>
        {data.partners.map((p) => (
          <div key={p.id} className="ads-actions" style={{ alignItems: 'center' }}>
            <span>{p.business_name} · {p.email} · <span className={`ads-chip ads-chip--${p.status === 'active' ? 'live' : 'pending_review'}`}>{p.status === 'active' ? 'onboarded' : p.status}</span>{p.founding_approved ? ' · founding rates' : ''}{p.lat != null ? ' · map pin set' : ' · no map pin (radius not enforced)'}</span>
            {p.status !== 'active' ? <button type="button" className="primary" onClick={() => run(() => adsAdmin('partner', { id: p.id, status: 'active' }))}>Onboard</button> : <button type="button" onClick={() => run(() => adsAdmin('partner', { id: p.id, status: 'suspended' }))}>Suspend</button>}
            <label className="ads-check"><input type="checkbox" checked={Boolean(p.auto_approve_creatives)} onChange={(e) => run(() => adsAdmin('partner', { id: p.id, auto_approve_creatives: e.target.checked }))} /> Auto-approve creatives</label>
            <button type="button" onClick={() => {
              const pin = window.prompt('Business map pin as "lat, lng" (for radius targeting)', p.lat != null ? `${p.lat}, ${p.lng}` : '')
              if (!pin) return
              const [lat, lng] = pin.split(',').map((x) => Number(x.trim()))
              run(() => adsAdmin('partner', { id: p.id, lat, lng }))
            }}>Set map pin</button>
          </div>
        ))}
      </section>

      <section className="ads-row">
        <h4>Best-converting ads (QR scans per ride, all partners)</h4>
        <table className="ads-table">
          <thead><tr><th>Ad</th><th>Rides</th><th>QR scans</th><th>Scan rate</th></tr></thead>
          <tbody>{(data.creativeRanking || []).slice(0, 25).map((r) => <tr key={r.creativeId}><td>{r.headline}</td><td>{r.rides}</td><td>{r.scans}</td><td>{r.scanRate}%</td></tr>)}</tbody>
        </table>
      </section>

      <section className="ads-row">
        <h4>Tablets</h4>
        <div className="ads-actions">
          <button type="button" className="primary" onClick={() => run(async () => {
            const label = window.prompt('Tablet label (car or driver)?', 'Car 1 tablet')
            if (!label) return
            const driverId = window.prompt('Driver profile id to pair (optional; rides are counted from this driver\'s trips)') || null
            const r = await adsAdmin('device', { label, driverId })
            setPairing({ ...r, url: `${window.location.origin}/tablet?device=${encodeURIComponent(r.token)}` })
          })}>Pair a tablet</button>
        </div>
        {pairing ? (
          <div className="ads-row">
            <strong>Open this link once on the tablet ({pairing.device.label}). It is shown only now.</strong>
            <div className="ads-token">{pairing.url}</div>
          </div>
        ) : null}
        {data.devices.map((d) => (
          <div key={d.id} className="ads-actions" style={{ alignItems: 'center' }}>
            <span>{d.label} · {d.active ? 'active' : 'revoked'} · last seen {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never'}{d.demo ? ' · demo' : ''}</span>
            {d.active ? <button type="button" onClick={() => run(() => adsAdmin('device', { action: 'revoke', id: d.id }))}>Revoke</button> : null}
          </div>
        ))}
      </section>

      <section className="ads-row">
        <h4>Packages</h4>
        {data.packages.map((p) => (
          <span key={p.id}>{p.name} · {money(p.price_cents)} · {p.slot_seconds}s · {p.placement} · x{p.frequency} · {p.duration_days}d · {p.rides_included || '∞'} rides · game day x{p.game_day_boost} · {p.active ? 'active' : 'inactive'}{p.placeholder ? ' · PLACEHOLDER' : ''}</span>
        ))}
      </section>

      <section className="ads-row">
        <h4>Interest leads ({data.leads.length})</h4>
        {data.leads.slice(0, 50).map((l) => <span key={l.id}>{l.business_name} · {l.contact_name} · {l.email} · {l.phone} · {l.category} · {new Date(l.created_at).toLocaleDateString()}</span>)}
      </section>
    </div>
  )
}
