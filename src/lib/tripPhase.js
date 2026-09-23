/** Shared trip-phase helpers for map, queue, tracking, and chat freeze. */

export const MIDRIDE_STATUS = 'canceled_midride'

export const LIVE_TRIP_STATUSES = ['accepted', 'arriving', 'arrived', 'in_progress']

export function isMidrideStatus(status) {
  return status === MIDRIDE_STATUS
}

export function isTerminalTripStatus(status) {
  return status === 'completed'
    || status === 'canceled'
    || status === 'cancelled_wait'
    || status === MIDRIDE_STATUS
}

/** Map, live share, queue assignment, and the chat composer stay interactive. */
export function isTripSurfaceLive(status) {
  return LIVE_TRIP_STATUSES.includes(status)
}

/** Composer, tracking, and share controls lock once the trip has ended. */
export function isTripSurfaceFrozen(status) {
  return isTerminalTripStatus(status) || !status
}

export function tripStatusLabel(status) {
  switch (status) {
    case 'searching':
    case 'offered':
      return 'Looking for a driver'
    case 'accepted':
      return 'Driver accepted'
    case 'arriving':
      return 'Driver arriving'
    case 'arrived':
      return 'Arrived at pickup'
    case 'in_progress':
      return 'Trip in progress'
    case 'completed':
      return 'Trip completed'
    case 'canceled':
      return 'Trip canceled'
    case 'cancelled_wait':
      return 'Canceled at pickup'
    case 'canceled_midride':
      return 'Canceled during the trip'
    case 'scheduled':
      return 'Scheduled'
    default: {
      const _exhaustive = status
      return _exhaustive ? String(_exhaustive) : 'Trip update'
    }
  }
}
