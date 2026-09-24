/**
 * Campus and airport stops for pickers that must work without a billed Maps key.
 * Neighborhood coordinates stay in carpoolEngine (same list as CAMPUS_SPOTS).
 * Airport coordinates stay in scheduledRideModel.
 *
 * TODO: free-form street geocoding and friend-ride route miles still need a billed
 * Google Maps key (Places in the browser, Routes on the server). Do not invent a key.
 * This catalog is the offline path.
 */
import { NEIGHBORHOODS } from './carpoolEngine.js'
import { AIRPORT_PLACES } from './scheduledRideModel.js'

const AIRPORT_ALIASES = {
  GSP: ['gsp', 'gsp airport', 'greenville', 'greenville-spartanburg', 'greenville-spartanburg international (gsp)'],
  CLT: ['clt', 'clt airport', 'charlotte', 'charlotte douglas', 'charlotte douglas international (clt)'],
  ATL: ['atl', 'atl airport', 'atlanta', 'hartsfield', 'hartsfield-jackson atlanta (atl)'],
}

const AIRPORT_LABELS = {
  GSP: 'GSP Airport',
  CLT: 'CLT Airport',
  ATL: 'ATL Airport',
}

/** Landmarks already used by rider shortcuts and RIDE_PLACES, outside NEIGHBORHOODS. */
const EXTRA_STOPS = [
  {
    id: 'sikes',
    label: 'Sikes Hall',
    lat: 34.6795,
    lng: -82.8374,
    kind: 'campus',
    aliases: ['sikes', 'sikes hall', 'clemson university'],
  },
  {
    id: 'simpsonville',
    label: 'Simpsonville',
    lat: 34.5868,
    lng: -82.2543,
    kind: 'campus',
    aliases: ['simpsonville'],
  },
]

function airportStops() {
  return AIRPORT_PLACES.map((place) => ({
    id: String(place.code || '').toLowerCase(),
    label: AIRPORT_LABELS[place.code] || place.label,
    lat: place.lat,
    lng: place.lng,
    kind: 'airport',
    aliases: [String(place.label || '').toLowerCase(), ...(AIRPORT_ALIASES[place.code] || [])],
  }))
}

export function catalogStops() {
  const campus = NEIGHBORHOODS.map((row) => ({
    id: row.id,
    label: row.label,
    lat: row.lat,
    lng: row.lng,
    kind: 'campus',
    aliases: row.aliases,
  }))
  return [...campus, ...EXTRA_STOPS, ...airportStops()]
}

function norm(value) {
  return String(value || '').trim().toLowerCase()
}

function matchesQuery(row, query) {
  const label = norm(row.label)
  if (label === query || label.startsWith(query) || label.includes(query)) return true
  return row.aliases.some((alias) => alias === query || alias.startsWith(query) || alias.includes(query) || query.includes(alias))
}

function rank(row, query) {
  const label = norm(row.label)
  if (label === query || row.aliases.some((alias) => alias === query)) return 0
  if (label.startsWith(query) || row.aliases.some((alias) => alias.startsWith(query))) return 1
  return 2
}

export function searchCatalogPlaces(query) {
  const q = norm(query)
  if (q.length < 2) return []
  return catalogStops()
    .filter((row) => matchesQuery(row, q))
    .sort((a, b) => rank(a, q) - rank(b, q) || a.label.localeCompare(b.label))
}

export function lookupCatalogPlace(label) {
  const q = norm(label)
  if (!q) return null
  const rows = catalogStops()
  const exact = rows.find((row) => norm(row.label) === q || row.aliases.some((alias) => alias === q))
  if (exact) return exact
  return rows.find((row) => {
    const name = norm(row.label)
    if (q.startsWith(name)) return true
    return row.aliases.some((alias) => alias.length >= 4 && (q.startsWith(`${alias} `) || q.startsWith(`${alias} ·`) || q.startsWith(`${alias}·`)))
  }) || null
}

export function placeFromStop(stop) {
  if (!stop) return null
  return { label: stop.label, lat: stop.lat, lng: stop.lng }
}

const HOT_IDS = ['grand-marc', 'college-ave', 'memorial-stadium', 'tillman', 'tiger-town', 'gsp', 'clt']

export function hotCatalogPlaces() {
  const byId = new Map(catalogStops().map((row) => [row.id, row]))
  return HOT_IDS.map((id) => byId.get(id)).filter(Boolean)
}

export const OFFER_CARPOOL_STEPS = [
  'Pick a start and an end from campus housing, bars, landmarks, or GSP, CLT, and ATL.',
  'Share the invite. Friends join the same lobby and set their own stops.',
  'Even split divides the fare equally. By distance weights each rider\'s hop.',
  'Registered seats cap the party: 4 riders on a normal offer, up to 6 on a tailgate when the car fits.',
  'You are the assigned driver. Confirm charges each rider their share.',
]

export const OFFER_CARPOOL_MAPS_NOTE =
  'Live Google route miles need the server Maps key. The lobby still opens, and the price card uses campus distance until that key is set.'
