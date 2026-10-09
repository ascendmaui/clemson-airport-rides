import test from 'node:test'
import assert from 'node:assert/strict'
import { sweepWaitAutoCancel } from './waitAutoCancelSweep.js'
import { sweepWaitFeeCharge } from './waitFeeChargeSweep.js'
import sweeps, { SWEEPS } from './endpoints/tripSweeps.js'
import { call } from '../tests/fixtures/cancelFareHolds.js'

const now = new Date('2026-10-09T16:00:00Z')
function db(trips, payments = []) {
  const queries = []
  return { queries, from(table) {
    const operations = []
    queries.push({ table, operations })
    let rows = [...(table === 'trips' ? trips : payments)]
    const q = {
      select(columns) { operations.push(['select', columns]); return q },
      eq(column, value) { operations.push(['eq', column, value]); rows = rows.filter(r => r[column] === value); return q },
      lte(column, value) { operations.push(['lte', column, value]); rows = rows.filter(r => r[column] != null && Date.parse(r[column]) <= Date.parse(value)); return q },
      gte(column, value) { operations.push(['gte', column, value]); rows = rows.filter(r => r[column] != null && Date.parse(r[column]) >= Date.parse(value)); return q },
      in(column, values) {
        operations.push(['in', column, values])
        if (column === 'payments.kind') rows = rows.map(r => ({ ...r, payments: payments.filter(p => p.trip_id === r.id && values.includes(p.kind)) }))
        else rows = rows.filter(r => values.includes(r[column]))
        return q
      },
      is(column, value) { operations.push(['is', column, value]); rows = rows.filter(r => column === 'payments' ? !r.payments.length : r[column] === value); return q },
      order(column, options) { operations.push(['order', column, options]); rows.sort((a, b) => (a[column] || '').localeCompare(b[column] || '')); return q },
      limit(count) { operations.push(['limit', count]); rows = rows.slice(0, count); return q },
      then(resolve, reject) { return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve, reject) },
    }
    return q
  } }
}
const waiting = (id, minutes, status = 'arrived') => ({ id, driver_id: `driver-${id}`, status, arrived_at: new Date(+now - minutes * 60000).toISOString() })
const canceled = (id, days = 1) => ({ id, driver_id: 'driver', status: 'cancelled_wait', canceled_at: new Date(+now - days * 86400000).toISOString() })

test('auto-cancel selects arrived at or beyond 7:00, caps at 25 and isolates failures', async () => {
  const sb = db([waiting('young', 6.99), waiting('other', 8, 'in_progress'), waiting('boundary', 7),
    ...Array.from({ length: 28 }, (_, i) => waiting(`old-${i}`, 8))])
  const calls = []
  const result = await sweepWaitAutoCancel(sb, { now, applyTripWait: async (_, args) => {
    calls.push(args)
    if (args.tripId === 'old-0') throw new Error('One trip failed')
    return { trip: { status: args.tripId === 'old-1' ? 'in_progress' : 'cancelled_wait' } }
  } })
  assert.equal(calls.length, 25)
  assert.equal(result.canceled, 23)
  assert.equal(result.failed, 1)
  assert.equal(result.skipped, 1)
  assert.ok(calls.every(c => c.action === 'tick' && c.actorId === `driver-${c.tripId}`))
  assert.ok(!calls.some(c => ['young', 'other'].includes(c.tripId)))
  assert.deepEqual(sb.queries[0].operations.slice(0, 3), [
    ['select', 'id, driver_id, status, arrived_at'], ['eq', 'status', 'arrived'], ['lte', 'arrived_at', '2026-10-09T15:53:00.000Z'],
  ])
  const boundary = await sweepWaitAutoCancel(db([waiting('boundary', 7)]), { now, applyTripWait: async () => ({ trip: { status: 'cancelled_wait' } }) })
  assert.deepEqual(boundary.ids.canceled, ['boundary'])
})
test('backstop excludes ANY wait/cancel payment status, old trips, and caps eligible work at 10', async () => {
  const trips = ['pending', 'failed', 'paid', 'cancel-only', 'unrelated', 'old'].map(id => canceled(id, id === 'old' ? 7.01 : 1))
  trips.push(...Array.from({ length: 15 }, (_, i) => canceled(`new-${i}`)))
  const payments = [
    { trip_id: 'pending', kind: 'wait_fee', status: 'pending' }, { trip_id: 'failed', kind: 'wait_fee', status: 'failed' },
    { trip_id: 'paid', kind: 'wait_fee', status: 'succeeded' }, { trip_id: 'cancel-only', kind: 'cancel_fee', status: 'failed' },
    { trip_id: 'unrelated', kind: 'fare', status: 'succeeded' },
  ]
  const sb = db(trips, payments)
  const charged = [], paid = []
  const result = await sweepWaitFeeCharge(sb, { now,
    chargeWaitFees: async (_, trip) => { charged.push(trip.id); return { status: 'succeeded' } },
    enqueueWaitCancelPayout: async ({ trip }) => { paid.push(trip.id); return { ok: true } },
  })
  assert.equal(result.charged, 10)
  assert.equal(charged.length, 10)
  assert.ok(charged.includes('unrelated'))
  assert.ok(!charged.some(id => ['pending', 'failed', 'paid', 'cancel-only', 'old'].includes(id)))
  assert.deepEqual(paid, charged)
  assert.ok(sb.queries[0].operations.some(op => op[0] === 'is' && op[1] === 'payments' && op[2] === null))
})
test('backstop rechecks races and isolates charge and payout failures; pays only succeeded charges', async () => {
  const base = db(['race', 'throws', 'failed', 'pending', 'paid', 'payout-fails'].map(id => canceled(id)))
  const from = base.from
  base.from = (table) => {
    if (table !== 'payments') return from(table)
    const q = from(table)
    const eq = q.eq
    q.eq = (col, value) => {
      if (value === 'race') return db([], [{ id: 'payment', trip_id: 'race', kind: 'wait_fee' }]).from('payments').eq(col, value)
      return eq(col, value)
    }
    return q
  }
  const payouts = []
  const result = await sweepWaitFeeCharge(base, { now,
    chargeWaitFees: async (_, trip) => {
      if (trip.id === 'throws') throw new Error('Charge failed')
      assert.notEqual(trip.id, 'race')
      return { status: ['failed', 'pending'].includes(trip.id) ? trip.id : 'succeeded' }
    },
    enqueueWaitCancelPayout: async ({ trip }) => { payouts.push(trip.id); return { ok: trip.id !== 'payout-fails' } },
  })
  assert.equal(result.failed, 3)
  assert.equal(result.skipped, 2)
  assert.equal(result.charged, 1)
  assert.deepEqual(payouts, ['paid', 'payout-fails'])
})
test('sweep dry runs never tick, charge, or transfer; selection errors propagate', async () => {
  for (const [run, row] of [[sweepWaitAutoCancel, waiting('wait', 8)], [sweepWaitFeeCharge, canceled('fee')]]) {
    const result = await run(db([row]), { now, dryRun: true,
      applyTripWait: () => assert.fail('no tick'), chargeWaitFees: () => assert.fail('no charge'), enqueueWaitCancelPayout: () => assert.fail('no transfer'),
    })
    assert.equal(result.skipped, 1)
    await assert.rejects(run({ from() { throw new Error('Selection failed') } }), /Selection failed/)
  }
})
test('endpoint registers both sweeps and totals canceled and charged counts and failures', async () => {
  assert.deepEqual(SWEEPS.map(s => s.name), ['canceled_holds', 'wait-auto-cancel', 'wait-fee-charge'])
  const response = await call(sweeps, {}, { sb: {}, env: { CRON_SECRET: 'test' }, sweeps: [
    { name: 'wait-auto-cancel', run: async () => ({ canceled: 2, failed: 1, ids: { canceled: ['a', 'b'], failed: ['c'] } }) },
    { name: 'wait-fee-charge', run: async () => ({ charged: 1, skipped: 1, ids: { charged: ['d'], skipped: ['e'] } }) },
  ] }, { headers: { authorization: 'Bearer test' } })
  assert.equal(response.statusCode, 500)
  assert.equal(response.body.canceled, 2)
  assert.equal(response.body.charged, 1)
  assert.deepEqual(response.body.ids.failed, ['c'])
})
