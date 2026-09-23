/**
 * POST /api/friend-rides-create
 * Auth required. Creates friend_rides + organizer participant.
 * body.kind = "friends" | "carpool" (carpool sets driver_profile_id = organizer).
 * Requires a registered vehicle — party cap comes from vehicles.seats (returned in JSON).
 */
import {
  admin, cors, json, parseBody, userFromAuth, randomToken,
} from '../server/friendRideLib.js'
import {
  loadDriverVehicle, vehicleMaxSeats, DEFAULT_MAX_PARTICIPANTS,
} from '../server/friendRideCapacity.js'
import { driverApprovalStatus } from '../server/driverApproval.js'
import { carpoolSeatCap } from '../src/lib/carpoolEngine.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const displayName =
    body.displayName ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Organizer'
  const pickup = body.pickup || null
  const dropoff = body.dropoff || null
  const splitMode = body.splitMode === 'by_distance' ? 'by_distance' : 'even'
  const kind = body.kind === 'carpool' ? 'carpool' : 'friends'
  const partyType = body.partyType === 'tailgate' ? 'tailgate' : 'carpool'
  const ambassadorCode = typeof body.ambassadorCode === 'string' ? body.ambassadorCode.slice(0, 40) : null

  if (kind === 'carpool') {
    const gate = await driverApprovalStatus(sb, user.id)
    if (!gate.approved) {
      return json(res, 403, {
        error: 'Admin must approve your driver application before you can offer a carpool.',
        code: 'driver_not_approved',
      })
    }
  }

  const vehicle = await loadDriverVehicle(sb, user.id)
  if (!vehicle) {
    return json(res, 400, {
      error: 'Add your vehicle before offering a group ride.',
      code: 'vehicle_required',
    })
  }
  const vehicleSeats = vehicleMaxSeats(vehicle) || DEFAULT_MAX_PARTICIPANTS
  const maxParticipants = carpoolSeatCap({
    kind,
    partyType,
    matchMode: 'student_driver',
    vehicleSeats,
  })
  const vehicleLabel = `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || null

  const token = randomToken(18)
  const insertRow = {
    organizer_id: user.id,
    token,
    status: 'collecting',
    split_mode: splitMode,
    stops: [],
    kind,
    fare_breakdown: {
      match_mode: kind === 'carpool' ? 'student_driver' : 'friends',
      party_type: partyType,
      ambassador_code: ambassadorCode,
      carpool: { max_riders: maxParticipants },
    },
  }
  // Carpool organizer is the assigned driver (student-with-car).
  if (kind === 'carpool') insertRow.driver_profile_id = user.id

  let { data: ride, error } = await sb
    .from('friend_rides')
    .insert(insertRow)
    .select('*')
    .single()
  if (error && /fare_breakdown|column/i.test(error.message || '')) {
    delete insertRow.fare_breakdown
    const retry = await sb.from('friend_rides').insert(insertRow).select('*').single()
    ride = retry.data
    error = retry.error
  }
  if (error) return json(res, 500, { error: error.message })

  // Capacity is computed from vehicles.seats and returned in JSON only.
  // Do not write max_participants / vehicle_label — those columns are absent on prod.

  const { data: participant, error: pErr } = await sb
    .from('friend_ride_participants')
    .insert({
      friend_ride_id: ride.id,
      user_id: user.id,
      display_name: displayName,
      email: user.email || null,
      pickup,
      dropoff,
      status: pickup || dropoff ? 'joined' : 'invited',
    })
    .select('*')
    .single()
  if (pErr) return json(res, 500, { error: pErr.message })

  const urlPath = kind === 'carpool' ? `/carpool/${ride.token}` : `/friends/${ride.token}`
  return json(res, 200, {
    ride: { ...ride, max_participants: maxParticipants, vehicle_label: vehicleLabel },
    participant,
    token: ride.token,
    kind,
    urlPath,
    maxParticipants,
    vehicleLabel,
  })
}
