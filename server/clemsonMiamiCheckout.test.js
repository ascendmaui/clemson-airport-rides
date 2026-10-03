import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import handler from './endpoints/clemsonMiamiCheckout.js'
import { zonedCivilToUtc } from './authoritativeFare.js'
import {
  CLEMSON_MIAMI_DROPOFF,
  CLEMSON_MIAMI_END_MS,
  CLEMSON_MIAMI_FARE_CENTS,
  CLEMSON_MIAMI_PICKUP,
  CLEMSON_MIAMI_PROMO_ID,
  CLEMSON_MIAMI_PUBLIC_URL,
  CLEMSON_MIAMI_START_MS,
} from '../packages/rides-native/clemsonMiamiPromo.js'

const DURING = new Date('2026-10-03T19:00:00.000Z')
const AT_DEADLINE = new Date(CLEMSON_MIAMI_END_MS)
const AFTER = new Date('2026-10-03T23:31:00.000Z')

const SPOOF = {
  ride: 'clemson-miami',
  fareCents: 0,
  depositCents: 0,
  amount: 0,
  total: 0,
  isStudent: true,
  airport: 'GSP',
  origin: 'https://clemsonrides.com',
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function call(user, sb, stripe, now) {
  const res = mockRes()
  await handler({ method: 'POST', headers: {}, body: SPOOF }, res, {
    user,
    sb,
    now,
    stripeOk: () => true,
    stripe,
    ensureProfile: async () => ({ ok: true }),
  })
  return { status: res.statusCode, json: JSON.parse(res.body) }
}

function createSb() {
  const trips = []
  let seq = 0
  return {
    trips,
    async rpc() {
      return { data: [{ id: 'bound' }], error: null }
    },
    from(table) {
      const filters = []
      const chain = {
        select() { return chain },
        eq(col, val) {
          filters.push([col, val])
          return chain
        },
        insert(payload) {
          if (table !== 'trips') return Promise.resolve({ data: null, error: null })
          const trip = { id: `trip_${++seq}`, ...payload }
          trips.push(trip)
          const inserted = {
            select() { return inserted },
            async single() { return { data: { id: trip.id }, error: null } },
          }
          return inserted
        },
        update(payload) {
          return {
            eq(col, val) {
              for (const trip of trips) {
                if (trip[col] === val) Object.assign(trip, payload)
              }
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
        then(resolve, reject) {
          try {
            const rows = table === 'trips'
              ? trips.filter((trip) => filters.every(([col, val]) => trip[col] === val))
              : []
            resolve({ data: rows, error: null })
          } catch (err) {
            reject(err)
          }
        },
      }
      return chain
    },
  }
}

function rider(id) {
  return {
    id,
    email: `${id}@gmail.com`,
    user_metadata: { full_name: 'Alex Fan' },
  }
}

test('promo checkout charges 100 cents once, a second ride does not, and after 7:30 PM Eastern does not', async () => {
  assert.equal(zonedCivilToUtc(2026, 10, 3, 0, 0, 0).getTime(), CLEMSON_MIAMI_START_MS)
  assert.equal(zonedCivilToUtc(2026, 10, 3, 19, 30, 0).getTime(), CLEMSON_MIAMI_END_MS)
  assert.equal(CLEMSON_MIAMI_PUBLIC_URL, 'https://clemsonrides.com/#/sign-up?ride=clemson-miami')
  assert.equal(CLEMSON_MIAMI_FARE_CENTS, 100)
  assert.equal(AFTER.getTime() > CLEMSON_MIAMI_END_MS, true)

  const src = readFileSync(new URL('./endpoints/clemsonMiamiCheckout.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /body\.fareCents|body\.depositCents|body\.amount|body\.total|body\.isStudent|body\.airport/)
  assert.doesNotMatch(src, /depositCents <= 0/)
  const client = readFileSync(new URL('../src/lib/clemsonMiamiRide.js', import.meta.url), 'utf8')
  assert.doesNotMatch(client, /fareCents|depositCents|isStudent/)

  const sb = createSb()
  const stripeCalls = []
  const stripe = {
    checkout: {
      sessions: {
        async create(params) {
          stripeCalls.push(params)
          return { id: `cs_${stripeCalls.length}`, url: `https://checkout.stripe.com/pay/${stripeCalls.length}` }
        },
      },
    },
  }

  const first = await call(rider('rider-a'), sb, stripe, DURING)
  assert.equal(first.status, 200)
  assert.equal(first.json.chargedCents, 100)
  assert.equal(first.json.fareCents, 100)
  assert.equal(first.json.promoApplied, true)
  assert.equal(first.json.airport, null)
  assert.equal(typeof first.json.url, 'string')
  assert.equal(stripeCalls.length, 1)
  const line = stripeCalls[0].line_items[0].price_data
  assert.equal(line.unit_amount, 100)
  assert.equal(line.currency, 'usd')
  assert.equal(stripeCalls[0].mode, 'payment')
  assert.match(stripeCalls[0].success_url, /session_id=\{CHECKOUT_SESSION_ID\}/)
  assert.doesNotMatch(line.product_data.name, /airport|GSP|CLT|deposit/i)
  assert.equal(stripeCalls[0].metadata.kind, 'promo_ride')
  assert.equal(sb.trips.length, 1)
  const trip = sb.trips[0]
  assert.equal(trip.fare_cents, 100)
  assert.equal(trip.deposit_cents, 100)
  assert.equal(trip.pickup_label, CLEMSON_MIAMI_PICKUP.label)
  assert.match(trip.pickup_label, /Clemson/)
  assert.equal(trip.dropoff_label, 'Clemson Miami game')
  assert.equal(trip.dropoff_label, CLEMSON_MIAMI_DROPOFF.label)
  assert.notEqual(trip.pickup_lat, 34.8956)
  assert.notEqual(trip.dropoff_lat, 35.2144)
  assert.equal(trip.metadata.airport, null)
  assert.equal(trip.metadata.kind, 'campus')
  assert.equal(trip.metadata.promo, CLEMSON_MIAMI_PROMO_ID)
  assert.equal(trip.metadata.student_discount_cents, 0)
  assert.equal(trip.surge_multiplier, 1)
  assert.match(trip.metadata.driver_notification.title, /promo/i)
  assert.match(trip.metadata.driver_notification.body, /promo ride/i)
  assert.match(trip.metadata.driver_notification.body, /fare \$1/)
  assert.match(trip.metadata.driver_notification.body, /within Clemson/)
  assert.match(trip.metadata.driver_notification.body, /Clemson Miami game/)
  assert.match(trip.metadata.driver_notification.body, /until 7:30 PM/)
  assert.match(first.json.notification.body, /4 hr 30 min until 7:30 PM/)

  const second = await call(rider('rider-a'), sb, stripe, new Date('2026-10-03T19:10:00.000Z'))
  assert.equal(second.status, 409)
  assert.equal(second.json.chargedCents, null)
  assert.equal(second.json.promoApplied, false)
  assert.equal(stripeCalls.length, 1)
  assert.equal(sb.trips.length, 1)
  assert.notEqual(second.json.chargedCents, 100)

  const atDeadline = await call(rider('rider-c'), sb, stripe, AT_DEADLINE)
  assert.equal(atDeadline.status, 200)
  assert.equal(atDeadline.json.chargedCents, 100)
  assert.equal(stripeCalls.length, 2)
  assert.equal(stripeCalls[1].line_items[0].price_data.unit_amount, 100)

  const after = await call(rider('rider-d'), sb, stripe, AFTER)
  assert.equal(after.status, 403)
  assert.equal(after.json.chargedCents, null)
  assert.equal(after.json.promoApplied, false)
  assert.equal(stripeCalls.length, 2)
  assert.equal(sb.trips.filter((row) => row.rider_id === 'rider-d').length, 0)
  assert.notEqual(after.json.chargedCents, 100)
})
