import { useMemo } from 'react'
import { confirmChargeNote, formatUsd, otherFirstRideLabels, surgeDelta } from '../lib/carpoolEngine'

/**
 * Pre-confirm price story. The big numbers are always
 * surge-alone (~$30–$40) versus a full car (~$10–$15).
 * mode="confirm" also states the amount this button will charge.
 */
export function CarpoolCompare({
  pickup,
  dropoff,
  quote = null,
  selfId = null,
  at,
  mode = 'pitch',
}) {
  const delta = useMemo(
    () => surgeDelta({ pickup, dropoff, quote, selfId, at }),
    [pickup, dropoff, quote, selfId, at],
  )
  if (!delta) return null

  const chargingNow = mode === 'confirm' && delta.currentShareCents != null
  const fullCarNow = chargingNow && !delta.currentFirstRideFree && delta.currentRiderCount === 4
    && Math.abs(delta.currentShareCents - delta.fullCarShareCents) <= 75
  const chargeNote = mode === 'confirm'
    ? confirmChargeNote({
      shareCents: delta.currentShareCents,
      firstRideFree: delta.currentFirstRideFree,
      riderCount: delta.currentRiderCount,
      fullCarShareCents: delta.fullCarShareCents,
      fullCarNow,
    })
    : null
  const otherFree = mode === 'confirm'
    ? otherFirstRideLabels(quote, delta.currentFirstRideFree ? delta.currentShareId : null)
    : []

  return (
    <section
      aria-label="Carpool price compared with riding alone"
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 18,
        background: 'linear-gradient(165deg, rgba(245,102,0,0.14), rgba(82,45,128,0.1))',
        border: '1.5px solid rgba(245,102,0,0.45)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: '#F56600' }}>
        {mode === 'confirm' ? 'BEFORE YOU CONFIRM' : 'WHY CARPOOL'}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, marginTop: 10 }}>
        <PriceBox
          label="Alone in surge"
          amount={formatUsd(delta.soloSurgeCents)}
          muted
        />
        <div style={{ alignSelf: 'center', fontSize: 22, fontWeight: 800, color: '#F56600' }} aria-hidden="true">→</div>
        <PriceBox
          label="Your seat · 4 riders"
          amount={formatUsd(delta.fullCarShareCents)}
        />
      </div>
      <div style={{
        marginTop: 12,
        padding: '10px 12px',
        borderRadius: 12,
        background: '#F56600',
        color: '#fff',
        fontWeight: 800,
        fontSize: 16,
      }}>
        You save {formatUsd(delta.savingsCents)}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.45, color: '#522D80', fontWeight: 700 }}>
        Driver earns {formatUsd(delta.driverBonusCents)} more
        {' '}({formatUsd(delta.driverPayoutCents)} vs {formatUsd(delta.driverSoloPayoutCents)} for one rider).
      </p>
      {chargeNote && (
        <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--ink)' }}>
          {chargeNote}
        </p>
      )}
      {otherFree.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--ink)', fontWeight: 700 }}>
          First ride free for {otherFree.join(', ')}.
        </p>
      )}
    </section>
  )
}

function PriceBox({ label, amount, muted = false }) {
  return (
    <div style={{
      flex: 1,
      background: muted ? 'rgba(255,255,255,0.7)' : '#fff',
      borderRadius: 14,
      padding: 12,
      border: muted ? 'none' : '1.5px solid #F56600',
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: muted ? 'var(--ink-tertiary)' : '#F56600' }}>{label}</div>
      <div style={{
        fontSize: 26,
        fontWeight: 800,
        letterSpacing: -0.5,
        color: muted ? 'var(--ink-secondary)' : '#F56600',
        textDecoration: muted ? 'line-through' : 'none',
      }}>
        {amount}
      </div>
    </div>
  )
}
