export const RIDE_AVAILABILITY_PATH = '/api/driver?action=ride-availability'
export const AVAILABILITY_POLL_MS = 10000
export const APP_RIDE_TIERS = Object.freeze(['standard', 'wait', 'comfort'])

const MONEY_KEYS = ['fare', 'fareCents', 'deposit', 'depositCents', 'amount', 'total', 'isStudent', 'discount', 'discountCents']

export function isAppRideTier(value) {
  return value === 'standard' || value === 'wait' || value === 'comfort'
}

export function availabilityRequestBody({
  scheduledFor = null,
  pickup = null,
  dropoff = null,
} = {}) {
  const body = {}
  if (scheduledFor) body.scheduled_for = scheduledFor
  if (pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng)) {
    body.pickup = { label: pickup.label, lat: pickup.lat, lng: pickup.lng }
  }
  if (dropoff && Number.isFinite(dropoff.lat) && Number.isFinite(dropoff.lng)) {
    body.dropoff = { label: dropoff.label, lat: dropoff.lat, lng: dropoff.lng }
  }
  for (const key of MONEY_KEYS) delete body[key]
  return body
}

function integerCents(value) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** Keep only Standard, Wait & Save, and Extra Comfort. A strikethrough needs both server cents. */
export function parseRideAvailability(payload) {
  const raw = payload && typeof payload === 'object' ? payload : {}
  const tiers = []
  if (Array.isArray(raw.tiers)) {
    for (const id of raw.tiers) {
      if (isAppRideTier(id) && !tiers.includes(id)) tiers.push(id)
    }
  }
  const quotes = {}
  const rawQuotes = raw.quotes && typeof raw.quotes === 'object' ? raw.quotes : {}
  for (const id of APP_RIDE_TIERS) {
    const row = rawQuotes[id]
    if (!row || typeof row !== 'object') continue
    const listCents = integerCents(row.listCents)
    const fareCents = integerCents(row.fareCents)
    if (listCents == null || fareCents == null) continue
    if (listCents > fareCents) quotes[id] = { listCents, fareCents }
  }
  return { tiers, quotes }
}
