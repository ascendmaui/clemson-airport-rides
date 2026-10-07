import { trackingIssue, staleEtaLine, withTrackingTimeout, onTrackingResume } from '../../packages/rides-native/tracking.js'
import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { AccessibleAlert } from '../components/AccessibleAlert'
import { CampusMap, CLEMSON, STADIUM } from '../components/CampusMap'
import { navigate, shareUrl } from '../lib/navigation'
import { shouldPromptRiderTip } from '../lib/riderTip'
import { useAuth } from '../lib/auth'
import { createLocationShare, startSharingLocation } from '../lib/locationShare'
import { isLiveTrip, subscribeTripDriverLocation } from '../lib/liveDriverLocation'
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
import {
  etaHoldLine,
  orderedLiveStops,
  riderLiveView,
  SEARCH_APPROX_WAIT_NOTE,
  SEARCH_PREVIEW_COPY,
  searchingRidePreview,
  showSearchTheater,
  STILL_SEARCHING_COPY,
  STILL_SEARCHING_MS,
} from '../../packages/rides-native/liveTrip.js'
import { followEtaLine, followRouteLine, legNounForStatus, storedRoadSuffix, directionsEtaLine } from '../../packages/rides-native/roadFollow.js'
import { useDrivingLeg } from '../lib/useDrivingLeg'
import { COMFORT_FLEET_NOTICE, tripTags } from '../../packages/rides-native/tripTags.js'
import { LivePhase } from '../components/LivePhase'
import { reconcileCheckoutSession } from '../lib/stripeCheckout'
import { parseCheckoutSessionId } from '../../packages/rides-native/checkoutReturn.js'

export function Requested({ dest = 'GSP Airport', trip = '', driver = 'your driver', driverId = '', paid = '', sessionId = '' }) {
  const { user } = useAuth()
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tripRow, setTripRow] = useState(null)
  const [tripMissing, setTripMissing] = useState(false)
  const [locationAt, setLocationAt] = useState(null)
  const [trackingError, setTrackingError] = useState(null)
  const [trackingAttempt, setTrackingAttempt] = useState(0)
  const [trackingNow, setTrackingNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setTrackingNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const [driverPos, setDriverPos] = useState(null)
  const [driverHeading, setDriverHeading] = useState(null)
  const [resolvedDriverId, setResolvedDriverId] = useState(driverId || '')
  const [rateNudge, setRateNudge] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [stillSearching, setStillSearching] = useState(false)
  const searchStartedAt = useRef(null)
  const stopRef = useRef(null)
  const ratedCheck = useRef(false)
  const tipPrompted = useRef(false)
  const reconciledSessions = useRef(new Set())

  useEffect(() => onTrackingResume(() => {
    setTrackingNow(Date.now())
    setTrackingAttempt((n) => n + 1)
  }), [])

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
    let loading = false
    async function load() {
      if (loading || !alive) return
      loading = true
      try {
      const { data, error: loadError } = await withTrackingTimeout(supabase
        .from('trips')
        .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, completed_at, canceled_at, requested_at, stops, metadata')
        .eq('id', trip)
        .maybeSingle())
      if (!alive) return
      if (loadError) { setError('Could not refresh trip status. Retrying automatically.'); return }
      if (!data) {
        setTripMissing(true)
        return
      }
      setTripMissing(false)
      setError((previous) => previous === 'Could not refresh trip status. Retrying automatically.' ? null : previous)
      let row = data
      const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {}
      const hasStops = Array.isArray(data.stops) && data.stops.length > 0
      if (!hasStops && meta.friend_ride_id) {
        try {
          const { data: ride, error: rideError } = await withTrackingTimeout(supabase
            .from('friend_rides')
            .select('stops, kind, status')
            .eq('id', meta.friend_ride_id)
            .maybeSingle())
          if (!rideError && ride && Array.isArray(ride.stops) && ride.stops.length) {
            row = {
              ...data,
              stops: ride.stops,
              metadata: { ...meta, kind: meta.kind || ride.kind || null },
            }
          }
        } catch {
          /* Pickup pin stays if the friend ride row is not readable. */
        }
      }
      if (!alive) return
      setTripRow(row)
      setResolvedDriverId(data.driver_id || '')
      const needsTip = shouldPromptRiderTip(row, user?.id)
      if (needsTip && !tipPrompted.current) {
        tipPrompted.current = true
        navigate('tip', { trip: data.id })
      }
      if (data.status === 'completed' && user?.id && !ratedCheck.current && !needsTip) {
        ratedCheck.current = true
        const rated = await hasRatedTrip(data.id, user.id)
        if (alive && !rated) setRateNudge(true)
      }
      } catch { if (alive) setError('Could not refresh trip status. Retrying automatically.') }
      finally { loading = false }
    }
    load()

    const sid = sessionId || (typeof window !== 'undefined' ? parseCheckoutSessionId(window.location.hash || window.location.href) : '')
    if (sid && (paid === '1' || paid === 'true') && !reconciledSessions.current.has(sid)) {
      reconciledSessions.current.add(sid)
      reconcileCheckoutSession({ sessionId: sid })
        .then(() => {
          if (alive) void load()
        })
        .catch((err) => {
          console.error('[checkout-reconcile] failed to reconcile checkout:', err)
        })
    }

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
  }, [trip, user?.id, paid, sessionId, trackingAttempt])

  useEffect(() => {
    if (!resolvedDriverId || !isLiveTrip(tripRow?.status)) return undefined
    return subscribeTripDriverLocation(trip, (loc) => {
      setDriverPos([loc.lat, loc.lng])
      setDriverHeading(loc.heading)
      setLocationAt(loc.updatedAt)
    }, setTrackingError, resolvedDriverId)
  }, [trip, resolvedDriverId, trackingAttempt, tripRow?.status])

  useEffect(() => { setDriverPos(null); setDriverHeading(null); setLocationAt(null); setTrackingError(null) }, [resolvedDriverId, tripRow?.status])

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
  const locationIssue = trackingIssue(status, locationAt, trackingNow)
  const showMap = Boolean(trip) || Boolean(status) || preferred
  const preview = showSearchTheater(status) && !tripRow?.driver_id && !driverPos
  const searchPreview = preview ? searchingRidePreview(tripRow) : null
  const snappedRoad = storedRoadSuffix(tripRow, driverFix, status)
  const noun = legNounForStatus(status)
  const legDest = noun === 'drop-off'
    ? (tripRow?.dropoff_lat != null && tripRow?.dropoff_lng != null
      ? [Number(tripRow.dropoff_lat), Number(tripRow.dropoff_lng)]
      : null)
    : noun === 'pickup'
      ? (tripRow?.pickup_lat != null && tripRow?.pickup_lng != null
        ? [Number(tripRow.pickup_lat), Number(tripRow.pickup_lng)]
        : null)
      : null
  const drivingLeg = useDrivingLeg(driverPos, legDest, Boolean(!preview && !snappedRoad && driverPos && legDest))
  const followedEta = followEtaLine(status, driverFix, tripRow)
  const roadEta = !snappedRoad && noun
    ? directionsEtaLine({ meters: drivingLeg?.meters, seconds: drivingLeg?.seconds, noun })
    : null
  const computedEta = roadEta || followedEta
  const heldEta = searchPreview ? searchPreview.eta : etaHoldLine(status, computedEta)
  const etaLine = staleEtaLine(locationIssue, heldEta, { placeholder: !searchPreview && !computedEta })
  const liveStops = orderedLiveStops(tripRow)
  const stopPins = liveStops.map((stop) => ({
    id: stop.id,
    lat: stop.lat,
    lng: stop.lng,
    label: stop.title,
    badge: String(stop.order),
    color: stop.order === 1 ? '#522D80' : (stop.order === liveStops.length || stop.kind === 'dropoff' ? '#F56600' : '#522D80'),
  }))
  const followedRoute = followRouteLine(tripRow, driverFix)
  const routePath = searchPreview
    ? searchPreview.route
    : (!snappedRoad && drivingLeg?.path?.length > 1 ? drivingLeg.path : followedRoute)
  const dropoff =
    tripRow?.dropoff_lat != null && tripRow?.dropoff_lng != null
      ? [Number(tripRow.dropoff_lat), Number(tripRow.dropoff_lng)]
      : null
  const mapCenter = routePath.length > 1
    ? [
      (routePath[0][0] + routePath[routePath.length - 1][0]) / 2,
      (routePath[0][1] + routePath[routePath.length - 1][1]) / 2,
    ]
    : (pickup || CLEMSON)

  useEffect(() => {
    if (!showSearchTheater(status) || driverPos) {
      setStillSearching(false)
      searchStartedAt.current = null
      return undefined
    }
    if (!searchStartedAt.current) searchStartedAt.current = Date.now()
    const tick = () => {
      const started = searchStartedAt.current || Date.now()
      setStillSearching(Date.now() - started >= STILL_SEARCHING_MS)
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [status, driverPos])

  const fleetTags = tripRow ? tripTags(tripRow) : []
  const comfortClassTrip = fleetTags.includes('comfort')

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
        <div className="glass-panel search-map" style={{ borderRadius: 20, overflow: 'hidden', height: preview ? 280 : 220, position: 'relative' }}>
          {/* Road line is the stored polyline, or one throttled Directions leg under 12 km. */}
          <CampusMap
            height={preview ? 280 : 220}
            interactive
            center={mapCenter}
            zoom={preview && routePath.length > 1 ? 10 : (liveStops.length > 1 ? 12 : 14)}
            marker={pickup}
            pickupPosition={pickup}
            dropoffPosition={dropoff}
            driverPosition={preview ? null : driverPos}
            driverHeading={driverHeading}
            animateDriver={!preview && Boolean(driverPos)}
            stops={stopPins}
            route={routePath.length > 1 ? routePath : null}
            routeSecondary={preview && routePath.length > 1 ? routePath : null}
            fitRoute={routePath.length > 1}
          />
          {preview && (
            <div className="search-map-chip" aria-hidden="true">
              <span className="search-wait__spinner" />
              <span className="search-map-chip__label">Looking for a driver</span>
            </div>
          )}
        </div>
      )}
      <div className="glass-panel glass-panel--elevated" style={{ padding: 24, borderRadius: 20 }}>
        {paid === '1' && trip && !tripMissing && (status === 'searching' || status === 'offered' || !status) && (
          <p style={{ color: '#522D80', fontWeight: 700, fontSize: 13, lineHeight: 1.45, marginTop: 0 }}>
            This ride is in the open pool. The final fare is charged when the trip ends.
          </p>
        )}
        {tripMissing && (
          <p style={{ color: '#522D80', fontWeight: 700, fontSize: 14, lineHeight: 1.45 }}>
            {error || 'This trip is not on your account. Request a ride again if you still need a driver.'}
          </p>
        )}
        {(locationIssue || trackingError) && !['completed', 'canceled', 'cancelled_wait'].includes(status) && <div role="status">{locationIssue || trackingError} <button type="button" onClick={() => setTrackingAttempt((n) => n + 1)}>Retry tracking</button></div>}
        <LivePhase
          kicker={phase.kicker}
          title={tripMissing ? 'No live trip' : phase.title}
          body={tripMissing ? 'There is no matching ride to track on this screen.' : phase.body}
          eta={tripMissing ? null : etaLine}
          steps={tripMissing ? [] : phase.steps}
          activeIndex={tripMissing ? -1 : phase.stepIndex}
        />
        {preview && searchPreview?.wait && (
          <div className="search-wait" role="status" aria-live="polite">
            <span className="search-wait__spinner" aria-hidden="true" />
            <div>
              <p className="search-wait__time">{searchPreview.wait}</p>
              <p className="search-wait__note">{SEARCH_APPROX_WAIT_NOTE}</p>
            </div>
          </div>
        )}
        {preview && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 13, lineHeight: 1.45, marginTop: 10 }}>
            {SEARCH_PREVIEW_COPY}
          </p>
        )}
        {stillSearching && preview && (
          <div
            role="status"
            aria-live="polite"
            className="glass-panel glass-panel--orange"
            style={{ marginTop: 12, padding: 12, borderRadius: 14 }}
          >
            <div style={{ fontSize: 11, letterSpacing: 1.1, fontWeight: 800, color: '#F56600' }}>STILL MATCHING</div>
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, color: '#522D80', fontWeight: 650 }}>
              {STILL_SEARCHING_COPY}
            </p>
          </div>
        )}
        {comfortClassTrip && !tripMissing && (
          <p style={{ color: '#522D80', fontWeight: 650, fontSize: 13, lineHeight: 1.4, marginTop: 10 }}>
            {COMFORT_FLEET_NOTICE}
          </p>
        )}
        {resolvedDriverId && PARTY_VISIBLE_STATUSES.includes(status) && (
          <CounterpartChip
            profileId={resolvedDriverId}
            noun="driver"
            eta={driverPos ? staleEtaLine(locationIssue, computedEta, { placeholder: !computedEta }) : null}
            onOpen={() => navigate('profile', { id: resolvedDriverId, matched: '1' })}
          />
        )}
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45, marginTop: 12 }}>
          {resolvedDriverId && PARTY_VISIBLE_STATUSES.includes(status) ? '' : `${driver} · `}
          {tripRow?.pickup_label || 'Pickup'} → {dest || tripRow?.dropoff_label || 'Drop-off'}.
          {trip ? ` ID ${String(trip).slice(0, 8)}…` : ''}
        </p>
        {liveStops.length > 0 && (
          <ol style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--ink)', fontSize: 14 }}>
            {liveStops.map((stop) => (
              <li key={stop.id} style={{ marginTop: 4, fontWeight: 700, color: stop.order === liveStops.length ? 'var(--orange)' : 'var(--purple)' }}>
                {stop.label}
              </li>
            ))}
          </ol>
        )}
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
        {error && !tripMissing && <AccessibleAlert error={error} onDismiss={() => setError(null)} style={{ marginTop: 12 }} />}
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
