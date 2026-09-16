import { useState } from 'react'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { PurpleAcceptButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'

export function DriverHome() {
  const [priority, setPriority] = useState(false)
  const [offer, setOffer] = useState(false)
  const silverProgress = 2
  const silverTotal = 4

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

      {/* Top chrome */}
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
        <button
          type="button"
          className="pressable"
          onClick={() => setOffer(true)}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: 'var(--shadow-pill)',
            fontSize: 18,
            backdropFilter: 'blur(8px)',
          }}
          title="Simulate incoming offer"
        >
          🔔
        </button>
      </div>

      {/* Bottom dock */}
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
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 0 3px rgba(31,138,76,0.2)' }} />
            <span style={{ fontWeight: 600, fontSize: 18 }}>You're online</span>
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
              <span style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{silverProgress}/{silverTotal}</span>
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

          <button
            type="button"
            className="pressable"
            onClick={() => setOffer(true)}
            style={{ marginTop: 12, width: '100%', padding: 10, fontSize: 13, color: 'var(--purple)', fontWeight: 600 }}
          >
            Simulate incoming ride →
          </button>
        </div>
      )}

      {/* Incoming offer card */}
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
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>$22.40</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>~$38/hr est.</div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--orange)', fontWeight: 700 }}>●</span>
              <div>
                <div style={{ fontWeight: 600 }}>Pickup · 3 min (0.8 mi)</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>Memorial Stadium Lot 5</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}>■</span>
              <div>
                <div style={{ fontWeight: 600 }}>Dropoff · 18 min (11 mi)</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>GSP Airport · Terminal</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--orange-soft)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                color: 'var(--orange)',
                boxShadow: 'var(--shadow-pill)',
              }}
            >
              J
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>John</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>★ 4.97</div>
            </div>
          </div>
          <PurpleAcceptButton
            onClick={() => {
              setOffer(false)
              alert('Ride accepted — stub (no live dispatch)')
            }}
          >
            Accept
          </PurpleAcceptButton>
          <button
            type="button"
            className="pressable"
            onClick={() => setOffer(false)}
            style={{ width: '100%', marginTop: 10, padding: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}
          >
            Decline
          </button>
        </div>
      )}
    </div>
  )
}
