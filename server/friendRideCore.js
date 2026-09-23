/**
 * Shared helpers for Clemson friend-ride + Stripe serverless routes.
 * Server-only — never import from Vite client.
 */
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { quoteFare } from '../src/lib/fareRates.js'

export const MAX_PARTICIPANTS = 5

export const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://awktabuhijrshmsmagpq.supabase.co'

export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const stripeSecret = process.env.STRIPE_SECRET_KEY || ''
export const googleMapsKey =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_ROUTES_API_KEY ||
  ''

export function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(body))
}

export function cors(req, res) {
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return true
  }
  return false
}

export function parseBody(req) {
  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}')
    } catch {
      return { error: 'Invalid JSON' }
    }
  }
  return { body: body || {} }
}

export function admin() {
  if (!serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function stripeOk() {
  return Boolean(stripeSecret && stripeSecret.startsWith('sk_') && !stripeSecret.includes('placeholder'))
}

export function stripeClient() {
  if (!stripeOk()) return null
  return new Stripe(stripeSecret)
}

export async function userFromAuth(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  const m = String(h).match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const sb = admin()
  if (!sb) return null
  const { data, error } = await sb.auth.getUser(m[1])
  if (error || !data?.user) return null
  return data.user
}

export function randomToken(bytes = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  const arr = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  for (let i = 0; i < bytes; i++) out += alphabet[arr[i] % alphabet.length]
  return out
}

/** Metered fare — same card as src/lib/fareRates.js. Prefer friendRideLib in new code. */
export function computeFriendFareCents(distanceM, durationS, { surgeMultiplier = 1, vehicleMultiplier = 1, isCarpool = false } = {}) {
  const quote = quoteFare({
    distanceM,
    durationS,
    surgeMultiplier,
    vehicleMultiplier,
    isCarpool,
    isStudent: false,
  })
  return { fareCents: quote.fareBeforeCreditsCents, breakdown: quote.breakdown }
}

/** @deprecated use computeFriendFareCents(...).fareCents */
export function computeFriendFareCentsLegacy(distanceM, durationS) {
  return computeFriendFareCents(distanceM, durationS).fareCents
}

export function splitFares(totalCents, participants, splitMode, segmentWeights) {
  const n = participants.length
  if (n === 0) return []
  const total = Math.max(0, Number(totalCents) || 0)
  if (splitMode === 'by_distance' && segmentWeights?.length === n) {
    const sumW = segmentWeights.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const fares = participants.map((_, i) => Math.floor((total * Math.max(0, segmentWeights[i])) / sumW))
    let rem = total - fares.reduce((a, b) => a + b, 0)
    for (let i = 0; rem > 0; i = (i + 1) % n, rem--) fares[i] += 1
    return fares
  }
  const base = Math.floor(total / n)
  const fares = participants.map(() => base)
  let rem = total - base * n
  for (let i = 0; rem > 0; i++, rem--) fares[i] += 1
  return fares
}

export function stopLatLng(stop) {
  if (!stop) return null
  const lat = Number(stop.lat ?? stop.latitude)
  const lng = Number(stop.lng ?? stop.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng, label: stop.label || stop.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}` }
}

/**
 * Build origin / destination / intermediates from participants' pickups & dropoffs.
 * First pickup = origin, last dropoff = destination; other unique points = intermediates.
 */
export function buildWaypointList(participants) {
  const pickups = []
  const dropoffs = []
  for (const p of participants) {
    const pu = stopLatLng(p.pickup)
    const dr = stopLatLng(p.dropoff)
    if (pu) pickups.push({ ...pu, participantId: p.id, kind: 'pickup' })
    if (dr) dropoffs.push({ ...dr, participantId: p.id, kind: 'dropoff' })
  }
  if (!pickups.length || !dropoffs.length) {
    return { error: 'Need at least one pickup and one dropoff across the group' }
  }
  const origin = pickups[0]
  const destination = dropoffs[dropoffs.length - 1]
  const intermediates = []
  const seen = new Set([`${origin.lat},${origin.lng}`, `${destination.lat},${destination.lng}`])
  for (const s of [...pickups.slice(1), ...dropoffs.slice(0, -1)]) {
    const k = `${s.lat},${s.lng}`
    if (seen.has(k)) continue
    seen.add(k)
    intermediates.push(s)
  }
  return { origin, destination, intermediates, pickups, dropoffs }
}

export async function computeRoutes(origin, destination, intermediates) {
  if (!googleMapsKey || googleMapsKey.includes('placeholder')) {
    return {
      error: 'GOOGLE_MAPS_API_KEY not configured on server',
      code: 'maps_key_missing',
    }
  }
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
    languageCode: 'en-US',
    units: 'IMPERIAL',
  }
  if (intermediates.length) {
    body.intermediates = intermediates.map((s) => ({
      location: { latLng: { latitude: s.lat, longitude: s.lng } },
    }))
    body.optimizeWaypointOrder = intermediates.length > 1
  }
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleMapsKey,
      'X-Goog-FieldMask':
        'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      error: data?.error?.message || `Routes API HTTP ${res.status}`,
      code: 'routes_api_error',
      detail: data,
    }
  }
  const route = data.routes?.[0]
  if (!route) return { error: 'No route returned', code: 'no_route' }
  const durationS = Number(String(route.duration || '0s').replace(/s$/, '')) || 0
  const distanceM = Number(route.distanceMeters) || 0
  const legs = (route.legs || []).map((leg) => ({
    distanceM: Number(leg.distanceMeters) || 0,
    durationS: Number(String(leg.duration || '0s').replace(/s$/, '')) || 0,
  }))
  return {
    distanceM,
    durationS,
    polyline: route.polyline?.encodedPolyline || null,
    optimizedOrder: route.optimizedIntermediateWaypointIndex || null,
    legs,
  }
}

export function publicRideSummary(ride, participants) {
  return {
    id: ride.id,
    token: ride.token,
    status: ride.status,
    split_mode: ride.split_mode,
    route_polyline: ride.route_polyline,
    distance_m: ride.distance_m,
    duration_s: ride.duration_s,
    total_fare_cents: ride.total_fare_cents,
    stops: ride.stops,
    fare_breakdown: ride.fare_breakdown || null,
    trip_id: ride.trip_id,
    organizer_id: ride.organizer_id,
    created_at: ride.created_at,
    updated_at: ride.updated_at,
    participants: (participants || []).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      email: p.email ? maskEmail(p.email) : null,
      user_id: p.user_id,
      pickup: p.pickup,
      dropoff: p.dropoff,
      fare_cents: p.fare_cents,
      status: p.status,
      paid_at: p.paid_at,
      charge_error: p.charge_error,
      charge_attempts: p.charge_attempts,
      has_card: null,
    })),
  }
}

function maskEmail(email) {
  const [u, d] = String(email).split('@')
  if (!d) return '***'
  const head = u.slice(0, 1) || '*'
  return `${head}***@${d}`
}

export async function loadRideByToken(sb, token) {
  const { data: ride, error } = await sb
    .from('friend_rides')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!ride) return null
  const { data: participants, error: pErr } = await sb
    .from('friend_ride_participants')
    .select('*')
    .eq('friend_ride_id', ride.id)
    .order('created_at', { ascending: true })
  if (pErr) throw new Error(pErr.message)
  return { ride, participants: participants || [] }
}

export async function ensureStripeCustomer(stripe, sb, profile) {
  if (profile.stripe_customer_id) return profile.stripe_customer_id
  const customer = await stripe.customers.create({
    email: profile.email || undefined,
    name: profile.full_name || undefined,
    metadata: { profile_id: profile.id },
  })
  await sb
    .from('profiles')
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq('id', profile.id)
  return customer.id
}
