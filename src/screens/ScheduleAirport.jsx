import { useEffect, useMemo, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import { SurgeBadge } from '../components/SurgeBadge'
import {
  AIRPORT_RATES,
  getStripeConfig,
} from '../lib/stripeCheckout'
import { formatUsdFromCents, priceAirportRide } from '../lib/pricing'
import { startAirportCheckout, fetchCredits } from '../lib/billingApi'
import { applyCreditLots, cardDepositCents, finalizeSettlement } from '../lib/fareRates'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { isClemsonEmail } from '../lib/studentDomain'

function isStudentRider(user) {
  return Boolean(user?.email && isClemsonEmail(user.email))
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
  const [priced, setPriced] = useState(null)
  const [useCredits, setUseCredits] = useState(true)
  const [creditLots, setCreditLots] = useState([])
  const [creditNote, setCreditNote] = useState(null)
  const returnFlags = useMemo(() => getHashRoute().params, [])

  const rate = AIRPORT_RATES[airport]
  const stripe = getStripeConfig()
  const fareCents = priced?.fareCents ?? rate.fareCents
  const creditPreview = useCredits && creditLots.length
    ? finalizeSettlement(applyCreditLots(fareCents, creditLots))
    : null
  const deposit = creditPreview
    ? cardDepositCents(creditPreview.cashCents)
    : (priced?.depositCents ?? Math.round(fareCents * 0.25))

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    fetchCredits()
      .then((data) => { if (alive) setCreditLots(data.lots || []) })
      .catch(() => { if (alive) setCreditLots([]) })
    return () => { alive = false }
  }, [user?.id])

  useEffect(() => {
    let alive = true
    const at = date ? new Date(`${date}T${time || '12:00'}:00`) : new Date()
    priceAirportRide({
      airport,
      isStudent: isStudentRider(user),
      at: Number.isNaN(at.getTime()) ? new Date() : at,
    })
      .then((q) => { if (alive) setPriced(q) })
      .catch(() => { if (alive) setPriced(null) })
    return () => { alive = false }
  }, [airport, date, time, user])

  const onBook = async () => {
    setBusy(true)
    setError(null)
    setCreditNote(null)
    try {
      const session = await startAirportCheckout({
        airport,
        date,
        time,
        useCredits,
      })
      if (session.paidWithCredits) {
        setCreditNote(`Ride covered with credits. Trip ${session.tripId} is searching for a driver.`)
        return
      }
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
          Metered fare · 25% deposit holds your ride
          {isStudentRider(user) ? ' · 10% Clemson student discount on Standard' : ''}
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
                {airport === a.code ? formatUsdFromCents(fareCents) : formatUsdFromCents(a.fareCents)}
              </div>
            </button>
          ))}
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Date</label>
        <input type="date" className="glass-input" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }} />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time</label>
        <input type="time" className="glass-input" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: '100%', marginTop: 6, marginBottom: 20, padding: '12px 14px', borderRadius: 12 }} />

        <div className="glass-panel glass-panel--elevated" style={{ padding: 16, borderRadius: 16, marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}><SurgeBadge surge={priced?.surge} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Fare</span>
            <strong>{formatUsdFromCents(fareCents)}</strong>
          </div>
          {priced?.discountCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--ink-secondary)' }}>Student discount</span>
              <strong>−{formatUsdFromCents(priced.discountCents)}</strong>
            </div>
          )}
          {creditPreview?.creditDiscountCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--ink-secondary)' }}>Prepaid credit discount</span>
              <strong>−{formatUsdFromCents(creditPreview.creditDiscountCents)}</strong>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--ink-secondary)' }}>25% deposit</span>
            <strong style={{ color: 'var(--orange)' }}>{formatUsdFromCents(deposit)}</strong>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13 }}>
            <input type="checkbox" checked={useCredits} onChange={(e) => setUseCredits(e.target.checked)} />
            Apply ride credits to this fare (pack discount, then 20% platform / 80% driver)
          </label>
          <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 10 }}>
            {rate.code} · base $1.19 + $2.65 booking + $1.14/mi + $0.18/min, min $5.90
            {priced?.surge?.multiplier > 1 ? ` · ${priced.surge.rule?.label || 'Surge'} ${priced.surge.multiplier}×` : ''}
            {stripe.configured ? ' · Stripe ready' : ' · set VITE_STRIPE_PUBLISHABLE_KEY'}
          </p>
        </div>

        <PrimaryButton className="primary-cta" onClick={onPayClick} disabled={busy}>
          {busy ? 'Starting checkout…' : deposit > 0 ? `Pay ${formatUsdFromCents(deposit)} deposit` : 'Book with credits'}
        </PrimaryButton>

        {creditNote && (
          <p className="glass-panel" style={{ marginTop: 14, padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
            {creditNote}
          </p>
        )}

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
