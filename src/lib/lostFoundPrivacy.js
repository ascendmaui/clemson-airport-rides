/** Post-complete lost-and-found display: first names and coarse places only. */

const STREET = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|cir|circle|pkwy|parkway|hwy|highway|apt|unit|suite)\b/i

const CAMPUS_SPOTS = [
  'White C',
  'Bigsby',
  'U on College',
  'Grand Mark',
  'The Pier',
  'The Reserve at Clemson',
  'Highpointe',
  'Campus View',
  'Clemson Lofts',
  '114 Earle',
  'The Enclave',
  'Hartwell Landing',
  'Patrick Square',
  'Downtown / College Ave',
  'Tillman Hall',
  'Memorial Stadium',
  'Cooper Library',
  'Schilletter',
  'Bowman Field',
  'Littlejohn',
  "Tiger Town Tavern (Triple T's)",
  "TD's",
  'The Esso Club',
  'Backstreets',
  "Nick's Tavern",
  'Loose Change',
  '356',
  'Study Hall',
]

export function firstNameOnly(fullName, fallback = 'Them') {
  const raw = String(fullName || '').trim()
  if (!raw) return fallback
  const base = raw.includes('@') ? raw.split('@')[0] : raw
  const token = base.split(/[\s._+]+/)[0] || ''
  const clean = token.replace(/[^A-Za-z'\-]/g, '')
  if (clean.length < 2) return fallback
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

export function coarsePlaceLabel(label, fallback = 'Area') {
  const raw = String(label || '').trim()
  if (!raw) return fallback
  if (/\bgsp\b/i.test(raw) || /greenville.?spartanburg/i.test(raw)) return 'GSP Airport'
  if (/\bclt\b/i.test(raw) || /charlotte douglas/i.test(raw)) return 'CLT Airport'
  if (/airport/i.test(raw)) return 'Airport'
  const lower = raw.toLowerCase()
  for (const spot of CAMPUS_SPOTS) {
    if (lower.includes(spot.toLowerCase())) return spot
  }
  const looksExact = /^\s*\d/.test(raw) || STREET.test(raw) || /\d{3,}/.test(raw) || /#\s*\d/.test(raw)
  if (!looksExact && raw.length <= 48) return raw
  if (/clemson/i.test(raw)) return 'Clemson area'
  if (/downtown/i.test(raw)) return 'Downtown'
  if (/campus/i.test(raw)) return 'Campus'
  if (/simpsonville/i.test(raw)) return 'Simpsonville area'
  return fallback
}

/** Ride chat is not a table in this app. Honor an explicit thread id if one is stored later. */
export function hasRideChat(metadata) {
  if (!metadata || typeof metadata !== 'object') return false
  const id = metadata.ride_chat_id || metadata.chat_thread_id || metadata.chat_id
  return typeof id === 'string' && id.trim().length > 0
}

/**
 * Drop coordinates and exact street labels before UI state.
 * `firstNamesById` values must already be first names.
 */
export function toPublicTrip(row, userId, firstNamesById = {}) {
  if (!row?.id || !userId) return null
  const otherId = row.rider_id === userId ? row.driver_id : row.rider_id
  const iAmRider = row.rider_id === userId
  return {
    id: row.id,
    completedAt: row.completed_at || row.requested_at || null,
    pickup: coarsePlaceLabel(row.pickup_label, 'Pickup area'),
    dropoff: coarsePlaceLabel(row.dropoff_label, 'Dropoff area'),
    otherId: otherId || null,
    otherFirstName: firstNamesById[otherId] || (iAmRider ? 'Driver' : 'Rider'),
    otherRole: iAmRider ? 'driver' : 'rider',
  }
}

export function toPublicReport(row, userId, extras = {}) {
  if (!row?.id) return null
  return {
    id: row.id,
    tripId: row.trip_id,
    status: row.status,
    resolution: row.resolution || null,
    itemDescription: row.item_description,
    supportNote: row.support_note || '',
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    returnedAt: row.returned_at,
    closedAt: row.closed_at,
    reporterId: row.reporter_id,
    counterpartId: row.counterpart_id,
    reporterFirstName: extras.reporterFirstName || 'Rider',
    counterpartFirstName: extras.counterpartFirstName || 'Driver',
    pickup: extras.pickup || 'Pickup area',
    dropoff: extras.dropoff || 'Dropoff area',
    completedAt: extras.completedAt || null,
    hasRideChat: Boolean(extras.hasRideChat),
    mine: row.reporter_id === userId,
  }
}
