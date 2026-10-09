import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import {
  defaultDriverRank,
  dispatchRankOf,
  offerVisibleToDriver,
  sortByDefaultDriverOrder,
  visibleOfferQuery,
  unchangedOfferQuery,
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


test('an old target cannot see an offer assigned to another driver', () => {
  assert.equal(offerVisibleToDriver({ driver_id: 'kim', metadata: { offer_driver_id: 'john' } }, 'john'), false)
})

test('dispatch predicates serialize correctly through the real Supabase query builder', async () => {
  const requests = []
  const sb = createClient('https://matching.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      requests.push(new URL(input))
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  await visibleOfferQuery(sb.from('trips').select('id'), 'driver-1').limit(8)
  assert.equal(requests[0].searchParams.get('driver_id'), 'is.null')
  assert.equal(requests[0].searchParams.get('or'), '(metadata->>offer_driver_id.is.null,metadata->>offer_driver_id.eq."",metadata->>offer_driver_id.eq."driver-1")')
  const metadata = { offer_driver_id: 'driver-1', match: 'auto' }
  await unchangedOfferQuery(sb.from('trips').update({ status: 'accepted' }), { metadata })
  assert.equal(requests[1].searchParams.get('metadata'), `eq.${JSON.stringify(metadata)}`)
  await unchangedOfferQuery(sb.from('trips').update({ status: 'accepted' }), { metadata: null })
  assert.equal(requests[2].searchParams.get('metadata'), 'is.null')
})
