import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { upsertDriverOnboarding, supabaseConfigured } from '../lib/supabase'

export function DriverOnboarding() {
  const { user, isLoaded } = useUser()
  const [fullName, setFullName] = useState(user?.fullName || '')
  const [phone, setPhone] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [isTesla, setIsTesla] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!supabaseConfigured) {
      setError('Set VITE_SUPABASE_ANON_KEY to save driver profile.')
      return
    }
    if (!user?.id) {
      setError('Sign in first.')
      return
    }
    setBusy(true)
    try {
      await upsertDriverOnboarding({
        userId: user.id,
        fullName: fullName || user.fullName || 'Driver',
        phone,
        vehicle: {
          make,
          model,
          color,
          plate,
          isTesla,
          autonomousCapable: isTesla,
          seats: isTesla ? 4 : 4,
        },
      })
      setDone(true)
      setTimeout(() => navigate('driver'), 800)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!isLoaded) {
    return <div style={{ padding: 40 }}>Loading…</div>
  }

  return (
    <div
      className="fade-in"
      style={{
        minHeight: '100%',
        background: 'var(--surface-muted)',
        padding: '20px 20px 40px',
      }}
    >
      <button type="button" className="pressable" onClick={() => navigate('driver')} style={{ fontSize: 20 }}>
        ←
      </button>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 12, color: 'var(--purple)' }}>
        Driver onboarding
      </h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, marginBottom: 20 }}>
        Profile + vehicle → Supabase <code>profiles</code> / <code>vehicles</code> / <code>driver_status</code>
      </p>

      <form
        onSubmit={onSubmit}
        className="sheet"
        style={{ padding: 20, borderRadius: 20, boxShadow: 'var(--shadow-pill)' }}
      >
        {[
          ['Full name', fullName, setFullName, 'text'],
          ['Phone', phone, setPhone, 'tel'],
          ['Make', make, setMake, 'text'],
          ['Model', model, setModel, 'text'],
          ['Color', color, setColor, 'text'],
          ['Plate', plate, setPlate, 'text'],
        ].map(([label, value, setter, type]) => (
          <label key={label} style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>{label}</span>
            <input
              required={label !== 'Color'}
              type={type}
              value={value}
              onChange={(e) => setter(e.target.value)}
              style={{
                width: '100%',
                marginTop: 6,
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
              }}
            />
          </label>
        ))}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 18,
            fontWeight: 600,
          }}
        >
          <input type="checkbox" checked={isTesla} onChange={(e) => setIsTesla(e.target.checked)} />
          Tesla / self-driving capable
        </label>

        {error && (
          <p style={{ color: '#b00020', fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}
        {done && (
          <p style={{ color: 'var(--purple)', fontSize: 13, marginBottom: 12 }}>Saved — opening driver home…</p>
        )}

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Complete onboarding'}
        </PrimaryButton>
      </form>
    </div>
  )
}
