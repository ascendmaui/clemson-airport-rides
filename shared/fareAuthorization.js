/**
 * Uber/Lyft-style fare authorization.
 * At ride request the card is authorized for the estimated fare plus a buffer.
 * Trip end captures the final fare (partial capture when the fare is inside
 * the hold). The 25% airport deposit is not part of this calculation.
 */

/** 20% of the estimate, matching a typical ride-hail authorization buffer. */
export const FARE_AUTH_BUFFER_BPS = 2000

/** Short trips still get a $2 buffer so small fare movement fits in the hold. */
export const FARE_AUTH_BUFFER_MIN_CENTS = 200

/**
 * Card hold for an estimated fare.
 * Other ride types add the authorization buffer.
 * A Carpool hold passes bufferBps 0 so the hold equals the quoted seat fare.
 */
export function fareAuthorizationCents(estimatedFareCents, options = {}) {
  const estimated = Math.max(0, Math.round(Number(estimatedFareCents) || 0))
  if (estimated <= 0) {
    return { estimatedFareCents: 0, bufferCents: 0, authorizationCents: 0 }
  }
  const requested = options?.bufferBps
  const bufferBps = requested == null || requested === ''
    ? FARE_AUTH_BUFFER_BPS
    : Math.max(0, Math.round(Number(requested) || 0))
  if (bufferBps <= 0) {
    return { estimatedFareCents: estimated, bufferCents: 0, authorizationCents: estimated }
  }
  const percent = Math.round((estimated * bufferBps) / 10000)
  const bufferCents = Math.max(FARE_AUTH_BUFFER_MIN_CENTS, percent)
  return {
    estimatedFareCents: estimated,
    bufferCents,
    authorizationCents: estimated + bufferCents,
  }
}

/** True when this trip's card hold should equal the quoted Carpool fare. */
export function isCarpoolFareHold(trip) {
  const tier = String(trip?.tier || trip?.metadata?.ride_option || '').trim().toLowerCase()
  return tier === 'carpool'
}

/**
 * How to turn an uncaptured authorization into the final fare.
 * A final fare inside the hold is a partial capture. Above the hold, the
 * authorization is incremented when the card allows it, otherwise the hold
 * is captured and the overage is a second charge.
 */
export function capturePlan({ authorizationCents, finalFareCents, minimumChargeCents = 50 } = {}) {
  const authorized = Math.max(0, Math.round(Number(authorizationCents) || 0))
  const finalFare = Math.max(0, Math.round(Number(finalFareCents) || 0))
  const minimum = Math.max(0, Math.round(Number(minimumChargeCents) || 0))
  if (finalFare <= 0) {
    return { action: 'cancel', captureCents: 0, overageCents: 0, releaseCents: authorized }
  }
  if (minimum > 0 && finalFare < minimum) {
    return { action: 'waive', captureCents: 0, overageCents: 0, releaseCents: authorized }
  }
  if (finalFare <= authorized) {
    return {
      action: 'capture',
      captureCents: finalFare,
      overageCents: 0,
      releaseCents: authorized - finalFare,
    }
  }
  return {
    action: 'increment',
    captureCents: authorized,
    overageCents: finalFare - authorized,
    releaseCents: 0,
  }
}

/** Same-card retry is for a soft decline, not a missing or expired card. */
export function shouldRetryAuthorization(code) {
  return code === 'card_declined' || code === 'insufficient_funds' || code === 'charge_failed'
}
