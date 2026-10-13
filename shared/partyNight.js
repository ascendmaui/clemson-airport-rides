/**
 * Rider party-night scheduling.
 * The late-night return queue uses the same College Ave window as the driver
 * party-ride queue: Thu–Sat, 10pm–3am Eastern, 0.6 km around College Ave.
 * Shares are a pre-authorization hold, not a deposit.
 */
import { fareAuthorizationCents } from './fareAuthorization.js'
import { RIDE_TIME_ZONE, zonedCivilToUtc } from './rideTime.js'

export const PARTY_ZONE = Object.freeze({
  label: 'College Ave',
  lat: 34.6834,
  lng: -82.8374,
  radiusKm: 0.6,
})

/** Thursday, Friday, Saturday. Hours after midnight belong to the previous night. */
export const PARTY_WINDOW = Object.freeze({
  startHour: 22,
  endHour: 3,
  days: Object.freeze([4, 5, 6]),
})

export const MAX_PARTY_SIZE = 6
export const MIN_LEAD_MS = 30 * 60 * 1000
export const PARTY_RELEASE_LEAD_MS = 45 * 60 * 1000

export const PARTY_REMINDER_WINDOWS = Object.freeze([
  Object.freeze({ id: 'm15', ms: 15 * 60 * 1000, label: 'Pickup in about 15 minutes' }),
  Object.freeze({ id: 'h1', ms: 60 * 60 * 1000, label: 'Pickup in about an hour' }),
  Object.freeze({ id: 'h24', ms: 24 * 60 * 60 * 1000, label: 'Pickup is tomorrow' }),
])

const NOW_GRACE_MS = 20 * 60 * 1000
const BASE_CENTS = 250
const PER_MILE_CENTS = 175
const PER_MIN_CENTS = 35
const MIN_FARE_CENTS = 800
const METERS_PER_MILE = 1609.344
const CAMPUS_MPH = 20
const SAME_PLACE_METERS = 40
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export const HOLD_NOTE = 'Each share is a pre-authorization hold: that person\'s part of the fare plus a 20% buffer (at least $2). The hold is placed when the ride is released to drivers, about 45 minutes before pickup. Nothing is captured when you schedule or when a friend joins. The final fare is captured when the trip ends. This is not a deposit.'

export const SPLIT_NOTE = 'The estimated fare is split evenly across the people who have joined. Extra pennies stay with the person who scheduled the ride. The split updates when someone joins.'

export const REMINDER_QUIET = 'We\'ll remind you starting the day before pickup, then again about an hour out and about 15 minutes before.'

function nyCivil(at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: RIDE_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))
  const get = (type) => parts.find((part) => part.type === type)?.value
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAY[get('weekday')],
  }
}

function formatHour(hour) {
  const h = Number(hour)
  if (h === 0 || h === 24) return '12am'
  const clock = h % 12 === 0 ? 12 : h % 12
  return `${clock}${h >= 12 && h < 24 ? 'pm' : 'am'}`
}

export function partyWindowLabel(windowConfig = PARTY_WINDOW) {
  const names = (windowConfig.days || []).map((day) => DAY_NAMES[day]).filter(Boolean)
  const list = names.length <= 1
    ? (names[0] || '')
    : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  return `${list}, ${formatHour(windowConfig.startHour)} to ${formatHour(windowConfig.endHour)} Eastern`
}

export function returnClosedMessage() {
  return `The return queue opens ${partyWindowLabel()}, for pickups on ${PARTY_ZONE.label}.`
}

export const RETURN_NOTE = `On ${partyWindowLabel()}, a ride home from ${PARTY_ZONE.label} joins the party-ride queue. Drivers who opted into that queue are offered these pickups first.`

/** True inside the night window. Hours after midnight belong to the previous night's weekday. */
export function partyWindowOpen(at = Date.now(), windowConfig = PARTY_WINDOW) {
  const { weekday, hour } = nyCivil(at)
  if (!Number.isFinite(weekday) || !Number.isFinite(hour)) return false
  const days = windowConfig.days || []
  const wraps = windowConfig.endHour <= windowConfig.startHour
  if (!wraps) return hour >= windowConfig.startHour && hour < windowConfig.endHour && days.includes(weekday)
  if (hour >= windowConfig.startHour) return days.includes(weekday)
  if (hour < windowConfig.endHour) return days.includes((weekday + 6) % 7)
  return false
}

export function haversineKm(a, b) {
  const lat1 = Number(a?.lat)
  const lng1 = Number(a?.lng)
  const lat2 = Number(b?.lat)
  const lng2 = Number(b?.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export function inPartyZone(point, zone = PARTY_ZONE) {
  const km = haversineKm(point, zone)
  if (km == null) return false
  return km <= zone.radiusKm
}

export function tripMeters(pickup, dropoff) {
  const km = haversineKm(pickup, dropoff)
  if (km == null) return null
  return km * 1000
}

export function estimateNightFareCents(meters) {
  const miles = Math.max(0, Number(meters) || 0) / METERS_PER_MILE
  const minutes = (miles / CAMPUS_MPH) * 60
  const fare = Math.round(BASE_CENTS + miles * PER_MILE_CENTS + minutes * PER_MIN_CENTS)
  return Math.max(MIN_FARE_CENTS, fare)
}

export function partyFirstName(fullName, fallback = 'Rider') {
  const raw = String(fullName || '').trim()
  if (!raw) return fallback
  const token = (raw.split(/\s+/)[0] || '').split('@')[0]
  const name = token.replace(/[^a-zA-Z'-]/g, '')
  if (!name) return fallback
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function formatPartyUsd(cents) {
  const n = Math.round(Number(cents))
  const amount = Number.isFinite(n) ? n : 0
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatPartyPickup(iso) {
  if (!iso) return 'Time TBD'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Time TBD'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: RIDE_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d)
}

export function splitFareCents(totalCents, count) {
  const n = Math.max(1, Math.min(MAX_PARTY_SIZE, Math.round(Number(count) || 1)))
  const total = Math.max(0, Math.round(Number(totalCents) || 0))
  const base = Math.floor(total / n)
  const remainder = total - base * n
  return Array.from({ length: n }, (_, index) => base + (index === 0 ? remainder : 0))
}

/** Pre-authorization for one share. depositCents is always 0. */
export function holdForShare(shareCents) {
  const auth = fareAuthorizationCents(shareCents)
  return {
    shareCents: auth.estimatedFareCents,
    bufferCents: auth.bufferCents,
    holdCents: auth.authorizationCents,
    depositCents: 0,
    holdKind: 'preauth',
  }
}

export function applySplit(totalCents, members) {
  const ordered = [...(members || [])].sort((a, b) => {
    const delta = Date.parse(a.joinedAt || 0) - Date.parse(b.joinedAt || 0)
    if (delta) return delta
    return String(a.userId || '').localeCompare(String(b.userId || ''))
  })
  const shares = splitFareCents(totalCents, ordered.length || 1)
  return ordered.map((member, index) => ({
    ...member,
    ...holdForShare(shares[index] || 0),
  }))
}

function cleanPlace(place) {
  const lat = Number(place?.lat)
  const lng = Number(place?.lng)
  const label = String(place?.label || '').trim()
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { label: label.slice(0, 160), lat, lng }
}

export function partyPickupAt(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const at = zonedCivilToUtc(year, month, day, hour, minute)
  if (Number.isNaN(at.getTime())) return null
  return at
}

export function validatePartySchedule({ pickup, dropoff, date, time, now = new Date() }) {
  const errors = []
  const from = cleanPlace(pickup)
  const to = cleanPlace(dropoff)
  if (!from) errors.push('Choose a pickup.')
  if (!to) errors.push('Choose a drop-off.')
  if (from && to && from.label === to.label) errors.push('Pickup and drop-off need to be different places.')
  const meters = from && to ? tripMeters(from, to) : null
  if (from && to && meters != null && meters < SAME_PLACE_METERS && !errors.includes('Pickup and drop-off need to be different places.')) {
    errors.push('Pickup and drop-off need to be different places.')
  }
  const pickupAt = partyPickupAt(date, time)
  if (!pickupAt) errors.push('Choose a date and time.')
  else if (pickupAt.getTime() < now.getTime() + MIN_LEAD_MS) errors.push('Schedule at least 30 minutes ahead.')
  return { ok: errors.length === 0, errors, pickupAt, pickup: from, dropoff: to }
}

export function quotePartyNight({ pickup, dropoff, partySize = 1 } = {}) {
  const from = cleanPlace(pickup)
  const to = cleanPlace(dropoff)
  if (!from || !to) return { ok: false, error: 'Choose a pickup and a drop-off.' }
  if (from.label === to.label) return { ok: false, error: 'Pickup and drop-off need to be different places.' }
  const meters = tripMeters(from, to)
  if (meters == null || meters < SAME_PLACE_METERS) {
    return { ok: false, error: 'Pickup and drop-off need to be different places.' }
  }
  const count = Math.max(1, Math.min(MAX_PARTY_SIZE, Math.round(Number(partySize) || 1)))
  const estimatedFareCents = estimateNightFareCents(meters)
  const people = splitFareCents(estimatedFareCents, count).map((share) => holdForShare(share))
  return {
    ok: true,
    estimatedFareCents,
    meters: Math.round(meters),
    partySize: count,
    people,
    depositCents: 0,
    holdKind: 'preauth',
  }
}

export function partyPickupReminder(night, now = new Date()) {
  const when = night?.pickupAt || night?.pickup_at
  if (!when) return null
  if (night?.status && !['scheduled', 'open'].includes(night.status)) return null
  const pickup = new Date(when).getTime()
  if (!Number.isFinite(pickup)) return null
  const until = pickup - now.getTime()
  const farthest = PARTY_REMINDER_WINDOWS[PARTY_REMINDER_WINDOWS.length - 1]
  if (until > farthest.ms) return null
  if (until <= 0) {
    if (until < -NOW_GRACE_MS) return null
    return { id: 'now', label: 'Pickup time is now' }
  }
  const tightest = PARTY_REMINDER_WINDOWS.find((window) => until <= window.ms)
  if (!tightest) return null
  return { id: tightest.id, label: tightest.label }
}

export function partyNightExplainer() {
  const hours = partyWindowLabel()
  return {
    title: 'Party night',
    lede: 'Schedule the ride out with your group before the night starts. Friends join from one link, the fare is split, and each card gets a pre-authorization hold — not a deposit.',
    sections: [
      {
        id: 'schedule',
        title: 'Schedule the night out',
        body: 'Pick the pickup, the drop-off, and a time at least 30 minutes ahead. The ride stays scheduled until it is offered to drivers about 45 minutes before pickup.',
      },
      {
        id: 'invite',
        title: 'Invite friends with a link',
        body: `Share one link. Friends with a Clemson RIDES account join the same ride, up to ${MAX_PARTY_SIZE} people. The group sees first names.`,
      },
      {
        id: 'split',
        title: 'Split the fare',
        body: SPLIT_NOTE,
      },
      {
        id: 'hold',
        title: 'A pre-authorization hold, not a deposit',
        body: HOLD_NOTE,
      },
      {
        id: 'reminder',
        title: 'Pickup reminder',
        body: 'The ride shows a reminder the day before, about an hour before pickup, about 15 minutes before, and when it is time to head out.',
      },
      {
        id: 'return',
        title: 'Late-night return queue',
        body: `On ${hours}, a ride home from ${PARTY_ZONE.label} joins the party-ride queue. Drivers who opted in are offered those pickups first. Outside that window the return queue stays closed.`,
      },
    ],
  }
}

function addCivilDays(civil, days) {
  const utc = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days))
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    weekday: utc.getUTCDay(),
  }
}

function isoDate(civil) {
  const month = String(civil.month).padStart(2, '0')
  const day = String(civil.day).padStart(2, '0')
  return `${civil.year}-${month}-${day}`
}

/** Next Friday 9:00pm Eastern that is still at least 30 minutes away. */
export function suggestNightOut(now = new Date()) {
  const start = nyCivil(now)
  for (let add = 0; add < 14; add += 1) {
    const civil = addCivilDays(start, add)
    if (civil.weekday !== 5) continue
    const at = zonedCivilToUtc(civil.year, civil.month, civil.day, 21, 0)
    if (Number.isNaN(at.getTime())) continue
    if (at.getTime() >= now.getTime() + MIN_LEAD_MS) {
      return { date: isoDate(civil), time: '21:00', pickupAt: at.toISOString() }
    }
  }
  return { date: '', time: '21:00', pickupAt: null }
}

export function presentPartyNight(night, members, { viewerId = null, now = new Date() } = {}) {
  const ordered = applySplit(night.estimatedFareCents, members)
  const viewerIsMember = ordered.some((member) => member.userId === viewerId)
  return {
    id: night.id,
    token: night.token,
    status: night.status,
    pickupLabel: night.pickup.label,
    dropoffLabel: night.dropoff.label,
    ...(viewerIsMember ? { pickup: night.pickup, dropoff: night.dropoff } : {}),
    pickupAt: night.pickupAt,
    pickupText: formatPartyPickup(night.pickupAt),
    estimatedFareCents: night.estimatedFareCents,
    returnOptIn: Boolean(night.returnOptIn),
    members: ordered.map((member) => ({
      id: member.id,
      firstName: partyFirstName(member.displayName),
      shareCents: member.shareCents,
      holdCents: member.holdCents,
      bufferCents: member.bufferCents,
      depositCents: 0,
      holdKind: 'preauth',
      isOrganizer: member.userId === night.organizerId,
      isSelf: Boolean(viewerId) && member.userId === viewerId,
    })),
    memberCount: ordered.length,
    seatsLeft: Math.max(0, MAX_PARTY_SIZE - ordered.length),
    invitePath: `/party-night/${encodeURIComponent(night.token)}`,
    reminder: partyPickupReminder(night, now),
    reminderQuiet: REMINDER_QUIET,
    holdNote: HOLD_NOTE,
    splitNote: SPLIT_NOTE,
    depositCents: 0,
  }
}

export function presentReturnQueue(entries, { riderId = null, now = new Date() } = {}) {
  const waiting = (entries || [])
    .filter((entry) => entry.status === 'waiting')
    .sort((a, b) => Date.parse(a.joinedAt || 0) - Date.parse(b.joinedAt || 0) || String(a.riderId).localeCompare(String(b.riderId)))
  const index = waiting.findIndex((entry) => entry.riderId === riderId)
  const self = index >= 0 ? waiting[index] : null
  return {
    open: partyWindowOpen(now),
    label: PARTY_ZONE.label,
    hours: partyWindowLabel(),
    size: waiting.length,
    position: index >= 0 ? index + 1 : null,
    joined: Boolean(self),
    pickupLabel: self?.pickup?.label || null,
    dropoffLabel: self?.dropoff?.label || null,
    note: RETURN_NOTE,
    closedMessage: returnClosedMessage(),
  }
}

export function canJoinReturnQueue({ pickup, at = Date.now() } = {}) {
  if (!partyWindowOpen(at)) return { ok: false, code: 'return_closed', error: returnClosedMessage() }
  if (!inPartyZone(pickup)) {
    return { ok: false, code: 'outside_zone', error: `Return pickups join the queue from ${PARTY_ZONE.label}.` }
  }
  return { ok: true }
}
