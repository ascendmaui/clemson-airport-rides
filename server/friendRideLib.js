/**
 * Shared helpers for Clemson friend-ride + Stripe serverless routes.
 * Server-only — never import from Vite client.
 */
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

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

/** Clemson MVP fare: base + per-mile + per-min, min $8. Documented heuristic. */
export function computeFriendFareCents(distanceM, durationS, { surgeMultiplier = 1, vehicleMultiplier = 1 } = {}) {
  // Clemson MVP automatic fare — mirrors src/lib/pricing.js spirit (no manual entry).
  const BASE = 250 // $2.50
  const PER_MILE = 175 // $1.75
  const PER_MIN = 35 // $0.35
  const MIN_FARE = 800 // $8
  const miles = Math.max(0, Number(distanceM) || 0) / 1609.344
  const mins = Math.max(0, Number(durationS) || 0) / 60
  const base = Math.round(BASE + miles * PER_MILE + mins * PER_MIN)
  const vehMul = Number(vehicleMultiplier) || 1
  const surged = Math.round(Math.max(MIN_FARE, base) * (Number(surgeMultiplier) || 1) * vehMul)
  return {
    fareCents: surged,
    breakdown: {
      base_cents: BASE,
      distance_cents: Math.round(miles * PER_MILE),
      time_cents: Math.round(mins * PER_MIN),
      subtotal_cents: Math.max(MIN_FARE, base),
      surge_multiplier: Number(surgeMultiplier) || 1,
      vehicle_multiplier: vehMul,
      min_fare_applied: base < MIN_FARE,
    },
  }
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
    kind: ride.kind || 'friends',
    max_participants: ride.max_participants || null,
    vehicle_label: ride.vehicle_label || null,
    split_mode: ride.split_mode,
    route_polyline: ride.route_polyline,
    distance_m: ride.distance_m,
    duration_s: ride.duration_s,
    total_fare_cents: ride.total_fare_cents,
    stops: ride.stops,
    fare_breakdown: ride.fare_breakdown || null,
    trip_id: ride.trip_id,
    organizer_id: ride.organizer_id,
    driver_profile_id: ride.driver_profile_id || null,
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
      student_verified_at: p.student_verified_at || null,
      rating_avg: p.rating_avg != null ? Number(p.rating_avg) : null,
      rating_count: p.rating_count != null ? Number(p.rating_count) : null,
      avatar_url: p.avatar_url || null,
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

export async function maybeBookFriendRide(sb, rideId) {
  const { data: ride } = await sb.from('friend_rides').select('*').eq('id', rideId).single()
  if (!ride || ride.trip_id) return { booked: false, reason: 'already_or_missing' }
  const { data: parts } = await sb
    .from('friend_ride_participants')
    .select('*')
    .eq('friend_ride_id', rideId)
  const list = parts || []
  if (!list.length) return { booked: false, reason: 'no_participants' }
  const unpaid = list.filter((p) => p.status !== 'paid')
  if (unpaid.length) return { booked: false, reason: 'awaiting_payment', unpaid: unpaid.length }

  const waypoints = buildWaypointList(list)
  if (waypoints.error) return { booked: false, reason: waypoints.error }

  const origin = waypoints.origin
  const dest = waypoints.destination
  const stopMeta = [
    { ...origin, order: 0 },
    ...waypoints.intermediates.map((s, i) => ({ ...s, order: i + 1 })),
    { ...dest, order: waypoints.intermediates.length + 1 },
  ]

  const rideKind = ride.kind === 'carpool' ? 'carpool' : 'friend_ride'
  const assignedDriver =
    ride.driver_profile_id ||
    (ride.kind === 'carpool' ? ride.organizer_id : null)
  // Carpool: organizer drives — skip open matching (accepted + assigned).
  // Friends: open searching as before.
  const primaryRider =
    list.find((p) => p.user_id && p.user_id !== assignedDriver)?.user_id ||
    ride.organizer_id
  const acceptedAt = assignedDriver ? new Date().toISOString() : null
  const tripRow = {
    rider_id: primaryRider,
    status: assignedDriver ? 'accepted' : 'searching',
    tier: 'standard',
    pickup_label: origin.label || (rideKind === 'carpool' ? 'Carpool pickup' : 'Friend ride pickup'),
    dropoff_label: dest.label || (rideKind === 'carpool' ? 'Carpool dropoff' : 'Friend ride dropoff'),
    pickup_lat: origin.lat,
    pickup_lng: origin.lng,
    dropoff_lat: dest.lat,
    dropoff_lng: dest.lng,
    fare_cents: ride.total_fare_cents || 0,
    deposit_cents: ride.total_fare_cents || 0,
    passengers: list.length,
    rider_note: `${rideKind === 'carpool' ? 'Carpool' : 'Friend ride'} ${ride.token} · ${list.length} riders`,
    stops: stopMeta,
    metadata: {
      kind: rideKind,
      friend_ride_id: ride.id,
      token: ride.token,
      split_mode: ride.split_mode,
      distance_m: ride.distance_m,
      duration_s: ride.duration_s,
      route_polyline: ride.route_polyline,
      preferred_driver_id: assignedDriver || null,
      participants: list.map((p) => ({
        id: p.id,
        display_name: p.display_name,
        fare_cents: p.fare_cents,
      })),
    },
  }
  if (assignedDriver) {
    tripRow.driver_id = assignedDriver
    tripRow.accepted_at = acceptedAt
  }

  const { data: trip, error } = await sb
    .from('trips')
    .insert(tripRow)
    .select('id, status, driver_id')
    .single()

  if (error) return { booked: false, reason: error.message }

  await sb
    .from('friend_rides')
    .update({ status: 'booked', trip_id: trip.id, updated_at: new Date().toISOString() })
    .eq('id', ride.id)

  // Link payments that were trip_id-null to the new trip
  await sb
    .from('payments')
    .update({ trip_id: trip.id })
    .is('trip_id', null)
    .eq('kind', 'friend_ride_share')
    .in(
      'id',
      list.map((p) => p.payment_id).filter(Boolean),
    )

  await writeRideBills(sb, {
    ride,
    participants: list,
    tripId: trip.id,
    fareBreakdown: ride.fare_breakdown || null,
  })

  return { booked: true, trip }
}

export async function markParticipantPaid(sb, participant, paymentIntent) {
  const amount = paymentIntent?.amount || participant.fare_cents || 0
  const piId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id

  let paymentId = participant.payment_id
  if (!paymentId) {
    const riderId = participant.user_id
    if (!riderId) {
      // payments.rider_id is required — use organizer as fallback via join
      const { data: ride } = await sb
        .from('friend_rides')
        .select('organizer_id')
        .eq('id', participant.friend_ride_id)
        .single()
      const { data: pay, error } = await sb
        .from('payments')
        .insert({
          trip_id: null,
          rider_id: riderId || ride?.organizer_id,
          stripe_payment_intent_id: piId,
          kind: 'friend_ride_share',
          amount_cents: amount,
          status: 'succeeded',
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      paymentId = pay.id
    } else {
      const { data: pay, error } = await sb
        .from('payments')
        .insert({
          trip_id: null,
          rider_id: riderId,
          stripe_payment_intent_id: piId,
          kind: 'friend_ride_share',
          amount_cents: amount,
          status: 'succeeded',
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      paymentId = pay.id
    }
  }

  await sb
    .from('friend_ride_participants')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_id: paymentId,
      stripe_payment_intent_id: piId,
      charge_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', participant.id)

  return maybeBookFriendRide(sb, participant.friend_ride_id)
}


export async function writeRideBills(sb, { ride, participants, tripId, fareBreakdown, paymentMethodByParticipant }) {
  const rows = []
  const total = ride.total_fare_cents || 0
  const bd = fareBreakdown || {}
  for (const p of participants || []) {
    const share = p.fare_cents || 0
    const ratio = total > 0 ? share / total : 0
    const base = Math.round((bd.base_cents || 0) * ratio)
    const dist = Math.round((bd.distance_cents || 0) * ratio)
    const time = Math.round((bd.time_cents || 0) * ratio)
    const sub = Math.round((bd.subtotal_cents || total) * ratio)
    const surge = Math.max(0, Math.round(sub * ((bd.surge_multiplier || 1) - 1)))
    rows.push({
      trip_id: tripId || null,
      friend_ride_id: ride.id,
      participant_id: p.id,
      participant_profile_id: p.user_id || null,
      display_name: p.display_name,
      email: p.email,
      currency: 'usd',
      base_cents: base,
      distance_cents: dist,
      time_cents: time,
      surge_cents: surge,
      surge_multiplier: bd.surge_multiplier || 1,
      subtotal_cents: sub,
      split_cents: share,
      total_fare_cents: total,
      split_mode: ride.split_mode,
      payment_method: (paymentMethodByParticipant || {})[p.id] || (p.stripe_payment_intent_id ? 'card_on_file' : 'payment_element'),
      stripe_payment_intent_id: p.stripe_payment_intent_id,
      distance_m: ride.distance_m,
      duration_s: ride.duration_s,
      line_items: [
        { label: 'Base', cents: base },
        { label: 'Distance', cents: dist },
        { label: 'Time', cents: time },
        { label: 'Surge', cents: surge, multiplier: bd.surge_multiplier || 1 },
        { label: 'Your split', cents: share },
      ],
      charged_at: p.paid_at || new Date().toISOString(),
    })
  }
  if (!rows.length) return { ok: true, count: 0 }
  const { error } = await sb.from('ride_bills').insert(rows)
  if (error) {
    console.error('[writeRideBills]', error)
    return { ok: false, error: error.message }
  }
  return { ok: true, count: rows.length }
}

// Re-export capacity helpers (canonical module: friendRideCapacity.js)
export {
  DEFAULT_MAX_PARTICIPANTS,
  inferVehicleCategory,
  vehicleMaxSeats,
  loadDriverVehicle,
  vehicleFareMultiplier,
} from './friendRideCapacity.js'
