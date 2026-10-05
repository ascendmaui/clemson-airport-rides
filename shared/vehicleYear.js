/** Vehicle year collected on the driver application. Display and writes only. */

export const VEHICLE_YEAR_MIN = 1980

export const VEHICLE_QUEUE_COLUMNS = 'driver_id, make, model, color, plate, seats, service_class, tier'
export const VEHICLE_QUEUE_COLUMNS_WITH_YEAR = 'driver_id, year, make, model, color, plate, seats, service_class, tier'

export function maxVehicleYear(now = new Date()) {
  const year = now instanceof Date ? now.getUTCFullYear() : new Date(now).getUTCFullYear()
  return (Number.isFinite(year) ? year : new Date().getUTCFullYear()) + 1
}

/** Four-digit model year in range, or null. */
export function parseVehicleYear(value, now = new Date()) {
  const text = String(value ?? '').trim()
  if (!/^\d{4}$/.test(text)) return null
  const year = Number(text)
  if (year < VEHICLE_YEAR_MIN || year > maxVehicleYear(now)) return null
  return year
}

export function missingVehicleYearColumn(error) {
  const message = String(error?.message || error || '')
  return /\byear\b/i.test(message) && /schema cache|column|does not exist/i.test(message)
}

/**
 * Account-step messages. Empty object means the vehicle fields can be saved.
 * @param {{ fullName?: string, phone?: string, make?: string, model?: string, color?: string, plate?: string, year?: string|number }} fields
 */
export function vehicleAccountErrors(fields = {}, now = new Date()) {
  const errors = {}
  if (!String(fields.fullName || '').trim()) errors.fullName = 'Full name is required.'
  const digits = String(fields.phone || '').replace(/\D/g, '')
  if (!digits) errors.phone = 'Phone is required.'
  else if (digits.length < 10) errors.phone = 'Phone must have at least 10 digits.'
  if (!String(fields.make || '').trim()) errors.make = 'Make is required.'
  if (!String(fields.model || '').trim()) errors.model = 'Model is required.'
  if (!String(fields.color || '').trim()) errors.color = 'Color is required.'
  if (parseVehicleYear(fields.year, now) == null) {
    errors.year = `Year must be from ${VEHICLE_YEAR_MIN} to ${maxVehicleYear(now)}.`
  }
  if (!String(fields.plate || '').trim()) errors.plate = 'Plate is required.'
  return errors
}

export function vehicleYearMessage(now = new Date()) {
  return `Vehicle year must be from ${VEHICLE_YEAR_MIN} to ${maxVehicleYear(now)}.`
}

/** Drop year so a database that has not added the column can still save the rest. */
export function withoutVehicleYear(fields) {
  if (!fields || !Object.prototype.hasOwnProperty.call(fields, 'year')) return fields
  const next = { ...fields }
  delete next.year
  return next
}

export function withVehicleYear(fields, year) {
  const parsed = parseVehicleYear(year)
  if (parsed == null) return { ...fields }
  return { ...fields, year: parsed }
}

/**
 * Writes vehicle fields. If `year` is not a column yet, retries without it.
 * The caller still saved make, model, color, and plate.
 */
export async function writeVehicleWithYearFallback(run, fields) {
  const first = await run(fields)
  if (!first?.error || !missingVehicleYearColumn(first.error)) return first
  if (!Object.prototype.hasOwnProperty.call(fields, 'year')) return first
  return run(withoutVehicleYear(fields))
}

export function applicantVehicleLabel(vehicle) {
  if (!vehicle) return 'No vehicle on file'
  const name = [vehicle.year, vehicle.color, vehicle.make, vehicle.model]
    .filter((part) => part != null && String(part).trim() !== '')
    .join(' ')
  const plate = String(vehicle.plate || '').trim()
  if (!name && !plate) return 'No vehicle on file'
  if (!plate) return name
  return name ? `${name} · ${plate}` : plate
}

/** Queue read. A missing year column falls back to the columns that already exist. */
export async function loadApplicantVehicles(sb, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  if (!sb || !list.length) return { data: [], error: null }
  const run = (columns) => sb.from('vehicles').select(columns).in('driver_id', list)
  const first = await run(VEHICLE_QUEUE_COLUMNS_WITH_YEAR)
  if (first?.error && missingVehicleYearColumn(first.error)) return run(VEHICLE_QUEUE_COLUMNS)
  return first
}

/** One vehicle for the signed-in driver. Missing year column is not a failure. */
export async function loadLatestVehicle(sb, driverId) {
  if (!sb || !driverId) return { data: null, error: null }
  const run = (columns) => sb
    .from('vehicles')
    .select(columns)
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const withYear = 'make, model, year, color, plate, seats, service_class, tier'
  const base = 'make, model, color, plate, seats, service_class, tier'
  const first = await run(withYear)
  if (first?.error && missingVehicleYearColumn(first.error)) return run(base)
  return first
}
