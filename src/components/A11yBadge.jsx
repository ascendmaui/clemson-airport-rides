/**
 * Accessible Badge component.
 * Uses high-contrast color tokens adhering to WCAG AA / AAA readability standards.
 */

/**
 * @param {Object} props
 * @param {'purple'|'orange'|'success'|'danger'|'neutral'|'fleet'} [props.variant='neutral']
 * @param {React.ReactNode} props.children
 * @param {string} [props.ariaLabel]
 * @param {string} [props.className='']
 * @param {React.CSSProperties} [props.style]
 * @param {React.ReactNode} [props.icon]
 * @param {string|number} [props.count]
 */
export function A11yBadge({
  variant = 'neutral',
  children,
  ariaLabel,
  className = '',
  style = {},
  icon,
  count,
  ...props
}) {
  return (
    <span
      className={`a11y-badge a11y-badge--${variant} ${className}`.trim()}
      aria-label={ariaLabel}
      style={style}
      {...props}
    >
      {icon && (
        <span aria-hidden="true" className="a11y-badge-icon" style={{ display: 'inline-flex', marginRight: 3 }}>
          {icon}
        </span>
      )}
      <span className="a11y-badge-text">{children}</span>
      {count != null && (
        <span className="a11y-badge-count" style={{ marginLeft: 4, opacity: 0.9 }}>
          {count}
        </span>
      )}
    </span>
  )
}
