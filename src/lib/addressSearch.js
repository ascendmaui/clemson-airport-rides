/**
 * Free-form street search and reverse geocoding without a billed Maps key.
 *
 * Order: the built-in catalog (placeCatalog.js) is checked by the component first.
 * Then Geoapify when VITE_GEOAPIFY_API_KEY is set at build time (free plan,
 * 3,000 credits/day). If the key is absent or Geoapify fails, Photon
 * (photon.komoot.io, OpenStreetMap data). If both fail the caller gets an empty
 * list or null and shows catalog rows only. Nothing here throws.
 *
 * Results are biased to Clemson and the Upstate. Anything farther than
 * MAX_DISTANCE_KM from campus is dropped.
 */

import { GEOAPIFY_API_KEY } from './geoapifyKey.js'

export const CLEMSON_CENTER = { lat: 34.683, lng: -82.837 }
export const MIN_REMOTE_QUERY = 3
export const SUGGEST_DEBOUNCE_MS = 300
export const REMOTE_TIMEOUT_MS = 4000
export const MAX_DISTANCE_KM = 400

const GEOAPIFY_BASE = 'https://api.geoapify.com/v1/geocode'
const PHOTON_BASE = 'https://photon.komoot.io'
const CACHE_LIMIT = 60
const cache = new Map()

export function geoapifyKey(raw) {
  return String(raw || '').trim()
}

export function remoteProvider(apiKey = GEOAPIFY_API_KEY) {
  return geoapifyKey(apiKey) ? 'geoapify' : 'photon'
}

function distanceKm(lat, lng) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat - CLEMSON_CENTER.lat)
  const dLng = toRad(lng - CLEMSON_CENTER.lng)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(CLEMSON_CENTER.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

function nearUpstate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && distanceKm(lat, lng) <= MAX_DISTANCE_KM
}

function stripCountry(label) {
  return String(label || '')
    .replace(/,\s*(United States of America|United States|USA|US)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Join fetch abort with a per-request timeout. */
function timedSignal(signal, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    },
  }
}

async function getJson(url, { fetchImpl, signal }) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable')
  const timed = timedSignal(signal, REMOTE_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { signal: timed.signal, headers: { Accept: 'application/json' } })
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`)
    return await res.json()
  } finally {
    timed.done()
  }
}

export function geoapifyAutocompleteUrl(query, apiKey, limit = 5) {
  const params = new URLSearchParams({
    text: query,
    filter: 'countrycode:us',
    bias: `proximity:${CLEMSON_CENTER.lng},${CLEMSON_CENTER.lat}`,
    limit: String(limit),
    lang: 'en',
    format: 'json',
    apiKey: geoapifyKey(apiKey),
  })
  return `${GEOAPIFY_BASE}/autocomplete?${params}`
}

export function geoapifyReverseUrl(lat, lng, apiKey) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    lang: 'en',
    format: 'json',
    apiKey: geoapifyKey(apiKey),
  })
  return `${GEOAPIFY_BASE}/reverse?${params}`
}

export function photonSearchUrl(query, limit = 5) {
  const params = new URLSearchParams({
    q: query,
    lat: String(CLEMSON_CENTER.lat),
    lon: String(CLEMSON_CENTER.lng),
    limit: String(limit + 3),
    lang: 'en',
  })
  return `${PHOTON_BASE}/api/?${params}`
}

export function photonReverseUrl(lat, lng) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: 'en' })
  return `${PHOTON_BASE}/reverse?${params}`
}

function geoapifyLabel(row) {
  const line1 = String(row?.address_line1 || '').trim()
  const line2 = String(row?.address_line2 || '').trim()
  const joined = line1 && line2 ? `${line1}, ${line2}` : (row?.formatted || line1 || line2)
  return stripCountry(joined)
}

export function parseGeoapifyResults(json) {
  const rows = Array.isArray(json?.results) ? json.results : []
  return rows
    .map((row, i) => ({
      id: `geoapify:${row?.place_id || i}`,
      label: geoapifyLabel(row),
      lat: Number(row?.lat),
      lng: Number(row?.lon),
      kind: 'address',
      source: 'geoapify',
    }))
    .filter((row) => row.label && nearUpstate(row.lat, row.lng))
}

function photonLabel(p) {
  const street = [p?.housenumber, p?.street].filter(Boolean).join(' ')
  const name = p?.name && p.name !== street ? p.name : ''
  const place = p?.city || p?.town || p?.village || p?.district || p?.county || ''
  const region = [p?.state, p?.postcode].filter(Boolean).join(' ')
  return [name, street, place, region].filter(Boolean).join(', ')
}

export function parsePhotonResults(json) {
  const rows = Array.isArray(json?.features) ? json.features : []
  return rows
    .filter((f) => !f?.properties?.countrycode || String(f.properties.countrycode).toUpperCase() === 'US')
    .map((f, i) => {
      const [lng, lat] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates : []
      const p = f?.properties || {}
      return {
        id: `photon:${p.osm_type || ''}${p.osm_id || i}`,
        label: photonLabel(p),
        lat: Number(lat),
        lng: Number(lng),
        kind: 'address',
        source: 'photon',
      }
    })
    .filter((row) => row.label && nearUpstate(row.lat, row.lng))
}

function remember(key, value) {
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
}

export function clearAddressCache() {
  cache.clear()
}

/**
 * Street suggestions for a typed query. Resolves to { provider, results }.
 * provider is 'geoapify', 'photon', or null when nothing answered.
 */
export async function suggestAddresses(query, {
  apiKey = GEOAPIFY_API_KEY,
  signal,
  fetchImpl = globalThis.fetch,
  limit = 5,
} = {}) {
  const q = String(query || '').trim()
  if (q.length < MIN_REMOTE_QUERY) return { provider: null, results: [] }
  const key = geoapifyKey(apiKey)
  const cacheKey = `${key ? 'g' : 'p'}:${q.toLowerCase()}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  if (key) {
    try {
      const json = await getJson(geoapifyAutocompleteUrl(q, key, limit), { fetchImpl, signal })
      const out = { provider: 'geoapify', results: parseGeoapifyResults(json).slice(0, limit) }
      remember(cacheKey, out)
      return out
    } catch {
      if (signal?.aborted) return { provider: null, results: [] }
      // Fall through to Photon.
    }
  }
  try {
    const json = await getJson(photonSearchUrl(q, limit), { fetchImpl, signal })
    const out = { provider: 'photon', results: parsePhotonResults(json).slice(0, limit) }
    remember(cacheKey, out)
    return out
  } catch {
    return { provider: null, results: [] }
  }
}

/** Street label for a GPS fix, or null when no provider answers. */
export async function reverseLabel(lat, lng, {
  apiKey = GEOAPIFY_API_KEY,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const key = geoapifyKey(apiKey)
  if (key) {
    try {
      const json = await getJson(geoapifyReverseUrl(latitude, longitude, key), { fetchImpl, signal })
      const row = Array.isArray(json?.results) ? json.results[0] : null
      const label = row ? geoapifyLabel(row) : ''
      if (label) return label
    } catch {
      if (signal?.aborted) return null
    }
  }
  try {
    const json = await getJson(photonReverseUrl(latitude, longitude), { fetchImpl, signal })
    const feature = Array.isArray(json?.features) ? json.features[0] : null
    const label = feature ? photonLabel(feature.properties || {}) : ''
    return label || null
  } catch {
    return null
  }
}
