import { useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'

export function ConfirmPickup({ dest = 'GSP Airport' }) {
  const [address, setAddress] = useState('Memorial Stadium · Lot 5')
  const [note, setNote] = useState('')
  const [pin, setPin] = useState(STADIUM)

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-muted)' }}>
      <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="pressable" onClick={() => navigate('home')} style={{ fontSize: 20, padding: 4 }}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3 }}>Confirm pickup spot</h1>
      </div>

      <div style={{ padding: '0 16px' }}>
        <CampusMap height={260} interactive dragPin marker={pin} onPinMove={setPin} />
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8, textAlign: 'center' }}>
          Drag the map to adjust your pin
        </p>
      </div>

      <div
        className="sheet"
        style={{
          marginTop: 'auto',
          padding: '12px 20px calc(28px + var(--safe-bottom))',
        }}
      >
        <div className="sheet-handle" />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup address</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface-muted)',
            marginBottom: 14,
          }}
        />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Add note for driver</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Near the orange gates, wearing purple hoodie"
          rows={2}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface-muted)',
            resize: 'none',
            marginBottom: 8,
          }}
        />
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 14 }}>
          Going to <strong>{dest}</strong>
        </p>
        <PrimaryButton onClick={() => navigate('tiers', { dest, pickup: address })}>
          Confirm and request
        </PrimaryButton>
      </div>
    </div>
  )
}
