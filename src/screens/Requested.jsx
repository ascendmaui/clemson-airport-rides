import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { WaitFeeCard } from '../components/WaitFeeCard'
import { CampusMap, CLEMSON, STADIUM } from '../components/CampusMap'
import { navigate, shareUrl } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { createLocationShare, startSharingLocation } from '../lib/locationShare'
import { subscribeDriverStatus } from '../lib/driverTrack'
import { supabase } from '../lib/supabase'
import { hasRatedTrip } from '../lib/ratings'
import { useTripWait } from '../lib/useTripWait'

export function Requested({ dest = 'GSP Airport', trip = '', driver = 'your driver', driverId = '' }) {
  const { user } = useAuth()
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tripRow, setTripRow] = useState(null)
  const [driverPos, setDriverPos] = useState(null)
  const [resolvedDriverId, setResolvedDriverId] = useState(driverId || '')
  const [rateNudge, setRateNudge] = useState(false)
  const stopRef = useRef(null)

  useEffect(() => () => { stopRef.current?.() }, [])

  useEffect(() => {
    if (!supabase || !trip) return undefined
    let alive = true
    supabase
      .from('trips')
      .select('id, status, driver_id, rider_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, arrived_at, wait_fee_cents, cancel_fee_cents, platform_fee_cents, driver_wait_earnings_cents, wait_cancel_reason, canceled_at')
      .eq('id', trip)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!alive || !data) return
        setTripRow(data)
        if (data.driver_id) setResolvedDriverId(data.driver_id)
        if (data.status === 'completed' && user?.id) {
          const rated = await hasRatedTrip(data.id, user.id)
          if (alive && !rated) setRateNudge(true)
        }
      })
    const channel = supabase
      .channel(`requested-trip-${trip}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${trip}` },
        (payload) => {
          if (payload.new) setTripRow((prev) => ({ ...(prev || {}), ...payload.new }))
        },
      )
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [trip, user?.id])

  const wait = useTripWait(tripRow, (next) => {
    setTripRow((prev) => (prev && next && prev.id === next.id ? { ...prev, ...next } : next))
  })

  useEffect(() => {
    if (!resolvedDriverId) return undefined
    return subscribeDriverStatus(resolvedDriverId, (loc) => {
      setDriverPos([loc.lat, loc.lng])
    })
  }, [resolvedDriverId])

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
  const trackLive = ['accepted', 'arriving', 'arrived', 'in_progress'].includes(status) || Boolean(resolvedDriverId)
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
        <WaitFeeCard
          trip={tripRow}
          quote={wait.quote}
          role="rider"
          error={wait.error}
          charge={wait.charge}
        />
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
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  )
}
