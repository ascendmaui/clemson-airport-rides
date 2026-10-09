import { onTrackingResume, createTrackingRefresh } from '../../packages/rides-native/tracking.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { DriverDeskHeader } from '../components/DriverDeskHeader'
import { GameDayStatus } from '../components/GameDayStatus'
import { useGameDayNotice } from '../lib/useGameDayNotice'
import { DriverIncentiveBanner, useDriverIncentiveWatch } from '../components/DriverIncentiveBanner'
import { HEAT_WINDOWS, loadMapType, saveMapType } from '../lib/rideDemand'
import { PurpleAcceptButton } from '../components/PrimaryButton'
import { ScheduledRideQueue } from '../components/ScheduledRideQueue'
import { navigate } from '../lib/navigation'
import { setDriverOnline, subscribeTrips, supabase } from '../lib/supabase'
import { canReceiveOffers, isOnShift, startShift, stopShift, visibleOffer } from '../lib/driverShift'
import { DriverShiftControl } from '../components/DriverShiftControl'
import { grantRiderSocialForTrip } from '../lib/riderReferral'
import { isLiveTrip, startTripLocationWatch } from '../lib/liveDriverLocation'
import { DriverApprovalGate } from './DriverApprovalGate'
import { driverOfferCopy, driverTakeCents, formatUsd } from '../lib/carpoolEngine'
import { driverBoostOfferLine } from '../../shared/copy/boost.js'
import { driverBoostShareCents, formatBoostBadge, readBoostCents } from '../../shared/scheduledBoost.js'
import { RideChat, RideMessageButton } from '../components/RideChat'
import { ReportLostItemButton } from '../components/ReportLostItem'
import { rideChatMode } from '../lib/tripChatRules'
import { SosControl } from '../components/SosControl'
import { applyTripDriverIncentives, fetchDriverIncentiveExtras } from '../lib/driverIncentives'
import { isIncentiveAdmin } from '../lib/driverIncentiveMath'
import { fetchFullProfile } from '../lib/profiles'
import { CounterpartChip } from '../components/CounterpartChip'
import { PARTY_VISIBLE_STATUSES } from '../../packages/rides-native/partyProfile.js'
import { useTripWait } from '../lib/useTripWait'
import { tripWaitAction } from '../lib/tripWaitApi'
import { WaitFeeCard } from '../components/WaitFeeCard'
import { api, settleTrip } from '../lib/payments'
import { PaymentFailedSheet } from '../components/PaymentFailedSheet'
import { formatPickupAt, isDueNow } from '../lib/scheduledRideModel'
import {
  acceptScheduledTrip,
  listDriverScheduledTrips,
  listOpenScheduledTrips,
  postBackupQueue,
  reminderCopy,
  takeReminder,
} from '../lib/scheduledRides'
import { pushToast } from '../lib/toasts'
import { playRideRequestAlert, shouldAlertForRide } from '../lib/rideAlert'
import { loadLocalPrefs } from '../lib/notificationPrefs'
import { offerVisibleToDriver, visibleOfferQuery } from '../../shared/driverOrder.js'
import { readBackupQueue } from '../../shared/backupDriverQueue.js'
import { driverRouteForOnboarding } from '../../shared/driverRoute.js'
import { isStaleLiveOffer } from '../../shared/staleLiveOffer.js'
import { acceptTrip, declineTrip, listPassedTripIds } from '../../packages/rides-native/driverDesk.js'
import {
  acceptActionLabel,
  declineActionLabel,
  PREFERRED_REQUEST_NOTE,
  driverStatusDetail,
  statusActionLabel,
  statusHeadline,
  isUnpaidAirportDepositTrip,
  comfortFleetNotice,
  tripTags,
} from '../../packages/rides-native/tripTags.js'
import { DRIVER_TRACK_STEPS, etaHoldLine } from '../../packages/rides-native/liveTrip.js'
import { directionsEtaLine, followEtaLine, followRouteLine, legNounForStatus, storedRoadSuffix } from '../../packages/rides-native/roadFollow.js'
import { navigationLinks, preferredNavigationUrl } from '../../packages/rides-native/mapsLink.js'
import { leaveNowStartedLine, MAPS_HANDOFF_HELPER } from '../../shared/copy/scheduledRides.js'
import { ScheduledRidesExplainer } from '../components/ScheduledRidesInfo'
import { useDrivingLeg } from '../lib/useDrivingLeg'
import { LivePhase } from '../components/LivePhase'

function ComfortNotice({ row }) {
  const notice = comfortFleetNotice(tripTags(row).includes('comfort'))
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

export function DriverHome({ openChatTripId = '' }) {
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
  const [shiftBusy, setShiftBusy] = useState(false)
  const [presenceReady, setPresenceReady] = useState(false)
  const onShiftRef = useRef(false)
  onShiftRef.current = online
  const [earningsCents, setEarningsCents] = useState(0)
  const [incentiveExtraCents, setIncentiveExtraCents] = useState(0)
  const [extraByTrip, setExtraByTrip] = useState({})
  const [recentCompleted, setRecentCompleted] = useState([])
  const [canEditIncentives, setCanEditIncentives] = useState(() => isIncentiveAdmin(user, null))
  const { banner: incentiveBanner } = useDriverIncentiveWatch({ driverId, online })
  const [advancing, setAdvancing] = useState(false)
  const [advanceError, setAdvanceError] = useState(null)
  const [selfPos, setSelfPos] = useState(null)
  const [selfHeading, setSelfHeading] = useState(null)
  const [mapTypeId, setMapTypeId] = useState(() => loadMapType())
  const [showSurge, setShowSurge] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [heatMeta, setHeatMeta] = useState(null)
  const [application, setApplication] = useState(undefined)
  const [applicationError, setApplicationError] = useState(null)
  const [approvalAttempt, setApprovalAttempt] = useState(0)
  const [activeChecked, setActiveChecked] = useState(false)
  const approved = driverRouteForOnboarding(application?.onboarding_status) === 'driver'
  const [chatTrip, setChatTrip] = useState(null)
  useEffect(() => {
    if (!openChatTripId) return
    setChatTrip({ id: openChatTripId })
  }, [openChatTripId])
  const [scheduledOpen, setScheduledOpen] = useState([])
  const [scheduledMine, setScheduledMine] = useState([])
  const offerRevision = useRef(0)
  const [acceptingScheduledId, setAcceptingScheduledId] = useState(null)
  const dismissedOffers = useRef(new Set())
  const passedOffers = useRef(new Set())
  const knownOpen = useRef(new Set())
  const scheduledPrimed = useRef(false)
  const offeredMarked = useRef(new Set())
  const chimedOffers = useRef(new Set())
  const chimePrimed = useRef(false)

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
      setApplicationError(null)
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
          setApplicationError(error.message || 'Could not check driver approval')
          setApplication((prev) => (prev && prev.onboarding_status ? prev : null))
          return
        }
        setApplicationError(null)
        setApplication(data)
      })
    return () => {
      alive = false
    }
  }, [driverId, approvalAttempt])

  useEffect(() => {
    if (!driverId || !approved || !supabase) return undefined
    let alive = true
    setPresenceReady(false)
    supabase
      .from('driver_status')
      .select('online')
      .eq('driver_id', driverId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        setOnline(!error && isOnShift(data))
        setPresenceReady(true)
      })
      .catch(() => {
        if (!alive) return
        setOnline(false)
        setPresenceReady(true)
      })
    return () => {
      alive = false
    }
  }, [driverId, approved])

  const [locationError, setLocationError] = useState(null)
  const [locationAttempt, setLocationAttempt] = useState(0)
  useEffect(() => {
    const liveTripId = activeTrip?.id && isLiveTrip(activeTrip.status) ? activeTrip.id : null
    const backupEnroute = readBackupQueue(activeTrip)?.confirmState === 'enroute'
    const tracking = Boolean(approved && (online || liveTripId))
    if (!driverId || !tracking || (!presenceReady && !liveTripId)) return undefined
    const stop = startTripLocationWatch({
      tripId: liveTripId && (online || backupEnroute) ? liveTripId : null,
      driverId,
      onFix: (pos) => {
        setSelfPos([pos.coords.latitude, pos.coords.longitude])
        const heading = Number(pos.coords.heading)
        setSelfHeading(Number.isFinite(heading) && heading >= 0 ? heading : null)
      },
      onError: setLocationError,
    })
    const offResume = onTrackingResume(() => setLocationAttempt((n) => n + 1))
    return () => { stop(); offResume() }
  }, [driverId, approved, activeTrip?.id, activeTrip?.status, online, presenceReady, locationAttempt])

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
      const seatForMe = (row) => {
        const queue = readBackupQueue(row)
        return queue && (queue.primaryDriverId === driverId || queue.backupDriverId === driverId)
      }
      const pool = open.filter((row) => {
        const queue = readBackupQueue(row)
        if (!queue) return true
        if (seatForMe(row)) return false
        return !(queue.primaryDriverId && queue.backupDriverId)
      })
      const receiving = onShiftRef.current
      setScheduledOpen(receiving ? pool : [])
      setScheduledMine([...mine, ...open.filter(seatForMe)])
      if (!scheduledPrimed.current || !receiving) {
        open.forEach((row) => knownOpen.current.add(row.id))
        scheduledPrimed.current = true
      } else {
        open.forEach((row) => {
          knownOpen.current.add(row.id)
        })
      }
      if (receiving) {
        open.forEach((row) => {
          const decision = takeReminder(row, new Date(), { windows: ['h1', 'm15', 'now'] })
          if (!decision) return
          const copy = reminderCopy(row, decision)
          pushToast({ ...copy, kind: 'ride_scheduled', title: 'Scheduled ride still open' })
        })
      }
    } catch (err) {
      console.error('[scheduled]', err.message)
    }
  }, [driverId])

  useEffect(() => {
    loadScheduled()
    const timer = setInterval(loadScheduled, 20000)
    return () => clearInterval(timer)
  }, [loadScheduled])

  // Poll while this approved driver is online. Realtime is best-effort.
  // mark-offered uses the service role so searching can become offered
  // without claiming driver_id. The client update fails RLS.
  useEffect(() => {
    if (!supabase || !canReceiveOffers({ onShift: online, approved })) {
      setOffer(null)
      return undefined
    }
    let alive = true
    chimePrimed.current = false
    function noteChime(rows) {
      const fresh = rows.filter((row) => row?.id && !chimedOffers.current.has(row.id))
      if (!chimePrimed.current) {
        rows.forEach((row) => {
          if (row?.id) chimedOffers.current.add(row.id)
        })
        chimePrimed.current = true
        return
      }
      if (!fresh.length) return
      fresh.forEach((row) => chimedOffers.current.add(row.id))
      if (shouldAlertForRide(loadLocalPrefs(driverId))) {
        playRideRequestAlert().catch(() => {})
      }
    }
    function markSearchingOffer(row) {
      if (!row?.id || row.status !== 'searching' || row.driver_id) return
      if (offeredMarked.current.has(row.id)) return
      offeredMarked.current.add(row.id)
      api('/api/driver?action=mark-offered', { tripId: row.id }).catch(() => {
        offeredMarked.current.delete(row.id)
      })
    }
    async function loadOffers() {
      if (!onShiftRef.current) return
      const revision = ++offerRevision.current
      const open = await visibleOfferQuery(supabase
        .from('trips')
        .select('*')
        .in('status', ['searching', 'offered']), driverId)
        .order('requested_at', { ascending: false })
        .limit(8)
      if (!alive || !onShiftRef.current || revision !== offerRevision.current || open.error) return
      if (driverId) {
        const passed = await listPassedTripIds(supabase, driverId)
        if (!alive || !onShiftRef.current) return
        if (revision !== offerRevision.current) return
        passedOffers.current = new Set(passed)
      }
      const rows = (open.data || []).filter((candidate) => (
        isDueNow(candidate)
        && !passedOffers.current.has(candidate.id)
        && !dismissedOffers.current.has(candidate.id)
        && offerVisibleToDriver(candidate, driverId)
        && !isUnpaidAirportDepositTrip(candidate)
        && !isStaleLiveOffer(candidate)
      ))
      noteChime(rows)
      const row = rows[0]
      if (!row) {
        setOffer((current) => (
          current && rows.some((item) => item.id === current.id) ? current : null
        ))
        return
      }
      setOffer(row)
      markSearchingOffer(row)
    }
    loadOffers()
    const timer = setInterval(loadOffers, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [driverId, approved, online])

  // Poll/load active trips for this driver so E2E accepted trips appear without re-offer.
  useEffect(() => {
    if (!supabase || !driverId) {
      setActiveChecked(true)
      return undefined
    }
    const reader = createTrackingRefresh({
      load: async () => {
        const { data, error } = await supabase.from('trips').select('*')
          .eq('driver_id', driverId).in('status', ACTIVE_STATUSES)
          .order('accepted_at', { ascending: false }).limit(8)
        if (error) throw error
        return (data || []).find((trip) => isDueNow(trip) || readBackupQueue(trip)?.confirmState === 'enroute') || null
      },
      onData: (row) => {
        offerRevision.current += 1
        setActiveTrip(row)
        if (row) setOffer((prev) => (prev?.id === row.id ? null : prev))
        setActiveChecked(true)
      },
      onError: () => {},
    })
    void reader.refresh()
    const timer = setInterval(() => void reader.refresh(), 8000)
    const offResume = onTrackingResume(() => void reader.refresh(true))
    return () => { reader.stop(); offResume(); clearInterval(timer) }
  }, [driverId])

  useEffect(() => {
    if (!approved) return undefined
    return subscribeTrips((payload) => {
      const row = payload?.new || payload?.record
      if (!row) return
      offerRevision.current += 1
      if (isStaleLiveOffer(row)) {
        setOffer((current) => (current?.id === row.id ? null : current))
        return
      }
      if (!['searching', 'offered'].includes(row.status) || !offerVisibleToDriver(row, driverId)) {
        setOffer((current) => current?.id === row.id ? null : current)
      }
      if (row.status === 'scheduled') {
        loadScheduled()
      }
      if (row.status === 'requested' && row.driver_id === driverId && onShiftRef.current && !activeTrip && !dismissedOffers.current.has(row.id)) {
        setOffer(row)
      }
      if (row.status === 'searching' || row.status === 'offered') {
        if (!onShiftRef.current) return
        if (!offerVisibleToDriver(row, driverId)) return
        if (isUnpaidAirportDepositTrip(row)) return
        if (passedOffers.current.has(row.id)) return
        if (!isDueNow(row) || isStaleLiveOffer(row)) return
        if (!activeTrip && !dismissedOffers.current.has(row.id)) {
          if (
            chimePrimed.current
            && row.id
            && !chimedOffers.current.has(row.id)
            && shouldAlertForRide(loadLocalPrefs(driverId))
          ) {
            chimedOffers.current.add(row.id)
            playRideRequestAlert().catch(() => {})
          } else if (row.id) {
            chimedOffers.current.add(row.id)
          }
          setOffer((current) => (current?.status === 'requested' ? current : row))
          if (row.status === 'searching' && !row.driver_id && !offeredMarked.current.has(row.id)) {
            offeredMarked.current.add(row.id)
            api('/api/driver?action=mark-offered', { tripId: row.id }).catch(() => {
              offeredMarked.current.delete(row.id)
            })
          }
        }
      }
      if (row.status === 'accepted' && row.driver_id === driverId) {
        if (isDueNow(row) || readBackupQueue(row)?.confirmState === 'enroute') {
          setActiveTrip(row)
          setOffer((prev) => (prev?.id === row.id ? null : prev))
        } else {
          loadScheduled()
        }
      }
      if (ACTIVE_STATUSES.includes(row.status) && row.driver_id === driverId && (isDueNow(row) || readBackupQueue(row)?.confirmState === 'enroute')) {
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
  }, [approved, online, offer?.id, activeTrip?.id, driverId, loadEarnings, loadScheduled])

  async function acceptOffer() {
    if (!approved) return
    if (!canReceiveOffers({ onShift: online, approved })) {
      pushToast({
        kind: 'system',
        title: 'Start a shift first',
        body: 'Start your shift before accepting a ride.',
      })
      return
    }
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
      offerRevision.current += 1
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
      const row = scheduledOpen.find((ride) => ride.id === tripId)
      const accepted = await acceptScheduledTrip(tripId, { backup: Boolean(readBackupQueue(row)) })
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

  const futureMine = scheduledMine.filter((trip) => {
    const queue = readBackupQueue(trip)
    const mine = queue && (queue.primaryDriverId === driverId || queue.backupDriverId === driverId)
    if (mine && queue.confirmState !== 'enroute') return true
    return !isDueNow(trip)
  })
  async function setShift(next) {
    if (!driverId || shiftBusy) return
    const change = next ? startShift() : stopShift({ trip: activeTrip })
    const previous = onShiftRef.current
    const nextOnline = Boolean(change.presence.online)
    onShiftRef.current = nextOnline
    setShiftBusy(true)
    try {
      await setDriverOnline(driverId, change.presence.online)
      setOnline(nextOnline)
      if (!nextOnline) {
        setOffer(null)
        setScheduledOpen([])
      } else {
        loadScheduled()
      }
    } catch (err) {
      onShiftRef.current = previous
      pushToast({
        kind: 'system',
        title: 'Could not change your shift',
        body: err.message || 'Try again.',
      })
    } finally {
      setShiftBusy(false)
    }
  }

  async function releaseScheduled(tripId, role) {
    if (!tripId) return
    try {
      await postBackupQueue(role === 'backup' ? 'release' : 'cancel', tripId)
      pushToast({
        kind: 'system',
        title: role === 'backup' ? 'Backup seat released' : 'Trip released',
        body: role === 'backup'
          ? 'The backup seat is open again.'
          : 'The backup driver is up if one was in line.',
      })
      await loadScheduled()
    } catch (err) {
      pushToast({
        kind: 'system',
        title: 'Could not release',
        body: err.message || 'Try again.',
      })
    }
  }

  async function confirmScheduled(tripId) {
    if (!tripId) return
    try {
      await postBackupQueue('confirm', tripId)
      pushToast({
        kind: 'driver_accepted',
        title: 'Trip confirmed',
        body: 'A countdown will tell you when to leave. Navigation starts on its own.',
      })
      await loadScheduled()
    } catch (err) {
      pushToast({
        kind: 'system',
        title: 'Could not confirm',
        body: err.message || 'Try again.',
      })
    }
  }

  const departScheduled = useCallback(async (tripId) => {
    if (!tripId || !supabase) return
    try {
      await postBackupQueue('navigate', tripId)
      const { data } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle()
      if (data && data.driver_id === driverId && isLiveTrip(data.status)) setActiveTrip(data)
      pushToast({
        kind: 'driver_accepted',
        title: 'Leave now',
        body: leaveNowStartedLine(),
      })
      await loadScheduled()
    } catch (err) {
      pushToast({
        kind: 'system',
        title: 'Could not start navigation',
        body: err.message || 'Try again.',
      })
    }
  }, [driverId, loadScheduled])

  const scheduledLists = (withEmpty) => (
    <>
      <ScheduledRidesExplainer role="driver" />
      {online && (
      <ScheduledRideQueue
        rides={scheduledOpen}
        acceptingId={acceptingScheduledId}
        onAccept={acceptScheduled}
        viewerId={driverId}
        emptyHint={withEmpty ? 'No scheduled rides waiting. Weekend and party airport or campus pickups show up here after a rider confirms a time.' : undefined}
      />
      )}
      <ScheduledRideQueue
        rides={futureMine}
        title="Your upcoming"
        viewerId={driverId}
        onConfirm={confirmScheduled}
        onDepart={departScheduled}
        onRelease={releaseScheduled}
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
      await api('/api/driver?action=pass-offer', { tripId: current.id })
      const matching = current.metadata?.kind === 'driver_request' && !current.pickup_at
        && !current.scheduled_for && !Number(current.deposit_cents || 0)
      if (!matching) await declineTrip(supabase, current, driverId)
      if (current.status !== 'requested') passedOffers.current.add(current.id)
      setOffer(null)
    } catch (err) {
      dismissedOffers.current.delete(current.id)
      pushToast({ kind: 'system', title: 'Could not decline',
        body: err.message || 'Please refresh and try again.' })
    }
  }

  async function markArrived() {
    if (!activeTrip?.id || !supabase || advancing) return
    setAdvancing(true)
    setAdvanceError(null)
    try {
      let next = null
      try {
        const res = await tripWaitAction('arrive', activeTrip.id)
        next = res?.trip || null
      } catch (err) {
        if (!err.network && !err.unavailable) {
          setAdvanceError(err.message || 'Could not mark arrived')
          return
        }
      }
      if (next?.status === 'arrived') {
        setActiveTrip((prev) => (prev && prev.id === activeTrip.id ? { ...prev, ...next } : prev))
        return
      }
      const { data: saved, error } = await supabase
        .from('trips')
        .update({ status: 'arrived' })
        .eq('id', activeTrip.id)
        .eq('driver_id', driverId)
        .select('id, status, driver_id, arrived_at')
        .maybeSingle()
      if (error || saved?.status !== 'arrived') {
        setAdvanceError(error?.message || 'Could not mark arrived')
        return
      }
      await writeTripEvent(activeTrip.id, 'arrived', {
        driver_id: driverId,
        from: activeTrip.status,
        source: 'driver_home',
      })
      setActiveTrip((prev) => (prev && prev.id === activeTrip.id ? { ...prev, ...saved } : prev))
    } finally {
      setAdvancing(false)
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

  const driverFix = selfPos ? { lat: selfPos[0], lng: selfPos[1] } : null
  const snappedRoad = storedRoadSuffix(activeTrip, driverFix)
  const legNoun = legNounForStatus(activeTrip?.status)
  const legDest = legNoun === 'drop-off'
    ? (activeTrip?.dropoff_lat != null && activeTrip?.dropoff_lng != null
      ? [Number(activeTrip.dropoff_lat), Number(activeTrip.dropoff_lng)]
      : null)
    : legNoun === 'pickup'
      ? (activeTrip?.pickup_lat != null && activeTrip?.pickup_lng != null
        ? [Number(activeTrip.pickup_lat), Number(activeTrip.pickup_lng)]
        : null)
      : null
  const drivingLeg = useDrivingLeg(
    selfPos,
    legDest,
    Boolean(activeTrip && selfPos && legDest && !snappedRoad),
  )

  if (application === undefined || !activeChecked) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        Checking driver approval…
      </div>
    )
  }

  if (applicationError && !approved && !activeTrip) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ fontWeight: 700, marginBottom: 8 }}>Could not check driver approval</p>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 16 }}>{applicationError}</p>
        <button
          type="button"
          className="pressable"
          onClick={() => setApprovalAttempt((n) => n + 1)}
          style={{ fontWeight: 800, color: '#F56600' }}
        >
          Try again
        </button>
      </div>
    )
  }

  if (!approved && !activeTrip) {
    return <DriverApprovalGate application={application} />
  }

  const shownOffer = visibleOffer({ onShift: online, offer, activeTrip })
  const showIdle = !shownOffer && !activeTrip
  const headingToPickup = Boolean(activeTrip) && ['accepted', 'arriving', 'arrived'].includes(activeTrip.status)
  const scheduledNotDone = Boolean(activeTrip?.pickup_at) && activeTrip.status !== 'completed'
  const followedEta = activeTrip ? followEtaLine(activeTrip.status, driverFix, activeTrip) : null
  const roadEta = activeTrip && !snappedRoad && legNoun
    ? directionsEtaLine({ meters: drivingLeg?.meters, seconds: drivingLeg?.seconds, noun: legNoun })
    : null
  const activeEta = activeTrip ? etaHoldLine(activeTrip.status, roadEta || followedEta) : null
  const followedRoute = activeTrip ? followRouteLine(activeTrip, driverFix) : []
  const activeRoute = activeTrip && !snappedRoad && drivingLeg?.path?.length > 1 ? drivingLeg.path : followedRoute
  const headingToDropoff = Boolean(activeTrip) && ['in_progress', 'completed'].includes(activeTrip.status)
  const navStop = !activeTrip
    ? null
    : headingToDropoff
      ? {
        latitude: activeTrip.dropoff_lat,
        longitude: activeTrip.dropoff_lng,
        label: activeTrip.dropoff_label || 'Drop-off',
      }
      : {
        latitude: activeTrip.pickup_lat,
        longitude: activeTrip.pickup_lng,
        label: activeTrip.pickup_label || 'Pickup',
      }
  const navHref = navStop && activeTrip && !['completed', 'canceled', 'cancelled_wait'].includes(activeTrip.status)
    ? preferredNavigationUrl(navStop, typeof navigator !== 'undefined' ? navigator.userAgent : '')
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
        mapTypeId={mapTypeId}
        center={
          activeTrip
            ? (activeTrip.pickup_lat != null
              ? [Number(activeTrip.pickup_lat), Number(activeTrip.pickup_lng)]
              : CLEMSON)
            : (selfPos || CLEMSON)
        }
        zoom={13}
        marker={selfPos || CLEMSON}
        animateDriver={Boolean(selfPos)}
        driverHeading={selfHeading}
        gameDayLabel={game.notice.live ? game.notice.headline : null}
        pickupPosition={
          scheduledNotDone
            ? null
            : activeTrip?.pickup_lat != null && activeTrip?.pickup_lng != null
              ? [Number(activeTrip.pickup_lat), Number(activeTrip.pickup_lng)]
              : activeTrip ? CLEMSON : null
        }
        dropoffPosition={
          activeTrip?.dropoff_lat != null && activeTrip?.dropoff_lng != null
            ? [Number(activeTrip.dropoff_lat), Number(activeTrip.dropoff_lng)]
            : null
        }
        route={activeRoute.length > 1 ? activeRoute : null}
        fitRoute={Boolean(activeTrip && activeRoute.length > 1)}
        selfPosition={selfPos}
        driverPosition={selfPos}
      />

      <DriverDeskHeader
        earningsLabel={centsToDollars(earningsCents)}
        onMenu={() => navigate('landing')}
        onEarnings={() => navigate('earnings')}
        showMapType={!activeTrip}
        mapTypeId={mapTypeId}
        onMapTypeChange={(id) => {
          const next = id === 'satellite' || id === 'hybrid' ? id : 'roadmap'
          setMapTypeId(next)
          saveMapType(next)
        }}
        showShift={Boolean(shownOffer || activeTrip)}
        onShift={online}
        shiftBusy={shiftBusy}
        onStartShift={() => setShift(true)}
        onStopShift={() => setShift(false)}
        showLocate={headingToPickup}
        onLocate={() => {
          if (!navigator.geolocation) return
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setSelfPos([pos.coords.latitude, pos.coords.longitude])
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
          )
        }}
      />

      
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
          <DriverShiftControl
            onShift={online}
            busy={shiftBusy}
            onStart={() => setShift(true)}
            onStop={() => setShift(false)}
          />
          {online && (
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12 }}>
            Carpool offers pay more than a solo trip — take those first.
          </p>
          )}
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
                    <ReportLostItemButton
                      trip={{ id: t.id, status: 'completed', completed_at: t.completed_at, driver_id: driverId }}
                      userId={driverId}
                      onOpened={() => setChatTrip({ id: t.id, status: 'completed', completed_at: t.completed_at, driver_id: driverId })}
                    />
                    <strong style={{ color: 'var(--ink)' }}>
                      {centsToDollars(driverTakeCents(t))}
                      {driverBoostShareCents(readBoostCents(t)) > 0 ? (
                        <span style={{ color: '#F56600' }}> {formatBoostBadge(driverBoostShareCents(readBoostCents(t)))}</span>
                      ) : null}
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

      {shownOffer && (
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
              {centsToDollars(driverTakeCents(offer) + driverBoostShareCents(readBoostCents(offer)))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)', textAlign: 'right' }}>
              {offer.metadata?.carpool ? 'You net · carpool' : 'Live offer'}
              {readBoostCents(offer) > 0 ? (
                <div style={{ marginTop: 6 }}>
                  <span style={{ display: 'inline-block', background: '#F56600', color: '#fff', fontWeight: 800, fontSize: 12, borderRadius: 999, padding: '4px 10px' }}>
                    {formatBoostBadge(driverBoostShareCents(readBoostCents(offer)))}
                  </span>
                  <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.4 }}>
                    {driverBoostOfferLine(driverBoostShareCents(readBoostCents(offer)))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {offer.metadata?.scheduled_pickup_at && <p>Scheduled pickup: {formatPickupAt(offer.metadata.scheduled_pickup_at)}</p>}
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
          <ComfortNotice row={offer} />
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
          <p className="driver-shift__copy" style={{ marginTop: 8 }}>
            {online
              ? 'Stop shift ends new offers. This trip keeps going.'
              : 'You are off the clock. This trip is still active.'}
          </p>
          <div style={{ marginTop: 10 }}>
            {/* Road line prefers the stored polyline. A short leg can use one Directions request. */}
            {locationError && <div role="status">{locationError} <button type="button" onClick={() => setLocationAttempt((n) => n + 1)}>Retry location</button></div>}
            <LivePhase
              title={statusHeadline(activeTrip.status)}
              body={driverStatusDetail(activeTrip.status)}
              eta={activeEta}
              steps={DRIVER_TRACK_STEPS}
              activeIndex={activeStep}
            />
          </div>
          <ComfortNotice row={activeTrip} />
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--orange)', fontWeight: 700 }}>●</span>
              <div>
                <div style={{ fontWeight: 600 }}>Pickup</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{activeTrip.pickup_label}</div>
                {activeTrip.metadata?.scheduled_pickup_at && <div>Scheduled pickup: {formatPickupAt(activeTrip.metadata.scheduled_pickup_at)}</div>}
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
          {readBackupQueue(activeTrip)?.confirmState === 'enroute' && navStop ? (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, lineHeight: 1.45, margin: '0 0 8px' }}>{MAPS_HANDOFF_HELPER}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  ['apple', 'Apple Maps', navigationLinks(navStop).apple],
                  ['google', 'Google Maps', navigationLinks(navStop).google],
                ].map(([id, label, href]) => (
                  <a
                    key={id}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pressable"
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 48,
                      padding: '12px 16px',
                      borderRadius: 14,
                      background: id === 'apple' ? '#522D80' : '#F56600',
                      color: '#fff',
                      fontWeight: 800,
                      textDecoration: 'none',
                    }}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          ) : navHref ? (
            <a
              href={navHref}
              target="_blank"
              rel="noopener noreferrer"
              className="pressable"
              aria-label={headingToDropoff ? 'Navigate to drop-off' : 'Navigate to pickup'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 48,
                marginTop: 12,
                padding: '12px 16px',
                borderRadius: 14,
                background: '#F56600',
                color: '#fff',
                fontWeight: 800,
                textDecoration: 'none',
              }}
            >
              Navigate
            </a>
          ) : null}

          {rideChatMode(activeTrip) !== 'closed' && activeTrip.rider_id && (
            <div style={{ marginTop: 16 }}>
              <RideMessageButton tripId={activeTrip.id} userId={driverId} onClick={() => setChatTrip(activeTrip)} />
            </div>
          )}
          {activeTrip.status === 'completed' && (
            <ReportLostItemButton
              trip={activeTrip}
              userId={driverId}
              onOpened={() => setChatTrip(activeTrip)}
            />
          )}
          {activeTrip.status === 'accepted' && (
            <PurpleAcceptButton onClick={() => advanceTrip('arriving')} disabled={advancing}>
              {advancing ? 'Updating…' : statusActionLabel('accepted')}
            </PurpleAcceptButton>
          )}
          {activeTrip.status === 'arriving' && (
            <PurpleAcceptButton onClick={markArrived} disabled={advancing}>
              {advancing ? 'Updating…' : statusActionLabel('arriving')}
            </PurpleAcceptButton>
          )}
          {(activeTrip.status === 'arriving' || activeTrip.status === 'arrived') && (
            <WaitFeeCard
              trip={activeTrip}
              quote={wait.quote}
              role="driver"
              busy={wait.busy || advancing}
              error={wait.error}
              charge={wait.charge}
              onStart={activeTrip.status === 'arrived' ? () => advanceTrip('in_progress') : undefined}
              onCancel={() => wait.act('cancel')}
            />
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
