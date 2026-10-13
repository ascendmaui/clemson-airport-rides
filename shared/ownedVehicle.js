/**
 * Driver "add vehicle" rules for a car the driver owns or leases.
 * 2019 or newer can be saved. Older cars are a Luxury exception: photos
 * are required, and an admin approves them with approveLuxuryException.
 * Poor condition is blocked before a write.
 */
import { VEHICLE_STANDARD_MIN_YEAR, CONDITION_IDS } from './vehicleStandards.js'
import { parseVehicleYear, vehicleYearMessage } from './vehicleYear.js'

export const DRIVER_RENTALS_BROWSE_URL = 'https://clemsonrides.com/#/rentals'

export const OWN_OR_LEASE_LABEL = 'I own or lease this car'
export const RENT_FROM_PARTNER_LABEL = 'Rent from a partner'

export const POOR_CONDITION_MESSAGE = 'Poor condition is blocked. This car cannot be added.'
export const LUXURY_PHOTOS_MESSAGE = 'Add at least one photo for the Luxury exception.'
export const LUXURY_EXCEPTION_MESSAGE = `This car is older than ${VEHICLE_STANDARD_MIN_YEAR}. Add photos to request a Luxury exception. An admin approves it before the car can be used.`

export function missingLuxuryExceptionColumn(error) {
  const message = String(error?.message || error || '')
  return /luxury_exception/i.test(message) && /schema cache|column|does not exist/i.test(message)
}

export function isPreStandardYear(year, now = new Date()) {
  const parsed = parseVehicleYear(year, now)
  return parsed != null && parsed < VEHICLE_STANDARD_MIN_YEAR
}

function photoList(luxuryPhotos) {
  return Array.isArray(luxuryPhotos) ? luxuryPhotos.map((item) => String(item || '').trim()).filter(Boolean) : []
}

/**
 * @param {{ year?: unknown, condition?: unknown, luxuryPhotos?: unknown }} input
 * @returns {{ ok: true, year: number, luxuryException: boolean, message: string | null } | { ok: false, code: string, message: string }}
 */
export function assessOwnedVehicle(input = {}, now = new Date()) {
  const condition = String(input.condition || '').trim()
  if (condition === 'poor') {
    return { ok: false, code: 'poor_condition', message: POOR_CONDITION_MESSAGE }
  }
  if (!condition) {
    return { ok: false, code: 'condition_missing', message: 'Pick the vehicle condition.' }
  }
  if (!CONDITION_IDS.includes(condition)) {
    return { ok: false, code: 'condition_invalid', message: 'Pick the vehicle condition.' }
  }
  const year = parseVehicleYear(input.year, now)
  if (year == null) {
    return { ok: false, code: 'year_invalid', message: vehicleYearMessage(now) }
  }
  if (year >= VEHICLE_STANDARD_MIN_YEAR) {
    return { ok: true, year, luxuryException: false, message: null }
  }
  if (!photoList(input.luxuryPhotos).length) {
    return { ok: false, code: 'luxury_photos', message: LUXURY_PHOTOS_MESSAGE }
  }
  return { ok: true, year, luxuryException: true, message: LUXURY_EXCEPTION_MESSAGE }
}
