import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { CampusMap, CLEMSON, STADIUM } from '../components/CampusMap'
import { navigate, shareUrl } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { createLocationShare, startSharingLocation } from '../lib/locationShare'
import { subscribeDriverStatus } from '../lib/driverTrack'
import { supabase } from '../lib/supabase'
import { hasRatedTrip } from '../lib/ratings'
import { RideChat, RideMessageButton } from '../components/RideChat'
import { rideChatMode } from '../lib/tripChatRules'
import { SosControl } from '../components/SosControl'
import { isActiveRideStatus } from '../lib/sosAlert'
import { MidrideCancelSheet } from '../components/MidrideCancelSheet'
import { isMidrideStatus } from '../lib/tripPhase'
import { CounterpartChip } from '../components/CounterpartChip'
import { PARTY_VISIBLE_STATUSES } from '../../packages/rides-native/partyProfile.js'
import { etaHoldLine, etaLineFor, riderLiveView, SEARCH_PREVIEW_COPY, showSearchTheater } from '../../packages/rides-native/liveTrip.js'
import { LivePhase } from '../components/LivePhase'

export function Requested({ dest = 'GSP Airport', trip = '', driver = 'your driver', driverId = '', paid = '' }) {
  const { user } = useAuth()
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tripRow, setTripRow] = useState(null)
  const [tripMissing, setTripMissing] = useState(false)
  const [driverPos, setDriverPos] = useState(null)
  const [resolvedDriverId, setResolvedDriverId] = useState(driverId || '')
  const [rateNudge, setRateNudge] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const stopRef = useRef(null)
  const ratedCheck = useRef(false)

  useEffect(() => () => { stopRef.current?.() }, [])

  useEffect(() => {
    if (!trip) return undefined
    const tripIdOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trip)
    if (!tripIdOk) {
      setError('That trip link is not valid.')
      setTripMissing(true)
      return undefined
    }
    if (!supabase) {
      setError('Live updates need Supabase. This screen cannot load the trip.')
      setTripMissing(true)
      return undefined
    }
    let alive = true
    async function load() {
      const { data } = await supabase
        .from('trips')
        .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, completed_at, canceled_at, requested_at')
        .eq('id', trip)
        .maybeSingle()
      if (!alive) return
      if (!data) {
        setTripMissing(true)
        return
      }
      setTripMissing(false)
      setTripRow(data)
      if (data.driver_id) setResolvedDriverId(data.driver_id)
      if (data.status === 'completed' && user?.id && !ratedCheck.current) {
        ratedCheck.current = true
        const rated = await hasRatedTrip(data.id, user.id)
        if (alive && !rated) setRateNudge(true)
      }
    }
    load()
    const channel = supabase
      .channel(`requested-trip-${trip}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${trip}` },
        () => { load() },
      )
      .subscribe()
    const timer = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [trip, user?.id])

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
  const chatMode = rideChatMode(tripRow)
  const showMessages = Boolean(user?.id && tripRow?.driver_id && tripRow?.rider_id && chatMode !== 'closed')
  const rideLive = isActiveRideStatus(status)
  const devSosPreview = import.meta.env.DEV && typeof window !== 'undefined'
    && window.location.hash.includes('sos=preview')
  const pickup =
    tripRow?.pickup_lat != null && tripRow?.pickup_lng != null
      ? [Number(tripRow.pickup_lat), Number(tripRow.pickup_lng)]
      : STADIUM
  const namedDriver = driver && driver !== 'your driver'
  const preferred = status === 'requested' || (!status && namedDriver) || (status === 'canceled' && namedDriver)
  const requestedAt = tripRow?.requested_at ? new Date(tripRow.requested_at).getTime() : null
  const waitingMs = requestedAt && Number.isFinite(requestedAt) ? Date.now() - requestedAt : 0
  const phase = !trip
    ? {
      kicker: 'LIVE RIDE',
      title: 'No trip to track',
      body: 'Request a ride from the map or Schedule. This screen follows a real trip once it exists.',
      steps: [],
      stepIndex: -1,
    }
    : !tripRow && !tripMissing
      ? {
        kicker: 'LIVE RIDE',
        title: 'Checking this ride',
        body: 'Status updates as soon as the trip loads.',
        steps: [],
        stepIndex: -1,
      }
      : riderLiveView(status, { preferred, waitingMs })
  const driverFix = driverPos ? { lat: driverPos[0], lng: driverPos[1] } : null
  const etaLine = etaHoldLine(status, etaLineFor(status, driverFix, tripRow))
  const showMap = Boolean(trip) || Boolean(status) || preferred
  const preview = showSearchTheater(status) && !driverPos

  return (
    <div className="fade-in" style={{ minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
      {(rideLive || devSosPreview) && (
        <SosControl
          tripId={trip || '00000000-0000-4000-8000-000000000001'}
          viewerRole="rider"
          knownActive
        />
      )}
      {showMap && (
        <div className="glass-panel" style={{ borderRadius: 20, overflow: 'hidden', height: 220 }}>
          {/* TODO: road-following tiles need a billed Maps key (VITE_GOOGLE_MAPS_API_KEY). Status, progress, and straight-line ETA stay on the card. */}
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
        {paid === '1' && trip && !tripMissing && (status === 'searching' || status === 'offered' || !status) && (
          <p style={{ color: '#522D80', fontWeight: 700, fontSize: 13, lineHeight: 1.45, marginTop: 0 }}>
            Stripe Checkout sent you back. This ride is in the open pool. The deposit shows up when Stripe confirms it.
          </p>
        )}
        {tripMissing && (
          <p style={{ color: '#522D80', fontWeight: 700, fontSize: 14, lineHeight: 1.45 }}>
            {error || 'This trip is not on your account. Request a ride again if you still need a driver.'}
          </p>
        )}
        <LivePhase
          kicker={phase.kicker}
          title={tripMissing ? 'No live trip' : phase.title}
          body={tripMissing ? 'There is no matching ride to track on this screen.' : phase.body}
          eta={tripMissing ? null : etaLine}
          steps={tripMissing ? [] : phase.steps}
          activeIndex={tripMissing ? -1 : phase.stepIndex}
        />
        {preview && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 13, lineHeight: 1.45, marginTop: 10 }}>
            {SEARCH_PREVIEW_COPY}
          </p>
        )}
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45, marginTop: 12 }}>
          {driver} · {tripRow?.pickup_label || 'Pickup'} → {dest || tripRow?.dropoff_label || 'Drop-off'}.
          {trip ? ` ID ${String(trip).slice(0, 8)}…` : ''}
        </p>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={onShare} disabled={busy || !trip || tripMissing}>
            {busy ? 'Starting…' : share ? 'Sharing — tap to refresh link' : 'Share my location'}
          </PrimaryButton>
          {share?.token && (
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', wordBreak: 'break-all' }}>
              {shareUrl(share.token)}
            </p>
          )}
          {showMessages && (
            <RideMessageButton readOnly={chatMode !== 'compose'} onClick={() => setChatOpen(true)} />
          )}
          {resolvedDriverId && PARTY_VISIBLE_STATUSES.includes(status) && (
            <CounterpartChip
              profileId={resolvedDriverId}
              noun="driver"
              onOpen={() => navigate('profile', { id: resolvedDriverId, matched: '1' })}
            />
          )}
          {status === 'completed' && trip && (
            <button
              type="button"
              className="pressable"
              data-testid="post-ride-lost-found"
              onClick={() => navigate('lost-found', { trip })}
              style={{ fontWeight: 700, color: 'var(--orange)', padding: '4px 0' }}
            >
              Left something in the car?
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
          {isMidrideStatus(status) && trip && (
            <button
              type="button"
              className="pressable"
              onClick={() => setCancelOpen(true)}
              style={{ fontWeight: 700, color: 'var(--danger, #b42318)', padding: '4px 0' }}
            >
              Cancel this ride
            </button>
          )}
          <PrimaryButton onClick={() => navigate('home')}>Back home</PrimaryButton>
        </div>
        {error && !tripMissing && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>
      {chatOpen && user?.id && tripRow && (
        <RideChat
          tripId={tripRow.id}
          userId={user.id}
          initialTrip={tripRow}
          onClose={() => setChatOpen(false)}
        />
      )}
      {cancelOpen && trip && (
        <MidrideCancelSheet
          tripId={trip}
          onClose={() => setCancelOpen(false)}
          onCanceled={() => {
            setCancelOpen(false)
            setTripRow((row) => (row ? { ...row, status: 'canceled' } : row))
          }}
        />
      )}
    </div>
  )
}
