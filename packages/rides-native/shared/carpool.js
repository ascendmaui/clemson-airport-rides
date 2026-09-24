/**
 * Rider carpool helpers. Matching, neighborhoods, and the $30–$40 vs $10–$15
 * split stay in src/lib/carpoolEngine.js (flagship PR #17). Do not fork that math.
 */
import {
  NEIGHBORHOODS,
  MAX_RIDERS,
  SHARE_OF_SOLO,
  confirmChargeLabel,
  confirmChargeNote,
  demandWindow,
  firstRideEligible,
  firstRideOfferCopy,
  firstRideWindowOpen,
  formatUsd,
  illustrativePeakAt,
  isGameWeek,
  otherFirstRideLabels,
  pitchQuote,
  surgeDelta,
  quoteCarpool,
  resolveNeighborhood,
  carpoolSeatCap,
} from '../../../src/lib/carpoolEngine.js'
import {
  catalogStops,
  searchCatalogPlaces,
  lookupCatalogPlace,
  placeFromStop,
  hotCatalogPlaces,
  OFFER_CARPOOL_STEPS,
  OFFER_CARPOOL_MAPS_NOTE,
} from '../../../src/lib/placeCatalog.js'

export {
  NEIGHBORHOODS,
  MAX_RIDERS,
  SHARE_OF_SOLO,
  confirmChargeLabel,
  confirmChargeNote,
  demandWindow,
  firstRideEligible,
  firstRideOfferCopy,
  firstRideWindowOpen,
  formatUsd,
  illustrativePeakAt,
  isGameWeek,
  otherFirstRideLabels,
  pitchQuote,
  surgeDelta,
  quoteCarpool,
  resolveNeighborhood,
  carpoolSeatCap,
  catalogStops,
  searchCatalogPlaces,
  lookupCatalogPlace,
  placeFromStop,
  hotCatalogPlaces,
  OFFER_CARPOOL_STEPS,
  OFFER_CARPOOL_MAPS_NOTE,
}

/** Same chips as the web hub. */
export const HOT_NEIGHBORHOOD_IDS = [
  'grand-marc',
  'college-ave',
  'memorial-stadium',
  'tillman',
  'tiger-town',
  'the-pier',
  'clemson-lofts',
  'u-on-college',
]

export const NEIGHBORHOOD_GROUPS = [
  {
    id: 'housing',
    label: 'Housing',
    ids: [
      'grand-marc',
      'the-pier',
      'clemson-lofts',
      'u-on-college',
      'the-reserve',
      'highpointe',
      'campus-view',
      'enclave',
      'white-c',
      'bigsby',
      'hartwell',
      'patrick-square',
    ],
  },
  {
    id: 'bars',
    label: 'Bars',
    ids: ['tiger-town', 'esso', 'backstreets', 'nicks', 'study-hall', 'loose-change', 'bar-356'],
  },
  {
    id: 'campus',
    label: 'Campus',
    ids: [
      'memorial-stadium',
      'tillman',
      'cooper',
      'schilletter',
      'bowman',
      'littlejohn',
      'college-ave',
      'earle-114',
    ],
  },
]

export function neighborhoodById(id) {
  return NEIGHBORHOODS.find((row) => row.id === id) || null
}

export function hotNeighborhoods() {
  return HOT_NEIGHBORHOOD_IDS.map((id) => neighborhoodById(id)).filter(Boolean)
}

export function neighborhoodsInGroup(groupId) {
  if (groupId === 'all') return NEIGHBORHOODS.slice()
  const group = NEIGHBORHOOD_GROUPS.find((row) => row.id === groupId)
  if (!group) return []
  return group.ids.map((id) => neighborhoodById(id)).filter(Boolean)
}

export function searchNeighborhoods(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  return NEIGHBORHOODS.filter((row) => {
    if (row.label.toLowerCase().includes(q)) return true
    return row.aliases.some((alias) => alias.includes(q) || q.includes(alias))
  })
}

export function placeOf(neighborhood) {
  return { label: neighborhood.label, lat: neighborhood.lat, lng: neighborhood.lng }
}

export function defaultCarpoolEnds() {
  return {
    pickup: placeOf(neighborhoodById('grand-marc')),
    dropoff: placeOf(neighborhoodById('college-ave')),
  }
}

export function clusterOf(point) {
  const found = resolveNeighborhood(point)
  if (!found) return null
  return { id: found.id, label: found.label }
}

export function parseCarpoolToken(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const match = text.match(/carpool\/([^/?#\s]+)/i)
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  if (/^[a-z0-9]{8,}$/i.test(text)) return text
  return ''
}

export function formatEta(seconds) {
  const minutes = Math.round((Number(seconds) || 0) / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatMiles(meters) {
  const miles = (Number(meters) || 0) / 1609.344
  return `${miles.toFixed(1)} mi`
}

export function riderDisplayName(user) {
  const meta = user?.user_metadata?.full_name
  if (meta && String(meta).trim()) return String(meta).trim()
  const email = user?.email ? String(user.email).split('@')[0] : ''
  return email || 'Tiger'
}
