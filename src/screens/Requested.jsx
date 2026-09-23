import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { CampusMap, CLEMSON, STADIUM } from '../components/CampusMap'
import { navigate, shareUrl } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { createLocationShare, startSharingLocation } from '../lib/locationShare'
import { subscribeDriverStatus } from '../lib/driverTrack'
import { supabase } from '../lib/supabase'
import { hasRatedTrip } from '../lib/ratings'
import { PaymentFailedSheet } from '../components/PaymentFailedSheet'
import { settleTrip } from '../lib/payments'
import { failureResult } from '../../shared/paymentFailure.js'
import { pushToast } from '../lib/toasts'

const DEMO_CODES = {
  declined: 'card_declined',
  expired: 'expired_card',
  funds: 'insufficient_funds',
  removed: 'card_removed',
  credits: 'credits_exhausted',
}

export function Requested({ dest = 'GSP Airport', trip = '', driver = 'your driver', driverId = '', payfail = '' }) {
  const { user } = useAuth()
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tripRow, setTripRow] = useState(null)
  const [driverPos, setDriverPos] = useState(null)
  const [resolvedDriverId, setResolvedDriverId] = useState(driverId || '')
  const [rateNudge, setRateNudge] = useState(false)
  const [payFailure, setPayFailure] = useState(() => (
    DEMO_CODES[payfail] ? failureResult(DEMO_CODES[payfail], { amountCents: 4200, creditsBalanceCents: payfail === 'credits' ? 0 : 500, tripId: trip || 'demo' }) : null
  ))
  const [payNote, setPayNote] = useState(null)
  const stopRef = useRef(null)

  useEffect(() => {
    if (!DEMO_CODES[payfail]) return
    setPayFailure(failureResult(DEMO_CODES[payfail], {
      amountCents: 4200,
      creditsBalanceCents: payfail === 'credits' ? 0 : 500,
      tripId: trip || 'demo',
    }))
    setPayNote(null)
  }, [payfail, trip])

  useEffect(() => () => { stopRef.current?.() }, [])

  useEffect(() => {
    if (!supabase || !trip) return undefined
    let alive = true
    supabase
      .from('trips')
      .select('id, status, driver_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, metadata, fare_cents')
      .eq('id', trip)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!alive || !data) return
        setTripRow(data)
        if (data.metadata?.payment_hold?.status === 'payment_required') {
          setPayFailure(data.metadata.payment_hold)
        }
        if (data.driver_id) setResolvedDriverId(data.driver_id)
        if (data.status === 'completed' && user?.id) {
          const rated = await hasRatedTrip(data.id, user.id)
          if (alive && !rated) setRateNudge(true)
        }
      })
    return () => { alive = false }
  }, [trip, user?.id])

  useEffect(() => {
    if (!resolvedDriverId) return undefined
    return subscribeDriverStatus(resolvedDriverId, (loc) => {
      setDriverPos([loc.lat, loc.lng])
    })
  }, [resolvedDriverId])

  async function onCancelRide() {
    if (!trip) return
    setBusy(true)
    setError(null)
    try {
      const result = await settleTrip({ tripId: trip, action: 'cancel', feeKind: 'cancel_fee' })
      setTripRow((prev) => ({ ...(prev || {}), status: result.status || 'canceled' }))
      setPayFailure(null)
      pushToast({ kind: 'system', title: 'Ride canceled', body: result.reason === 'zero_due' ? 'No fee was due.' : 'Cancellation fee paid.', category: 'billing' })
    } catch (err) {
      const failure = err.failure || {
        code: 'charge_failed',
        message: err.message || 'Cancellation needs a successful payment.',
        alternatives: ['add_card', 'use_credits', 'retry'],
      }
      setPayFailure(failure)
      pushToast({ kind: 'payment_failed', title: 'Cancellation unpaid', body: failure.message, category: 'billing' })
    } finally {
      setBusy(false)
    }
  }

  async function onShare() {
    if (!trip || !user?.id) {
      setError('Sign in with an active trip to share location')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const s = await createLocationShare(trip, user.id)
      setShare(s)
      stopRef.current?.()
      stopRef.current = startSharingLocation({
        shareId: s.id,
        tripId: trip,
        onError: (e) => setError(e.message || 'GPS error'),
      })
      const url = s.url || shareUrl(s.token)
      if (navigator.share) {
        try {
          await navigator.share({ title: 'My Clemson RIDES location', url, text: 'Follow my live ride location' })
        } catch { /* user cancel */ }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      }
    } catch (e) {
      setError(e.message || 'Could not start share')
    } finally {
      setBusy(false)
    }
  }

  const status = tripRow?.status || ''
  const trackLive = ['accepted', 'arriving', 'in_progress'].includes(status) || Boolean(resolvedDriverId)
  const pickup =
    tripRow?.pickup_lat != null && tripRow?.pickup_lng != null
      ? [Number(tripRow.pickup_lat), Number(tripRow.pickup_lng)]
      : STADIUM

  return (
    <div className="fade-in" style={{ minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
      {trackLive && (
        <div className="glass-panel" style={{ borderRadius: 20, overflow: 'hidden', height: 220 }}>
          <CampusMap
            height={220}
            interactive
            center={driverPos || pickup || CLEMSON}
            zoom={14}
            marker={pickup}
            pickupPosition={pickup}
            driverPosition={driverPos}
            animateDriver={Boolean(driverPos)}
          />
        </div>
      )}
      <div className="glass-panel glass-panel--elevated" style={{ padding: 24, borderRadius: 20 }}>
        <div style={{ fontSize: 13, letterSpacing: 1.4, fontWeight: 700, color: 'var(--orange)', marginBottom: 8 }}>
          REQUESTED
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>
          {driver} is on the list
        </h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45 }}>
          Trip toward {dest}.
          {trip ? ` ID ${String(trip).slice(0, 8)}…` : ''}
          {status ? ` · ${status}` : ''}
        </p>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={onShare} disabled={busy || !trip}>
            {busy ? 'Starting…' : share ? 'Sharing — tap to refresh link' : 'Share my location'}
          </PrimaryButton>
          {share?.token && (
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', wordBreak: 'break-all' }}>
              {shareUrl(share.token)}
            </p>
          )}
          {resolvedDriverId && (
            <button type="button" className="pressable" onClick={() => navigate('profile', { id: resolvedDriverId, matched: '1' })} style={{ fontWeight: 600, color: 'var(--purple)' }}>
              View driver profile
            </button>
          )}
          {rateNudge && trip && (
            <div className="glass-panel" style={{ padding: 12, borderRadius: 14, background: 'rgba(245,102,0,0.12)' }}>
              <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 6, fontSize: 13 }}>Trip complete — rate your driver?</div>
              <PrimaryButton onClick={() => navigate('rate', { trip })}>Rate now ★</PrimaryButton>
              <button type="button" className="pressable" onClick={() => setRateNudge(false)} style={{ marginTop: 8, fontWeight: 600, color: 'var(--ink-tertiary)', width: '100%' }}>
                Soft remind later
              </button>
            </div>
          )}
          <PrimaryButton onClick={() => navigate('home')}>Back home</PrimaryButton>
          {trip && status && !['completed', 'canceled'].includes(status) && (
            <button type="button" className="pressable" onClick={onCancelRide} disabled={busy} style={{ fontWeight: 700, color: 'var(--ink-secondary)' }}>
              Cancel ride
            </button>
          )}
        </div>
        {payNote && <p style={{ color: 'var(--purple)', fontSize: 13, marginTop: 12 }}>{payNote}</p>}
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>
      <PaymentFailedSheet
        failure={payFailure}
        busy={busy}
        onRetry={async () => {
          if (DEMO_CODES[payfail] && !trip) {
            setPayNote('Retry is ready. Add a card or credits, then try the charge again.')
            return
          }
          if (!trip) return
          setBusy(true)
          try {
            await settleTrip({
              tripId: trip,
              action: tripRow?.status === 'in_progress' ? 'charge' : 'complete',
              feeKind: tripRow?.metadata?.payment_hold?.kind || 'balance',
              amountCents: payFailure?.amountDueCents,
            })
            setPayFailure(null)
            setPayNote('Payment succeeded.')
          } catch (err) {
            setPayFailure(err.failure || payFailure)
          } finally {
            setBusy(false)
          }
        }}
        onAddCard={() => navigate('account', { tab: 'billing' })}
        onUseCredits={async () => {
          if (!trip) {
            setPayNote('Use prepaid credits after you buy a pack in Billing, then retry.')
            return
          }
          setBusy(true)
          try {
            await settleTrip({
              tripId: trip,
              action: 'charge',
              feeKind: payFailure?.kind || 'balance',
              amountCents: payFailure?.amountDueCents,
              methods: ['credits', 'card'],
            })
            setPayFailure(null)
          } catch (err) {
            setPayFailure(err.failure || { ...payFailure, message: err.message })
          } finally {
            setBusy(false)
          }
        }}
        onBuyCredits={() => navigate('account', { tab: 'billing' })}
        onDismiss={() => setPayFailure(null)}
      />
    </div>
  )
}
