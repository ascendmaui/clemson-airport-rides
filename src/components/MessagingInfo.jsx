import { useState } from 'react'
import { messagingGuide } from '../../shared/copy/messaging.js'

function GuideBody({ guide }) {
  return (
    <>
      <h2 style={{ margin: '8px 0 0', fontSize: 22, letterSpacing: -0.3 }}>{guide.title}</h2>
      <ol style={{ margin: '12px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {guide.summary.map((line) => (
          <li key={line} style={{ lineHeight: 1.4 }}>{line}</li>
        ))}
      </ol>
      <h3 style={{ margin: '18px 0 0', fontSize: 16 }}>{guide.lostItemTitle}</h3>
      <ol style={{ margin: '8px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {guide.lostItemSteps.map((line) => (
          <li key={line} style={{ lineHeight: 1.4 }}>{line}</li>
        ))}
      </ol>
    </>
  )
}

export function MessagingInfoButton({ role }) {
  const [open, setOpen] = useState(false)
  const guide = messagingGuide(role === 'driver' ? 'driver' : 'rider')
  return (
    <>
      <button
        type="button"
        className="pressable"
        aria-label={guide.infoLabel}
        data-testid="messaging-info"
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
            data-testid="messaging-info-sheet"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(480px, 100%)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              borderRadius: '20px 20px 0 0',
              padding: '12px 20px 28px',
            }}
          >
            <div className="sheet-handle" />
            <GuideBody guide={guide} />
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
