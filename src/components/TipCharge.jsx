import { useState } from 'react'
import { formatTipCents, FARE_UNKNOWN_TIP_NOTE, customTipCents, tipPresetView } from '../../packages/rides-native/tipPresets.js'

export function TipCharge({
  fareCents = null,
  existingTipCents = 0,
  busy = false,
  error = null,
  paidCents = null,
  driverEarningsCents = null,
  onTip,
  onSkip,
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState(null)
  const presets = tipPresetView(fareCents)
  const fareKnown = presets.some((row) => row.cents != null)
  const already = Number(existingTipCents) > 0

  if (paidCents || already) {
    const cents = paidCents || existingTipCents
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple)' }}>
          Tip of {formatTipCents(cents)} added for your driver.
        </div>
        {driverEarningsCents != null ? (
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
            {formatTipCents(driverEarningsCents)} is owed to your driver and included in their earnings.
          </p>
        ) : null}
      </div>
    )
  }

  function sendCustom() {
    const parsed = customTipCents(custom)
    if (parsed.error) {
      setCustomError(parsed.error)
      return
    }
    setCustomError(null)
    onTip({ customCents: parsed.cents })
  }

  return (
    <div>
      <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>OPTIONAL</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--purple)', margin: '4px 0 0' }}>Add a tip</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, margin: '8px 0 14px' }}>
        {fareKnown
          ? `Fare ${formatTipCents(fareCents)}. Choose a percent of that fare. You can skip.`
          : `${FARE_UNKNOWN_TIP_NOTE} A custom amount is still optional.`}
      </p>
      {fareKnown && presets.every((row) => !row.chargeable) ? (
        <p style={{ color: 'var(--ink-secondary)', fontSize: 13, marginTop: -6 }}>
          Those percents are outside $1 to $100. Use a custom amount instead.
        </p>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {presets.map((row) => (
          <button
            key={row.percent}
            type="button"
            className="pressable"
            data-testid={`tip-percent-${row.percent}`}
            disabled={busy || !row.chargeable}
            aria-label={row.accessibilityLabel}
            onClick={() => onTip({ percent: row.percent })}
            style={{
              minHeight: 52,
              padding: '12px 16px',
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 800,
              fontSize: 18,
              color: 'var(--purple)',
              background: 'rgba(255,255,255,0.72)',
              border: '1.5px solid rgba(82,45,128,0.28)',
              opacity: row.chargeable ? 1 : 0.55,
            }}
          >
            <span>{row.label}</span>
            <span style={{ color: 'var(--orange)' }}>{row.detail || 'Fare needed'}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="pressable"
        data-testid="tip-custom-toggle"
        disabled={busy}
        onClick={() => setCustomOpen((open) => !open)}
        style={{
          marginTop: 12,
          padding: '4px 0',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--ink-secondary)',
          background: 'transparent',
        }}
      >
        Custom amount
      </button>
      {customOpen ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <label style={{ flex: 1 }}>
            <span className="sr-only">Custom tip in dollars</span>
            <input
              inputMode="decimal"
              value={custom}
              placeholder="8.00"
              aria-label="Custom tip in dollars"
              onChange={(event) => setCustom(event.target.value)}
              style={{
                width: '100%',
                minHeight: 44,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(82,45,128,0.2)',
                fontWeight: 700,
                color: 'var(--purple)',
              }}
            />
          </label>
          <button
            type="button"
            className="pressable"
            data-testid="tip-custom-submit"
            disabled={busy}
            onClick={sendCustom}
            style={{
              minHeight: 44,
              padding: '0 14px',
              borderRadius: 12,
              fontWeight: 800,
              fontSize: 13,
              color: 'var(--purple)',
              background: 'rgba(82,45,128,0.08)',
              border: '1px solid rgba(82,45,128,0.2)',
            }}
          >
            Add
          </button>
        </div>
      ) : null}
      {customError ? <p style={{ color: 'var(--danger-text)', fontSize: 13, marginTop: 8 }}>{customError}</p> : null}
      {error ? <p style={{ color: 'var(--danger-text)', fontSize: 13, marginTop: 8 }}>{error}</p> : null}
      <button
        type="button"
        className="pressable"
        data-testid="tip-skip"
        disabled={busy}
        onClick={onSkip}
        style={{
          marginTop: 16,
          width: '100%',
          minHeight: 44,
          fontWeight: 700,
          color: 'var(--ink-tertiary)',
          background: 'transparent',
        }}
      >
        {busy ? 'Sending tip…' : 'No tip'}
      </button>
    </div>
  )
}
