import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveAmbassadorCode,
  saveAmbassadorAttribution,
  stampAmbassadorCode,
} from './ambassadorAttribution.js'

function fakeSb({ codes = [], attributions = [] } = {}, calls) {
  const tables = {
    ambassador_codes: codes,
    ambassador_attributions: attributions,
  }
  return {
    from(table) {
      const filters = {}
      const builder = {
        select() { return builder },
        eq(key, value) {
          filters[key] = value
          return builder
        },
        maybeSingle() {
          calls.push({ table, op: 'select' })
          const data = (tables[table] || []).find((row) => (
            Object.entries(filters).every(([key, value]) => row[key] === value)
          )) || null
          return Promise.resolve({ data, error: null })
        },
        upsert(payload) {
          calls.push({ table, op: 'upsert', payload })
          return Promise.resolve({ error: null })
        },
        insert(payload) {
          calls.push({ table, op: 'insert', payload })
          return Promise.resolve({ data: payload, error: null })
        },
        update(payload) {
          return {
            eq(key, value) {
              calls.push({ table, op: 'update', payload, key, value })
              return Promise.resolve({ error: null })
            },
          }
        },
      }
      return builder
    },
  }
}

const CODE = { code: 'amb_tiger1', code_type: 'ambassador', profile_id: 'ambassador-1' }

test('saving a link stores attribution and does not write a payout', async () => {
  const calls = []
  const sb = fakeSb({ codes: [CODE] }, calls)
  const saved = await saveAmbassadorAttribution(sb, { id: 'rider-1' }, 'AMB_tiger1')
  assert.equal(saved.ok, true)
  assert.equal(saved.stored, true)
  assert.equal(saved.code, 'amb_tiger1')
  assert.equal(saved.code_type, 'ambassador')
  const write = calls.find((call) => call.op === 'upsert')
  assert.equal(write.table, 'ambassador_attributions')
  assert.equal(write.payload.user_id, 'rider-1')
  assert.equal(write.payload.amount_cents, undefined)
  assert.equal(calls.some((call) => call.table === 'ambassador_payout_ledger'), false)
  assert.equal(calls.some((call) => call.op === 'insert'), false)
})

test('an ambassador cannot attribute their own link', async () => {
  const calls = []
  const sb = fakeSb({ codes: [CODE] }, calls)
  const saved = await saveAmbassadorAttribution(sb, { id: 'ambassador-1' }, 'amb_tiger1')
  assert.equal(saved.ok, false)
  assert.equal(saved.code, 'own_link')
  assert.equal(calls.some((call) => call.op === 'upsert' || call.op === 'insert'), false)
  assert.equal(await resolveAmbassadorCode(sb, { id: 'ambassador-1' }, 'amb_tiger1'), null)
})

test('resolve uses the stored row and stamp does not replace or pay', async () => {
  const calls = []
  const sb = fakeSb({
    codes: [CODE],
    attributions: [{ user_id: 'rider-1', code: 'amb_tiger1' }],
  }, calls)
  assert.equal(await resolveAmbassadorCode(sb, { id: 'rider-1' }, ''), 'amb_tiger1')
  assert.equal(await resolveAmbassadorCode(sb, { id: 'rider-1' }, 'amb_missing'), 'amb_tiger1')

  const open = { id: 'ride-1', kind: 'carpool', fare_breakdown: { match_mode: 'marketplace' } }
  const stamped = await stampAmbassadorCode(sb, open, 'amb_tiger1')
  assert.equal(stamped.fare_breakdown.ambassador_code, 'amb_tiger1')
  const update = calls.find((call) => call.op === 'update')
  assert.equal(update.table, 'friend_rides')
  assert.equal(update.payload.amount_cents, undefined)

  calls.length = 0
  const again = await stampAmbassadorCode(sb, stamped, 'amb_other')
  assert.equal(again.fare_breakdown.ambassador_code, 'amb_tiger1')
  assert.equal(calls.length, 0)
  assert.equal(calls.some((call) => call.table === 'ambassador_payout_ledger'), false)
})
