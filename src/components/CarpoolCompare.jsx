import { formatUsd } from '../lib/carpoolEngine'

const card = {
  marginTop: 16,
  padding: 16,
  borderRadius: 18,
  background: 'linear-gradient(165deg, rgba(245,102,0,0.12), rgba(82,45,128,0.1))',
  border: '1px solid rgba(245,102,0,0.35)',
}

/**
 * Pre-confirm price story: solo surge vs this rider's split, plus driver net.
 */
export function CarpoolCompare({ quote, selfId, title = 'Your price before you confirm' }) {
  if (!quote?.shares?.length) return null
  const mine = quote.shares.find((share) => share.id === selfId) || quote.shares[0]
  const driver = quote.driver
  return (
    <div style={card}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: 'var(--orange)' }}>
        CARPOOL VS RIDING ALONE
      </div>
      <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--purple)', marginTop: 4 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <div style={{ background: 'rgba(255,255,255,0.72)', borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', fontWeight: 700 }}>Alone, this hop</div>
          <div style={{ fontSize: 22, fontWeight: 800, textDecoration: 'line-through', color: 'var(--ink-secondary)' }}>
            {formatUsd(mine.soloCents)}
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: 12, border: '1.5px solid #F56600' }}>
          <div style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 800 }}>
            {mine.firstRideFree ? 'Your seat · first ride' : `Your seat · ${quote.riderCount} rider${quote.riderCount === 1 ? '' : 's'}`}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#F56600' }}>
            {mine.firstRideFree ? 'Free' : formatUsd(mine.shareCents)}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink)', margin: '12px 0 0', lineHeight: 1.45 }}>
        {mine.firstRideFree
          ? 'Game-week first ride is on us. Everyone else still pays their split.'
          : `You save ${formatUsd(mine.savingsCents)} versus booking this hop alone. A full car (4) is about $10–$15 when the solo surge price is $30–$40.`}
      </p>
      {driver && (
        <p style={{ fontSize: 12, color: 'var(--purple)', margin: '8px 0 0', lineHeight: 1.45, fontWeight: 700 }}>
          Driver nets {formatUsd(driver.payoutCents)}
          {driver.carpoolBonusCents > 0 ? ` · ${formatUsd(driver.carpoolBonusCents)} more than a solo trip` : ''}
          . Platform keeps 20% ({formatUsd(quote.platformFeeCents)}).
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        {quote.shares.map((share) => (
          <div key={share.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(82,45,128,0.12)', fontSize: 13 }}>
            <span>
              {share.firstName}
              {share.id === selfId && share.firstName.toLowerCase() !== 'you' ? ' · you' : ''}
            </span>
            <span>
              <span style={{ color: 'var(--ink-tertiary)', textDecoration: 'line-through', marginRight: 8 }}>{formatUsd(share.soloCents)}</span>
              <strong>{share.firstRideFree ? 'Free' : formatUsd(share.shareCents)}</strong>
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 800 }}>
          <span>Riders pay</span>
          <span>{formatUsd(quote.grossCents)}</span>
        </div>
      </div>
    </div>
  )
}
