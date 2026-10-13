import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIVE_TRIP_CHIP_STATUSES,
  LIVE_TRIP_STATUS_CHIP_LABELS,
  liveTripStatusChipLabel,
} from './liveTripStatusChip.js'

test('status chip labels cover the rider live-trip phases', () => {
  assert.deepEqual(LIVE_TRIP_CHIP_STATUSES, [
    'searching',
    'accepted',
    'en_route',
    'arrived',
    'in_progress',
    'completed',
  ])
  assert.equal(Object.isFrozen(LIVE_TRIP_CHIP_STATUSES), true)
  assert.equal(Object.isFrozen(LIVE_TRIP_STATUS_CHIP_LABELS), true)

  assert.equal(liveTripStatusChipLabel('searching'), 'Looking for a driver')
  assert.equal(liveTripStatusChipLabel('accepted'), 'Driver accepted')
  assert.equal(liveTripStatusChipLabel('en_route'), 'En route')
  assert.equal(liveTripStatusChipLabel('arrived'), 'Arrived')
  assert.equal(liveTripStatusChipLabel('in_progress'), 'In trip')
  assert.equal(liveTripStatusChipLabel('completed'), 'Completed')

  for (const status of LIVE_TRIP_CHIP_STATUSES) {
    assert.equal(liveTripStatusChipLabel(status), LIVE_TRIP_STATUS_CHIP_LABELS[status])
    assert.equal(typeof LIVE_TRIP_STATUS_CHIP_LABELS[status], 'string')
    assert.ok(LIVE_TRIP_STATUS_CHIP_LABELS[status].length > 0)
  }
  assert.equal(new Set(Object.values(LIVE_TRIP_STATUS_CHIP_LABELS)).size, LIVE_TRIP_CHIP_STATUSES.length)
})

test('accepted stays distinct from en route, including the stored arriving status', () => {
  assert.notEqual(liveTripStatusChipLabel('accepted'), liveTripStatusChipLabel('en_route'))
  assert.equal(liveTripStatusChipLabel('arriving'), 'En route')
  assert.equal(liveTripStatusChipLabel('arriving'), liveTripStatusChipLabel('en_route'))
  assert.equal(liveTripStatusChipLabel('enroute'), 'En route')
  assert.equal(liveTripStatusChipLabel('offered'), 'Looking for a driver')
  assert.equal(liveTripStatusChipLabel('offered'), liveTripStatusChipLabel('searching'))
})

test('status chip label normalizes case and spacing and hides unknown phases', () => {
  assert.equal(liveTripStatusChipLabel('  ACCEPTED  '), 'Driver accepted')
  assert.equal(liveTripStatusChipLabel('En Route'), 'En route')
  assert.equal(liveTripStatusChipLabel('en-route'), 'En route')
  assert.equal(liveTripStatusChipLabel('IN PROGRESS'), 'In trip')
  assert.equal(liveTripStatusChipLabel('in-progress'), 'In trip')

  assert.equal(liveTripStatusChipLabel(null), null)
  assert.equal(liveTripStatusChipLabel(undefined), null)
  assert.equal(liveTripStatusChipLabel(''), null)
  assert.equal(liveTripStatusChipLabel('   '), null)
  assert.equal(liveTripStatusChipLabel('canceled'), null)
  assert.equal(liveTripStatusChipLabel('requested'), null)
  assert.equal(liveTripStatusChipLabel('scheduled'), null)
  assert.equal(liveTripStatusChipLabel(0), null)
  assert.equal(liveTripStatusChipLabel(false), null)

  const before = liveTripStatusChipLabel('accepted')
  assert.equal(liveTripStatusChipLabel('accepted'), before)
  assert.equal(Object.keys(LIVE_TRIP_STATUS_CHIP_LABELS).length, 6)
})
