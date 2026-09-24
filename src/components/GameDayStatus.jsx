/**
 * Live game-day zone and rider fare multiplier, or the off state.
 * Copy matches the driver Learning Center.
 */
export function GameDayStatus({ notice, ready = true, compact = false }) {
  const live = Boolean(ready && notice?.live)
  return (
    <div
      style={{
        borderRadius: 16,
        padding: compact ? '10px 12px' : 14,
        background: live ? 'rgba(245,102,0,0.12)' : 'rgba(82,45,128,0.08)',
        border: `1px solid ${live ? 'rgba(245,102,0,0.45)' : 'rgba(82,45,128,0.22)'}`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.1, color: live ? '#F56600' : '#522D80' }}>
        {ready ? (live ? 'GAME DAY' : 'GAME DAY OFF') : 'GAME DAY'}
      </div>
      <div style={{ fontWeight: 800, marginTop: 4, color: '#522D80' }}>
        {ready ? notice.headline : 'Checking the server…'}
      </div>
      {ready && notice?.detail ? (
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F56600', marginTop: 4 }}>{notice.detail}</div>
      ) : null}
      {ready ? (
        <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4, lineHeight: 1.45 }}>{notice.body}</div>
      ) : null}
    </div>
  )
}
