import { useEffect, useMemo, useRef, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import {
  AIRPORT_RATES,
  abandonCheckoutSession,
  reconcileCheckoutSession,
} from '../lib/stripeCheckout'
import { BillingPicker } from '../components/BillingPicker'
import { parseCheckoutSessionId } from '../../packages/rides-native/checkoutReturn.js'
import { formatUsdFromCents } from '../lib/pricing'
import { fetchBillingQuote, recordBillingChoice } from '../lib/rideBilling'
import { checkoutCloseOutcome, depositSurfaceCopy } from '../../packages/rides-native/riderMoney.js'
import { UNAVAILABLE_COPY } from '../lib/apiErrors.js'
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
  const [airport, setAirport] = useState(() => {
    const code = String(getHashRoute().params?.airport || '').toUpperCase()
    return code === 'CLT' ? 'CLT' : 'GSP'
  })
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [bookedNote, setBookedNote] = useState(null)
  const [offer, setOffer] = useState(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingChoice, setBillingChoice] = useState(() => {
    const requested = String(getHashRoute().params?.billing || '')
    return requested === 'credits' ? 'credits' : 'deposit'
  })
  const returnFlags = useMemo(() => getHashRoute().params, [])
  const reconciledSessions = useRef(new Set())

  useEffect(() => {
    const tripId = returnFlags.trip
    if (!tripId || !supabase) return undefined
    if (returnFlags.paid !== '1') return undefined
    let alive = true

    async function checkTrip() {
      const { data } = await supabase
        .from('trips')
        .select('id, status, dropoff_label')
        .eq('id', tripId)
        .maybeSingle()
      if (!alive || !data) return
      if (data.status === 'scheduled') return
      if (['searching', 'offered', 'accepted', 'arriving', 'arrived', 'in_progress'].includes(data.status)) {
        navigate('requested', { trip: data.id, dest: data.dropoff_label || '', paid: '1' })
      }
    }

    void checkTrip()

    const sessionId = returnFlags.session_id || returnFlags.sessionId || parseCheckoutSessionId(typeof window !== 'undefined' ? (window.location.hash || window.location.href) : '')
    if (sessionId && !reconciledSessions.current.has(sessionId)) {
      reconciledSessions.current.add(sessionId)
      reconcileCheckoutSession({ sessionId })
        .then(() => {
          if (alive) void checkTrip()
        })
        .catch((err) => {
          console.error('[checkout-reconcile] failed to reconcile checkout:', err)
        })
    }

    return () => {
      alive = false
    }
  }, [returnFlags.paid, returnFlags.trip, returnFlags.session_id, returnFlags.sessionId])

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

  useEffect(() => {
    if (!user?.id) {
      setOffer(null)
      setBillingLoading(false)
      return undefined
    }
    let alive = true
    setBillingLoading(true)
    fetchBillingQuote({ airport, date: date || undefined, time: time || undefined })
      .then((next) => {
        if (!alive) return
        setOffer(next)
        setBillingChoice((current) => {
          if (current === 'credits' && next?.creditsSelectable) return 'credits'
          return 'deposit'
        })
      })
      .catch(() => {
        if (alive) setOffer(null)
      })
      .finally(() => {
        if (alive) setBillingLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user?.id, airport, date, time])

  const fareCents = offer?.fareCents
  const deposit = offer?.depositCents
  const remaining = offer?.remainingCents
  const quoteCopy = offer
    ? depositSurfaceCopy(
      { fareCents: offer.fareCents, depositCents: offer.depositCents, remainingCents: offer.remainingCents },
      'quote',
      { studentDiscountCents: offer.discountCents },
    )
    : null

  const onBook = async () => {
    setBusy(true)
    setError(null)
    try {
      const saved = await recordBillingChoice({
        choice: billingChoice,
        airport,
        date: date || undefined,
        time: time || undefined,
      })
      if (saved.choice === 'credits') {
        setBookedNote('Ride credits selected for this trip. The balance was not spent and no card was charged.')
        return
      }
      setBookedNote('25% deposit requested. No card was charged.')
    } catch (err) {
      setError(err.message || UNAVAILABLE_COPY)
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
        <button type="button" className="pressable glass-pill nav-back-btn" aria-label="Back to home" onClick={() => navigate('home')} style={{ marginBottom: 12 }}>←</button>
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
            </button>
          ))}
        </div>

        <label htmlFor="schedule-flight-date" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Date</label>
        <input
          id="schedule-flight-date"
          type="date"
          className="glass-input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={Boolean(error && /date/i.test(error)) ? 'true' : undefined}
          aria-describedby={error ? 'schedule-airport-error' : undefined}
          style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }}
        />
        <label htmlFor="schedule-flight-time" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time</label>
        <input
          id="schedule-flight-time"
          type="time"
          className="glass-input"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-invalid={Boolean(error && /time/i.test(error)) ? 'true' : undefined}
          aria-describedby={error ? 'schedule-airport-error' : undefined}
          style={{ width: '100%', marginTop: 6, marginBottom: 20, padding: '12px 14px', borderRadius: 12 }}
        />

        <div className="glass-panel glass-panel--orange" style={{ padding: 16, borderRadius: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.1, fontWeight: 800, color: '#F56600', marginBottom: 8 }}>AIRPORT DEPOSIT · 25%</div>
          <ol style={{ margin: '0 0 12px', paddingLeft: 18, color: '#522D80', fontSize: 13, lineHeight: 1.5, fontWeight: 650 }}>
            <li>Request the 25% deposit. A card is not charged in this step.</li>
            <li>Drivers see the ride after that deposit is confirmed.</li>
            <li>The remaining balance stays due when the trip is complete.</li>
          </ol>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Full fare</span>
            <strong style={{ color: '#522D80' }}>{fareCents == null ? '—' : formatUsdFromCents(fareCents)}</strong>
          </div>
          {offer?.discountCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--ink-secondary)' }}>Student discount</span>
              <strong style={{ color: '#F56600' }}>−{formatUsdFromCents(offer.discountCents)}</strong>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Pay now · 25% deposit</span>
            <strong style={{ color: '#F56600' }}>{deposit == null ? '—' : formatUsdFromCents(deposit)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#522D80', fontWeight: 700 }}>Due after trip</span>
            <strong style={{ color: '#522D80' }}>{remaining == null ? '—' : formatUsdFromCents(remaining)}</strong>
          </div>
          {quoteCopy && (
            <p style={{ fontSize: 12, color: '#522D80', marginTop: 10, lineHeight: 1.45 }}>
              {quoteCopy}
            </p>
          )}
        </div>

        <BillingPicker
          offer={user?.id ? offer : null}
          selected={billingChoice}
          onSelect={setBillingChoice}
          loading={Boolean(user?.id) && billingLoading}
          signedIn={Boolean(user?.id)}
        />

        <PrimaryButton
          className="primary-cta"
          onClick={onPayClick}
          disabled={
            busy
            || Boolean(user?.id && (billingLoading || !offer))
            || Boolean(offer && billingChoice === 'credits' && !offer.creditsSelectable)
            || Boolean(offer && billingChoice !== 'credits' && !(deposit > 0))
          }
          data-testid="airport-deposit-request"
        >
          {busy
            ? 'Saving…'
            : billingChoice === 'credits'
              ? 'Use ride credits'
              : deposit == null
                ? 'Request 25% deposit'
                : `Request ${formatUsdFromCents(deposit)} deposit`}
        </PrimaryButton>

        {error && (
          <p id="schedule-airport-error" role="alert" aria-live="polite" className="glass-panel form-summary-alert" style={{ marginTop: 14, padding: 12, borderRadius: 12, background: 'rgba(217,45,32,0.10)', color: 'var(--danger)', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
            {error}
          </p>
        )}
      </div>
      <BottomTabs active="schedule" onChange={(id) => navigate(id === 'home' || id === 'rides' ? 'home' : id)} />
      <SignInToBookModal open={promptOpen} onClose={() => setPromptOpen(false)} nextPath="schedule" />
    </div>
  )
}
