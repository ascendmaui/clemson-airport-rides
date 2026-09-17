import { useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import {
  AIRPORT_RATES,
  depositCents,
  createCheckoutSession,
  getStripeConfig,
} from '../lib/stripeStub'
import { formatUsdFromCents } from '../lib/pricing'
import { navigate } from '../lib/navigation'

export function ScheduleAirport() {
  const [airport, setAirport] = useState('GSP')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const rate = AIRPORT_RATES[airport]
  const deposit = depositCents(rate.fareCents)
  const stripe = getStripeConfig()

  const onBook = async () => {
    setBusy(true)
    try {
      const session = await createCheckoutSession({
        airport,
        riderName: 'John',
      })
      setResult(session)
      if (session.url && !session.stub) {
        window.location.href = session.url
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--surface-muted)' }}>
      <div style={{ flex: 1, padding: '20px 20px 24px', overflowY: 'auto' }}>
        <button type="button" className="pressable" onClick={() => navigate('home')} style={{ fontSize: 20, marginBottom: 12 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4 }}>Schedule airport</h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, marginBottom: 20 }}>
          Flat rates · 25% deposit holds your ride
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {Object.values(AIRPORT_RATES).map((a) => (
            <button
              key={a.code}
              type="button"
              className="pressable"
              onClick={() => setAirport(a.code)}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 16,
                background: airport === a.code ? 'var(--orange-soft)' : 'var(--surface)',
                border: `1.5px solid ${airport === a.code ? 'rgba(245,102,0,0.4)' : 'var(--border)'}`,
                textAlign: 'left',
                boxShadow: 'var(--shadow-pill)',
                transition: 'background 200ms var(--ease-soft), border-color 200ms var(--ease-soft)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 18 }}>{a.code}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>{a.name.split('(')[0].trim()}</div>
              <div style={{ fontWeight: 600, fontSize: 20, marginTop: 10, color: 'var(--orange)' }}>
                {formatUsdFromCents(a.fareCents)}
              </div>
            </button>
          ))}
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            width: '100%',
            marginTop: 6,
            marginBottom: 14,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time</label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{
            width: '100%',
            marginTop: 6,
            marginBottom: 20,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        />

        <div
          className="sheet"
          style={{
            padding: 16,
            borderRadius: 16,
            marginBottom: 16,
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Fare</span>
            <strong>{formatUsdFromCents(rate.fareCents)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--ink-secondary)' }}>25% deposit</span>
            <strong style={{ color: 'var(--orange)' }}>{formatUsdFromCents(deposit)}</strong>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 10 }}>
            {rate.code} · {rate.fareCents}¢ fare → {deposit}¢ deposit
            {stripe.configured ? ' · publishable key ready' : ' · set VITE_STRIPE_PUBLISHABLE_KEY'}
          </p>
        </div>

        <PrimaryButton onClick={onBook} disabled={busy}>
          {busy ? 'Starting checkout…' : `Pay ${formatUsdFromCents(deposit)} deposit`}
        </PrimaryButton>

        {result && (
          <pre
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 12,
              background: 'var(--surface)',
              fontSize: 11,
              overflow: 'auto',
              boxShadow: 'var(--shadow-pill)',
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
      <BottomTabs active="rides" />
    </div>
  )
}
