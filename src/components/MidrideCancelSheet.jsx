import { useEffect, useState } from 'react'
import { PrimaryButton } from './PrimaryButton'
import { formatMidrideMoney, midrideChargeSummary, requestMidrideCancel } from '../lib/midrideCancel'

/**
 * Confirm sheet before a mid-ride cancel. Explains the partial fare + fee.
 */
export function MidrideCancelSheet({ tripId, onClose, onCanceled }) {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    requestMidrideCancel({ tripId, confirm: false })
      .then((data) => {
        if (!alive) return
        setQuote(data.quote || data)
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message || 'Could not price this cancel')
        if (e.payload?.quote) setQuote(e.payload.quote)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [tripId])

  async function onConfirm() {
    if (!tripId || busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await requestMidrideCancel({ tripId, confirm: true })
      onCanceled?.(data)
    } catch (e) {
      setError(e.message || 'Could not cancel')
      if (e.payload?.quote) setQuote(e.payload.quote)
    } finally {
      setBusy(false)
    }
  }

  const blocked = Boolean(quote?.blocked || quote?.abuse?.blocked)
  const abuse = quote?.abuse

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="midride-cancel-title"
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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '12px 20px calc(24px + var(--safe-bottom))',
          borderTop: '1px solid rgba(255,255,255,0.65)',
          background: 'linear-gradient(180deg, rgba(245,102,0,0.14), rgba(82,45,128,0.10) 42%, rgba(255,255,255,0.92))',
        }}
      >
        <div className="sheet-handle" />
        <div id="midride-cancel-title" style={{ fontSize: 13, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>
          CANCEL THIS RIDE
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple)', letterSpacing: -0.3, margin: '6px 0 8px' }}>
          You will be charged for the trip so far
        </h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, marginBottom: 12 }}>
          Canceling after pickup ends the ride for you and your driver. The charge is the distance and time
          already completed, plus a mid-ride cancel fee. This is separate from a wait fee at pickup.
        </p>

        {loading && <p style={{ color: 'var(--ink-tertiary)' }}>Calculating the charge…</p>}

        {quote && !loading && (
          <div style={{
            borderRadius: 16,
            padding: 14,
            background: 'rgba(255,255,255,0.72)',
            border: '1px solid rgba(82,45,128,0.16)',
            marginBottom: 12,
          }}>
            <Row label="Distance and time" value={formatMidrideMoney(quote.ridePortionCents)} />
            <Row label="Mid-ride cancel fee" value={formatMidrideMoney(quote.cancelFeeCents)} />
            {(quote.depositPaidCents || 0) > 0 && (
              <Row label="Deposit already paid" value={`−${formatMidrideMoney(Math.min(quote.depositPaidCents, quote.obligationCents))}`} />
            )}
            <Row label="Charge now" value={formatMidrideMoney(quote.toCollectCents)} strong />
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '8px 0 0', lineHeight: 1.4 }}>
              {midrideChargeSummary(quote)}
            </p>
            {abuse && (
              <p style={{ fontSize: 12, color: blocked ? 'var(--danger, #b42318)' : 'var(--purple)', margin: '8px 0 0', fontWeight: 650 }}>
                {blocked
                  ? `Mid-ride cancel is paused after ${abuse.max} in ${abuse.windowDays} days.`
                  : `${abuse.priorCount} of ${abuse.max} mid-ride cancels used in the last ${abuse.windowDays} days.`}
              </p>
            )}
          </div>
        )}

        {error && <p style={{ color: 'var(--danger, #b42318)', fontSize: 13, marginBottom: 10 }}>{error}</p>}

        <PrimaryButton onClick={onConfirm} disabled={loading || busy || blocked || !quote} variant="gradient">
          {busy ? 'Canceling…' : blocked ? 'Cancel unavailable' : 'Confirm cancel and pay'}
        </PrimaryButton>
        <button
          type="button"
          className="pressable"
          onClick={onClose}
          disabled={busy}
          style={{ width: '100%', marginTop: 10, padding: 12, fontWeight: 700, color: 'var(--purple)' }}
        >
          Keep riding
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: strong ? 16 : 14 }}>
      <span style={{ color: strong ? 'var(--purple)' : 'var(--ink-secondary)', fontWeight: strong ? 800 : 600 }}>{label}</span>
      <span style={{ fontWeight: 800, color: 'var(--ink)' }}>{value}</span>
    </div>
  )
}
