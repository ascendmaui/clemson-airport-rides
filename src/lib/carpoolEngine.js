/**
 * Clemson carpool flagship — matching + fare split.
 *
 * Pure module: no Supabase, Stripe, or browser globals except Intl.
 * Imported by the Vite client, Vercel API routes, and node:test.
 *
 * Integration (do not fork these):
 * - friend_rides kind=carpool + lobby token links (existing FriendRide)
 * - Metered base fare matches server/friendRideLib.computeFriendFareCents
 * - Surge windows are carpool-local. Airport/tier surge stays in pricing.js
 *   (rates agent). This file does not replace getGameDayMultiplier.
 * - Driver bonus id `driver_carpool_bonus` is the incentives-agent name.
 * - Ambassador code_type is `ambassador`, not rider promo codes.
 */

export const MAX_RIDERS = 4
export const PLATFORM_FEE_RATE = 0.2
export const MATCH_SCORE_MIN = 0.62
export const DEST_CLUSTER_M = 1200
export const DEST_SAME_HASH_M = 1800
export const PICKUP_MAX_M = 1600
export const SAME_PICKUP_M = 900
export const ROUTE_MATCH_M = 400
export const NEIGHBORHOOD_MATCH_M = 700

/** Fraction of that rider's own solo surge price. Not solo/n. */
export const SHARE_OF_SOLO = {
  1: 1,
  2: 0.55,
  3: 0.42,
  4: 0.35,
  5: 0.3,
  6: 0.28,
}

/** Incentives agent id. Paid inside the driver's 80%, not added on top. */
export const DRIVER_CARPOOL_BONUS_ID = 'driver_carpool_bonus'
export const BONUS_CENTS_PER_EXTRA_RIDER = 200
export const BONUS_CENTS_PER_MILE = 40

export const AMBASSADOR_CODE_TYPE = 'ambassador'
export const AMBASSADOR_CENTS_PER_SEAT = 150

export const FIRST_RIDE_CODE_TYPE = 'first_ride'

/** Configurable football window. Off-peak hours inside it are not free. */
export const GAME_WEEKS = [
  { start: '2026-09-01', end: '2026-11-30', label: 'Fall 2026 football' },
]

export const TIME_WINDOW_MIN = {
  game_day: 25,
  peak_night: 20,
  class_change: 15,
  off_peak: 20,
}

const PRIORITY_RANK = {
  game_day: 0,
  peak_night: 1,
  class_change: 2,
  off_peak: 3,
}

const FARE_BASE_CENTS = 250
const FARE_PER_MILE_CENTS = 175
const FARE_PER_MIN_CENTS = 35
const FARE_MIN_CENTS = 800

/**
 * Campus neighborhoods. Aliases cover CAMPUS_SPOTS naming
 * ("Grand Mark" in profiles, "Grand Marc" in conversation).
 */
export const NEIGHBORHOODS = [
  { id: 'grand-marc', label: 'Grand Marc', lat: 34.685, lng: -82.8165, aliases: ['grand marc', 'grand mark', 'grandmarc'] },
  { id: 'college-ave', label: 'College Avenue', lat: 34.6839, lng: -82.8366, aliases: ['college ave', 'college avenue', 'downtown', 'downtown / college'] },
  { id: 'memorial-stadium', label: 'Memorial Stadium', lat: 34.6788, lng: -82.843, aliases: ['memorial stadium', 'death valley', 'stadium'] },
  { id: 'tillman', label: 'Tillman Hall', lat: 34.6784, lng: -82.8397, aliases: ['tillman', 'core campus'] },
  { id: 'cooper', label: 'Cooper Library', lat: 34.6765, lng: -82.8375, aliases: ['cooper'] },
  { id: 'schilletter', label: 'Schilletter', lat: 34.6799, lng: -82.8345, aliases: ['schilletter'] },
  { id: 'bowman', label: 'Bowman Field', lat: 34.678, lng: -82.837, aliases: ['bowman'] },
  { id: 'littlejohn', label: 'Littlejohn', lat: 34.6805, lng: -82.846, aliases: ['littlejohn'] },
  { id: 'u-on-college', label: 'U on College', lat: 34.6826, lng: -82.8342, aliases: ['u on college'] },
  { id: 'white-c', label: 'White C', lat: 34.6842, lng: -82.8295, aliases: ['white c'] },
  { id: 'bigsby', label: 'Bigsby', lat: 34.6812, lng: -82.828, aliases: ['bigsby'] },
  { id: 'the-pier', label: 'The Pier', lat: 34.6895, lng: -82.819, aliases: ['the pier', 'pier'] },
  { id: 'the-reserve', label: 'The Reserve', lat: 34.6555, lng: -82.8155, aliases: ['the reserve', 'reserve at clemson'] },
  { id: 'highpointe', label: 'Highpointe', lat: 34.6702, lng: -82.809, aliases: ['highpointe', 'high pointe'] },
  { id: 'campus-view', label: 'Campus View', lat: 34.6682, lng: -82.832, aliases: ['campus view'] },
  { id: 'clemson-lofts', label: 'Clemson Lofts', lat: 34.6848, lng: -82.8382, aliases: ['clemson lofts', 'lofts'] },
  { id: 'earle-114', label: '114 Earle', lat: 34.6832, lng: -82.8398, aliases: ['114 earle', 'earle'] },
  { id: 'enclave', label: 'The Enclave', lat: 34.692, lng: -82.805, aliases: ['enclave'] },
  { id: 'hartwell', label: 'Hartwell Landing', lat: 34.6775, lng: -82.814, aliases: ['hartwell'] },
  { id: 'patrick-square', label: 'Patrick Square', lat: 34.71, lng: -82.79, aliases: ['patrick square'] },
  { id: 'tiger-town', label: 'Tiger Town Tavern', lat: 34.6844, lng: -82.8362, aliases: ['tiger town', "triple t", 'td\'s', 'tds'] },
  { id: 'esso', label: 'The Esso Club', lat: 34.6856, lng: -82.8376, aliases: ['esso'] },
  { id: 'backstreets', label: 'Backstreets', lat: 34.6842, lng: -82.8354, aliases: ['backstreets'] },
  { id: 'nicks', label: "Nick's Tavern", lat: 34.6838, lng: -82.8369, aliases: ["nick"] },
  { id: 'study-hall', label: 'Study Hall', lat: 34.6835, lng: -82.8368, aliases: ['study hall'] },
  { id: 'loose-change', label: 'Loose Change', lat: 34.6846, lng: -82.8364, aliases: ['loose change'] },
  { id: 'bar-356', label: '356', lat: 34.6841, lng: -82.8358, aliases: ['356'] },
]

const GEOHASH_BASE = '0123456789bcdefghjkmnpqrstuvwxyz'

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function encodeGeohash(lat, lng, precision = 6) {
  let idx = 0
  let bit = 0
  let even = true
  let hash = ''
  let latMin = -90
  let latMax = 90
  let lngMin = -180
  let lngMax = 180
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return ''
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2
      if (longitude >= mid) {
        idx = idx * 2 + 1
        lngMin = mid
      } else {
        idx *= 2
        lngMax = mid
      }
    } else {
      const mid = (latMin + latMax) / 2
      if (latitude >= mid) {
        idx = idx * 2 + 1
        latMin = mid
      } else {
        idx *= 2
        latMax = mid
      }
    }
    even = !even
    bit += 1
    if (bit === 5) {
      hash += GEOHASH_BASE[idx]
      bit = 0
      idx = 0
    }
  }
  return hash
}

export function zonedParts(date, timeZone = 'America/New_York') {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  return {
    weekday: weekdayMap[parts.weekday],
    hour,
    minute: Number(parts.minute),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

function assertWindow(window) {
  switch (window) {
    case 'game_day':
    case 'peak_night':
    case 'class_change':
    case 'off_peak':
      return window
    default: {
      const neverWindow = window
      throw new Error(`Unknown demand window: ${String(neverWindow)}`)
    }
  }
}

/**
 * Peak / game-day classifier in America/New_York.
 * gameDay=true (row in game_day_events) outranks the clock.
 */
export function demandWindow(at = new Date(), { gameDay = false } = {}) {
  if (gameDay) return 'game_day'
  const z = zonedParts(at instanceof Date ? at : new Date(at))
  const mins = z.hour * 60 + z.minute
  if (z.weekday === 6 && mins >= 10 * 60 && mins < 20 * 60) return 'game_day'
  const lateNight = z.hour >= 21 || z.hour < 2
  if (lateNight && (z.weekday === 4 || z.weekday === 5 || z.weekday === 6 || z.weekday === 0)) {
    return 'peak_night'
  }
  if (z.weekday >= 1 && z.weekday <= 5) {
    const morning = mins >= 7 * 60 + 40 && mins <= 9 * 60 + 20
    const afternoon = mins >= 15 * 60 + 40 && mins <= 17 * 60 + 20
    if (morning || afternoon) return 'class_change'
  }
  return 'off_peak'
}

export function surgeMultiplier(window) {
  const w = assertWindow(window)
  switch (w) {
    case 'game_day':
      return 2.8
    case 'peak_night':
      return 2.6
    case 'class_change':
      return 1.35
    case 'off_peak':
      return 1
    default: {
      const neverWindow = w
      throw new Error(`Unknown demand window: ${String(neverWindow)}`)
    }
  }
}

export function priorityRank(window) {
  const w = assertWindow(window)
  switch (w) {
    case 'game_day':
      return PRIORITY_RANK.game_day
    case 'peak_night':
      return PRIORITY_RANK.peak_night
    case 'class_change':
      return PRIORITY_RANK.class_change
    case 'off_peak':
      return PRIORITY_RANK.off_peak
    default: {
      const neverWindow = w
      throw new Error(`Unknown demand window: ${String(neverWindow)}`)
    }
  }
}

/** Same constants as computeFriendFareCents (no surge). */
export function mvpRouteFareCents(distanceM, durationS) {
  const miles = Math.max(0, Number(distanceM) || 0) / 1609.344
  const mins = Math.max(0, Number(durationS) || 0) / 60
  const base = Math.round(FARE_BASE_CENTS + miles * FARE_PER_MILE_CENTS + mins * FARE_PER_MIN_CENTS)
  return Math.max(FARE_MIN_CENTS, base)
}

export function estimateDurationSeconds(distanceM) {
  const meters = Math.max(0, Number(distanceM) || 0)
  const seconds = meters / 8.9
  return Math.round(Math.max(5 * 60, Math.min(15 * 60, seconds)))
}

/**
 * Short campus hops during game day / Thu–Sat night are priced in the
 * $30–$40 solo band the product promises. Longer trips keep the meter × surge.
 */
export function soloSurgeCents({ distanceM, durationS, window }) {
  const w = assertWindow(window)
  const metered = Math.round(mvpRouteFareCents(distanceM, durationS) * surgeMultiplier(w))
  const miles = Math.max(0, Number(distanceM) || 0) / 1609.344
  const minutes = Math.max(0, Number(durationS) || 0) / 60
  if ((w === 'game_day' || w === 'peak_night') && minutes <= 15 && miles <= 5) {
    const anchored = 3000 + Math.round((Math.min(5, Math.max(1, miles)) - 1) / 4 * 1000)
    return Math.max(metered, Math.min(4000, Math.max(3000, anchored)))
  }
  return metered
}

export function resolveNeighborhood(point) {
  if (!point) return null
  const label = String(point.label || point.name || '').toLowerCase()
  if (label) {
    for (const n of NEIGHBORHOODS) {
      if (n.aliases.some((alias) => label.includes(alias))) return n
    }
  }
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  let best = null
  let bestD = Infinity
  for (const n of NEIGHBORHOODS) {
    const d = haversineMeters(lat, lng, n.lat, n.lng)
    if (d < bestD) {
      best = n
      bestD = d
    }
  }
  if (best && bestD <= NEIGHBORHOOD_MATCH_M) return best
  return null
}

export function firstName(name) {
  const token = String(name || '').trim().split(/\s+/)[0]
  return token || 'Tiger'
}

/** ~111m. Used on booked/completed public pins. */
export function approxCoord(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1000) / 1000
}

export function presentStop(stop, { approximate = false } = {}) {
  if (!stop) return stop
  if (!approximate) return stop
  return {
    ...stop,
    lat: approxCoord(stop.lat),
    lng: approxCoord(stop.lng),
    approximate: true,
  }
}

function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return null
  let index = 0
  const len = encoded.length
  let lat = 0
  let lng = 0
  const path = []
  while (index < len) {
    let b
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat
    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng
    path.push([lat / 1e5, lng / 1e5])
  }
  return path
}

function lineSamples(rider) {
  if (Array.isArray(rider.route) && rider.route.length >= 2) return rider.route
  if (typeof rider.polyline === 'string') {
    const decoded = decodePolyline(rider.polyline)
    if (decoded && decoded.length >= 2) return decoded
  }
  const pts = []
  const steps = 16
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    pts.push([
      rider.pickup.lat + (rider.dropoff.lat - rider.pickup.lat) * t,
      rider.pickup.lng + (rider.dropoff.lng - rider.pickup.lng) * t,
    ])
  }
  return pts
}

function distToSegmentMeters(lat, lng, aLat, aLng, bLat, bLng) {
  const midLat = ((aLat + bLat + lat) / 3) * (Math.PI / 180)
  const kx = Math.cos(midLat) * 111320
  const ky = 110540
  const ax = aLng * kx
  const ay = aLat * ky
  const bx = bLng * kx
  const by = bLat * ky
  const px = lng * kx
  const py = lat * ky
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function minDistanceToLine(lat, lng, line) {
  let min = Infinity
  for (let i = 1; i < line.length; i += 1) {
    const d = distToSegmentMeters(lat, lng, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1])
    if (d < min) min = d
  }
  return min
}

export function routeOverlapFraction(a, b) {
  const lineA = lineSamples(a)
  const lineB = lineSamples(b)
  if (lineA.length < 2 || lineB.length < 2) return 0
  let near = 0
  for (const [lat, lng] of lineB) {
    if (minDistanceToLine(lat, lng, lineA) <= ROUTE_MATCH_M) near += 1
  }
  return near / lineB.length
}

export function overlapScore(a, b) {
  const destM = haversineMeters(a.dropoff.lat, a.dropoff.lng, b.dropoff.lat, b.dropoff.lng)
  const pickupM = haversineMeters(a.pickup.lat, a.pickup.lng, b.pickup.lat, b.pickup.lng)
  const dtMin = Math.abs(a.departAt - b.departAt) / 60000
  const allowMin = Math.max(TIME_WINDOW_MIN[a.window], TIME_WINDOW_MIN[b.window])
  const sameNeigh = Boolean(a.neighborhoodId && a.neighborhoodId === b.neighborhoodId)
  const sameHash = Boolean(a.destGeohash && a.destGeohash === b.destGeohash)
  const route = routeOverlapFraction(a, b)
  const base = { destM, pickupM, dtMin, route, sameNeigh, sameHash }

  if (dtMin > allowMin) return { ok: false, total: 0, reason: 'time_window', ...base }
  const destClose = sameNeigh || destM <= DEST_CLUSTER_M || (sameHash && destM <= DEST_SAME_HASH_M)
  if (!destClose) return { ok: false, total: 0, reason: 'destination', ...base }
  const pickupOk = pickupM <= PICKUP_MAX_M || route >= 0.45
  if (!pickupOk) return { ok: false, total: 0, reason: 'pickup', ...base }

  const destScore = sameNeigh ? 1 : Math.max(0, 1 - destM / DEST_CLUSTER_M)
  const pickupScore = Math.max(0, 1 - pickupM / PICKUP_MAX_M)
  const timeScore = Math.max(0, 1 - dtMin / allowMin)
  const raw = 0.45 * destScore + 0.25 * pickupScore + 0.15 * timeScore + 0.15 * route
  const total = sameNeigh && pickupM <= SAME_PICKUP_M ? Math.max(raw, 0.7) : raw
  const ok = total >= MATCH_SCORE_MIN
  return {
    ok,
    total,
    reason: ok ? 'match' : 'score',
    ...base,
    parts: { destScore, pickupScore, timeScore, route },
  }
}

function asPoint(value) {
  if (!value) return null
  const lat = Number(value.lat ?? value.latitude)
  const lng = Number(value.lng ?? value.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { ...value, lat, lng, label: value.label || value.name || '' }
}

export function normalizeRequest(raw, { at = new Date(), gameDay = false } = {}) {
  const pickup = asPoint(raw?.pickup)
  const dropoff = asPoint(raw?.dropoff)
  if (!pickup) return { error: 'pickup_coords' }
  if (!dropoff) return { error: 'dropoff_coords' }
  const departAt = new Date(raw.departAt || raw.depart_at || at).getTime()
  if (!Number.isFinite(departAt)) return { error: 'depart_at' }
  const neighborhood = resolveNeighborhood(dropoff)
  const window = demandWindow(new Date(departAt), { gameDay: Boolean(gameDay || raw.gameDay) })
  return {
    id: String(raw.id || raw.userId || raw.user_id || `anon-${departAt}-${pickup.lat}`),
    userId: raw.userId || raw.user_id || null,
    displayName: raw.displayName || raw.display_name || 'Tiger',
    pickup,
    dropoff,
    departAt,
    createdAt: new Date(raw.createdAt || raw.created_at || departAt).getTime(),
    neighborhoodId: neighborhood?.id || null,
    neighborhoodLabel: neighborhood?.label || null,
    destGeohash: encodeGeohash(dropoff.lat, dropoff.lng, 6),
    pickupGeohash: encodeGeohash(pickup.lat, pickup.lng, 6),
    window,
    route: raw.route || null,
    polyline: raw.polyline || null,
    distanceM: raw.distanceM,
    durationS: raw.durationS,
  }
}

function dedupeByUser(requests) {
  const byUser = new Map()
  const anon = []
  for (const req of requests) {
    if (!req.userId) {
      anon.push(req)
      continue
    }
    const prev = byUser.get(req.userId)
    if (!prev || req.createdAt >= prev.createdAt) byUser.set(req.userId, req)
  }
  return [...byUser.values(), ...anon]
}

function poolScore(members) {
  if (members.length < 2) return 1
  let sum = 0
  let n = 0
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      sum += overlapScore(members[i], members[j]).total
      n += 1
    }
  }
  return n ? sum / n : 0
}

/**
 * Greedy match. Priority queues: game day, then Thu/Fri/Sat night,
 * then class change, then everyone else. Each pool holds at most
 * min(4, seats) riders who pairwise clear the overlap threshold.
 * A 5th mutual match stays in the queue as its own waiting pool.
 */
export function matchCarpoolRequests(requests, { at = new Date(), seats = MAX_RIDERS, gameDay = false } = {}) {
  const maxRiders = Math.min(MAX_RIDERS, Math.max(1, Number(seats) || MAX_RIDERS))
  const rejected = []
  const normalized = []
  for (const raw of requests || []) {
    const next = normalizeRequest(raw, { at, gameDay })
    if (next.error) rejected.push({ id: raw?.id || null, error: next.error })
    else normalized.push(next)
  }
  const deduped = dedupeByUser(normalized)
  const queues = {
    game_day: [],
    peak_night: [],
    class_change: [],
    off_peak: [],
  }
  for (const req of deduped) queues[req.window].push(req)
  for (const key of Object.keys(queues)) {
    queues[key].sort((a, b) => a.departAt - b.departAt || a.createdAt - b.createdAt)
  }

  const used = new Set()
  const pools = []
  const order = ['game_day', 'peak_night', 'class_change', 'off_peak']
  for (const window of order) {
    for (const seed of queues[window]) {
      if (used.has(seed.id)) continue
      const ranked = deduped
        .filter((req) => !used.has(req.id) && req.id !== seed.id)
        .map((req) => ({ req, score: overlapScore(seed, req) }))
        .filter((row) => row.score.ok)
        .sort((a, b) => b.score.total - a.score.total || a.req.departAt - b.req.departAt)
      const members = [seed]
      for (const row of ranked) {
        if (members.length >= maxRiders) break
        const fits = members.every((member) => overlapScore(member, row.req).ok)
        if (!fits) continue
        members.push(row.req)
      }
      members.forEach((member) => used.add(member.id))
      const quote = quoteCarpool({ riders: members, at, gameDay })
      pools.push({
        id: `pool-${seed.id}`,
        window,
        priority: priorityRank(window),
        neighborhoodId: seed.neighborhoodId,
        neighborhoodLabel: seed.neighborhoodLabel,
        geohash: seed.destGeohash,
        riderIds: members.map((member) => member.id),
        riders: members,
        size: members.length,
        score: poolScore(members),
        quote,
        openSeats: maxRiders - members.length,
        waiting: members.length < 2,
      })
    }
  }

  pools.sort((a, b) => a.priority - b.priority || b.size - a.size || b.score - a.score)
  return { pools, rejected, maxRiders, considered: deduped.length }
}

function platformSplit(grossCents) {
  const gross = Math.max(0, Math.round(grossCents))
  const platformFeeCents = Math.round(gross * PLATFORM_FEE_RATE)
  return { platformFeeCents, driverCents: gross - platformFeeCents }
}

function sumShares(shares) {
  return shares.reduce((total, share) => total + share.shareCents, 0)
}

/**
 * Quote a pool.
 * Each rider pays a fraction of their own solo surge price.
 * Full car (4) on a $30–$40 solo lands at about $10.50–$14.
 * Driver payout is 80% of the pool and is raised (by easing the
 * discount, never above solo) until it beats a solo trip by the
 * named carpool bonus. Platform keeps 20% unless a first-ride
 * comp has to be funded.
 */
export function quoteCarpool({
  riders,
  at = new Date(),
  gameDay = false,
  distanceM = null,
  durationS = null,
  firstRideFreeIds = [],
} = {}) {
  const when = at instanceof Date ? at : new Date(at)
  const priced = (riders || []).map((rider, index) => {
    const pickup = rider.pickup
    const dropoff = rider.dropoff
    const hopM = Number.isFinite(Number(rider.distanceM))
      ? Number(rider.distanceM)
      : haversineMeters(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng)
    const hopS = Number.isFinite(Number(rider.durationS))
      ? Number(rider.durationS)
      : estimateDurationSeconds(hopM)
    const depart = new Date(rider.departAt || when)
    const window = rider.window || demandWindow(depart, { gameDay: Boolean(gameDay || rider.gameDay) })
    const soloCents = soloSurgeCents({ distanceM: hopM, durationS: hopS, window })
    return {
      id: String(rider.id || `rider-${index}`),
      firstName: firstName(rider.displayName || rider.display_name),
      soloCents,
      window,
      hopM,
      hopS,
    }
  })

  const count = Math.min(6, Math.max(1, priced.length))
  const rate = SHARE_OF_SOLO[count] ?? SHARE_OF_SOLO[6]
  let shares = priced.map((row) => {
    const raw = Math.round(row.soloCents * rate)
    const shareCents = Math.min(row.soloCents, Math.max(count === 1 ? row.soloCents : 50, raw))
    return {
      id: row.id,
      firstName: row.firstName,
      soloCents: row.soloCents,
      shareCents,
      window: row.window,
      savingsCents: row.soloCents - shareCents,
      firstRideFree: false,
    }
  })

  const sharedMeters = Number.isFinite(Number(distanceM))
    ? Number(distanceM)
    : Math.max(...priced.map((row) => row.hopM), 0)
  const miles = sharedMeters / 1609.344
  const anchorSoloCents = shares.reduce((max, share) => Math.max(max, share.soloCents), 0)
  const soloSplit = platformSplit(anchorSoloCents)
  const extras = Math.max(0, count - 1)
  const namedBonusCents = extras === 0 ? 0 : extras * BONUS_CENTS_PER_EXTRA_RIDER + Math.round(miles * BONUS_CENTS_PER_MILE)
  const targetDriver = count === 1 ? soloSplit.driverCents : soloSplit.driverCents + namedBonusCents

  const driverOf = (list) => platformSplit(sumShares(list)).driverCents

  if (count > 1 && driverOf(shares) < targetDriver) {
    const scaleNeed = targetDriver / 0.8 / Math.max(1, sumShares(shares))
    shares = shares.map((share) => {
      const scaled = Math.min(share.soloCents, Math.max(share.shareCents, Math.round(share.shareCents * scaleNeed)))
      return { ...share, shareCents: scaled, savingsCents: share.soloCents - scaled }
    })
    let guard = 0
    while (driverOf(shares) < targetDriver && guard < 200000) {
      const room = shares.find((share) => share.shareCents < share.soloCents)
      if (!room) break
      room.shareCents += 1
      room.savingsCents = room.soloCents - room.shareCents
      guard += 1
    }
  }

  let grossCents = sumShares(shares)
  let { platformFeeCents, driverCents } = platformSplit(grossCents)
  let subsidyCents = 0

  if (count > 1 && driverCents < targetDriver) {
    subsidyCents = targetDriver - driverCents
    driverCents = targetDriver
    platformFeeCents = Math.max(0, grossCents - driverCents)
  }

  const freeId = (firstRideFreeIds || []).find((id) => shares.some((share) => share.id === String(id)))
  if (freeId) {
    const share = shares.find((row) => row.id === String(freeId))
    if (share && share.shareCents > 0) {
      share.firstRideFree = true
      share.shareCents = 0
      share.savingsCents = share.soloCents
      grossCents = sumShares(shares)
      const cashForDriver = grossCents
      if (cashForDriver >= targetDriver) {
        driverCents = targetDriver
        platformFeeCents = grossCents - driverCents
        subsidyCents = 0
      } else {
        driverCents = targetDriver
        platformFeeCents = 0
        subsidyCents = targetDriver - grossCents
      }
    }
  }

  const beatsSolo = driverCents >= soloSplit.driverCents
  return {
    riderCount: count,
    shareOfSolo: rate,
    shares,
    grossCents,
    platformFeeCents,
    platformFeeRate: PLATFORM_FEE_RATE,
    subsidyCents,
    anchorSoloCents,
    sharedMeters,
    driver: {
      payoutCents: driverCents,
      soloPayoutCents: soloSplit.driverCents,
      carpoolBonusCents: Math.max(0, driverCents - soloSplit.driverCents),
      namedBonusCents,
      incentiveId: DRIVER_CARPOOL_BONUS_ID,
      beatsSolo,
    },
  }
}

/**
 * Numbers for the pre-confirm card.
 * soloSurge / fullCar are always the peak-night 1-vs-4 story.
 * currentShare is what this confirm will actually charge when a live quote exists.
 */
export function surgeDelta({ pickup, dropoff, at = new Date(), quote = null, selfId = null } = {}) {
  if (pickup?.lat == null || dropoff?.lat == null) return null
  const when = at instanceof Date ? at : new Date(at)
  const peakAt = illustrativePeakAt(when)
  const pitch = pitchQuote({ pickup, dropoff, at: peakAt, displayName: 'You' })
  const share = (quote?.shares || []).find((row) => selfId && row.id === selfId) || quote?.shares?.[0] || null
  const currentShareCents = share ? share.shareCents : null
  const currentRiderCount = quote?.riderCount || null
  return {
    soloSurgeCents: pitch.soloCents,
    fullCarShareCents: pitch.fullShareCents,
    savingsCents: Math.max(0, pitch.soloCents - pitch.fullShareCents),
    driverPayoutCents: pitch.full.driver.payoutCents,
    driverSoloPayoutCents: pitch.full.driver.soloPayoutCents,
    driverBonusCents: pitch.full.driver.carpoolBonusCents,
    driverBeatsSolo: pitch.full.driver.beatsSolo,
    window: pitch.window,
    currentShareCents,
    currentRiderCount,
    currentSavingsCents: currentShareCents == null ? null : Math.max(0, pitch.soloCents - currentShareCents),
  }
}

/** Pitch card: this rider alone vs a full car of the same hop. */
export function pitchQuote({ pickup, dropoff, at = new Date(), gameDay = false, displayName = 'You' } = {}) {
  const seed = {
    id: 'you',
    displayName,
    pickup,
    dropoff,
    departAt: at,
  }
  const clones = [0, 1, 2, 3].map((i) => ({
    ...seed,
    id: i === 0 ? 'you' : `seat-${i}`,
    displayName: i === 0 ? displayName : `Seat${i + 1}`,
  }))
  const solo = quoteCarpool({ riders: [seed], at, gameDay })
  const full = quoteCarpool({ riders: clones, at, gameDay })
  const you = full.shares.find((share) => share.id === 'you') || full.shares[0]
  return {
    solo,
    full,
    soloCents: solo.shares[0]?.soloCents || 0,
    fullShareCents: you?.shareCents || 0,
    savingsCents: (solo.shares[0]?.soloCents || 0) - (you?.shareCents || 0),
    window: solo.shares[0]?.window || demandWindow(at, { gameDay }),
  }
}

export function chargePlan(quote) {
  const lines = (quote?.shares || []).map((share) => ({
    id: share.id,
    amountCents: share.firstRideFree ? 0 : share.shareCents,
    firstRideFree: Boolean(share.firstRideFree),
  }))
  const chargedCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  return {
    lines,
    chargedCents,
    driverPayoutCents: quote?.driver?.payoutCents || 0,
    platformFeeCents: quote?.platformFeeCents || 0,
    subsidyCents: quote?.subsidyCents || 0,
  }
}

export function driverTakeCents(trip) {
  const payout = trip?.metadata?.driver_payout_cents
  if (payout != null && Number.isFinite(Number(payout))) return Number(payout)
  const nested = trip?.metadata?.carpool?.driver?.payoutCents
  if (nested != null && Number.isFinite(Number(nested))) return Number(nested)
  return Number(trip?.fare_cents) || 0
}

export function formatUsd(cents) {
  return (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function driverOfferCopy(quote) {
  if (!quote?.driver) return null
  const bonus = quote.driver.carpoolBonusCents
  return {
    headline: formatUsd(quote.driver.payoutCents),
    sub: bonus > 0
      ? `${formatUsd(bonus)} more than a solo trip`
      : 'Same as a solo trip',
    detail: `Riders pay ${formatUsd(quote.grossCents)} together. You net ${formatUsd(quote.driver.payoutCents)} after the 20% platform fee — at least a solo ${formatUsd(quote.anchorSoloCents)} trip plus the carpool bonus.`,
    incentiveId: DRIVER_CARPOOL_BONUS_ID,
  }
}

export function carpoolSeatCap({ kind, partyType, matchMode, vehicleSeats } = {}) {
  if (kind !== 'carpool') {
    const seats = Number(vehicleSeats)
    return Number.isFinite(seats) && seats > 0 ? seats : 5
  }
  const seats = Number(vehicleSeats)
  const vehicle = Number.isFinite(seats) && seats > 0 ? seats : MAX_RIDERS
  if (partyType === 'tailgate' && matchMode === 'student_driver') {
    return Math.min(6, vehicle)
  }
  return Math.min(MAX_RIDERS, vehicle)
}

export function isGameWeek(at = new Date(), weeks = GAME_WEEKS) {
  const iso = zonedParts(at instanceof Date ? at : new Date(at)).isoDate
  return (weeks || []).some((week) => iso >= week.start && iso <= week.end)
}

export function firstRideWindowOpen(at = new Date(), { gameDay = false, enabled = true, weeks = GAME_WEEKS } = {}) {
  if (!enabled) return false
  if (!isGameWeek(at, weeks)) return false
  const window = demandWindow(at, { gameDay })
  return window === 'game_day' || window === 'peak_night' || window === 'class_change'
}

/** Next Thu–Sat peak if `from` is off-peak, otherwise `from`. Used for the hero pitch. */
export function illustrativePeakAt(from = new Date()) {
  const start = from instanceof Date ? from : new Date(from)
  const window = demandWindow(start)
  if (window === 'game_day' || window === 'peak_night') return start
  for (let i = 1; i <= 24 * 8; i += 1) {
    const candidate = new Date(start.getTime() + i * 60 * 60 * 1000)
    const z = zonedParts(candidate)
    if (z.weekday === 6 && z.hour === 22) return candidate
  }
  return start
}

export function makeAmbassadorCode(seed = '') {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = 'amb_'
  const basis = `${seed}-${Date.now()}`
  for (let i = 0; i < 8; i += 1) {
    const code = basis.charCodeAt(i % basis.length) + i * 17
    out += alphabet[Math.abs(code) % alphabet.length]
  }
  return out
}
