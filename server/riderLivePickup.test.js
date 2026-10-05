import assert from 'node:assert/strict'
import test from 'node:test'
import { publishRiderPickup } from './endpoints/riderLivePickup.js'

const NOW = new Date('2026-10-05T12:00:00.000Z')

function mockSb(trip = {}, { rpc = true } = {}) {
  const state = {
    trip: {
      id: 'trip-1',
      rider_id: 'rider-1',
      driver_id: 'driver-9',
      status: 'offered',
      fare_cents: 2400,
      pickup_lat: 34.67,
      pickup_lng: -82.84,
      metadata: { kind: 'driver_request', offer_driver_id: 'driver-9' },
      ...trip,
    },
    updates: [],
    rpcCalls: [],
  }

  const client = {
    state,
    from(table) {
      if (table !== 'trips') throw new Error(`unexpected table ${table}`)
      const filters = []
      let patch = null
      let op = 'select'
      const run = async () => {
        const matches = () => filters.every(([col, val]) => state.trip[col] === val)
        if (op === 'update') {
          if (!matches()) return { data: null, error: { message: 'no row' } }
          state.updates.push(patch)
          state.trip = { ...state.trip, ...patch }
          return { data: state.trip, error: null }
        }
        if (!matches()) return { data: null, error: null }
        return { data: { ...state.trip }, error: null }
      }
      const builder = {
        select() { return builder },
        update(next) { op = 'update'; patch = next; return builder },
        eq(col, val) { filters.push([col, val]); return builder },
        maybeSingle() { return run() },
        then(resolve, reject) { return run().then(resolve, reject) },
      }
      return builder
    },
  }

  if (rpc) {
    client.rpc = async (fn, args) => {
      state.rpcCalls.push({ fn, args })
      if (fn !== 'merge_trip_metadata') return { data: null, error: { message: 'missing' } }
      const statuses = args.p_expected_statuses
      if (statuses && !statuses.includes(state.trip.status)) return { data: null, error: null }
      state.trip = {
        ...state.trip,
        metadata: { ...(state.trip.metadata || {}), ...(args.p_patch || {}) },
      }
      return {
        data: { id: state.trip.id, status: state.trip.status, metadata: state.trip.metadata },
        error: null,
      }
    }
  }

  return client
}

test('a booking fix is merged onto the trip and does not touch fare, pickup, or status', async () => {
  const sb = mockSb()
  const result = await publishRiderPickup(sb, { id: 'rider-1' }, {
    tripId: 'trip-1',
    lat: 34.6804,
    lng: -82.8366,
    accuracy: 4.2,
    heading: 12,
    fareCents: 1,
    pickup_lat: 0,
    status: 'completed',
  }, { now: () => NOW })

  assert.equal(result.status, 200)
  assert.equal(result.body.rider_location.lat, 34.6804)
  assert.equal(result.body.rider_location.accuracy_m, 4.2)
  assert.equal(sb.state.trip.fare_cents, 2400)
  assert.equal(sb.state.trip.pickup_lat, 34.67)
  assert.equal(sb.state.trip.pickup_lng, -82.84)
  assert.equal(sb.state.trip.status, 'offered')
  assert.equal(sb.state.trip.driver_id, 'driver-9')
  assert.equal(sb.state.trip.metadata.kind, 'driver_request')
  assert.equal(sb.state.trip.metadata.offer_driver_id, 'driver-9')
  assert.equal(sb.state.trip.metadata.rider_location.lng, -82.8366)
  assert.equal(sb.state.updates.length, 0)
  assert.deepEqual(Object.keys(sb.state.rpcCalls[0].args.p_patch), ['rider_location'])
})

test('pickup tracking is refused once the ride is underway or the fix is coarse', async () => {
  const moving = mockSb({ status: 'in_progress' })
  const blocked = await publishRiderPickup(moving, { id: 'rider-1' }, {
    tripId: 'trip-1',
    lat: 34.68,
    lng: -82.84,
    accuracy: 5,
  }, { now: () => NOW })
  assert.equal(blocked.status, 409)
  assert.equal(moving.state.rpcCalls.length, 0)
  assert.equal(moving.state.trip.metadata.rider_location, undefined)

  const coarse = mockSb()
  const rejected = await publishRiderPickup(coarse, { id: 'rider-1' }, {
    tripId: 'trip-1',
    lat: 34.68,
    lng: -82.84,
    accuracy: 80,
  }, { now: () => NOW })
  assert.equal(rejected.status, 400)
  assert.equal(coarse.state.trip.fare_cents, 2400)
  assert.equal(coarse.state.rpcCalls.length, 0)

  const stranger = await publishRiderPickup(mockSb(), { id: 'other' }, {
    tripId: 'trip-1',
    lat: 34.68,
    lng: -82.84,
  }, { now: () => NOW })
  assert.equal(stranger.status, 404)
})

test('without the metadata merge function the fallback writes only metadata', async () => {
  const sb = mockSb({}, { rpc: false })
  const result = await publishRiderPickup(sb, { id: 'rider-1' }, {
    tripId: 'trip-1',
    lat: 34.681,
    lng: -82.83,
    accuracy: 9,
  }, { now: () => NOW })
  assert.equal(result.status, 200)
  assert.equal(sb.state.updates.length, 1)
  assert.deepEqual(Object.keys(sb.state.updates[0]), ['metadata'])
  assert.equal(sb.state.trip.status, 'offered')
  assert.equal(sb.state.trip.fare_cents, 2400)
  assert.equal(sb.state.trip.pickup_lat, 34.67)
  assert.equal(sb.state.trip.metadata.rider_location.lat, 34.681)
})
