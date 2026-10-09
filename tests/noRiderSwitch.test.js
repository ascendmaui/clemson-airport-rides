import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { commitRiderSwitch, quoteRiderSwitch } from '../shared/riderSwitch.js'
import { handleRiderSwitch } from '../server/endpoints/riderSwitch.js'
import { settleSwitchHold } from '../server/riderSwitchHold.js'
import { OFFERED_RIDE_TIERS } from '../shared/rideOptions.js'

function matchedTrip(overrides = {}) {
  return {
    id: 'trip-1',
    rider_id: 'rider-1',
    driver_id: 'driver-a',
    status: 'accepted',
    tier: 'standard',
    fare_cents: 1850,
    pickup_label: 'Campus',
    dropoff_label: 'Airport',
    metadata: {
      fare_authorization: {
        status: 'requires_capture',
        paymentIntentId: 'pi_old',
        authorizationCents: 2220,
      },
    },
    ...overrides,
  }
}

test('before pickup the cancel is free and an open hold stays when the fare does not grow', () => {
  const quote = quoteRiderSwitch(matchedTrip(), { action: 'preview', nextFareCents: 1850 })
  assert.equal(quote.allowed, true)
  assert.equal(quote.feeCents, 0)
  assert.equal(quote.hold, 'keep')
  assert.match(quote.feeLine, /no cancel fee/i)
  assert.match(quote.holdLine, /stays with this ride/i)
})

test('a higher fare grows the hold and a plain cancel releases it', () => {
  const grown = quoteRiderSwitch(matchedTrip(), { action: 'switch-tier', nextFareCents: 3000 })
  assert.equal(grown.hold, 'grow')
  assert.match(grown.holdLine, /may go up/i)
  const released = quoteRiderSwitch(matchedTrip(), { action: 'cancel' })
  assert.equal(released.hold, 'release')
  assert.equal(released.feeCents, 0)
  assert.match(released.holdLine, /release the hold/i)
})

test('credits skip the card hold, and a ride with no hold places one when the ride continues', () => {
  const credits = quoteRiderSwitch(matchedTrip({
    metadata: { billing_choice: 'credits', fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_old', authorizationCents: 2220 } },
  }), { action: 'cancel' })
  assert.equal(credits.hold, 'none')
  const bare = quoteRiderSwitch(matchedTrip({ metadata: {} }), { action: 'rerequest', nextFareCents: 1850 })
  assert.equal(bare.hold, 'place')
})

test('the switch closes once the driver is at pickup or the ride has started', () => {
  for (const status of ['arrived', 'cancelled_wait']) {
    const quote = quoteRiderSwitch(matchedTrip({ status }))
    assert.equal(quote.allowed, false)
    assert.equal(quote.code, 'at_pickup')
  }
  const started = quoteRiderSwitch(matchedTrip({ status: 'in_progress' }))
  assert.equal(started.allowed, false)
  assert.equal(started.code, 'in_progress')
  const searching = quoteRiderSwitch(matchedTrip({ status: 'searching', driver_id: null }))
  assert.equal(searching.allowed, false)
  assert.equal(searching.code, 'not_matched')
})

test('cancel clears the matched driver and switching assigns the next offered driver', () => {
  const canceled = commitRiderSwitch({
    trip: matchedTrip(),
    action: 'cancel',
    now: '2026-10-07T12:00:00.000Z',
  })
  assert.equal(canceled.ok, true)
  assert.equal(canceled.update.status, 'canceled')
  assert.equal(canceled.update.driver_id, null)
  assert.equal(canceled.next, 'home')
  assert.equal(canceled.quote.feeCents, 0)

  const switched = commitRiderSwitch({
    trip: matchedTrip(),
    action: 'switch-driver',
    driverId: 'driver-b',
    drivers: [{ id: 'driver-b' }],
    nextFareCents: 1850,
    now: '2026-10-07T12:00:00.000Z',
  })
  assert.equal(switched.ok, true)
  assert.equal(switched.update.status, 'searching')
  assert.equal(switched.update.driver_id, null)
  assert.equal(switched.update.deposit_cents, 0)
  assert.equal(switched.notifyDriverId, 'driver-b')
  assert.equal(switched.update.metadata.offer_driver_id, 'driver-b')
  assert.deepEqual(switched.update.metadata.offer_passed_driver_ids, ['driver-a'])

  const same = commitRiderSwitch({
    trip: matchedTrip(),
    action: 'switch-driver',
    driverId: 'driver-a',
    drivers: [{ id: 'driver-a' }],
  })
  assert.equal(same.ok, false)
  assert.equal(same.code, 'driver_unavailable')
})

test('switching to Carpool keeps the ride and reprices that tier', () => {
  const committed = commitRiderSwitch({
    trip: matchedTrip(),
    action: 'switch-tier',
    tier: 'carpool',
    drivers: [{ id: 'driver-c' }],
    nextFareCents: 1573,
    now: '2026-10-07T12:00:00.000Z',
  })
  assert.equal(committed.ok, true)
  assert.equal(committed.update.tier, 'carpool')
  assert.equal(committed.update.fare_cents, 1573)
  assert.equal(committed.update.status, 'searching')
  assert.equal(committed.quote.hold, 'keep')
  assert.equal(committed.next, 'ride')
})

test('opening the separate carpool hub cancels this ride and releases the hold', () => {
  const committed = commitRiderSwitch({
    trip: matchedTrip(),
    action: 'open-carpool',
    now: '2026-10-07T12:00:00.000Z',
  })
  assert.equal(committed.ok, true)
  assert.equal(committed.next, 'carpool')
  assert.equal(committed.update.status, 'canceled')
  assert.equal(committed.quote.hold, 'release')
})

function query(result) {
  const self = {
    select() { return self },
    eq() { return self },
    in() { return self },
    insert: async () => ({ data: null, error: null }),
    update() { return self },
    maybeSingle: async () => result,
    then(resolve, reject) {
      return Promise.resolve({ data: result.data, error: result.error || null }).then(resolve, reject)
    },
  }
  return self
}

function fakeSb(trip) {
  return {
    from(table) {
      if (table === 'trips') {
        let patch = null
        const self = query({ data: trip, error: null })
        self.update = (next) => {
          patch = next
          return self
        }
        self.maybeSingle = async () => ({
          data: patch
            ? {
              id: trip.id,
              status: patch.status,
              driver_id: patch.driver_id ?? null,
              tier: patch.tier ?? trip.tier,
              fare_cents: patch.fare_cents ?? trip.fare_cents,
            }
            : trip,
          error: null,
        })
        self.then = (resolve, reject) => Promise.resolve({ data: trip, error: null }).then(resolve, reject)
        return self
      }
      if (table === 'profiles') {
        return query({
          data: { id: trip.rider_id, stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1' },
          error: null,
        })
      }
      return query({ data: null, error: null })
    },
  }
}

const user = { id: 'rider-1', email: 'rider@clemson.edu' }

test('preview lists Standard, Wait & Save, Extra Comfort, and Carpool with the current type closed', async () => {
  const result = await handleRiderSwitch(fakeSb(matchedTrip()), user, { tripId: 'trip-1', confirm: false }, {
    prefs: { preferredIds: [], favoriteIds: [], discountBps: 0 },
    gameDayMultiplier: null,
    listDrivers: async () => ({ drivers: [{ id: 'driver-b', name: 'Blair', detail: 'Orange Honda Civic' }] }),
    priceTier: async (tier) => ({ fareCents: tier === 'carpool' ? 1573 : 1850, error: null }),
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.quote.feeCents, 0)
  assert.deepEqual(result.body.tiers.map((row) => row.id), [...OFFERED_RIDE_TIERS])
  assert.equal(result.body.tiers.find((row) => row.id === 'standard').current, true)
  assert.equal(result.body.tiers.find((row) => row.id === 'standard').available, false)
  assert.equal(result.body.tiers.find((row) => row.id === 'carpool').available, true)
  assert.equal(result.body.tiers.find((row) => row.id === 'carpool').fareCents, 1573)
  assert.equal(result.body.drivers[0].name, 'Blair')
})

test('confirming a cancel releases the Stripe hold and clears the driver', async () => {
  const canceled = []
  const stripe = {
    paymentIntents: {
      cancel: async (id) => { canceled.push(id); return { id, status: 'canceled' } },
    },
  }
  const result = await handleRiderSwitch(fakeSb(matchedTrip()), user, {
    tripId: 'trip-1',
    confirm: true,
    action: 'cancel',
  }, {
    prefs: { preferredIds: [], favoriteIds: [], discountBps: 0 },
    gameDayMultiplier: null,
    stripe,
    now: '2026-10-07T12:00:00.000Z',
    listDrivers: async () => ({ drivers: [] }),
    priceTier: async () => ({ fareCents: 1850, error: null }),
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.trip.status, 'canceled')
  assert.equal(result.body.next, 'home')
  assert.deepEqual(canceled, ['pi_old'])
})

test('a fare increase increments the existing hold before the driver changes', async () => {
  const increments = []
  const stripe = {
    paymentIntents: {
      incrementAuthorization: async (id, body) => {
        increments.push({ id, amount: body.amount })
        return { id, status: 'requires_capture' }
      },
    },
  }
  const result = await handleRiderSwitch(fakeSb(matchedTrip()), user, {
    tripId: 'trip-1',
    confirm: true,
    action: 'switch-tier',
    tier: 'comfort',
  }, {
    prefs: { preferredIds: [], favoriteIds: [], discountBps: 0 },
    gameDayMultiplier: null,
    stripe,
    now: '2026-10-07T12:00:00.000Z',
    listDrivers: async () => ({ drivers: [{ id: 'driver-b' }] }),
    priceTier: async (tier) => ({ fareCents: tier === 'comfort' ? 3000 : 1850, error: null }),
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.trip.tier, 'comfort')
  assert.equal(increments[0].id, 'pi_old')
  assert.equal(increments[0].amount, 3600)
})

test('another account cannot switch the ride', async () => {
  const result = await handleRiderSwitch(fakeSb(matchedTrip()), { id: 'other' }, { tripId: 'trip-1' }, {
    prefs: {},
    gameDayMultiplier: null,
    listDrivers: async () => ({ drivers: [] }),
    priceTier: async () => ({ fareCents: 1850, error: null }),
  })
  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'not_rider')
})

test('settleSwitchHold places a new manual-capture hold when the ride has none', async () => {
  const created = []
  const stripe = {
    paymentIntents: {
      create: async (body) => {
        created.push(body)
        return { id: 'pi_new', status: 'requires_capture' }
      },
      cancel: async () => ({ status: 'canceled' }),
    },
  }
  const settled = await settleSwitchHold({
    stripe,
    sb: null,
    trip: matchedTrip({ metadata: {} }),
    quote: { hold: 'place' },
    riderId: 'rider-1',
    customerId: 'cus_1',
    paymentMethodId: 'pm_1',
    fareCents: 1850,
  })
  assert.equal(settled.ok, true)
  assert.equal(created[0].capture_method, 'manual')
  assert.equal(created[0].amount, 2220)
  assert.equal(settled.patch.fare_authorization.paymentIntentId, 'pi_new')
  assert.equal(settled.patch.fare_authorization.status, 'requires_capture')
})

test('the driver trip screen starts location sharing from the active trip', () => {
  const source = readFileSync(new URL('../apps/driver/app/trip.tsx', import.meta.url), 'utf8')
  assert.match(source, /useDriverLocation\(Boolean\(user && trip && trip\.status !== 'completed'/)
})
