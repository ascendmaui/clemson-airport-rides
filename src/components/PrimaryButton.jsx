export function PrimaryButton({
  children,
  onClick,
  variant = 'orange',
  fullWidth = true,
  disabled,
  loading = false,
  spinnerTone = 'white',
  className = '',
  type = 'button',
  ariaLabel,
  ...rest
}) {
  const orangeSpinner = spinnerTone === 'orange' && loading
  const bg = orangeSpinner
    ? '#fff'
    : variant === 'purple'
      ? 'linear-gradient(135deg, #522D80 0%, #6b3fa0 100%)'
      : variant === 'gradient'
        ? 'linear-gradient(135deg, #522D80 0%, #F56600 100%)'
        : 'linear-gradient(135deg, #F56600 0%, #ff7a1a 100%)'

  const isDisabled = Boolean(disabled || loading)

  return (
    <button
      type={type}
      className={`pressable primary-cta variant-${variant} ${className}`}
      disabled={isDisabled}
      aria-disabled={isDisabled ? 'true' : undefined}
      aria-busy={loading ? 'true' : undefined}
      aria-label={ariaLabel || (typeof children === 'string' ? children : undefined)}
      onClick={isDisabled ? undefined : onClick}
      {...rest}
      style={{
        width: fullWidth ? '100%' : undefined,
        padding: '15px 20px',
        borderRadius: 16,
        background: bg,
        color: orangeSpinner ? '#1a1a1a' : '#fff',
        fontWeight: 600,
        fontSize: 17,
        letterSpacing: -0.2,
        opacity: isDisabled && !orangeSpinner ? 0.5 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        border: '1px solid rgba(255,255,255,0.22)',
        boxShadow: variant === 'purple'
          ? '0 4px 14px var(--purple-glow), var(--shadow-pill)'
          : '0 4px 14px var(--orange-glow), var(--shadow-pill)',
        transition: 'transform 200ms var(--ease-spring), opacity 180ms var(--ease-soft), box-shadow 240ms var(--ease-soft)',
        ...rest.style,
      }}
    >
      {loading ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span
            className="button-spinner"
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              border: orangeSpinner ? '2px solid rgba(245,102,0,0.35)' : '2px solid rgba(255,255,255,0.4)',
              borderTopColor: orangeSpinner ? '#F56600' : '#fff',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span>{children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  )
}

/** Driver Accept — always Clemson purple */
export function PurpleAcceptButton(props) {
  return <PrimaryButton {...props} variant="purple" />
}
