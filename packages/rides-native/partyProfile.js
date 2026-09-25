/**
 * Ride profiles and mutual 1–5 star ratings.
 * Signup must collect a profile. The other person on an accepted trip can see it.
 * Aggregates live on profiles.rating_avg / rating_count (database trigger).
 */
import { displayFirstName, normalizePromoCode } from './authErrors.js'

export const SIGNUP_PROFILE_DRAFT_KEY = 'clemson_signup_profile_draft'

export const RIDE_STYLES = ['Quiet', 'Chatty', 'Music on', 'AC max']

export const PARTY_VISIBLE_STATUSES = ['accepted', 'arriving', 'arrived', 'in_progress', 'completed']

export const PROFILE_FIELD_LABELS = {
  full_name: 'full name',
  phone: 'mobile number',
  bio: 'short bio',
  ride_style: 'ride style',
}

const OPEN_ROUTES = new Set([
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-password',
  'set-password',
  'auth',
  'profile-setup',
])

export function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

export function formatPhone(value) {
  const phone = digits(value)
  if (phone.length === 10) return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
  if (phone.length === 11 && phone.startsWith('1')) {
    return `+1 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}`
  }
  return String(value || '').trim()
}

export function hasRideStyle(value) {
  const parts = String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.some((part) => RIDE_STYLES.includes(part))
}

export function missingProfileFields(profile) {
  const missing = []
  if (String(profile?.full_name || '').trim().length < 2) missing.push('full_name')
  if (digits(profile?.phone).length < 10) missing.push('phone')
  if (String(profile?.bio || '').trim().length < 8) missing.push('bio')
  if (!hasRideStyle(profile?.ride_style)) missing.push('ride_style')
  return missing
}

export function isProfileComplete(profile) {
  return missingProfileFields(profile).length === 0
}

export function profileFieldError(profile) {
  const missing = missingProfileFields(profile)
  if (!missing.length) return null
  const labels = missing.map((id) => PROFILE_FIELD_LABELS[id] || id)
  return `Add your ${labels.join(', ')} to finish your profile.`
}

export function profileRowFromUser(user) {
  const meta = user?.user_metadata || {}
  const row = {}
  const name = String(meta.full_name || meta.name || '').trim()
  if (name) row.full_name = name.slice(0, 80)
  const phone = digits(meta.phone)
  if (phone.length >= 10) row.phone = phone.slice(0, 15)
  const bio = String(meta.bio || '').trim()
  if (bio.length >= 8) row.bio = bio.slice(0, 280)
  const style = String(meta.ride_style || '').trim()
  if (hasRideStyle(style)) row.ride_style = style.slice(0, 80)
  return row
}

export function signupProfileMetadata({ fullName, phone, bio, rideStyle, promoCode } = {}) {
  const row = profileRowFromUser({
    user_metadata: {
      full_name: fullName,
      phone,
      bio,
      ride_style: rideStyle,
    },
  })
  const code = normalizePromoCode(promoCode)
  if (code) row.promo_code = code
  return row
}

export function readSignupDraft(raw) {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      fullName: String(parsed.fullName || ''),
      phone: String(parsed.phone || ''),
      bio: String(parsed.bio || ''),
      rideStyle: String(parsed.rideStyle || ''),
      promo: String(parsed.promo || ''),
    }
  } catch {
    return null
  }
}

// A whitespace-only string is blank. Other falsy values stay falsy so `||` behavior holds.
function firstFilled(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      if (value.trim()) return value
      continue
    }
    if (value) return value
  }
  return ''
}

export function userWithDraft(user, draft) {
  if (!user || !draft) return user
  const meta = user.user_metadata || {}
  return {
    ...user,
    user_metadata: {
      ...meta,
      full_name: firstFilled(meta.full_name, meta.name, draft.fullName),
      phone: firstFilled(meta.phone, draft.phone),
      bio: firstFilled(meta.bio, draft.bio),
      ride_style: firstFilled(meta.ride_style, draft.rideStyle),
      promo_code: firstFilled(meta.promo_code, draft.promo),
    },
  }
}

export function buildEnsureProfilePatch(existing, user, now, clemson) {
  const meta = profileRowFromUser(user)
  const fallback = user?.email ? String(user.email).split('@')[0] : 'Rider'
  const patch = {
    id: user.id,
    email: user.email || null,
    updated_at: now,
  }
  if (!String(existing?.full_name || '').trim()) patch.full_name = meta.full_name || fallback
  if (!String(existing?.phone || '').trim() && meta.phone) patch.phone = meta.phone
  if (!String(existing?.bio || '').trim() && meta.bio) patch.bio = meta.bio
  if (!String(existing?.ride_style || '').trim() && meta.ride_style) patch.ride_style = meta.ride_style
  if (clemson && !existing?.student_verified_at) patch.student_verified_at = now
  return patch
}

export function shouldRedirectToProfileSetup({ signedIn, complete, segment }) {
  if (!signedIn || complete) return false
  if (OPEN_ROUTES.has(segment || '')) return false
  return true
}

export function shouldLeaveProfileSetup({ signedIn, complete, segment }) {
  return Boolean(signedIn && complete && segment === 'profile-setup')
}

export function counterpartId(trip, userId) {
  if (!trip || !userId) return null
  if (!PARTY_VISIBLE_STATUSES.includes(trip.status)) return null
  if (userId === trip.rider_id && trip.driver_id && trip.driver_id !== userId) return trip.driver_id
  if (userId === trip.driver_id && trip.rider_id && trip.rider_id !== userId) return trip.rider_id
  return null
}

export function ratingBlockReason(trip, userId) {
  if (!trip) return 'Trip not found'
  if (!userId) return 'Sign in to rate this ride'
  if (trip.status !== 'completed') {
    return 'This trip is not completed yet. Finish the ride, then rate.'
  }
  if (!trip.driver_id) return 'This trip has no driver yet, so it cannot be rated.'
  const isParty = userId === trip.rider_id || userId === trip.driver_id
  if (!isParty) return 'Only the rider or driver on this trip can leave a rating.'
  const rateeId = userId === trip.rider_id ? trip.driver_id : trip.rider_id
  if (!rateeId || rateeId === userId) return 'Cannot rate yourself'
  return null
}

export function validateStars(stars) {
  const value = Number(stars)
  if (!Number.isInteger(value) || value < 1 || value > 5) return 'Stars must be 1–5'
  return null
}

export function formatRatingLine(avg, count) {
  const n = Number(count) || 0
  if (!n || avg == null || Number.isNaN(Number(avg))) return 'New · no ratings yet'
  const label = n === 1 ? 'rating' : 'ratings'
  return `${Number(avg).toFixed(1)} · ${n} ${label}`
}

export function asSpotList(value) {
  if (typeof value === 'string') {
    try {
      return asSpotList(JSON.parse(value))
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.filter((spot) => typeof spot === 'string' && spot.trim()).slice(0, 6)
}

export function vehicleLabelFromRow(vehicle) {
  if (!vehicle) return ''
  if (typeof vehicle === 'string') return vehicle
  return [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
}

export function toCounterpartView(profile, { viewerIsRider = false } = {}) {
  if (!profile) return null
  const fallback = viewerIsRider ? 'Driver' : 'Rider'
  const name = displayFirstName(profile.full_name, fallback)
  return {
    id: profile.id,
    name,
    initial: name.slice(0, 1).toUpperCase(),
    ratingLine: formatRatingLine(profile.rating_avg, profile.rating_count),
    ratingAvg: profile.rating_avg != null ? Number(profile.rating_avg) : null,
    ratingCount: Number(profile.rating_count) || 0,
    bio: String(profile.bio || '').trim(),
    rideStyle: String(profile.ride_style || '').trim(),
    spots: asSpotList(profile.favorite_spots),
    phone: formatPhone(profile.phone),
    student: Boolean(profile.student_verified_at),
    vehicle: vehicleLabelFromRow(profile.vehicle),
    roleLabel: viewerIsRider ? 'Your driver' : 'Your rider',
  }
}

function explainRatingError(message) {
  if (/row-level security|42501/i.test(message || '')) {
    return 'Rating was not saved. You can rate only after the trip is completed, and only the other person on that trip.'
  }
  if (/duplicate|unique|23505/i.test(message || '')) return 'You already rated this trip'
  return message || 'Could not submit rating'
}

const PUBLIC_COLUMNS = 'id, full_name, avatar_url, bio, ride_style, favorite_spots, music_taste, rating_avg, rating_count, student_verified_at, phone, role'
const PUBLIC_FALLBACK = 'id, full_name, avatar_url, phone'
const OWN_COLUMNS = 'id, full_name, phone, bio, ride_style, favorite_spots, rating_avg, rating_count, avatar_url, student_verified_at'
const OWN_FALLBACK = 'id, full_name, phone'

async function selectProfile(supabase, profileId, columns, fallback) {
  let res = await supabase.from('profiles').select(columns).eq('id', profileId).maybeSingle()
  if (res.error && /column|schema cache/i.test(res.error.message || '')) {
    res = await supabase.from('profiles').select(fallback).eq('id', profileId).maybeSingle()
  }
  if (res.error) throw new Error(res.error.message)
  return res.data
}

export async function loadOwnProfile(supabase, userId) {
  if (!supabase || !userId) return null
  return selectProfile(supabase, userId, OWN_COLUMNS, OWN_FALLBACK)
}

export async function loadPublicProfile(supabase, profileId) {
  if (!supabase || !profileId) return null
  const rpc = await supabase.rpc('counterpart_profile', { target: profileId })
  if (!rpc.error) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data
    return row || null
  }
  if (!/function|schema cache|does not exist|PGRST202|counterpart_profile/i.test(rpc.error.message || '')) {
    throw new Error(rpc.error.message)
  }
  return selectProfile(supabase, profileId, PUBLIC_COLUMNS, PUBLIC_FALLBACK)
}

export async function saveOwnProfile(supabase, userId, draft) {
  if (!supabase || !userId) throw new Error('Sign in to save your profile')
  const next = {
    full_name: String(draft?.full_name || '').trim().slice(0, 80),
    phone: digits(draft?.phone).slice(0, 15),
    bio: String(draft?.bio || '').trim().slice(0, 280),
    ride_style: String(draft?.ride_style || '').trim().slice(0, 80),
  }
  const problem = profileFieldError(next)
  if (problem) throw new Error(problem)
  const { error } = await supabase
    .from('profiles')
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(error.message)
  return next
}

async function loadVehicle(supabase, driverId) {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('color, make, model')
      .eq('driver_id', driverId)
      .limit(1)
    if (error) return null
    return data?.[0] || null
  } catch {
    return null
  }
}

export async function loadCounterpart(supabase, trip, userId) {
  const id = counterpartId(trip, userId)
  if (!supabase || !id) return null
  const profile = await loadPublicProfile(supabase, id)
  if (!profile) return null
  const viewerIsRider = trip.rider_id === userId
  const vehicle = viewerIsRider ? await loadVehicle(supabase, id) : null
  return toCounterpartView({ ...profile, vehicle }, { viewerIsRider })
}

export async function fetchTripForRating(supabase, tripId) {
  if (!supabase || !tripId) return null
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, completed_at')
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function hasRatedTrip(supabase, tripId, raterId) {
  if (!supabase || !tripId || !raterId) return false
  const { data, error } = await supabase
    .from('ratings')
    .select('id')
    .eq('trip_id', tripId)
    .eq('rater_id', raterId)
    .maybeSingle()
  if (error) {
    if (/relation|schema cache|does not exist/i.test(error.message || '')) return false
    throw new Error(explainRatingError(error.message))
  }
  return Boolean(data?.id)
}

export async function submitPartyRating(supabase, { tripId, raterId, stars, comment }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const starError = validateStars(stars)
  if (starError) throw new Error(starError)
  const trip = await fetchTripForRating(supabase, tripId)
  const blocked = ratingBlockReason(trip, raterId)
  if (blocked) throw new Error(blocked)
  if (await hasRatedTrip(supabase, tripId, raterId)) throw new Error('You already rated this trip')
  const rateeId = raterId === trip.rider_id ? trip.driver_id : trip.rider_id
  const note = String(comment || '').trim().slice(0, 280)
  const { data, error } = await supabase
    .from('ratings')
    .insert({
      trip_id: tripId,
      rater_id: raterId,
      ratee_id: rateeId,
      stars: Number(stars),
      comment: note || null,
    })
    .select('id, stars')
    .single()
  if (error) throw new Error(explainRatingError(error.message))
  if (!data?.id) throw new Error('Rating was not saved')
  return data
}

export async function findPendingRating(supabase, userId) {
  if (!supabase || !userId) return null
  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, completed_at')
    .eq('status', 'completed')
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
    .not('driver_id', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(5)
  if (error || !trips?.length) return null
  for (const trip of trips) {
    const other = trip.rider_id === userId ? trip.driver_id : trip.rider_id
    if (!other || other === userId) continue
    const already = await hasRatedTrip(supabase, trip.id, userId)
    if (!already) return trip
  }
  return null
}
