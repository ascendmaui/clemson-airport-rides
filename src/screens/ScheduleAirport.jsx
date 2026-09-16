import { useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import { AIRPORT_RATES, depositAmount, createDepositIntent, getStripeConfig } from '../lib/stripeStub'
import { navigate } from '../lib/navigation'

export function ScheduleAirport() {
  const [airport, setAirport] = useState('GSP')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const rate = AIRPORT_RATES[airport]
  const deposit = depositAmount(rate.total)
  const stripe = getStripeConfig()

  const onBook = async () => {
    setBusy(true)
    try {
      // Stub path: createDepositIntent logs + returns stub shape (no fake secrets).
      // TODO: mount Stripe Payment Element with getStripeConfig().publishableKey
      //       after server POST /api/stripe/create-deposit-intent returns a real clientSecret.
      const intent = await createDepositIntent({ airport, riderName: 'John' })
      setResult(intent)
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
              <div style={{ fontWeight: 600, fontSize: 20, marginTop: 10, color: 'var(--orange)' }}>${a.total}</div>
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
          style={{
            background: 'var(--surface)',
            borderRadius: 18,
            padding: 18,
            border: '1px solid var(--border)',
            marginBottom: 20,
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Trip total</span>
            <span style={{ fontWeight: 600 }}>${rate.total.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Deposit due now (25%)</span>
            <span style={{ fontWeight: 700, color: 'var(--purple)', fontSize: 18 }}>${deposit.toFixed(2)}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>
            Remainder charged after drop-off · Stripe stub
            {stripe.configured ? ' · pk configured' : ' · set VITE_STRIPE_PUBLISHABLE_KEY'}
          </div>
        </div>

        <PrimaryButton variant="gradient" disabled={busy} onClick={onBook}>
          {busy ? 'Creating deposit…' : `Pay $${deposit.toFixed(2)} deposit`}
        </PrimaryButton>

        {result && (
          <div
            className="fade-in"
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 14,
              background: 'var(--purple-soft)',
              fontSize: 13,
              color: 'var(--purple)',
              lineHeight: 1.45,
            }}
          >
            ✓ Deposit intent stubbed (see console). {result.message}
            <br />
            {/* TODO: Stripe Payment Element — load with getStripeConfig().publishableKey once server returns clientSecret */}
            TODO: wire live Stripe Payment Element (no fake clientSecret).
          </div>
        )}
      </div>
      <BottomTabs active="schedule" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}
