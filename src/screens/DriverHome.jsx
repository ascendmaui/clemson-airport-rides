import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { HEAT_WINDOWS } from '../lib/rideDemand'
import { PurpleAcceptButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { setDriverOnline, subscribeTrips, supabase } from '../lib/supabase'
import { publishDriverLocation } from '../lib/driverTrack'
import { pushToast } from '../lib/toasts'
import { fetchNotificationPrefs, saveNotificationPrefs } from '../lib/notificationPrefs'
import { playRideRequestAlert, shouldAlertForRide } from '../lib/rideAlert'
import {
  claimTrip, enqueueClaimedTrip, fetchOfferPreview, finishQueuedTrip,
  listPasses, listQueue, NEAR_DROPOFF_MINUTES, passOffer, QUEUE_CAP, takeNextQueued,
} from '../lib/driverOffers'
import { estimateLeg, fetchDrivingLeg, minutesUntilDropoff } from '../lib/rideGeometry'
import { coarsePlaceLabel } from '../lib/tripPrivacy'
import { DriverOfferSheet } from '../components/DriverOfferSheet'
import { QuietHoursCard } from '../components/QuietHoursCard'

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
  if (error) console.error('[trip_events]', kind, error.message)
}

const ACTIVE_STATUSES = ['accepted', 'arriving', 'in_progress']

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
  const [priority, setPriority] = useState(false)
  const [offer, setOffer] = useState(null)
  const [activeTrip, setActiveTrip] = useState(null)
  const [online, setOnline] = useState(true)
  const [earningsCents, setEarningsCents] = useState(0)
  const [recentCompleted, setRecentCompleted] = useState([])
  const [advancing, setAdvancing] = useState(false)
  const [selfPos, setSelfPos] = useState(null)
  const [showSurge, setShowSurge] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [heatMeta, setHeatMeta] = useState(null)
  const [queue, setQueue] = useState([])
  const [passed, setPassed] = useState([])
  const [prefs, setPrefs] = useState(null)
  const [prefsReady, setPrefsReady] = useState(false)
  const [riderPreview, setRiderPreview] = useState(null)
  const [estimate, setEstimate] = useState(null)
  const [offerBusy, setOfferBusy] = useState(false)
  const [offerError, setOfferError] = useState(null)
  const [nextPrompt, setNextPrompt] = useState(null)
  const alerted = useRef(new Set())
  const activeRef = useRef(null)
  const nearRef = useRef(false)
  const passedRef = useRef(new Set())
  const queueRef = useRef([])
  const onlineRef = useRef(true)
  const prefsRef = useRef(null)
  const silverProgress = 2
  const silverTotal = 4

  const loadEarnings = useCallback(async () => {
    if (!supabase || !driverId) return
    let res = await supabase
      .from('trips')
      .select('id, fare_cents, tip_cents, dropoff_label, completed_at')
      .eq('driver_id', driverId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20)
    if (res.error && /tip_cents|column|schema cache/i.test(res.error.message || '')) {
      res = await supabase
        .from('trips')
        .select('id, fare_cents, dropoff_label, completed_at')
        .eq('driver_id', driverId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(20)
    }
    const { data, error } = res
    if (error) {
      console.error('[earnings]', error.message)
      return
    }
    const rows = data || []
    setRecentCompleted(rows)
    setEarningsCents(rows.reduce((sum, t) => sum + (Number(t.fare_cents) || 0) + (Number(t.tip_cents) || 0), 0))
  }, [driverId])

  useEffect(() => {
    if (!driverId) return undefined
    setDriverOnline(driverId, true).catch(() => {})
    setOnline(true)
    return () => {
      setDriverOnline(driverId, false).catch(() => {})
    }
  }, [driverId])

  useEffect(() => {
    if (!driverId || !navigator.geolocation) return undefined
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
  }, [driverId])

  useEffect(() => {
    loadEarnings()
  }, [loadEarnings])

  useEffect(() => {
    activeRef.current = activeTrip
  }, [activeTrip])
  useEffect(() => {
    passedRef.current = new Set(passed)
  }, [passed])
  useEffect(() => {
    queueRef.current = queue
  }, [queue])
  useEffect(() => {
    onlineRef.current = online
  }, [online])
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  const refreshQueue = useCallback(async () => {
    if (!driverId) return
    const [q, p] = await Promise.all([listQueue(driverId), listPasses(driverId)])
    setQueue(q)
    setPassed(p)
  }, [driverId])

  useEffect(() => {
    if (!driverId) return undefined
    refreshQueue()
    fetchNotificationPrefs(driverId).then(({ prefs: next }) => {
      setPrefs(next)
      setPrefsReady(true)
    })
    return undefined
  }, [driverId, refreshQueue])

  const minutesToDrop = useMemo(() => {
    if (!activeTrip || activeTrip.status !== 'in_progress') return Infinity
    return minutesUntilDropoff({
      selfPos,
      dropoff: activeTrip.dropoff_lat != null ? [Number(activeTrip.dropoff_lat), Number(activeTrip.dropoff_lng)] : null,
      pickup: activeTrip.pickup_lat != null ? [Number(activeTrip.pickup_lat), Number(activeTrip.pickup_lng)] : null,
      acceptedAt: activeTrip.accepted_at,
      status: activeTrip.status,
    })
  }, [activeTrip, selfPos])
  const canQueue = Boolean(activeTrip) && minutesToDrop < NEAR_DROPOFF_MINUTES
  useEffect(() => {
    nearRef.current = canQueue
  }, [canQueue])

  const considerOffer = useCallback(async (row) => {
    if (!row?.id || !onlineRef.current) return
    if (!['searching', 'offered'].includes(row.status)) return
    if (row.driver_id && row.driver_id !== driverId) return
    if (passedRef.current.has(row.id)) return
    if (queueRef.current.some((q) => q.trip_id === row.id)) return
    const current = activeRef.current
    if (current && ACTIVE_STATUSES.includes(current.status) && !nearRef.current) return
    if (current?.id === row.id) return
    const preview = await fetchOfferPreview(row.id)
    if (preview.standing === 'restricted') return
    setRiderPreview(preview)
    setOffer(row)
    if (row.status === 'searching' && supabase) {
      supabase.from('trips').update({ status: 'offered' }).eq('id', row.id).eq('status', 'searching')
      writeTripEvent(row.id, 'offered', { source: 'driver_home' })
    }
  }, [driverId])

  useEffect(() => {
    if (!supabase || !driverId) return undefined
    let alive = true
    async function pollOffers() {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .in('status', ['searching', 'offered'])
        .order('requested_at', { ascending: false })
        .limit(8)
      if (!alive || error) return
      const row = (data || []).find((t) => !passedRef.current.has(t.id) && !queueRef.current.some((q) => q.trip_id === t.id))
      if (row) considerOffer(row)
    }
    pollOffers()
    const timer = setInterval(pollOffers, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [driverId, considerOffer])

  // Poll/load active trips for this driver so E2E accepted trips appear without re-offer.
  useEffect(() => {
    if (!supabase || !driverId) return undefined
    let alive = true
    async function loadActive() {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ACTIVE_STATUSES)
        .order('accepted_at', { ascending: false })
        .limit(6)
      if (!alive || error) return
      const queuedIds = new Set((queueRef.current || []).filter((q) => q.status === 'queued').map((q) => q.trip_id))
      const rows = (data || []).filter((t) => !queuedIds.has(t.id))
      const rank = { in_progress: 0, arriving: 1, accepted: 2 }
      rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
      const row = rows[0]
      if (row) {
        setActiveTrip(row)
        setOffer((prev) => (prev?.id === row.id ? null : prev))
      }
    }
    loadActive()
    const timer = setInterval(loadActive, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [driverId])

  useEffect(() => {
    return subscribeTrips((payload) => {
      const row = payload?.new || payload?.record
      if (!row) return
      if (row.status === 'searching' || row.status === 'offered') {
        considerOffer(row)
      }
      if (row.status === 'accepted' && row.driver_id === driverId && !queueRef.current.some((q) => q.trip_id === row.id && q.status === 'queued')) {
        setActiveTrip(row)
        setOffer((prev) => (prev?.id === row.id ? null : prev))
      }
      if (ACTIVE_STATUSES.includes(row.status) && row.driver_id === driverId && !queueRef.current.some((q) => q.trip_id === row.id)) {
        setActiveTrip(row)
      }
      if (row.status === 'completed' && row.driver_id === driverId) {
        if (activeRef.current?.id === row.id) setActiveTrip(null)
        loadEarnings()
      }
      if (row.status === 'canceled') {
        setOffer((prev) => (prev?.id === row.id ? null : prev))
      }
      if (row.status === 'canceled' && activeRef.current?.id === row.id) setActiveTrip(null)
    })
  }, [driverId, loadEarnings, considerOffer])

  useEffect(() => {
    if (!offer?.id) return undefined
    if (alerted.current.has(offer.id)) return undefined
    if (!prefsReady || !shouldAlertForRide(prefsRef.current)) return undefined
    alerted.current.add(offer.id)
    const fare = offer.fare_cents != null ? `$${(Number(offer.fare_cents) / 100).toFixed(2)}` : 'New ride'
    pushToast({
      kind: 'ride_requested',
      title: 'New ride request',
      body: `${fare} · ${offer.pickup_label || 'Pickup'} → ${offer.dropoff_label || 'Dropoff'}`,
      durationMs: 8000,
    })
    playRideRequestAlert()
    return undefined
  }, [offer?.id, offer?.fare_cents, offer?.pickup_label, offer?.dropoff_label, prefs, prefsReady])

  useEffect(() => {
    if (!offer) {
      setEstimate(null)
      return undefined
    }
    const pickup = offer.pickup_lat != null ? [Number(offer.pickup_lat), Number(offer.pickup_lng)] : null
    const drop = offer.dropoff_lat != null ? [Number(offer.dropoff_lat), Number(offer.dropoff_lng)] : null
    let cancelled = false
    async function run() {
      const tripLeg = estimateLeg(pickup, drop)
      const toPickupLeg = selfPos && pickup ? estimateLeg(selfPos, pickup) : null
      const base = {
        tripMeters: tripLeg?.meters ?? null,
        tripSec: tripLeg?.seconds ?? null,
        tripPath: tripLeg?.path ?? null,
        toPickupSec: toPickupLeg?.seconds ?? null,
        toPickupPath: toPickupLeg?.path ?? null,
      }
      if (!cancelled) setEstimate(base)
      const [roadTrip, roadPickup] = await Promise.all([
        fetchDrivingLeg(pickup, drop),
        selfPos && pickup ? fetchDrivingLeg(selfPos, pickup) : null,
      ])
      if (cancelled) return
      setEstimate({
        tripMeters: roadTrip?.meters ?? base.tripMeters,
        tripSec: roadTrip?.seconds ?? base.tripSec,
        tripPath: roadTrip?.path ?? base.tripPath,
        toPickupSec: roadPickup?.seconds ?? base.toPickupSec,
        toPickupPath: roadPickup?.path ?? base.toPickupPath,
      })
    }
    run()
    return () => { cancelled = true }
  }, [offer?.id, selfPos?.[0], selfPos?.[1]])

  async function acceptOffer(asQueue = false) {
    if (!offer?.id || !driverId || offerBusy) return
    setOfferBusy(true)
    setOfferError(null)
    try {
      const { acceptedAt } = await claimTrip(driverId, offer.id)
      const kept = { ...offer, status: 'accepted', driver_id: driverId, accepted_at: acceptedAt }
      if (asQueue || activeTrip) {
        await enqueueClaimedTrip(driverId, offer.id, { front: !asQueue })
        await refreshQueue()
        pushToast({ kind: 'ride_requested', title: asQueue ? 'Added to queue' : 'Next ride saved', body: offer.pickup_label || 'Pickup' })
      } else {
        setActiveTrip(kept)
      }
      setOffer(null)
    } catch (err) {
      setOfferError(err.message || 'Could not accept')
    } finally {
      setOfferBusy(false)
    }
  }

  async function declineOffer() {
    if (offer?.id && driverId) await passOffer(driverId, offer.id)
    if (offer?.id) setPassed((prev) => [...prev, offer.id])
    setOffer(null)
    setOfferError(null)
  }

  async function advanceTrip(nextStatus) {
    if (!activeTrip?.id || !supabase || advancing) return
    setAdvancing(true)
    try {
      const patch = { status: nextStatus }
      if (nextStatus === 'completed') {
        patch.completed_at = new Date().toISOString()
      }
      const { error } = await supabase.from('trips').update(patch).eq('id', activeTrip.id)
      if (error) {
        console.error(error)
        return
      }
      await writeTripEvent(activeTrip.id, nextStatus, {
        driver_id: driverId,
        from: activeTrip.status,
        source: 'driver_home',
        ...(patch.completed_at ? { completed_at: patch.completed_at } : {}),
      })
      if (nextStatus === 'completed') {
        const doneId = activeTrip.id
        await finishQueuedTrip(driverId, doneId)
        const next = await takeNextQueued(driverId)
        await refreshQueue()
        setActiveTrip(next || null)
        await loadEarnings()
        if (next) {
          setNextPrompt({ ...next, rateTripId: doneId })
          pushToast({
            kind: 'ride_requested',
            title: 'Next queued ride',
            body: `${next.pickup_label || 'Pickup'} → ${next.dropoff_label || 'Dropoff'}`,
          })
        } else if (doneId) {
          navigate('rate', { trip: doneId })
        }
      } else {
        setActiveTrip({ ...activeTrip, ...patch })
      }
    } finally {
      setAdvancing(false)
    }
  }

  const showIdle = !offer && !activeTrip
  const statusLabel = {
    accepted: 'Accepted — head to pickup',
    arriving: 'Arriving at pickup',
    in_progress: 'Trip in progress',
  }

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
        showHeat={!activeTrip && !offer && showSurge}
        heatMode="surge"
        heatWindow={heatWindow}
        onHeatMeta={setHeatMeta}
        showMapTypeControl={!activeTrip}
        center={selfPos || (activeTrip?.pickup_lat != null ? [activeTrip.pickup_lat, activeTrip.pickup_lng] : CLEMSON)}
        zoom={13}
        marker={selfPos || CLEMSON}
        pickupPosition={
          (offer || activeTrip)?.pickup_lat != null
            ? [Number((offer || activeTrip).pickup_lat), Number((offer || activeTrip).pickup_lng)]
            : activeTrip ? CLEMSON : null
        }
        dropoffPosition={
          (offer || activeTrip)?.dropoff_lat != null
            ? [Number((offer || activeTrip).dropoff_lat), Number((offer || activeTrip).dropoff_lng)]
            : null
        }
        route={estimate?.tripPath || null}
        routeSecondary={estimate?.toPickupPath || null}
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
          {centsToDollars(earningsCents)}
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

      
      {!activeTrip && (
        <div style={{ position: 'absolute', top: 72, left: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
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
            Looking for rides in Clemson. Offers arrive live via Realtime — no simulated requests.
          </p>

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

          <QuietHoursCard
            prefs={prefs}
            onChange={async (quiet) => {
              const next = { ...(prefs || {}), quiet }
              setPrefs(next)
              if (driverId) {
                const res = await saveNotificationPrefs(driverId, next)
                setPrefs(res.prefs)
              }
            }}
          />

          {recentCompleted.length > 0 && (
            <div style={{ padding: '12px 0 4px', borderTop: '1px solid var(--border)', marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent earnings</div>
              {recentCompleted.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 13,
                    padding: '6px 0',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    {coarsePlaceLabel(t.dropoff_label)}
                  </span>
                  <strong style={{ color: 'var(--ink)' }}>{centsToDollars((Number(t.fare_cents) || 0) + (Number(t.tip_cents) || 0))}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {offer && (
        <DriverOfferSheet
          offer={offer}
          riderName={riderPreview?.riderFirstName}
          ratingAvg={riderPreview?.ratingAvg}
          ratingCount={riderPreview?.ratingCount}
          standing={riderPreview?.standing}
          estimate={estimate}
          canQueue={canQueue}
          queueCount={queue.length}
          busy={offerBusy}
          error={offerError}
          onAccept={() => acceptOffer(false)}
          onQueue={() => acceptOffer(true)}
          onDecline={declineOffer}
        />
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
          {nextPrompt && (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 12, background: 'rgba(245,102,0,0.12)' }}>
              <div style={{ fontWeight: 800, color: 'var(--purple)' }}>Next ride is ready</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
                {nextPrompt.pickup_label} → {nextPrompt.dropoff_label}
              </div>
              {nextPrompt.rateTripId && (
                <button
                  type="button"
                  className="pressable"
                  onClick={() => navigate('rate', { trip: nextPrompt.rateTripId })}
                  style={{ marginTop: 6, fontWeight: 700, color: 'var(--orange)' }}
                >
                  Rate the rider you just dropped off
                </button>
              )}
            </div>
          )}
          {queue.length > 0 && (
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginBottom: 6 }}>
              {queue.length} ride{queue.length > 1 ? 's' : ''} queued (max {QUEUE_CAP})
              {canQueue ? ` · ${Math.max(1, Math.round(minutesToDrop))} min to drop-off` : ''}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
              {centsToDollars((Number(activeTrip.fare_cents) || 0) + (Number(activeTrip.tip_cents) || 0))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--purple)', fontWeight: 700 }}>
              {statusLabel[activeTrip.status] || activeTrip.status}
            </div>
          </div>
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

          {activeTrip.status === 'accepted' && (
            <PurpleAcceptButton onClick={() => advanceTrip('arriving')} disabled={advancing}>
              {advancing ? 'Updating…' : 'Arriving'}
            </PurpleAcceptButton>
          )}
          {activeTrip.status === 'arriving' && (
            <PurpleAcceptButton onClick={() => advanceTrip('in_progress')} disabled={advancing}>
              {advancing ? 'Updating…' : 'Start trip'}
            </PurpleAcceptButton>
          )}
          {activeTrip.status === 'in_progress' && (
            <PurpleAcceptButton onClick={() => advanceTrip('completed')} disabled={advancing}>
              {advancing ? 'Updating…' : 'Complete'}
            </PurpleAcceptButton>
          )}
          {activeTrip.rider_id && (
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('profile', { id: activeTrip.rider_id })}
              style={{ marginTop: 8, fontWeight: 600, color: 'var(--purple)' }}
            >
              View rider profile
            </button>
          )}

        </div>
      )}
    </div>
  )
}
