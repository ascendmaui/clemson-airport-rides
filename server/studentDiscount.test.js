import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import test from 'node:test'
import { quoteFare, STUDENT_DISCOUNT_BPS } from '../src/lib/fareRates.js'
import { studentDiscountGranted } from '../src/lib/studentDomain.js'
import { studentFlagsFor } from './studentEligibility.js'

// pricing.js imports the Vite Supabase client. The loader swaps that for a stub.
register('../tests/fixtures/pricingLoader.mjs', import.meta.url)
const { applyStudentDiscount } = await import('../src/lib/pricing.js')

const CONFIRMED_AT = '2026-09-01T00:00:00Z'
const ROUTES = [[0, 0], [3, 10], [8, 16], [48, 55], [130, 130]]

function authAdmin(users) {
  return {
    auth: {
      admin: {
        async getUserById(id) {
          const user = users[id]
          if (!user) return { data: null, error: { message: 'missing' } }
          return { data: { user }, error: null }
        },
      },
    },
  }
}

/**
 * Eligibility boolean in, both fare helpers out.
 * applyStudentDiscount is given the undiscounted quote so UI cents match checkout.
 * `extra` is spread after isStudent so an explicit tier (including '' and null) wins.
 */
function pricedPair(isStudent, extra = {}) {
  return ROUTES.map(([miles, minutes]) => {
    const plain = quoteFare({ miles, minutes, isStudent: false, ...extra })
    const quoted = quoteFare({ miles, minutes, isStudent, ...extra })
    const applied = applyStudentDiscount(plain.fareBeforeCreditsCents, { isStudent, ...extra })
    return { miles, minutes, plain, quoted, applied }
  })
}

function assertDiscountAgrees(isStudent, extra, expectDiscount, label) {
  for (const row of pricedPair(isStudent, extra)) {
    const where = `${label} ${row.miles}mi/${row.minutes}min`
    assert.equal(row.applied.discountCents, row.quoted.breakdown.student_discount_cents, `${where} cents`)
    assert.equal(row.applied.fareCents, row.quoted.fareBeforeCreditsCents, `${where} fare`)
    assert.equal(
      row.applied.fareCents + row.applied.discountCents,
      row.plain.fareBeforeCreditsCents,
      `${where} adds back`,
    )
    if (expectDiscount) {
      const expected = Math.round((row.plain.fareBeforeCreditsCents * STUDENT_DISCOUNT_BPS) / 10000)
      assert.equal(STUDENT_DISCOUNT_BPS, 1000, 'student discount stays 1000 bps')
      assert.equal(row.quoted.breakdown.student_discount_bps, STUDENT_DISCOUNT_BPS, `${where} bps`)
      assert.equal(row.applied.discountCents, expected, `${where} rate`)
      assert.ok(row.applied.discountCents > 0, `${where} discount`)
      assert.equal(row.applied.label, 'Clemson student · 10% off Standard', `${where} label`)
    } else {
      assert.equal(row.applied.discountCents, 0, `${where} no discount`)
      assert.equal(row.applied.label, null, `${where} label`)
      assert.equal(row.quoted.breakdown.student_discount_bps, 0, `${where} bps`)
      assert.equal(row.quoted.fareBeforeCreditsCents, row.plain.fareBeforeCreditsCents, `${where} full fare`)
    }
  }
}

/** Auth email decides the flag. Join-form email and profile stamps do not. */
async function lockedFlag(id, user) {
  const [flag] = await studentFlagsFor(authAdmin({ [id]: user }), [{
    user_id: id,
    email: 'spoofed-join@clemson.edu',
    student_verified_at: CONFIRMED_AT,
    is_student: true,
  }])
  assert.equal(flag, studentDiscountGranted(user), id)
  return flag
}

test('ride billing prices from the confirmed email and ignores a client student flag', () => {
  const billing = readFileSync(new URL('./endpoints/rideBilling.js', import.meta.url), 'utf8')
  const request = readFileSync(new URL('./endpoints/requestDriverTrip.js', import.meta.url), 'utf8')
  const fare = readFileSync(new URL('./authoritativeFare.js', import.meta.url), 'utf8')
  assert.match(billing, /studentDiscountGranted\(user\)/)
  assert.doesNotMatch(billing, /body\.isStudent/)
  assert.match(request, /studentDiscountGranted\(user\)/)
  assert.doesNotMatch(request, /body\.isStudent/)
  assert.match(fare, /studentDiscountGranted/)
  assert.match(fare, /spoofedStudent: body\.isStudent === true && !priced\.isStudent/)
})

test('quote and airport checkout do not read a client student flag', () => {
  const quote = readFileSync(new URL('./endpoints/quoteFare.js', import.meta.url), 'utf8')
  const checkout = readFileSync(new URL('./endpoints/airportCheckout.js', import.meta.url), 'utf8')
  const recompute = readFileSync(new URL('./friendRideRecompute.js', import.meta.url), 'utf8')
  const eligibility = readFileSync(new URL('./studentEligibility.js', import.meta.url), 'utf8')
  assert.doesNotMatch(quote, /body\.isStudent/)
  assert.match(quote, /studentDiscountGranted/)
  assert.doesNotMatch(checkout, /student_verified_at/)
  assert.match(checkout, /studentDiscountGranted\(user\)/)
  assert.match(recompute, /studentFlagsFor/)
  assert.doesNotMatch(recompute, /student_verified_at/)
  assert.doesNotMatch(eligibility, /student_verified_at/)
  assert.doesNotMatch(eligibility, /participant\.email/)
})

test('friend-ride shares use the auth email, not the join form or a profile flag', async () => {
  const users = {
    spoof: { email: 'spoof@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z', student_verified_at: '2026-01-01' },
    tiger: { email: 'tiger@g.clemson.edu', email_confirmed_at: '2026-01-01T00:00:00Z' },
    pending: { email: 'pending@clemson.edu', email_confirmed_at: null },
  }
  const sb = {
    auth: {
      admin: {
        async getUserById(id) {
          return { data: { user: users[id] || null }, error: users[id] ? null : { message: 'missing' } }
        },
      },
    },
  }
  const flags = await studentFlagsFor(sb, [
    { user_id: 'spoof', email: 'spoof@clemson.edu', student_verified_at: '2026-01-01' },
    { user_id: 'tiger', email: 'nope@gmail.com' },
    { user_id: 'pending', email: 'pending@clemson.edu' },
    { email: 'guest@clemson.edu' },
  ])
  assert.deepEqual(flags, [false, true, false, false])
  assert.equal(studentDiscountGranted(users.tiger), true)
  assert.equal(studentDiscountGranted(users.spoof), false)
})

test('e2e: unverified campus email gets no student discount', async () => {
  const unverified = [
    { id: 'null_stamp', user: { email: 'tiger@clemson.edu', email_confirmed_at: null } },
    { id: 'missing_stamp', user: { email: 'tiger@clemson.edu' } },
    { id: 'empty_stamp', user: { email: 'tiger@g.clemson.edu', email_confirmed_at: '' } },
    {
      id: 'identity_false',
      user: { email: 'tiger@clemson.edu', identities: [{ identity_data: { email_verified: false } }] },
    },
    { id: 'identity_empty', user: { email: 'tiger@clemson.edu', identities: [] } },
  ]
  for (const row of unverified) {
    const flag = await lockedFlag(row.id, row.user)
    assert.equal(flag, false, row.id)
    assertDiscountAgrees(flag, { tier: 'standard' }, false, row.id)
    assertDiscountAgrees(flag, {}, false, `${row.id} omitted tier`)
  }
})

test('e2e: verified @clemson.edu gets the 10% Standard discount on both fare helpers', async () => {
  const verified = [
    { id: 'clemson', user: { email: 'tiger@clemson.edu', email_confirmed_at: CONFIRMED_AT } },
    { id: 'clemson_case', user: { email: '  Tiger@CLEMSON.EDU  ', email_confirmed_at: CONFIRMED_AT } },
    { id: 'clemson_plus', user: { email: 'tiger+tag@clemson.edu', email_confirmed_at: CONFIRMED_AT } },
    { id: 'workspace', user: { email: 'tiger@g.clemson.edu', email_confirmed_at: CONFIRMED_AT } },
    { id: 'legacy_stamp', user: { email: 'tiger@clemson.edu', confirmed_at: CONFIRMED_AT } },
    {
      id: 'identity_true',
      user: {
        email: 'tiger@g.clemson.edu',
        identities: [{ identity_data: { email_verified: true } }],
      },
    },
  ]
  for (const row of verified) {
    const flag = await lockedFlag(row.id, row.user)
    assert.equal(flag, true, row.id)
    assertDiscountAgrees(flag, { tier: 'standard' }, true, row.id)
    assertDiscountAgrees(flag, {}, true, `${row.id} omitted tier`)
    assertDiscountAgrees(flag, { tier: null }, true, `${row.id} null tier`)
  }
})

test('e2e: a non-Clemson email never gets the student discount', async () => {
  const outsiders = [
    { id: 'gmail', user: { email: 'tiger@gmail.com', email_confirmed_at: CONFIRMED_AT, student_verified_at: CONFIRMED_AT } },
    { id: 'mit', user: { email: 'tiger@mit.edu', email_confirmed_at: CONFIRMED_AT } },
    { id: 'suffix_spoof', user: { email: 'tiger@clemson.edu.evil.com', email_confirmed_at: CONFIRMED_AT } },
    { id: 'subdomain', user: { email: 'tiger@mail.clemson.edu', email_confirmed_at: CONFIRMED_AT } },
    { id: 'local_spoof', user: { email: 'clemson.edu@gmail.com', email_confirmed_at: CONFIRMED_AT } },
    { id: 'not_clemson', user: { email: 'tiger@notclemson.edu', email_confirmed_at: CONFIRMED_AT } },
    { id: 'blank_email', user: { email: '  ', email_confirmed_at: CONFIRMED_AT } },
    { id: 'missing_email', user: { email_confirmed_at: CONFIRMED_AT } },
  ]
  for (const row of outsiders) {
    const flag = await lockedFlag(row.id, row.user)
    assert.equal(flag, false, row.id)
    assertDiscountAgrees(flag, { tier: 'standard' }, false, row.id)
    assertDiscountAgrees(flag, { tier: '' }, false, `${row.id} blank tier`)
    assertDiscountAgrees(flag, { tier: null }, false, `${row.id} null tier`)
  }
})

test('e2e: blank tier withholds the discount in applyStudentDiscount and quoteFare', async () => {
  const user = { email: 'ada@clemson.edu', email_confirmed_at: CONFIRMED_AT }
  const flag = await lockedFlag('ada', user)
  assert.equal(flag, true)

  assertDiscountAgrees(flag, { tier: '' }, false, 'blank tier')
  assertDiscountAgrees(flag, { tier: '   ' }, false, 'whitespace tier')
  assertDiscountAgrees(flag, { tier: 'wait' }, false, 'wait tier')
  assertDiscountAgrees(flag, { tier: 'comfort' }, false, 'comfort tier')
  assertDiscountAgrees(flag, { tier: 'standard' }, true, 'standard still discounts')
  assertDiscountAgrees(flag, { tier: null }, true, 'null tier still discounts')
  assertDiscountAgrees(flag, {}, true, 'omitted tier still discounts')

  // The two helpers see the same blank-tier fare, not two different zeros.
  for (const [miles, minutes] of ROUTES) {
    const plain = quoteFare({ miles, minutes, tier: '' })
    const quoted = quoteFare({ miles, minutes, isStudent: true, tier: '' })
    const applied = applyStudentDiscount(plain.fareBeforeCreditsCents, { isStudent: true, tier: '' })
    const where = `direct blank ${miles}mi/${minutes}min`
    assert.equal(applied.discountCents, 0, where)
    assert.equal(quoted.breakdown.student_discount_cents, 0, where)
    assert.equal(applied.fareCents, plain.fareBeforeCreditsCents, where)
    assert.equal(quoted.fareBeforeCreditsCents, plain.fareBeforeCreditsCents, where)
    assert.equal(applied.discountCents, quoted.breakdown.student_discount_cents, where)
  }
})
