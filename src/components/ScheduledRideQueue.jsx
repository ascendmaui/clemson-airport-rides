import { formatUsdFromCents } from '../lib/pricing'
import { formatPickupAt, toDriverQueueCard } from '../lib/scheduledRideModel'
import { compareBoostedFirst, formatBoostBadge } from '../../shared/scheduledBoost.js'

/**
 * Driver list of scheduled rides.
 * Cards are first-name + labels only — no map pins.
 */
export function ScheduledRideQueue({
  rides,
  acceptingId,
  onAccept,
  title = 'Scheduled rides',
  emptyHint,
  emptyAction,
}) {
  const cards = (rides || []).map(toDriverQueueCard).filter(Boolean).sort(compareBoostedFirst)
  if (!cards.length) {
    return (
      <div style={{ marginBottom: 14 }} role="status" aria-label={`${title} empty`}>
        <div style={{ fontWeight: 800, color: '#522D80', marginBottom: 6 }}>{title}</div>
        <div
          style={{
            padding: '16px 14px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.7)',
            border: '1px dashed rgba(82,45,128,0.22)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 4 }} aria-hidden="true">📅</div>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: 0, lineHeight: 1.45 }}>
            {emptyHint || 'No scheduled rides available right now. Upcoming airport and game-day reservations will appear here.'}
          </p>
          {emptyAction && <div style={{ marginTop: 10 }}>{emptyAction}</div>}
        </div>
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
                background: ride.boostCents > 0 ? 'rgba(245,102,0,0.08)' : 'rgba(255,255,255,0.86)',
                border: ride.boostCents > 0 ? '2px solid #F56600' : '1px solid rgba(82,45,128,0.18)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <strong style={{ color: '#522D80' }}>{formatPickupAt(ride.pickupAt)}</strong>
                <span style={{ fontWeight: 800, color: '#F56600', textAlign: 'right' }}>
                  {formatUsdFromCents(ride.estimatedEarningsCents)}
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#522D80' }}>est. earnings</span>
                </span>
              </div>
              {ride.boostCents > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      background: '#F56600',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: 12,
                      borderRadius: 999,
                      padding: '4px 10px',
                    }}
                  >
                    {formatBoostBadge(ride.boostDriverCents)}
                  </span>
                </div>
              )}
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {ride.pickupLabel} → {ride.dropoffLabel}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
                {ride.firstName}
                {ride.purpose ? ` · ${ride.purpose}` : ''}
              </div>
              {ride.nearTerm && (
                <p style={{ fontSize: 12 }}>On the board now. Any driver can accept this pickup.</p>
              )}
              {ride.automaticMatching && !ride.nearTerm && <p style={{ fontSize: 12 }}>Offers start about 45 minutes before pickup.</p>}
              {onAccept && ride.status === 'scheduled' && (ride.nearTerm || !ride.automaticMatching) && (
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
