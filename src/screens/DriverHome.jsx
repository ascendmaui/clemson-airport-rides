import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { PurpleAcceptButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { setDriverOnline, subscribeTrips, supabase } from '../lib/supabase'

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
  const silverProgress = 2
  const silverTotal = 4

  const loadEarnings = useCallback(async () => {
    if (!supabase || !driverId) return
    const { data, error } = await supabase
      .from('trips')
      .select('id, fare_cents, dropoff_label, completed_at')
      .eq('driver_id', driverId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20)
    if (error) {
      console.error('[earnings]', error.message)
      return
    }
    const rows = data || []
    setRecentCompleted(rows)
    setEarningsCents(rows.reduce((sum, t) => sum + (Number(t.fare_cents) || 0), 0))
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
    loadEarnings()
  }, [loadEarnings])

  // Load open offers (searching/offered) — Realtime alone misses rows already open.
  useEffect(() => {
    if (!supabase) return undefined
    let alive = true
    supabase
      .from('trips')
      .select('*')
      .in('status', ['searching', 'offered'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .then(async ({ data, error }) => {
        if (!alive || error) return
        const row = data?.[0]
        if (!row) return
        setOffer(row)
        if (row.status === 'searching') {
          await supabase
            .from('trips')
            .update({ status: 'offered' })
            .eq('id', row.id)
            .eq('status', 'searching')
          await writeTripEvent(row.id, 'offered', { source: 'driver_home_poll' })
          setOffer({ ...row, status: 'offered' })
        }
      })
    return () => {
      alive = false
    }
  }, [driverId])

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
        .limit(1)
      if (!alive || error) return
      const row = data?.[0]
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
        if (!activeTrip) {
          setOffer(row)
          if (row.status === 'searching' && supabase) {
            writeTripEvent(row.id, 'offered', { source: 'realtime' })
            supabase.from('trips').update({ status: 'offered' }).eq('id', row.id).eq('status', 'searching')
          }
        }
      }
      if (row.status === 'accepted' && row.driver_id === driverId) {
        setActiveTrip(row)
        setOffer((prev) => (prev?.id === row.id ? null : prev))
      }
      if (ACTIVE_STATUSES.includes(row.status) && row.driver_id === driverId) {
        setActiveTrip(row)
      }
      if (row.status === 'completed' && row.driver_id === driverId) {
        setActiveTrip(null)
        loadEarnings()
      }
      if (row.status === 'canceled' && offer?.id === row.id) {
        setOffer(null)
      }
      if (row.status === 'canceled' && activeTrip?.id === row.id) {
        setActiveTrip(null)
      }
    })
  }, [offer?.id, activeTrip?.id, driverId, loadEarnings])

  async function acceptOffer() {
    if (!offer?.id || !supabase || !driverId) return
    const acceptedAt = new Date().toISOString()
    const { error } = await supabase
      .from('trips')
      .update({
        status: 'accepted',
        driver_id: driverId,
        accepted_at: acceptedAt,
      })
      .eq('id', offer.id)
    if (error) {
      console.error(error)
      return
    }
    await writeTripEvent(offer.id, 'accepted', {
      driver_id: driverId,
      accepted_at: acceptedAt,
      fare_cents: offer.fare_cents,
    })
    const kept = { ...offer, status: 'accepted', driver_id: driverId, accepted_at: acceptedAt }
    setActiveTrip(kept)
    setOffer(null)
  }

  async function declineOffer() {
    if (!offer?.id || !supabase) {
      setOffer(null)
      return
    }
    const canceledAt = new Date().toISOString()
    await supabase
      .from('trips')
      .update({ status: 'canceled', canceled_at: canceledAt })
      .eq('id', offer.id)
    await writeTripEvent(offer.id, 'canceled', { reason: 'driver_decline', canceled_at: canceledAt })
    setOffer(null)
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
        setActiveTrip(null)
        await loadEarnings()
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
      <CampusMap height="100%" interactive showHeat center={CLEMSON} zoom={13} />

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
                    {t.dropoff_label || 'Trip'}
                  </span>
                  <strong style={{ color: 'var(--ink)' }}>{centsToDollars(t.fare_cents)}</strong>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
              {centsToDollars(offer.fare_cents)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>Live offer</div>
          </div>
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
          <PurpleAcceptButton onClick={acceptOffer}>Accept</PurpleAcceptButton>
          <button
            type="button"
            className="pressable"
            onClick={declineOffer}
            style={{ width: '100%', marginTop: 10, padding: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}
          >
            Decline
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
              {centsToDollars(activeTrip.fare_cents)}
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
        </div>
      )}
    </div>
  )
}
