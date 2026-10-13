import assert from 'node:assert/strict'
import test from 'node:test'
import { loadNearTermOffer } from './nearTermAvailability.js'
import { notifyScheduledBoard } from './scheduledBoardAlerts.js'
import scheduleSlots from './endpoints/scheduleSlots.js'
import matchNotice from './endpoints/matchNotice.js'
import scheduleTrip from './endpoints/scheduleTrip.js'
import { releaseScheduledRides } from './releaseScheduledRides.js'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'

const NOW = new Date('2026-10-05T15:00:00.000Z')
const PICKUP = { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 }
const DROPOFF = { label: 'Sikes Hall', lat: 34.6795, lng: -82.8374 }

function chain(table, tables) {
  const filters = []
  let inserted = null
  const api = {
    select() { return api },
    eq(col, val) { filters.push({ op: 'eq', col, val }); return api },
    in(col, vals) { filters.push({ op: 'in', col, val: vals }); return api },
    is() { return api },
    lte() { return api },
    gte() { return api },
    order() { return api },
    limit() { return api },
    insert(row) {
      inserted = row
      tables[table] = tables[table] || []
      tables[table].push(row)
      return api
    },
    maybeSingle() {
      return Promise.resolve({ data: filter(tables[table] || [])[0] || null, error: null })
    },
    single() {
      const row = inserted || filter(tables[table] || [])[0] || null
      if (row && !row.id) row.id = `trip-${tables.trips.length}`
      return Promise.resolve({ data: row, error: row ? null : { message: 'missing' } })
    },
    then(resolve, reject) {
      if (inserted) return Promise.resolve({ data: inserted, error: null }).then(resolve, reject)
      return Promise.resolve({ data: filter(tables[table] || []), error: null }).then(resolve, reject)
    },
  }
  function filter(rows) {
    return rows.filter((row) => filters.every((item) => {
      if (item.op === 'in') return item.val.includes(row[item.col])
      return row[item.col] === item.val
    }))
  }
  return api
}

function client(tables) {
  return { from(name) { return chain(name, tables) } }
}

function fleet() {
  return {
    driver_applications: [
      { profile_id: 'driver-near', onboarding_status: 'approved' },
      { profile_id: 'demo-marcus', onboarding_status: 'approved' },
      { profile_id: 'driver-offline', onboarding_status: 'approved' },
      { profile_id: 'driver-busy', onboarding_status: 'approved' },
    ],
    driver_status: [
      { driver_id: 'driver-near', online: true, lat: 34.682, lng: -82.84, updated_at: NOW.toISOString(), expo_push_token: 'ExponentPushToken[near]' },
      { driver_id: 'demo-marcus', online: true, lat: PICKUP.lat, lng: PICKUP.lng, updated_at: NOW.toISOString(), expo_push_token: 'ExponentPushToken[demo]' },
      { driver_id: 'driver-offline', online: false, lat: PICKUP.lat, lng: PICKUP.lng, updated_at: NOW.toISOString() },
      { driver_id: 'driver-busy', online: true, lat: PICKUP.lat, lng: PICKUP.lng, updated_at: NOW.toISOString() },
    ],
    trips: [
      { driver_id: 'driver-busy', status: 'in_progress', pickup_at: null, scheduled_for: null },
    ],
    vehicles: [],
    driver_push_tokens: [],
    driver_offer_alerts: [],
    profiles: [
      { id: 'driver-near', email: 'near@example.com', full_name: 'Ava Stone' },
      { id: 'driver-offline', email: 'offline@example.com' },
      { id: 'driver-busy', email: 'busy@example.com' },
    ],
  }
}

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function call(handler, req, deps) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

test('wait ignores demo, offline, and busy drivers', async () => {
  const offer = await loadNearTermOffer(client(fleet()), { pickup: PICKUP, tier: 'standard', now: NOW })
  assert.equal(offer.availableDrivers, 1)
  assert.equal(offer.demoDriversExcluded, true)
  assert.deepEqual(offer.slots.map((slot) => slot.minutesOut), [10, 11, 12, 13, 14, 15])
  assert.equal(offer.slots.some((slot) => slot.minutesOut < 10 || slot.minutesOut > 15), false)
})

test('schedule-slots returns the window and no driver names', async () => {
  const res = await call(scheduleSlots, {
    method: 'POST',
    body: { pickup: PICKUP, tier: 'standard' },
  }, { sb: client(fleet()), now: NOW })
  assert.equal(res.status, 200)
  assert.equal(res.json.availableDrivers, 1)
  assert.equal(res.json.slots.length, 6)
  assert.equal(JSON.stringify(res.json).includes('demo-marcus'), false)
  assert.equal(JSON.stringify(res.json).includes('ExponentPushToken'), false)
})

test('scheduling a slot notifies every approved driver and keeps the ride on the board', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'offline' } }) })
  const tables = fleet()
  const slot = new Date(NOW.getTime() + 12 * 60 * 1000).toISOString()
  const res = await call(scheduleTrip, {
    method: 'POST',
    body: {
      nearTerm: true,
      pickup: PICKUP,
      dropoff: DROPOFF,
      pickupAt: slot,
      tier: 'standard',
      purpose: 'planned',
    },
  }, {
    sb: client(tables),
    user: { id: 'rider-1', email: 'rider@example.com', user_metadata: { full_name: 'Riley' } },
    now: NOW.getTime(),
    ensureProfile: async () => ({ ok: true }),
  })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  assert.equal(res.json.nearTerm, true)
  assert.equal(res.json.slot.minutesOut, 12)
  assert.equal(res.json.board.notified, 3)
  assert.equal(res.json.board.drivers, 3)
  assert.match(res.json.board.pushGap, /No server push sender/)
  const trip = tables.trips.find((row) => row.rider_id === 'rider-1')
  assert.equal(trip.status, 'scheduled')
  assert.equal(trip.metadata.near_term_slot, true)
  assert.equal(trip.metadata.schedule_window, '10_15')
  const alerts = tables.driver_offer_alerts
  assert.equal(alerts.length, 3)
  assert.equal(alerts.some((row) => row.driver_id === 'demo-marcus'), false)
  assert.equal(alerts.every((row) => row.offer_marker === 'scheduled-board'), true)
  assert.equal(alerts.every((row) => row.channels.sms.reason === 'board_prefers_in_app'), true)
  assert.equal(alerts.find((row) => row.driver_id === 'driver-near').channels.push.reason, 'push_sender_missing')
  globalThis.fetch = originalFetch
})

test('a pickup outside the offered slots is rejected and does not notify', async () => {
  const tables = fleet()
  const res = await call(scheduleTrip, {
    method: 'POST',
    body: {
      nearTerm: true,
      pickup: PICKUP,
      dropoff: DROPOFF,
      pickupAt: new Date(NOW.getTime() + 40 * 60 * 1000).toISOString(),
    },
  }, {
    sb: client(tables),
    user: { id: 'rider-1', email: 'rider@example.com' },
    now: NOW.getTime(),
    ensureProfile: async () => ({ ok: true }),
  })
  assert.equal(res.status, 409)
  assert.equal(res.json.code, 'slot_unavailable')
  assert.equal(tables.driver_offer_alerts.length, 0)
})

test('match notice returns driver, distance, and pickup time', async () => {
  const tables = fleet()
  tables.trips.push({
    id: 'trip-1',
    status: 'accepted',
    rider_id: 'rider-1',
    driver_id: 'driver-near',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'Sikes Hall',
    pickup_lat: PICKUP.lat,
    pickup_lng: PICKUP.lng,
    pickup_at: new Date(NOW.getTime() + 12 * 60 * 1000).toISOString(),
    scheduled_for: null,
    metadata: { near_term_slot: true },
  })
  const res = await call(matchNotice, {
    method: 'GET',
    url: '/api/stripe-payment-methods?action=match-notice&tripId=trip-1',
  }, { sb: client(tables), user: { id: 'rider-1' }, now: NOW })
  assert.equal(res.status, 200, JSON.stringify(res.json))
  assert.equal(res.json.driverName, 'Ava')
  assert.match(res.json.distanceLabel, /mi/)
  assert.match(res.json.body, /Pickup/)
  const demo = await call(matchNotice, {
    method: 'GET',
    url: '/api/stripe-payment-methods?action=match-notice&tripId=trip-demo',
  }, {
    sb: client({
      ...tables,
      trips: [{ ...tables.trips.at(-1), id: 'trip-demo', driver_id: 'demo-marcus' }],
    }),
    user: { id: 'rider-1' },
    now: NOW,
  })
  assert.equal(demo.status, 409)
  assert.equal(demo.json.code, 'demo_driver')
})

test('near-term rides stay scheduled until pickup, then use live release', async () => {
  const pickupAt = new Date(NOW.getTime() + 12 * 60 * 1000).toISOString()
  const seeded = seedMatchingScenario({ trip: {
    status: 'scheduled',
    driver_id: null,
    deposit_cents: 0,
    pickup_at: pickupAt,
    scheduled_for: pickupAt,
    metadata: { near_term_slot: true, kind: 'scheduled' },
  } })
  const sb = seeded.supabase
  const held = await releaseScheduledRides(sb, { now: NOW, alertDriver: async () => { throw new Error('should hold') } })
  assert.equal(held.held, 1)
  assert.equal(held.released, 0)
  assert.equal(sb._tables.trips[0].status, 'scheduled')
  const released = await releaseScheduledRides(sb, {
    now: new Date(new Date(pickupAt).getTime() + 1000),
    alertDriver: async () => {},
  })
  assert.equal(released.released, 1)
  assert.equal(sb._tables.trips[0].status, 'searching')
})
