import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cardDepositCents as fareCardDeposit } from '../../src/lib/fareRates.js'
import { normalizePrefs } from './notificationPrefs.js'
import { buildReceiptText } from '../../src/lib/receiptText.js'
import { AUTH_REQUIRED_COPY, UNAVAILABLE_COPY } from './apiErrors.js'
import {
  authedJson,
  cardDepositCents,
  checkoutFailureCopy,
  depositBalance,
  depositReceiptLines,
  checkoutCloseOutcome,
  depositSettled,
  depositSurfaceCopy,
  describeRiderSocialRewards,
  displayTierPrice,
  parseQuoteResponse,
  paymentRouteMissing,
  previewAirportFare,
  promoClaimMessage,
  quoteInputKey,
  recomputeDeposit,
  STRIPE_NOT_CONFIGURED_COPY,
  studentDiscountCents,
  studentStatus,
  studentSurfaceCopy,
  studentTripMeta,
} from './riderMoney.js'

test('25% deposit matches the fare card and recomputes when the fare changes', () => {
  for (const cents of [0, 40, 49, 50, 100, 590, 9999, 12345]) {
    assert.equal(cardDepositCents(cents), fareCardDeposit(cents))
  }
  const gsp = recomputeDeposit({ fareCents: 10000 })
  const clt = recomputeDeposit({ fareCents: 18420 })
  assert.equal(gsp.depositCents, 2500)
  assert.equal(clt.depositCents, 4605)
  assert.notEqual(gsp.depositCents, clt.depositCents)
  const afterCredits = recomputeDeposit({ fareCents: 10000, cashCents: 4000 })
  assert.equal(afterCredits.depositCents, 1000)
})

test('quote parser drops a stale deposit and uses the new cash remainder', () => {
  const first = parseQuoteResponse({
    fareCents: 8000,
    quote: { fareCents: 8000, cashCents: 8000, breakdown: { student_discount_cents: 0 } },
    surge: { multiplier: 1, rule: null },
  })
  const next = parseQuoteResponse({
    fareCents: 7200,
    routeSource: 'google',
    quote: {
      fareCents: 7200,
      cashCents: 7200,
      breakdown: { student_discount_cents: 800 },
    },
    surge: { multiplier: 1.35, rule: { id: 'airport_rush', label: 'Airport rush' } },
  })
  assert.equal(first.depositCents, 2000)
  assert.equal(next.depositCents, 1800)
  assert.equal(next.studentDiscountCents, 800)
  assert.equal(next.surgeLabel, 'Airport rush')
  assert.notEqual(first.depositCents, next.depositCents)
})

test('student discount is 10% of Standard only', () => {
  const standard = studentDiscountCents(10000, { isStudent: true, tier: 'standard' })
  assert.equal(standard.discountCents, 1000)
  assert.equal(standard.fareCents, 9000)
  assert.equal(studentDiscountCents(10000, { isStudent: true, tier: 'xl' }).discountCents, 0)
  assert.equal(studentDiscountCents(10000, { isStudent: false }).discountCents, 0)
  assert.equal(studentStatus({ email: 'a@g.clemson.edu' }).verified, false)
  assert.equal(studentStatus({ email: 'a@g.clemson.edu' }).discountLabel, null)
  assert.match(studentStatus({ email: 'a@g.clemson.edu' }).gateCopy || '', /Confirm the Clemson email/)
  assert.equal(studentStatus({ email: 'a@gmail.com', studentVerifiedAt: '2026-01-01' }).verified, false)
  assert.equal(studentStatus({ email: 'a@gmail.com', studentVerifiedAt: '2026-01-01' }).discountLabel, null)
  assert.match(studentStatus({ email: 'a@gmail.com', studentVerifiedAt: '2026-01-01' }).gateCopy || '', /Clemson student email/)
  assert.equal(studentStatus({
    email: 'tiger@clemson.edu',
    studentVerifiedAt: '2026-01-01',
    user: { email: 'rider@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
  }).verified, false)
  assert.equal(studentStatus({
    user: { email: 'Tiger@G.Clemson.edu', email_confirmed_at: '2026-01-01T00:00:00Z' },
  }).verified, true)
  assert.equal(studentStatus({
    user: { email: 'tiger@clemson.edu', email_confirmed_at: null },
  }).verified, false)
  assert.match(studentStatus({
    user: { email: 'tiger@clemson.edu', email_confirmed_at: null },
  }).gateCopy || '', /Confirm the Clemson email/)
  assert.equal(studentStatus({ email: 'a@gmail.com' }).verified, false)
  const shown = displayTierPrice(18.5, { isStudent: true, tier: 'standard', surgeMultiplier: 1.8 })
  assert.equal(shown.discountCents, 333)
  assert.equal(shown.fareCents, 2997)
  assert.equal(displayTierPrice(18.5, { isStudent: true, tier: 'xl' }).discount, 0)
  assert.deepEqual(studentTripMeta({ isStudent: true, tier: 'standard', fareCents: 1850 }), {
    isStudent: true,
    studentLabel: 'Clemson student · 10% off Standard',
    student_discount_cents: 185,
  })
  assert.deepEqual(studentTripMeta({ isStudent: false, fareCents: 1850 }), {})
  assert.deepEqual(studentTripMeta({ isStudent: true, tier: 'comfort', fareCents: 2300 }), { isStudent: true })
})

test('home, confirm, and tiers promise 10% off Standard only for a confirmed Clemson email', () => {
  const confirmed = studentStatus({
    user: { email: 'ada@g.clemson.edu', email_confirmed_at: '2026-09-01T00:00:00Z' },
  })
  const unconfirmed = studentStatus({
    user: { email: 'ada@clemson.edu', email_confirmed_at: null },
  })
  const other = studentStatus({
    user: { email: 'ada@gmail.com', email_confirmed_at: '2026-09-01T00:00:00Z' },
  })
  const guest = studentStatus()
  for (const surface of ['home', 'tiers', 'confirm']) {
    const on = studentSurfaceCopy(confirmed, surface)
    assert.equal(on.granted, true)
    assert.match(`${on.title} ${on.detail || ''}`, /10% off Standard/)
    for (const status of [unconfirmed, other, guest]) {
      const off = studentSurfaceCopy(status, surface)
      assert.equal(off.granted, false)
      const text = `${off.title} ${off.detail || ''}`
      assert.doesNotMatch(text, /10%/)
      assert.doesNotMatch(text, /Claim/)
      assert.equal(text.includes(status.gateCopy), true)
    }
  }
  assert.match(studentSurfaceCopy(unconfirmed, 'home').detail, /Confirm the Clemson email/)
  assert.match(studentSurfaceCopy(other, 'confirm').title, /Other emails stay at full price/)
  assert.match(studentSurfaceCopy(guest, 'tiers').detail, /@g\.clemson\.edu/)
  for (const tier of ['comfort', 'xl', 'pet', 'tesla', 'wait']) {
    assert.equal(displayTierPrice(20, { isStudent: true, tier }).discount, 0)
  }
  assert.throws(() => studentSurfaceCopy(confirmed, 'receipt'), /Unknown student surface/)
  const screens = [
    '../../src/screens/RiderHome.jsx',
    '../../src/screens/ConfirmPickup.jsx',
    '../../src/screens/RideTiers.jsx',
    '../../apps/rider/app/index.tsx',
    '../../apps/rider/app/confirm.tsx',
    '../../apps/rider/app/tiers.tsx',
  ]
  for (const file of screens) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /studentSurfaceCopy\(/)
    assert.doesNotMatch(source, /Claim Clemson|Claim student pricing/)
  }
})

test('fallback fare recomputes the 25% deposit for airport, surge, and student', () => {
  const quiet = new Date('2026-09-22T16:00:00Z')
  const gsp = previewAirportFare({ airport: 'GSP', isStudent: false, at: quiet })
  const clt = previewAirportFare({ airport: 'CLT', isStudent: false, at: quiet })
  const student = previewAirportFare({ airport: 'GSP', isStudent: true, at: quiet })
  const rush = previewAirportFare({ airport: 'GSP', isStudent: false, at: new Date('2026-09-23T20:00:00Z') })
  assert.ok(clt.fareCents > gsp.fareCents)
  assert.equal(gsp.depositCents, cardDepositCents(gsp.cashCents))
  assert.equal(clt.depositCents, cardDepositCents(clt.cashCents))
  assert.notEqual(gsp.depositCents, clt.depositCents)
  assert.ok(student.studentDiscountCents > 0)
  assert.ok(student.depositCents < gsp.depositCents)
  assert.ok(rush.fareCents > gsp.fareCents)
  assert.equal(rush.surgeLabel, 'Airport rush')
  assert.equal(paymentRouteMissing({ status: 400, message: 'Unknown payment method action' }), true)
  assert.equal(paymentRouteMissing({ status: 404, message: 'NOT_FOUND' }), true)
  assert.equal(paymentRouteMissing({ status: 503, message: 'SUPABASE_SERVICE_ROLE_KEY not configured' }), true)
  assert.equal(paymentRouteMissing({ status: 503, message: 'Payments unavailable', payload: { tripId: 'trip_1' } }), false)
  assert.equal(paymentRouteMissing({ status: 401, message: 'Sign in required' }), false)
})

test('quote key changes with airport, date, and time', () => {
  assert.equal(quoteInputKey({ airport: 'GSP' }), 'GSP||')
  assert.notEqual(
    quoteInputKey({ airport: 'GSP', date: '2026-10-01', time: '15:00' }),
    quoteInputKey({ airport: 'CLT', date: '2026-10-01', time: '15:00' }),
  )
  assert.equal(quoteInputKey({ airport: 'GSP', date: 'Oct 1', time: '3pm' }), 'GSP||')
})

test('promo claim copy and referral reward text', () => {
  assert.match(promoClaimMessage({ claimed: true, status: 'pending' }), /first completed ride/)
  assert.match(promoClaimMessage({ error: 'That promo code was not found.' }), /not found/)
  assert.match(promoClaimMessage({ reason: 'already_referred', claimed: false }), /already has/)
  const rewards = describeRiderSocialRewards(null)
  assert.equal(rewards.referrer, '$5.00 ride credit')
  assert.match(rewards.referred, /20%/)
})

test('deposit copy shows full fare, 25% deposit, and remaining balance', () => {
  const student = studentDiscountCents(10000, { isStudent: true, tier: 'standard' })
  const balance = depositBalance({ fareCents: student.fareCents })
  assert.equal(student.fareCents, 9000)
  assert.equal(balance.depositCents, 2250)
  assert.equal(balance.remainingCents, 6750)
  assert.ok(balance.depositCents < depositBalance({ fareCents: 10000 }).depositCents)
  const quote = depositSurfaceCopy(balance, 'quote', { studentDiscountCents: student.discountCents })
  assert.match(quote, /Full fare \$90\.00/)
  assert.match(quote, /25% deposit of \$22\.50/)
  assert.match(quote, /Remaining balance \$67\.50/)
  assert.match(quote, /10% Standard student discount/)
  assert.match(depositSurfaceCopy(balance, 'confirm'), /due when the trip is complete/)
  assert.equal(
    depositSurfaceCopy(balance, 'upcoming'),
    'Deposit $22.50 · remaining balance $67.50',
  )
  assert.equal(depositSurfaceCopy({ fareCents: 8000, depositCents: 0 }, 'upcoming'), null)
  const lines = depositReceiptLines({ fare_cents: 9000, deposit_cents: 2250 })
  assert.deepEqual(lines, ['25% deposit: $22.50', 'Remaining balance: $67.50'])
  const receipt = buildReceiptText({
    id: 'trip_1',
    fare_cents: 9000,
    deposit_cents: 2250,
    tip_cents: 0,
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP',
  })
  assert.match(receipt, /Fare:/)
  assert.match(receipt, /25% deposit: \$22\.50/)
  assert.match(receipt, /Remaining balance: \$67\.50/)
  assert.equal(checkoutFailureCopy({ message: 'Payments unavailable', payload: { message: 'STRIPE_SECRET_KEY is not configured. Checkout cannot start.' } }), STRIPE_NOT_CONFIGURED_COPY)
  assert.equal(paymentRouteMissing({ status: 503, message: 'Payments unavailable', payload: { message: 'STRIPE_SECRET_KEY is not configured. Checkout cannot start.' } }), false)
  assert.match(checkoutFailureCopy({ message: 'Card was declined' }), /declined/)
})

test('a succeeded deposit row is the only paid signal', () => {
  assert.equal(depositSettled([{ kind: 'deposit', status: 'succeeded' }]), true)
  assert.equal(depositSettled([{ kind: 'deposit', status: 'requires_payment' }]), false)
  assert.equal(depositSettled([{ kind: 'tip', status: 'succeeded' }]), false)
  assert.equal(depositSettled([]), false)
})

test('checkout close keeps a paid trip and releases an unpaid one', () => {
  assert.equal(checkoutCloseOutcome({ reason: 'paid', released: false, status: 'searching' }), 'paid')
  assert.equal(checkoutCloseOutcome({ restored: true, status: 'scheduled' }), 'paid')
  assert.equal(checkoutCloseOutcome({ released: true, status: 'canceled' }), 'released')
  assert.equal(checkoutCloseOutcome({ released: false, reason: 'still_open' }), 'unchanged')
  assert.equal(checkoutCloseOutcome(null), 'unknown')
})

test('notification prefs keep web defaults', () => {
  const prefs = normalizePrefs(null)
  assert.equal(prefs.ride, true)
  assert.equal(prefs.promotions, false)
  assert.equal(prefs.dndNewRequestTones, false)
  const custom = normalizePrefs({ ride_updates: false, promotions: true, quiet: { dnd: true } })
  assert.equal(custom.ride, false)
  assert.equal(custom.promotions, true)
  assert.equal(custom.quiet.dnd, true)
  assert.equal(custom.quiet.start, '22:00')
})

test('authedJson on 401: refresh succeeds -> retried once with new access token', async () => {
  let fetchCount = 0
  const authHeaders = []
  const fakeFetch = async (url, options) => {
    fetchCount++
    authHeaders.push(options?.headers?.Authorization)
    if (fetchCount === 1) {
      return {
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'jwt expired' }),
      }
    }
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true, tripId: 'trip_123' }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'stale-token' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return {
          data: { session: { access_token: 'fresh-token' } },
        }
      },
    },
  }

  const result = await authedJson(fakeSupabase, '/api/stripe-payment-methods?action=quote', {
    method: 'POST',
    body: { airport: 'GSP' },
    fetch: fakeFetch,
  })

  assert.deepEqual(result, { ok: true, tripId: 'trip_123' })
  assert.equal(fetchCount, 2)
  assert.equal(refreshCount, 1)
  assert.equal(authHeaders[0], 'Bearer stale-token')
  assert.equal(authHeaders[1], 'Bearer fresh-token')
})

test('authedJson on 401: refresh fails -> auth error without retry', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 401,
      ok: false,
      text: async () => JSON.stringify({ error: 'Sign in required' }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'stale-token' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return {
          data: { session: null },
          error: new Error('Invalid refresh token'),
        }
      },
    },
  }

  await assert.rejects(
    async () => {
      await authedJson(fakeSupabase, '/api/stripe-payment-methods?action=quote', {
        method: 'POST',
        fetch: fakeFetch,
      })
    },
    (err) => {
      assert.equal(err.status, 401)
      assert.equal(err.kind, 'auth')
      assert.equal(err.auth, true)
      assert.equal(err.message, AUTH_REQUIRED_COPY)
      assert.equal(err.message, 'Please sign in again to continue.')
      return true
    }
  )

  assert.equal(fetchCount, 1)
  assert.equal(refreshCount, 1)
})

test('authedJson on 503 / config error: friendly message, no refresh', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 503,
      ok: false,
      text: async () => JSON.stringify({
        error: 'Payments unavailable',
        message: 'STRIPE_SECRET_KEY is not configured.',
      }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'valid-token' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return { data: { session: { access_token: 'new-token' } } }
      },
    },
  }

  await assert.rejects(
    async () => {
      await authedJson(fakeSupabase, '/api/stripe-payment-methods?action=quote', {
        method: 'POST',
        fetch: fakeFetch,
      })
    },
    (err) => {
      assert.equal(err.status, 503)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.unavailable, true)
      assert.equal(err.message, UNAVAILABLE_COPY)
      assert.equal(err.message, 'Payments are temporarily unavailable, please try again shortly')
      assert.equal(err.code, 'Payments unavailable')
      return true
    }
  )

  assert.equal(fetchCount, 1)
  assert.equal(refreshCount, 0)
})

test('authedJson on 401: retry also returns 401 -> surfaces auth error, no second refresh', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 401,
      ok: false,
      text: async () => JSON.stringify({ error: 'Unauthorized' }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'tok-1' } },
      }),
      refreshSession: async () => {
        refreshCount++
        return { data: { session: { access_token: 'tok-2' } } }
      },
    },
  }

  await assert.rejects(
    async () => {
      await authedJson(fakeSupabase, '/api/stripe-payment-methods?action=quote', {
        fetch: fakeFetch,
      })
    },
    (err) => {
      assert.equal(err.status, 401)
      assert.equal(err.kind, 'auth')
      assert.equal(err.message, AUTH_REQUIRED_COPY)
      return true
    }
  )

  assert.equal(fetchCount, 2)
  assert.equal(refreshCount, 1)
})

test('authedJson: server 500 config error returns friendly message without refresh', async () => {
  let fetchCount = 0
  const fakeFetch = async () => {
    fetchCount++
    return {
      status: 500,
      ok: false,
      text: async () => JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }),
    }
  }

  let refreshCount = 0
  const fakeSupabase = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      refreshSession: async () => {
        refreshCount++
        return { data: { session: { access_token: 'new-tok' } } }
      },
    },
  }

  await assert.rejects(
    async () => {
      await authedJson(fakeSupabase, '/api/trip', { fetch: fakeFetch })
    },
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.message, UNAVAILABLE_COPY)
      assert.equal(err.code, 'SUPABASE_SERVICE_ROLE_KEY not configured')
      return true
    }
  )

  assert.equal(fetchCount, 1)
  assert.equal(refreshCount, 0)
})

test('authedJson: works when mocking globalThis.fetch directly', async () => {
  const originalFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount++
    if (fetchCount === 1) {
      return {
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ error: 'jwt expired' }),
      }
    }
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    }
  }

  try {
    let refreshed = 0
    const fakeSupabase = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'old' } } }),
        refreshSession: async () => {
          refreshed++
          return { data: { session: { access_token: 'new' } } }
        },
      },
    }
    const res = await authedJson(fakeSupabase, '/api/test')
    assert.deepEqual(res, { ok: true })
    assert.equal(fetchCount, 2)
    assert.equal(refreshed, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

