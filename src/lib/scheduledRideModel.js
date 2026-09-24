/** Pure helpers for scheduled rides. No Supabase imports. */

export const MIN_LEAD_MS = 30 * 60 * 1000
export const ACTIONABLE_LEAD_MS = 45 * 60 * 1000
export const APPROX_PIN_DECIMALS = 3

export const SCHEDULE_PURPOSES = [
  { id: 'party_weekend', label: 'Weekend / party' },
  { id: 'airport', label: 'Airport' },
  { id: 'early_class', label: 'Early class' },
  { id: 'planned', label: 'Planned trip' },
]

/** Tightest window first. A due reminder is the smallest window that contains time-until-pickup. */
export const REMINDER_WINDOWS = [
  { id: 'm15', ms: 15 * 60 * 1000, label: 'Pickup in about 15 minutes' },
  { id: 'h1', ms: 60 * 60 * 1000, label: 'Pickup in about an hour' },
  { id: 'h24', ms: 24 * 60 * 60 * 1000, label: 'Pickup is tomorrow' },
]

const NOW_GRACE_MS = 20 * 60 * 1000
const BASE_CENTS = 500
const PER_MILE_CENTS = 180
const MIN_CENTS = 800
export const ATL_FLOOR_CENTS = 19500
const METERS_PER_MILE = 1609.344

export const AIRPORT_PLACES = [
  { code: 'GSP', label: 'Greenville-Spartanburg International (GSP)', lat: 34.8956, lng: -82.2189 },
  { code: 'CLT', label: 'Charlotte Douglas International (CLT)', lat: 35.2144, lng: -80.9473 },
  { code: 'ATL', label: 'Hartsfield-Jackson Atlanta (ATL)', lat: 33.6407, lng: -84.4277 },
]

export function firstName(fullName, fallback = 'Rider') {
  const raw = String(fullName || '').trim()
  if (!raw) return fallback
  const token = raw.split(/\s+/)[0] || ''
  const cleaned = token.includes('@') ? token.split('@')[0] : token
  const name = cleaned.replace(/[^a-zA-Z'-]/g, '')
  if (!name) return fallback
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Approximate pin (~110m). Callers may show this only after a trip is completed.
 * Returns null when coordinates are missing.
 */
export function approxPin(lat, lng) {
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  const factor = 10 ** APPROX_PIN_DECIMALS
  return {
    lat: Math.round(la * factor) / factor,
    lng: Math.round(ln * factor) / factor,
  }
}

export function formatApproxPin(lat, lng) {
  const pin = approxPin(lat, lng)
  if (!pin) return null
  return `~${pin.lat.toFixed(APPROX_PIN_DECIMALS)}, ${pin.lng.toFixed(APPROX_PIN_DECIMALS)}`
}

/** Exact coordinates stay off the schedule UI until the trip is completed, and then only as an approx pin. */
export function pinForDisplay(trip) {
  if (!trip || trip.status !== 'completed') return null
  return formatApproxPin(trip.pickup_lat, trip.pickup_lng)
}

export function airportCodeForPlace(place) {
  const label = `${place?.label || ''} ${place?.code || ''}`.toUpperCase()
  if (!label.trim()) return null
  if (label.includes('ATL') || label.includes('HARTSFIELD')) return 'ATL'
  if (label.includes('CLT') || label.includes('CHARLOTTE')) return 'CLT'
  if (label.includes('GSP') || label.includes('GREENVILLE')) return 'GSP'
  return null
}

export function tripMeters(pickup, dropoff) {
  const lat1 = Number(pickup?.lat)
  const lng1 = Number(pickup?.lng)
  const lat2 = Number(dropoff?.lat)
  const lng2 = Number(dropoff?.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Distance estimate used when the drop-off is not a published GSP/CLT flat rate. */
export function distanceFareCents(meters, airportCode) {
  const miles = (Number(meters) || 0) / METERS_PER_MILE
  let fare = BASE_CENTS + Math.round(miles * PER_MILE_CENTS)
  if (fare < MIN_CENTS) fare = MIN_CENTS
  if (airportCode === 'ATL' && fare < ATL_FLOOR_CENTS) fare = ATL_FLOOR_CENTS
  return fare
}

export function pickupAtFromLocal(date, time) {
  if (!date || !time) return null
  const d = new Date(`${date}T${time}:00`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function validateSchedule({ date, time, pickup, dropoff, now = new Date() }) {
  const errors = []
  if (!pickup?.label || pickup.lat == null || pickup.lng == null) errors.push('Choose a pickup.')
  if (!dropoff?.label || dropoff.lat == null || dropoff.lng == null) errors.push('Choose a drop-off.')
  if (pickup?.label && dropoff?.label && pickup.label === dropoff.label) {
    errors.push('Pickup and drop-off need to be different places.')
  }
  const pickupAt = pickupAtFromLocal(date, time)
  if (!pickupAt) errors.push('Choose a date and time.')
  else if (pickupAt.getTime() < now.getTime() + MIN_LEAD_MS) {
    errors.push('Schedule at least 30 minutes ahead.')
  }
  return { ok: errors.length === 0, errors, pickupAt }
}

export function formatPickupAt(iso) {
  if (!iso) return 'Time TBD'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Time TBD'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export function purposeLabel(id) {
  return SCHEDULE_PURPOSES.find((p) => p.id === id)?.label || ''
}

/**
 * Future scheduled rides stay off the live "head to pickup" sheet until 45 minutes out.
 * Immediate trips (no pickup time) stay actionable.
 */
export function isDueNow(trip, now = new Date()) {
  if (!trip) return false
  const when = trip.pickup_at || trip.scheduled_for
  if (!when) return true
  const t = new Date(when).getTime()
  if (!Number.isFinite(t)) return true
  return t - now.getTime() <= ACTIONABLE_LEAD_MS
}

export function nextReminder(trip, now = new Date(), already = {}) {
  const when = trip?.pickup_at || trip?.scheduled_for
  if (!when) return null
  if (trip?.status && !['scheduled', 'accepted', 'arriving'].includes(trip.status)) return null
  const pickup = new Date(when).getTime()
  if (!Number.isFinite(pickup)) return null
  const until = pickup - now.getTime()
  if (until > REMINDER_WINDOWS[REMINDER_WINDOWS.length - 1].ms) return null
  if (until <= 0) {
    if (until < -NOW_GRACE_MS) return null
    if (already.now) return null
    return { id: 'now', label: 'Pickup time is now' }
  }
  const tightest = REMINDER_WINDOWS.find((w) => until <= w.ms)
  if (!tightest || already[tightest.id]) return null
  return tightest
}

/**
 * In-app cards for scheduled rides inside a REMINDER_WINDOWS window.
 * Stamps in metadata.reminders are ignored so the card stays up for the whole window.
 * Soonest pickup first. Trips outside the windows, or not scheduled/accepted/arriving, are omitted.
 * @param {Array<{ id?: string, status?: string, pickup_at?: string, scheduled_for?: string, pickup_label?: string, dropoff_label?: string, pickupLabel?: string, dropoffLabel?: string }> | null | undefined} trips
 * @param {Date} [now]
 * @returns {Array<{ tripId: string, windowId: string, label: string, pickupLabel: string, dropoffLabel: string, pickupAt: string | null, whenLabel: string, body: string }>}
 */
export function dueScheduleReminders(trips, now = new Date()) {
  if (!Array.isArray(trips)) return []
  const cards = []
  for (const trip of trips) {
    if (!trip?.id) continue
    const reminder = nextReminder(trip, now)
    if (!reminder) continue
    const pickupAt = trip.pickup_at || trip.scheduled_for || null
    const pickupLabel = trip.pickup_label || trip.pickupLabel || 'Pickup'
    const dropoffLabel = trip.dropoff_label || trip.dropoffLabel || 'Drop-off'
    const whenLabel = formatPickupAt(pickupAt)
    cards.push({
      tripId: String(trip.id),
      windowId: reminder.id,
      label: reminder.label,
      pickupLabel,
      dropoffLabel,
      pickupAt,
      whenLabel,
      body: `${pickupLabel} → ${dropoffLabel} · ${whenLabel}`,
    })
  }
  cards.sort((a, b) => {
    const ta = a.pickupAt ? new Date(a.pickupAt).getTime() : Number.POSITIVE_INFINITY
    const tb = b.pickupAt ? new Date(b.pickupAt).getTime() : Number.POSITIVE_INFINITY
    if (ta !== tb) return ta - tb
    if (a.tripId < b.tripId) return -1
    if (a.tripId > b.tripId) return 1
    return 0
  })
  return cards
}

const OPEN_QUEUE_FIELDS = [
  'id',
  'status',
  'pickup_label',
  'dropoff_label',
  'fare_cents',
  'pickup_at',
  'scheduled_for',
  'rider_note',
  'passengers',
  'metadata',
]

/** Driver queue card: first name only, no coordinates. */
export function toDriverQueueCard(row) {
  if (!row) return null
  const purpose = row.metadata?.purpose || ''
  return {
    id: row.id,
    status: row.status,
    pickupLabel: row.pickup_label,
    dropoffLabel: row.dropoff_label,
    pickupAt: row.pickup_at || row.scheduled_for,
    fareCents: row.fare_cents,
    firstName: firstName(row.metadata?.rider_first_name, 'Rider'),
    purpose: purposeLabel(purpose) || row.rider_note || '',
    passengers: row.passengers || 1,
  }
}

export function toRiderScheduleCard(row) {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    pickupLabel: row.pickup_label,
    dropoffLabel: row.dropoff_label,
    pickupAt: row.pickup_at || row.scheduled_for,
    fareCents: row.fare_cents,
    depositCents: Math.max(0, Math.round(Number(row.deposit_cents) || 0)),
    purpose: purposeLabel(row.metadata?.purpose) || row.rider_note || '',
    estimate: Boolean(row.metadata?.fare_is_estimate),
    approxPin: pinForDisplay(row),
    canCancel: row.status === 'scheduled' || row.status === 'accepted',
  }
}

export const DRIVER_QUEUE_SELECT = OPEN_QUEUE_FIELDS.join(', ')
