/**
 * Rider-facing game day copy.
 * Matches the Learning Center note: Discover and the home map show the
 * pickup zone and the rider fare multiplier from the server.
 */

export const GAME_DAY_LIVE_COPY =
  'Discover and the home map show the pickup zone and the rider fare multiplier from the server.'

export const GAME_DAY_OFF_COPY =
  'No game day is live. Discover and the home map show the pickup zone and the rider fare multiplier when the server turns one on.'

function formatMultiplier(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return null
  const rounded = Math.round(raw * 100) / 100
  return `${rounded}×`
}

export function gameDayNotice(event) {
  if (!event) {
    return {
      live: false,
      title: 'Game day off',
      zone: null,
      multiplier: null,
      multiplierLabel: null,
      headline: 'Game day off',
      detail: null,
      body: GAME_DAY_OFF_COPY,
    }
  }
  const zone = event.pickup_zone_label ? String(event.pickup_zone_label) : null
  const multiplier = Number(event.surge_multiplier)
  const multiplierOk = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null
  const multiplierLabel = formatMultiplier(multiplierOk)
  const title = event.title ? String(event.title) : 'Game day'
  const detail = [
    zone ? `Pickup zone · ${zone}` : 'Pickup zone is on the map',
    multiplierLabel ? `Rider fare ${multiplierLabel}` : null,
  ].filter(Boolean).join(' · ')
  return {
    live: true,
    title,
    zone,
    multiplier: multiplierOk,
    multiplierLabel,
    headline: [title, zone, multiplierLabel].filter(Boolean).join(' · '),
    detail,
    body: GAME_DAY_LIVE_COPY,
  }
}
