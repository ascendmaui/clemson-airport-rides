import test from 'node:test'
import assert from 'node:assert/strict'
import { VEHICLE_STANDARD_MIN_YEAR, evaluateVehicleStandards, driverVehicleStandardIssue, VEHICLE_RULES_COPY } from '../shared/vehicleStandards.js'
import { evaluateListing, partnerSignupErrors, driverRentalEligible, filterListings } from '../shared/rentalPartner.js'
import { applyTransition, canTransition, nextStatuses, contactVisible } from '../shared/rentalStateMachine.js'

const now = new Date('2026-10-12T12:00:00Z')
const base = {
  make: 'Honda', model: 'CR-V', year: 2019, bodyStyle: 'suv_small', vin: '1hgcm82633a004352', titleStatus: 'clean', mileage: 52000,
  registrationExpires: '2027-05-01', insuranceExpires: '2027-02-01', inspectionKind: 'attestation', inspectionAttested: true,
  conditionPhotos: { front: 'a', back: 'b', left: 'c', right: 'd', interior: 'e' }, condition: 'good',
}
const listing = { ...base, seats: 5, weeklyPrice: '250', deposit: '300', mileageLimit: '1000', minDriverAge: 21, availableFrom: '2026-10-15', pickupLocation: 'Clemson, SC', photos: ['p.jpg'] }

test('model-year floor is 2019: 2019 auto-eligible, 2018 needs luxury exception', () => {
  assert.equal(VEHICLE_STANDARD_MIN_YEAR, 2019)
  assert.equal(evaluateVehicleStandards(base, now).reviewStatus, 'approved')
  const old = evaluateVehicleStandards({ ...base, year: 2018 }, now)
  assert.equal(old.reviewStatus, null)
  assert.match(old.errors.year, /Luxury exception/)
  const lux = evaluateVehicleStandards({ ...base, year: 2018, luxuryException: true, luxuryNote: 'Mercedes S-Class, pristine', luxuryPhotos: ['x'] }, now)
  assert.equal(lux.reviewStatus, 'pending_admin_review')
  const luxMissing = evaluateVehicleStandards({ ...base, year: 2018, luxuryException: true }, now)
  assert.ok(luxMissing.errors.luxuryPhotos && luxMissing.errors.luxuryNote)
  assert.ok(VEHICLE_RULES_COPY[0].includes('2019'))
})

test('poor condition auto-rejects regardless of year; salvage, expired docs and missing inspection/photos block', () => {
  assert.equal(evaluateVehicleStandards({ ...base, year: 2026, condition: 'poor' }, now).reviewStatus, 'rejected')
  assert.match(evaluateVehicleStandards({ ...base, titleStatus: 'salvage' }, now).errors.titleStatus, /Salvage/)
  assert.equal(evaluateVehicleStandards({ ...base, titleStatus: 'rebuilt' }, now).reviewStatus, 'approved')
  assert.match(evaluateVehicleStandards({ ...base, registrationExpires: '2026-10-01' }, now).errors.registrationExpires, /expired/)
  assert.match(evaluateVehicleStandards({ ...base, insuranceExpires: '2026-10-11' }, now).errors.insuranceExpires, /expired/)
  assert.ok(evaluateVehicleStandards({ ...base, inspectionKind: undefined }, now).errors.inspection)
  assert.ok(evaluateVehicleStandards({ ...base, inspectionKind: 'upload' }, now).errors.inspection)
  assert.ok(evaluateVehicleStandards({ ...base, inspectionAttested: false }, now).errors.inspection)
  assert.match(evaluateVehicleStandards({ ...base, conditionPhotos: { front: 'a' } }, now).errors.conditionPhotos, /Interior/)
  assert.ok(evaluateVehicleStandards({ ...base, vin: 'ABC' }, now).errors.vin)
  assert.ok(evaluateVehicleStandards({ ...base, vin: '1HGCM82633A00435O' }, now).errors.vin)
  for (const b of ['sedan', 'suv_large', 'minivan', 'van']) assert.equal(evaluateVehicleStandards({ ...base, bodyStyle: b }, now).reviewStatus, 'approved')
})

test('driver vehicle check uses the same floor', () => {
  assert.equal(driverVehicleStandardIssue({ year: 2019 }), null)
  assert.equal(driverVehicleStandardIssue({ year: 2018 }).code, 'vehicle_luxury_review')
  assert.equal(driverVehicleStandardIssue({ year: 2018 }, { luxuryApproved: true }), null)
})

test('listing and sign-up validation', () => {
  const ok = evaluateListing(listing, now)
  assert.deepEqual(ok.errors, {})
  assert.deepEqual(ok.cents, { weekly: 25000, deposit: 30000 })
  const bad = evaluateListing({ ...listing, seats: 1, weeklyPrice: '5', minDriverAge: 16, photos: [], pickupLocation: '' }, now)
  assert.ok(bad.errors.seats && bad.errors.weeklyPrice && bad.errors.minDriverAge && bad.errors.photos && bad.errors.pickupLocation)
  const e = partnerSignupErrors({ businessName: 'A', phone: '123', email: 'nope' })
  assert.ok(e.businessName && e.phone && e.email && e.agreeTerms && e.city && e.serviceArea)
  assert.deepEqual(partnerSignupErrors({ businessName: 'Tiger Rentals', contactName: 'Pat', phone: '864-555-0100', email: 'p@t.co', city: 'Clemson', serviceArea: 'Upstate SC', agreeTerms: true }), {})
})

test('driver eligibility requires approved onboarding and passed background', () => {
  assert.equal(driverRentalEligible({ onboarding_status: 'approved', background_check_status: 'authorized' }), true)
  assert.equal(driverRentalEligible({ onboarding_status: 'approved', background_check_status: 'needs_review' }), false)
  assert.equal(driverRentalEligible({ onboarding_status: 'approved', background_check_status: 'needs_review', background_admin_reviewed_at: 'x' }), true)
  assert.equal(driverRentalEligible({ onboarding_status: 'pending_review', background_check_status: 'authorized' }), false)
  assert.equal(driverRentalEligible(null), false)
  const rows = [{ weekly_price_cents: 20000, insurance_included: true, seats: 5 }, { weekly_price_cents: 40000, insurance_included: false, seats: 7 }]
  assert.equal(filterListings(rows, { maxWeekly: 300 }).length, 1)
  assert.equal(filterListings(rows, { insurance: true }).length, 1)
  assert.equal(filterListings(rows, { minSeats: 6 }).length, 1)
})

test('rental state machine', () => {
  assert.ok(canTransition('requested', 'accepted', 'partner'))
  assert.ok(!canTransition('requested', 'accepted', 'driver'))
  assert.ok(canTransition('requested', 'canceled', 'driver'))
  assert.ok(!canTransition('declined', 'accepted', 'partner'))
  assert.ok(!canTransition('ended', 'active', 'admin'))
  assert.deepEqual(nextStatuses('requested', 'partner'), ['accepted', 'declined'])
  const p = applyTransition({ status: 'accepted' }, 'active', 'partner', { startDate: '2026-11-01', now })
  assert.equal(p.start_date, '2026-11-01')
  assert.throws(() => applyTransition({ status: 'active', start_date: '2026-11-01' }, 'ended', 'driver', { endDate: '2026-10-01', now }), /before start/)
  assert.equal(applyTransition({ status: 'active', start_date: '2026-10-01' }, 'ended', 'driver', { now }).end_date, '2026-10-12')
  assert.throws(() => applyTransition({ status: 'requested' }, 'active', 'partner', { now }), /Cannot move/)
  assert.equal(contactVisible('requested'), false)
  assert.equal(contactVisible('accepted'), true)
})

test('driver own-vehicle check allows rebuilt titles and blocks salvage', () => {
  assert.equal(driverVehicleStandardIssue({ year: 2020, titleStatus: 'rebuilt' }), null)
  assert.equal(driverVehicleStandardIssue({ year: 2020, title_status: 'rebuilt' }), null)
  assert.equal(driverVehicleStandardIssue({ year: 2020, titleStatus: 'clean' }), null)
  assert.equal(driverVehicleStandardIssue({ year: 2020, titleStatus: 'salvage' }).code, 'vehicle_salvage_title')
  assert.equal(driverVehicleStandardIssue({ year: 2020, title_status: 'Salvage' }).code, 'vehicle_salvage_title')
  assert.equal(driverVehicleStandardIssue({ year: 2018, titleStatus: 'salvage' }, { luxuryApproved: true }).code, 'vehicle_salvage_title')
  assert.equal(driverVehicleStandardIssue({ year: 2020, titleStatus: 'flood' }).code, 'vehicle_title_unknown')
  assert.equal(driverVehicleStandardIssue({ year: 2018, titleStatus: 'rebuilt' }).code, 'vehicle_luxury_review')
})
