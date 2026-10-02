import { getLivePhaseRegionProps, getProgressStepA11yProps } from '../lib/liveDispatchA11y'

export function LivePhase({
  kicker,
  title,
  body,
  eta,
  steps,
  activeIndex,
  role = 'status',
  ariaLive = 'polite',
  ariaAtomic = true,
  className = '',
}) {
  const liveRegionProps = getLivePhaseRegionProps({ role, ariaLive, ariaAtomic })
  const progressProps = activeIndex >= 0 && steps?.length
    ? getProgressStepA11yProps({ activeIndex, steps })
    : null

  return (
    <div {...liveRegionProps} className={className || undefined}>
      {kicker ? (
        <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>{kicker}</div>
      ) : null}
      {title ? (
        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, margin: '6px 0 8px', color: 'var(--purple)' }}>{title}</h2>
      ) : null}
      {body ? <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>{body}</p> : null}
      {eta ? <p style={{ color: 'var(--purple)', fontWeight: 800, fontSize: 14, marginTop: 8 }}>{eta}</p> : null}
      {progressProps ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }} {...progressProps}>
          {steps.map((step, index) => {
            const on = index <= activeIndex
            const current = index === activeIndex
            return (
              <div
                key={step.id}
                style={{ flex: 1, minWidth: 0 }}
                aria-current={current ? 'step' : undefined}
                aria-hidden="true"
              >
                <div
                  className={current ? 'live-phase-step--current' : undefined}
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: current ? 'var(--orange)' : on ? 'var(--purple)' : 'rgba(82,45,128,0.14)',
                  }}
                />
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    color: current ? 'var(--orange)' : on ? 'var(--purple)' : 'var(--ink-tertiary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {step.label}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

