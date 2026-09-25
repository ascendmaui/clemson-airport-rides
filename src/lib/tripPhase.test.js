import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIVE_TRIP_STATUSES,
  MIDRIDE_STATUS,
  isMidrideStatus,
  isTerminalTripStatus,
  isTripSurfaceFrozen,
  isTripSurfaceLive,
  tripStatusLabel,
} from './tripPhase.js'

test('MIDRIDE_STATUS is defined as canceled_midride', () => {
  assert.equal(MIDRIDE_STATUS, 'canceled_midride')
})

test('LIVE_TRIP_STATUSES contains the active driving phases', () => {
  assert.deepEqual(LIVE_TRIP_STATUSES, ['accepted', 'arriving', 'arrived', 'in_progress'])
  assert.equal(LIVE_TRIP_STATUSES.length, 4)
  assert.ok(LIVE_TRIP_STATUSES.includes('accepted'))
  assert.ok(LIVE_TRIP_STATUSES.includes('arriving'))
  assert.ok(LIVE_TRIP_STATUSES.includes('arrived'))
  assert.ok(LIVE_TRIP_STATUSES.includes('in_progress'))

  // Excludes waiting, scheduled, and terminal statuses
  assert.equal(LIVE_TRIP_STATUSES.includes('searching'), false)
  assert.equal(LIVE_TRIP_STATUSES.includes('offered'), false)
  assert.equal(LIVE_TRIP_STATUSES.includes('scheduled'), false)
  assert.equal(LIVE_TRIP_STATUSES.includes('completed'), false)
  assert.equal(LIVE_TRIP_STATUSES.includes('canceled'), false)
  assert.equal(LIVE_TRIP_STATUSES.includes('cancelled_wait'), false)
  assert.equal(LIVE_TRIP_STATUSES.includes('canceled_midride'), false)

  // BUG?: LIVE_TRIP_STATUSES is an unfrozen array exported directly, vulnerable to accidental mutation.
  assert.equal(Object.isFrozen(LIVE_TRIP_STATUSES), false)
})

test('isMidrideStatus identifies canceled_midride only', () => {
  assert.equal(isMidrideStatus('canceled_midride'), true)
  assert.equal(isMidrideStatus(MIDRIDE_STATUS), true)

  // Other terminal statuses
  assert.equal(isMidrideStatus('completed'), false)
  assert.equal(isMidrideStatus('canceled'), false)
  assert.equal(isMidrideStatus('cancelled_wait'), false)

  // Live and pre-trip statuses
  assert.equal(isMidrideStatus('accepted'), false)
  assert.equal(isMidrideStatus('arriving'), false)
  assert.equal(isMidrideStatus('arrived'), false)
  assert.equal(isMidrideStatus('in_progress'), false)
  assert.equal(isMidrideStatus('searching'), false)
  assert.equal(isMidrideStatus('offered'), false)
  assert.equal(isMidrideStatus('scheduled'), false)

  // Alternative spellings and unknown values
  assert.equal(isMidrideStatus('cancelled_midride'), false)
  assert.equal(isMidrideStatus('CANCELED_MIDRIDE'), false)
  assert.equal(isMidrideStatus('unknown'), false)

  // Falsy and non-string inputs
  assert.equal(isMidrideStatus(null), false)
  assert.equal(isMidrideStatus(undefined), false)
  assert.equal(isMidrideStatus(''), false)
  assert.equal(isMidrideStatus(0), false)
  assert.equal(isMidrideStatus(false), false)
  assert.equal(isMidrideStatus(NaN), false)
  assert.equal(isMidrideStatus({}), false)
  assert.equal(isMidrideStatus([]), false)
})

test('isTerminalTripStatus detects all terminal lifecycle states', () => {
  // All valid terminal statuses
  assert.equal(isTerminalTripStatus('completed'), true)
  assert.equal(isTerminalTripStatus('canceled'), true)
  assert.equal(isTerminalTripStatus('cancelled_wait'), true)
  assert.equal(isTerminalTripStatus('canceled_midride'), true)
  assert.equal(isTerminalTripStatus(MIDRIDE_STATUS), true)

  // Active live statuses
  assert.equal(isTerminalTripStatus('accepted'), false)
  assert.equal(isTerminalTripStatus('arriving'), false)
  assert.equal(isTerminalTripStatus('arrived'), false)
  assert.equal(isTerminalTripStatus('in_progress'), false)

  // Pre-trip statuses
  assert.equal(isTerminalTripStatus('searching'), false)
  assert.equal(isTerminalTripStatus('offered'), false)
  assert.equal(isTerminalTripStatus('scheduled'), false)

  // Falsy and unknown inputs
  assert.equal(isTerminalTripStatus(null), false)
  assert.equal(isTerminalTripStatus(undefined), false)
  assert.equal(isTerminalTripStatus(''), false)
  assert.equal(isTerminalTripStatus(0), false)
  assert.equal(isTerminalTripStatus(false), false)
  assert.equal(isTerminalTripStatus(NaN), false)
  assert.equal(isTerminalTripStatus('unknown'), false)
  assert.equal(isTerminalTripStatus('COMPLETED'), false)

  // BUG?: 'cancelled' (British double-l) returns false because only single-l 'canceled' is checked,
  // whereas 'cancelled_wait' uses double-l while 'canceled' and 'canceled_midride' use single-l.
  assert.equal(isTerminalTripStatus('cancelled'), false)
})

test('isTripSurfaceLive returns true only for LIVE_TRIP_STATUSES', () => {
  // All 4 active statuses return true
  assert.equal(isTripSurfaceLive('accepted'), true)
  assert.equal(isTripSurfaceLive('arriving'), true)
  assert.equal(isTripSurfaceLive('arrived'), true)
  assert.equal(isTripSurfaceLive('in_progress'), true)

  // Pre-trip statuses are not yet live surfaces
  assert.equal(isTripSurfaceLive('searching'), false)
  assert.equal(isTripSurfaceLive('offered'), false)
  assert.equal(isTripSurfaceLive('scheduled'), false)

  // Terminal statuses are not live
  assert.equal(isTripSurfaceLive('completed'), false)
  assert.equal(isTripSurfaceLive('canceled'), false)
  assert.equal(isTripSurfaceLive('cancelled_wait'), false)
  assert.equal(isTripSurfaceLive('canceled_midride'), false)

  // Edge cases: null, undefined, blank, non-string
  assert.equal(isTripSurfaceLive(null), false)
  assert.equal(isTripSurfaceLive(undefined), false)
  assert.equal(isTripSurfaceLive(''), false)
  assert.equal(isTripSurfaceLive(0), false)
  assert.equal(isTripSurfaceLive(false), false)
  assert.equal(isTripSurfaceLive(NaN), false)
  assert.equal(isTripSurfaceLive('ACCEPTED'), false)
  assert.equal(isTripSurfaceLive('accepted '), false)
})

test('isTripSurfaceFrozen returns true for terminal or falsy status', () => {
  // Terminal statuses are frozen
  assert.equal(isTripSurfaceFrozen('completed'), true)
  assert.equal(isTripSurfaceFrozen('canceled'), true)
  assert.equal(isTripSurfaceFrozen('cancelled_wait'), true)
  assert.equal(isTripSurfaceFrozen('canceled_midride'), true)

  // Falsy statuses are frozen (!status)
  assert.equal(isTripSurfaceFrozen(null), true)
  assert.equal(isTripSurfaceFrozen(undefined), true)
  assert.equal(isTripSurfaceFrozen(''), true)

  // Live statuses are NOT frozen
  assert.equal(isTripSurfaceFrozen('accepted'), false)
  assert.equal(isTripSurfaceFrozen('arriving'), false)
  assert.equal(isTripSurfaceFrozen('arrived'), false)
  assert.equal(isTripSurfaceFrozen('in_progress'), false)

  // Pre-trip statuses are NOT frozen
  assert.equal(isTripSurfaceFrozen('searching'), false)
  assert.equal(isTripSurfaceFrozen('offered'), false)
  assert.equal(isTripSurfaceFrozen('scheduled'), false)

  // Unknown truthy status is NOT frozen
  assert.equal(isTripSurfaceFrozen('unknown'), false)
  assert.equal(isTripSurfaceFrozen('pending'), false)

  // BUG?: Falsy non-terminal inputs like 0 and false evaluate to frozen due to !status check.
  assert.equal(isTripSurfaceFrozen(0), true)
  assert.equal(isTripSurfaceFrozen(false), true)
  assert.equal(isTripSurfaceFrozen(NaN), true)
})

test('tripStatusLabel provides human labels for all known trip statuses', () => {
  // Pre-trip
  assert.equal(tripStatusLabel('searching'), 'Looking for a driver')
  assert.equal(tripStatusLabel('offered'), 'Looking for a driver')
  assert.equal(tripStatusLabel('scheduled'), 'Scheduled')

  // Live / in-flight
  assert.equal(tripStatusLabel('accepted'), 'Driver accepted')
  assert.equal(tripStatusLabel('arriving'), 'Driver arriving')
  assert.equal(tripStatusLabel('arrived'), 'Arrived at pickup')
  assert.equal(tripStatusLabel('in_progress'), 'Trip in progress')

  // Terminal
  assert.equal(tripStatusLabel('completed'), 'Trip completed')
  assert.equal(tripStatusLabel('canceled'), 'Trip canceled')
  assert.equal(tripStatusLabel('cancelled_wait'), 'Canceled at pickup')
  assert.equal(tripStatusLabel('canceled_midride'), 'Canceled during the trip')

  // Falsy inputs fall back to 'Trip update'
  assert.equal(tripStatusLabel(null), 'Trip update')
  assert.equal(tripStatusLabel(undefined), 'Trip update')
  assert.equal(tripStatusLabel(''), 'Trip update')
  assert.equal(tripStatusLabel(0), 'Trip update')
  assert.equal(tripStatusLabel(false), 'Trip update')
  assert.equal(tripStatusLabel(NaN), 'Trip update')

  // Truthy unknown status echoes string representation
  assert.equal(tripStatusLabel('driver_assigned'), 'driver_assigned')
  assert.equal(tripStatusLabel('custom_event'), 'custom_event')
  assert.equal(tripStatusLabel('cancelled'), 'cancelled')
  assert.equal(tripStatusLabel(123), '123')

  // BUG?: Unknown truthy statuses echo raw string directly without user-friendly fallback or title casing.
  assert.equal(tripStatusLabel('unexpected_phase'), 'unexpected_phase')
})
