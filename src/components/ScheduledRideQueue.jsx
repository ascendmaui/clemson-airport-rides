import { useEffect, useState } from 'react'
import { formatUsdFromCents } from '../lib/pricing'
import { formatPickupAt, toDriverQueueCard } from '../lib/scheduledRideModel'
import { CONFIRM_TRIP_COPY, backupNumberTwoCopy, confirmCountdownLabel, driverBackupPresentation } from '../../shared/backupDriverQueue.js'

function ConfirmCountdown({ closesAt }) {
  const [label, setLabel] = useState(() => confirmCountdownLabel(closesAt))
  useEffect(() => {
    const tick = () => setLabel(confirmCountdownLabel(closesAt))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [closesAt])
  if (!label) return null
  return <p style={{ fontSize: 22, fontWeight: 800, color: '#F56600', margin: '4px 0 0' }}>{label}</p>
}

/**
 * Driver list of scheduled rides.
 * Cards are first-name + labels only — no map pins.
 */
export function ScheduledRideQueue({
  rides,
  acceptingId,
  onAccept,
  onConfirm,
  onRelease,
  viewerId,
  title = 'Scheduled rides',
  emptyHint,
  emptyAction,
}) {
  const cards = (rides || []).map((row) => {
    const card = toDriverQueueCard(row)
    if (!card) return null
    const seat = driverBackupPresentation(row, viewerId)
    return { ...card, seat }
  }).filter(Boolean)
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
              {ride.backupLabel && (
                <div style={{
                  display: 'inline-block',
                  marginTop: 8,
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: '#F56600',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 800,
                }}
                >
                  {ride.backupLabel}
                </div>
              )}
              {ride.seat?.lookingForBackup && (
                <p style={{ fontSize: 12, fontWeight: 700, color: '#522D80' }}>Looking for backup driver</p>
              )}
              {ride.seat?.role === 'backup' && (
                <p style={{ fontSize: 12, fontWeight: 700, color: '#522D80' }}>{backupNumberTwoCopy(formatPickupAt(ride.pickupAt))}</p>
              )}
              {ride.seat?.confirmOpen && (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 12, background: 'rgba(245,102,0,0.12)' }}>
                  <div style={{ fontWeight: 800, color: '#F56600' }}>Confirm trip</div>
                  <p style={{ fontSize: 12, margin: '4px 0 8px' }}>{CONFIRM_TRIP_COPY}</p>
                  {ride.seat.urgent && (
                    <p style={{ fontSize: 12, fontWeight: 800, color: '#F56600' }}>You are up. Confirm and start toward pickup.</p>
                  )}
                  <ConfirmCountdown closesAt={ride.seat.confirmClosesAt} />
                  {onConfirm && (
                    <button
                      type="button"
                      className="pressable"
                      onClick={() => onConfirm(ride.id)}
                      style={{
                        marginTop: 8,
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 12,
                        fontWeight: 800,
                        color: '#fff',
                        background: '#F56600',
                      }}
                    >
                      Confirm trip
                    </button>
                  )}
                </div>
              )}
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
                  {accepting ? 'Accepting…' : (ride.seat?.role === 'open_backup' ? 'Accept backup seat' : 'Accept scheduled ride')}
                </button>
              )}
              {onRelease && (ride.seat?.role === 'primary' || ride.seat?.role === 'backup') && (
                <button
                  type="button"
                  className="pressable"
                  onClick={() => onRelease(ride.id, ride.seat.role)}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    fontWeight: 700,
                    color: '#522D80',
                    background: 'transparent',
                    border: '1px solid #522D80',
                  }}
                >
                  {ride.seat.role === 'backup' ? 'Leave backup seat' : 'Can\'t make this trip'}
                </button>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
