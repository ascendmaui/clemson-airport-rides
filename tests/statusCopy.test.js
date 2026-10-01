import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANONICAL_TRIP_STATUSES,
  normalizeTripStatus,
  RIDE_STATUS_LABELS,
  RIDER_STATUS_TITLES,
  DRIVER_STATUS_HEADLINES,
  RIDE_STATUS_BADGE_TONES,
  getRideStatusLabel,
  getRideStatusBadgeTone,
  getDriverStatusHeadline,
  getRiderStatusTitle,
} from '../packages/rides-native/statusCopy.js'
import { statusHeadline, driverStatusDetail } from '../packages/rides-native/tripTags.js'
import { riderLiveCopy } from '../packages/rides-native/liveTrip.js'

test('CANONICAL_TRIP_STATUSES includes all 12 trip lifecycle states', () => {
  const expected = [
    'searching',
    'offered',
    'requested',
    'scheduled',
    'accepted',
    'arriving',
    'arrived',
    'in_progress',
    'completed',
    'canceled',
    'cancelled_wait',
    'canceled_midride',
  ]
  assert.deepEqual([...CANONICAL_TRIP_STATUSES], expected)
  assert.ok(Object.isFrozen(CANONICAL_TRIP_STATUSES))
})

test('normalizeTripStatus handles case, whitespace, hyphens and spelling variants', () => {
  assert.equal(normalizeTripStatus('SEARCHING'), 'searching')
  assert.equal(normalizeTripStatus('  in-progress  '), 'in_progress')
  assert.equal(normalizeTripStatus('in_trip'), 'in_progress')
  assert.equal(normalizeTripStatus('underway'), 'in_progress')
  assert.equal(normalizeTripStatus('enroute'), 'arriving')
  assert.equal(normalizeTripStatus('en_route'), 'arriving')
  assert.equal(normalizeTripStatus('cancelled'), 'canceled')
  assert.equal(normalizeTripStatus('cancelled_midride'), 'canceled_midride')
  assert.equal(normalizeTripStatus('canceled_wait'), 'cancelled_wait')

  // Falsy or non-string inputs
  assert.equal(normalizeTripStatus(null), '')
  assert.equal(normalizeTripStatus(undefined), '')
  assert.equal(normalizeTripStatus(''), '')
  assert.equal(normalizeTripStatus(123), '')
})

test('RIDE_STATUS_LABELS provides consistent human copy for all canonical statuses', () => {
  for (const st of CANONICAL_TRIP_STATUSES) {
    assert.ok(RIDE_STATUS_LABELS[st], `Missing label for ${st}`)
    assert.ok(!RIDE_STATUS_LABELS[st].includes('_'), `Label for ${st} should not contain underscores`)
  }
  assert.equal(RIDE_STATUS_LABELS.searching, 'Looking for a driver')
  assert.equal(RIDE_STATUS_LABELS.accepted, 'Driver accepted')
  assert.equal(RIDE_STATUS_LABELS.arriving, 'Driver arriving')
  assert.equal(RIDE_STATUS_LABELS.in_progress, 'Trip in progress')
  assert.equal(RIDE_STATUS_LABELS.completed, 'Trip completed')
  assert.equal(RIDE_STATUS_LABELS.canceled_midride, 'Canceled during the trip')
})

test('getRideStatusLabel resolves normalized and aliased statuses with fallback', () => {
  assert.equal(getRideStatusLabel('cancelled'), 'Trip canceled')
  assert.equal(getRideStatusLabel('in-progress'), 'Trip in progress')
  assert.equal(getRideStatusLabel('en_route'), 'Driver arriving')
  assert.equal(getRideStatusLabel(null), 'Trip update')
  assert.equal(getRideStatusLabel('', { fallback: 'Pending' }), 'Pending')
})

test('getRideStatusBadgeTone returns consistent design tokens', () => {
  assert.equal(getRideStatusBadgeTone('searching'), 'orange')
  assert.equal(getRideStatusBadgeTone('accepted'), 'purple')
  assert.equal(getRideStatusBadgeTone('completed'), 'green')
  assert.equal(getRideStatusBadgeTone('canceled'), 'danger')
  assert.equal(getRideStatusBadgeTone('canceled_midride'), 'danger')
  assert.equal(getRideStatusBadgeTone('unknown_status'), 'neutral')
})

test('getDriverStatusHeadline formats driver card headlines including canceled_midride', () => {
  assert.equal(getDriverStatusHeadline('searching'), 'New ride request')
  assert.equal(getDriverStatusHeadline('requested'), 'A rider preferred you')
  assert.equal(getDriverStatusHeadline('accepted'), 'Head to pickup')
  assert.equal(getDriverStatusHeadline('canceled_midride'), 'Canceled mid-trip')
  assert.equal(getDriverStatusHeadline('completed'), 'Completed')
})

test('getRiderStatusTitle formats rider headers and honors preferred driver', () => {
  assert.equal(getRiderStatusTitle('searching'), 'Looking for a driver')
  assert.equal(getRiderStatusTitle('requested', { preferred: true }), 'Waiting on your driver')
  assert.equal(getRiderStatusTitle('requested', { preferred: false }), 'Request sent')
  assert.equal(getRiderStatusTitle('accepted'), 'Your driver is on the way')
  assert.equal(getRiderStatusTitle('canceled_midride'), 'Ride canceled mid-trip')
})

test('tripTags statusHeadline and driverStatusDetail support canceled_midride', () => {
  assert.equal(statusHeadline('canceled_midride'), 'Canceled mid-trip')
  assert.match(driverStatusDetail('canceled_midride'), /canceled mid-ride/i)
})

test('riderLiveCopy handles canceled_midride with honest copy', () => {
  const copy = riderLiveCopy('canceled_midride')
  assert.equal(copy.kicker, 'CANCELED')
  assert.equal(copy.title, 'Ride canceled mid-trip')
  assert.match(copy.body, /ended early/i)
})
