import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultDriverRank,
  dispatchRankOf,
  offerVisibleToDriver,
  sortByDefaultDriverOrder,
} from './driverOrder.js'

test('default driver rank is John, then Kim, then everyone else', () => {
  assert.equal(defaultDriverRank('johnmatveyev@gmail.com'), 0)
  assert.equal(defaultDriverRank(' JohnMatveyev@gmail.com '), 0)
  assert.equal(defaultDriverRank('kimubermaui@gmail.com'), 1)
  assert.equal(defaultDriverRank('other@clemson.edu'), 2)
  assert.equal(defaultDriverRank(''), 2)
  const sorted = sortByDefaultDriverOrder([
    { id: 'c', email: 'other@clemson.edu' },
    { id: 'b', email: 'kimubermaui@gmail.com' },
    { id: 'a', email: 'johnmatveyev@gmail.com' },
  ])
  assert.deepEqual(sorted.map((row) => row.id), ['a', 'b', 'c'])
  assert.equal(dispatchRankOf({ dispatchRank: 0, email: 'other@clemson.edu' }), 0)
})

test('offerVisibleToDriver shows a targeted offer only to that driver', () => {
  const trip = {
    rider_id: 'rider',
    driver_id: null,
    metadata: { offer_driver_id: 'john' },
  }
  assert.equal(offerVisibleToDriver(trip, 'john'), true)
  assert.equal(offerVisibleToDriver(trip, 'kim'), false)
  assert.equal(offerVisibleToDriver({ ...trip, rider_id: 'john' }, 'john'), false)
  assert.equal(offerVisibleToDriver({ rider_id: 'rider', driver_id: null, metadata: {} }, 'kim'), true)
  assert.equal(offerVisibleToDriver({ rider_id: 'rider', driver_id: 'john', metadata: {} }, 'kim'), false)
})
