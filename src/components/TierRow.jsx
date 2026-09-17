export function TierRow({ tier, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`pressable tier-row-glass ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(tier)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '14px 12px',
        borderRadius: 14,
        background: selected
          ? 'linear-gradient(135deg, rgba(245,102,0,0.12), rgba(255,255,255,0.55))'
          : 'transparent',
        border: selected ? '1.5px solid rgba(245,102,0,0.28)' : '1.5px solid transparent',
        textAlign: 'left',
        boxShadow: selected ? 'var(--shadow-pill)' : 'none',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: tier.premium
            ? 'linear-gradient(145deg, rgba(82,45,128,0.14), rgba(255,255,255,0.6))'
            : 'rgba(255,255,255,0.55)',
          border: '1px solid rgba(255,255,255,0.45)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 24,
          boxShadow: selected ? 'var(--shadow-pill)' : 'none',
          transition: 'box-shadow 200ms var(--ease-soft), transform 200ms var(--ease-spring)',
          transform: selected ? 'scale(1.04)' : 'scale(1)',
        }}
      >
        {tier.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{tier.name}</span>
          {tier.badge && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.4,
                color: 'var(--purple)',
                background: 'rgba(82,45,128,0.12)',
                border: '1px solid rgba(82,45,128,0.18)',
                padding: '2px 7px',
                borderRadius: 999,
              }}
            >
              {tier.badge}
            </span>
          )}
        </div>
        <div style={{ color: 'var(--ink-secondary)', fontSize: 13, marginTop: 2 }}>
          {tier.eta} · {tier.meta}
        </div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>
        ${tier.price.toFixed(2)}
      </div>
      {selected && (
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--orange)',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            boxShadow: '0 2px 6px var(--orange-glow)',
          }}
        >
          ✓
        </div>
      )}
    </button>
  )
}
