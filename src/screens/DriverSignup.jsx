import { useMemo, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'

const QUESTIONS = [
  { key: 'isStudent', label: 'Are you a student?' },
  { key: 'hasCar', label: 'Do you have a car?' },
  { key: 'hasInsurance', label: 'Do you have insurance?' },
  { key: 'wantsExtraMoney', label: 'Do you want to make extra money driving fellow students?' },
]

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export function DriverSignup() {
  const { user, loading } = useAuth()
  const [answers, setAnswers] = useState({
    isStudent: null,
    hasCar: null,
    hasInsurance: null,
    wantsExtraMoney: null,
  })
  const [attestation, setAttestation] = useState(false)
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '')
  const [phone, setPhone] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const allYes = useMemo(
    () => QUESTIONS.every((q) => answers[q.key] === true),
    [answers],
  )

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!user?.id) {
      setError('Sign in first.')
      return
    }
    if (!allYes || !attestation) {
      setError('Answer Yes to all questions and accept the attestation.')
      return
    }
    setBusy(true)
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/driver-signup', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          isStudent: true,
          hasCar: true,
          hasInsurance: true,
          wantsExtraMoney: true,
          attestationAccepted: true,
          fullName: fullName || user.email?.split('@')[0],
          phone,
          make,
          model,
          color,
          plate,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
      setDone(data)
      setTimeout(() => navigate('driver'), 1200)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>

  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: '20px 20px 40px' }}>
      <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>
        ←
      </button>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 12, color: 'var(--purple)' }}>
        Sign up as a driver
      </h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 8, lineHeight: 1.45 }}>
        Drive fellow <strong>Clemson students</strong> — same university, trusted community. Open signup;
        @clemson.edu emails get a soft student badge automatically.
      </p>

      <div
        className="sheet"
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 16,
          background: 'rgba(82,45,128,0.08)',
          border: '1px solid var(--border)',
          fontSize: 13,
          color: 'var(--ink-secondary)',
          lineHeight: 1.45,
        }}
      >
        You attest that you carry valid auto insurance and will only offer rides to fellow students. Legal
        insurance disclaimer copy pending John approval.
      </div>

      <form onSubmit={onSubmit} className="sheet" style={{ marginTop: 16, padding: 20, borderRadius: 20, boxShadow: 'var(--shadow-pill)' }}>
        {QUESTIONS.map((q) => (
          <div key={q.key} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              {q.label} <span style={{ color: 'var(--danger)' }}>*</span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[true, false].map((val) => (
                <button
                  key={String(val)}
                  type="button"
                  className="pressable"
                  onClick={() => setAnswers((a) => ({ ...a, [q.key]: val }))}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 12,
                    border: answers[q.key] === val ? '2px solid var(--purple)' : '1px solid var(--border)',
                    background: answers[q.key] === val ? 'rgba(82,45,128,0.12)' : 'var(--surface)',
                    fontWeight: 700,
                  }}
                >
                  {val ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
        ))}

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 18, fontSize: 13, lineHeight: 1.4 }}>
          <input
            type="checkbox"
            checked={attestation}
            onChange={(e) => setAttestation(e.target.checked)}
            style={{ marginTop: 3 }}
            required
          />
          <span>
            I attest I am a student with a car and insurance, and I want to drive fellow Clemson students for
            extra money. <span style={{ color: 'var(--danger)' }}>*</span>
          </span>
        </label>

        {allYes && attestation && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--purple)', marginBottom: 12 }}>Vehicle</h2>
            {[
              ['Full name', fullName, setFullName, 'text', true],
              ['Phone', phone, setPhone, 'tel', false],
              ['Make', make, setMake, 'text', true],
              ['Model', model, setModel, 'text', true],
              ['Color', color, setColor, 'text', false],
              ['Plate', plate, setPlate, 'text', true],
            ].map(([label, value, setter, type, req]) => (
              <label key={label} style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>{label}</span>
                <input
                  required={req}
                  type={type}
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: 4,
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                  }}
                />
              </label>
            ))}
          </>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
        {done && (
          <p style={{ color: 'var(--purple)', fontSize: 13, marginBottom: 10, fontWeight: 600 }}>
            {done.message || 'Approved — opening driver mode…'}
            {done.student_verified ? ' · Clemson student badge' : ''}
          </p>
        )}

        <PrimaryButton type="submit" disabled={busy || !allYes || !attestation}>
          {busy ? 'Submitting…' : 'Become a student driver'}
        </PrimaryButton>

        <button
          type="button"
          className="pressable"
          onClick={() => navigate('driver-onboarding')}
          style={{ display: 'block', marginTop: 14, fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}
        >
          Prefer classic driver onboarding →
        </button>
      </form>
    </div>
  )
}
