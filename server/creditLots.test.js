import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import {
  loadCreditLots,
  creditBalanceCents,
  planSettlement,
  debitLots,
  restoreLots,
  insertChargePayment,
} from './creditLots.js'

/**
 * In-memory Supabase fake for rider credit lots, ledger, and payments tables.
 */
function createFakeSb(initial = {}) {
  const creditLots = (initial.creditLots || []).map((l) => ({ ...l }))
  const ledger = (initial.ledger || []).map((l) => ({ ...l }))
  const payments = (initial.payments || []).map((p) => ({ ...p }))
  const errors = { ...(initial.errors || {}) }

  function from(table) {
    const state = {
      table,
      op: 'select',
      payload: null,
      patch: null,
      filters: [],
      orders: [],
      isSingle: false,
      isMaybeSingle: false,
      selectCols: null,
    }

    const api = {
      select(cols) {
        state.selectCols = cols
        return api
      },
      insert(payload) {
        state.op = 'insert'
        state.payload = payload
        return api
      },
      update(patch) {
        state.op = 'update'
        state.patch = patch
        return api
      },
      eq(col, val) {
        state.filters.push({ type: 'eq', col, val })
        return api
      },
      gt(col, val) {
        state.filters.push({ type: 'gt', col, val })
        return api
      },
      order(col, opts = {}) {
        state.orders.push({ col, ascending: opts.ascending !== false })
        return api
      },
      single() {
        state.isSingle = true
        return execute()
      },
      maybeSingle() {
        state.isMaybeSingle = true
        return execute()
      },
      then(resolve, reject) {
        return execute().then(resolve, reject)
      },
    }

    async function execute() {
      if (errors[table]) {
        return { data: null, error: { message: errors[table] } }
      }

      function filterMatches(row) {
        return state.filters.every((f) => {
          if (f.type === 'eq') return row[f.col] === f.val
          if (f.type === 'gt') return row[f.col] > f.val
          return true
        })
      }

      if (table === 'rider_credit_lots') {
        if (state.op === 'insert') {
          const row = {
            id: state.payload.id || `lot_${creditLots.length + 1}`,
            ...state.payload,
          }
          creditLots.push(row)
          const result = state.isSingle ? { id: row.id } : [row]
          return { data: result, error: null }
        }

        if (state.op === 'update') {
          if (errors.rider_credit_lots_update) {
            return { data: null, error: { message: errors.rider_credit_lots_update } }
          }
          const matched = creditLots.filter(filterMatches)
          for (const row of matched) {
            Object.assign(row, state.patch)
          }
          // Returns array of updated rows with id (needed by debitLots: !updated?.length check)
          const updated = matched.map((r) => ({ id: r.id }))
          return { data: updated, error: null }
        }

        // Op is select
        let rows = creditLots.filter(filterMatches)
        if (state.orders.length) {
          for (const ord of state.orders) {
            rows.sort((a, b) => {
              const va = a[ord.col]
              const vb = b[ord.col]
              if (va < vb) return ord.ascending ? -1 : 1
              if (va > vb) return ord.ascending ? 1 : -1
              return 0
            })
          }
        }
        if (state.isSingle) {
          if (!rows.length) return { data: null, error: { message: 'Lot not found' } }
          return { data: { ...rows[0] }, error: null }
        }
        if (state.isMaybeSingle) {
          return { data: rows.length ? { ...rows[0] } : null, error: null }
        }
        return { data: rows.map((r) => ({ ...r })), error: null }
      }

      if (table === 'rider_credit_ledger') {
        if (state.op === 'insert') {
          const row = {
            id: `ledger_${ledger.length + 1}`,
            ...state.payload,
          }
          ledger.push(row)
          return { data: row, error: null }
        }
        return { data: ledger.filter(filterMatches), error: null }
      }

      if (table === 'payments') {
        if (state.op === 'insert') {
          const row = {
            id: `pay_${payments.length + 1}`,
            ...state.payload,
          }
          payments.push(row)
          if (state.isSingle) {
            return { data: { id: row.id }, error: null }
          }
          return { data: [row], error: null }
        }
        return { data: payments.filter(filterMatches), error: null }
      }

      return { data: null, error: null }
    }

    return api
  }

  return {
    from,
    creditLots,
    ledger,
    payments,
    errors,
  }
}

describe('planSettlement', () => {
  test('useCredits=false does not spend available credits and charges card for full fare', async () => {
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_1',
          profile_id: 'rider_1',
          pack_id: 'pack_100',
          load_cents: 10000,
          discount_bps: 1000,
          remaining_cents: 10000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const settled = await planSettlement(sb, {
      profileId: 'rider_1',
      fareCents: 5000,
      useCredits: false,
    })

    assert.equal(settled.fareBeforeCreditsCents, 5000)
    assert.equal(settled.creditsDebitedCents, 0)
    assert.equal(settled.creditDiscountCents, 0)
    assert.equal(settled.cashCents, 5000)
    assert.equal(settled.riderPaysCents, 5000)
    assert.equal(settled.waivedCents, 0)
    assert.equal(settled.platformFeeCents, 1000) // 20%
    assert.equal(settled.driverEarningsCents, 4000) // 80%
    assert.deepEqual(settled.debits, [])
  })

  test('credits cover ALL of fare (100% credit payment, zero cash remainder)', async () => {
    // Fare $40.00 (4000 cents). Rider has 10000 cents with 10% discount (1000 bps).
    // Pre-discount fare slice = 4000 cents.
    // Debit = round(4000 * (10000 - 1000) / 10000) = round(4000 * 0.9) = 3600 cents.
    // Discount = 4000 - 3600 = 400 cents.
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_1',
          profile_id: 'rider_1',
          pack_id: 'pack_100',
          load_cents: 10000,
          discount_bps: 1000,
          remaining_cents: 10000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const settled = await planSettlement(sb, {
      profileId: 'rider_1',
      fareCents: 4000,
      useCredits: true,
    })

    assert.equal(settled.fareBeforeCreditsCents, 4000)
    assert.equal(settled.creditsDebitedCents, 3600)
    assert.equal(settled.creditDiscountCents, 400)
    assert.equal(settled.cashCents, 0)
    assert.equal(settled.riderPaysCents, 3600)
    assert.equal(settled.waivedCents, 0)
    // 20% platform fee of rider price ($36.00 * 0.20 = $7.20 = 720 cents)
    assert.equal(settled.platformFeeCents, 720)
    assert.equal(settled.driverEarningsCents, 2880)
    assert.equal(settled.debits.length, 1)
    assert.deepEqual(settled.debits[0], {
      lotId: 'lot_1',
      sliceCents: 4000,
      debitCents: 3600,
      discountCents: 400,
      discountBps: 1000,
    })
  })

  test('credits cover PART of fare (split credit deduction + card remainder)', async () => {
    // Fare $80.00 (8000 cents). Rider has 2000 cents remaining in lot with 10% discount (1000 bps).
    // Lot face value = 2000. Pay rate = 90% (9000 bps).
    // Slice = min(8000, floor(2000 * 10000 / 9000)) = floor(2222.22) = 2222 cents.
    // Pay = round(2222 * 0.9) = 2000 cents. Discount = 2222 - 2000 = 222 cents.
    // Cash remainder = 8000 - 2222 = 5778 cents.
    // Rider pays = 2000 + 5778 = 7778 cents.
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_1',
          profile_id: 'rider_1',
          pack_id: 'pack_50',
          load_cents: 5000,
          discount_bps: 1000,
          remaining_cents: 2000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const settled = await planSettlement(sb, {
      profileId: 'rider_1',
      fareCents: 8000,
      useCredits: true,
    })

    assert.equal(settled.fareBeforeCreditsCents, 8000)
    assert.equal(settled.creditsDebitedCents, 2000)
    assert.equal(settled.creditDiscountCents, 222)
    assert.equal(settled.cashCents, 5778)
    assert.equal(settled.riderPaysCents, 7778)
    assert.equal(settled.platformFeeCents, Math.round(7778 * 0.2)) // 1556
    assert.equal(settled.driverEarningsCents, 7778 - 1556) // 6222
    assert.equal(settled.debits.length, 1)
    assert.deepEqual(settled.debits[0], {
      lotId: 'lot_1',
      sliceCents: 2222,
      debitCents: 2000,
      discountCents: 222,
      discountBps: 1000,
    })
  })

  test('credits cover NONE of fare when rider has no available lots', async () => {
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_exhausted',
          profile_id: 'rider_1',
          pack_id: 'pack_100',
          load_cents: 10000,
          discount_bps: 1000,
          remaining_cents: 0,
          status: 'exhausted',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const settled = await planSettlement(sb, {
      profileId: 'rider_1',
      fareCents: 6500,
      useCredits: true,
    })

    assert.equal(settled.fareBeforeCreditsCents, 6500)
    assert.equal(settled.creditsDebitedCents, 0)
    assert.equal(settled.creditDiscountCents, 0)
    assert.equal(settled.cashCents, 6500)
    assert.equal(settled.riderPaysCents, 6500)
    assert.deepEqual(settled.debits, [])
  })

  test('consumes multiple lots FIFO across differing discount tiers', async () => {
    // Lot 1 (older): 2000 cents, 5% discount (500 bps).
    // Lot 2 (newer): 10000 cents, 15% discount (1500 bps).
    // Fare: 6000 cents.
    // Lot 1: slice = floor(2000 * 10000 / 9500) = 2105. pay = round(2105 * 0.95) = 2000. discount = 105.
    // Remaining fare = 6000 - 2105 = 3895.
    // Lot 2: slice = 3895. pay = round(3895 * 0.85) = 3311. discount = 584.
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_newer',
          profile_id: 'rider_1',
          pack_id: 'pack_200',
          load_cents: 20000,
          discount_bps: 1500,
          remaining_cents: 10000,
          status: 'available',
          created_at: '2026-09-02T00:00:00.000Z',
        },
        {
          id: 'lot_older',
          profile_id: 'rider_1',
          pack_id: 'pack_50',
          load_cents: 5000,
          discount_bps: 500,
          remaining_cents: 2000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const settled = await planSettlement(sb, {
      profileId: 'rider_1',
      fareCents: 6000,
      useCredits: true,
    })

    assert.equal(settled.debits.length, 2)
    assert.equal(settled.debits[0].lotId, 'lot_older')
    assert.equal(settled.debits[0].sliceCents, 2105)
    assert.equal(settled.debits[0].debitCents, 2000)
    assert.equal(settled.debits[0].discountCents, 105)

    assert.equal(settled.debits[1].lotId, 'lot_newer')
    assert.equal(settled.debits[1].sliceCents, 3895)
    assert.equal(settled.debits[1].debitCents, 3311)
    assert.equal(settled.debits[1].discountCents, 584)

    assert.equal(settled.cashCents, 0)
    assert.equal(settled.creditsDebitedCents, 2000 + 3311) // 5311
    assert.equal(settled.creditDiscountCents, 105 + 584) // 689
    assert.equal(settled.riderPaysCents, 5311)
  })

  test('cash remainder below MIN_CARD_CHARGE_CENTS (50c) is waived', async () => {
    // Lot has 5000 cents with 0 discount.
    // Fare is 5035 cents -> cash remainder is 35 cents (< 50 cents min charge).
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_flat',
          profile_id: 'rider_1',
          pack_id: 'pack_flat',
          load_cents: 5000,
          discount_bps: 0,
          remaining_cents: 5000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const settled = await planSettlement(sb, {
      profileId: 'rider_1',
      fareCents: 5035,
      useCredits: true,
    })

    assert.equal(settled.creditsDebitedCents, 5000)
    assert.equal(settled.cashCents, 0)
    assert.equal(settled.waivedCents, 35)
    assert.equal(settled.riderPaysCents, 5000)
  })

  test('edge cases: zero fare, negative fare, and missing profileId', async () => {
    const sb = createFakeSb()

    const zero = await planSettlement(sb, { profileId: 'rider_1', fareCents: 0, useCredits: true })
    assert.equal(zero.riderPaysCents, 0)
    assert.equal(zero.cashCents, 0)
    assert.deepEqual(zero.debits, [])

    const neg = await planSettlement(sb, { profileId: 'rider_1', fareCents: -500, useCredits: true })
    assert.equal(neg.riderPaysCents, 0)
    assert.deepEqual(neg.debits, [])

    const noProfile = await planSettlement(sb, { profileId: null, fareCents: 3000, useCredits: true })
    assert.equal(noProfile.riderPaysCents, 3000)
    assert.equal(noProfile.cashCents, 3000)
    assert.deepEqual(noProfile.debits, [])
  })
})

describe('debitLots', () => {
  test('successfully debits single lot and records ledger redemption', async () => {
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_1',
          profile_id: 'rider_1',
          remaining_cents: 10000,
          status: 'available',
        },
      ],
    })

    const debits = [{ lotId: 'lot_1', debitCents: 3500, discountCents: 350 }]
    const applied = await debitLots(sb, {
      profileId: 'rider_1',
      debits,
      note: 'airport ride',
      tripId: 'trip_100',
    })

    assert.deepEqual(applied, debits)
    const lot = sb.creditLots.find((l) => l.id === 'lot_1')
    assert.equal(lot.remaining_cents, 6500)
    assert.equal(lot.status, 'available')

    assert.equal(sb.ledger.length, 1)
    assert.deepEqual(sb.ledger[0], {
      id: 'ledger_1',
      profile_id: 'rider_1',
      lot_id: 'lot_1',
      kind: 'redemption',
      amount_cents: 3500,
      discount_cents: 350,
      trip_id: 'trip_100',
      note: 'airport ride',
    })
  })

  test('marks lot status as exhausted when remaining balance reaches zero', async () => {
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_exact',
          profile_id: 'rider_1',
          remaining_cents: 2000,
          status: 'available',
        },
      ],
    })

    await debitLots(sb, {
      profileId: 'rider_1',
      debits: [{ lotId: 'lot_exact', debitCents: 2000 }],
    })

    const lot = sb.creditLots.find((l) => l.id === 'lot_exact')
    assert.equal(lot.remaining_cents, 0)
    assert.equal(lot.status, 'exhausted')
  })

  test('debits multiple lots in sequence and logs each redemption', async () => {
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 2000, status: 'available' },
        { id: 'lot_2', profile_id: 'rider_1', remaining_cents: 5000, status: 'available' },
      ],
    })

    const debits = [
      { lotId: 'lot_1', debitCents: 2000, discountCents: 100 },
      { lotId: 'lot_2', debitCents: 1500, discountCents: 150 },
    ]

    await debitLots(sb, { profileId: 'rider_1', debits, note: 'split-lot', tripId: 'trip_multi' })

    const lot1 = sb.creditLots.find((l) => l.id === 'lot_1')
    const lot2 = sb.creditLots.find((l) => l.id === 'lot_2')
    assert.equal(lot1.remaining_cents, 0)
    assert.equal(lot1.status, 'exhausted')
    assert.equal(lot2.remaining_cents, 3500)
    assert.equal(lot2.status, 'available')
    assert.equal(sb.ledger.length, 2)
  })

  test('skips empty, null, or zero-amount debit entries gracefully', async () => {
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 5000, status: 'available' },
      ],
    })

    const appliedEmpty = await debitLots(sb, { profileId: 'rider_1', debits: [] })
    assert.deepEqual(appliedEmpty, [])

    const appliedNull = await debitLots(sb, { profileId: 'rider_1', debits: null })
    assert.deepEqual(appliedNull, [])

    const appliedZero = await debitLots(sb, {
      profileId: 'rider_1',
      debits: [
        null,
        { lotId: null, debitCents: 100 },
        { lotId: 'lot_1', debitCents: 0 },
      ],
    })
    assert.deepEqual(appliedZero, [])
    assert.equal(sb.creditLots[0].remaining_cents, 5000)
    assert.equal(sb.ledger.length, 0)
  })

  test('throws when credit lot is missing from database', async () => {
    const sb = createFakeSb({ creditLots: [] })

    await assert.rejects(
      debitLots(sb, {
        profileId: 'rider_1',
        debits: [{ lotId: 'nonexistent', debitCents: 1000 }],
      }),
      /Credit lot missing/
    )
  })

  test('throws when lot belongs to another profile (cross-user security guard)', async () => {
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_other', profile_id: 'other_user', remaining_cents: 5000, status: 'available' },
      ],
    })

    await assert.rejects(
      debitLots(sb, {
        profileId: 'rider_1',
        debits: [{ lotId: 'lot_other', debitCents: 1000 }],
      }),
      /Credit lot missing/
    )
  })

  test('throws when lot has insufficient remaining balance', async () => {
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 1500, status: 'available' },
      ],
    })

    await assert.rejects(
      debitLots(sb, {
        profileId: 'rider_1',
        debits: [{ lotId: 'lot_1', debitCents: 2000 }],
      }),
      /Credit balance changed — retry the charge/
    )
  })

  test('throws when optimistic concurrency check detects concurrent balance change', async () => {
    // If update error occurs
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 5000, status: 'available' },
      ],
      errors: { rider_credit_lots_update: 'conflict' },
    })

    await assert.rejects(
      debitLots(sb, {
        profileId: 'rider_1',
        debits: [{ lotId: 'lot_1', debitCents: 1000 }],
      }),
      /Credit balance changed — retry the charge/
    )
  })

  test('rolls back previously applied debits if subsequent debit in batch fails', async () => {
    // Lot 1 has 5000 cents (valid).
    // Lot 2 has only 1000 cents (insufficient for 2000 cents debit).
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 5000, status: 'available' },
        { id: 'lot_2', profile_id: 'rider_1', remaining_cents: 1000, status: 'available' },
      ],
    })

    const debits = [
      { lotId: 'lot_1', debitCents: 2500, discountCents: 250 },
      { lotId: 'lot_2', debitCents: 2000, discountCents: 200 },
    ]

    await assert.rejects(
      debitLots(sb, {
        profileId: 'rider_1',
        debits,
        note: 'airport-trip',
        tripId: 'trip_fail',
      }),
      /Credit balance changed — retry the charge/
    )

    // Lot 1 was debited to 2500, but then restored back to 5000 during error recovery!
    const lot1 = sb.creditLots.find((l) => l.id === 'lot_1')
    assert.equal(lot1.remaining_cents, 5000)
    assert.equal(lot1.status, 'available')

    // Lot 2 was never successfully debited
    const lot2 = sb.creditLots.find((l) => l.id === 'lot_2')
    assert.equal(lot2.remaining_cents, 1000)

    // Ledger records both the redemption and the automatic reversal refund
    assert.equal(sb.ledger.length, 2)
    assert.equal(sb.ledger[0].kind, 'redemption')
    assert.equal(sb.ledger[0].amount_cents, 2500)
    assert.equal(sb.ledger[1].kind, 'refund')
    assert.equal(sb.ledger[1].amount_cents, 2500)
    assert.equal(sb.ledger[1].note, 'revert:airport-trip')
  })
})

describe('restoreLots', () => {
  test('restores exactly what was debited after trip cancellation (refund path)', async () => {
    // Lot had 5000 cents initially, 2500 was debited leaving 2500.
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 2500, status: 'available' },
      ],
    })

    const debits = [{ lotId: 'lot_1', debitCents: 2500, discountCents: 250 }]
    await restoreLots(sb, {
      profileId: 'rider_1',
      debits,
      note: 'cancel:trip_1',
    })

    const lot = sb.creditLots.find((l) => l.id === 'lot_1')
    assert.equal(lot.remaining_cents, 5000)
    assert.equal(lot.status, 'available')

    assert.equal(sb.ledger.length, 1)
    assert.deepEqual(sb.ledger[0], {
      id: 'ledger_1',
      profile_id: 'rider_1',
      lot_id: 'lot_1',
      kind: 'refund',
      amount_cents: 2500,
      discount_cents: 250,
      note: 'cancel:trip_1',
    })
  })

  test('restores an exhausted lot back to available status', async () => {
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_exhausted', profile_id: 'rider_1', remaining_cents: 0, status: 'exhausted' },
      ],
    })

    await restoreLots(sb, {
      profileId: 'rider_1',
      debits: [{ lotId: 'lot_exhausted', debitCents: 3000 }],
      note: 'refund:driver_cancel',
    })

    const lot = sb.creditLots.find((l) => l.id === 'lot_exhausted')
    assert.equal(lot.remaining_cents, 3000)
    assert.equal(lot.status, 'available')
  })

  test('skips missing lot or invalid debit entries gracefully', async () => {
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 1000, status: 'available' },
      ],
    })

    await restoreLots(sb, {
      profileId: 'rider_1',
      debits: [
        null,
        { lotId: null, debitCents: 500 },
        { lotId: 'lot_1', debitCents: 0 },
        { lotId: 'nonexistent', debitCents: 500 },
      ],
    })

    assert.equal(sb.creditLots[0].remaining_cents, 1000)
    assert.equal(sb.ledger.length, 0)
  })

  test('double-restore is not idempotent (flags BUG?: duplicate credits and duplicate ledger entries)', async () => {
    // BUG?: double-restore is not idempotent; calling restoreLots multiple times
    // with the exact same debits will credit the lot balance a second time and
    // write duplicate refund records to rider_credit_ledger, because restoreLots
    // lacks idempotency keys, duplicate-refund checks, or a cap against load_cents.
    const sb = createFakeSb({
      creditLots: [
        { id: 'lot_1', profile_id: 'rider_1', remaining_cents: 2500, status: 'available' },
      ],
    })

    const debits = [{ lotId: 'lot_1', debitCents: 2500, discountCents: 250 }]

    // First restore (legitimate cancel refund):
    await restoreLots(sb, { profileId: 'rider_1', debits, note: 'cancel:trip_1' })
    const lotAfterFirst = sb.creditLots.find((l) => l.id === 'lot_1')
    assert.equal(lotAfterFirst.remaining_cents, 5000)
    assert.equal(sb.ledger.length, 1)

    // Second restore (duplicate/replay call):
    await restoreLots(sb, { profileId: 'rider_1', debits, note: 'cancel:trip_1' })
    const lotAfterSecond = sb.creditLots.find((l) => l.id === 'lot_1')

    // Documenting current implementation behavior under the BUG?: flag:
    // It blindly adds debitCents again (5000 + 2500 = 7500) and writes a second refund row.
    assert.equal(lotAfterSecond.remaining_cents, 7500)
    assert.equal(sb.ledger.length, 2)
    assert.equal(sb.ledger[0].kind, 'refund')
    assert.equal(sb.ledger[1].kind, 'refund')
  })
})

describe('insertChargePayment', () => {
  test('kind credit_purchase records liability (0% platform fee, 0% driver earnings)', async () => {
    const sb = createFakeSb()

    const payment = await insertChargePayment(sb, {
      riderId: 'rider_1',
      kind: 'credit_purchase',
      amountCents: 10000,
      stripePaymentIntentId: 'pi_credit_pack_100',
      metadata: { pack_id: 'pack_100' },
    })

    assert.deepEqual(payment, {
      id: 'pay_1',
      platformFeeCents: 0,
      driverEarningsCents: 0,
      amountCents: 10000,
    })

    assert.equal(sb.payments.length, 1)
    assert.deepEqual(sb.payments[0], {
      id: 'pay_1',
      trip_id: null,
      rider_id: 'rider_1',
      stripe_payment_intent_id: 'pi_credit_pack_100',
      kind: 'credit_purchase',
      amount_cents: 10000,
      platform_fee_cents: 0,
      driver_earnings_cents: 0,
      status: 'succeeded',
      metadata: { pack_id: 'pack_100' },
    })
  })

  test('kind trip_fare takes 20% platform fee and leaves 80% driver earnings', async () => {
    const sb = createFakeSb()

    const payment = await insertChargePayment(sb, {
      riderId: 'rider_1',
      tripId: 'trip_200',
      kind: 'trip_fare',
      amountCents: 5000,
      stripePaymentIntentId: 'pi_fare_200',
    })

    assert.deepEqual(payment, {
      id: 'pay_1',
      amountCents: 5000,
      platformFeeCents: 1000,
      driverEarningsCents: 4000,
      platformFeeBps: 2000,
    })

    assert.equal(sb.payments.length, 1)
    assert.equal(sb.payments[0].trip_id, 'trip_200')
    assert.equal(sb.payments[0].amount_cents, 5000)
    assert.equal(sb.payments[0].platform_fee_cents, 1000)
    assert.equal(sb.payments[0].driver_earnings_cents, 4000)
  })

  test('validates inputs: returns null when riderId is missing or amount <= 0', async () => {
    const sb = createFakeSb()

    const noRider = await insertChargePayment(sb, { riderId: null, kind: 'trip_fare', amountCents: 5000 })
    assert.equal(noRider, null)

    const zeroAmt = await insertChargePayment(sb, { riderId: 'rider_1', kind: 'trip_fare', amountCents: 0 })
    assert.equal(zeroAmt, null)

    const negAmt = await insertChargePayment(sb, { riderId: 'rider_1', kind: 'trip_fare', amountCents: -100 })
    assert.equal(negAmt, null)

    const nanAmt = await insertChargePayment(sb, { riderId: 'rider_1', kind: 'trip_fare', amountCents: 'not-a-number' })
    assert.equal(nanAmt, null)

    assert.equal(sb.payments.length, 0)
  })

  test('throws when database insert fails', async () => {
    const sb = createFakeSb({ errors: { payments: 'database timeout' } })

    await assert.rejects(
      insertChargePayment(sb, {
        riderId: 'rider_1',
        kind: 'trip_fare',
        amountCents: 4000,
      }),
      /database timeout/
    )
  })
})

describe('loadCreditLots and creditBalanceCents', () => {
  test('loads only available lots with remaining balance > 0 in ascending order of created_at', async () => {
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_newer',
          profile_id: 'rider_1',
          pack_id: 'pack_100',
          load_cents: 10000,
          discount_bps: 1000,
          remaining_cents: 5000,
          status: 'available',
          created_at: '2026-09-05T00:00:00.000Z',
        },
        {
          id: 'lot_older',
          profile_id: 'rider_1',
          pack_id: 'pack_50',
          load_cents: 5000,
          discount_bps: 500,
          remaining_cents: 3000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'lot_exhausted',
          profile_id: 'rider_1',
          pack_id: 'pack_50',
          load_cents: 5000,
          discount_bps: 500,
          remaining_cents: 0,
          status: 'exhausted',
          created_at: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'lot_other_user',
          profile_id: 'rider_2',
          pack_id: 'pack_100',
          load_cents: 10000,
          discount_bps: 1000,
          remaining_cents: 10000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const lots = await loadCreditLots(sb, 'rider_1')
    assert.equal(lots.length, 2)
    assert.equal(lots[0].id, 'lot_older')
    assert.equal(lots[0].remainingCents, 3000)
    assert.equal(lots[0].packId, 'pack_50')
    assert.equal(lots[1].id, 'lot_newer')
    assert.equal(lots[1].remainingCents, 5000)

    const balance = await creditBalanceCents(sb, 'rider_1')
    assert.equal(balance, 8000)
  })

  test('returns empty array / 0 balance when profileId is missing', async () => {
    const sb = createFakeSb()
    assert.deepEqual(await loadCreditLots(sb, null), [])
    assert.equal(await creditBalanceCents(sb, null), 0)
  })

  test('throws when loading credit lots encounters database error', async () => {
    const sb = createFakeSb({ errors: { rider_credit_lots: 'read error' } })
    await assert.rejects(loadCreditLots(sb, 'rider_1'), /read error/)
  })
})

describe('full credit lifecycle integration', () => {
  test('end-to-end: plan settlement -> debit lots -> charge -> cancel -> restore returns lot to original state', async () => {
    const sb = createFakeSb({
      creditLots: [
        {
          id: 'lot_e2e',
          profile_id: 'rider_1',
          pack_id: 'pack_100',
          load_cents: 10000,
          discount_bps: 1000,
          remaining_cents: 10000,
          status: 'available',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })

    const initialBalance = await creditBalanceCents(sb, 'rider_1')
    assert.equal(initialBalance, 10000)

    // 1. Plan settlement for a $40 fare
    const settlement = await planSettlement(sb, {
      profileId: 'rider_1',
      fareCents: 4000,
      useCredits: true,
    })
    assert.equal(settlement.creditsDebitedCents, 3600)
    assert.equal(settlement.cashCents, 0)

    // 2. Debit the credit lots
    const applied = await debitLots(sb, {
      profileId: 'rider_1',
      debits: settlement.debits,
      note: 'trip_lifecycle',
      tripId: 'trip_e2e_1',
    })
    assert.equal(applied.length, 1)

    const midBalance = await creditBalanceCents(sb, 'rider_1')
    assert.equal(midBalance, 6400) // 10000 - 3600

    // 3. Record the charge payment
    const payment = await insertChargePayment(sb, {
      riderId: 'rider_1',
      tripId: 'trip_e2e_1',
      kind: 'trip_fare',
      amountCents: settlement.riderPaysCents,
    })
    assert.equal(payment.amountCents, 3600)

    // 4. Trip cancelled: restore lots
    await restoreLots(sb, {
      profileId: 'rider_1',
      debits: applied,
      note: 'cancel:trip_e2e_1',
    })

    // 5. Verify lot balance and status return to initial state
    const restoredBalance = await creditBalanceCents(sb, 'rider_1')
    assert.equal(restoredBalance, initialBalance)

    const lot = sb.creditLots.find((l) => l.id === 'lot_e2e')
    assert.equal(lot.remaining_cents, 10000)
    assert.equal(lot.status, 'available')
  })
})
