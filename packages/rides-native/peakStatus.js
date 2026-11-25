/**
 * "Before you go online" fare line. When the server reports peak pricing
 * (flag on), the peak status replaces the game-day multiplier: the legacy
 * multiplier is not what riders pay in that mode.
 */
export function peakSurgeView(peak, online = false) {
  if (!peak?.enabled) return null
  const pct = Math.max(Number(peak.campusSurchargeBps) || 0, Number(peak.airportSurchargeBps) || 0) / 100
  const multiplierLabel = peak.active && pct > 0 ? `+${pct}%` : 'Standard'
  const headline = peak.active ? `${peak.reasonLabel || 'Peak'} pricing` : 'Standard fare'
  const line = online ? headline : (peak.driverLine || headline)
  return { multiplierLabel, headline, line }
}
