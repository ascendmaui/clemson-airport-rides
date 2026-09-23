/**
 * Vehicle capacity + shared fare recompute for friend rides / carpool.
 * Server-only.
 */
export const DEFAULT_MAX_PARTICIPANTS = 5

export function inferVehicleCategory(vehicle) {
  if (!vehicle) return null
  const blob = `${vehicle.type || ''} ${vehicle.tier || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.toLowerCase()
  if (/\b(van|minivan|transit|odyssey|sienna|carnival|pacifica|caravan)\b/.test(blob)) return 'van'
  if (/\b(suv|crossover|suburban|tahoe|explorer|pilot|highlander|4runner|traverse|durango|escalade|yukon|wrangler|bronco|rav4|cr-?v|cx-?5|cx-?9|rogue|pathfinder|murano|model y|model x)\b/.test(blob)) return 'suv'
  if (/\b(sedan|camry|accord|civic|corolla|altima|malibu|sonata|elantra|model 3|model s)\b/.test(blob)) return 'sedan'
  return 'sedan'
}

/** Prefer vehicles.seats; else sedan≤4, van≤5, SUV≤7. */
export function vehicleMaxSeats(vehicle) {
  if (!vehicle) return DEFAULT_MAX_PARTICIPANTS
  const seats = Number(vehicle.seats)
  if (Number.isFinite(seats) && seats > 0) return Math.max(1, Math.min(8, Math.floor(seats)))
  const cat = inferVehicleCategory(vehicle)
  if (cat === 'van') return 5
  if (cat === 'suv') return 7
  return 4
}

export async function loadDriverVehicle(sb, driverId) {
  if (!driverId) return null
  const { data } = await sb
    .from('vehicles')
    .select('id, make, model, color, plate, seats, is_tesla, tier, type')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

export function vehicleFareMultiplier(vehicle, partySize = 1) {
  const cat = inferVehicleCategory(vehicle) || 'sedan'
  let m = 1
  if (cat === 'suv') m = 1.08
  else if (cat === 'van') m = 1.05
  const n = Math.max(1, Number(partySize) || 1)
  if (n >= 5) m *= 1.04
  else if (n >= 3) m *= 1.02
  return m
}
