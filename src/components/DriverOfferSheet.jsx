import { PurpleAcceptButton } from './PrimaryButton'
import { formatMiles, formatMinutes, clockTime, hourlyRateCents } from '../lib/rideGeometry'
import { money } from '../lib/receiptText'

export function DriverOfferSheet({
  offer,
  riderName,
  estimate,
  canQueue,
  queueCount,
  busy,
  error,
  ratingAvg,
  ratingCount,
  standing,
  onAccept,
  onQueue,
  onDecline,
}) {
  const fare = Number(offer?.fare_cents) || 0
  const toPickup = estimate?.toPickupSec || 0
  const tripSec = estimate?.tripSec || 0
  const rate = hourlyRateCents(fare, toPickup, tripSec)
  const now = Date.now()

  return (
    <div
      className="sheet glass-panel--elevated"
      data-offer-sheet="1"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        padding: '12px 20px calc(20px + var(--safe-bottom))',
        borderTop: '1px solid rgba(255,255,255,0.65)',
        maxHeight: '72%',
        overflowY: 'auto',
      }}
    >
      <div className="sheet-handle" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.1, color: 'var(--orange)' }}>
            NEW RIDE
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>{money(fare)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--purple)' }}>
            {rate.hourlyCents ? `${money(rate.hourlyCents)}/hr` : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>est. including pickup</div>
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{riderName || 'Rider'}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple)' }}>
          {ratingCount > 0 && ratingAvg != null ? `★ ${Number(ratingAvg).toFixed(1)}` : 'New rider'}
        </div>
      </div>
      {standing === 'watch' && (
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--orange)' }}>
          Low rating — under 3.0 after several trips. You can still accept.
        </div>
      )}
      {canQueue && (
        <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
          You’re close to drop-off{queueCount ? ` · ${queueCount} queued` : ''}. Accept now puts this ride next.
        </div>
      )}

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Stat label="To pickup" value={toPickup ? formatMinutes(toPickup) : '—'} />
        <Stat label="Trip" value={tripSec ? formatMinutes(tripSec) : '—'} />
        <Stat label="Distance" value={estimate?.tripMeters != null ? formatMiles(estimate.tripMeters) : '—'} />
        <Stat label="Pickup around" value={toPickup ? clockTime(now, toPickup) : '—'} />
        <Stat label="Drop-off around" value={toPickup || tripSec ? clockTime(now, toPickup + tripSec) : '—'} />
        <Stat label="Occupied" value={formatMinutes(rate.occupiedSec)} />
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Place color="var(--orange)" mark="●" title="From" label={offer?.pickup_label} />
        <Place color="var(--purple)" mark="■" title="To" label={offer?.dropoff_label} />
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}

      <PurpleAcceptButton onClick={onAccept} disabled={busy}>
        {busy ? 'Saving…' : canQueue ? 'Accept now' : 'Accept'}
      </PurpleAcceptButton>
      {canQueue && (
        <button
          type="button"
          className="pressable"
          onClick={onQueue}
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 8,
            padding: 14,
            borderRadius: 16,
            fontWeight: 700,
            color: 'var(--purple)',
            background: 'rgba(82,45,128,0.08)',
            border: '1px solid rgba(82,45,128,0.2)',
          }}
        >
          Add to queue
        </button>
      )}
      <button
        type="button"
        className="pressable"
        onClick={onDecline}
        disabled={busy}
        style={{ width: '100%', marginTop: 8, padding: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}
      >
        Decline
      </button>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: 12, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  )
}

function Place({ color, mark, title, label }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ color, fontWeight: 700 }}>{mark}</span>
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{label || '—'}</div>
      </div>
    </div>
  )
}
