import { useMemo, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import {
  AIRPORT_RATES,
  depositCents,
  createCheckoutSession,
  getStripeConfig,
} from '../lib/stripeCheckout'
import { formatUsdFromCents, applyStudentDiscount } from '../lib/pricing'
import { depositSurfaceCopy, STRIPE_NOT_CONFIGURED_COPY } from '../../packages/rides-native/riderMoney.js'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { STADIUM } from '../components/CampusMap'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { useStudentStatus } from '../lib/useStudentStatus'
import { firstName } from '../lib/scheduledRideModel'
import { ScheduledRidePlanner } from '../components/ScheduledRidePlanner'

const AIRPORT_COORDS = {
  GSP: { label: 'Greenville-Spartanburg International (GSP)', lat: 34.8956, lng: -82.2189 },
  CLT: { label: 'Charlotte Douglas International (CLT)', lat: 35.2144, lng: -80.9473 },
}


async function createAirportTrip({ user, airport, fareCents, deposit, date, time, student }) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!user?.id) throw new Error('Sign in required to book')

  const dest = AIRPORT_COORDS[airport] || AIRPORT_COORDS.GSP
  let scheduledFor = null
  if (date) {
    const hhmm = time || '12:00'
    scheduledFor = new Date(`${date}T${hhmm}:00`).toISOString()
  }
  const ahead = Boolean(scheduledFor)

  const { data, error } = await supabase
    .from('trips')
    .insert({
      rider_id: user.id,
      status: ahead ? 'scheduled' : 'searching',
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
      pickup_at: scheduledFor,
      scheduled_for: scheduledFor,
      rider_note: ahead ? 'airport' : null,
      metadata: {
        ...(ahead
          ? { kind: 'scheduled', purpose: 'airport', fare_is_estimate: false, reminders: {} }
          : {}),
        rider_first_name: firstName(
          user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
        ),
        isStudent: Boolean(student?.discountCents),
        student_discount_cents: Math.max(0, Math.round(Number(student?.discountCents) || 0)),
        studentLabel: student?.label || null,
      },
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message || 'Could not create trip')
  return data.id
}

async function releaseUnpaidTrip(tripId) {
  if (!supabase || !tripId) return
  await supabase
    .from('trips')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', tripId)
    .in('status', ['searching', 'scheduled'])
}

export function ScheduleAirport() {
  const { user } = useAuth()
  const studentStatusNow = useStudentStatus()
  const { runOrPrompt } = useRequireAuthForAction()
  const [promptOpen, setPromptOpen] = useState(false)
  const [airport, setAirport] = useState('GSP')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const returnFlags = useMemo(() => getHashRoute().params, [])

  const rate = AIRPORT_RATES[airport]
  const student = applyStudentDiscount(rate.fareCents, {
    isStudent: studentStatusNow.verified,
    tier: 'standard',
  })
  const fareCents = student.fareCents
  const deposit = depositCents(fareCents)
  const remaining = Math.max(0, fareCents - deposit)
  const quoteCopy = depositSurfaceCopy(
    { fareCents, depositCents: deposit, remainingCents: remaining },
    'quote',
    { studentDiscountCents: student.discountCents },
  )
  const stripe = getStripeConfig()

  const onBook = async () => {
    setBusy(true)
    setError(null)
    let tripId = ''
    try {
      const depositAmount = deposit
      tripId = await createAirportTrip({
        user,
        airport,
        fareCents,
        deposit: depositAmount,
        date,
        time,
        student,
      })
      const session = await createCheckoutSession({
        airport,
        fareCents,
        depositCents: deposit,
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
      await releaseUnpaidTrip(tripId)
      setError('Checkout did not return a payment URL. No charge was made.')
    } catch (err) {
      try { await releaseUnpaidTrip(tripId) } catch { /* keep the checkout error */ }
      setError(err.message || STRIPE_NOT_CONFIGURED_COPY)
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
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4, color: '#522D80' }}>Schedule</h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, marginBottom: 20 }}>
          Plan a pickup ahead of time, or hold an airport ride with a 25% deposit.
          {studentStatusNow.verified ? ' Clemson student discount applies on standard fares.' : ''}
        </p>

        <ScheduledRidePlanner />

        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: '#522D80', marginBottom: 8 }}>
          Airport deposit
        </h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
          Flat rates from Memorial Stadium. A date keeps the ride scheduled for drivers to accept. Leave the date empty to request a driver now.
        </p>

        {returnFlags.paid === '1' && (
          <div className="glass-panel glass-panel--orange" style={{ padding: 14, borderRadius: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700 }}>Deposit received</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>
              Stripe confirmed the 25% deposit. The remaining balance is collected when the trip is complete.
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
          {Object.values(AIRPORT_RATES).map((a) => {
            const shown = applyStudentDiscount(a.fareCents, {
              isStudent: studentStatusNow.verified,
              tier: 'standard',
            })
            return (
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
                {formatUsdFromCents(shown.fareCents)}
              </div>
            </button>
            )
          })}
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Date</label>
        <input type="date" className="glass-input" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }} />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time</label>
        <input type="time" className="glass-input" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: '100%', marginTop: 6, marginBottom: 20, padding: '12px 14px', borderRadius: 12 }} />

        <div className="glass-panel glass-panel--orange" style={{ padding: 16, borderRadius: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.1, fontWeight: 800, color: '#F56600', marginBottom: 8 }}>AIRPORT DEPOSIT</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Full fare</span>
            <strong style={{ color: '#522D80' }}>{formatUsdFromCents(fareCents)}</strong>
          </div>
          {student.discountCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--ink-secondary)' }}>Student discount</span>
              <strong style={{ color: '#F56600' }}>−{formatUsdFromCents(student.discountCents)}</strong>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>25% deposit</span>
            <strong style={{ color: '#F56600' }}>{formatUsdFromCents(deposit)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#522D80', fontWeight: 700 }}>Remaining balance</span>
            <strong style={{ color: '#522D80' }}>{formatUsdFromCents(remaining)}</strong>
          </div>
          <p style={{ fontSize: 12, color: '#522D80', marginTop: 10, lineHeight: 1.45 }}>
            {quoteCopy}
          </p>
          {!stripe.configured && (
            <p style={{ fontSize: 12, color: '#522D80', marginTop: 8, lineHeight: 1.45 }}>
              This browser has no Stripe publishable key. Pay deposit still asks the server. If Checkout cannot start, nothing is charged and live mode stays off.
            </p>
          )}
        </div>

        <PrimaryButton className="primary-cta" onClick={onPayClick} disabled={busy || deposit <= 0}>
          {busy ? 'Starting checkout…' : `Pay ${formatUsdFromCents(deposit)} deposit`}
        </PrimaryButton>

        {error && (
          <p role="alert" className="glass-panel" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: 'rgba(217,45,32,0.10)', color: 'var(--danger)', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
            {error}
          </p>
        )}
      </div>
      <BottomTabs active="schedule" onChange={(id) => navigate(id === 'home' || id === 'rides' ? 'home' : id)} />
      <SignInToBookModal open={promptOpen} onClose={() => setPromptOpen(false)} nextPath="schedule" />
    </div>
  )
}
