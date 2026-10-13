/**
 * Clemson RIDES vehicle standards. ONE config shared by:
 *  - rental partner listings (web form, /api/partners, DB trigger in
 *    supabase/migrations/20261012111402_rental_partner_portal.sql)
 *  - the driver vehicle check (onboarding vehicle step + admin approval).
 * If you change a number here, change the matching constant in the
 * migration trigger (rental_listing_enforce_standards) and the tests.
 */

/** Model year at or above this is auto-eligible, pending inspection. */
export const VEHICLE_STANDARD_MIN_YEAR = 2019

export const BODY_STYLES = [
  { id: 'sedan', label: 'Sedan' },
  { id: 'hatchback', label: 'Hatchback' },
  { id: 'coupe', label: 'Coupe' },
  { id: 'wagon', label: 'Wagon' },
  { id: 'suv_small', label: 'Small SUV / crossover' },
  { id: 'suv_large', label: 'Large SUV' },
  { id: 'minivan', label: 'Minivan' },
  { id: 'van', label: 'Van' },
  { id: 'pickup', label: 'Pickup truck' },
  { id: 'other', label: 'Other' },
]
export const BODY_STYLE_IDS = BODY_STYLES.map((b) => b.id)

export const TITLE_STATUSES = [
  { id: 'clean', label: 'Clean' },
  { id: 'rebuilt', label: 'Rebuilt' },
  { id: 'salvage', label: 'Salvage (not allowed)' },
]
export const TITLE_STATUS_IDS = TITLE_STATUSES.map((t) => t.id)

export const CONDITION_LEVELS = [
  { id: 'excellent', label: 'Excellent' },
  { id: 'good', label: 'Good' },
  { id: 'fair', label: 'Fair' },
  { id: 'poor', label: 'Poor (auto-rejected)' },
]
export const CONDITION_IDS = CONDITION_LEVELS.map((c) => c.id)

/** Condition photos: exterior on all 4 sides plus the interior. */
export const CONDITION_PHOTO_SLOTS = [
  { id: 'front', label: 'Exterior — front' },
  { id: 'back', label: 'Exterior — back' },
  { id: 'left', label: 'Exterior — driver side' },
  { id: 'right', label: 'Exterior — passenger side' },
  { id: 'interior', label: 'Interior' },
]
export const CONDITION_PHOTO_IDS = CONDITION_PHOTO_SLOTS.map((s) => s.id)

export const INSPECTION_KINDS = ['upload', 'attestation']

/** Review outcomes stored on the vehicle/listing. */
export const REVIEW_STATUSES = ['approved', 'pending_admin_review', 'rejected']

/** Plain-language rules shown on the partner sign-up and listing forms. */
export const VEHICLE_RULES_COPY = [
  `Model year ${VEHICLE_STANDARD_MIN_YEAR} or newer is auto-eligible, pending inspection.`,
  `Older than ${VEHICLE_STANDARD_MIN_YEAR}: only as a "Luxury exception". Add photos and a note; the vehicle stays "pending admin review" until an admin approves or rejects it.`,
  'Inspection pass required: upload the inspection report or attest that it passed.',
  'Condition photos required: exterior front, back, driver side, passenger side, and the interior.',
  'Poor condition is rejected regardless of year. A self-reported "poor" condition is auto-rejected, and an admin can reject any vehicle.',
  'Any body style is OK: sedan, small or large SUV, minivan or van, and similar.',
  'Valid (unexpired) registration and insurance. Rebuilt titles are welcome if the vehicle passes inspection; salvage titles are not allowed.',
]

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

export function normalizeVin(v) {
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

function isoDay(now) {
  const d = now instanceof Date ? now : new Date(now)
  return d.toISOString().slice(0, 10)
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

/**
 * Evaluate a vehicle against the standards.
 * @returns {{ errors: Record<string,string>, reviewStatus: 'approved'|'pending_admin_review'|'rejected'|null, reasons: string[] }}
 * reviewStatus is null when there are blocking field errors (nothing to save).
 */
export function evaluateVehicleStandards(v = {}, now = new Date()) {
  const errors = {}
  const reasons = []
  const maxYear = (now instanceof Date ? now : new Date(now)).getUTCFullYear() + 1
  const year = Number(v.year)
  if (!Number.isInteger(year) || year < 1980 || year > maxYear) {
    errors.year = `Enter a model year from 1980 to ${maxYear}.`
  }
  if (!String(v.make || '').trim()) errors.make = 'Make is required.'
  if (!String(v.model || '').trim()) errors.model = 'Model is required.'
  if (!BODY_STYLE_IDS.includes(v.bodyStyle)) errors.bodyStyle = 'Pick a body style.'

  const vin = normalizeVin(v.vin)
  if (!VIN_RE.test(vin)) errors.vin = 'VIN must be 17 characters (letters and digits, no I, O or Q).'

  if (!TITLE_STATUS_IDS.includes(v.titleStatus)) errors.titleStatus = 'Pick the title status.'
  else if (v.titleStatus === 'salvage') errors.titleStatus = 'Salvage titles are not allowed.'

  const mileage = Number(v.mileage)
  if (!Number.isInteger(mileage) || mileage < 0 || mileage > 1_000_000) errors.mileage = 'Enter the odometer mileage.'

  const today = isoDay(now)
  if (!validDate(v.registrationExpires)) errors.registrationExpires = 'Enter the registration expiration date.'
  else if (v.registrationExpires < today) errors.registrationExpires = 'Registration is expired.'
  if (!validDate(v.insuranceExpires)) errors.insuranceExpires = 'Enter the insurance expiration date.'
  else if (v.insuranceExpires < today) errors.insuranceExpires = 'Insurance is expired.'

  if (!INSPECTION_KINDS.includes(v.inspectionKind)) {
    errors.inspection = 'Inspection pass required: upload the report or attest it passed.'
  } else if (v.inspectionKind === 'upload' && !String(v.inspectionDocPath || '').trim()) {
    errors.inspection = 'Upload the inspection report.'
  } else if (v.inspectionKind === 'attestation' && v.inspectionAttested !== true) {
    errors.inspection = 'Check the box to attest the vehicle passed inspection.'
  }

  const photos = v.conditionPhotos && typeof v.conditionPhotos === 'object' ? v.conditionPhotos : {}
  const missing = CONDITION_PHOTO_SLOTS.filter((s) => !String(photos[s.id] || '').trim())
  if (missing.length) errors.conditionPhotos = `Add condition photos: ${missing.map((m) => m.label).join(', ')}.`

  if (!CONDITION_IDS.includes(v.condition)) errors.condition = 'Pick the vehicle condition.'

  const preFloor = Number.isInteger(year) && year < VEHICLE_STANDARD_MIN_YEAR
  if (preFloor && !errors.year) {
    if (v.luxuryException !== true) {
      errors.year = `Vehicles older than ${VEHICLE_STANDARD_MIN_YEAR} can only be listed as a Luxury exception.`
    } else {
      const lp = Array.isArray(v.luxuryPhotos) ? v.luxuryPhotos.filter(Boolean) : []
      if (!lp.length) errors.luxuryPhotos = 'Add at least one photo for the Luxury exception.'
      if (String(v.luxuryNote || '').trim().length < 10) errors.luxuryNote = 'Explain the Luxury exception (at least 10 characters).'
    }
  }

  // Poor condition is a hard reject regardless of year, even if other fields are incomplete.
  if (v.condition === 'poor') {
    reasons.push('Self-reported poor condition is auto-rejected.')
    return { errors, reviewStatus: Object.keys(errors).length ? null : 'rejected', reasons }
  }
  if (Object.keys(errors).length) return { errors, reviewStatus: null, reasons }
  if (preFloor) {
    reasons.push(`Pre-${VEHICLE_STANDARD_MIN_YEAR} Luxury exception: pending admin review.`)
    return { errors, reviewStatus: 'pending_admin_review', reasons }
  }
  reasons.push(`Model year ${VEHICLE_STANDARD_MIN_YEAR}+ with inspection pass: eligible.`)
  return { errors, reviewStatus: 'approved', reasons }
}

/**
 * Driver vehicle check (onboarding). Drivers enter year/make/model only at
 * signup, so this applies the year rule from the same config.
 * Returns null when OK, otherwise a code + message.
 */
export function driverVehicleStandardIssue(vehicle, { luxuryApproved = false } = {}) {
  // Title rule (same as rental listings): clean and rebuilt titles are allowed
  // (rebuilt still has to pass inspection); salvage titles are blocked.
  const titleStatus = String(vehicle?.titleStatus ?? vehicle?.title_status ?? '').trim().toLowerCase()
  if (titleStatus === 'salvage') {
    return { code: 'vehicle_salvage_title', message: 'Salvage titles are not allowed. Rebuilt titles that pass inspection are OK.' }
  }
  if (titleStatus && !TITLE_STATUS_IDS.includes(titleStatus)) {
    return { code: 'vehicle_title_unknown', message: 'Pick the title status: clean or rebuilt.' }
  }
  const year = Number(vehicle?.year)
  if (!Number.isInteger(year)) return { code: 'vehicle_year_missing', message: 'Vehicle year is missing.' }
  if (year >= VEHICLE_STANDARD_MIN_YEAR || luxuryApproved) return null
  return {
    code: 'vehicle_luxury_review',
    message: `Vehicle is older than ${VEHICLE_STANDARD_MIN_YEAR}. It needs a Luxury exception approved by an admin.`,
  }
}
