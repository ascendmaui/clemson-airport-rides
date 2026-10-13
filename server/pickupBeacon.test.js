import assert from 'node:assert/strict'
import test from 'node:test'
import handler from '../api/pickup-beacon.js'
import { ensureTripPickupCode, readPickupBeacon } from './pickupBeacon.js'
import { isPickupCode } from '../shared/pickupBeacon.js'

const SECRET = 'K7M'

function beaconSb(trip, { code = SECRET, failCodes = false } = {}) {
  const calls = []
  const sb = {
    calls,
    from(table) {
      calls.push(table)
      const filters = []
      let mode = 'select'
      let patch = null
      const query = {
        select() { return query },
        eq(key, value) { filters.push([key, value]); return query },
        insert(value) { mode = 'insert'; patch = value; return query },
        async maybeSingle() {
          if (failCodes && table === 'trip_pickup_codes') throw new Error('relation trip_pickup_codes does not exist')
          if (table === 'trips') {
            const match = filters.every(([key, value]) => trip[key] === value)
            return { data: match ? { ...trip } : null, error: null }
          }
          if (table === 'trip_pickup_codes') {
            if (mode === 'insert') return { data: { code: patch.code }, error: null }
            return { data: code ? { code } : null, error: null }
          }
          return { data: null, error: { message: `unexpected ${table}` } }
        },
      }
      return query
    },
  }
  return sb
}

function response() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

const matched = { id: 'trip-1', rider_id: 'rider', driver_id: 'driver', status: 'arriving' }

test('strangers and other drivers do not receive the pickup code', async () => {
  const sb = beaconSb(matched)
  const stranger = await readPickupBeacon(sb, { id: 'other-driver' }, 'trip-1')
  assert.equal(stranger.status, 403)
  assert.equal('pickupCode' in stranger.body, false)
  assert.equal(JSON.stringify(stranger.body).includes(SECRET), false)
  assert.equal(sb.calls.includes('trip_pickup_codes'), false)

  const missing = await readPickupBeacon(sb, { id: 'rider' }, 'trip-9')
  assert.equal(missing.status, 404)
  assert.equal(JSON.stringify(missing.body).includes(SECRET), false)
})

test('the rider and the matched driver receive the code, and an unmatched rider does not', async () => {
  const open = beaconSb({ ...matched, driver_id: null })
  const waiting = await readPickupBeacon(open, { id: 'rider' }, 'trip-1')
  assert.equal(waiting.status, 200)
  assert.equal(waiting.body.pickupCode, null)
  assert.equal(open.calls.includes('trip_pickup_codes'), false)

  const riderSb = beaconSb(matched)
  const rider = await readPickupBeacon(riderSb, { id: 'rider' }, 'trip-1')
  assert.equal(rider.status, 200)
  assert.equal(rider.body.pickupCode, SECRET)

  const driverSb = beaconSb(matched)
  const driver = await readPickupBeacon(driverSb, { id: 'driver' }, 'trip-1')
  assert.equal(driver.status, 200)
  assert.equal(driver.body.pickupCode, SECRET)

  const blank = beaconSb(matched, { code: null })
  const created = await readPickupBeacon(blank, { id: 'driver' }, 'trip-1')
  assert.equal(created.status, 200)
  assert.equal(isPickupCode(created.body.pickupCode), true)
  assert.equal(created.body.pickupCode.includes('0'), false)
  assert.equal(created.body.pickupCode.includes('1'), false)
  assert.equal(created.body.pickupCode.includes('O'), false)
  assert.equal(created.body.pickupCode.includes('I'), false)
})

test('a missing code table does not throw', async () => {
  const sb = beaconSb(matched, { failCodes: true })
  assert.equal(await ensureTripPickupCode(sb, 'trip-1'), null)
  const result = await readPickupBeacon(sb, { id: 'rider' }, 'trip-1')
  assert.equal(result.status, 200)
  assert.equal(result.body.pickupCode, null)
})

test('the pickup beacon route requires auth and reads tripId from the query', async () => {
  const res = response()
  await handler({ method: 'GET', url: '/api/pickup-beacon?tripId=trip-1', headers: {} }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(JSON.parse(res.body).ok, false)

  const sb = beaconSb(matched)
  const ok = response()
  await handler(
    { method: 'GET', url: '/api/pickup-beacon?tripId=trip-1', headers: {} },
    ok,
    { sb, user: { id: 'rider' } },
  )
  assert.equal(ok.statusCode, 200)
  assert.equal(JSON.parse(ok.body).pickupCode, SECRET)

  const denied = response()
  await handler(
    { method: 'POST', url: '/api/pickup-beacon', headers: {}, body: { tripId: 'trip-1' } },
    denied,
    { sb, user: { id: 'stranger' } },
  )
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.body.includes(SECRET), false)

  const wrong = response()
  await handler({ method: 'PUT', url: '/api/pickup-beacon', headers: {} }, wrong, { user: { id: 'rider' }, sb })
  assert.equal(wrong.statusCode, 405)
})
