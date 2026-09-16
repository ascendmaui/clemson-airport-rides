export function PrimaryButton({ children, onClick, variant = 'orange', fullWidth = true, disabled, className = '' }) {
  const bg = variant === 'purple'
    ? 'var(--purple)'
    : variant === 'gradient'
      ? 'linear-gradient(135deg, #522D80 0%, #F56600 100%)'
      : 'var(--orange)'
  return (
    <button
      type="button"
      className={`pressable ${className}`}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: fullWidth ? '100%' : undefined,
        padding: '15px 20px',
        borderRadius: 14,
        background: bg,
        color: '#fff',
        fontWeight: 600,
        fontSize: 17,
        letterSpacing: -0.2,
        opacity: disabled ? 0.5 : 1,
        boxShadow: variant === 'purple'
          ? '0 4px 14px var(--purple-glow), var(--shadow-pill)'
          : '0 4px 14px var(--orange-glow), var(--shadow-pill)',
        transition: 'transform 180ms var(--ease-soft), opacity 180ms var(--ease-soft), box-shadow 220ms var(--ease-soft)',
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
