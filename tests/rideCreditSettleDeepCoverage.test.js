import test from 'node:test'
import assert from 'node:assert/strict'
import {
  debitStoredRideCredits,
  rideCreditKey,
} from '../server/rideCreditSettle.js'
import { memoryCreditStore } from '../server/credits.js'

/* ── rideCreditKey ───────────────────────────────────────────────── */

test('rideCreditKey: returns deterministic key from tripId', () => {
  assert.equal(rideCreditKey('trip_abc'), 'ride_credits:trip_abc')
  assert.equal(rideCreditKey(''), 'ride_credits:')
})

/* ── debitStoredRideCredits: zero / missing amount ───────────────── */

test('debitStoredRideCredits: skips when amountCents is zero', async () => {
  const store = memoryCreditStore({ rider_1: 5000 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_1',
    tripId: 'trip_1',
    amountCents: 0,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 0)
  assert.equal(res.duplicate, false)
})

test('debitStoredRideCredits: skips when amountCents is negative', async () => {
  const store = memoryCreditStore({ rider_1: 5000 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_1',
    tripId: 'trip_neg',
    amountCents: -100,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 0)
})

test('debitStoredRideCredits: skips when riderId is missing', async () => {
  const store = memoryCreditStore({ rider_1: 5000 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: null,
    tripId: 'trip_2',
    amountCents: 500,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 0)
})

test('debitStoredRideCredits: skips when tripId is missing', async () => {
  const store = memoryCreditStore({ rider_1: 5000 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_1',
    tripId: null,
    amountCents: 500,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 0)
})

/* ── debitStoredRideCredits: successful debit ────────────────────── */

test('debitStoredRideCredits: debits from credit store and returns balance', async () => {
  const store = memoryCreditStore({ rider_ok: 3000 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_ok',
    tripId: 'trip_ok',
    amountCents: 1200,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 1200)
  assert.equal(res.balanceCents, 1800)
  assert.equal(res.duplicate, false)
})

/* ── debitStoredRideCredits: idempotent duplicate ────────────────── */

test('debitStoredRideCredits: second debit for same trip is a no-op duplicate', async () => {
  const store = memoryCreditStore({ rider_idem: 5000 })
  const first = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_idem',
    tripId: 'trip_idem',
    amountCents: 2000,
  })
  assert.equal(first.ok, true)
  assert.equal(first.debitedCents, 2000)
  assert.equal(first.balanceCents, 3000)

  // Second call with the same trip id should be idempotent
  const second = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_idem',
    tripId: 'trip_idem',
    amountCents: 2000,
  })
  assert.equal(second.ok, true)
  assert.equal(second.duplicate, true)
  // Balance should still be 3000 (not 1000)
  assert.equal(second.balanceCents, 3000)
})

/* ── debitStoredRideCredits: insufficient credits ────────────────── */

test('debitStoredRideCredits: fails when credits are insufficient', async () => {
  const store = memoryCreditStore({ rider_low: 100 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_low',
    tripId: 'trip_low',
    amountCents: 500,
  })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'credits_insufficient')
  assert.equal(res.debitedCents, 0)
  assert.equal(res.balanceCents, 100)
})

/* ── debitStoredRideCredits: rounds fractional amounts ───────────── */

test('debitStoredRideCredits: rounds fractional amountCents', async () => {
  const store = memoryCreditStore({ rider_round: 1000 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_round',
    tripId: 'trip_round',
    amountCents: 199.6,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 200)
  assert.equal(res.balanceCents, 800)
})

/* ── debitStoredRideCredits: NaN amount is skipped ───────────────── */

test('debitStoredRideCredits: skips NaN amountCents', async () => {
  const store = memoryCreditStore({ rider_nan: 1000 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_nan',
    tripId: 'trip_nan',
    amountCents: NaN,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 0)
})

/* ── debitStoredRideCredits: exact balance debit ─────────────────── */

test('debitStoredRideCredits: debits exact balance to zero', async () => {
  const store = memoryCreditStore({ rider_exact: 750 })
  const res = await debitStoredRideCredits({
    sb: null,
    store,
    riderId: 'rider_exact',
    tripId: 'trip_exact',
    amountCents: 750,
  })
  assert.equal(res.ok, true)
  assert.equal(res.debitedCents, 750)
  assert.equal(res.balanceCents, 0)
})
