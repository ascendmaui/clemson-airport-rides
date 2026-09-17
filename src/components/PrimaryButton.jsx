export function PrimaryButton({
  children,
  onClick,
  variant = 'orange',
  fullWidth = true,
  disabled,
  className = '',
  type = 'button',
}) {
  const bg = variant === 'purple'
    ? 'linear-gradient(135deg, #522D80 0%, #6b3fa0 100%)'
    : variant === 'gradient'
      ? 'linear-gradient(135deg, #522D80 0%, #F56600 100%)'
      : 'linear-gradient(135deg, #F56600 0%, #ff7a1a 100%)'
  return (
    <button
      type={type}
      className={`pressable primary-cta ${className}`}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: fullWidth ? '100%' : undefined,
        padding: '15px 20px',
        borderRadius: 16,
        background: bg,
        color: '#fff',
        fontWeight: 600,
        fontSize: 17,
        letterSpacing: -0.2,
        opacity: disabled ? 0.5 : 1,
        border: '1px solid rgba(255,255,255,0.22)',
        boxShadow: variant === 'purple'
          ? '0 4px 14px var(--purple-glow), var(--shadow-pill)'
          : '0 4px 14px var(--orange-glow), var(--shadow-pill)',
        transition: 'transform 200ms var(--ease-spring), opacity 180ms var(--ease-soft), box-shadow 240ms var(--ease-soft)',
      }}
    >
      {children}
    </button>
  )
}

/** Driver Accept — always Clemson purple */
export function PurpleAcceptButton(props) {
  return <PrimaryButton {...props} variant="purple" />
}
