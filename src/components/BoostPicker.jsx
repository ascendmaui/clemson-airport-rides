import { useId, useState } from 'react'
import {
  BOOST_INFO_LABEL,
  BOOST_RIDER_HELPER,
  boostHowItWorks,
  riderBoostChosenLine,
} from '../../shared/copy/boost.js'
import {
  BOOST_PRESETS_CENTS,
  formatBoostDollars,
  parseBoostDollars,
} from '../../shared/scheduledBoost.js'
import { A11yModalDialog } from './A11yModal'

/**
 * Rider boost chooser. `cents` is the amount that will be saved.
 * Pass minimumCents above the current boost when the rider is raising it later.
 */
export function BoostPicker({ cents = 0, onChange, minimumCents = 0, heading = 'Driver boost' }) {
  const [custom, setCustom] = useState('')
  const [error, setError] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const titleId = `boost-how-${useId().replace(/:/g, '')}`
  const raising = minimumCents > 0
  const how = boostHowItWorks()

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 800, color: '#522D80' }}>{heading}</div>
        <button
          type="button"
          className="pressable"
          onClick={() => setInfoOpen(true)}
          aria-label={BOOST_INFO_LABEL}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: '1px solid rgba(82,45,128,0.35)',
            background: 'rgba(82,45,128,0.08)',
            color: '#522D80',
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          i
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '0 0 10px', lineHeight: 1.45 }}>
        {BOOST_RIDER_HELPER}
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
          {riderBoostChosenLine(cents)}
        </p>
      )}
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
      <A11yModalDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        titleId={titleId}
        style={{
          maxWidth: 420,
          width: 'calc(100% - 32px)',
          padding: 22,
          borderRadius: 22,
          background: '#fff',
        }}
      >
        <h2 id={titleId} style={{ margin: '0 0 8px', color: '#522D80', fontSize: 22 }}>{how.title}</h2>
        <p style={{ margin: '0 0 12px', lineHeight: 1.45 }}>{how.intro}</p>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.5 }}>
          {how.steps.map((step) => (
            <li key={step} style={{ marginBottom: 8 }}>{step}</li>
          ))}
        </ol>
        <button
          type="button"
          className="pressable"
          onClick={() => setInfoOpen(false)}
          style={{
            marginTop: 8,
            minHeight: 44,
            padding: '10px 16px',
            borderRadius: 12,
            fontWeight: 800,
            color: '#fff',
            background: '#522D80',
            border: 'none',
          }}
        >
          Got it
        </button>
      </A11yModalDialog>
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
