/**
 * Accessible loading spinners and skeleton placeholder components
 * for ride cards, lists, and driver offer streams.
 */

export function LoadingSpinner({
  size = 24,
  tone = 'orange',
  label = 'Loading…',
  inline = false,
  className = '',
}) {
  const color = tone === 'purple' ? 'var(--purple)' : tone === 'white' ? '#ffffff' : 'var(--orange)'
  const trackColor = tone === 'purple'
    ? 'rgba(82, 45, 128, 0.2)'
    : tone === 'white'
      ? 'rgba(255, 255, 255, 0.3)'
      : 'rgba(245, 102, 0, 0.2)'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`loading-spinner-wrapper ${className}`}
      style={{
        display: inline ? 'inline-flex' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: inline ? 0 : '16px 0',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          border: `3px solid ${trackColor}`,
          borderTopColor: color,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      />
      {label && (
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: tone === 'purple' ? 'var(--purple)' : tone === 'white' ? '#fff' : 'var(--ink-secondary)',
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

export function SkeletonLine({
  width = '100%',
  height = 14,
  borderRadius = 6,
  style = {},
  className = '',
}) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-pulse ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  )
}

export function SkeletonRideCard({ label = 'Loading ride details…', count = 1 }) {
  const items = Array.from({ length: count }, (_, i) => i)
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {items.map((key) => (
        <div
          key={key}
          className="glass-panel"
          style={{
            padding: 16,
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SkeletonLine width="45%" height={18} borderRadius={8} />
            <SkeletonLine width="20%" height={18} borderRadius={8} />
          </div>
          <SkeletonLine width="75%" height={14} borderRadius={6} />
          <SkeletonLine width="35%" height={12} borderRadius={6} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonDriverCard({ count = 2 }) {
  const items = Array.from({ length: count }, (_, i) => i)
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading available drivers…"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {items.map((key) => (
        <div
          key={key}
          className="glass-panel"
          style={{
            padding: 14,
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            aria-hidden="true"
            className="skeleton-pulse"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: 'rgba(0,0,0,0.08)',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonLine width="50%" height={16} borderRadius={6} />
            <SkeletonLine width="80%" height={12} borderRadius={4} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkeletonOfferStream({ label = 'Checking for ride offers…' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        padding: '24px 20px',
        borderRadius: 20,
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid rgba(82,45,128,0.15)',
        boxShadow: 'var(--shadow-soft)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 12,
      }}
    >
      <LoadingSpinner tone="purple" size={32} inline />
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--purple)' }}>{label}</div>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: 0, maxWidth: 300, lineHeight: 1.4 }}>
        When new trip requests enter your broadcast area, they will appear immediately.
      </p>
    </div>
  )
}
