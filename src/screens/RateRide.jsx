import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import {
  fetchTripForRating,
  submitRating,
  hasRatedTrip,
  fetchProfile,
  saveSafetyCheck,
} from '../lib/ratings'
import { PrimaryButton } from '../components/PrimaryButton'
import { RequireAuth } from '../components/RequireAuth'
import { displayFirstName } from '../lib/privacyDisplay'
import { maskCompletedTripForDriver, AREA_RADIUS_METERS } from '../lib/tripPrivacy'
import { buildReceiptText, shareReceipt, money } from '../lib/receiptText'
import { supabase } from '../lib/supabase'
import { loadStripeJs } from '../lib/stripeElements'
import { CampusMap } from '../components/CampusMap'

const TIP_CHIPS = [200, 300, 500, 800]
const SAFETY_DELAY_MS = 45000

function pair(lat, lng) {
  if (lat == null || lng == null) return null
  const a = Number(lat)
  const b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [a, b]
}

function RateForm() {
  const { user } = useAuth()
  const { params } = getHashRoute()
  const tripId = params.trip
  const [trip, setTrip] = useState(null)
  const [counterpart, setCounterpart] = useState(null)
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [error, setError] = useState(null)
  const [rated, setRated] = useState(false)
  const [already, setAlready] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tipCents, setTipCents] = useState(300)
  const [customTip, setCustomTip] = useState('')
  const [tipBusy, setTipBusy] = useState(false)
  const [tipMsg, setTipMsg] = useState(null)
  const [tipError, setTipError] = useState(null)
  const [clientSecret, setClientSecret] = useState(null)
  const payMount = useRef(null)
  const [shareMsg, setShareMsg] = useState(null)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [safety, setSafety] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (!tripId || !user?.id) return undefined
    let alive = true
    ;(async () => {
      try {
        const t = await fetchTripForRating(tripId)
        if (!alive) return
        setTrip(t)
        if (!t) {
          setError('Trip not found')
          return
        }
        if (t.safety_status) setSafety(t.safety_status)
        if (Number(t.tip_cents) > 0) setTipMsg(`Tip added · ${money(t.tip_cents)}`)
        const ratedAlready = await hasRatedTrip(tripId, user.id)
        if (!alive) return
        if (ratedAlready) {
          setAlready(true)
          setRated(true)
        }
        const rateeId = user.id === t.rider_id ? t.driver_id : t.rider_id
        if (rateeId) {
          const p = await fetchProfile(rateeId, { viewerId: user.id, assumeMatched: true })
          if (alive) setCounterpart(p)
        }
      } catch (e) {
        if (alive) setError(e.message)
      }
    })()
    return () => {
      alive = false
    }
  }, [tripId, user?.id])

  const isRider = user?.id && trip?.rider_id === user.id
  const isDriver = user?.id && trip?.driver_id === user.id
  const viewTrip = useMemo(
    () => (isDriver ? maskCompletedTripForDriver(trip) : trip),
    [isDriver, trip],
  )

  useEffect(() => {
    if (!trip?.completed_at || trip.safety_status || !isRider) return undefined
    const elapsed = Date.now() - new Date(trip.completed_at).getTime()
    const wait = Math.max(0, SAFETY_DELAY_MS - elapsed)
    const timer = setTimeout(() => setSafetyOpen(true), wait)
    return () => clearTimeout(timer)
  }, [trip?.completed_at, trip?.safety_status, isRider])

  useEffect(() => {
    if (!clientSecret || !payMount.current) return undefined
    let dead = false
    let paymentElement
    ;(async () => {
      try {
        const stripe = await loadStripeJs()
        if (!stripe || dead) return
        const elements = stripe.elements({ clientSecret })
        paymentElement = elements.create('payment')
        paymentElement.mount(payMount.current)
        payMount.current._stripe = stripe
        payMount.current._elements = elements
      } catch (err) {
        if (!dead) setTipError(err.message || 'Card form unavailable')
      }
    })()
    return () => {
      dead = true
      try { paymentElement?.unmount() } catch { /* ignore */ }
    }
  }, [clientSecret])

  if (!tripId) return <div style={{ padding: 24 }}>Missing trip</div>
  if (!trip && !error) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>

  const rateeId = isRider ? trip?.driver_id : trip?.rider_id
  const who = displayFirstName(counterpart?.full_name, isRider ? 'Driver' : 'Rider')
  const label = isRider ? 'Rate your driver' : 'Rate your rider'
  const completed = trip?.status === 'completed'
  const receiptUrl = `${window.location.origin}${window.location.pathname}#/receipt?trip=${encodeURIComponent(tripId)}`
  const areas = isDriver && viewTrip?._addressMasked
    ? [
        viewTrip.pickup_lat != null && {
          id: 'pickup-area',
          lat: viewTrip.pickup_lat,
          lng: viewTrip.pickup_lng,
          radius: AREA_RADIUS_METERS,
          color: '#F56600',
        },
        viewTrip.dropoff_lat != null && {
          id: 'drop-area',
          lat: viewTrip.dropoff_lat,
          lng: viewTrip.dropoff_lng,
          radius: AREA_RADIUS_METERS,
          color: '#522D80',
        },
      ].filter(Boolean)
    : []

  async function onSubmit(e) {
    e.preventDefault()
    if (!completed) {
      setError('You can rate this trip once it is completed')
      return
    }
    if (!rateeId) {
      setError('No counterparty on this trip yet')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitRating({ tripId, raterId: user.id, rateeId, stars, comment })
      setRated(true)
    } catch (err) {
      setError(err.message || 'Could not submit rating')
    } finally {
      setBusy(false)
    }
  }

  async function onTip() {
    const cents = customTip.trim()
      ? Math.round(Number(customTip) * 100)
      : tipCents
    if (!Number.isFinite(cents) || cents < 100) {
      setTipError('Enter at least $1')
      return
    }
    setTipBusy(true)
    setTipError(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      const { data: session } = await supabase.auth.getSession()
      if (session?.session?.access_token) headers.Authorization = `Bearer ${session.session.access_token}`
      const res = await fetch('/api/trip-tip', {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripId, tipCents: cents, mode: 'charge' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || 'Tip failed')
      if (data.ok) {
        setTipMsg(`Tip added · ${money(data.tipCents)}`)
        setTrip((t) => ({ ...t, tip_cents: data.tipCents }))
        setClientSecret(null)
        return
      }
      if (data.clientSecret) {
        setClientSecret(data.clientSecret)
        setTipMsg(null)
        return
      }
      throw new Error('Tip was not confirmed')
    } catch (err) {
      setTipError(err.message || 'Tip failed')
    } finally {
      setTipBusy(false)
    }
  }

  async function confirmCardTip() {
    const stripe = payMount.current?._stripe
    const elements = payMount.current?._elements
    if (!stripe || !elements) return
    setTipBusy(true)
    setTipError(null)
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: receiptUrl },
      })
      if (result.error) throw new Error(result.error.message)
      const headers = { 'Content-Type': 'application/json' }
      const { data: session } = await supabase.auth.getSession()
      if (session?.session?.access_token) headers.Authorization = `Bearer ${session.session.access_token}`
      const res = await fetch('/api/trip-tip', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tripId,
          mode: 'finalize',
          paymentIntentId: result.paymentIntent?.id,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not record tip')
      setTipMsg(`Tip added · ${money(data.tipCents)}`)
      setTrip((t) => ({ ...t, tip_cents: data.tipCents }))
      setClientSecret(null)
    } catch (err) {
      setTipError(err.message || 'Card tip failed')
    } finally {
      setTipBusy(false)
    }
  }

  async function onShare() {
    setShareMsg(null)
    try {
      const how = await shareReceipt(trip, { forDriver: Boolean(isDriver), url: receiptUrl })
      if (how === 'copied') setShareMsg('Receipt copied')
      else if (how === 'shared') setShareMsg('Receipt shared')
      else if (how === 'mailto') setShareMsg('Opening email')
      else if (how === 'dismissed') setShareMsg(null)
    } catch (err) {
      setShareMsg(err.message || 'Could not share')
    }
  }

  async function onSafety(status) {
    setSafety(status)
    if (status === 'help') setHelpOpen(true)
    else setHelpOpen(false)
    await saveSafetyCheck(tripId, status)
  }

  const pickup = isDriver ? null : pair(trip?.pickup_lat, trip?.pickup_lng)
  const drop = isDriver ? null : pair(trip?.dropoff_lat, trip?.dropoff_lng)

  return (
    <div className="fade-in" data-screen="post-ride" style={{ padding: 20, maxWidth: 440, margin: '0 auto' }}>
      <div
        className="glass-panel glass-panel--elevated"
        style={{
          padding: 20,
          borderRadius: 24,
          background: 'linear-gradient(165deg, rgba(255,255,255,0.9), rgba(82,45,128,0.08), rgba(245,102,0,0.1))',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>
          TRIP COMPLETE
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)', marginTop: 4 }}>How was the ride?</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 6, fontSize: 14 }}>
          {viewTrip?.pickup_label || 'Pickup'} → {viewTrip?.dropoff_label || 'Dropoff'}
        </p>
        {!completed && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>
            This trip is not completed yet, so a rating cannot be saved.
          </p>
        )}

        {(areas.length > 0 || (pickup && drop)) && (
          <div style={{ marginTop: 14, borderRadius: 16, overflow: 'hidden', height: 160 }}>
            <CampusMap
              height={160}
              interactive={false}
              center={(areas[0] && [areas[0].lat, areas[0].lng]) || pickup}
              zoom={13}
              marker={null}
              areaCircles={areas}
              pickupPosition={pickup}
              dropoffPosition={drop}
              route={pickup && drop ? [pickup, drop] : null}
            />
          </div>
        )}
        {isDriver && areas.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 6 }}>
            General area only — street addresses are hidden after the trip.
          </p>
        )}

        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>{label}</h2>
          <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>
            Stars update their standing for future matches.
          </p>
          {counterpart && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: counterpart.avatar_url
                    ? `url(${counterpart.avatar_url}) center/cover`
                    : 'linear-gradient(135deg, var(--orange), var(--purple))',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                }}
              >
                {!counterpart.avatar_url && who.slice(0, 1)}
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{who}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>
                  {counterpart.rating_count
                    ? `★ ${Number(counterpart.rating_avg || 0).toFixed(1)} · ${counterpart.rating_count} ratings`
                    : 'No ratings yet'}
                  {counterpart.standing === 'watch' ? ' · Low rating' : ''}
                </div>
              </div>
            </div>
          )}

          {rated ? (
            <p style={{ marginTop: 14, fontWeight: 700, color: 'var(--purple)' }}>
              {already ? 'You already rated this trip.' : 'Rating saved. Their average updates immediately.'}
            </p>
          ) : (
            <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'center' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="pressable"
                    onClick={() => setStars(n)}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 14,
                      fontSize: 22,
                      background: n <= stars ? 'var(--orange)' : 'rgba(0,0,0,0.06)',
                      color: n <= stars ? '#fff' : 'var(--ink-secondary)',
                      boxShadow: n <= stars ? '0 6px 16px rgba(245,102,0,0.35)' : 'none',
                    }}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional comment"
                rows={3}
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 14,
                  border: '1px solid var(--border)',
                  marginBottom: 12,
                  background: 'rgba(255,255,255,0.7)',
                }}
              />
              {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{error}</p>}
              <PrimaryButton disabled={busy || !completed} type="submit">
                {busy ? 'Saving…' : 'Submit rating'}
              </PrimaryButton>
            </form>
          )}
        </section>

        {isRider && (
          <section style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>Add a tip</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '4px 0 10px' }}>
              100% goes to {who}. Charged to your saved card when you have one.
            </p>
            {tipMsg ? (
              <p style={{ fontWeight: 700, color: 'var(--success, #1F8A4C)' }}>{tipMsg}</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {TIP_CHIPS.map((cents) => (
                    <button
                      key={cents}
                      type="button"
                      className="pressable"
                      onClick={() => { setTipCents(cents); setCustomTip('') }}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 999,
                        fontWeight: 700,
                        background: tipCents === cents && !customTip ? 'var(--orange)' : 'rgba(255,255,255,0.7)',
                        color: tipCents === cents && !customTip ? '#fff' : 'var(--purple)',
                        border: '1px solid rgba(82,45,128,0.15)',
                      }}
                    >
                      {money(cents)}
                    </button>
                  ))}
                </div>
                <label style={{ display: 'block', marginTop: 10, fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
                  Custom amount
                  <input
                    inputMode="decimal"
                    placeholder="5.00"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                    style={{
                      display: 'block',
                      width: '100%',
                      marginTop: 4,
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                    }}
                  />
                </label>
                {tipError && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{tipError}</p>}
                <div style={{ marginTop: 10 }}>
                  <PrimaryButton onClick={onTip} disabled={tipBusy || !completed}>
                    {tipBusy ? 'Charging…' : 'Add tip'}
                  </PrimaryButton>
                </div>
                {clientSecret && (
                  <div style={{ marginTop: 12 }}>
                    <div ref={payMount} />
                    <div style={{ marginTop: 10 }}>
                      <PrimaryButton variant="purple" onClick={confirmCardTip} disabled={tipBusy}>
                        Confirm card tip
                      </PrimaryButton>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <section style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>Share receipt</h2>
          <pre style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 13,
            background: 'rgba(255,255,255,0.65)',
            borderRadius: 14,
            padding: 12,
            marginTop: 8,
          }}
          >
            {buildReceiptText(trip, { forDriver: Boolean(isDriver) })}
          </pre>
          <PrimaryButton variant="purple" onClick={onShare}>Share receipt</PrimaryButton>
          <button
            type="button"
            className="pressable"
            onClick={() => navigate('receipt', { trip: tripId })}
            style={{ display: 'block', width: '100%', marginTop: 8, padding: 10, fontWeight: 700, color: 'var(--purple)' }}
          >
            Open receipt
          </button>
          {shareMsg && <p style={{ fontSize: 12, marginTop: 6, color: 'var(--ink-secondary)' }}>{shareMsg}</p>}
        </section>

        {isRider && (safetyOpen || safety) && (
          <section style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }} data-safety-check="1">
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)' }}>Did you arrive safely?</h2>
            {safety === 'ok' && !helpOpen ? (
              <p style={{ marginTop: 8, fontWeight: 600 }}>Glad you arrived safely.</p>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="pressable"
                  onClick={() => onSafety('ok')}
                  style={{
                    flex: 1, padding: 12, borderRadius: 14, fontWeight: 700, color: '#fff',
                    background: 'var(--success, #1F8A4C)',
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="pressable"
                  onClick={() => onSafety('help')}
                  style={{
                    flex: 1, padding: 12, borderRadius: 14, fontWeight: 700, color: '#fff',
                    background: 'var(--orange)',
                  }}
                >
                  Need help
                </button>
              </div>
            )}
            {helpOpen && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a href="tel:911" style={{ fontWeight: 800, color: 'var(--danger)' }}>Call 911</a>
                <a href="tel:8646562222" style={{ fontWeight: 700, color: 'var(--purple)' }}>
                  Clemson University Police · (864) 656-2222
                </a>
                <a
                  href={`mailto:rides@clemson.edu?subject=${encodeURIComponent('Safety check-in')}&body=${encodeURIComponent(`Trip ${tripId}\nI need help after my ride.`)}`}
                  style={{ fontWeight: 700, color: 'var(--purple)' }}
                >
                  Email support
                </a>
                <button
                  type="button"
                  className="pressable"
                  onClick={() => navigate('account', { tab: 'help' })}
                  style={{ fontWeight: 700, color: 'var(--purple)', textAlign: 'left' }}
                >
                  Open Help in the app
                </button>
              </div>
            )}
          </section>
        )}

        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            className="pressable"
            onClick={() => navigate(isDriver ? 'driver' : 'home')}
            style={{ width: '100%', padding: 12, fontWeight: 700, color: 'var(--ink-secondary)' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export function RateRide() {
  return (
    <RequireAuth>
      <RateForm />
    </RequireAuth>
  )
}
