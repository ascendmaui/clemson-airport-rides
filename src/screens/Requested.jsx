import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { CampusMap, CLEMSON, STADIUM } from '../components/CampusMap'
import { MidrideCancelSheet } from '../components/MidrideCancelSheet'
import { navigate, shareUrl } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { createLocationShare, revokeLocationShare, startSharingLocation } from '../lib/locationShare'
import { subscribeDriverStatus } from '../lib/driverTrack'
import { supabase } from '../lib/supabase'
import { hasRatedTrip } from '../lib/ratings'
import { formatMidrideMoney, isPaymentRequired, paymentRequiredMessage } from '../lib/midrideCancel'
import { pushToast } from '../lib/toasts'
import { isMidrideStatus, isTripSurfaceFrozen, isTripSurfaceLive, tripStatusLabel } from '../lib/tripPhase'

const TRIP_COLUMNS = 'id, status, driver_id, rider_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, fare_cents, metadata, canceled_at'

export function Requested({ dest = 'GSP Airport', trip = '', driver = 'your driver', driverId = '' }) {
  const { user } = useAuth()
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tripRow, setTripRow] = useState(null)
  const [driverPos, setDriverPos] = useState(null)
  const [resolvedDriverId, setResolvedDriverId] = useState(driverId || '')
  const [rateNudge, setRateNudge] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [tripStarted, setTripStarted] = useState(false)
  const [draft, setDraft] = useState('')
  const [sentNotes, setSentNotes] = useState([])
  const stopRef = useRef(null)

  useEffect(() => () => { stopRef.current?.() }, [])

  useEffect(() => {
    if (!supabase || !trip) return undefined
    let alive = true
    async function pull() {
      const { data } = await supabase.from('trips').select(TRIP_COLUMNS).eq('id', trip).maybeSingle()
      if (!alive || !data) return
      setTripRow(data)
      if (data.driver_id) setResolvedDriverId(data.driver_id)
      if (data.status === 'in_progress') {
        setTripStarted(true)
      } else if (data.status === 'arrived' || data.status === 'arriving') {
        const { data: ev } = await supabase
          .from('trip_events')
          .select('id')
          .eq('trip_id', trip)
          .eq('kind', 'in_progress')
          .limit(1)
        if (alive) setTripStarted(Boolean(ev?.length))
      } else if (alive) {
        setTripStarted(false)
      }
      if (data.status === 'completed' && user?.id) {
        const rated = await hasRatedTrip(data.id, user.id)
        if (alive && !rated) setRateNudge(true)
      }
      if (isTripSurfaceFrozen(data.status)) {
        stopRef.current?.()
        stopRef.current = null
      }
    }
    pull()
    const channel = supabase
      .channel(`requested-trip-${trip}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${trip}` },
        () => { pull() },
      )
      .subscribe()
    const poll = setInterval(pull, 8000)
    return () => {
      alive = false
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [trip, user?.id])

  useEffect(() => {
    if (!resolvedDriverId) return undefined
    const status = tripRow?.status
    if (status && isTripSurfaceFrozen(status)) return undefined
    return subscribeDriverStatus(resolvedDriverId, (loc) => {
      setDriverPos([loc.lat, loc.lng])
    })
  }, [resolvedDriverId, tripRow?.status])

  async function onShare() {
    if (!trip || !user?.id) {
      setError('Sign in with an active trip to share location')
      return
    }
    if (isTripSurfaceFrozen(tripRow?.status)) {
      setError('Location sharing is closed for this trip')
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

  function onSendNote(e) {
    e.preventDefault()
    if (frozen) return
    const text = draft.trim()
    if (!text) return
    setSentNotes((prev) => [...prev, text])
    setDraft('')
  }

  const status = tripRow?.status || ''
  const live = isTripSurfaceLive(status)
  const frozen = Boolean(status) && isTripSurfaceFrozen(status)
  const midride = isMidrideStatus(status)
  const canCancelMidride = status === 'in_progress' || (status === 'arrived' && tripStarted)
  const trackLive = live || Boolean(resolvedDriverId)
  const quote = tripRow?.metadata?.midride_cancel
  const pickup =
    tripRow?.pickup_lat != null && tripRow?.pickup_lng != null
      ? [Number(tripRow.pickup_lat), Number(tripRow.pickup_lng)]
      : STADIUM

  return (
    <div className="fade-in" style={{ minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16, position: 'relative' }}>
      {trackLive && (
        <div className="glass-panel" style={{ borderRadius: 20, overflow: 'hidden', height: 220 }} data-tracking-frozen={frozen ? '1' : '0'}>
          <CampusMap
            height={220}
            interactive={!frozen}
            center={driverPos || pickup || CLEMSON}
            zoom={14}
            marker={pickup}
            pickupPosition={pickup}
            driverPosition={frozen ? null : driverPos}
            animateDriver={Boolean(driverPos) && !frozen}
          />
        </div>
      )}
      <div className="glass-panel glass-panel--elevated" style={{ padding: 24, borderRadius: 20 }}>
        <div style={{ fontSize: 13, letterSpacing: 1.4, fontWeight: 700, color: 'var(--orange)', marginBottom: 8 }}>
          {midride ? 'CANCELED MID-RIDE' : 'REQUESTED'}
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>
          {midride ? 'Ride canceled' : `${driver} is on the list`}
        </h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45 }}>
          Trip toward {dest}.
          {trip ? ` ID ${String(trip).slice(0, 8)}…` : ''}
          {status ? ` · ${tripStatusLabel(status)}` : ''}
        </p>
        {midride && (
          <div style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(245,102,0,0.16), rgba(82,45,128,0.12))',
            color: 'var(--purple)',
            fontWeight: 700,
            fontSize: 14,
            lineHeight: 1.4,
          }}>
            This ride is closed. Tracking and chat are off.
            {quote?.obligationCents != null ? ` Charge ${formatMidrideMoney(quote.obligationCents)}.` : ''}
            {isPaymentRequired(quote) ? ` ${paymentRequiredMessage(quote)}` : ''}
          </div>
        )}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={onShare} disabled={busy || !trip || !live}>
            {frozen ? 'Location sharing ended' : busy ? 'Starting…' : share ? 'Sharing — tap to refresh link' : 'Share my location'}
          </PrimaryButton>
          {share?.token && live && (
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', wordBreak: 'break-all' }}>
              {shareUrl(share.token)}
            </p>
          )}
          {canCancelMidride && (
            <button
              type="button"
              className="pressable"
              onClick={() => setConfirmCancel(true)}
              style={{
                width: '100%',
                padding: 14,
                borderRadius: 16,
                fontWeight: 800,
                color: 'var(--purple)',
                background: 'rgba(255,255,255,0.7)',
                border: '1.5px solid rgba(245,102,0,0.55)',
              }}
            >
              Cancel ride
            </button>
          )}
          {(live || frozen) && (
            <form onSubmit={onSendNote} data-composer-frozen={frozen ? '1' : '0'}>
              <label htmlFor="trip-composer" style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>
                Message driver
              </label>
              {sentNotes.map((note, i) => (
                <div key={`${i}-${note}`} style={{ fontSize: 13, marginTop: 6, color: 'var(--ink-secondary)' }}>{note}</div>
              ))}
              <textarea
                id="trip-composer"
                value={draft}
                disabled={frozen}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={frozen ? 'Chat closed — this trip has ended' : 'Message stays with this trip'}
                style={{
                  width: '100%',
                  marginTop: 6,
                  borderRadius: 12,
                  padding: 10,
                  border: '1px solid rgba(82,45,128,0.2)',
                  resize: 'none',
                  background: frozen ? 'rgba(11,18,32,0.04)' : '#fff',
                }}
              />
              <button
                type="submit"
                className="pressable"
                disabled={frozen || !draft.trim()}
                style={{ marginTop: 6, fontWeight: 700, color: 'var(--purple)' }}
              >
                {frozen ? 'Composer frozen' : 'Send'}
              </button>
            </form>
          )}
          {resolvedDriverId && live && (
            <button type="button" className="pressable" onClick={() => navigate('profile', { id: resolvedDriverId, matched: '1' })} style={{ fontWeight: 600, color: 'var(--purple)' }}>
              View driver profile
            </button>
          )}
          {rateNudge && trip && !midride && (
            <div className="glass-panel" style={{ padding: 12, borderRadius: 14, background: 'rgba(245,102,0,0.12)' }}>
              <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 6, fontSize: 13 }}>Trip complete — rate your driver?</div>
              <PrimaryButton onClick={() => navigate('rate', { trip })}>Rate now ★</PrimaryButton>
              <button type="button" className="pressable" onClick={() => setRateNudge(false)} style={{ marginTop: 8, fontWeight: 600, color: 'var(--ink-tertiary)', width: '100%' }}>
                Soft remind later
              </button>
            </div>
          )}
          <PrimaryButton onClick={() => navigate('home')}>Back home</PrimaryButton>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>
      {confirmCancel && trip && (
        <MidrideCancelSheet
          tripId={trip}
          onClose={() => setConfirmCancel(false)}
          onCanceled={async (data) => {
            setConfirmCancel(false)
            stopRef.current?.()
            stopRef.current = null
            if (share?.id) revokeLocationShare(share.id).catch(() => {})
            setShare(null)
            setTripRow((prev) => ({
              ...(prev || {}),
              id: trip,
              status: data.status || 'canceled_midride',
              metadata: { ...(prev?.metadata || {}), midride_cancel: data.quote },
            }))
            if (isPaymentRequired(data.quote)) {
              pushToast({
                id: `pay-required-${trip}`,
                kind: 'payment_required',
                force: true,
                title: 'Payment required',
                body: paymentRequiredMessage(data.quote),
              })
            }
          }}
        />
      )}
    </div>
  )
}
