import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { PurpleAcceptButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { setDriverOnline, subscribeTrips, supabase } from '../lib/supabase'

function centsToDollars(cents) {
  if (cents == null) return '—'
  return `$${(Number(cents) / 100).toFixed(2)}`
}

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
  const [online, setOnline] = useState(true)
  const silverProgress = 2
  const silverTotal = 4

  useEffect(() => {
    if (!driverId) return undefined
    setDriverOnline(driverId, true).catch(() => {})
    setOnline(true)
    return () => {
      setDriverOnline(driverId, false).catch(() => {})
    }
  }, [driverId])

  useEffect(() => {
    return subscribeTrips((payload) => {
      const row = payload?.new || payload?.record
      if (!row) return
      if (row.status === 'searching' || row.status === 'offered') {
        setOffer(row)
      }
      if (row.status === 'canceled' && offer?.id === row.id) {
        setOffer(null)
      }
    })
  }, [offer?.id])

  async function acceptOffer() {
    if (!offer?.id || !supabase || !driverId) return
    const { error } = await supabase
      .from('trips')
      .update({
        status: 'accepted',
        driver_id: driverId,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', offer.id)
    if (error) {
      console.error(error)
      return
    }
    setOffer(null)
  }

  async function declineOffer() {
    if (!offer?.id || !supabase) {
      setOffer(null)
      return
    }
    await supabase
      .from('trips')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() })
      .eq('id', offer.id)
    setOffer(null)
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
            background: 'rgba(255,255,255,0.95)',
            boxShadow: 'var(--shadow-pill)',
            fontSize: 18,
            backdropFilter: 'blur(8px)',
          }}
        >
          ☰
        </button>
        <div
          style={{
            padding: '10px 18px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.95)',
            fontWeight: 700,
            fontSize: 17,
            boxShadow: 'var(--shadow-pill)',
            backdropFilter: 'blur(8px)',
          }}
        >
          $0.00
        </div>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: 'var(--shadow-pill)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: online ? 'var(--success)' : 'var(--ink-tertiary)',
          }}
          title={online ? 'Online' : 'Offline'}
        >
          {online ? 'ON' : 'OFF'}
        </div>
      </div>

      {!offer && (
        <div
          className="sheet"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 20,
            padding: '12px 20px calc(20px + var(--safe-bottom))',
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
            <span style={{ fontWeight: 600, fontSize: 18 }}>You&apos;re online</span>
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
        </div>
      )}

      {offer && (
        <div
          className="sheet"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            padding: '12px 20px calc(24px + var(--safe-bottom))',
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
    </div>
  )
}
