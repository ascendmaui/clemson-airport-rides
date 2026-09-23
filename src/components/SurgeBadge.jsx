/** Rider and driver surge pill. Renders nothing when the multiplier is 1. */
export function SurgeBadge({ surge, earningsCents }) {
  const multiplier = Number(surge?.multiplier || surge)
  if (!Number.isFinite(multiplier) || multiplier <= 1) return null
  const label = surge?.rule?.label || surge?.label || 'Surge'
  const shown = multiplier.toFixed(2).replace(/0$/, '').replace(/\.$/, '')
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        color: '#fff',
        background: 'linear-gradient(135deg, #F56600 0%, #522D80 100%)',
        letterSpacing: 0.2,
      }}
    >
      Surge · {label} {shown}×
      {earningsCents != null ? ` · you earn $${(earningsCents / 100).toFixed(2)}` : ''}
    </span>
  )
}
