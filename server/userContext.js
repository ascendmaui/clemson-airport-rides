import { displayFirstName, primeDisplayFirstName } from './privacyName.js'

const PROFILE_SELECTS = [
  'id, role, full_name, email, student_verified_at, rating_avg, rating_count, billing_activated_at, stripe_card_brand, stripe_card_last4, stripe_default_pm_id',
  'id, role, full_name, email, student_verified_at, rating_avg, rating_count, stripe_default_pm_id',
  'id, role, full_name, email, student_verified_at',
]

function ownFirstName(profile, user) {
  const full = profile?.full_name || user?.user_metadata?.full_name || ''
  const named = displayFirstName(full)
  if (named) return named
  const email = profile?.email || user?.email || ''
  if (email.includes('@')) return displayFirstName(email) || email.split('@')[0]
  return ''
}

function emailEligible(email) {
  return String(email || '').trim().toLowerCase().endsWith('@clemson.edu')
}

function normalizeRole(role) {
  if (role === 'driver' || role === 'both' || role === 'rider') return role
  return 'rider'
}

async function selectMaybe(sb, table, build) {
  try {
    const query = build(sb.from(table))
    const { data, error } = await query
    if (error) return { data: null, error }
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

async function peerNames(sb, userId, trips) {
  const ids = []
  for (const trip of trips) {
    const peerId = trip.driver_id === userId ? trip.rider_id : trip.driver_id
    if (peerId && peerId !== userId) ids.push(peerId)
  }
  const unique = [...new Set(ids)]
  if (!unique.length) return { byId: {}, fullNames: [] }
  const { data, error } = await selectMaybe(sb, 'profiles', (q) => q.select('id, full_name').in('id', unique))
  if (error || !Array.isArray(data)) return { byId: {}, fullNames: [] }
  const byId = {}
  const fullNames = []
  for (const row of data) {
    const full = String(row.full_name || '').trim()
    if (full) fullNames.push(full)
    byId[row.id] = displayFirstName(full)
  }
  return { byId, fullNames }
}

export async function loadUserContext(sb, user) {
  if (!user?.id) return { signedIn: false }
  await primeDisplayFirstName()

  let profile = null
  for (const columns of PROFILE_SELECTS) {
    const { data, error } = await selectMaybe(sb, 'profiles', (q) => q.select(columns).eq('id', user.id).maybeSingle())
    if (!error) {
      profile = data
      break
    }
    if (!/column|schema cache/i.test(error.message || '')) break
  }

  const email = profile?.email || user.email || null
  const hasPm = Boolean(profile?.stripe_default_pm_id)
  const role = normalizeRole(profile?.role)

  const [vehicleRes, appRes, statusRes, tripsRes, ratingsRes] = await Promise.all([
    selectMaybe(sb, 'vehicles', (q) => q.select('make, model, color, seats, tier, is_tesla').eq('driver_id', user.id).limit(1)),
    selectMaybe(sb, 'driver_applications', (q) => q.select('status, reviewed_at').eq('profile_id', user.id).maybeSingle()),
    selectMaybe(sb, 'driver_status', (q) => q.select('online, priority_mode').eq('driver_id', user.id).maybeSingle()),
    selectMaybe(sb, 'trips', (q) => q
      .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, fare_cents, scheduled_for, completed_at, requested_at, tier')
      .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
      .order('requested_at', { ascending: false })
      .limit(6)),
    selectMaybe(sb, 'ratings', (q) => q.select('trip_id').eq('rater_id', user.id).order('created_at', { ascending: false }).limit(20)),
  ])

  let trips = Array.isArray(tripsRes.data) ? tripsRes.data : []
  if (tripsRes.error && /requested_at|column/i.test(tripsRes.error.message || '')) {
    const retry = await selectMaybe(sb, 'trips', (q) => q
      .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, fare_cents, completed_at, tier')
      .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
      .limit(6))
    trips = Array.isArray(retry.data) ? retry.data : []
  }

  const rated = new Set((ratingsRes.data || []).map((row) => row.trip_id))
  const peers = await peerNames(sb, user.id, trips)
  const recentTrips = trips.map((trip) => {
    const peerId = trip.driver_id === user.id ? trip.rider_id : trip.driver_id
    const peerFirstName = peerId && peerId !== user.id ? (peers.byId[peerId] || '') : ''
    return {
      id: trip.id,
      status: trip.status,
      as: trip.driver_id === user.id ? 'driver' : 'rider',
      pickup: trip.pickup_label || '',
      dropoff: trip.dropoff_label || '',
      fareUsd: trip.fare_cents == null ? null : Number((Number(trip.fare_cents) / 100).toFixed(2)),
      tier: trip.tier || null,
      when: trip.completed_at || trip.scheduled_for || trip.requested_at || null,
      peerFirstName: peerFirstName || null,
    }
  })

  const pending = recentTrips.find((trip) => trip.status === 'completed' && trip.id && !rated.has(trip.id)) || null
  const vehicleRow = Array.isArray(vehicleRes.data) ? vehicleRes.data[0] : null

  return {
    signedIn: true,
    name: ownFirstName(profile, user),
    _peerFullNames: peers.fullNames,
    email,
    role,
    student: {
      verified: Boolean(profile?.student_verified_at) || emailEligible(email),
      verifiedAt: profile?.student_verified_at || null,
      emailEligible: emailEligible(email),
    },
    ratings: {
      avg: profile?.rating_avg == null ? null : Number(profile.rating_avg),
      count: Number(profile?.rating_count) || 0,
    },
    billing: {
      hasCard: hasPm || Boolean(profile?.stripe_card_last4),
      brand: profile?.stripe_card_brand || null,
      last4: profile?.stripe_card_last4 || null,
      activated: Boolean(profile?.billing_activated_at),
    },
    vehicle: vehicleRow
      ? {
        make: vehicleRow.make || null,
        model: vehicleRow.model || null,
        color: vehicleRow.color || null,
        seats: vehicleRow.seats || null,
        tier: vehicleRow.tier || null,
        isTesla: Boolean(vehicleRow.is_tesla),
      }
      : null,
    driverApplication: appRes.data?.status
      ? { status: appRes.data.status, reviewedAt: appRes.data.reviewed_at || null }
      : null,
    driverOnline: statusRes.data ? Boolean(statusRes.data.online) : null,
    pendingRating: pending
      ? {
        tripId: pending.id,
        pickup: pending.pickup,
        dropoff: pending.dropoff,
        peerFirstName: pending.peerFirstName || null,
      }
      : null,
    recentTrips,
  }
}

export function resolveRoleVariant(context, requested) {
  const role = context?.role || 'rider'
  if (role === 'driver') return 'driver'
  if (role === 'both') return requested === 'driver' ? 'driver' : 'rider'
  return 'rider'
}

export function contextSummary(context) {
  if (!context?.signedIn) return 'Not signed in — general guidance only'
  const bits = [displayFirstName(context.name) || context.name || 'Signed in']
  bits.push(context.role === 'both' ? 'rider and driver' : context.role)
  bits.push(context.student?.verified ? 'student verified' : 'student discount off')
  if (context.billing?.hasCard) {
    const brand = context.billing.brand || 'card'
    const last4 = context.billing.last4 ? ` ••${context.billing.last4}` : ''
    bits.push(`${brand}${last4}`)
  } else {
    bits.push('no card on file')
  }
  if (context.vehicle) {
    bits.push([context.vehicle.color, context.vehicle.make, context.vehicle.model].filter(Boolean).join(' '))
  }
  if (context.driverApplication?.status && context.driverApplication.status !== 'approved') {
    bits.push(`driver ${context.driverApplication.status}`)
  }
  if (context.pendingRating) bits.push('rating waiting')
  if (context.recentTrips?.length) bits.push(`${context.recentTrips.length} recent trips`)
  return bits.filter(Boolean).join(' · ')
}

/** Model-facing copy. Omits payment-method ids and full plate numbers. */
export function contextForPrompt(context) {
  if (!context?.signedIn) {
    return { signedIn: false, note: 'No Supabase session. Do not invent this person\'s trips, card, or role.' }
  }
  return {
    signedIn: true,
    name: displayFirstName(context.name) || context.name || null,
    email: context.email || null,
    role: context.role,
    student: context.student,
    ratings: context.ratings,
    billing: context.billing,
    vehicle: context.vehicle,
    driverApplication: context.driverApplication,
    driverOnline: context.driverOnline,
    pendingRating: context.pendingRating
      ? {
        tripId: context.pendingRating.tripId,
        pickup: context.pendingRating.pickup,
        dropoff: context.pendingRating.dropoff,
        peerFirstName: context.pendingRating.peerFirstName || null,
      }
      : null,
    recentTrips: (context.recentTrips || []).map((trip) => ({
      id: trip.id,
      status: trip.status,
      as: trip.as,
      pickup: trip.pickup,
      dropoff: trip.dropoff,
      fareUsd: trip.fareUsd,
      tier: trip.tier,
      when: trip.when,
      peerFirstName: trip.peerFirstName || null,
    })),
  }
}
