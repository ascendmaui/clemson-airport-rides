import { formatUsdFromCents } from '../lib/pricing'
import { formatPickupAt, toDriverQueueCard } from '../lib/scheduledRideModel'

/**
 * Driver list of scheduled rides.
 * Cards are first-name + labels only — no map pins.
 */
export function ScheduledRideQueue({ rides, acceptingId, onAccept, title = 'Scheduled rides', emptyHint }) {
  const cards = (rides || []).map(toDriverQueueCard).filter(Boolean)
  if (!cards.length) {
    if (!emptyHint) return null
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, color: '#522D80', marginBottom: 4 }}>{title}</div>
        <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: 0 }}>{emptyHint}</p>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 14 }} aria-label={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, color: '#522D80' }}>{title}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#F56600' }}>{cards.length}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cards.map((ride) => {
          const accepting = acceptingId === ride.id
          return (
            <article
              key={ride.id}
              style={{
                padding: 12,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.86)',
                border: '1px solid rgba(82,45,128,0.18)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ color: '#522D80' }}>{formatPickupAt(ride.pickupAt)}</strong>
                <span style={{ fontWeight: 800, color: '#F56600' }}>{formatUsdFromCents(ride.fareCents)}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {ride.pickupLabel} → {ride.dropoffLabel}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
                {ride.firstName}
                {ride.purpose ? ` · ${ride.purpose}` : ''}
              </div>
              {onAccept && ride.status === 'scheduled' && (
                <button
                  type="button"
                  className="pressable"
                  disabled={Boolean(acceptingId)}
                  onClick={() => onAccept(ride.id)}
                  style={{
                    marginTop: 10,
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    fontWeight: 700,
                    color: '#fff',
                    background: '#522D80',
                    opacity: acceptingId && !accepting ? 0.6 : 1,
                  }}
                >
                  {accepting ? 'Accepting…' : 'Accept scheduled ride'}
                </button>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
