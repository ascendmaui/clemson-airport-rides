import { ONBOARDING_FLOW, canOpenStep, progressSnapshot, stepIsComplete } from '../../shared/driverOnboarding.js'

const ORANGE = '#F56600'
const PURPLE = '#522D80'

export function OnboardingProgress({ viewing, onSelect, ...ctx }) {
  const snap = progressSnapshot({ ...ctx, viewing })

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: PURPLE }}>
          Step {snap.stepNumber} of {snap.total}
          <span style={{ fontWeight: 650, color: 'var(--ink-secondary)' }}> · {snap.label}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: ORANGE }}>{snap.percent}%</div>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={snap.percent}
        aria-label={`Driver application progress, step ${snap.stepNumber} of ${snap.total}`}
        style={{
          marginTop: 8,
          height: 12,
          borderRadius: 999,
          background: PURPLE,
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.18)',
        }}
      >
        <div
          style={{
            width: `${snap.percent}%`,
            height: '100%',
            background: ORANGE,
            borderRadius: 999,
            transition: 'width 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, overflowX: 'auto', paddingBottom: 2 }}>
        {ONBOARDING_FLOW.map((step, index) => {
          const done = stepIsComplete(step.id, ctx)
          const current = step.id === viewing
          const reachable = canOpenStep(step.id, ctx)
          return (
            <button
              key={step.id}
              type="button"
              className="pressable"
              disabled={!reachable}
              onClick={() => reachable && onSelect?.(step.id)}
              style={{
                flex: '0 0 auto',
                padding: '7px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                color: current ? '#fff' : done ? PURPLE : 'rgba(82,45,128,0.55)',
                background: current ? ORANGE : done ? 'rgba(245,102,0,0.12)' : 'rgba(82,45,128,0.08)',
                border: current ? 'none' : '1px solid rgba(82,45,128,0.12)',
                opacity: reachable ? 1 : 0.55,
              }}
            >
              {done ? '✓ ' : `${index + 1} `}
              {step.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
