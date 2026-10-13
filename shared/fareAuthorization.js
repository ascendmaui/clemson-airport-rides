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

export function fareAuthorizationCents(estimatedFareCents) {
  const estimated = Math.max(0, Math.round(Number(estimatedFareCents) || 0))
  if (estimated <= 0) {
    return { estimatedFareCents: 0, bufferCents: 0, authorizationCents: 0 }
  }
  const percent = Math.round((estimated * FARE_AUTH_BUFFER_BPS) / 10000)
  const bufferCents = Math.max(FARE_AUTH_BUFFER_MIN_CENTS, percent)
  return {
    estimatedFareCents: estimated,
    bufferCents,
    authorizationCents: estimated + bufferCents,
  }
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
