/**
 * Game-day pickup labels and surge-banner copy for the web schedule flow.
 * Display only. This module does not price rides or change cents.
 *
 * Pickup coordinates match src/lib/carpoolEngine.js NEIGHBORHOODS.
 * Lot 5 has no separate published pin; place lookup already treats
 * "Memorial Stadium · Lot 5" as the stadium stop.
 */

export const GAME_DAY_SCHEDULE_TIME_COPY =
  'All pickup times are Eastern. Game-day times are suggestions; choose your actual event date and pickup time.'

export const GAME_DAY_SCHEDULE_LIVE_COPY =
  'The schedule shows the pickup zone and the rider fare multiplier from the quote.'

export const GAME_DAY_SCHEDULE_OFF_COPY =
  'No game day is on this pickup. The schedule shows the pickup zone and the rider fare multiplier when the quote includes them.'

export const GAME_DAY_PICKUP_HINT =
  'Special pickup points for a campus event.'

export const GAME_DAY_PICKUP_POINTS = [
  {
    id: 'lot-5',
    label: 'Memorial Stadium · Lot 5',
    detail: 'Lot 5 perimeter',
    lat: 34.6788,
    lng: -82.843,
    aliases: ['lot 5', 'lot 5 / memorial stadium', 'memorial stadium · lot 5'],
  },
  {
    id: 'memorial-stadium',
    label: 'Memorial Stadium',
    detail: 'Stadium gate',
    lat: 34.6788,
    lng: -82.843,
    aliases: ['memorial stadium', 'death valley', 'stadium', 'memorial stadium gate 1'],
  },
  {
    id: 'littlejohn',
    label: 'Littlejohn',
    detail: 'Arena pickup',
    lat: 34.6805,
    lng: -82.846,
    aliases: ['littlejohn', 'littlejohn coliseum'],
  },
  {
    id: 'bowman',
    label: 'Bowman Field',
    detail: 'Tailgate field',
    lat: 34.678,
    lng: -82.837,
    aliases: ['bowman', 'bowman field'],
  },
]

function cleanText(value) {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function zoneFrom(input) {
  if (input == null) return ''
  if (typeof input === 'string' || typeof input === 'number') return cleanText(input)
  if (typeof input !== 'object') return ''
  return cleanText(
    input.pickup_zone_label
    ?? input.zone
    ?? input.pickupZone
    ?? '',
  )
}

function norm(value) {
  return cleanText(value).toLowerCase()
}

/** Known campus-event stop, or null when the server zone is not one of these points. */
export function matchGameDayPickupPoint(input) {
  const raw = norm(zoneFrom(input))
  if (!raw) return null
  const exact = GAME_DAY_PICKUP_POINTS.find((point) =>
    norm(point.id) === raw
    || norm(point.label) === raw
    || point.aliases.some((alias) => alias === raw),
  )
  if (exact) return exact
  const ranked = GAME_DAY_PICKUP_POINTS
    .flatMap((point) => point.aliases.map((alias) => ({ point, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)
  const hit = ranked.find(({ alias }) =>
    raw.startsWith(`${alias} `)
    || raw.startsWith(`${alias} ·`)
    || raw.startsWith(`${alias}/`)
    || raw.startsWith(`${alias},`),
  )
  return hit?.point || null
}

/**
 * Rider-facing label for a special pickup point.
 * Known points use the shared schedule label. Any other server zone is shown
 * as written, trimmed and capped. Empty input returns null.
 */
export function specialPickupPointLabel(input) {
  const raw = zoneFrom(input)
  if (!raw) return null
  const known = matchGameDayPickupPoint(raw)
  if (known) return known.label
  return raw.slice(0, 80)
}

function readMultiplier(input) {
  if (input == null || input === '') return null
  if (typeof input === 'number' || typeof input === 'string') {
    const n = Number(input)
    return Number.isFinite(n) ? n : null
  }
  if (typeof input !== 'object') return null
  const raw = input.multiplier ?? input.surge_multiplier ?? input.surgeMultiplier ?? input.surge?.multiplier
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function readRuleLabel(input) {
  if (!input || typeof input !== 'object') return ''
  return cleanText(input.rule?.label || input.surge?.rule?.label || input.surge?.label || '')
}

/** True only when a finite multiplier is strictly above 1. Ignores cents. */
export function surgeBannerVisible(input) {
  const multiplier = readMultiplier(input)
  return multiplier != null && multiplier > 1
}

/** Same rounding as the home-map game-day notice. Not a fare. */
export function formatSurgeMultiplierLabel(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return null
  const rounded = Math.round(raw * 100) / 100
  return `${rounded}×`
}

/**
 * Game-day points first, then the caller's places, without a duplicate label.
 * Other purposes keep the caller's list.
 */
export function schedulePickupPresets(basePlaces, purpose) {
  const base = (Array.isArray(basePlaces) ? basePlaces : []).filter(
    (place) => place?.label && place.lat != null && place.lng != null,
  )
  if (purpose !== 'game_day') return base
  const special = GAME_DAY_PICKUP_POINTS.map((point) => ({
    label: point.label,
    lat: point.lat,
    lng: point.lng,
  }))
  const rest = base.filter((place) => !special.some((point) => point.label === place.label))
  return [...special, ...rest]
}

/**
 * Schedule-flow copy for one quote. `surge` is the quote's existing surge
 * object. `event` is the overlapping game_day_events row (zone and title).
 * No fare fields are read or returned.
 */
export function gameDayScheduleCopy({ event = null, surge = null, purpose = null } = {}) {
  const hasEvent = Boolean(event && (event.title || event.pickup_zone_label || event.zone))
  const specialPickupLabel = specialPickupPointLabel(event?.pickup_zone_label ?? event?.zone ?? null)
  const visible = surgeBannerVisible(surge)
  const multiplierLabel = visible ? formatSurgeMultiplierLabel(readMultiplier(surge)) : null
  const ruleLabel = readRuleLabel(surge) || (visible ? 'Surge' : null)
  const eventTitle = hasEvent ? (cleanText(event.title) || 'Game day') : null
  const headline = eventTitle
    ? [eventTitle, specialPickupLabel, multiplierLabel].filter(Boolean).join(' · ')
    : null
  const detail = hasEvent
    ? [
      specialPickupLabel ? `Pickup zone · ${specialPickupLabel}` : 'Pickup zone is on the map',
      multiplierLabel ? `Rider fare ${multiplierLabel}` : null,
    ].filter(Boolean).join(' · ')
    : null
  const surgeBannerText = visible ? `Surge · ${ruleLabel} ${multiplierLabel}` : null
  let body = null
  if (hasEvent) body = GAME_DAY_SCHEDULE_LIVE_COPY
  else if (purpose === 'game_day') body = GAME_DAY_SCHEDULE_OFF_COPY
  return {
    specialPickupLabel,
    surgeBannerVisible: visible,
    surgeBannerText,
    headline,
    detail,
    body,
    eventTitle,
    ruleLabel,
    multiplierLabel,
  }
}
