/**
 * Client helpers for Ride with friends MVP.
 */
import { supabase } from './supabase'

const PLACES = [
  { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
  { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 },
  { label: 'Schilletter Dining', lat: 34.6799, lng: -82.8345 },
  { label: 'Core Campus (Tillman)', lat: 34.6784, lng: -82.8397 },
  { label: 'GSP Airport', lat: 34.8956, lng: -82.2189 },
  { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 },
]

export const FRIEND_PLACES = PLACES

export function friendsUrl(token) {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://clemson-airport-rides.vercel.app'
  return `${origin}/friends/${encodeURIComponent(token)}`
}

export function carpoolUrl(token) {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://clemson-airport-rides.vercel.app'
  return `${origin}/carpool/${encodeURIComponent(token)}`
}

export function inviteUrl(token, kind = 'friends') {
  return kind === 'carpool' ? carpoolUrl(token) : friendsUrl(token)
}

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = await authHeaders()
  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new Error(e?.message || 'Network error')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    throw new Error(`API failed (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`)
    err.status = res.status
    err.payload = data
    throw err
  }
  return data
}

export async function createFriendRide({ displayName, pickup, dropoff, splitMode, kind } = {}) {
  return api('/api/friend-rides-create', {
    method: 'POST',
    body: { displayName, pickup, dropoff, splitMode, kind: kind === 'carpool' ? 'carpool' : 'friends' },
  })
}

export async function getFriendRide(token) {
  return api(`/api/friend-rides-get?token=${encodeURIComponent(token)}`)
}

export async function joinFriendRide(payload) {
  return api('/api/friend-rides-join', { method: 'POST', body: payload })
}

export async function recomputeFriendRide(token, splitMode) {
  return api('/api/friend-rides-recompute', {
    method: 'POST',
    body: { token, splitMode },
  })
}

export async function confirmFriendCharges(token) {
  return api('/api/friend-rides-confirm-charges', {
    method: 'POST',
    body: { token, origin: typeof window !== 'undefined' ? window.location.origin : undefined },
  })
}

export async function retryFriendCharge(token, participantId) {
  return api('/api/friend-rides-retry-charge', {
    method: 'POST',
    body: { token, participantId },
  })
}

export async function createSetupIntent() {
  return api('/api/stripe-setup-intent', { method: 'POST', body: {} })
}

export async function savePaymentMethod({ paymentMethodId, setupIntentId }) {
  return api('/api/stripe-save-payment-method', {
    method: 'POST',
    body: { paymentMethodId, setupIntentId },
  })
}

/** Decode Google encoded polyline → [[lat,lng], ...] for CampusMap.route */
export function decodePolyline(encoded) {
  if (!encoded) return null
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

export function formatEta(seconds) {
  const s = Number(seconds) || 0
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatMiles(meters) {
  const mi = (Number(meters) || 0) / 1609.344
  return `${mi.toFixed(1)} mi`
}


/** Default party size when no registered vehicle (friends rides). */
export const DEFAULT_MAX_PARTICIPANTS = 5

/** Infer sedan | van | suv from make/model/type/tier text. */
export function inferVehicleCategory(vehicle) {
  if (!vehicle) return null
  const blob = `${vehicle.type || ''} ${vehicle.tier || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.toLowerCase()
  if (/\b(van|minivan|transit|odyssey|sienna|carnival|pacifica|caravan)\b/.test(blob)) return 'van'
  if (/\b(suv|crossover|suburban|tahoe|explorer|pilot|highlander|4runner|traverse|durango|escalade|yukon|wrangler|bronco|rav4|cr-?v|cx-?5|cx-?9|rogue|pathfinder|murano|model y|model x)\b/.test(blob)) return 'suv'
  if (/\b(sedan|camry|accord|civic|corolla|altima|malibu|sonata|elantra|model 3|model s)\b/.test(blob)) return 'sedan'
  return 'sedan'
}

/**
 * Max participants (including organizer) from registered vehicle.
 * Prefer vehicles.seats when set; else sedan≤4, van≤5, SUV≤6.
 */
export function vehicleMaxSeats(vehicle) {
  if (!vehicle) return DEFAULT_MAX_PARTICIPANTS
  const seats = Number(vehicle.seats)
  if (Number.isFinite(seats) && seats > 0) return Math.max(1, Math.min(8, Math.floor(seats)))
  const cat = inferVehicleCategory(vehicle)
  if (cat === 'van') return 5
  if (cat === 'suv') return 6
  return 4
}

export function capacityMessage(max, { hasVehicle = true } = {}) {
  if (!hasVehicle) return 'Add your vehicle before offering a group ride.'
  return `This vehicle seats up to ${max} total (including you).`
}
