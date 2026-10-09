/**
 * Driver-side "Ride canceled" state: what to say and how to get back to offers
 * when the rider cancels, switches away, ends early, or no-shows.
 */

export const CANCELED_STATUSES = Object.freeze(['canceled', 'canceled_midride', 'cancelled_wait'])

/**
 * A trip the driver held that is no longer readable (rider switched driver or ride type)
 * becomes a local "released" card so the screen can explain it instead of going blank.
 */
export function releasedTripCard(previous) {
  if (!previous?.id) return null
  return { ...previous, status: 'canceled', released: true }
}

/** Next card for a refresh: a vanished trip the driver was on becomes released. */
export function nextDriverTripCard(previous, row) {
  if (row) return row
  if (previous && !CANCELED_STATUSES.includes(previous.status) && previous.status !== 'completed') {
    return releasedTripCard(previous)
  }
  return previous && previous.released ? previous : null
}

export function driverCanceledView(card) {
  if (!card) return null
  const first = String(card.firstName || '').trim() || 'The rider'
  if (card.released) {
    return {
      title: 'Ride canceled',
      body: `${first} changed or canceled this ride. You're free for the next offer.`,
      action: 'Back to queue',
      announcement: 'Ride canceled by the rider',
    }
  }
  switch (card.status) {
    case 'canceled':
      return {
        title: 'Ride canceled',
        body: `${first} canceled this ride. You're free for the next offer.`,
        action: 'Back to queue',
        announcement: 'Ride canceled by the rider',
      }
    case 'canceled_midride':
      return {
        title: 'Trip ended early',
        body: `${first} ended the trip early. Any pay from this trip shows in Earnings.`,
        action: 'Back to queue',
        announcement: 'The rider ended the trip early',
      }
    case 'cancelled_wait':
      return {
        title: 'Rider no-show',
        body: 'The ride was canceled after the wait. Your wait pay is below.',
        action: 'Back to queue',
        announcement: 'Rider no-show. The ride is canceled.',
      }
    default:
      return null
  }
}

/** Shown when a trip opened from a push is no longer on this driver's account. */
export const MISSING_TRIP_VIEW = Object.freeze({
  title: 'Ride no longer available',
  body: 'This ride is not on your account anymore. The rider may have changed or canceled it.',
  action: 'Back to queue',
})
