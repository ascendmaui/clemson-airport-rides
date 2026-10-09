import { useEffect, useState } from 'react'
import {
  GENDER_OPTIONS,
  comfortPreferenceCopy,
  womenOnlyPreferenceAllowed,
} from '../../shared/womenOnlyMatch.js'

export function WomenOnlyCard({
  role = 'rider',
  genderIdentity = 'unspecified',
  womenOnlyMatching = false,
  busy = false,
  available = true,
  note = null,
  onGender,
  onToggle,
}) {
  const copy = comfortPreferenceCopy(role)
  const allowed = womenOnlyPreferenceAllowed(genderIdentity)
  const on = Boolean(womenOnlyMatching) && allowed
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])

  const motion = reduceMotion ? '0ms' : '220ms'

  return (
    <section
      style={{
        marginTop: 14,
        padding: 16,
        borderRadius: 18,
        background: 'linear-gradient(160deg, rgba(255,255,255,0.86), rgba(82,45,128,0.08) 60%, rgba(245,102,0,0.12))',
        border: '1px solid rgba(82,45,128,0.14)',
      }}
    >
      <div style={{ color: 'var(--orange)', fontWeight: 800, letterSpacing: '0.08em', fontSize: 11 }}>{copy.kicker}</div>
      <div style={{ color: 'var(--purple)', fontWeight: 800, fontSize: 18, marginTop: 4 }}>{copy.title}</div>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, margin: '8px 0 12px' }}>{copy.body}</p>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple)', marginBottom: 8 }}>How you identify</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {GENDER_OPTIONS.map((option) => {
          const selected = genderIdentity === option.id
          return (
            <button
              key={option.id}
              type="button"
              className="pressable"
              aria-pressed={selected}
              disabled={busy || !available}
              onClick={() => onGender?.(option.id)}
              style={{
                padding: '8px 12px',
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 13,
                color: selected ? '#fff' : 'var(--purple)',
                background: selected ? 'var(--purple)' : 'rgba(82,45,128,0.08)',
                border: selected ? '1px solid var(--purple)' : '1px solid rgba(82,45,128,0.16)',
              }}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="pressable"
        role="switch"
        aria-checked={on}
        aria-label={copy.title}
        disabled={busy || !available || !allowed}
        onClick={() => onToggle?.(!on)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 14,
          textAlign: 'left',
          width: '100%',
          opacity: allowed && available ? 1 : 0.55,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 52,
            height: 30,
            borderRadius: 999,
            padding: 3,
            background: on ? 'linear-gradient(135deg, var(--orange), #ff8a2b)' : 'rgba(82,45,128,0.16)',
            transition: `background ${motion}`,
            boxShadow: on ? '0 6px 16px rgba(245,102,0,0.28)' : 'none',
          }}
        >
          <span style={{
            display: 'block',
            width: 24,
            height: 24,
            borderRadius: 999,
            background: '#fff',
            transform: on ? 'translateX(22px)' : 'translateX(0)',
            transition: `transform ${motion}`,
            boxShadow: '0 1px 4px rgba(26,16,51,0.2)',
          }} />
        </span>
        <span>
          <span style={{ display: 'block', fontWeight: 800, color: 'var(--purple)' }}>{on ? 'On for your rides' : 'Off'}</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 2 }}>
            {available ? (allowed ? 'Saved to your profile' : copy.locked) : 'This comfort preference needs a database update before it can be saved.'}
          </span>
        </span>
      </button>
      {note ? <div role="status" style={{ marginTop: 10, color: 'var(--orange)', fontWeight: 700, fontSize: 13 }}>{note}</div> : null}
    </section>
  )
}
