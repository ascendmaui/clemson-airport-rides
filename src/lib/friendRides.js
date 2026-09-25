/**
 * Client helpers for Ride with friends MVP.
 */
import {
  AMBASSADOR_STORAGE_KEY,
  LEGACY_AMBASSADOR_KEY,
  attributionForUser,
  normalizeAmbassadorCode,
  packAttribution,
} from '../../packages/rides-native/shared/ambassadorAttribution.js'
import { supabase } from './supabase.js'
import { WEB_ORIGIN } from '../../shared/productLinks.js'
import { authedJson } from './apiClient.js'

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
      : WEB_ORIGIN
  return `${origin}/friends/${encodeURIComponent(token)}`
}

export function carpoolUrl(token) {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : WEB_ORIGIN
  return `${origin}/carpool/${encodeURIComponent(token)}`
}

export function inviteUrl(token, kind = 'friends') {
  return kind === 'carpool' ? carpoolUrl(token) : friendsUrl(token)
}

export async function api(path, options = {}) {
  return authedJson(supabase, path, options)
}

function readAmbassadorRaw() {
  if (typeof window === 'undefined') return ''
  try {
    const local = window.localStorage.getItem(AMBASSADOR_STORAGE_KEY)
    if (local) return local
  } catch {
    /* ignore */
  }
  try {
    return window.sessionStorage.getItem(LEGACY_AMBASSADOR_KEY) || ''
  } catch {
    return ''
  }
}

export function rememberAmbassador(code, userId = null) {
  const packed = packAttribution(code, userId)
  if (typeof window === 'undefined') return normalizeAmbassadorCode(code)
  try {
    if (!packed) {
      window.localStorage.removeItem(AMBASSADOR_STORAGE_KEY)
      window.sessionStorage.removeItem(LEGACY_AMBASSADOR_KEY)
      return ''
    }
    const normalized = JSON.parse(packed).code
    window.localStorage.setItem(AMBASSADOR_STORAGE_KEY, packed)
    window.sessionStorage.setItem(LEGACY_AMBASSADOR_KEY, normalized)
    return normalized
  } catch {
    return normalizeAmbassadorCode(code)
  }
}

export function rememberedAmbassador(userId) {
  return attributionForUser(readAmbassadorRaw(), userId)?.code || ''
}

export function clearAmbassadorAttribution() {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(AMBASSADOR_STORAGE_KEY) } catch { /* ignore */ }
  try { window.sessionStorage.removeItem(LEGACY_AMBASSADOR_KEY) } catch { /* ignore */ }
}

function withAmbassador(body = {}) {
  const code = body.ambassadorCode || rememberedAmbassador(body.userId)
  const next = { ...body }
  delete next.userId
  if (code) next.ambassadorCode = code
  return next
}

export async function claimAmbassadorAttribution(code) {
  return api('/api/carpool?action=attribute', {
    method: 'POST',
    body: { code },
  })
}

export async function createFriendRide({ displayName, pickup, dropoff, splitMode, kind, partyType, ambassadorCode, userId } = {}) {
  return api('/api/friend-rides?action=create', {
    method: 'POST',
    body: withAmbassador({
      displayName,
      pickup,
      dropoff,
      splitMode,
      kind: kind === 'carpool' ? 'carpool' : 'friends',
      partyType: partyType === 'tailgate' ? 'tailgate' : 'carpool',
      ambassadorCode,
      userId,
    }),
  })
}

export async function matchCarpool(body) {
  return api('/api/carpool?action=match', {
    method: 'POST',
    body: withAmbassador(body),
  })
}

export async function createCarpoolGroup(body) {
  return api('/api/carpool?action=group', {
    method: 'POST',
    body: withAmbassador(body),
  })
}

export async function carpoolProgram(action) {
  return api('/api/carpool?action=program', {
    method: 'POST',
    body: { action, origin: typeof window !== 'undefined' ? window.location.origin : undefined },
  })
}

export async function getFriendRide(token) {
  return api(`/api/friend-rides?action=get&token=${encodeURIComponent(token)}`)
}

export async function joinFriendRide(payload) {
  return api('/api/friend-rides?action=join', { method: 'POST', body: withAmbassador(payload) })
}

export async function recomputeFriendRide(token, splitMode) {
  return api('/api/friend-rides?action=recompute', {
    method: 'POST',
    body: { token, splitMode },
  })
}

export async function confirmFriendCharges(token, { useCredits = true, quoteId, quoteSignature } = {}) {
  const body = {
    token,
    useCredits,
    origin: typeof window !== 'undefined' ? window.location.origin : undefined,
  }
  if (quoteId) body.quoteId = String(quoteId)
  if (quoteSignature) body.quoteSignature = String(quoteSignature)
  return api('/api/friend-rides?action=confirm-charges', {
    method: 'POST',
    body,
  })
}

export async function retryFriendCharge(token, participantId, extra = {}) {
  return api('/api/friend-rides?action=retry-charge', {
    method: 'POST',
    body: { token, participantId, ...extra },
  })
}

export async function createSetupIntent() {
  return api('/api/stripe-payment-methods?action=setup-intent', { method: 'POST', body: {} })
}

export async function savePaymentMethod({ paymentMethodId, setupIntentId }) {
  return api('/api/stripe-payment-methods?action=save', {
    method: 'POST',
    body: { paymentMethodId, setupIntentId },
  })
}

export async function listPaymentMethods() {
  return api('/api/stripe-payment-methods', { method: 'GET' })
}

export async function updatePaymentMethod({ action, paymentMethodId }) {
  return api('/api/stripe-payment-methods', {
    method: 'POST',
    body: { action, paymentMethodId },
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
 * Prefer vehicles.seats when set; else sedan≤4, van≤5, SUV≤7.
 */
export function vehicleMaxSeats(vehicle) {
  if (!vehicle) return DEFAULT_MAX_PARTICIPANTS
  const seats = Number(vehicle.seats)
  if (Number.isFinite(seats) && seats > 0) return Math.max(1, Math.min(8, Math.floor(seats)))
  const cat = inferVehicleCategory(vehicle)
  if (cat === 'van') return 5
  if (cat === 'suv') return 7
  return 4
}

export function capacityMessage(max, { hasVehicle = true } = {}) {
  if (!hasVehicle) return 'Add your vehicle before offering a group ride.'
  return `This vehicle seats up to ${max} total (including you).`
}
