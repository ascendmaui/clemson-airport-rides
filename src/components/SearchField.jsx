export function SearchField({ value, onChange, onFocus, placeholder = 'Where are you going?', orangeOutline }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        background: 'var(--surface)',
        borderRadius: 16,
        border: orangeOutline ? '2px solid var(--orange)' : '1px solid var(--border)',
        boxShadow: orangeOutline ? '0 4px 16px rgba(245,102,0,0.12)' : 'var(--shadow-pill)',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--ink)',
          fontSize: 16,
          fontWeight: 500,
        }}
      />
    </div>
  )
}
