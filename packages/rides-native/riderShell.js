/** Pure rider-shell helpers. No React, no Supabase. */

export const PASSWORD_RESET_REDIRECT = 'clemsonrides://set-password'

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const FARE = { baseCents: 119, bookingFeeCents: 265, perMileCents: 114, perMinuteCents: 18, minFareCents: 590 }

export const AIRPORT_QUOTES = {
  GSP: { code: 'GSP', name: 'Greenville-Spartanburg (GSP)', miles: 48, minutes: 55 },
  CLT: { code: 'CLT', name: 'Charlotte Douglas (CLT)', miles: 130, minutes: 130 },
}

export const FAVORITE_SPOTS = [
  'White C',
  'Bigsby',
  'U on College',
  'Grand Mark',
  'The Pier',
  'The Reserve at Clemson',
  'Downtown / College Ave',
  'Tillman Hall',
  'Memorial Stadium',
  'Cooper Library',
  'Littlejohn',
  "Tiger Town Tavern (Triple T's)",
  'The Esso Club',
  'Study Hall',
]

export const RIDE_PLACES = [
  { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
  { label: 'White C', lat: 34.6842, lng: -82.8295 },
  { label: 'Bigsby', lat: 34.6812, lng: -82.828 },
  { label: 'Downtown Clemson', lat: 34.6836, lng: -82.8364 },
  { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 },
  { label: 'Sikes Hall', lat: 34.6795, lng: -82.8374 },
  { label: 'GSP Airport', lat: 34.8956, lng: -82.2189 },
  { label: 'CLT Airport', lat: 35.2144, lng: -80.9473 },
  { label: 'ATL Airport', lat: 33.6407, lng: -84.4277 },
]

export function parseRecoveryUrl(url) {
  if (!url || typeof url !== 'string') return null
  const hashIndex = url.indexOf('#')
  const queryIndex = url.indexOf('?')
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : ''
  const query = queryIndex >= 0
    ? url.slice(queryIndex + 1, hashIndex >= 0 && hashIndex > queryIndex ? hashIndex : undefined)
    : ''
  const hashParams = new URLSearchParams(hash)
  const queryParams = new URLSearchParams(query)
  const source = hashParams.get('access_token') || hashParams.get('code') ? hashParams : queryParams
  const accessToken = source.get('access_token')
  const refreshToken = source.get('refresh_token')
  const code = source.get('code')
  if (!accessToken && !code) return null
  return {
    accessToken,
    refreshToken,
    code,
    type: source.get('type'),
  }
}

export function meteredFareCents(miles, minutes) {
  const metered = FARE.baseCents
    + FARE.bookingFeeCents
    + Math.round(Number(miles) * FARE.perMileCents)
    + Math.round(Number(minutes) * FARE.perMinuteCents)
  return Math.max(FARE.minFareCents, metered)
}

export function airportFareCents(code) {
  const route = AIRPORT_QUOTES[code]
  if (!route) return null
  return meteredFareCents(route.miles, route.minutes)
}

export function depositCents(fareCents) {
  return Math.round(Number(fareCents) * 0.25)
}

export function applyStudentDiscount(fareCents, isStudent) {
  const raw = Math.max(0, Math.round(Number(fareCents) || 0))
  if (!isStudent) return { fareCents: raw, discountCents: 0, label: null }
  const discountCents = Math.round(raw * 0.1)
  return {
    fareCents: raw - discountCents,
    discountCents,
    label: 'Clemson student · 10% off Standard',
  }
}

export function haversineMeters(a, b) {
  if (a?.lat == null || b?.lat == null) return null
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Distance estimate when the drop-off is not a GSP/CLT fallback quote. */
export function distanceFareCents(meters) {
  const miles = (Number(meters) || 0) / 1609.344
  const minutes = Math.max(8, Math.round(miles * 2.2))
  return meteredFareCents(miles, minutes)
}

export function zonedParts(date, timeZone = 'America/New_York') {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    month: Number(parts.month),
  }
}

/** Game day matches the fall Saturday window. Weekend surge is Fri 17:00 through Sunday. */
export function campusOverlays(date = new Date()) {
  const { weekday, minutes, month } = zonedParts(date)
  const weekend = (weekday === 5 && minutes >= 17 * 60) || weekday === 6 || weekday === 0
  const gameDay = weekday === 6 && month >= 8 && month <= 11 && minutes >= 11 * 60 && minutes < 23 * 60
  let surgeLabel = null
  if (gameDay) surgeLabel = 'Game day surge'
  else if (weekend) surgeLabel = 'Weekend surge'
  return { gameDay, surge: weekend || gameDay, surgeLabel }
}

export function nextPickupDate({ date, time, weekdays, now = new Date() }) {
  const hhmm = /^\d{2}:\d{2}$/.test(String(time || '')) ? time : null
  if (!hhmm) return null
  if (date) {
    const picked = new Date(`${date}T${hhmm}:00`)
    return Number.isNaN(picked.getTime()) ? null : picked
  }
  if (!weekdays?.length) return null
  const [hh, mm] = hhmm.split(':').map(Number)
  for (let add = 0; add < 14; add += 1) {
    const candidate = new Date(now)
    candidate.setDate(candidate.getDate() + add)
    candidate.setHours(hh, mm, 0, 0)
    const key = WEEKDAY_KEYS[candidate.getDay()]
    if (!weekdays.includes(key)) continue
    if (candidate.getTime() >= now.getTime() + 30 * 60 * 1000) return candidate
  }
  return null
}

export function localDateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

export function localTimeInput(date) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Choose-driver Clemson loader. Inclusive 2s–4s. */
export function searchDelayMs(random = Math.random) {
  const n = Number(random())
  const unit = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  return 2000 + Math.round(unit * 2000)
}
