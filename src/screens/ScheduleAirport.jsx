import { useMemo, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import {
  AIRPORT_RATES,
  depositCents,
  createCheckoutSession,
  getStripeConfig,
} from '../lib/stripeCheckout'
import { formatUsdFromCents } from '../lib/pricing'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { STADIUM } from '../components/CampusMap'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { isClemsonEmail } from '../lib/studentDomain'

const AIRPORT_COORDS = {
  GSP: { label: 'Greenville-Spartanburg International (GSP)', lat: 34.8956, lng: -82.2189 },
  CLT: { label: 'Charlotte Douglas International (CLT)', lat: 35.2144, lng: -80.9473 },
}


async function assertStudentEligible(user) {
  if (!user?.id) throw new Error('Sign in required to book')
  if (isClemsonEmail(user.email)) return true
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('profiles')
    .select('student_verified_at')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Could not verify student status')
  if (data?.student_verified_at) return true
  throw new Error('Use your @clemson.edu email to join Clemson RIDES.')
}

async function createAirportTrip({ user, airport, fareCents, deposit, date, time }) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!user?.id) throw new Error('Sign in required to book')
  await assertStudentEligible(user)

  const dest = AIRPORT_COORDS[airport] || AIRPORT_COORDS.GSP
  let scheduledFor = null
  if (date) {
    const hhmm = time || '12:00'
    scheduledFor = new Date(`${date}T${hhmm}:00`).toISOString()
  }

  const { data, error } = await supabase
    .from('trips')
    .insert({
      rider_id: user.id,
      status: 'searching',
      tier: 'standard',
      pickup_label: 'Memorial Stadium',
      dropoff_label: dest.label,
      pickup_lat: STADIUM[0],
      pickup_lng: STADIUM[1],
      dropoff_lat: dest.lat,
      dropoff_lng: dest.lng,
      fare_cents: fareCents,
      deposit_cents: deposit,
      passengers: 1,
      scheduled_for: scheduledFor,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message || 'Could not create trip')
  return data.id
}

export function ScheduleAirport() {
  const { user } = useAuth()
  const { runOrPrompt } = useRequireAuthForAction()
  const [promptOpen, setPromptOpen] = useState(false)
  const [airport, setAirport] = useState('GSP')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const returnFlags = useMemo(() => getHashRoute().params, [])

  const rate = AIRPORT_RATES[airport]
  const deposit = depositCents(rate.fareCents)
  const stripe = getStripeConfig()

  const onBook = async () => {
    setBusy(true)
    setError(null)
    try {
      const tripId = await createAirportTrip({
        user,
        airport,
        fareCents: rate.fareCents,
        deposit,
        date,
        time,
      })
      const session = await createCheckoutSession({
        airport,
        riderName:
          user?.user_metadata?.full_name ||
          user?.email?.split('@')[0] ||
          'Rider',
        riderId: user.id,
        tripId,
      })
      if (session.url) {
        window.location.href = session.url
        return
      }
      setError('Checkout did not return a payment URL. No charge was made.')
    } catch (err) {
      setError(err.message || 'Checkout failed. No charge was made.')
    } finally {
      setBusy(false)
    }
  }

  const onPayClick = () => {
    runOrPrompt(onBook, {
      setPromptOpen,
      nextPath: 'schedule',
    })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'transparent' }}>
      <div style={{ flex: 1, padding: '20px 20px 24px', overflowY: 'auto' }}>
        <button type="button" className="pressable glass-pill" onClick={() => navigate('home')} style={{ fontSize: 20, marginBottom: 12, width: 40, height: 40, borderRadius: 12 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4 }}>Schedule airport</h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, marginBottom: 20 }}>
          Flat rates · 25% deposit holds your ride
        </p>

        {returnFlags.paid === '1' && (
          <div className="glass-panel glass-panel--orange" style={{ padding: 14, borderRadius: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700 }}>Deposit received</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>
              Stripe confirmed the 25% hold. We’ll match a driver for this pickup.
            </div>
          </div>
        )}
        {returnFlags.canceled === '1' && (
          <div className="glass-panel" style={{ padding: 14, borderRadius: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700 }}>Checkout canceled</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>
              Nothing was charged. You can start checkout again when you’re ready.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {Object.values(AIRPORT_RATES).map((a) => (
            <button
              key={a.code}
              type="button"
              className={`pressable glass-panel card-soft ${airport === a.code ? 'glass-panel--orange' : ''}`}
              onClick={() => setAirport(a.code)}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 16,
                textAlign: 'left',
                border: airport === a.code ? '1.5px solid rgba(245,102,0,0.35)' : undefined,
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
        <input type="date" className="glass-input" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }} />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time</label>
        <input type="time" className="glass-input" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: '100%', marginTop: 6, marginBottom: 20, padding: '12px 14px', borderRadius: 12 }} />

        <div className="glass-panel glass-panel--elevated" style={{ padding: 16, borderRadius: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Fare</span>
            <strong>{formatUsdFromCents(rate.fareCents)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--ink-secondary)' }}>25% deposit</span>
            <strong style={{ color: 'var(--orange)' }}>{formatUsdFromCents(deposit)}</strong>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 10 }}>
            {rate.code} · {formatUsdFromCents(rate.fareCents)} fare → {formatUsdFromCents(deposit)} deposit
            {stripe.configured ? ' · Stripe ready' : ' · set VITE_STRIPE_PUBLISHABLE_KEY'}
          </p>
        </div>

        <PrimaryButton className="primary-cta" onClick={onPayClick} disabled={busy}>
          {busy ? 'Starting checkout…' : `Pay ${formatUsdFromCents(deposit)} deposit`}
        </PrimaryButton>

        {error && (
          <p role="alert" className="glass-panel" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: 'rgba(217,45,32,0.10)', color: 'var(--danger)', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
            {error}
          </p>
        )}
      </div>
      <BottomTabs active="rides" />
      <SignInToBookModal open={promptOpen} onClose={() => setPromptOpen(false)} nextPath="schedule" />
    </div>
  )
}
