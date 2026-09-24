import assert from 'node:assert/strict'
import test from 'node:test'
import { settleCarpoolSideEffects } from './carpoolSettle.js'

const TRIP = '11111111-1111-4111-8111-111111111111'
const RIDE = '22222222-2222-4222-8222-222222222222'

function rideWith(code) {
  return {
    id: RIDE,
    fare_breakdown: {
      carpool: { shares: [] },
      ambassador_code: code,
    },
  }
}

function ledgerSb({ uniqueError = false, error = null } = {}) {
  const rows = []
  const calls = []
  const sb = {
    from(table) {
      return {
        upsert(payload, options) {
          calls.push({ table, op: 'upsert', payload: { ...payload }, options: { ...options } })
          return {
            select(columns) {
              calls.push({ table, op: 'select', columns })
              if (error) return Promise.resolve({ data: null, error })
              const dup = rows.find((row) => row.trip_id === payload.trip_id && row.code === payload.code)
              if (dup) {
                if (uniqueError) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      code: '23505',
                      message: 'duplicate key value violates unique constraint "ambassador_payout_ledger_trip_code_uniq"',
                      details: `Key (trip_id, code)=(${payload.trip_id}, ${payload.code}) already exists.`,
                    },
                  })
                }
                return Promise.resolve({ data: [], error: null })
              }
              const row = { id: `ledger-${rows.length + 1}`, ...payload }
              rows.push(row)
              return Promise.resolve({ data: [{ id: row.id }], error: null })
            },
          }
        },
      }
    },
  }
  return { sb, rows, calls }
}

const participants = [{ id: 'p1' }, { id: 'p2' }]

test('settling the same trip twice ledgers one row and the second call is a no-op', async () => {
  const { sb, rows, calls } = ledgerSb()
  const first = await settleCarpoolSideEffects(sb, {
    ride: rideWith('amb_tiger1'),
    trip: { id: TRIP },
    participants,
  })
  const second = await settleCarpoolSideEffects(sb, {
    ride: rideWith('amb_tiger1'),
    trip: { id: TRIP },
    participants,
  })

  assert.equal(first.ok, true)
  assert.equal(first.results.ambassador, 'ledgered')
  assert.equal(second.ok, true)
  assert.equal(second.results.ambassador, 'already_ledgered')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].code, 'amb_tiger1')
  assert.equal(rows[0].trip_id, TRIP)
  assert.equal(rows[0].friend_ride_id, RIDE)
  assert.equal(rows[0].seats, 2)
  assert.equal(rows[0].amount_cents, 300)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].code_type, 'ambassador')
  assert.equal(rows[0].profile_id, undefined)

  const upserts = calls.filter((call) => call.op === 'upsert')
  assert.equal(upserts.length, 2)
  for (const call of upserts) {
    assert.equal(call.table, 'ambassador_payout_ledger')
    assert.equal(call.options.onConflict, 'trip_id,code')
    assert.equal(call.options.ignoreDuplicates, true)
  }
  assert.equal(calls.filter((call) => call.op === 'select').length, 2)

  const otherTrip = await settleCarpoolSideEffects(sb, {
    ride: rideWith('amb_tiger1'),
    trip: { id: '33333333-3333-4333-8333-333333333333' },
    participants,
  })
  const otherCode = await settleCarpoolSideEffects(sb, {
    ride: rideWith('amb_other'),
    trip: { id: TRIP },
    participants,
  })
  assert.equal(otherTrip.results.ambassador, 'ledgered')
  assert.equal(otherCode.results.ambassador, 'ledgered')
  assert.equal(rows.length, 3)
})

test('a Postgres 23505 unique violation is already_ledgered and does not add a row', async () => {
  const { sb, rows } = ledgerSb({ uniqueError: true })
  const first = await settleCarpoolSideEffects(sb, {
    ride: rideWith('amb_tiger1'),
    trip: { id: TRIP },
    participants,
  })
  const second = await settleCarpoolSideEffects(sb, {
    ride: rideWith('amb_tiger1'),
    trip: { id: TRIP },
    participants,
  })
  assert.equal(first.results.ambassador, 'ledgered')
  assert.equal(second.results.ambassador, 'already_ledgered')
  assert.equal(rows.length, 1)
})

test('a non-unique ledger error is reported and is not treated as already ledgered', async () => {
  const { sb, rows } = ledgerSb({ error: { code: '42501', message: 'permission denied for table ambassador_payout_ledger' } })
  const result = await settleCarpoolSideEffects(sb, {
    ride: rideWith('amb_tiger1'),
    trip: { id: TRIP },
    participants,
  })
  assert.equal(result.ok, true)
  assert.equal(result.results.ambassador, 'permission denied for table ambassador_payout_ledger')
  assert.equal(rows.length, 0)
})
