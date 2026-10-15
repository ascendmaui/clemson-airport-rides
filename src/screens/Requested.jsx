import { uniqueChannelTopic } from '../../packages/rides-native/realtimeChannel.js'
import { sendTripHeartbeat } from '../../packages/rides-native/tripHeartbeat.js'
import { canDriverEnd } from '../../shared/driverEndTrip.js'
import { trackingIssue, staleEtaLine, withTrackingTimeout, onTrackingResume } from '../../packages/rides-native/tracking.js'
import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { SiteIcon } from '../components/SiteIcon.jsx'
import { AccessibleAlert } from '../components/AccessibleAlert'
import { CampusMap, CLEMSON, STADIUM } from '../components/CampusMap'
import { navigate, shareUrl } from '../lib/navigation'
import { shouldPromptRiderTip } from '../lib/riderTip'
import { useAuth } from '../lib/auth'
import { createLocationShare, startSharingLocation } from '../lib/locationShare'
import { distanceMeters, isLiveTrip, subscribeTripDriverLocation } from '../lib/liveDriverLocation'
import { supabase } from '../lib/supabase'
import { hasRatedTrip } from '../lib/ratings'
import { RideChat, RideMessageButton } from '../components/RideChat'
import { ReportLostItemButton } from '../components/ReportLostItem'
import { rideChatMode } from '../lib/tripChatRules'
import { fetchLostItemReport, subscribeLostItemReports } from '../lib/tripMessages'
import { SosControl } from '../components/SosControl'

const TRIP_SELECT = 'id, status, rider_id, driver_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, completed_at, canceled_at, requested_at, stops, metadata'

function missingHeartbeatColumn(message) {
  return /driver_heartbeat_at/i.test(message || '') && /column|schema cache/i.test(message || '')
}
import { isActiveRideStatus } from '../lib/sosAlert'
import { MidrideCancelSheet } from '../components/MidrideCancelSheet'
import { RiderSwitchSheet } from '../components/RiderSwitchSheet'
import { loadMidrideStarted, riderMayCancelMidride } from '../../shared/riderMidrideCancel.js'
import { CounterpartChip } from '../components/CounterpartChip'
import {
  liveTripMapChip,
  liveTripMapHeight,
  liveTripRoutePrefix,
  liveTripSecondaryActions,
} from '../../packages/rides-native/liveTripCard.js'
import { PARTY_VISIBLE_STATUSES } from '../../packages/rides-native/partyProfile.js'
import {
  driverCancelNotice,
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
import { failedHoldPrompt } from '../../packages/rides-native/rideMoments.js'
import { useDrivingLeg } from '../lib/useDrivingLeg'
import { COMFORT_FLEET_NOTICE, tripTags } from '../../packages/rides-native/tripTags.js'
import { LivePhase } from '../components/LivePhase'
import { reconcileCheckoutSession } from '../lib/stripeCheckout'
import { parseCheckoutSessionId } from '../../packages/rides-native/checkoutReturn.js'
import { riderDeclineRebroadcastMessage } from '../../server/matchingEdge.js'

export function Requested({ dest = 'GSP Airport', trip = '', driver = 'your driver', driverId = '', paid = '', sessionId = '' }) {
  const { user } = useAuth()
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tripRow, setTripRow] = useState(null)
  const [lostReport, setLostReport] = useState(null)
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
  const [midrideStarted, setMidrideStarted] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
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
      let loaded = await withTrackingTimeout(supabase
        .from('trips')
        .select(`${TRIP_SELECT}, driver_heartbeat_at`)
        .eq('id', trip)
        .maybeSingle())
      if (loaded.error && missingHeartbeatColumn(loaded.error.message)) {
        loaded = await withTrackingTimeout(supabase
          .from('trips')
          .select(TRIP_SELECT)
          .eq('id', trip)
          .maybeSingle())
      }
      const { data, error: loadError } = loaded
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
      if (canDriverEnd(row.status)) void sendTripHeartbeat(supabase, row.id)
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
      .channel(uniqueChannelTopic(`requested-trip-${trip}`))
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
    if (!trip) return undefined
    let alive = true
    fetchLostItemReport(trip)
      .then((row) => { if (alive) setLostReport(row) })
      .catch(() => { if (alive) setLostReport(null) })
    const unsub = subscribeLostItemReports((payload) => {
      const next = payload?.new
      if (!next || next.trip_id === trip) {
        fetchLostItemReport(trip).then((row) => { if (alive) setLostReport(row) }).catch(() => {})
      }
    })
    return () => {
      alive = false
      unsub()
    }
  }, [trip])

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
          await navigator.share({ title: 'My Clemson Rides location', url, text: 'Follow my live ride location' })
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

  const seenDriverCancels = useRef(new Map())
  const [cancelNotice, setCancelNotice] = useState(null)
  useEffect(() => {
    if (tripRow?.status !== 'searching') { setCancelNotice(null); return }
    const notice = driverCancelNotice(tripRow, seenDriverCancels.current.get(trip))
    if (!notice) return
    seenDriverCancels.current.set(trip, notice.at)
    setCancelNotice({ ...notice, tripId: trip })
  }, [trip, tripRow])
  const status = tripRow?.status || ''
  useEffect(() => {
    let alive = true
    loadMidrideStarted(supabase, { id: trip, status }).then((started) => {
      if (alive) setMidrideStarted(started)
    })
    return () => { alive = false }
  }, [trip, status])
  const canCancelMidride = riderMayCancelMidride(status, midrideStarted)
  const chatMode = rideChatMode(tripRow, Date.now(), lostReport)
  const showMessages = Boolean(user?.id && tripRow?.driver_id && tripRow?.rider_id && chatMode !== 'closed')
  const rideLive = isActiveRideStatus(status)
  const devSosPreview = import.meta.env.DEV && typeof window !== 'undefined'
    && window.location.hash.includes('sos=preview')
  const pickup =
    tripRow?.pickup_lat != null && tripRow?.pickup_lng != null
      ? [Number(tripRow.pickup_lat), Number(tripRow.pickup_lng)]
      : STADIUM
  const namedDriver = driver && driver !== 'your driver'
  const preferred = status === 'requested' || (!status && namedDriver) || ((status === 'canceled' || status === 'cancelled') && namedDriver)
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
  const declineNote = riderDeclineRebroadcastMessage(tripRow)
  const phaseBody = declineNote ? `${phase.body} ${declineNote}` : phase.body
  const driverFix = driverPos ? { lat: driverPos[0], lng: driverPos[1] } : null
  const locationIssue = trackingIssue(status, locationAt, trackingNow, tripRow?.driver_heartbeat_at || null)
  const holdPrompt = failedHoldPrompt(tripRow)
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

  const approachFeet = (status === 'accepted' || status === 'arriving' || status === 'arrived') && driverPos && pickup
    ? Math.round(distanceMeters({ lat: driverPos[0], lng: driverPos[1] }, { lat: pickup[0], lng: pickup[1] }))
    : null
  const canSwitchDriver = (status === 'accepted' || status === 'arriving') && Boolean(tripRow?.driver_id)
  const fleetTags = tripRow ? tripTags(tripRow) : []
  const comfortClassTrip = fleetTags.includes('comfort')
  const driverOnCard = Boolean(resolvedDriverId && PARTY_VISIBLE_STATUSES.includes(status))
  const mapChip = liveTripMapChip(status)
  const mapHeight = liveTripMapHeight({ preview, driverOnMap: Boolean(driverPos), status })
  const routePrefix = liveTripRoutePrefix(driver, driverOnCard)
  // Cancel is the button below, gated by the server mid-ride rule.
  const secondaryActions = liveTripSecondaryActions({
    status,
    tripId: trip,
    tripMissing,
    showMessages,
    rateNudge,
  }).filter((action) => action.id !== 'cancel')

  return (
    <div className="fade-in live-trip">
      {(rideLive || devSosPreview) && (
        <SosControl
          tripId={trip || '00000000-0000-4000-8000-000000000001'}
          viewerRole="rider"
          knownActive
        />
      )}
      {showMap && (
        <div className="glass-panel search-map" style={{ height: mapHeight }}>
          {/* Road line is the stored polyline, or one throttled Directions leg under 12 km. */}
          <CampusMap
            height={mapHeight}
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
          {mapChip && (
            <div
              className={`search-map-chip search-map-chip--${mapChip.tone}`}
              data-live-trip-chip={mapChip.tone}
              aria-hidden="true"
            >
              {mapChip.spinning
                ? <span className="search-wait__spinner search-map-chip__spinner" />
                : <span className="search-map-chip__dot" />}
              <span className="search-map-chip__label">{mapChip.label}</span>
            </div>
          )}
        </div>
      )}
      <div className="glass-panel glass-panel--elevated live-trip-card">
        {paid === '1' && trip && !tripMissing && (status === 'searching' || status === 'offered' || !status) && (
          <p style={{ color: '#522D80', fontWeight: 700, fontSize: 13, lineHeight: 1.45, marginTop: 0 }}>
            This ride is in the open pool. The final fare is charged when the trip ends.
          </p>
        )}
        {cancelNotice?.tripId === trip && status === 'searching' && <AccessibleAlert key={cancelNotice.at} variant="warning" role="alert" ariaLive="assertive" message={cancelNotice.message} />}
        {tripMissing && (
          <p style={{ color: '#522D80', fontWeight: 700, fontSize: 14, lineHeight: 1.45 }}>
            {error || 'This trip is not on your account. Request a ride again if you still need a driver.'}
          </p>
        )}
        {holdPrompt ? (
          <button
            type="button"
            onClick={() => navigate('account', { tab: 'billing', setup: 'card' })}
            style={{ textAlign: 'left', background: '#fff4ea', border: 0, borderRadius: 14, padding: 14, marginBottom: 12 }}
          >
            <strong>{holdPrompt.title}</strong>
            <div>{holdPrompt.body}</div>
          </button>
        ) : null}
        {(locationIssue || trackingError) && !['completed', 'canceled', 'cancelled', 'cancelled_wait'].includes(status) && <div role="status">{locationIssue || trackingError} <button type="button" onClick={() => setTrackingAttempt((n) => n + 1)}>Retry tracking</button></div>}
        <LivePhase
          kicker={phase.kicker}
          title={tripMissing ? 'No live trip' : phase.title}
          body={tripMissing ? 'There is no matching ride to track on this screen.' : phaseBody}
          eta={tripMissing ? null : etaLine}
          steps={tripMissing ? [] : phase.steps}
          activeIndex={tripMissing ? -1 : phase.stepIndex}
        />
        {Number.isFinite(approachFeet) ? (
          <p role="status" style={{ marginTop: 10, fontWeight: 800, color: 'var(--orange)' }}>
            Your driver is {approachFeet.toLocaleString('en-US')} ft away.
          </p>
        ) : null}
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
          <p className="live-trip-note">
            {SEARCH_PREVIEW_COPY}
          </p>
        )}
        {stillSearching && preview && (
          <div
            role="status"
            aria-live="polite"
            className="glass-panel glass-panel--orange"
            style={{ padding: 12, borderRadius: 14 }}
          >
            <div style={{ fontSize: 11, letterSpacing: 1.1, fontWeight: 800, color: '#F56600' }}>STILL MATCHING</div>
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, color: '#522D80', fontWeight: 650 }}>
              {STILL_SEARCHING_COPY}
            </p>
          </div>
        )}
        {comfortClassTrip && !tripMissing && (
          <p className="live-trip-comfort">
            {COMFORT_FLEET_NOTICE}
          </p>
        )}
        {driverOnCard && (
          <CounterpartChip
            profileId={resolvedDriverId}
            noun="driver"
            eta={driverPos ? staleEtaLine(locationIssue, computedEta, { placeholder: !computedEta }) : null}
            onOpen={() => navigate('profile', { id: resolvedDriverId, matched: '1' })}
            style={{ marginTop: 0 }}
          />
        )}
        <p className="live-trip-route">
          {routePrefix}
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
        <div className="live-trip-actions">
          <PrimaryButton onClick={onShare} disabled={busy || !trip || tripMissing}>
            {busy ? 'Starting…' : share ? 'Sharing — tap to refresh link' : 'Share my location'}
          </PrimaryButton>
          {share?.token && (
            <p className="live-trip-share-url">
              {shareUrl(share.token)}
            </p>
          )}
          {secondaryActions.length > 0 && (
            <div className="live-trip-actions__secondary">
              {secondaryActions.map((action) => {
                if (action.id === 'messages') {
                  return (
                    <RideMessageButton
                      key={action.id}
                      readOnly={chatMode !== 'compose'}
                      tripId={tripRow?.id}
                      userId={user?.id}
                      onClick={() => setChatOpen(true)}
                    />
                  )
                }
                if (action.id === 'lost-found') {
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className="pressable live-trip-text-btn"
                      data-testid="post-ride-lost-found"
                      onClick={() => navigate('lost-found', { trip })}
                    >
                      {action.label}
                    </button>
                  )
                }
                if (action.id === 'rate') {
                  return (
                    <div key={action.id} className="glass-panel live-trip-rate">
                      <div className="live-trip-rate__title">Trip complete — rate your driver?</div>
                      <PrimaryButton onClick={() => navigate('rate', { trip })}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          Rate now <SiteIcon name="star" size={16} />
                        </span>
                      </PrimaryButton>
                      <button type="button" className="pressable live-trip-text-btn live-trip-text-btn--quiet" onClick={() => setRateNudge(false)}>
                        Soft remind later
                      </button>
                    </div>
                  )
                }
                if (action.id === 'cancel') {
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className="pressable live-trip-text-btn live-trip-text-btn--danger"
                      onClick={() => setCancelOpen(true)}
                    >
                      {action.label}
                    </button>
                  )
                }
                return null
              })}
            </div>
          )}
          {status === 'completed' && tripRow && (
            <ReportLostItemButton trip={tripRow} userId={user?.id} onOpened={() => setChatOpen(true)} />
          )}
          {canSwitchDriver && trip && (
            <button
              type="button"
              className="pressable live-trip-text-btn"
              onClick={() => setSwitchOpen(true)}
            >
              Change driver
            </button>
          )}
          {canCancelMidride && trip && (
            <button
              type="button"
              className="pressable live-trip-text-btn live-trip-text-btn--danger"
              onClick={() => setCancelOpen(true)}
            >
              Cancel this ride
            </button>
          )}
          <PrimaryButton onClick={() => navigate('home')}>Back home</PrimaryButton>
        </div>
        {error && !tripMissing && <AccessibleAlert error={error} onDismiss={() => setError(null)} />}
      </div>
      {chatOpen && user?.id && tripRow && (
        <RideChat
          tripId={tripRow.id}
          userId={user.id}
          initialTrip={tripRow}
          onClose={() => setChatOpen(false)}
        />
      )}
      {switchOpen && trip && (
        <RiderSwitchSheet
          tripId={trip}
          onClose={() => setSwitchOpen(false)}
          onDone={(data) => {
            setSwitchOpen(false)
            if (data?.next === 'carpool') navigate('carpool', { hub: '1' })
            else if (data?.next === 'home') navigate('home')
            else if (data?.trip) {
              setTripRow((row) => (row ? { ...row, ...data.trip, driver_id: data.trip.driver_id ?? null } : row))
            }
          }}
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
