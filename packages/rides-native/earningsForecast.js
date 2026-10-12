/**
 * Smart earnings forecast — pure ranking logic shared by /api/driver?action=forecast
 * and its unit tests. No network, no clock: callers pass `now`.
 *
 * Output is an ESTIMATE. With few historical trips it leans on event and
 * time-of-week heuristics (lowData = true).
 */

export const FORECAST_TZ = 'America/New_York'
export const SLOT_HOURS = 2
export const LOW_DATA_TRIPS = 20
/** Pseudo-count: how many observed trips it takes to outweigh the heuristic. */
export const PRIOR_WEIGHT = 5
/** Minutes of unpaid time assumed around every trip (deadhead + waiting for a ping). */
export const IDLE_MINUTES_PER_TRIP = 15

export const FORECAST_ZONES = [
  { id: 'stadium', label: 'Memorial Stadium', lat: 34.6788, lng: -82.843, radiusKm: 0.55 },
  { id: 'downtown', label: 'Downtown / College Ave bars', lat: 34.6836, lng: -82.8364, radiusKm: 0.6 },
  { id: 'campus', label: 'Campus', lat: 34.6784, lng: -82.8397, radiusKm: 1.6 },
  { id: 'gsp', label: 'GSP Airport', lat: 34.8957, lng: -82.2189, radiusKm: 4 },
  { id: 'clt', label: 'CLT Airport', lat: 35.2144, lng: -80.9473, radiusKm: 5 },
  { id: 'atl', label: 'ATL Airport', lat: 33.6407, lng: -84.4277, radiusKm: 5 },
]
const ZONE_BY_ID = Object.fromEntries(FORECAST_ZONES.map((zone) => [zone.id, zone]))
const AIRPORTS = new Set(['gsp', 'clt', 'atl'])

export const FORECAST_DISCLAIMER =
  'Estimate only. Based on past trips, the event calendar, and typical airport peaks. Not a guarantee of rides or pay.'

function km(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function labelZone(label) {
  const text = String(label || '').toLowerCase()
  if (!text) return null
  if (/\bgsp\b|greenville[- ]spartanburg/.test(text)) return 'gsp'
  if (/\bclt\b|charlotte/.test(text)) return 'clt'
  if (/\batl\b|hartsfield|atlanta/.test(text)) return 'atl'
  if (/stadium|death valley|memorial/.test(text)) return 'stadium'
  if (/college ave|downtown|tigertown|bar\b/.test(text)) return 'downtown'
  return null
}

/** Zone id for a point and/or label, or null when it is outside every zone. */
export function classifyZone({ lat, lng, label } = {}) {
  const byLabel = labelZone(label)
  if (byLabel) return byLabel
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  for (const zone of FORECAST_ZONES) {
    if (km({ lat: la, lng: ln }, zone) <= zone.radiusKm) return zone.id
  }
  return null
}

/** Airport trips count for the airport; otherwise the pickup zone. */
export function tripZone(trip) {
  const pick = classifyZone({ lat: trip?.pickup_lat, lng: trip?.pickup_lng, label: trip?.pickup_label })
  const drop = classifyZone({ lat: trip?.dropoff_lat, lng: trip?.dropoff_lng, label: trip?.dropoff_label })
  if (AIRPORTS.has(drop)) return drop
  if (AIRPORTS.has(pick)) return pick
  return pick || null
}

const fmtCache = new Map()
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    }))
  }
  return fmtCache.get(tz)
}
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Local {dow, hour, date:'YYYY-MM-DD'} in Clemson time. */
export function localParts(when, tz = FORECAST_TZ) {
  const parts = Object.fromEntries(partsFormatter(tz).formatToParts(new Date(when)).map((p) => [p.type, p.value]))
  return { dow: DOW[parts.weekday], hour: Number(parts.hour) % 24, date: `${parts.year}-${parts.month}-${parts.day}` }
}

function dayGroup(dow) {
  if (dow === 5) return 'fri'
  if (dow === 6) return 'sat'
  if (dow === 0) return 'sun'
  return 'wk'
}
function bucketKey(zone, dow, hour) {
  return `${zone}|${dayGroup(dow)}|${Math.floor(hour / SLOT_HOURS)}`
}

/** Baseline cents/hour from time-of-week patterns alone. */
export function heuristicCentsPerHour(zone, dow, hour) {
  const late = hour >= 21 || hour < 2
  const weekendNight = (dow === 4 || dow === 5 || dow === 6) && late
  switch (zone) {
    case 'downtown':
      if (weekendNight) return 3200
      if (hour >= 17 && hour < 21) return 1700
      if (late) return 1500
      return 900
    case 'campus':
      if (dow >= 1 && dow <= 5 && hour >= 8 && hour < 18) return 1500
      if (hour >= 18 && hour < 23) return 1300
      return 800
    case 'stadium':
      return 700
    case 'gsp':
    case 'clt':
    case 'atl': {
      const reach = zone === 'gsp' ? 1 : zone === 'clt' ? 0.95 : 0.9
      let rate = 2200
      if (dow === 5 && hour >= 10 && hour < 20) rate = 3400 // students heading home
      else if (dow === 0 && hour >= 12 && hour < 24) rate = 3400 // returns
      else if (hour >= 4 && hour < 8) rate = 3000 // early flights
      else if (hour < 4) rate = 1100
      return Math.round(rate * reach)
    }
    default:
      return 0
  }
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/**
 * Event effect for one zone/slot. Returns { multiplier, bonusCents, reasons[] }.
 * Football home games: stadium + downtown spike around kickoff; airports busier the
 * day before and after. Kickoff TBA → assume an 11:00–23:00 window at reduced strength.
 */
export function eventEffect(zone, slotStart, events = []) {
  const { date, hour } = localParts(slotStart)
  let multiplier = 1
  let bonusCents = 0
  const reasons = []
  for (const event of events) {
    if (!event || event.active === false) continue
    const weight = Math.max(0.2, Math.min(5, Number(event.demand_weight) || 1))
    const eventDate = String(event.event_date || '').slice(0, 10)
    const football = event.kind === 'football_home'
    if (eventDate === date) {
      let inWindow
      let strength = 1
      if (event.starts_at) {
        const kick = localParts(event.starts_at).hour
        inWindow = hour >= kick - 4 && hour <= kick + 5
      } else {
        inWindow = hour >= 11 && hour < 23
        strength = 0.6
      }
      if (football && zone === 'stadium' && inWindow) {
        bonusCents += Math.round(2000 * weight * strength)
        reasons.push(`${event.title}${event.starts_at ? '' : ' (kickoff TBA)'}`)
      } else if (football && zone === 'downtown' && (inWindow || hour >= 20)) {
        multiplier *= 1 + 0.15 * weight * strength
        reasons.push(`${event.title}: downtown crowds`)
      } else if (!football && event.zone === zone && inWindow) {
        bonusCents += Math.round(800 * weight * strength)
        reasons.push(event.title)
      }
    }
    if (football && zone === 'downtown' && addDays(eventDate, 1) === date && hour < 2) {
      multiplier *= 1 + 0.15 * weight
      reasons.push(`${event.title}: post-game nightlife`)
    }
    if (football && AIRPORTS.has(zone) && (addDays(eventDate, -1) === date || addDays(eventDate, 1) === date)) {
      multiplier *= 1 + 0.12 * weight
      reasons.push(`Fans flying ${addDays(eventDate, -1) === date ? 'in for' : 'home after'} ${event.title}`)
    }
  }
  return { multiplier, bonusCents, reasons }
}

function tripHours(trip) {
  const routed = Number(trip?.route_duration_s ?? trip?.metadata?.route_duration_s)
  let minutes = Number.isFinite(routed) && routed > 0 ? routed / 60 : NaN
  if (!Number.isFinite(minutes) && trip?.accepted_at && trip?.completed_at) {
    minutes = (Date.parse(trip.completed_at) - Date.parse(trip.accepted_at)) / 60000
  }
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = 20
  minutes = Math.min(minutes, 6 * 60)
  return (minutes + IDLE_MINUTES_PER_TRIP) / 60
}

function tripCents(trip) {
  const earned = Number(trip?.driver_earnings_cents)
  if (Number.isFinite(earned) && earned > 0) return earned + (Number(trip?.tip_cents) || 0)
  const fare = Number(trip?.fare_cents)
  if (Number.isFinite(fare) && fare > 0) return Math.round(fare * 0.75) + (Number(trip?.tip_cents) || 0)
  return 0
}

/** Aggregate completed trips into { key → { n, centsPerHourSum } }. */
export function historyBuckets(trips = []) {
  const buckets = new Map()
  let used = 0
  for (const trip of trips) {
    const when = trip?.completed_at || trip?.pickup_at || trip?.requested_at
    if (!when) continue
    const zone = tripZone(trip)
    const cents = tripCents(trip)
    if (!zone || !cents) continue
    const { dow, hour } = localParts(when)
    const key = bucketKey(zone, dow, hour)
    const row = buckets.get(key) || { n: 0, sum: 0 }
    row.n += 1
    row.sum += cents / tripHours(trip)
    buckets.set(key, row)
    used += 1
  }
  return { buckets, used }
}

function confidenceFor(n, lowData) {
  if (lowData || n < 2) return 'low'
  if (n < 8) return 'medium'
  return 'high'
}

/**
 * Rank every zone × 2-hour slot in the next `days` days by expected $/hr.
 * @returns {{ generatedAt, lowData, tripsUsed, disclaimer, slots, top, bestByDay }}
 */
export function buildForecast({ trips = [], events = [], now = Date.now(), days = 7, limit = 12 } = {}) {
  const { buckets, used } = historyBuckets(trips)
  const lowData = used < LOW_DATA_TRIPS
  const start = Math.ceil(Number(now) / 3_600_000) * 3_600_000
  const end = start + days * 24 * 3_600_000
  const slots = []
  for (let t = start; t < end; t += 3_600_000) {
    const { hour } = localParts(t)
    if (hour % SLOT_HOURS !== 0) continue
    for (const zone of FORECAST_ZONES) {
      const { dow } = localParts(t)
      const base = heuristicCentsPerHour(zone.id, dow, hour)
      const hist = buckets.get(bucketKey(zone.id, dow, hour))
      const n = hist?.n || 0
      const observed = n ? hist.sum / n : 0
      const blended = n ? (n * observed + PRIOR_WEIGHT * base) / (n + PRIOR_WEIGHT) : base
      const effect = eventEffect(zone.id, t, events)
      const expected = Math.round(blended * effect.multiplier + effect.bonusCents)
      const reasons = [...effect.reasons]
      if (n) reasons.push(`${n} past trip${n === 1 ? '' : 's'} in this window`)
      else reasons.push('Typical demand for this time')
      slots.push({
        zone: zone.id,
        zoneLabel: zone.label,
        startsAt: new Date(t).toISOString(),
        endsAt: new Date(t + SLOT_HOURS * 3_600_000).toISOString(),
        localDate: localParts(t).date,
        localHour: hour,
        expectedCentsPerHour: expected,
        samples: n,
        confidence: confidenceFor(n, lowData),
        reasons,
      })
    }
  }
  slots.sort((a, b) => b.expectedCentsPerHour - a.expectedCentsPerHour || a.startsAt.localeCompare(b.startsAt) || a.zone.localeCompare(b.zone))
  const bestByDay = []
  const seen = new Set()
  for (const slot of slots) {
    if (seen.has(slot.localDate)) continue
    seen.add(slot.localDate)
    bestByDay.push(slot)
  }
  bestByDay.sort((a, b) => a.localDate.localeCompare(b.localDate))
  return {
    generatedAt: new Date(Number(now)).toISOString(),
    lowData,
    tripsUsed: used,
    disclaimer: lowData
      ? `${FORECAST_DISCLAIMER} Few past trips so far, so this leans on event and time-of-week patterns.`
      : FORECAST_DISCLAIMER,
    top: slots.slice(0, limit),
    bestByDay,
    slotCount: slots.length,
  }
}

export function formatSlotWindow(slot, tz = FORECAST_TZ) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric' })
  const end = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' })
  return `${fmt.format(new Date(slot.startsAt))}–${end.format(new Date(slot.endsAt))}`
}

export function zoneLabel(id) {
  return ZONE_BY_ID[id]?.label || id
}
