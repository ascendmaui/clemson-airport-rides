import { SITE_ICON_NAMES, SiteIcon } from './SiteIcon.jsx'

export function Pill({
  children,
  icon,
  tone = 'orange',
  onClick,
  active,
  ariaLabel,
  className = '',
  ...rest
}) {
  const isOrange = tone === 'orange'
  return (
    <button
      type="button"
      className={`pressable pill-btn ${className}`}
      onClick={onClick}
      aria-pressed={active !== undefined ? Boolean(active) : undefined}
      aria-label={ariaLabel || (typeof children === 'string' ? children : undefined)}
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        borderRadius: 'var(--radius-pill)',
        background: active
          ? (isOrange ? 'var(--orange-soft)' : 'var(--purple-soft)')
          : 'var(--surface)',
        color: isOrange ? 'var(--orange)' : 'var(--purple)',
        border: `1.5px solid ${isOrange ? 'rgba(245,102,0,0.35)' : 'rgba(82,45,128,0.35)'}`,
        fontWeight: 600,
        fontSize: 14,
        boxShadow: 'var(--shadow-pill)',
        whiteSpace: 'nowrap',
        ...rest.style,
      }}
    >
      {icon && (
        <span style={{ display: 'inline-flex', color: 'currentColor' }} aria-hidden="true">
          {typeof icon === 'string' && SITE_ICON_NAMES.includes(icon) ? <SiteIcon name={icon} size={16} /> : icon}
        </span>
      )}
      {children}
    </button>
  )
}
