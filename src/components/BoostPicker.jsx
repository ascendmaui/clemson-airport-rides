import { useState } from 'react'
import {
  BOOST_MAX_CENTS,
  BOOST_PRESETS_CENTS,
  BOOST_RIDER_COPY,
  formatBoostDollars,
  parseBoostDollars,
} from '../../shared/scheduledBoost.js'

/**
 * Rider boost chooser. `cents` is the amount that will be saved.
 * Pass minimumCents above the current boost when the rider is raising it later.
 */
export function BoostPicker({ cents = 0, onChange, minimumCents = 0, heading = 'Driver boost' }) {
  const [custom, setCustom] = useState('')
  const [error, setError] = useState('')
  const raising = minimumCents > 0

  function choose(next) {
    setError('')
    setCustom('')
    onChange(next)
  }

  function applyCustom() {
    const parsed = parseBoostDollars(custom)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (parsed.cents < minimumCents) {
      setError(raising ? 'Raise the boost above the current amount.' : 'Enter a boost amount.')
      return
    }
    setError('')
    onChange(parsed.cents)
  }

  return (
    <div style={{ marginBottom: 14 }} aria-label={heading}>
      <div style={{ fontWeight: 800, color: '#522D80', marginBottom: 4 }}>{heading}</div>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '0 0 10px', lineHeight: 1.45 }}>
        {BOOST_RIDER_COPY} Up to {formatBoostDollars(BOOST_MAX_CENTS)}.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!raising && (
          <button
            type="button"
            className="pressable"
            onClick={() => choose(0)}
            aria-pressed={cents === 0}
            style={pillStyle(cents === 0)}
          >
            No boost
          </button>
        )}
        {BOOST_PRESETS_CENTS.filter((amount) => amount >= minimumCents).map((amount) => (
          <button
            key={amount}
            type="button"
            className="pressable"
            onClick={() => choose(amount)}
            aria-pressed={cents === amount}
            style={pillStyle(cents === amount)}
          >
            +{formatBoostDollars(amount)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <label style={{ flex: 1, fontSize: 13, color: '#522D80', fontWeight: 700 }}>
          Custom
          <input
            value={custom}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Custom boost in dollars"
            onChange={(event) => setCustom(event.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(82,45,128,0.25)',
              fontSize: 16,
            }}
          />
        </label>
        <button
          type="button"
          className="pressable"
          onClick={applyCustom}
          style={{ alignSelf: 'flex-end', ...pillStyle(false), background: '#522D80', color: '#fff', borderColor: '#522D80' }}
        >
          Set
        </button>
      </div>
      {cents > 0 && (
        <p style={{ fontSize: 13, fontWeight: 800, color: '#F56600', margin: '8px 0 0' }}>
          Boost {formatBoostDollars(cents)} · your driver keeps all of it
        </p>
      )}
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
    </div>
  )
}

function pillStyle(on) {
  return {
    padding: '8px 12px',
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 13,
    color: on ? '#fff' : '#522D80',
    background: on ? '#F56600' : 'rgba(82,45,128,0.08)',
    border: on ? '1px solid #F56600' : '1px solid rgba(82,45,128,0.25)',
  }
}
