import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { priceDriverRequest } from './authoritativeFare.js'
import {
  CARPOOL_SEAT_FRACTION_BPS,
  COMFORT_FARE_MULTIPLIER_BPS,
  scaleCents,
  WAIT_SAVE_MULTIPLIER_BPS,
  quoteFare,
} from '../src/lib/fareRates.js'
import { fareAuthorizationCents } from '../shared/fareAuthorization.js'
import {
  CARPOOL_MATCH_RADIUS_MILES,
  groupCarpoolRequests,
  planCarpoolFill,
  riderRequestsMatch,
} from '../shared/carpoolSeatMatch.js'
import { enrollCarpoolSeat } from './carpoolSeatBook.js'
import { EXPO_PUSH_URL } from './expoPush.js'

const QUIET = new Date('2026-09-23T15:00:00.000Z')
const HOME = { label: 'Sikes Hall', lat: 34.6795, lng: -82.8374 }
const LIBRARY = { label: 'Cooper Library', lat: 34.6765, lng: -82.8375 }
const WHEN = '2026-10-13T18:00:00.000Z'

function shiftNorth(place, miles) {
  const meters = miles * 1609.344
  return { ...place, lat: place.lat + meters / 111320 }
}

function rider(id, pickup, dropoff, departAt = WHEN, extra = {}) {
  return { riderId: id, pickup, dropoff, departAt, ...extra }
}

test('fare ordering is Wait & Save under Standard under Extra Comfort, with Carpool at half', () => {
  const places = { pickup: HOME, dropoff: LIBRARY }
  const options = { at: QUIET, distanceM: 8000, durationS: 900, isStudent: false }
  const standard = priceDriverRequest(places, options)
  const wait = priceDriverRequest(places, { ...options, tier: 'wait' })
  const comfort = priceDriverRequest(places, { ...options, tier: 'comfort' })
  const carpool = priceDriverRequest(places, { ...options, tier: 'carpool' })
  assert.ok(wait.fareCents < standard.fareCents)
  assert.ok(standard.fareCents < comfort.fareCents)
  assert.equal(wait.fareCents, scaleCents(standard.fareCents, WAIT_SAVE_MULTIPLIER_BPS))
  assert.equal(comfort.fareCents, scaleCents(standard.fareCents, COMFORT_FARE_MULTIPLIER_BPS))
  assert.equal(carpool.perSeatFareCents, scaleCents(standard.fareCents, CARPOOL_SEAT_FRACTION_BPS))
  assert.ok(WAIT_SAVE_MULTIPLIER_BPS >= 8000 && WAIT_SAVE_MULTIPLIER_BPS <= 8500)
  assert.ok(COMFORT_FARE_MULTIPLIER_BPS >= 13000 && COMFORT_FARE_MULTIPLIER_BPS <= 15000)
  const existing = quoteFare({ miles: 8, minutes: 12, tier: 'wait', waitDiscountBps: 2000 })
  const base = quoteFare({ miles: 8, minutes: 12, tier: 'standard' })
  assert.equal(existing.fareBeforeCreditsCents, scaleCents(base.fareBeforeCreditsCents, 8000))
})

test('carpool groups riders inside the radius and leaves riders outside it', () => {
  assert.equal(CARPOOL_MATCH_RADIUS_MILES, 0.5)
  const nearPickup = shiftNorth(HOME, 0.3)
  const nearDrop = shiftNorth(LIBRARY, 0.2)
  const farPickup = shiftNorth(HOME, 1.2)
  const farDrop = shiftNorth(LIBRARY, 1.4)
  const soon = '2026-10-13T18:10:00.000Z'
  const later = '2026-10-13T18:45:00.000Z'
  const a = rider('a', HOME, LIBRARY)
  const b = rider('b', nearPickup, nearDrop, soon)
  const farAway = rider('c', farPickup, LIBRARY, soon)
  const farDest = rider('d', nearPickup, farDrop, soon)
  const late = rider('e', nearPickup, nearDrop, later)
  assert.equal(riderRequestsMatch(a, b), true)
  assert.equal(riderRequestsMatch(a, farAway), false)
  assert.equal(riderRequestsMatch(a, farDest), false)
  assert.equal(riderRequestsMatch(a, late), false)
  const groups = groupCarpoolRequests([a, b, farAway, farDest, late])
  const sizes = groups.map((group) => group.length).sort((x, y) => y - x)
  assert.deepEqual(sizes, [2, 1, 1, 1])
  const together = groups.find((group) => group.some((row) => row.riderId === 'a'))
  assert.deepEqual(together.map((row) => row.riderId).sort(), ['a', 'b'])
})

test('a filled group merges into one trip and notifies the driver with the real count', async () => {
  const near = shiftNorth(HOME, 0.2)
  const drop = shiftNorth(LIBRARY, 0.2)
  const people = [
    rider('r1', HOME, LIBRARY, WHEN, { tripId: 'trip-1' }),
    rider('r2', near, drop, '2026-10-13T18:05:00.000Z', { tripId: 'trip-2' }),
    rider('r3', shiftNorth(HOME, 0.1), shiftNorth(LIBRARY, 0.1), '2026-10-13T18:08:00.000Z', { tripId: 'trip-3' }),
  ]
  const tooFew = planCarpoolFill(people.slice(0, 2), {
    perSeatFareCents: 900,
    drivers: [{ id: 'demo-carlos' }, { id: 'driver-real' }],
  })
  assert.equal(tooFew.booked, false)
  assert.equal(tooFew.notice, null)

  const demoOnly = planCarpoolFill([
    ...people.slice(0, 2),
    rider('demo-rider', near, drop, WHEN, { vehicleId: 'demo-carlos' }),
  ], { perSeatFareCents: 900, drivers: [{ id: 'demo-carlos' }] })
  assert.equal(demoOnly.booked, false)

  const filled = planCarpoolFill(people, {
    perSeatFareCents: 900,
    drivers: [{ id: 'demo-carlos' }, { id: 'driver-real' }],
  })
  assert.equal(filled.booked, true)
  assert.equal(filled.trip.passengers, 3)
  assert.equal(filled.trip.deposit_cents, 0)
  assert.equal(filled.trip.fare_cents, 2700)
  assert.deepEqual(filled.trip.metadata.carpool_rider_ids, ['r1', 'r2', 'r3'])
  assert.equal(filled.driverId, 'driver-real')
  assert.equal(filled.holds.length, 3)
  const expectedHold = fareAuthorizationCents(900)
  for (const hold of filled.holds) {
    assert.equal(hold.depositCents, 0)
    assert.equal(hold.holdKind, 'preauth')
    assert.equal(hold.authorizationCents, expectedHold.authorizationCents)
    assert.equal(hold.estimatedFareCents, 900)
  }
  assert.deepEqual(filled.notice, {
    title: 'Carpool ready',
    body: 'Three people found, going from same or similar location to same or similar drop-off.',
    riderCount: 3,
  })
  assert.equal(filled.inApp.body, filled.notice.body)
  assert.equal(filled.push.title, 'Carpool ready')
  assert.equal(filled.push.body, filled.notice.body)
  assert.equal(filled.push.data.kind, 'carpool_ready')
  assert.equal(filled.push.data.riderCount, 3)
  assert.equal(filled.push.data.tripId, 'trip-1')
  assert.equal(filled.push.data.tier, 'carpool')
  assert.equal(filled.push.data.url, 'clemsonrides-driver://trip?id=trip-1')

  const fourth = rider('r4', shiftNorth(HOME, 0.15), shiftNorth(LIBRARY, 0.15), '2026-10-13T18:09:00.000Z')
  const four = planCarpoolFill([...people, fourth], { perSeatFareCents: 900, drivers: [{ id: 'driver-real' }] })
  assert.equal(four.booked, true)
  assert.equal(four.trip.passengers, 4)
  assert.equal(four.notice.body, 'Four people found, going from same or similar location to same or similar drop-off.')
  assert.equal(four.notice.riderCount, 4)

  const fifth = rider('r5', shiftNorth(HOME, 0.05), shiftNorth(LIBRARY, 0.05), '2026-10-13T18:11:00.000Z')
  const five = planCarpoolFill([...people, fourth, fifth], { perSeatFareCents: 900 })
  assert.equal(five.trip.passengers, 4)
  assert.equal(five.waiting.length, 1)
  assert.equal(five.waiting[0].riderId, 'r5')

  const pushes = []
  const sb = memoryQueue()
  const booked = await enrollCarpoolSeat(sb, {
    riderId: 'r3',
    pickup: people[2].pickup,
    dropoff: people[2].dropoff,
    departAt: people[2].departAt,
    tripId: 'trip-3',
    perSeatFareCents: 900,
    drivers: [{ id: 'demo-carlos' }, { id: 'driver-real' }],
  }, {
    sendPush: async (message) => {
      pushes.push(message)
      return { sent: true }
    },
  })
  sb.tables.carpool_requests.unshift(
    { id: 'q1', rider_id: 'r1', pickup: people[0].pickup, dropoff: people[0].dropoff, depart_at: people[0].departAt, status: 'open', trip_id: 'trip-1' },
    { id: 'q2', rider_id: 'r2', pickup: people[1].pickup, dropoff: people[1].dropoff, depart_at: people[1].departAt, status: 'open', trip_id: 'trip-2' },
  )
  const again = await enrollCarpoolSeat(sb, {
    riderId: 'r3',
    pickup: people[2].pickup,
    dropoff: people[2].dropoff,
    departAt: people[2].departAt,
    tripId: 'trip-3',
    perSeatFareCents: 900,
    drivers: [{ id: 'demo-carlos' }, { id: 'driver-real' }],
  }, {
    sendPush: async (message) => {
      pushes.push(message)
      return { sent: true }
    },
  })
  assert.equal(booked.booked, false)
  assert.equal(again.booked, true)
  assert.equal(again.trip.deposit_cents, 0)
  assert.equal(sb.tables.trips.find((row) => row.id === 'trip-3').passengers, 3)
  assert.equal(sb.tables.trips.find((row) => row.id === 'trip-3').deposit_cents, 0)
  assert.equal(sb.tables.trips.find((row) => row.id === 'trip-1').status, 'canceled')
  assert.equal(pushes.length, 1)
  assert.equal(pushes[0].title, 'Carpool ready')
  assert.equal(pushes[0].body, 'Three people found, going from same or similar location to same or similar drop-off.')
  assert.equal(pushes[0].data.riderCount, 3)
  assert.equal(pushes[0].to, 'ExponentPushToken[driver-real]')
})

test('a filled carpool sends a remote Expo push to the driver token', async () => {
  const near = shiftNorth(HOME, 0.2)
  const drop = shiftNorth(LIBRARY, 0.2)
  const sb = memoryQueue()
  sb.tables.driver_push_tokens[0].token = 'ExponentPushToken[stored-driver]'
  sb.tables.carpool_requests.push(
    { id: 'q1', rider_id: 'r1', pickup: HOME, dropoff: LIBRARY, depart_at: WHEN, status: 'open', trip_id: 'trip-1' },
    { id: 'q2', rider_id: 'r2', pickup: near, dropoff: drop, depart_at: '2026-10-13T18:05:00.000Z', status: 'open', trip_id: 'trip-2' },
  )
  const posts = []
  const booked = await enrollCarpoolSeat(sb, {
    riderId: 'r3',
    pickup: shiftNorth(HOME, 0.1),
    dropoff: shiftNorth(LIBRARY, 0.1),
    departAt: '2026-10-13T18:08:00.000Z',
    tripId: 'trip-3',
    perSeatFareCents: 900,
    drivers: [{ id: 'demo-carlos' }, { id: 'driver-real' }],
  }, {
    env: {},
    fetch: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok', id: 'ticket-carpool' }] }) }
    },
  })
  assert.equal(booked.booked, true)
  assert.equal(booked.pushSent.sent, true)
  assert.equal(booked.pushSent.reason, 'sent')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].url, EXPO_PUSH_URL)
  assert.equal(posts[0].body.to, 'ExponentPushToken[stored-driver]')
  assert.equal(posts[0].body.title, 'Carpool ready')
  assert.equal(posts[0].body.body, 'Three people found, going from same or similar location to same or similar drop-off.')
  assert.equal(posts[0].body.priority, 'high')
  assert.equal(posts[0].body.channelId, 'ride-requests')
  assert.equal(posts[0].body.sound, 'default')
  assert.equal(posts[0].body.data.kind, 'carpool_ready')
  assert.equal(posts[0].body.data.tier, 'carpool')
  assert.equal(posts[0].body.data.tripId, 'trip-3')
  assert.equal(posts[0].body.data.url, 'clemsonrides-driver://trip?id=trip-3')
})

test('carpool queue migration only adds columns', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261013121000_carpool_seat_queue.sql', import.meta.url), 'utf8')
  const lowered = sql.toLowerCase()
  assert.equal(lowered.includes('drop table'), false)
  assert.equal(lowered.includes('drop column'), false)
  assert.match(sql, /add column if not exists trip_id/)
  assert.match(sql, /add column if not exists seat_fare_cents/)
  assert.match(sql, /add column if not exists hold_cents/)
  assert.match(sql, /create table if not exists public\.carpool_requests/)
})

function memoryQueue() {
  const tables = {
    carpool_requests: [],
    trips: [
      { id: 'trip-1', status: 'searching', passengers: 1, deposit_cents: 0, metadata: {} },
      { id: 'trip-2', status: 'searching', passengers: 1, deposit_cents: 0, metadata: {} },
      { id: 'trip-3', status: 'searching', passengers: 1, deposit_cents: 0, metadata: {} },
    ],
    driver_push_tokens: [{ driver_id: 'driver-real', token: 'ExponentPushToken[driver-real]', platform: 'ios' }],
    driver_status: [],
  }
  return {
    tables,
    from(name) {
      const rows = tables[name]
      if (!rows) throw new Error(`unexpected table ${name}`)
      const state = { filters: [], patch: null, inserted: null }
      const match = (row) => state.filters.every((filter) => {
        if (filter[2] === 'in') return filter[1].includes(row[filter[0]])
        return row[filter[0]] === filter[1]
      })
      const api = {
        insert(row) {
          state.inserted = { id: `q-${rows.length + 1}`, ...row }
          return api
        },
        update(patch) {
          state.patch = patch
          return api
        },
        select() { return api },
        eq(column, value) {
          state.filters.push([column, value])
          return api
        },
        in(column, values) {
          state.filters.push([column, values, 'in'])
          return api
        },
        limit() { return api },
        async maybeSingle() {
          const found = rows.find(match) || null
          return { data: found, error: null }
        },
        async single() {
          if (!state.inserted) return { data: null, error: { message: 'nothing inserted' } }
          rows.push(state.inserted)
          return { data: state.inserted, error: null }
        },
        then(resolve, reject) {
          if (state.patch) {
            for (const row of rows) {
              if (match(row)) Object.assign(row, state.patch)
            }
          }
          return Promise.resolve({ data: rows.filter(match), error: null }).then(resolve, reject)
        },
      }
      return api
    },
  }
}
