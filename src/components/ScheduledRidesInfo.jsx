import { useState } from 'react'
import {
  scheduledRidesExplainerKey,
  scheduledRidesGuide,
  scheduledRidesTopic,
} from '../../shared/copy/scheduledRides.js'

function Steps({ lines }) {
  return (
    <ol style={{ margin: '12px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {lines.map((line) => (
        <li key={line} style={{ lineHeight: 1.4 }}>{line}</li>
      ))}
    </ol>
  )
}

export function ScheduledRidesInfoButton({ topic }) {
  const [open, setOpen] = useState(false)
  const guide = scheduledRidesTopic(topic)
  return (
    <>
      <button
        type="button"
        className="pressable"
        aria-label={guide.infoLabel}
        onClick={() => setOpen(true)}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        i
      </button>
      {open ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(20, 16, 28, 0.45)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={guide.title}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(480px, 100%)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              borderRadius: '20px 20px 0 0',
              padding: '12px 20px 28px',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <div className="sheet-handle" />
            <h2 style={{ margin: '8px 0 0', fontSize: 22, letterSpacing: -0.3 }}>{guide.title}</h2>
            <Steps lines={guide.steps} />
            <button
              type="button"
              className="pressable"
              onClick={() => setOpen(false)}
              style={{
                marginTop: 18,
                minHeight: 48,
                width: '100%',
                borderRadius: 14,
                background: '#F56600',
                color: '#fff',
                fontWeight: 800,
              }}
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function ScheduledRidesHint({ topic }) {
  const guide = scheduledRidesTopic(topic)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
      <p style={{ flex: 1, fontSize: 13, lineHeight: 1.45, margin: '10px 0 0', color: 'var(--ink-secondary)' }}>{guide.helper}</p>
      <ScheduledRidesInfoButton topic={topic} />
    </div>
  )
}

export function ScheduledRidesExplainer({ role }) {
  const guide = scheduledRidesGuide(role === 'driver' ? 'driver' : 'rider')
  const [open, setOpen] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(scheduledRidesExplainerKey(role)) !== '1'
    } catch {
      return true
    }
  })
  if (!open) return null
  function dismiss() {
    try {
      globalThis.localStorage?.setItem(scheduledRidesExplainerKey(role), '1')
    } catch {
      /* The card can still close for this visit. */
    }
    setOpen(false)
  }
  return (
    <div
      style={{
        margin: '0 0 12px',
        padding: 12,
        borderRadius: 14,
        background: 'rgba(82,45,128,0.08)',
        border: '1px solid rgba(82,45,128,0.18)',
      }}
    >
      <div style={{ fontWeight: 800, color: '#522D80' }}>{guide.title}</div>
      <Steps lines={guide.summary} />
      <button
        type="button"
        className="pressable"
        onClick={dismiss}
        style={{
          marginTop: 12,
          minHeight: 44,
          width: '100%',
          borderRadius: 12,
          background: '#F56600',
          color: '#fff',
          fontWeight: 800,
        }}
      >
        Got it
      </button>
    </div>
  )
}
