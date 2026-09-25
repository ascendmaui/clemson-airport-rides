// Web preferred-driver request. A loader hook serves a fake ./payments so
// src/lib/payments.js (and Supabase) never load. No network.
import { registerHooks } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'

const fakePaymentsUrl = new URL('./payments.js', import.meta.url)
fakePaymentsUrl.searchParams.set('deputyMock', 'requestDriverTrip')

const slot = globalThis.__clemsonWebRequestDriverTrip = {
  calls: [],
  impl: async () => ({ trip: { id: 'trip-1', status: 'requested' } }),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromTrips = context.parentURL?.endsWith('/src/lib/trips.js')
    if (fromTrips && (specifier === './payments' || specifier === './payments.js')) {
      return { shortCircuit: true, url: fakePaymentsUrl.href }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url !== fakePaymentsUrl.href) return nextLoad(url, context)
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        const slot = globalThis.__clemsonWebRequestDriverTrip
        export async function createServerDriverTrip(...args) {
          const body = args[0]
          slot.calls.push({
            argc: args.length,
            body: body && typeof body === 'object' ? structuredClone(body) : body,
          })
          return slot.impl(...args)
        }
      `,
    }
  },
})

const { requestDriverTrip } = await import('./trips.js')
const { destPoint, pickupPoint } = await import('../../packages/rides-native/places.js')

const stadium = pickupPoint('Memorial Stadium')
const SIGN_IN = 'Sign in required to request a driver'
const SELECT_DRIVER = 'Select a driver first'
const NO_TRIP = 'Could not request trip'
const PAYLOAD_KEYS = [
  'driverId',
  'dest',
  'destLat',
  'destLng',
  'pickupLabel',
  'pickupLat',
  'pickupLng',
  'tier',
]

function reset(impl) {
  slot.calls.length = 0
  slot.impl = impl || (async () => ({
    trip: { id: 'trip-1', status: 'requested', fare_cents: 6400 },
  }))
}

function priced(input = {}) {
  return { isStudent: true, listCents: 1850, ...input }
}

function assertPayload(body, expected) {
  assert.equal(slot.calls.length, 1)
  assert.equal(slot.calls[0].argc, 1)
  assert.deepEqual(Object.keys(body), PAYLOAD_KEYS)
  assert.equal('isStudent' in body, false)
  assert.equal('listCents' in body, false)
  assert.equal('riderId' in body, false)
  assert.equal(body.pickupLabel, 'Memorial Stadium')
  assert.equal(body.pickupLat, stadium.latitude)
  assert.equal(body.pickupLng, stadium.longitude)
  assert.deepEqual(body, expected)
}

test('requestDriverTrip rejects a missing rider before a missing driver', async () => {
  const missingRider = [undefined, null, '', 0, false, NaN]
  for (const riderId of missingRider) {
    reset()
    await assert.rejects(
      () => requestDriverTrip(priced({ riderId, driverId: '' })),
      (err) => {
        assert.equal(err instanceof Error, true)
        assert.equal(err.name, 'Error')
        assert.equal(err.message, SIGN_IN)
        return true
      },
    )
    assert.equal(slot.calls.length, 0)
  }

  reset()
  await assert.rejects(
    () => requestDriverTrip({}),
    (err) => err.message === SIGN_IN,
  )
  await assert.rejects(
    () => requestDriverTrip(priced({ driverId: 'driver-9' })),
    (err) => err.message === SIGN_IN,
  )
  assert.equal(slot.calls.length, 0)
})

test('requestDriverTrip rejects a missing driver and does not call the server', async () => {
  for (const driverId of [undefined, null, '', 0, false, NaN]) {
    reset()
    await assert.rejects(
      () => requestDriverTrip(priced({ riderId: 'rider-1', driverId })),
      (err) => {
        assert.equal(err instanceof Error, true)
        assert.equal(err.message, SELECT_DRIVER)
        return true
      },
    )
    assert.equal(slot.calls.length, 0)
  }
})

test('requestDriverTrip rejects a null or omitted argument', async () => {
  // BUG?: requestDriverTrip(), requestDriverTrip(undefined), and
  // requestDriverTrip(null) throw TypeError while destructuring. An empty
  // object throws 'Sign in required to request a driver' instead.
  reset()
  for (const input of [undefined, null]) {
    await assert.rejects(
      () => requestDriverTrip(input),
      (err) => {
        assert.equal(err instanceof TypeError, true)
        assert.match(err.message, /riderId/)
        return true
      },
    )
  }
  await assert.rejects(() => requestDriverTrip(), /riderId/)
  assert.equal(slot.calls.length, 0)
})

test('requestDriverTrip posts custom pins and returns the server trip', async () => {
  const catalog = destPoint('Sikes Hall')
  const response = {
    trip: { id: 'trip-9', status: 'requested', fare_cents: 6500, driver_id: 'driver-9' },
    fareCents: 6500,
    depositCents: 1500,
    studentDiscountApplied: true,
  }
  reset(() => response)

  const trip = await requestDriverTrip({
    riderId: 'rider-1',
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    destLat: 34.8526,
    destLng: -82.394,
    tier: 'comfort',
    isStudent: true,
    listCents: 1850,
    pickupLabel: 'Sikes Hall',
    pickupLat: 1,
    pickupLng: 2,
    fareCents: 1,
  })

  assert.equal(trip, response.trip)
  assert.equal(trip.fare_cents, 6500)
  assert.equal('fareCents' in trip, false)
  assert.equal('isStudent' in trip, false)
  assert.equal('listCents' in trip, false)
  assert.notEqual(34.8526, catalog.latitude)
  assertPayload(slot.calls[0].body, {
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    destLat: 34.8526,
    destLng: -82.394,
    pickupLabel: 'Memorial Stadium',
    pickupLat: stadium.latitude,
    pickupLng: stadium.longitude,
    tier: 'comfort',
  })
  assert.equal(stadium.latitude, 34.6788)
  assert.equal(stadium.longitude, -82.843)
})

test('requestDriverTrip default call pins the drop-off at 0,0', async () => {
  // BUG?: omitted, undefined, and null destLat/destLng default to null, and
  // Number(null) === 0 is finite, so destPoint(dest) never runs. Blank strings
  // do the same (Number('') === 0, Number('   ') === 0). A one-sided null
  // becomes 0 and the other coordinate is kept. PickDriver.jsx calls this
  // without coordinates. The server canonicalizes GSP/CLT/ATL labels, but any
  // other dest is stored at 0,0 (or a one-sided 0) instead of destPoint(dest).
  // The server treats null and '' as missing; the client has already turned
  // them into 0, which finiteCoord() accepts.
  reset()
  const trip = await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    tier: 'xl',
  }))
  assert.equal(trip.id, 'trip-1')
  const sikes = destPoint('Sikes Hall')
  assert.equal(sikes.latitude, 34.6795)
  assert.equal(sikes.longitude, -82.8374)
  assertPayload(slot.calls[0].body, {
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    destLat: 0,
    destLng: 0,
    pickupLabel: 'Memorial Stadium',
    pickupLat: stadium.latitude,
    pickupLng: stadium.longitude,
    tier: 'xl',
  })

  const zeroPins = [
    { dest: 'GSP Airport' },
    { dest: 'GSP Airport', destLat: null, destLng: null },
    { dest: 'GSP Airport', destLat: undefined, destLng: undefined },
    { dest: 'GSP Airport', destLat: '', destLng: '' },
    { dest: 'GSP Airport', destLat: '   ', destLng: '   ' },
  ]
  for (const extra of zeroPins) {
    reset()
    await requestDriverTrip(priced({ riderId: 'rider-1', driverId: 'driver-9', ...extra }))
    assert.equal(slot.calls[0].body.dest, 'GSP Airport')
    assert.equal(slot.calls[0].body.destLat, 0)
    assert.equal(slot.calls[0].body.destLng, 0)
    assert.equal('listCents' in slot.calls[0].body, false)
    assert.equal('isStudent' in slot.calls[0].body, false)
  }

  reset()
  await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    destLat: 34.2,
    destLng: null,
  }))
  assert.equal(slot.calls[0].body.destLat, 34.2)
  assert.equal(slot.calls[0].body.destLng, 0)

  reset()
  await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    destLat: null,
    destLng: -82.22,
  }))
  assert.equal(slot.calls[0].body.destLat, 0)
  assert.equal(slot.calls[0].body.destLng, -82.22)

  reset()
  await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    destLat: '',
    destLng: -82.22,
  }))
  assert.equal(slot.calls[0].body.destLat, 0)
  assert.equal(slot.calls[0].body.destLng, -82.22)

  reset()
  await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    dest: 'Sikes Hall',
    destLat: ' 34.2 ',
    destLng: null,
  }))
  assert.equal(slot.calls[0].body.destLat, 34.2)
  assert.equal(slot.calls[0].body.destLng, 0)
})

test('requestDriverTrip uses destPoint when a coordinate is not finite', async () => {
  const cases = [
    { dest: 'Sikes Hall', destLat: NaN, destLng: NaN },
    { dest: 'Sikes Hall', destLat: Infinity, destLng: -82.8 },
    { dest: 'CLT Airport', destLat: 35.2, destLng: -Infinity },
    { dest: 'CLT Airport', destLat: 'north', destLng: 'west' },
    { dest: 'GSP Airport', destLat: 34.1, destLng: 'nope' },
    { dest: 'Sikes Hall', destLat: null, destLng: 'nope' },
    { dest: 'Sikes Hall', destLat: '34.6795abc', destLng: -82.8374 },
    { dest: 'My House', destLat: Number.NaN, destLng: 'x' },
    { dest: '', destLat: NaN, destLng: NaN },
    { dest: null, destLat: NaN, destLng: NaN },
    { dest: '  GSP Airport  ', destLat: 'abc', destLng: undefined },
  ]
  const catalogGsp = destPoint('GSP Airport')
  assert.equal(catalogGsp.latitude, 34.8956)
  assert.equal(catalogGsp.longitude, -82.2189)
  const plainGsp = destPoint('not a catalog place')
  assert.equal(plainGsp.latitude, 34.8957)
  assert.equal(plainGsp.longitude, -82.2189)

  for (const input of cases) {
    reset()
    await requestDriverTrip(priced({ riderId: 'rider-1', driverId: 'driver-9', tier: 'standard', ...input }))
    const drop = destPoint(input.dest)
    assertPayload(slot.calls[0].body, {
      driverId: 'driver-9',
      dest: input.dest,
      destLat: drop.latitude,
      destLng: drop.longitude,
      pickupLabel: 'Memorial Stadium',
      pickupLat: stadium.latitude,
      pickupLng: stadium.longitude,
      tier: 'standard',
    })
  }
})

test('requestDriverTrip coerces numeric coordinate strings', async () => {
  const cases = [
    { destLat: '34.8526', destLng: '-82.3940', destLatOut: 34.8526, destLngOut: -82.394 },
    { destLat: ' 34.5 ', destLng: ' -82.25 ', destLatOut: 34.5, destLngOut: -82.25 },
    { destLat: '0', destLng: '0', destLatOut: 0, destLngOut: 0 },
    { destLat: 0, destLng: 0, destLatOut: 0, destLngOut: 0 },
  ]
  for (const input of cases) {
    reset()
    await requestDriverTrip(priced({
      riderId: 'rider-1',
      driverId: 'driver-9',
      dest: 'Custom pin',
      destLat: input.destLat,
      destLng: input.destLng,
    }))
    assert.equal(slot.calls[0].body.dest, 'Custom pin')
    assert.equal(slot.calls[0].body.destLat, input.destLatOut)
    assert.equal(slot.calls[0].body.destLng, input.destLngOut)
    assert.equal('listCents' in slot.calls[0].body, false)
    assert.equal('isStudent' in slot.calls[0].body, false)
    assert.notEqual(slot.calls[0].body.destLat, destPoint('Custom pin').latitude)
  }
})

test('requestDriverTrip defaults tier and keeps an explicit tier', async () => {
  const defaults = [
    {},
    { tier: undefined },
    { tier: null },
    { tier: '' },
    { tier: 0 },
    { tier: false },
  ]
  for (const extra of defaults) {
    reset()
    await requestDriverTrip(priced({
      riderId: 'rider-1',
      driverId: 'driver-9',
      destLat: 34.6,
      destLng: -82.8,
      ...extra,
    }))
    assert.equal(slot.calls[0].body.tier, 'standard')
  }

  for (const tier of ['standard', 'comfort', 'xl', 'tesla', 'STANDARD']) {
    reset()
    await requestDriverTrip(priced({
      riderId: 'rider-1',
      driverId: 'driver-9',
      destLat: 34.6,
      destLng: -82.8,
      tier,
    }))
    assert.equal(slot.calls[0].body.tier, tier)
  }

  // BUG?: a whitespace-only tier is truthy, so it is sent unchanged instead
  // of falling through to 'standard'. null and '' do fall through.
  reset()
  await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    destLat: 34.6,
    destLng: -82.8,
    tier: '   ',
  }))
  assert.equal(slot.calls[0].body.tier, '   ')
})

test('requestDriverTrip throws when the response has no trip id', async () => {
  const bad = [
    undefined,
    null,
    {},
    { ok: true },
    { trip: null },
    { trip: undefined },
    { trip: {} },
    { trip: { id: '' } },
    { trip: { id: null } },
    { trip: { id: 0 } },
    { trip: { id: false } },
    { trip: { ID: 'trip-1' } },
    { id: 'trip-1' },
    { tripId: 'trip-1' },
    { trip: { trip: { id: 'trip-1' } } },
  ]
  for (const data of bad) {
    reset(async () => data)
    await assert.rejects(
      () => requestDriverTrip(priced({ riderId: 'rider-1', driverId: 'driver-9', destLat: 1, destLng: 2 })),
      (err) => {
        assert.equal(err instanceof Error, true)
        assert.equal(err.name, 'Error')
        assert.equal(err.message, NO_TRIP)
        return true
      },
    )
    assert.equal(slot.calls.length, 1)
    assert.equal(slot.calls[0].body.driverId, 'driver-9')
    assert.equal(slot.calls[0].body.destLat, 1)
    assert.equal(slot.calls[0].body.destLng, 2)
  }

  // BUG?: a whitespace trip id is truthy, so the missing-id error is skipped.
  const blank = { trip: { id: '   ', status: 'requested' } }
  reset(async () => blank)
  const blankTrip = await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    destLat: 1,
    destLng: 2,
  }))
  assert.equal(blankTrip, blank.trip)

  const numeric = { trip: { id: 42 } }
  reset(async () => numeric)
  assert.equal(await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    destLat: 1,
    destLng: 2,
  })), numeric.trip)

  const stringZero = { trip: { id: '0', status: 'requested' } }
  reset(async () => stringZero)
  assert.equal(await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: 'driver-9',
    destLat: 1,
    destLng: 2,
  })), stringZero.trip)
})

test('requestDriverTrip propagates createServerDriverTrip failures', async () => {
  const failure = new Error('Driver is offline')
  failure.status = 409
  failure.code = 'driver_offline'
  reset(() => { throw failure })
  await assert.rejects(
    () => requestDriverTrip(priced({ riderId: 'rider-1', driverId: 'driver-9', destLat: 3, destLng: 4 })),
    (err) => {
      assert.equal(err, failure)
      assert.equal(err.message, 'Driver is offline')
      assert.equal(err.status, 409)
      assert.equal(err.code, 'driver_offline')
      assert.notEqual(err.message, NO_TRIP)
      return true
    },
  )
  assert.equal(slot.calls.length, 1)
  assert.equal(slot.calls[0].body.destLat, 3)
  assert.equal(slot.calls[0].body.destLng, 4)
  assert.equal('listCents' in slot.calls[0].body, false)

  reset(() => { throw 'network down' })
  await assert.rejects(
    () => requestDriverTrip({ riderId: 'rider-1', driverId: 'driver-9' }),
    (err) => err === 'network down',
  )
  assert.equal(slot.calls.length, 1)
})

test('requestDriverTrip lets a whitespace id through and still omits the fare fields', async () => {
  // BUG?: whitespace-only riderId and driverId are truthy, so the local
  // guards do not throw and the untrimmed driverId is posted.
  reset()
  await requestDriverTrip({
    riderId: '   ',
    driverId: '  driver-9  ',
    destLat: 34.6,
    destLng: -82.8,
    isStudent: false,
    listCents: 0,
  })
  assert.equal(slot.calls.length, 1)
  assert.equal(slot.calls[0].body.driverId, '  driver-9  ')
  assert.equal('riderId' in slot.calls[0].body, false)
  assert.equal('isStudent' in slot.calls[0].body, false)
  assert.equal('listCents' in slot.calls[0].body, false)

  reset()
  await requestDriverTrip(priced({
    riderId: 'rider-1',
    driverId: '   ',
    destLat: 34.6,
    destLng: -82.8,
  }))
  assert.equal(slot.calls[0].body.driverId, '   ')
})
