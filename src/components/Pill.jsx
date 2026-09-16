export function Pill({ children, icon, tone = 'orange', onClick, active }) {
  const isOrange = tone === 'orange'
  return (
    <button
      type="button"
      className="pressable"
      onClick={onClick}
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
      }}
    >
      {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      {children}
    </button>
  )
}
