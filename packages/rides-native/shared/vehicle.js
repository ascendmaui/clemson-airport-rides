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

const VEHICLE_COLUMNS = 'id, make, model, color, plate, seats, is_tesla, tier'

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
    is_tesla: Boolean(p.isTesla),
    autonomous_capable: false,
    tier: p.isTesla ? 'tesla_self_driving' : 'standard',
  }
  const { data: existing, error: readErr } = await supabase.from('vehicles').select('id').eq('driver_id', userId).limit(1)
  if (readErr) throw new Error(readErr.message)
  const current = existing?.[0]
  if (!current) {
    const { data, error } = await supabase.from('vehicles').insert({ driver_id: userId, ...fields }).select(VEHICLE_COLUMNS).single()
    if (error) throw new Error(error.message)
    return data
  }
  const { data, error } = await supabase.from('vehicles').update(fields).eq('id', current.id).select(VEHICLE_COLUMNS).single()
  if (error) throw new Error(error.message)
  return data
}
