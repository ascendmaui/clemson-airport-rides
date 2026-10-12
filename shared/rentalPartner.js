/** Rental Partner portal: shared validation used by the web forms and /api/partners. */
import { evaluateVehicleStandards } from './vehicleStandards.js'

export const PARTNER_TERMS_VERSION = 'partner-terms-draft-2026-10-12'
export const PARTNER_STATUSES = ['pending', 'approved', 'rejected', 'suspended']
export const LISTING_STATUSES = ['active', 'paused']
export const OFF_PLATFORM_PAYMENT_NOTE =
  'Clemson RIDES does not handle payments between rental partners and drivers in v1. Rent, deposits and any fees are arranged and paid directly between you, off-platform.'

export const PARTNER_TERMS_DRAFT = [
  'DRAFT, NEEDS LEGAL REVIEW. These placeholder terms are not final and are not legal advice.',
  'You confirm you are authorized to rent the vehicles you list and that each listing is accurate.',
  'You keep every listed vehicle registered, insured and roadworthy, and meet the Clemson RIDES vehicle standards.',
  'Clemson RIDES only introduces you to drivers. Rental agreements, payments and deposits are between you and the driver, off-platform.',
  'You will only use driver contact details to arrange the rental you accepted.',
  'Clemson RIDES may pause or remove listings or partner accounts at any time.',
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function partnerSignupErrors(f = {}) {
  const e = {}
  if (String(f.businessName || '').trim().length < 2) e.businessName = 'Business name is required.'
  if (String(f.contactName || '').trim().length < 2) e.contactName = 'Contact name is required.'
  if (String(f.phone || '').replace(/\D/g, '').length < 10) e.phone = 'Phone must have at least 10 digits.'
  if (!EMAIL_RE.test(String(f.email || '').trim())) e.email = 'Enter a valid email.'
  if (!String(f.city || '').trim()) e.city = 'City is required.'
  if (!String(f.serviceArea || '').trim()) e.serviceArea = 'Service area is required.'
  if (f.agreeTerms !== true) e.agreeTerms = 'You must agree to the partner terms.'
  return e
}

function money(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

/** Full listing check: vehicle standards + rental terms. */
export function evaluateListing(f = {}, now = new Date()) {
  const std = evaluateVehicleStandards(f, now)
  const errors = { ...std.errors }
  const seats = Number(f.seats)
  if (!Number.isInteger(seats) || seats < 2 || seats > 15) errors.seats = 'Seats must be 2 to 15 (including the driver).'
  const weekly = money(f.weeklyPrice)
  if (weekly == null || weekly < 1000) errors.weeklyPrice = 'Weekly price must be at least $10.'
  const deposit = money(f.deposit)
  if (deposit == null) errors.deposit = 'Enter a deposit (0 if none).'
  if (f.mileageLimit !== '' && f.mileageLimit != null) {
    const ml = Number(f.mileageLimit)
    if (!Number.isInteger(ml) || ml < 0) errors.mileageLimit = 'Weekly mileage limit must be a whole number (blank = unlimited).'
  }
  const age = Number(f.minDriverAge)
  if (!Number.isInteger(age) || age < 18 || age > 30) errors.minDriverAge = 'Minimum driver age must be 18 to 30.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.availableFrom || ''))) errors.availableFrom = 'Enter the first available date.'
  if (f.availableUntil && f.availableFrom && f.availableUntil < f.availableFrom) errors.availableUntil = 'Available-until must be after available-from.'
  if (String(f.pickupLocation || '').trim().length < 3) errors.pickupLocation = 'Pickup location is required.'
  const photos = Array.isArray(f.photos) ? f.photos.filter(Boolean) : []
  if (!photos.length) errors.photos = 'Add at least one listing photo.'
  const ok = Object.keys(errors).length === 0
  return {
    errors,
    reviewStatus: ok || std.reviewStatus === 'rejected' ? std.reviewStatus : null,
    reasons: std.reasons,
    cents: { weekly, deposit },
  }
}

/** Snake_case DB row from validated form fields. */
export function listingRow(f, partnerId, reviewStatus, cents) {
  return {
    partner_id: partnerId,
    make: String(f.make).trim(),
    model: String(f.model).trim(),
    year: Number(f.year),
    body_style: f.bodyStyle,
    seats: Number(f.seats),
    vin: String(f.vin).trim().toUpperCase().replace(/\s+/g, ''),
    title_status: f.titleStatus,
    mileage: Number(f.mileage),
    photos: (f.photos || []).filter(Boolean),
    condition: f.condition,
    condition_photos: f.conditionPhotos || {},
    inspection_kind: f.inspectionKind,
    inspection_doc_path: f.inspectionDocPath || null,
    inspection_attested: f.inspectionKind === 'attestation' && f.inspectionAttested === true,
    registration_expires: f.registrationExpires,
    insurance_expires: f.insuranceExpires,
    weekly_price_cents: cents.weekly,
    deposit_cents: cents.deposit,
    mileage_limit_weekly: f.mileageLimit === '' || f.mileageLimit == null ? null : Number(f.mileageLimit),
    insurance_included: Boolean(f.insuranceIncluded),
    maintenance_included: Boolean(f.maintenanceIncluded),
    basics_included: Boolean(f.basicsIncluded),
    min_driver_age: Number(f.minDriverAge),
    available_from: f.availableFrom,
    available_until: f.availableUntil || null,
    pickup_location: String(f.pickupLocation).trim(),
    luxury_exception: Boolean(f.luxuryException),
    luxury_note: f.luxuryException ? String(f.luxuryNote || '').trim() : null,
    luxury_photos: f.luxuryException ? (f.luxuryPhotos || []).filter(Boolean) : [],
    review_status: reviewStatus,
  }
}

/**
 * Driver may browse rentals only when onboarding is approved (license
 * reviewed) and the background attestation passed (authorized, or
 * needs_review that an admin acknowledged).
 */
export function driverRentalEligible(app) {
  if (!app || app.onboarding_status !== 'approved') return false
  const bg = app.background_check_status
  if (bg === 'authorized') return true
  return bg === 'needs_review' && Boolean(app.background_admin_reviewed_at)
}

/** Driver-side filter for browse. */
export function filterListings(rows, { maxWeekly, insurance, maintenance, basics, minSeats } = {}) {
  return (rows || []).filter((r) => {
    if (maxWeekly && r.weekly_price_cents > Number(maxWeekly) * 100) return false
    if (insurance && !r.insurance_included) return false
    if (maintenance && !r.maintenance_included) return false
    if (basics && !r.basics_included) return false
    if (minSeats && r.seats < Number(minSeats)) return false
    return true
  })
}
