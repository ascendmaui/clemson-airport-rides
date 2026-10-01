/**
 * Canonical cancellation reason copy and normalization.
 * Standardizes cancellation descriptions across rider and driver platforms.
 */

export const PREFERRED_CANCELED_COPY =
  'That driver declined or the request was canceled. It was not offered to another driver.'

/**
 * Canonical dictionary of cancellation reasons.
 */
export const CANCELLATION_REASONS = Object.freeze({
  RIDER_CHANGE_OF_PLANS: Object.freeze({
    code: 'rider_change_of_plans',
    initiator: 'rider',
    shortLabel: 'Change of plans',
    riderHeadline: 'Ride canceled',
    riderExplanation: 'You canceled this ride. No fee applies if canceled within the grace window.',
    driverHeadline: 'Rider canceled',
    driverExplanation: 'The rider canceled this trip due to a change of plans.',
    aliases: Object.freeze(['change_of_plans', 'changed_mind', 'rider_cancel', 'rider_canceled']),
  }),
  RIDER_WAIT_TOO_LONG: Object.freeze({
    code: 'rider_wait_too_long',
    initiator: 'rider',
    shortLabel: 'Driver ETA too long',
    riderHeadline: 'Ride canceled',
    riderExplanation: 'You canceled because the pickup ETA was longer than expected.',
    driverHeadline: 'Rider canceled',
    driverExplanation: 'The rider canceled because the arrival estimate was too long.',
    aliases: Object.freeze(['wait_too_long', 'eta_too_long', 'long_wait']),
  }),
  RIDER_ACCIDENTAL_REQUEST: Object.freeze({
    code: 'rider_accidental_request',
    initiator: 'rider',
    shortLabel: 'Accidental request',
    riderHeadline: 'Ride canceled',
    riderExplanation: 'You canceled this accidental request.',
    driverHeadline: 'Rider canceled',
    driverExplanation: 'The rider canceled an accidental request.',
    aliases: Object.freeze(['accidental_request', 'accidental', 'mistake']),
  }),
  RIDER_FOUND_OTHER_RIDE: Object.freeze({
    code: 'rider_found_other_ride',
    initiator: 'rider',
    shortLabel: 'Found another ride',
    riderHeadline: 'Ride canceled',
    riderExplanation: 'You canceled after finding alternative transportation.',
    driverHeadline: 'Rider canceled',
    driverExplanation: 'The rider found an alternative ride.',
    aliases: Object.freeze(['found_other_ride', 'alternative_ride', 'got_another_ride']),
  }),
  RIDER_CANCEL_MIDRIDE: Object.freeze({
    code: 'rider_cancel_midride',
    initiator: 'rider',
    shortLabel: 'Canceled mid-trip',
    riderHeadline: 'Ride canceled mid-trip',
    riderExplanation: 'Trip was ended early. The charge is prorated for distance and time completed, plus the mid-ride cancellation fee.',
    driverHeadline: 'Trip canceled mid-ride',
    driverExplanation: 'The rider ended the trip early. Your earnings include prorated time and distance plus the cancellation fee share.',
    aliases: Object.freeze(['canceled_midride', 'midride', 'mid_ride', 'midride_cancel']),
  }),
  DRIVER_PREFERRED_DECLINED: Object.freeze({
    code: 'driver_preferred_declined',
    initiator: 'driver',
    shortLabel: 'Preferred driver unavailable',
    riderHeadline: 'Preferred driver unavailable',
    riderExplanation: PREFERRED_CANCELED_COPY,
    driverHeadline: 'Request declined',
    driverExplanation: 'You declined this preferred rider request. It was canceled and not sent to the open pool.',
    aliases: Object.freeze(['preferred_declined', 'preferred_canceled', 'declined_preferred', 'preferred_unavailable']),
  }),
  DRIVER_RIDER_NO_SHOW: Object.freeze({
    code: 'driver_rider_no_show',
    initiator: 'driver',
    shortLabel: 'Rider no-show',
    riderHeadline: 'Driver canceled: Rider no-show',
    riderExplanation: 'The driver canceled after waiting at pickup beyond the grace period. The $5 wait and cancellation fee applies.',
    driverHeadline: 'Rider no-show cancel',
    driverExplanation: 'You canceled after waiting at pickup. The wait and cancellation fee was charged and credited to your earnings.',
    aliases: Object.freeze(['rider_no_show', 'no_show', 'rider_not_here']),
  }),
  DRIVER_PICKUP_UNAVAILABLE: Object.freeze({
    code: 'driver_pickup_unavailable',
    initiator: 'driver',
    shortLabel: 'Pickup spot inaccessible',
    riderHeadline: 'Ride canceled: Pickup inaccessible',
    riderExplanation: 'The driver was unable to safely reach the pickup location.',
    driverHeadline: 'Inaccessible pickup cancel',
    driverExplanation: 'You reported the pickup location as inaccessible or unsafe.',
    aliases: Object.freeze(['pickup_unavailable', 'inaccessible_pickup', 'cannot_reach_pickup']),
  }),
  UNPAID_HOLD_TTL: Object.freeze({
    code: 'unpaid_hold_ttl',
    initiator: 'system',
    shortLabel: 'Airport hold expired',
    riderHeadline: 'Airport hold expired',
    riderExplanation: 'The 25% deposit was not completed before the hold timer ran out. You can schedule again when ready.',
    driverHeadline: 'Unpaid hold expired',
    driverExplanation: 'An open scheduled airport hold expired before the deposit was paid.',
    aliases: Object.freeze(['unpaid_hold_ttl', 'hold_expired', 'ttl', 'checkout_abandoned']),
  }),
  WAIT_TIMEOUT_AUTO: Object.freeze({
    code: 'wait_timeout_auto',
    initiator: 'system',
    shortLabel: 'Pickup wait timeout (7 min)',
    riderHeadline: 'Ride auto-canceled at pickup',
    riderExplanation: 'This ride was automatically canceled after 7 minutes of waiting at pickup. The $5 wait and cancellation fee was processed.',
    driverHeadline: 'Pickup wait auto-cancel',
    driverExplanation: 'The ride automatically canceled after 7 minutes of waiting at pickup. The wait and cancellation fee was charged.',
    aliases: Object.freeze(['auto', 'wait_auto', 'cancelled_wait', 'wait_timeout', 'seven_minute_timeout']),
  }),
  SYSTEM_TIMEOUT_NO_DRIVER: Object.freeze({
    code: 'system_timeout_no_driver',
    initiator: 'system',
    shortLabel: 'No driver available',
    riderHeadline: 'No drivers available',
    riderExplanation: 'No online drivers accepted this ride within the matching window. Please try again shortly.',
    driverHeadline: 'Unclaimed request expired',
    driverExplanation: 'An open ride request expired without being accepted by any driver.',
    aliases: Object.freeze(['no_driver', 'no_match', 'unmatched', 'search_timeout']),
  }),
})

export const CANCELLATION_REASON_CODES = Object.freeze(
  Object.values(CANCELLATION_REASONS).map((r) => r.code)
)

/** User-selectable cancellation options for riders */
export const RIDER_CANCELLATION_OPTIONS = Object.freeze([
  Object.freeze({ id: 'rider_change_of_plans', label: 'Change of plans', description: 'No longer need a ride right now' }),
  Object.freeze({ id: 'rider_wait_too_long', label: 'Driver ETA too long', description: 'Arrival time is longer than expected' }),
  Object.freeze({ id: 'rider_accidental_request', label: 'Accidental request', description: 'Requested this ride by mistake' }),
  Object.freeze({ id: 'rider_found_other_ride', label: 'Found another ride', description: 'Arranged alternative transportation' }),
])

/** User-selectable cancellation options for drivers */
export const DRIVER_CANCELLATION_OPTIONS = Object.freeze([
  Object.freeze({ id: 'driver_rider_no_show', label: 'Rider did not show', description: 'Waited at pickup past the grace window' }),
  Object.freeze({ id: 'driver_pickup_unavailable', label: 'Pickup spot inaccessible', description: 'Road closed, gated, or unsafe to stop' }),
])

/**
 * Normalizes any free-form cancellation reason or code to a canonical reason code.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeCancellationReason(input) {
  if (!input) return null
  const text = String(input).trim().toLowerCase()
  if (!text) return null

  for (const reason of Object.values(CANCELLATION_REASONS)) {
    if (reason.code === text) return reason.code
    if (reason.aliases.includes(text)) return reason.code
  }

  // Regex patterns
  if (/hold.*ttl|ttl|checkout_abandoned|hold.*expired/i.test(text)) return 'unpaid_hold_ttl'
  if (/cancelled_wait|wait_timeout|7.*min|auto/i.test(text)) return 'wait_timeout_auto'
  if (/no.*show/i.test(text)) return 'driver_rider_no_show'
  if (/mid.*ride|midride/i.test(text)) return 'rider_cancel_midride'
  if (/preferred/i.test(text)) return 'driver_preferred_declined'
  if (/plan|mind/i.test(text)) return 'rider_change_of_plans'
  if (/eta|too.*long|long.*wait/i.test(text)) return 'rider_wait_too_long'
  if (/accidental|mistake/i.test(text)) return 'rider_accidental_request'
  if (/other.*ride|alternative/i.test(text)) return 'rider_found_other_ride'
  if (/no.*driver|unmatched/i.test(text)) return 'system_timeout_no_driver'

  return null
}

/**
 * Extracts raw cancellation reason string from a trip row or metadata object.
 * @param {unknown} trip
 * @returns {string | null}
 */
export function extractCancellationReason(trip) {
  if (!trip || typeof trip !== 'object') return null
  const meta = trip.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  return (
    meta.checkout_abandoned?.reason ||
    trip.wait_cancel_reason ||
    meta.cancel_reason ||
    meta.cancellation_reason ||
    (trip.status === 'cancelled_wait' ? 'cancelled_wait' : null) ||
    (trip.status === 'canceled_midride' ? 'canceled_midride' : null) ||
    null
  )
}

/**
 * Resolves role-appropriate cancellation copy given a reason code or trip object.
 * @param {unknown} reasonOrTrip
 * @param {{ role?: 'rider' | 'driver', preferred?: boolean, fallbackHeadline?: string, fallbackExplanation?: string }} [options]
 */
export function getCancellationCopy(
  reasonOrTrip,
  {
    role = 'rider',
    preferred = false,
    fallbackHeadline = 'Ride canceled',
    fallbackExplanation = 'This ride was canceled.',
  } = {}
) {
  let rawReason = typeof reasonOrTrip === 'string' ? reasonOrTrip : extractCancellationReason(reasonOrTrip)
  if (!rawReason && preferred) {
    rawReason = 'preferred_declined'
  }

  const normalizedCode = normalizeCancellationReason(rawReason)
  const canonical = Object.values(CANCELLATION_REASONS).find((r) => r.code === normalizedCode)

  if (!canonical) {
    const isPreferred = Boolean(preferred || /preferred/i.test(String(rawReason || '')))
    return {
      code: 'other',
      initiator: 'unknown',
      shortLabel: 'Canceled',
      headline: isPreferred ? 'Preferred driver unavailable' : (role === 'driver' ? 'Trip canceled' : fallbackHeadline),
      explanation: isPreferred ? PREFERRED_CANCELED_COPY : (role === 'driver' ? 'This trip is canceled.' : fallbackExplanation),
      isPreferredDeclined: isPreferred,
      isHoldExpired: false,
      isAutoWaitCancel: false,
      isMidrideCancel: false,
    }
  }

  const isRider = role === 'rider'
  return {
    code: canonical.code,
    initiator: canonical.initiator,
    shortLabel: canonical.shortLabel,
    headline: isRider ? canonical.riderHeadline : canonical.driverHeadline,
    explanation: isRider ? canonical.riderExplanation : canonical.driverExplanation,
    isPreferredDeclined: canonical.code === 'driver_preferred_declined',
    isHoldExpired: canonical.code === 'unpaid_hold_ttl',
    isAutoWaitCancel: canonical.code === 'wait_timeout_auto',
    isMidrideCancel: canonical.code === 'rider_cancel_midride',
  }
}
