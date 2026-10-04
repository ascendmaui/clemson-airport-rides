import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import driverHandler from '../api/driver.js'
import {
  applyRiderTipChoice,
  CUSTOM_TIP_EMPTY,
  CUSTOM_TIP_FORMAT,
  CUSTOM_TIP_NEGATIVE,
  CUSTOM_TIP_RANGE,
  priceCustomTip,
  priceTipPresets,
  resolveTipChoice,
} from './riderTipChoice.js'

const NOW = new Date('2026-10-04T18:00:00.000Z')

function mockRes() {
  return {
    statusCode: 0,
    body: '',
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function mockSb(trip = {}, { failTipColumn = false } = {}) {
  const state = {
    trip: {
      id: 'trip-1',
      rider_id: 'rider-1',
      driver_id: 'driver-1',
      status: 'completed',
      fare_cents: 2000,
      tip_cents: 0,
      metadata: { kind: 'campus' },
      ...trip,
    },
    updates: [],
    tables: [],
    tipSelects: 0,
    failTipColumn,
  }

  function tripsBuilder() {
    const filters = []
    let patch = null
    let op = 'select'
    const run = async () => {
      const matches = () => filters.every(([col, val]) => state.trip[col] === val)
      if (op === 'update') {
        if (!matches()) return { data: null, error: { message: 'no row' } }
        if (Object.prototype.hasOwnProperty.call(patch, 'tip_cents')) {
          return { data: null, error: { message: 'refused tip_cents write' } }
        }
        state.updates.push(patch)
        state.trip = { ...state.trip, ...patch }
        return { data: state.trip, error: null }
      }
      if (state.failTipColumn && state.tipSelects === 0) {
        state.tipSelects += 1
        return { data: null, error: { message: 'column tip_cents does not exist in schema cache' } }
      }
      if (!matches()) return { data: null, error: null }
      const data = { ...state.trip }
      if (state.failTipColumn) delete data.tip_cents
      return { data, error: null }
    }
    const builder = {
      select() { return builder },
      update(next) { op = 'update'; patch = next; return builder },
      eq(col, val) { filters.push([col, val]); return builder },
      maybeSingle() { return run() },
      then(resolve, reject) { return run().then(resolve, reject) },
    }
    return builder
  }

  return {
    state,
    from(table) {
      state.tables.push(table)
      if (table === 'payments') throw new Error('payments must not be touched')
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: { full_name: 'Alex Driver' }, error: null }),
                }
              },
            }
          },
        }
      }
      if (table === 'trips') return tripsBuilder()
      throw new Error(`unexpected table ${table}`)
    },
  }
}

test('tip presets are a percent of the stored fare', () => {
  const priced = priceTipPresets(2000)
  assert.equal(priced.basis, 'percent')
  assert.deepEqual(priced.presets.map((row) => row.cents), [300, 400, 500])
  assert.deepEqual(priced.presets.map((row) => row.percent), [15, 20, 25])
  assert.equal(priced.popularId, 'pct-20')
})

test('a missing or zero fare uses fixed server amounts', () => {
  for (const fare of [null, undefined, 0, '']) {
    const priced = priceTipPresets(fare)
    assert.equal(priced.basis, 'no_fare')
    assert.deepEqual(priced.presets.map((row) => row.cents), [200, 300, 500])
  }
})

test('a small fare does not collapse every button to the same dollar', () => {
  const priced = priceTipPresets(400)
  assert.equal(priced.basis, 'low_fare')
  assert.deepEqual(priced.presets.map((row) => row.cents), [100, 200, 500])
  assert.equal(new Set(priced.presets.map((row) => row.cents)).size, 3)
})

test('a large fare stays under the tip cap and stays distinct', () => {
  const priced = priceTipPresets(80000)
  assert.equal(priced.basis, 'percent')
  assert.deepEqual(priced.presets.map((row) => row.cents), [6000, 8000, 10000])
  assert.ok(priced.presets.every((row) => row.cents <= 10000))
})

test('a typed custom tip is priced in cents inside the existing range', () => {
  assert.deepEqual(priceCustomTip('4.50'), { ok: true, cents: 450 })
  assert.deepEqual(priceCustomTip('$1'), { ok: true, cents: 100 })
  assert.deepEqual(priceCustomTip('100.00'), { ok: true, cents: 10000 })
  assert.deepEqual(priceCustomTip(7.25), { ok: true, cents: 725 })
  assert.equal(priceCustomTip('').error, CUSTOM_TIP_EMPTY)
  assert.equal(priceCustomTip('   ').error, CUSTOM_TIP_EMPTY)
  assert.equal(priceCustomTip(null).error, CUSTOM_TIP_EMPTY)
  assert.equal(priceCustomTip('-3').error, CUSTOM_TIP_NEGATIVE)
  assert.equal(priceCustomTip(-1).error, CUSTOM_TIP_NEGATIVE)
  assert.equal(priceCustomTip('0').error, CUSTOM_TIP_RANGE)
  assert.equal(priceCustomTip('0.99').error, CUSTOM_TIP_RANGE)
  assert.equal(priceCustomTip('100.01').error, CUSTOM_TIP_RANGE)
  assert.equal(priceCustomTip('999999').error, CUSTOM_TIP_RANGE)
  assert.equal(priceCustomTip('nope').error, CUSTOM_TIP_FORMAT)
  assert.equal(priceCustomTip('4.567').error, CUSTOM_TIP_FORMAT)

  const resolved = resolveTipChoice(2000, 'custom', '4.50')
  assert.equal(resolved.ok, true)
  assert.equal(resolved.choice.id, 'custom')
  assert.equal(resolved.choice.tipCents, 450)
  assert.equal(resolved.choice.percent, null)
  assert.equal(resolved.choice.charged, false)
  assert.equal(resolved.choice.chargeStatus, 'not_wired')
  assert.equal(resolveTipChoice(1, 'custom', '4.50').choice.tipCents, 450)
})

test('resolve uses the preset id and ignores a client cent amount', () => {
  const resolved = resolveTipChoice(2000, 'pct-15')
  assert.equal(resolved.ok, true)
  assert.equal(resolved.choice.tipCents, 300)
  assert.equal(resolved.choice.charged, false)
  assert.equal(resolved.choice.chargeStatus, 'not_wired')
  const skip = resolveTipChoice(2000, 'skip')
  assert.equal(skip.choice.tipCents, 0)
  assert.equal(skip.choice.skipped, true)
  assert.equal(resolveTipChoice(2000, 'pct-99').ok, false)
})

test('offer prices from the trip fare and ignores client money fields', async () => {
  const sb = mockSb({ fare_cents: 2000 })
  const result = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'offer',
    tripId: 'trip-1',
    tipCents: 1,
    amountCents: 1,
    amount: 1,
    total: 1,
    fare: 1,
    fareCents: 1,
    deposit: 1,
    depositCents: 1,
    isStudent: true,
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.chargingWired, false)
  assert.equal(result.body.fareCents, 2000)
  assert.deepEqual(result.body.presets.map((row) => row.cents), [300, 400, 500])
  assert.equal(result.body.driverName, 'Alex')
  assert.equal(result.body.choice, null)
  assert.deepEqual(sb.state.updates, [])
  assert.ok(!sb.state.tables.includes('payments'))
})

test('record stores the server amount and does not write a charge', async () => {
  const sb = mockSb()
  const result = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'pct-20',
    tipCents: 999999,
    amount: 50,
    total: 50,
    fareCents: 1,
    depositCents: 0,
    isStudent: true,
  }, { now: () => NOW })
  assert.equal(result.status, 200)
  assert.equal(result.body.choice.tipCents, 400)
  assert.equal(result.body.choice.charged, false)
  assert.equal(result.body.chargingWired, false)
  assert.equal(sb.state.updates.length, 1)
  assert.deepEqual(Object.keys(sb.state.updates[0]), ['metadata'])
  assert.equal(sb.state.trip.metadata.kind, 'campus')
  assert.equal(sb.state.trip.metadata.rider_tip_choice.tipCents, 400)
  assert.equal(sb.state.trip.metadata.rider_tip_choice.chargeStatus, 'not_wired')
  assert.equal(sb.state.trip.tip_cents, 0)
  assert.ok(!sb.state.tables.includes('payments'))
})

test('skip records no tip and a campus trip with no fare still does not charge', async () => {
  const sb = mockSb({ fare_cents: null, metadata: { kind: 'campus', card: false } }, { failTipColumn: true })
  const offer = await applyRiderTipChoice(sb, { id: 'rider-1' }, { mode: 'offer', tripId: 'trip-1' })
  assert.equal(offer.status, 200)
  assert.equal(offer.body.basis, 'no_fare')
  assert.deepEqual(offer.body.presets.map((row) => row.cents), [200, 300, 500])
  const saved = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'skip',
    tipCents: 500,
  }, { now: () => NOW })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.choice.skipped, true)
  assert.equal(saved.body.choice.tipCents, 0)
  assert.equal(saved.body.chargingWired, false)
  assert.equal(sb.state.trip.metadata.kind, 'campus')
  assert.ok(!sb.state.tables.includes('payments'))
})

test('a second different choice is refused and the same choice is idempotent', async () => {
  const sb = mockSb()
  await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'pct-15',
  }, { now: () => NOW })
  const again = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'pct-25',
    tipCents: 1,
  })
  assert.equal(again.status, 409)
  assert.equal(again.body.choice.tipCents, 300)
  const same = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'pct-15',
  })
  assert.equal(same.status, 200)
  assert.equal(same.body.alreadyRecorded, true)
  assert.equal(sb.state.updates.length, 1)
})

test('only a completed trip owned by the rider can be tipped', async () => {
  const open = mockSb({ status: 'in_progress' })
  const early = await applyRiderTipChoice(open, { id: 'rider-1' }, { mode: 'record', tripId: 'trip-1', choiceId: 'skip' })
  assert.equal(early.status, 409)
  assert.equal(open.state.updates.length, 0)

  const other = mockSb()
  const denied = await applyRiderTipChoice(other, { id: 'someone-else' }, { mode: 'offer', tripId: 'trip-1' })
  assert.equal(denied.status, 404)

  const charged = mockSb({ tip_cents: 500 })
  const blocked = await applyRiderTipChoice(charged, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'pct-20',
  })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.chargedTipCents, 500)
  assert.equal(charged.state.updates.length, 0)
})

test('a custom amount is stored from the typed dollars and ignores client money', async () => {
  const sb = mockSb({ fare_cents: 2000 })
  const result = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'custom',
    customDollars: '4.50',
    tipCents: 1,
    customCents: 1,
    amountCents: 1,
    amount: 99,
    total: 99,
    fare: 1,
    fareCents: 1,
    deposit: 1,
    depositCents: 1,
    isStudent: true,
  }, { now: () => NOW })
  assert.equal(result.status, 200)
  assert.equal(result.body.choice.id, 'custom')
  assert.equal(result.body.choice.tipCents, 450)
  assert.equal(result.body.choice.percent, null)
  assert.equal(result.body.choice.charged, false)
  assert.equal(result.body.chargingWired, false)
  assert.equal(result.body.chargedTipCents, 0)
  assert.deepEqual(Object.keys(sb.state.updates[0]), ['metadata'])
  assert.equal(sb.state.trip.metadata.kind, 'campus')
  assert.equal(sb.state.trip.metadata.rider_tip_choice.id, 'custom')
  assert.equal(sb.state.trip.metadata.rider_tip_choice.tipCents, 450)
  assert.equal(sb.state.trip.metadata.rider_tip_choice.fareCents, 2000)
  assert.equal(sb.state.trip.metadata.rider_tip_choice.chargeStatus, 'not_wired')
  assert.equal(sb.state.trip.tip_cents, 0)
  assert.ok(!sb.state.tables.includes('payments'))
})

test('custom tip rejects empty, negative, and absurd amounts without saving', async () => {
  const cases = [
    [{ customDollars: '' }, CUSTOM_TIP_EMPTY],
    [{ customDollars: '   ' }, CUSTOM_TIP_EMPTY],
    [{ customDollars: '-5' }, CUSTOM_TIP_NEGATIVE],
    [{ amount: -5 }, CUSTOM_TIP_EMPTY],
    [{ customDollars: '250', tipCents: 25000, amount: 250 }, CUSTOM_TIP_RANGE],
    [{ customDollars: '0.25', fare: 4000, total: 4000, isStudent: false }, CUSTOM_TIP_RANGE],
  ]
  for (const [extra, message] of cases) {
    const sb = mockSb()
    const result = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
      mode: 'record',
      tripId: 'trip-1',
      choiceId: 'custom',
      ...extra,
    })
    assert.equal(result.status, 400)
    assert.equal(result.body.error, message)
    assert.equal(result.body.chargingWired, false)
    assert.equal(sb.state.updates.length, 0)
    assert.ok(!sb.state.tables.includes('payments'))
  }
})

test('the same custom amount is idempotent and a different one stays saved', async () => {
  const sb = mockSb()
  const first = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'custom',
    customDollars: '6',
    amount: 1,
    fareCents: 1,
  }, { now: () => NOW })
  assert.equal(first.status, 200)
  assert.equal(first.body.choice.tipCents, 600)
  const same = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'custom',
    customDollars: '$6.00',
    tipCents: 1,
  })
  assert.equal(same.status, 200)
  assert.equal(same.body.alreadyRecorded, true)
  assert.equal(same.body.choice.tipCents, 600)
  const changed = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'custom',
    customDollars: '8.00',
  })
  assert.equal(changed.status, 409)
  assert.equal(changed.body.choice.tipCents, 600)
  const preset = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'pct-20',
    customDollars: '8.00',
  })
  assert.equal(preset.status, 409)
  assert.equal(sb.state.updates.length, 1)
  assert.equal(sb.state.trip.metadata.rider_tip_choice.tipCents, 600)
})

test('a preset choice ignores a typed custom amount', async () => {
  const sb = mockSb()
  const result = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'record',
    tripId: 'trip-1',
    choiceId: 'pct-15',
    customDollars: '50',
    amount: 50,
    total: 50,
    fare: 1,
    deposit: 0,
    isStudent: true,
  }, { now: () => NOW })
  assert.equal(result.status, 200)
  assert.equal(result.body.choice.id, 'pct-15')
  assert.equal(result.body.choice.tipCents, 300)
  assert.equal(sb.state.trip.metadata.rider_tip_choice.tipCents, 300)
})

test('the offer tells the website the custom range and still ignores client money', async () => {
  const sb = mockSb({ fare_cents: 2000 })
  const result = await applyRiderTipChoice(sb, { id: 'rider-1' }, {
    mode: 'offer',
    tripId: 'trip-1',
    customDollars: '80',
    amount: 1,
    fare: 1,
    total: 1,
    deposit: 1,
    isStudent: true,
  })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.custom, { minCents: 100, maxCents: 10000 })
  assert.deepEqual(result.body.presets.map((row) => row.cents), [300, 400, 500])
  assert.equal(sb.state.updates.length, 0)
})

test('charge mode and a raw cent amount are rejected', async () => {
  const sb = mockSb()
  const charge = await applyRiderTipChoice(sb, { id: 'rider-1' }, { mode: 'charge', tripId: 'trip-1', tipCents: 500 })
  assert.equal(charge.status, 400)
  assert.match(charge.body.error, /not available/)
  const raw = await applyRiderTipChoice(sb, { id: 'rider-1' }, { mode: 'record', tripId: 'trip-1', tipCents: 500 })
  assert.equal(raw.status, 400)
  assert.equal(sb.state.updates.length, 0)
})

test('tip choice route does not call Stripe when the service role is missing', async () => {
  const source = readFileSync(new URL('./riderTipChoice.js', import.meta.url), 'utf8')
  const endpoint = readFileSync(new URL('./endpoints/riderTipChoice.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /stripe|paymentIntents|collectPayment/)
  assert.doesNotMatch(endpoint, /stripeClient|paymentIntents|collectPayment/)

  const res = mockRes()
  await driverHandler({
    method: 'POST',
    url: '/api/driver?action=tip-choice',
    headers: {},
    body: { mode: 'record', tripId: 'trip-1', choiceId: 'pct-20', tipCents: 5000 },
  }, res)
  assert.equal(res.statusCode, 503)
  assert.match(res.body, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(res.body, /paymentIntent|charged/)
})
