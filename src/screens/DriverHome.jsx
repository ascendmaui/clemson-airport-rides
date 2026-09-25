import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { GameDayStatus } from '../components/GameDayStatus'
import { useGameDayNotice } from '../lib/useGameDayNotice'
import { DriverIncentiveBanner, useDriverIncentiveWatch } from '../components/DriverIncentiveBanner'
import { HEAT_WINDOWS } from '../lib/rideDemand'
import { PurpleAcceptButton } from '../components/PrimaryButton'
import { ScheduledRideQueue } from '../components/ScheduledRideQueue'
import { navigate } from '../lib/navigation'
import { setDriverOnline, subscribeTrips, supabase } from '../lib/supabase'
import { grantRiderSocialForTrip } from '../lib/riderReferral'
import { publishDriverLocation } from '../lib/driverTrack'
import { DriverApprovalGate } from './DriverApprovalGate'
import { driverOfferCopy, driverTakeCents, formatUsd } from '../lib/carpoolEngine'
import { RideChat, RideMessageButton } from '../components/RideChat'
import { rideChatMode } from '../lib/tripChatRules'
import { SosControl } from '../components/SosControl'
import { applyTripDriverIncentives, fetchDriverIncentiveExtras } from '../lib/driverIncentives'
import { isIncentiveAdmin } from '../lib/driverIncentiveMath'
import { fetchFullProfile } from '../lib/profiles'
import { CounterpartChip } from '../components/CounterpartChip'
import { PARTY_VISIBLE_STATUSES } from '../../packages/rides-native/partyProfile.js'
import { useTripWait } from '../lib/useTripWait'
import { WaitFeeCard } from '../components/WaitFeeCard'
import { settleTrip } from '../lib/payments'
import { PaymentFailedSheet } from '../components/PaymentFailedSheet'
import { formatPickupAt, isDueNow } from '../lib/scheduledRideModel'
import {
  acceptScheduledTrip,
  listDriverScheduledTrips,
  listOpenScheduledTrips,
  reminderCopy,
  takeReminder,
} from '../lib/scheduledRides'
import { pushToast } from '../lib/toasts'
import { acceptTrip, declineTrip, listPassedTripIds } from '../../packages/rides-native/driverDesk.js'
import {
  acceptActionLabel,
  declineActionLabel,
  PREFERRED_REQUEST_NOTE,
  driverStatusDetail,
  statusHeadline,
  teslaFleetNotice,
  tripTags,
} from '../../packages/rides-native/tripTags.js'
import { DRIVER_TRACK_STEPS, etaHoldLine, etaLineFor } from '../../packages/rides-native/liveTrip.js'
import { LivePhase } from '../components/LivePhase'

function TeslaNotice({ row }) {
  const notice = teslaFleetNotice(tripTags(row).includes('tesla'))
  if (!notice) return null
  return (
    <p style={{ color: '#522D80', fontWeight: 650, fontSize: 13, lineHeight: 1.4, marginTop: 10 }}>
      {notice}
    </p>
  )
}

function centsToDollars(cents) {
  if (cents == null) return '—'
  return `$${(Number(cents) / 100).toFixed(2)}`
}

async function writeTripEvent(tripId, kind, payload = {}) {
  if (!supabase || !tripId) return
  const { error } = await supabase.from('trip_events').insert({
    trip_id: tripId,
    kind,
    payload,
  })
  if (error) {
    console.error('[trip_events]', kind, error.message)
    throw new Error(error.message || `Could not record trip event (${kind})`)
  }
}

const ACTIVE_STATUSES = ['accepted', 'arriving', 'arrived', 'in_progress']

export function DriverHome() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>Loading…</div>
    )
  }
  return <DriverShell driverId={user?.id || null} />
}

function DriverShell({ driverId }) {
  const { user } = useAuth()
  const game = useGameDayNotice()
  const [priority, setPriority] = useState(false)
  const [offer, setOffer] = useState(null)
  const [activeTrip, setActiveTrip] = useState(null)
  const [payFailure, setPayFailure] = useState(null)
  const wait = useTripWait(activeTrip, (next) => {
    setActiveTrip((prev) => (prev && next && prev.id === next.id ? { ...prev, ...next } : prev))
  })
  const [online, setOnline] = useState(false)
  const [earningsCents, setEarningsCents] = useState(0)
  const [incentiveExtraCents, setIncentiveExtraCents] = useState(0)
  const [extraByTrip, setExtraByTrip] = useState({})
  const [recentCompleted, setRecentCompleted] = useState([])
  const [canEditIncentives, setCanEditIncentives] = useState(() => isIncentiveAdmin(user, null))
  const { banner: incentiveBanner } = useDriverIncentiveWatch({ driverId, online })
  const [advancing, setAdvancing] = useState(false)
  const [advanceError, setAdvanceError] = useState(null)
  const [selfPos, setSelfPos] = useState(null)
  const [showSurge, setShowSurge] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [heatMeta, setHeatMeta] = useState(null)
  const [application, setApplication] = useState(undefined)
  const [activeChecked, setActiveChecked] = useState(false)
  const approved = application?.onboarding_status === 'approved'
  const [chatTrip, setChatTrip] = useState(null)
  const [scheduledOpen, setScheduledOpen] = useState([])
  const [scheduledMine, setScheduledMine] = useState([])
  const [acceptingScheduledId, setAcceptingScheduledId] = useState(null)
  const dismissedOffers = useRef(new Set())
  const passedOffers = useRef(new Set())
  const knownOpen = useRef(new Set())
  const scheduledPrimed = useRef(false)

  useEffect(() => {
    if (!chatTrip || !activeTrip || chatTrip.id !== activeTrip.id) return
    if (
      chatTrip.status !== activeTrip.status
      || chatTrip.completed_at !== activeTrip.completed_at
      || chatTrip.canceled_at !== activeTrip.canceled_at
    ) {
      setChatTrip(activeTrip)
    }
  }, [activeTrip, chatTrip])
  const silverProgress = 2
  const silverTotal = 4

  const loadEarnings = useCallback(async () => {
    if (!supabase || !driverId) return
    let { data, error } = await supabase
      .from('trips')
      .select('id, fare_cents, dropoff_label, completed_at, metadata')
      .eq('driver_id', driverId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20)
    if (error && /metadata|column/i.test(error.message || '')) {
      const retry = await supabase
        .from('trips')
        .select('id, fare_cents, dropoff_label, completed_at')
        .eq('driver_id', driverId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(20)
      data = retry.data
      error = retry.error
    }
    if (error) {
      console.error('[earnings]', error.message)
      return
    }
    const rows = data || []
    setRecentCompleted(rows)
    setEarningsCents(rows.reduce((sum, t) => sum + (Number(t.fare_cents) || 0), 0))
    const extras = await fetchDriverIncentiveExtras(driverId, rows.map((t) => t.id))
    setExtraByTrip(extras)
    setIncentiveExtraCents(Object.values(extras).reduce((sum, n) => sum + n, 0))
  }, [driverId])

  useEffect(() => {
    if (!supabase || !driverId) {
      setApplication(null)
      return undefined
    }
    let alive = true
    supabase
      .from('driver_applications')
      .select('onboarding_status, rejection_reason, submitted_at')
      .eq('profile_id', driverId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          console.error('[driver approval]', error.message)
          setApplication(null)
          return
        }
        setApplication(data)
      })
    return () => {
      alive = false
    }
  }, [driverId])

  useEffect(() => {
    if (!driverId || !approved) return undefined
    setDriverOnline(driverId, true).catch(() => {})
    setOnline(true)
    return () => {
      setDriverOnline(driverId, false).catch(() => {})
    }
  }, [driverId, approved])

  useEffect(() => {
    if (!driverId || !approved || !navigator.geolocation) return undefined
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = [pos.coords.latitude, pos.coords.longitude]
        setSelfPos(next)
        publishDriverLocation(driverId, {
          lat: next[0],
          lng: next[1],
          heading: pos.coords.heading,
          online: true,
        }).catch(() => {})
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [driverId, approved])

  useEffect(() => {
    loadEarnings()
  }, [loadEarnings])

  useEffect(() => {
    if (!driverId) return undefined
    let alive = true
    fetchFullProfile(driverId, { viewerId: driverId })
      .then((profile) => {
        if (alive) setCanEditIncentives(isIncentiveAdmin(user, profile))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [driverId, user])

  const loadScheduled = useCallback(async () => {
    if (!supabase || !driverId) return
    try {
      const [open, mine] = await Promise.all([
        listOpenScheduledTrips(),
        listDriverScheduledTrips(driverId),
      ])
      setScheduledOpen(open)
      setScheduledMine(mine)
      if (!scheduledPrimed.current) {
        open.forEach((row) => knownOpen.current.add(row.id))
        scheduledPrimed.current = true
      } else {
        open.forEach((row) => {
          if (knownOpen.current.has(row.id)) return
          knownOpen.current.add(row.id)
          pushToast({
            kind: 'ride_scheduled',
            title: 'New scheduled ride',
            body: `${row.pickup_label || 'Pickup'} → ${row.dropoff_label || 'Drop-off'} · ${formatPickupAt(row.pickup_at)}`,
          })
        })
      }
      open.forEach((row) => {
        const decision = takeReminder(row, new Date(), { windows: ['h1', 'm15', 'now'] })
        if (!decision) return
        const copy = reminderCopy(row, decision)
        pushToast({ ...copy, kind: 'ride_scheduled', title: 'Scheduled ride still open' })
      })
    } catch (err) {
      console.error('[scheduled]', err.message)
    }
  }, [driverId])

  useEffect(() => {
    loadScheduled()
    const timer = setInterval(loadScheduled, 20000)
    return () => clearInterval(timer)
  }, [loadScheduled])

  // Load open offers and preferred requests — Realtime alone misses rows already open.
  // Do not flip searching → offered here. That update fails RLS unless driver_id is
  // claimed, and a failed claim left riders looking at a review that never started.
  useEffect(() => {
    if (!supabase || !approved) return undefined
    let alive = true
    async function loadOffers() {
      const [open, preferred] = await Promise.all([
        supabase
          .from('trips')
          .select('*')
          .in('status', ['searching', 'offered'])
          .order('requested_at', { ascending: false })
          .limit(8),
        driverId
          ? supabase
            .from('trips')
            .select('*')
            .eq('status', 'requested')
            .eq('driver_id', driverId)
            .order('requested_at', { ascending: false })
            .limit(1)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (!alive || open.error) return
      if (driverId) {
        const passed = await listPassedTripIds(supabase, driverId)
        if (!alive) return
        passedOffers.current = new Set(passed)
      }
      const preferredRow = preferred.data?.[0] || null
      const openRow = (open.data || []).find((row) => (
        isDueNow(row)
        && !passedOffers.current.has(row.id)
        && !dismissedOffers.current.has(row.id)
      ))
      const row = preferredRow && !dismissedOffers.current.has(preferredRow.id) ? preferredRow : openRow
      if (!row || dismissedOffers.current.has(row.id)) return
      if ((row.status === 'searching' || row.status === 'offered') && !isDueNow(row)) return
      setOffer(row)
    }
    loadOffers()
    return () => {
      alive = false
    }
  }, [driverId, approved])

  // Poll/load active trips for this driver so E2E accepted trips appear without re-offer.
  useEffect(() => {
    if (!supabase || !driverId) {
      setActiveChecked(true)
      return undefined
    }
    let alive = true
    async function loadActive() {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ACTIVE_STATUSES)
        .order('accepted_at', { ascending: false })
        .limit(8)
      if (!alive || error) return
      const row = (data || []).find((trip) => isDueNow(trip))
      if (row) {
        setActiveTrip(row)
        setOffer((prev) => (prev?.id === row.id ? null : prev))
      }
      setActiveChecked(true)
    }
    loadActive()
    const timer = setInterval(loadActive, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [driverId])

  useEffect(() => {
    if (!approved) return undefined
    return subscribeTrips((payload) => {
      const row = payload?.new || payload?.record
      if (!row) return
      if (row.status === 'scheduled') {
        loadScheduled()
      }
      if (row.status === 'requested' && row.driver_id === driverId && !activeTrip && !dismissedOffers.current.has(row.id)) {
        setOffer(row)
      }
      if (row.status === 'searching' || row.status === 'offered') {
        if (passedOffers.current.has(row.id)) return
        if (!isDueNow(row)) return
        if (!activeTrip && !dismissedOffers.current.has(row.id)) {
          setOffer((current) => (current?.status === 'requested' ? current : row))
        }
      }
      if (row.status === 'accepted' && row.driver_id === driverId) {
        if (isDueNow(row)) {
          setActiveTrip(row)
          setOffer((prev) => (prev?.id === row.id ? null : prev))
        } else {
          loadScheduled()
        }
      }
      if (ACTIVE_STATUSES.includes(row.status) && row.driver_id === driverId && isDueNow(row)) {
        setActiveTrip(row)
      }
      if (row.status === 'completed' && row.driver_id === driverId) {
        setActiveTrip(null)
        loadEarnings()
      }
      if (row.status === 'canceled' && offer?.id === row.id) {
        setOffer(null)
      }
      if ((row.status === 'canceled' || row.status === 'cancelled_wait') && activeTrip?.id === row.id) {
        setActiveTrip(null)
      }
    })
  }, [approved, offer?.id, activeTrip?.id, driverId, loadEarnings, loadScheduled])

  async function acceptOffer() {
    if (!approved) return
    if (!offer?.id || !supabase || !driverId) return
    try {
      const saved = await acceptTrip(supabase, offer, driverId)
      if (!saved?.id) {
        throw new Error('That ride is no longer available')
      }
      const kept = {
        ...offer,
        status: saved.status || 'accepted',
        driver_id: saved.driver_id || driverId,
        accepted_at: saved.accepted_at,
      }
      setActiveTrip(kept)
      setOffer(null)
      pushToast({
        kind: 'driver_accepted',
        title: 'Ride accepted',
        body: 'Head to pickup. The rider’s live trip updates from this accept.',
      })
    } catch (err) {
      pushToast({
        kind: 'system',
        title: 'Could not accept',
        body: err.message || 'That ride is no longer available.',
      })
    }
  }

  async function acceptScheduled(tripId) {
    if (!tripId || acceptingScheduledId) return
    setAcceptingScheduledId(tripId)
    try {
      const accepted = await acceptScheduledTrip(tripId)
      pushToast({
        kind: 'driver_accepted',
        title: 'Scheduled ride accepted',
        body: accepted?.acceptance_message || 'You are booked for this pickup.',
      })
      knownOpen.current.add(tripId)
      await loadScheduled()
      if (accepted && isDueNow(accepted)) {
        setActiveTrip({
          id: accepted.id,
          status: 'accepted',
          driver_id: driverId,
          fare_cents: accepted.fare_cents,
          pickup_label: accepted.pickup_label,
          dropoff_label: accepted.dropoff_label,
          pickup_at: accepted.pickup_at,
          rider_id: accepted.rider_id,
          accepted_at: accepted.accepted_at,
        })
        setOffer(null)
      }
    } catch (err) {
      pushToast({
        kind: 'system',
        title: 'Could not accept',
        body: err.message || 'That scheduled ride is no longer available.',
      })
    } finally {
      setAcceptingScheduledId(null)
    }
  }

  const futureMine = scheduledMine.filter((trip) => !isDueNow(trip))
  const scheduledLists = (withEmpty) => (
    <>
      <ScheduledRideQueue
        rides={scheduledOpen}
        acceptingId={acceptingScheduledId}
        onAccept={acceptScheduled}
        emptyHint={withEmpty ? 'No scheduled rides waiting. Weekend and party airport or campus pickups show up here after a rider confirms a time.' : undefined}
      />
      <ScheduledRideQueue
        rides={futureMine}
        title="Your upcoming"
        emptyHint={withEmpty ? 'Accepted pickups more than 45 minutes out stay in this list.' : undefined}
      />
    </>
  )

  async function declineOffer() {
    if (!offer?.id || !supabase) {
      setOffer(null)
      return
    }
    const current = offer
    dismissedOffers.current.add(current.id)
    try {
      await declineTrip(supabase, { id: current.id, status: current.status }, driverId)
      if (current.status !== 'requested') passedOffers.current.add(current.id)
      setOffer(null)
    } catch (err) {
      if (current.status === 'requested') {
        dismissedOffers.current.delete(current.id)
        pushToast({
          kind: 'system',
          title: 'Could not decline',
          body: err.message || 'This preferred request is still yours.',
        })
        return
      }
      passedOffers.current.add(current.id)
      setOffer(null)
      pushToast({
        kind: 'system',
        title: 'Passed for now',
        body: err.message || 'This ride stays in the open pool for another driver.',
      })
    }
  }

  async function advanceTrip(nextStatus) {
    if (!activeTrip?.id || !supabase || advancing) return
    setAdvancing(true)
    try {
      setAdvanceError(null)
      const patch = { status: nextStatus }
      if (nextStatus === 'completed') {
        try {
          await settleTrip({ tripId: activeTrip.id, action: 'complete' })
        } catch (err) {
          setPayFailure(err.failure || err.payload?.failure || {
            message: err.message || 'Payment required before this trip can complete',
            alternatives: ['retry', 'add_card', 'use_credits'],
          })
          setAdvanceError(err.message || 'Payment required before this trip can complete')
          return
        }
        patch.completed_at = new Date().toISOString()
      }
      const { data: saved, error } = await supabase
        .from('trips')
        .update(patch)
        .eq('id', activeTrip.id)
        .select('id, status, driver_id, completed_at')
        .maybeSingle()
      if (error) {
        console.error(error)
        setAdvanceError(error.message || 'Could not update this trip')
        return
      }
      if (!saved || saved.status !== nextStatus) {
        setAdvanceError(
          nextStatus === 'completed'
            ? 'This ride is not completed yet, so rating stays closed.'
            : 'Trip status did not update.',
        )
        return
      }
      await writeTripEvent(activeTrip.id, nextStatus, {
        driver_id: driverId,
        from: activeTrip.status,
        source: 'driver_home',
        ...(patch.completed_at ? { completed_at: patch.completed_at } : {}),
      })
      if (nextStatus === 'completed') {
        if (!saved.driver_id) {
          setAdvanceError('This trip has no driver yet, so it cannot be rated.')
          setActiveTrip({ ...activeTrip, ...saved })
          return
        }
        const doneId = saved.id
        // rider_social credits: DB trigger is the source of truth. This call is
        // idempotent and no-ops unless the rider's first ride just completed.
        if (doneId) grantRiderSocialForTrip(doneId)
        const applied = await applyTripDriverIncentives(doneId)
        if (!applied.ok) console.error('[driver_incentives]', applied.reason)
        setActiveTrip(null)
        await loadEarnings()
        if (doneId) navigate('rate', { trip: doneId })
      } else {
        setActiveTrip({ ...activeTrip, ...saved })
      }
    } finally {
      setAdvancing(false)
    }
  }

  if (application === undefined || !activeChecked) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        Checking driver approval…
      </div>
    )
  }

  if (!approved && !activeTrip) {
    return <DriverApprovalGate application={application} />
  }

  const showIdle = !offer && !activeTrip
  const scheduledNotDone = Boolean(activeTrip?.pickup_at) && activeTrip.status !== 'completed'
  const driverFix = selfPos ? { lat: selfPos[0], lng: selfPos[1] } : null
  const activeEta = activeTrip
    ? etaHoldLine(activeTrip.status, etaLineFor(activeTrip.status, driverFix, activeTrip))
    : null
  const activeStep = activeTrip ? DRIVER_TRACK_STEPS.findIndex((step) => step.id === activeTrip.status) : -1

  return (
    <div
      className="route-fade"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        minHeight: '100dvh',
        background: '#e8eaed',
        overflow: 'hidden',
      }}
    >
      <CampusMap
        height="100%"
        interactive
        showHeat={!activeTrip && showSurge}
        heatMode="surge"
        heatWindow={heatWindow}
        onHeatMeta={setHeatMeta}
        showMapTypeControl={!activeTrip}
        center={selfPos || (!scheduledNotDone && activeTrip?.pickup_lat != null ? [activeTrip.pickup_lat, activeTrip.pickup_lng] : CLEMSON)}
        zoom={13}
        marker={selfPos || CLEMSON}
        gameDayLabel={game.notice.live ? game.notice.headline : null}
        pickupPosition={
          scheduledNotDone
            ? null
            : activeTrip?.pickup_lat != null && activeTrip?.pickup_lng != null
              ? [Number(activeTrip.pickup_lat), Number(activeTrip.pickup_lng)]
              : activeTrip ? CLEMSON : null
        }
        selfPosition={selfPos}
        driverPosition={selfPos}
      />

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 20,
        }}
      >
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('landing')}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.72)',
            boxShadow: 'var(--shadow-pill)',
            fontSize: 18,
            backdropFilter: 'blur(18px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
            border: '1px solid rgba(255,255,255,0.55)',
          }}
        >
          ☰
        </button>
        <div
          style={{
            padding: '10px 18px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.72)',
            fontWeight: 700,
            fontSize: 17,
            boxShadow: 'var(--shadow-pill)',
            backdropFilter: 'blur(18px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
            border: '1px solid rgba(255,255,255,0.55)',
          }}
          title="Completed trip earnings"
        >
          <button type="button" className="pressable" onClick={() => navigate('earnings')} style={{ font: 'inherit', fontWeight: 700 }}>
            {centsToDollars(earningsCents)}
          </button>
        </div>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.72)',
            boxShadow: 'var(--shadow-pill)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            backdropFilter: 'blur(18px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
            border: '1px solid rgba(255,255,255,0.55)',
            color: online ? 'var(--success)' : 'var(--ink-tertiary)',
          }}
          title={online ? 'Online' : 'Offline'}
        >
          {online ? 'ON' : 'OFF'}
        </div>
      </div>

      
      {incentiveBanner && (
        <div style={{ position: 'absolute', top: 68, left: 16, right: 16, zIndex: 22 }}>
          <DriverIncentiveBanner text={incentiveBanner} />
        </div>
      )}

      {!activeTrip && (
        <div style={{ position: 'absolute', top: incentiveBanner ? 128 : 72, left: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto' }}>
            <GameDayStatus notice={game.notice} ready={game.ready} compact />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', pointerEvents: 'auto' }}>
            <button type="button" className="pressable" onClick={() => setShowSurge((v) => !v)}
              style={{ fontSize: 12, fontWeight: 700, color: showSurge ? '#fff' : 'var(--purple)',
                background: showSurge ? 'linear-gradient(135deg, #522D80 0%, #F56600 100%)' : 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(82,45,128,0.35)', borderRadius: 999, padding: '8px 12px', boxShadow: 'var(--shadow-pill)' }}>
              {showSurge ? 'Surge Zones · On' : 'Surge Zones · Off'}
            </button>
          </div>
          {showSurge && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', pointerEvents: 'auto' }}>
              {HEAT_WINDOWS.map((w) => (
                <button key={w.id} type="button" className="pressable" onClick={() => setHeatWindow(w.id)}
                  style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 999,
                    border: `1px solid ${heatWindow === w.id ? 'rgba(245,102,0,0.55)' : 'rgba(255,255,255,0.5)'}`,
                    background: heatWindow === w.id ? 'var(--orange-soft)' : 'rgba(255,255,255,0.85)',
                    color: heatWindow === w.id ? 'var(--orange)' : 'var(--purple)', boxShadow: 'var(--shadow-pill)' }}>
                  {w.label}
                </button>
              ))}
            </div>
          )}
          {showSurge && heatMeta?.caption && (
            <div style={{ pointerEvents: 'none', fontSize: 11, fontWeight: 600, color: 'var(--ink)', background: 'rgba(255,255,255,0.88)', borderRadius: 12, padding: '8px 10px', boxShadow: 'var(--shadow-pill)', alignSelf: 'flex-start', maxWidth: '92%' }}>
              {heatMeta.caption}{heatMeta.blended ? ' · Live + typical' : ''}
            </div>
          )}
        </div>
      )}

      {showIdle && (
        <div
          className="sheet glass-panel--elevated"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 20,
            padding: '12px 20px calc(20px + var(--safe-bottom))',
            borderTop: '1px solid rgba(255,255,255,0.65)',
            maxHeight: '55%',
            overflowY: 'auto',
          }}
        >
          <div className="sheet-handle" />
          {scheduledLists(true)}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span
              className="driver-online-dot"
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--success)',
                boxShadow: '0 0 0 3px rgba(31,138,76,0.2)',
              }}
            />
            <span style={{ fontWeight: 600, fontSize: 18 }}>You're online</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12 }}>
            Looking for rides in Clemson. Carpool offers pay more than a solo trip — take those first.
          </p>
          <div style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(245,102,0,0.14), rgba(82,45,128,0.12))',
            border: '1px solid rgba(245,102,0,0.35)',
          }}>
            <div style={{ fontWeight: 800, color: 'var(--purple)' }}>Carpool bonus</div>
            <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '4px 0 0', lineHeight: 1.45 }}>
              Multi-rider hops pay you 80% of the pool, which is built to beat a solo fare plus a
              <strong> driver_carpool_bonus</strong> ($2 per extra rider and $0.40 per mile). Riders see their split before anyone is charged.
            </p>
            <button type="button" className="pressable" onClick={() => navigate('carpool', { drive: '1' })}
              style={{ marginTop: 8, fontWeight: 800, color: '#F56600' }}>
              Offer seats in your car →
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderTop: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>Priority Mode</div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>Higher-value rides first</div>
            </div>
            <button
              type="button"
              className="pressable"
              onClick={() => setPriority((p) => !p)}
              style={{
                width: 52,
                height: 30,
                borderRadius: 999,
                background: priority ? 'var(--purple)' : 'var(--border)',
                position: 'relative',
                transition: 'background 220ms var(--ease-soft)',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: priority ? 24 : 3,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: 'var(--shadow-pill)',
                  transition: 'left 220ms var(--ease-spring)',
                }}
              />
            </button>
          </div>

          <div style={{ padding: '12px 0 4px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Unlock Silver</span>
              <span style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
                {silverProgress}/{silverTotal}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-muted)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(silverProgress / silverTotal) * 100}%`,
                  height: '100%',
                  background: 'var(--orange)',
                  borderRadius: 999,
                  transition: 'width 400ms var(--ease-out)',
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8 }}>
              Complete {silverTotal - silverProgress} more trips for Silver perks
            </p>
          </div>

          {incentiveExtraCents > 0 && (
            <p style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700, marginTop: 8 }}>
              Includes {centsToDollars(incentiveExtraCents)} driver incentive on top of your 80% share.
            </p>
          )}

          {canEditIncentives && (
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('incentives')}
              style={{ marginTop: 12, fontWeight: 700, color: 'var(--purple)' }}
            >
              Edit driver incentives
            </button>
          )}

          {recentCompleted.length > 0 && (
            <div style={{ padding: '12px 0 4px', borderTop: '1px solid var(--border)', marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>Recent earnings</div>
                <button type="button" className="pressable" onClick={() => navigate('history')} style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>
                  Rides history
                </button>
              </div>
              {recentCompleted.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    padding: '6px 0',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '58%' }}>
                    {t.dropoff_label || 'Trip'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" className="pressable" onClick={() => navigate('lost-found', { trip: t.id })} style={{ fontWeight: 700, color: 'var(--orange)', fontSize: 12 }}>
                      Lost item
                    </button>
                    <strong style={{ color: 'var(--ink)' }}>
                      {centsToDollars(driverTakeCents(t))}
                      {extraByTrip[t.id] ? (
                        <span style={{ color: '#F56600' }}> +{centsToDollars(extraByTrip[t.id])}</span>
                      ) : null}
                    </strong>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {offer && !activeTrip && (
        <div
          className="sheet glass-panel--elevated"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            padding: '12px 20px calc(24px + var(--safe-bottom))',
            borderTop: '1px solid rgba(255,255,255,0.65)',
          }}
        >
          <div className="sheet-handle" />
          <div style={{ maxHeight: 168, overflowY: 'auto', marginBottom: 8 }}>{scheduledLists(false)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
              {centsToDollars(driverTakeCents(offer))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
              {offer.metadata?.carpool ? 'You net · carpool' : 'Live offer'}
            </div>
          </div>
          {offer.metadata?.carpool && (
            <p style={{ fontSize: 13, color: 'var(--purple)', margin: '8px 0 0', lineHeight: 1.4, fontWeight: 700 }}>
              {driverOfferCopy(offer.metadata.carpool)?.sub}. Riders already agreed to {formatUsd(offer.metadata.carpool.grossCents)} total.
            </p>
          )}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--orange)', fontWeight: 700 }}>●</span>
              <div>
                <div style={{ fontWeight: 600 }}>Pickup</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{offer.pickup_label}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}>■</span>
              <div>
                <div style={{ fontWeight: 600 }}>Dropoff</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{offer.dropoff_label}</div>
              </div>
            </div>
          </div>
          {offer.status === 'requested' && (
            <p style={{ color: 'var(--orange)', fontWeight: 700, fontSize: 13, lineHeight: 1.4, marginTop: 10 }}>
              {PREFERRED_REQUEST_NOTE}
            </p>
          )}
          <TeslaNotice row={offer} />
          <PurpleAcceptButton onClick={acceptOffer}>{acceptActionLabel(offer.status)}</PurpleAcceptButton>
          <button
            type="button"
            className="pressable"
            onClick={declineOffer}
            style={{ width: '100%', marginTop: 10, padding: 12, fontWeight: 700, color: offer.status === 'requested' ? 'var(--orange)' : 'var(--ink-secondary)' }}
          >
            {declineActionLabel(offer.status)}
          </button>
        </div>
      )}

      {activeTrip && (
        <div
          className="sheet glass-panel--elevated"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            padding: '12px 20px calc(24px + var(--safe-bottom))',
            borderTop: '1px solid rgba(255,255,255,0.65)',
          }}
        >
          <div className="sheet-handle" />
          <div style={{ maxHeight: 168, overflowY: 'auto', marginBottom: 8 }}>{scheduledLists(false)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
              {centsToDollars(activeTrip.fare_cents)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 800, letterSpacing: 1 }}>
              LIVE TRIP
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {/* TODO: road tiles and a traffic ETA need a billed Maps key. This card uses coordinates already on the trip. */}
            <LivePhase
              title={statusHeadline(activeTrip.status)}
              body={driverStatusDetail(activeTrip.status)}
              eta={activeEta}
              steps={DRIVER_TRACK_STEPS}
              activeIndex={activeStep}
            />
          </div>
          <TeslaNotice row={activeTrip} />
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--orange)', fontWeight: 700 }}>●</span>
              <div>
                <div style={{ fontWeight: 600 }}>Pickup</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{activeTrip.pickup_label}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}>■</span>
              <div>
                <div style={{ fontWeight: 600 }}>Dropoff</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{activeTrip.dropoff_label}</div>
              </div>
            </div>
          </div>

          {rideChatMode(activeTrip) !== 'closed' && activeTrip.rider_id && (
            <div style={{ marginTop: 16 }}>
              <RideMessageButton onClick={() => setChatTrip(activeTrip)} />
            </div>
          )}
          {activeTrip.status === 'accepted' && (
            <PurpleAcceptButton onClick={() => advanceTrip('arriving')} disabled={advancing}>
              {advancing ? 'Updating…' : 'Arriving'}
            </PurpleAcceptButton>
          )}
          {(activeTrip.status === 'arriving' || activeTrip.status === 'arrived') && (
            <WaitFeeCard
              trip={activeTrip}
              quote={wait.quote}
              role="driver"
              busy={wait.busy}
              error={wait.error}
              charge={wait.charge}
              onStart={() => wait.act('arrive')}
              onCancel={() => wait.act('cancel')}
            />
          )}
          {activeTrip.status === 'arrived' && (
            <PurpleAcceptButton onClick={() => advanceTrip('in_progress')} disabled={advancing}>
              {advancing ? 'Updating…' : 'Start trip'}
            </PurpleAcceptButton>
          )}
          {activeTrip.status === 'in_progress' && (
            <PurpleAcceptButton onClick={() => advanceTrip('completed')} disabled={advancing}>
              {advancing ? 'Updating…' : 'Complete'}
            </PurpleAcceptButton>
          )}
          {advanceError && (
            <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{advanceError}</p>
          )}
          {activeTrip.rider_id && PARTY_VISIBLE_STATUSES.includes(activeTrip.status) && (
            <CounterpartChip
              profileId={activeTrip.rider_id}
              noun="rider"
              onOpen={() => navigate('profile', { id: activeTrip.rider_id, matched: '1' })}
            />
          )}
          {activeTrip.status === 'completed' && (
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('rate', { trip: activeTrip.id })}
              style={{ marginTop: 8, fontWeight: 800, color: '#F56600' }}
            >
              Rate your rider
            </button>
          )}

        </div>
      )}
      {activeTrip?.id && (
        <SosControl tripId={activeTrip.id} viewerRole="driver" knownActive insetTop={76} />
      )}
      <PaymentFailedSheet
        failure={payFailure}
        busy={advancing}
        onRetry={() => { setPayFailure(null); advanceTrip('completed') }}
        onAddCard={() => navigate('account', { tab: 'billing' })}
        onUseCredits={() => navigate('account', { tab: 'billing' })}
        onBuyCredits={() => navigate('account', { tab: 'billing' })}
        onDismiss={() => setPayFailure(null)}
      />
      {chatTrip && driverId && (
        <RideChat
          tripId={chatTrip.id}
          userId={driverId}
          initialTrip={chatTrip}
          onClose={() => setChatTrip(null)}
        />
      )}
    </div>
  )
}
