import { useEffect, useMemo, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import {
  AIRPORT_RATES,
  abandonCheckoutSession,
  depositCents,
  createCheckoutSession,
  getStripeConfig,
} from '../lib/stripeCheckout'
import { formatUsdFromCents, applyStudentDiscount } from '../lib/pricing'
import { checkoutCloseOutcome, depositSurfaceCopy, STRIPE_NOT_CONFIGURED_COPY } from '../../packages/rides-native/riderMoney.js'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { useStudentStatus } from '../lib/useStudentStatus'
import { ScheduledRidePlanner } from '../components/ScheduledRidePlanner'

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
  const [bookedNote, setBookedNote] = useState(null)
  const returnFlags = useMemo(() => getHashRoute().params, [])

  useEffect(() => {
    const tripId = returnFlags.trip
    if (!tripId || !supabase) return undefined
    if (returnFlags.paid !== '1') return undefined
    let alive = true
    supabase
      .from('trips')
      .select('id, status, dropoff_label')
      .eq('id', tripId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return
        if (data.status === 'scheduled') return
        if (['searching', 'offered', 'accepted', 'arriving', 'arrived', 'in_progress'].includes(data.status)) {
          navigate('requested', { trip: data.id, dest: data.dropoff_label || '', paid: '1' })
        }
      })
    return () => {
      alive = false
    }
  }, [returnFlags.paid, returnFlags.trip])

  useEffect(() => {
    const tripId = returnFlags.trip
    if (!tripId || returnFlags.canceled !== '1') return undefined
    let alive = true
    abandonCheckoutSession({ tripId })
      .then((result) => {
        if (!alive || checkoutCloseOutcome(result) !== 'paid') return
        if (result.status === 'scheduled') {
          setBookedNote('Deposit received. This pickup stays scheduled.')
          return
        }
        navigate('requested', { trip: tripId, paid: '1' })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [returnFlags.canceled, returnFlags.trip])

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
    try {
      const session = await createCheckoutSession({
        airport,
        date,
        time,
        riderName:
          user?.user_metadata?.full_name ||
          user?.email?.split('@')[0] ||
          'Rider',
        riderId: user.id,
      })
      if (session.url) {
        window.location.href = session.url
        return
      }
      if (session.tripId && date) {
        setBookedNote('This pickup stays scheduled. Drivers can accept it from their upcoming list. Nothing else was charged.')
        return
      }
      if (session.tripId) {
        navigate('requested', { trip: session.tripId, dest: rate.name, paid: '1' })
        return
      }
      setError('Checkout did not return a payment URL. No charge was made.')
    } catch (err) {
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

        {bookedNote && (
          <div className="glass-panel glass-panel--purple" style={{ padding: 14, borderRadius: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: '#522D80' }}>Scheduled</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>{bookedNote}</div>
          </div>
        )}
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
