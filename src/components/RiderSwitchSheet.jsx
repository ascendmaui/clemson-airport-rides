import { useEffect, useState } from 'react'
import { authedJson } from '../lib/apiClient.js'
import { supabase } from '../lib/supabase.js'
import { formatUsdFromCents } from '../lib/pricing.js'
import { PrimaryButton } from './PrimaryButton'
import { riderSwitchGuide } from '../../shared/copy/riderSwitch.js'

const GUIDE = riderSwitchGuide()

async function postSwitch(body) {
  return authedJson(supabase, '/api/rider-switch', { method: 'POST', body })
}

export function RiderSwitchSheet({ tripId, onClose, onDone }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    postSwitch({ tripId, confirm: false })
      .then((data) => { if (alive) setPreview(data) })
      .catch((err) => { if (alive) setError(err.message || 'Could not load this ride') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [tripId])

  async function confirm(action, extra = {}) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await postSwitch({ tripId, confirm: true, action, ...extra })
      onDone?.(data)
    } catch (err) {
      setError(err.message || 'Could not update this ride')
    } finally {
      setBusy(false)
    }
  }

  const quote = preview?.quote
  const allowed = Boolean(quote?.allowed)
  const drivers = preview?.drivers || []
  const tiers = preview?.tiers || []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rider-switch-title"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: 'rgba(11,18,32,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="sheet glass-panel--elevated"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '88%',
          overflowY: 'auto',
          padding: '12px 20px calc(24px + var(--safe-bottom))',
          borderTop: '1px solid rgba(255,255,255,0.65)',
          background: 'linear-gradient(180deg, rgba(245,102,0,0.14), rgba(82,45,128,0.10) 42%, rgba(255,255,255,0.92))',
        }}
      >
        <div className="sheet-handle" />
        <div style={{ fontSize: 13, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>BEFORE PICKUP</div>
        <h2 id="rider-switch-title" style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple)', letterSpacing: -0.3, margin: '6px 0 8px' }}>
          {GUIDE.title}
        </h2>
        {loading ? <p style={{ color: 'var(--ink-tertiary)' }}>Checking the fee and the card hold…</p> : null}
        {quote ? (
          <div style={{
            borderRadius: 16,
            padding: 14,
            background: 'rgba(255,255,255,0.72)',
            border: '1px solid rgba(82,45,128,0.16)',
            marginBottom: 12,
          }}>
            <p style={{ margin: 0, fontWeight: 800, color: 'var(--ink)' }}>{quote.feeLine}</p>
            {quote.holdLine ? <p style={{ margin: '8px 0 0', color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>{quote.holdLine}</p> : null}
          </div>
        ) : null}
        <button
          type="button"
          className="pressable"
          onClick={() => setShowGuide((open) => !open)}
          aria-expanded={showGuide}
          style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 8 }}
        >
          {showGuide ? 'Hide how it works' : 'How it works'}
        </button>
        {showGuide ? (
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
            {GUIDE.summary.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
        {allowed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PrimaryButton onClick={() => confirm('rerequest')} disabled={busy}>
              {busy ? 'Updating…' : 'Request another driver'}
            </PrimaryButton>
            {preview?.poolLine ? <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-secondary)' }}>{preview.poolLine}</p> : null}
            {drivers.length > 0 ? (
              <div>
                <div style={{ fontWeight: 800, color: 'var(--purple)', margin: '8px 0' }}>Or pick a driver</div>
                {drivers.map((driver) => (
                  <button
                    key={driver.id}
                    type="button"
                    className="pressable"
                    disabled={busy}
                    onClick={() => confirm('switch-driver', { driverId: driver.id })}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 14,
                      marginBottom: 8,
                      background: '#fff',
                      border: '1px solid rgba(82,45,128,0.16)',
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{driver.name}</div>
                    {driver.detail ? <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{driver.detail}</div> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div style={{ fontWeight: 800, color: 'var(--purple)', marginTop: 4 }}>Or change the ride</div>
            {tiers.map((tier) => (
              <button
                key={tier.id}
                type="button"
                className="pressable"
                disabled={busy || tier.current || !tier.available || tier.fareCents == null}
                onClick={() => confirm('switch-tier', { tier: tier.id })}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: '#fff',
                  border: '1px solid rgba(245,102,0,0.28)',
                  opacity: tier.available ? 1 : 0.45,
                }}
              >
                <div style={{ fontWeight: 800 }}>{tier.name}{tier.current ? ' · current' : ''}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
                  {tier.fareCents == null ? 'Fare unavailable' : formatUsdFromCents(tier.fareCents)}
                  {tier.current ? '' : tier.available ? '' : ' · no driver online'}
                </div>
              </button>
            ))}
            {quote?.carpoolLine ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.4 }}>{quote.carpoolLine}</p>
            ) : null}
            <button
              type="button"
              className="pressable"
              disabled={busy}
              onClick={() => confirm('cancel')}
              style={{ fontWeight: 800, color: 'var(--danger, #b42318)', padding: '8px 0' }}
            >
              Cancel without a new ride
            </button>
          </div>
        ) : null}
        {error ? <p role="alert" style={{ color: 'var(--danger, #b42318)', fontSize: 13 }}>{error}</p> : null}
        <button type="button" className="pressable" onClick={onClose} style={{ marginTop: 8, fontWeight: 700, color: 'var(--ink-tertiary)' }}>
          Close
        </button>
      </div>
    </div>
  )
}
