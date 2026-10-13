/**
 * Registered-car capacity. Seat math matches server/friendRideCapacity.js
 * and the web offer form. Carpool caps still come from carpoolSeatCap.
 */
import { carpoolSeatCap } from '../../../src/lib/carpoolEngine.js'
import {
  DEFAULT_MAX_PARTICIPANTS,
  inferVehicleCategory,
  vehicleMaxSeats,
} from '../../../server/friendRideCapacity.js'
import { assessOwnedVehicle, missingLuxuryExceptionColumn } from '../../../shared/ownedVehicle.js'
import { missingVehicleYearColumn } from '../../../shared/vehicleYear.js'

export { DEFAULT_MAX_PARTICIPANTS, inferVehicleCategory, vehicleMaxSeats, carpoolSeatCap }

export function capacityMessage(max, { hasVehicle = true } = {}) {
  if (!hasVehicle) return 'Add your vehicle before offering a group ride.'
  return `This vehicle seats up to ${max} total (including you).`
}

export function vehicleTitle(vehicle) {
  if (!vehicle) return ''
  return [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function offerCapacity(vehicle, { tailgate = false } = {}) {
  if (!vehicle) return null
  const seats = vehicleMaxSeats(vehicle)
  const cap = carpoolSeatCap({
    kind: 'carpool',
    partyType: tailgate ? 'tailgate' : 'carpool',
    matchMode: 'student_driver',
    vehicleSeats: seats,
  })
  return {
    seats,
    cap,
    title: vehicleTitle(vehicle),
    plate: vehicle.plate || '',
    message: capacityMessage(seats, { hasVehicle: true }),
  }
}

const VEHICLE_COLUMNS = 'id, make, model, color, plate, seats, service_class, tier'

export async function loadRegisteredVehicle(supabase, userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('vehicles')
    .select(VEHICLE_COLUMNS)
    .eq('driver_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

export async function saveRegisteredVehicle(supabase, userId, payload) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!userId) throw new Error('Sign in required')
  const p = payload && typeof payload === 'object' ? payload : {}
  const make = String(p.make || '').trim()
  const model = String(p.model || '').trim()
  const plate = String(p.plate || '').trim()
  if (!make || !model || !plate) throw new Error('Make, model, and plate are required.')
  const seats = Math.max(1, Math.min(8, Math.floor(Number(p.seats) || 4)))
  const fields = {
    make,
    model,
    color: String(p.color || '').trim() || null,
    plate,
    seats,
    service_class: p.comfortClass ? 'comfort' : 'standard',
    autonomous_capable: false,
    tier: p.comfortClass ? 'comfort' : 'standard',
  }
  if (ownsVehicleStandards(p)) {
    const decision = assessOwnedVehicle({
      year: p.year,
      condition: p.condition,
      luxuryPhotos: p.luxuryPhotos,
    })
    if (!decision.ok) throw new Error(decision.message)
    fields.year = decision.year
    fields.luxury_exception = decision.luxuryException
  }
  const { data: existing, error: readErr } = await supabase.from('vehicles').select('id').eq('driver_id', userId).limit(1)
  if (readErr) throw new Error(readErr.message)
  const current = existing?.[0]
  const run = (next) => {
    if (!current) {
      return supabase.from('vehicles').insert({ driver_id: userId, ...next }).select(VEHICLE_COLUMNS).single()
    }
    return supabase.from('vehicles').update(next).eq('id', current.id).select(VEHICLE_COLUMNS).single()
  }
  return commitVehicle(run, fields)
}

function ownsVehicleStandards(payload) {
  return ['year', 'condition', 'luxuryPhotos'].some((key) => Object.prototype.hasOwnProperty.call(payload, key))
}

function fieldsAfterMissingColumn(fields, error) {
  const next = { ...fields }
  let changed = false
  if (missingLuxuryExceptionColumn(error) && Object.prototype.hasOwnProperty.call(next, 'luxury_exception')) {
    delete next.luxury_exception
    changed = true
  }
  if (missingVehicleYearColumn(error) && Object.prototype.hasOwnProperty.call(next, 'year')) {
    delete next.year
    changed = true
  }
  return changed ? next : null
}

async function commitVehicle(run, fields) {
  let next = fields
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await run(next)
    if (!error) return data
    const stripped = fieldsAfterMissingColumn(next, error)
    if (!stripped) throw new Error(error.message)
    next = stripped
  }
  throw new Error('Could not save the vehicle')
}

/** Prod vehicles_service_class_check stores standard or comfort. A boolean does not qualify. */
export function isComfortServiceClass(serviceClass) {
  return serviceClass === 'comfort'
}
