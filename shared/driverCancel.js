import { netCentsForShare, poolOfferPatch, POOL_SHARE_BPS } from '../packages/rides-native/offerLadder.js'

export const DRIVER_CANCEL_REASONS = Object.freeze([
  { id: 'rider_unreachable', label: "Can't reach the rider" },
  { id: 'unsafe_pickup', label: 'Pickup feels unsafe' },
  { id: 'vehicle_issue', label: 'Vehicle issue' },
  { id: 'too_far', label: 'Pickup is too far away' },
  { id: 'personal_emergency', label: 'Personal emergency' },
  { id: 'other', label: 'Other' },
])

export const DRIVER_CANCEL_NOTICE = 'The rider is not charged and the trip goes back to other drivers. Frequent cancellations are reviewed.'
export const DRIVER_CANCEL_SUCCESS = "Trip canceled. You're back online."

export function validateDriverCancel(reason, note) {
  if (!DRIVER_CANCEL_REASONS.some((row) => row.id === reason)) return 'Choose a cancellation reason.'
  if (note != null && typeof note !== 'string') return 'The note must be text.'
  if (typeof note === 'string' && note.length > 200) return 'Keep the note to 200 characters.'
  if (reason === 'other' && !note?.trim()) return 'Add a short note for Other.'
  return null
}

/** Dispatch/economics reset for a driver cancel: same open-pool shape as a rider rerequest. Fare and hold are unchanged. */
export function openPoolRerequestPatch(trip, now = new Date().toISOString()) {
  const fare = Math.max(0, Math.round(Number(trip?.fare_cents) || 0))
  const net = netCentsForShare(fare, POOL_SHARE_BPS)
  const raw = trip?.metadata
  const meta = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  const passed = Array.isArray(meta.offer_passed_driver_ids) ? [...meta.offer_passed_driver_ids] : []
  if (trip?.driver_id && !passed.includes(trip.driver_id)) passed.push(trip.driver_id)
  return {
    status: 'searching',
    driver_id: null,
    accepted_at: null,
    driver_earnings_cents: net,
    platform_fee_cents: Math.max(0, fare - net),
    metadata: {
      ...meta,
      ...poolOfferPatch(now),
      offer_driver_id: null,
      preferred_driver_id: null,
      offer_passed_driver_ids: passed,
      match: 'open',
    },
  }
}
