import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cardDepositCents as fareCardDeposit } from '../../src/lib/fareRates.js'
import { normalizePrefs } from './notificationPrefs.js'
import { buildReceiptText } from '../../src/lib/receiptText.js'
import {
  AIRPORT_CHOICES,
  NATIVE_CHECKOUT_ORIGIN,
  STRIPE_NOT_CONFIGURED_COPY,
  STUDENT_CLAIM_COPY,
  STUDENT_CONFIRM_EMAIL_COPY,
  STUDENT_DISCOUNT_BPS,
  STUDENT_DISCOUNT_LABEL,
  STUDENT_EMAIL_HINT,
  STUDENT_EMAIL_REQUIRED_COPY,
  abandonAirportCheckout,
  airportCodeFromLabel,
  cardDepositCents,
  checkoutCloseOutcome,
  checkoutFailureCopy,
  claimPromoCode,
  depositBalance,
  depositReceiptLines,
  depositSettled,
  depositSurfaceCopy,
  describeRiderSocialRewards,
  displayTierPrice,
  formatUsdCents,
  loadPromoDesk,
  loadRiderBilling,
  loadStudentProfile,
  loadTripDeposit,
  markStudentVerified,
  parseQuoteResponse,
  paymentRouteMissing,
  previewAirportFare,
  promoClaimMessage,
  quoteAirportFare,
  quoteAtIso,
  quoteInputKey,
  recomputeDeposit,
  riderPromoShareText,
  riderPromoShareUrl,
  startAirportDeposit,
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

  const omittedCash = parseQuoteResponse({ quote: { fareCents: 4000, breakdown: {} } })
  assert.equal(omittedCash.cashCents, 4000)
  assert.equal(omittedCash.depositCents, cardDepositCents(4000))
  assert.equal(omittedCash.surgeMultiplier, 1)
  assert.equal(omittedCash.surgeLabel, null)
  assert.equal(omittedCash.routeSource, null)

  const zeroCash = parseQuoteResponse({ quote: { fareCents: 4000, cashCents: 0 } })
  assert.equal(zeroCash.cashCents, 0)
  assert.equal(zeroCash.depositCents, 0)

  const empty = parseQuoteResponse(null)
  assert.deepEqual(empty, {
    fareCents: 0,
    cashCents: 0,
    depositCents: 0,
    studentDiscountCents: 0,
    surgeMultiplier: 1,
    surgeLabel: null,
    routeSource: null,
  })
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
  assert.equal(displayTierPrice(10, { surgeMultiplier: 0 }).price, 10)
  assert.equal(displayTierPrice(10, { surgeMultiplier: Number.NaN }).price, 10)
  assert.equal(displayTierPrice(-4, { isStudent: true }).price, 0)
  assert.equal(displayTierPrice(-4, { isStudent: true }).discount, 0)
  assert.deepEqual(studentTripMeta({ isStudent: true, tier: 'standard', fareCents: 1850 }), {
    isStudent: true,
    studentLabel: 'Clemson student · 10% off Standard',
    student_discount_cents: 185,
  })
  assert.deepEqual(studentTripMeta({ isStudent: false, fareCents: 1850 }), {})
  assert.deepEqual(studentTripMeta({ isStudent: true, tier: 'comfort', fareCents: 2300 }), { isStudent: true })
  // BUG?: an explicit empty or null tier still receives the Standard 10% (`tier && tier !== 'standard'`).
  assert.equal(studentDiscountCents(1000, { isStudent: true, tier: '' }).discountCents, 100)
  assert.equal(studentDiscountCents(1000, { isStudent: true, tier: null }).discountCents, 100)
  assert.equal(studentDiscountCents('nope', { isStudent: true }).discountCents, 0)

  const confirmed = studentStatus({
    email: 'ignored@gmail.com',
    studentVerifiedAt: '2026-08-01T00:00:00Z',
    user: { email: 'ada@clemson.edu', email_confirmed_at: '2026-09-01T00:00:00Z' },
  })
  assert.equal(confirmed.verified, true)
  assert.equal(confirmed.viaEmail, true)
  assert.equal(confirmed.confirmed, true)
  assert.equal(confirmed.verifiedAt, '2026-08-01T00:00:00Z')
  assert.equal(confirmed.gateCopy, null)
  assert.equal(confirmed.discountLabel, STUDENT_DISCOUNT_LABEL)
  const confirmedNoStamp = studentStatus({
    user: { email: 'ada@clemson.edu', email_confirmed_at: '2026-09-01T00:00:00Z' },
  })
  assert.equal(confirmedNoStamp.verified, true)
  assert.equal(confirmedNoStamp.verifiedAt, null)
  assert.equal(studentStatus({ email: 'a@gmail.com', studentVerifiedAt: '2026-01-01' }).verifiedAt, null)
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
  assert.equal(paymentRouteMissing(null), false)
  assert.equal(paymentRouteMissing({ status: 404, message: 'stripe_secret_key missing' }), false)
  const unknownAirport = previewAirportFare({ airport: 'ATL', isStudent: false, at: quiet })
  assert.equal(unknownAirport.fareCents, gsp.fareCents)
  assert.equal(unknownAirport.depositCents, gsp.depositCents)
  assert.equal(unknownAirport.source, 'fallback')
})

test('quote key changes with airport, date, and time', () => {
  assert.equal(quoteInputKey({ airport: 'GSP' }), 'GSP||')
  assert.notEqual(
    quoteInputKey({ airport: 'GSP', date: '2026-10-01', time: '15:00' }),
    quoteInputKey({ airport: 'CLT', date: '2026-10-01', time: '15:00' }),
  )
  assert.equal(quoteInputKey({ airport: 'GSP', date: 'Oct 1', time: '3pm' }), 'GSP||')
  assert.equal(quoteInputKey({ airport: 'ATL', date: '2026-10-01', time: '15:00' }), 'GSP|2026-10-01|15:00')
  assert.equal(quoteInputKey({ airport: 'CLT', date: '2026-1-1', time: '15:00:00' }), 'CLT||')
  assert.equal(quoteInputKey(), 'GSP||')
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
  const preset = depositSurfaceCopy(
    { fareCents: 10000, depositCents: 100, remainingCents: 5000 },
    'upcoming',
  )
  assert.equal(preset, 'Deposit $1.00 · remaining balance $50.00')
  const lines = depositReceiptLines({ fare_cents: 9000, deposit_cents: 2250 })
  assert.deepEqual(lines, ['25% deposit: $22.50', 'Remaining balance: $67.50'])
  assert.deepEqual(depositReceiptLines(null), [])
  assert.deepEqual(depositReceiptLines({ fare_cents: 9000 }), [])
  assert.deepEqual(depositReceiptLines({ fare_cents: 9000, deposit_cents: '' }), [])
  assert.deepEqual(depositReceiptLines({ fare_cents: 9000, deposit_cents: 0 }), [])
  assert.deepEqual(depositReceiptLines({ fare_cents: 1000, deposit_cents: 5000 }), [
    '25% deposit: $10.00',
    'Remaining balance: $0.00',
  ])
  assert.deepEqual(depositReceiptLines({ fare_cents: 9000, deposit_cents: '2250' }), lines)
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
  assert.equal(checkoutFailureCopy({}), 'Checkout failed. No charge was made.')
  assert.equal(checkoutFailureCopy(null), 'Checkout failed. No charge was made.')
  assert.equal(
    checkoutFailureCopy({ payload: { message: 'Card was declined' } }),
    'Card was declined',
  )
  assert.equal(
    checkoutFailureCopy({ payload: { error: 'Insufficient funds' } }),
    'Insufficient funds',
  )
  assert.equal(
    checkoutFailureCopy({ error: 'Bank declined the card' }),
    'Bank declined the card',
  )
  assert.equal(
    checkoutFailureCopy({ message: 'Card was declined', payload: { message: 'Try another card' } }),
    'Card was declined',
  )
  assert.equal(
    checkoutFailureCopy({ payload: { message: '  Card was declined  ' } }),
    'Card was declined',
  )
  assert.equal(
    checkoutFailureCopy({ payload: { message: 'STRIPE_SECRET_KEY is not configured' } }),
    STRIPE_NOT_CONFIGURED_COPY,
  )
  assert.equal(
    checkoutFailureCopy({ payload: { message: '  ' }, error: { code: 'card_declined' } }),
    'Checkout failed. No charge was made.',
  )
})

test('a succeeded deposit row is the only paid signal', () => {
  assert.equal(depositSettled([{ kind: 'deposit', status: 'succeeded' }]), true)
  assert.equal(depositSettled([{ kind: 'deposit', status: 'requires_payment' }]), false)
  assert.equal(depositSettled([{ kind: 'tip', status: 'succeeded' }]), false)
  assert.equal(depositSettled([]), false)
  assert.equal(depositSettled(null), false)
  assert.equal(depositSettled([{ kind: 'airport_deposit', status: 'Paid' }]), true)
  assert.equal(depositSettled([{ kind: 'deposit', status: 'complete' }]), true)
  assert.equal(depositSettled([{ kind: 'deposit', status: 'SUCCEEDED' }]), true)
})

test('checkout close keeps a paid trip and releases an unpaid one', () => {
  assert.equal(checkoutCloseOutcome({ reason: 'paid', released: false, status: 'searching' }), 'paid')
  assert.equal(checkoutCloseOutcome({ restored: true, status: 'scheduled' }), 'paid')
  assert.equal(checkoutCloseOutcome({ released: true, status: 'canceled' }), 'released')
  assert.equal(checkoutCloseOutcome({ released: false, reason: 'still_open' }), 'unchanged')
  assert.equal(checkoutCloseOutcome(null), 'unknown')
  assert.equal(checkoutCloseOutcome('paid'), 'unknown')
  assert.equal(checkoutCloseOutcome({ reason: 'paid', released: true }), 'paid')
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

function makeFakeSupabase({
  tables = {},
  rpcs = {},
  session = null,
  failUpsert = false,
  failUpdate = false,
  failInsert = false,
  failUpdateTables = null,
} = {}) {
  const db = {}
  for (const [k, v] of Object.entries(tables)) {
    if (v?.__error) {
      db[k] = v
    } else {
      db[k] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : []
    }
  }

  return {
    auth: {
      getSession: async () => ({ data: { session } }),
    },
    rpc: async (name, args) => {
      if (rpcs[name]) {
        return rpcs[name](args)
      }
      return { data: null, error: new Error(`RPC ${name} not found`) }
    },
    from(table) {
      const filters = []
      let orCondition = null
      let mode = 'select'
      let updatePayload = null
      let insertPayload = null
      let upsertPayload = null
      let upsertOptions = null
      let orderCol = null
      let orderAsc = true
      let limitCount = null

      const builder = {
        select() {
          return builder
        },
        eq(col, val) {
          filters.push({ col, val })
          return builder
        },
        or(condition) {
          orCondition = condition
          return builder
        },
        order(col, { ascending = true } = {}) {
          orderCol = col
          orderAsc = ascending
          return builder
        },
        limit(n) {
          limitCount = n
          return builder
        },
        update(patch) {
          mode = 'update'
          updatePayload = patch
          return builder
        },
        insert(payload) {
          mode = 'insert'
          insertPayload = payload
          return builder
        },
        upsert(payload, options) {
          mode = 'upsert'
          upsertPayload = payload
          upsertOptions = options
          return builder
        },
        async maybeSingle() {
          const res = await builder._run()
          if (res.error) return res
          return { data: res.data && res.data.length > 0 ? res.data[0] : null, error: null }
        },
        async single() {
          const res = await builder._run()
          if (res.error) return res
          if (!res.data || res.data.length === 0) {
            return { data: null, error: new Error('No rows found') }
          }
          return { data: res.data[0], error: null }
        },
        then(resolve, reject) {
          return builder._run().then(resolve, reject)
        },
        async _run() {
          const tableStore = db[table]
          if (tableStore?.__error) {
            return { data: null, error: tableStore.__error }
          }
          const rows = Array.isArray(tableStore) ? tableStore : []

          if (mode === 'select') {
            let result = [...rows]
            for (const f of filters) {
              result = result.filter((r) => r[f.col] === f.val)
            }
            if (orCondition) {
              const parts = orCondition.split(',').map((p) => {
                const match = p.match(/^([^.]+)\.eq\.(.*)$/)
                return match ? { col: match[1], val: match[2] } : null
              }).filter(Boolean)
              result = result.filter((r) =>
                parts.some((p) => String(r[p.col]) === String(p.val))
              )
            }
            if (orderCol) {
              result.sort((a, b) => {
                if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1
                if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1
                return 0
              })
            }
            if (limitCount != null) {
              result = result.slice(0, limitCount)
            }
            return { data: result, error: null }
          }

          if (mode === 'update') {
            const blocked = failUpdateTables != null
              ? failUpdateTables.includes(table)
              : failUpdate
            if (blocked) {
              return { data: null, error: new Error('Update failed') }
            }
            let matched = 0
            for (const r of rows) {
              if (filters.every((f) => r[f.col] === f.val)) {
                Object.assign(r, updatePayload)
                matched++
              }
            }
            return { data: null, error: null, count: matched }
          }

          if (mode === 'insert') {
            if (failInsert) {
              return { data: null, error: new Error('Insert failed') }
            }
            const items = Array.isArray(insertPayload) ? insertPayload : [insertPayload]
            rows.push(...items)
            return { data: items, error: null }
          }

          if (mode === 'upsert') {
            if (failUpsert) {
              return { data: null, error: new Error('Upsert failed') }
            }
            const item = upsertPayload
            const key = upsertOptions?.onConflict || 'id'
            const idx = rows.findIndex((r) => r[key] === item[key])
            if (idx >= 0) {
              Object.assign(rows[idx], item)
            } else {
              rows.push(item)
            }
            return { data: [item], error: null }
          }

          return { data: null, error: null }
        },
      }
      return builder
    },
  }
}

test('formatUsdCents formats positive, negative, zero, and fractional cents', () => {
  assert.equal(formatUsdCents(0), '$0.00')
  assert.equal(formatUsdCents(5), '$0.05')
  assert.equal(formatUsdCents(50), '$0.50')
  assert.equal(formatUsdCents(100), '$1.00')
  assert.equal(formatUsdCents(2500), '$25.00')
  assert.equal(formatUsdCents(123456), '$1,234.56')
  assert.equal(formatUsdCents(-50), '-$0.50')
  assert.equal(formatUsdCents(-1050), '-$10.50')
  assert.equal(formatUsdCents(null), '$0.00')
  assert.equal(formatUsdCents(undefined), '$0.00')
  assert.equal(formatUsdCents('2500'), '$25.00')
  assert.equal(formatUsdCents(100.4), '$1.00')
  assert.equal(formatUsdCents(100.6), '$1.01')
})

test('airportCodeFromLabel resolves airport codes and handles invalid inputs', () => {
  assert.equal(airportCodeFromLabel('GSP Airport'), 'GSP')
  assert.equal(airportCodeFromLabel('Greenville-Spartanburg International'), 'GSP')
  assert.equal(airportCodeFromLabel('greenville'), 'GSP')
  assert.equal(airportCodeFromLabel('CLT Airport'), 'CLT')
  assert.equal(airportCodeFromLabel('Charlotte Douglas Intl'), 'CLT')
  assert.equal(airportCodeFromLabel('charlotte'), 'CLT')
  assert.equal(airportCodeFromLabel('clt'), 'CLT')
  assert.equal(airportCodeFromLabel('Atlanta Airport (ATL)'), null)
  assert.equal(airportCodeFromLabel(''), null)
  assert.equal(airportCodeFromLabel(null), null)
  assert.equal(airportCodeFromLabel(undefined), null)
  assert.deepEqual(AIRPORT_CHOICES, [
    { code: 'GSP', name: 'Greenville-Spartanburg' },
    { code: 'CLT', name: 'Charlotte Douglas' },
  ])
})

test('quoteAtIso constructs ISO timestamps with fallback to now', () => {
  const fixedNow = new Date('2026-09-24T12:00:00.000Z')
  assert.equal(quoteAtIso({ date: null }, fixedNow), fixedNow.toISOString())
  assert.equal(quoteAtIso({ date: 'invalid-date' }, fixedNow), fixedNow.toISOString())
  assert.equal(quoteAtIso({}, fixedNow), fixedNow.toISOString())

  const isoDefaultTime = quoteAtIso({ date: '2026-10-15' }, fixedNow)
  assert.ok(isoDefaultTime.startsWith('2026-10-15'))

  const isoCustomTime = quoteAtIso({ date: '2026-10-15', time: '08:30' }, fixedNow)
  assert.ok(isoCustomTime.startsWith('2026-10-15'))
  assert.equal(
    quoteAtIso({ date: '2026-10-15', time: '8:30' }, fixedNow),
    quoteAtIso({ date: '2026-10-15' }, fixedNow),
  )
  assert.equal(quoteAtIso({ date: '2026-13-40', time: '08:30' }, fixedNow), fixedNow.toISOString())

  // BUG?: quoteAtIso parses `${date}T${clock}:00` in local machine time rather than explicit America/New_York timezone
  const dateObj = new Date(isoCustomTime)
  assert.ok(!Number.isNaN(dateObj.getTime()))
})

test('riderPromoShareUrl and riderPromoShareText construct normalized share links', () => {
  assert.equal(
    riderPromoShareUrl('tiger-ride-10'),
    'https://clemson-airport-rides.vercel.app/#/sign-up?ref=TIGERRIDE10',
  )
  assert.equal(
    riderPromoShareText('tiger-ride-10'),
    'Join me on Clemson RIDES. Use code TIGERRIDE10 when you sign up.',
  )
  assert.equal(
    riderPromoShareUrl(null),
    'https://clemson-airport-rides.vercel.app/#/sign-up?ref=',
  )
  assert.equal(
    riderPromoShareText(null),
    'Join me on Clemson RIDES. Use code  when you sign up.',
  )
  assert.equal(
    riderPromoShareUrl('abc-def-ghij-klmnop-extra'),
    'https://clemson-airport-rides.vercel.app/#/sign-up?ref=ABCDEFGHIJKLMNOP',
  )
})

test('describeRiderSocialRewards handles fixed and percent discounts', () => {
  const fixed = describeRiderSocialRewards({
    referrer_credit_cents: 1000,
    referred_discount_kind: 'fixed',
    referred_cents_off: 750,
  })
  assert.equal(fixed.referrer, '$10.00 ride credit')
  assert.equal(fixed.referred, '$7.50 ride credit')

  const percent = describeRiderSocialRewards({
    referrer_credit_cents: 600,
    referred_discount_kind: 'percent',
    referred_percent_off: 25,
  })
  assert.equal(percent.referrer, '$6.00 ride credit')
  assert.equal(percent.referred, '25% of the first-ride fare as ride credit')

  // BUG?: referrer_credit_cents of 0 is treated as missing (`|| 500`) and shows $5.00.
  // referred_cents_off of 0 stays $0.00. referred_percent_off of 0 falls back to 20 (`|| 20`).
  const zeroRewards = describeRiderSocialRewards({
    referrer_credit_cents: 0,
    referred_discount_kind: 'fixed',
    referred_cents_off: 0,
  })
  assert.equal(zeroRewards.referrer, '$5.00 ride credit')
  assert.equal(zeroRewards.referred, '$0.00 ride credit')

  const zeroPercent = describeRiderSocialRewards({
    referrer_credit_cents: 100,
    referred_discount_kind: 'percent',
    referred_percent_off: 0,
  })
  assert.equal(zeroPercent.referrer, '$1.00 ride credit')
  assert.equal(zeroPercent.referred, '20% of the first-ride fare as ride credit')

  const unknownKind = describeRiderSocialRewards({ referred_discount_kind: 'bogus' })
  assert.match(unknownKind.referred, /20%/)
})

test('promoClaimMessage covers all result branches', () => {
  assert.equal(promoClaimMessage(null), 'Promo claim did not return a result.')
  assert.equal(promoClaimMessage(undefined), 'Promo claim did not return a result.')
  assert.equal(promoClaimMessage('not an object'), 'Promo claim did not return a result.')
  assert.equal(promoClaimMessage({ error: 'Code expired' }), 'Code expired')
  assert.equal(
    promoClaimMessage({ claimed: true }),
    'Code saved. Ride credit is added only after your first completed ride.',
  )
  assert.equal(
    promoClaimMessage({ reason: 'already_referred' }),
    'This account already has a promo code.',
  )
  assert.equal(
    promoClaimMessage({ reason: 'no_code' }),
    'Enter a promo code.',
  )
  assert.equal(promoClaimMessage({}), 'Promo saved.')
  assert.equal(promoClaimMessage({ reason: 'other' }), 'Promo saved.')
})

test('claimPromoCode normalizes code and invokes RPC', async () => {
  await assert.rejects(
    () => claimPromoCode(null, 'code123'),
    /Supabase is not configured/,
  )

  let calledRpc = null
  let calledArgs = null
  const supabase = {
    rpc: async (name, args) => {
      calledRpc = name
      calledArgs = args
      return { data: { ok: true, claimed: true }, error: null }
    },
  }

  const result = await claimPromoCode(supabase, 'tiger-promo-2026')
  assert.equal(calledRpc, 'claim_rider_social_promo')
  assert.equal(calledArgs.p_code, 'TIGERPROMO2026')
  assert.equal(result.claimed, true)

  const failingSupabase = {
    rpc: async () => ({ data: null, error: { message: 'Invalid promo code' } }),
  }
  await assert.rejects(
    () => claimPromoCode(failingSupabase, 'bad'),
    /Invalid promo code/,
  )

  const emptySupabase = {
    rpc: async () => ({ data: null, error: null }),
  }
  const fallbackResult = await claimPromoCode(emptySupabase, 'ok')
  assert.deepEqual(fallbackResult, { ok: false, error: 'Promo claim failed' })
})

test('loadPromoDesk returns code, config, sent and received referrals', async () => {
  const unauthed = await loadPromoDesk(null, null)
  assert.equal(unauthed.error, 'Sign in required')
  assert.equal(unauthed.code, null)

  const userId = 'user-1'
  const mockConfig = { type: 'rider_social', referrer_credit_cents: 500 }
  const mockReferrals = [
    { id: 'ref-1', type: 'rider_social', referrer_id: 'user-1', referred_id: 'user-2', status: 'completed', created_at: '2026-09-20' },
    { id: 'ref-2', type: 'rider_social', referrer_id: 'user-3', referred_id: 'user-1', status: 'pending', created_at: '2026-09-21' },
    { id: 'ref-3', type: 'rider_social', referrer_id: 'user-4', referred_id: 'user-5', status: 'pending', created_at: '2026-09-19' },
  ]

  const fakeDb = makeFakeSupabase({
    tables: {
      rider_referral_config: [mockConfig],
      rider_referrals: mockReferrals,
    },
    rpcs: {
      ensure_rider_social_code: async () => ({ data: 'TIGER123', error: null }),
    },
  })

  const desk = await loadPromoDesk(fakeDb, userId)
  assert.equal(desk.code, 'TIGER123')
  assert.equal(desk.config.referrer_credit_cents, 500)
  assert.equal(desk.sent.length, 1)
  assert.equal(desk.sent[0].id, 'ref-1')
  assert.equal(desk.received.id, 'ref-2')
  assert.equal(desk.error, null)

  const fakeDbRpcErr = makeFakeSupabase({
    tables: { rider_referral_config: [mockConfig], rider_referrals: [] },
    rpcs: {
      ensure_rider_social_code: async () => ({ data: null, error: { message: 'RPC failed' } }),
    },
  })
  const deskErr = await loadPromoDesk(fakeDbRpcErr, userId)
  assert.equal(deskErr.error, 'RPC failed')
  assert.equal(deskErr.code, null)

  const fakeDbObjectCode = makeFakeSupabase({
    tables: { rider_referral_config: [mockConfig], rider_referrals: [] },
    rpcs: {
      ensure_rider_social_code: async () => ({ data: { code: 'OBJ' }, error: null }),
    },
  })
  const deskObject = await loadPromoDesk(fakeDbObjectCode, userId)
  assert.equal(deskObject.code, null)
  assert.equal(deskObject.error, null)
  assert.deepEqual(deskObject.sent, [])
  assert.equal(deskObject.received, null)

  const fakeDbCfgErr = makeFakeSupabase({
    tables: {
      rider_referral_config: { __error: { message: 'cfg down' } },
      rider_referrals: { __error: { message: 'refs down' } },
    },
    rpcs: {
      ensure_rider_social_code: async () => ({ data: 'TIGER123', error: null }),
    },
  })
  const deskCfg = await loadPromoDesk(fakeDbCfgErr, userId)
  assert.equal(deskCfg.code, 'TIGER123')
  assert.equal(deskCfg.config, null)
  assert.deepEqual(deskCfg.sent, [])
  assert.equal(deskCfg.received, null)
  // refs error is reported ahead of the config error
  assert.equal(deskCfg.error, 'refs down')

  const signedOut = await loadPromoDesk(fakeDb, '')
  assert.equal(signedOut.error, 'Sign in required')
})

test('markStudentVerified validates email confirmation and updates student status', async () => {
  assert.deepEqual(await markStudentVerified(null, null), { verified: false, error: 'Sign in required' })
  assert.deepEqual(await markStudentVerified({}, {}), { verified: false, error: 'Sign in required' })

  const nonClemson = await markStudentVerified({}, { id: 'u1', email: 'user@gmail.com' })
  assert.equal(nonClemson.verified, false)
  assert.equal(nonClemson.error, STUDENT_EMAIL_REQUIRED_COPY)

  const unconfirmed = await markStudentVerified({}, { id: 'u1', email: 'tiger@clemson.edu', email_confirmed_at: null })
  assert.equal(unconfirmed.verified, false)
  assert.equal(unconfirmed.error, STUDENT_CONFIRM_EMAIL_COPY)

  const fakeDbProfileErr = makeFakeSupabase({
    tables: {
      profiles: { __error: { message: 'Profile write failed' } },
    },
  })
  const profileErrResult = await markStudentVerified(fakeDbProfileErr, {
    id: 'u1',
    email: 'tiger@clemson.edu',
    email_confirmed_at: '2026-09-01T00:00:00Z',
  })
  assert.equal(profileErrResult.verified, false)
  assert.equal(profileErrResult.error, 'Profile write failed')

  const fakeDbSuccess = makeFakeSupabase({
    tables: {
      profiles: [{ id: 'u1', email: 'tiger@clemson.edu' }],
      student_verifications: [],
    },
  })
  const successResult = await markStudentVerified(fakeDbSuccess, {
    id: 'u1',
    email: 'Tiger@G.Clemson.Edu',
    email_confirmed_at: '2026-09-01T00:00:00Z',
  })
  assert.equal(successResult.verified, true)
  assert.ok(successResult.verifiedAt)
  assert.equal(successResult.error, null)
  const savedProfile = await fakeDbSuccess.from('profiles').select('*').eq('id', 'u1').maybeSingle()
  assert.equal(savedProfile.data.email, 'tiger@g.clemson.edu')
  assert.equal(savedProfile.data.student_verified_at, successResult.verifiedAt)
  const savedVerification = await fakeDbSuccess
    .from('student_verifications')
    .select('*')
    .eq('profile_id', 'u1')
    .maybeSingle()
  assert.equal(savedVerification.data.email, 'tiger@g.clemson.edu')
  assert.equal(savedVerification.data.verified_at, successResult.verifiedAt)

  const fakeDbUpsertFail = makeFakeSupabase({
    tables: {
      profiles: [{ id: 'u1', email: 'tiger@clemson.edu' }],
      student_verifications: [{ id: 'sv-1', profile_id: 'u1', email: 'old@clemson.edu' }],
    },
    failUpsert: true,
  })
  const fallbackUpdateResult = await markStudentVerified(fakeDbUpsertFail, {
    id: 'u1',
    email: 'tiger@clemson.edu',
    email_confirmed_at: '2026-09-01T00:00:00Z',
  })
  assert.equal(fallbackUpdateResult.verified, true)
  assert.equal(fallbackUpdateResult.error, null)

  // BUG?: markStudentVerified returns verified: true even when fallback update to student_verifications fails with an error
  const fakeDbUpdateFail = makeFakeSupabase({
    tables: {
      profiles: [{ id: 'u1', email: 'tiger@clemson.edu' }],
      student_verifications: [{ id: 'sv-1', profile_id: 'u1', email: 'old@clemson.edu' }],
    },
    failUpsert: true,
    failUpdateTables: ['student_verifications'],
  })
  const bugUpdateResult = await markStudentVerified(fakeDbUpdateFail, {
    id: 'u1',
    email: 'tiger@clemson.edu',
    email_confirmed_at: '2026-09-01T00:00:00Z',
  })
  assert.equal(bugUpdateResult.verified, true)
  assert.equal(bugUpdateResult.error, 'Update failed')
  const staleVerification = await fakeDbUpdateFail
    .from('student_verifications')
    .select('*')
    .eq('profile_id', 'u1')
    .maybeSingle()
  assert.equal(staleVerification.data.email, 'old@clemson.edu')
  const profileDespite = await fakeDbUpdateFail.from('profiles').select('*').eq('id', 'u1').maybeSingle()
  assert.equal(profileDespite.data.email, 'tiger@clemson.edu')
  assert.ok(profileDespite.data.student_verified_at)

  // BUG?: markStudentVerified returns verified: true even when fallback insert to student_verifications fails with an error
  const fakeDbInsertFail = makeFakeSupabase({
    tables: {
      profiles: [{ id: 'u1', email: 'tiger@clemson.edu' }],
      student_verifications: [],
    },
    failUpsert: true,
    failInsert: true,
  })
  const bugInsertResult = await markStudentVerified(fakeDbInsertFail, {
    id: 'u1',
    email: 'tiger@clemson.edu',
    email_confirmed_at: '2026-09-01T00:00:00Z',
  })
  assert.equal(bugInsertResult.verified, true)
  assert.equal(bugInsertResult.error, 'Insert failed')
  const missingVerification = await fakeDbInsertFail
    .from('student_verifications')
    .select('*')
    .eq('profile_id', 'u1')
    .maybeSingle()
  assert.equal(missingVerification.data, null)
})

test('loadStudentProfile loads verification date and email', async () => {
  const unauthed = await loadStudentProfile(null, null)
  assert.equal(unauthed.error, 'Sign in required')
  assert.equal(unauthed.studentVerifiedAt, null)

  const fakeDb = makeFakeSupabase({
    tables: {
      profiles: [{ id: 'u1', email: 'tiger@clemson.edu', student_verified_at: '2026-09-10T00:00:00Z' }],
    },
  })
  const loaded = await loadStudentProfile(fakeDb, 'u1')
  assert.equal(loaded.email, 'tiger@clemson.edu')
  assert.equal(loaded.studentVerifiedAt, '2026-09-10T00:00:00Z')
  assert.equal(loaded.error, null)

  const fakeDbErr = makeFakeSupabase({
    tables: {
      profiles: { __error: { message: 'Failed to read profile' } },
    },
  })
  const errLoaded = await loadStudentProfile(fakeDbErr, 'u1')
  assert.equal(errLoaded.error, 'Failed to read profile')

  const missing = await loadStudentProfile(makeFakeSupabase({ tables: { profiles: [] } }), 'nobody')
  assert.equal(missing.error, null)
  assert.equal(missing.email, null)
  assert.equal(missing.studentVerifiedAt, null)
})

test('loadRiderBilling loads card, deposits, charges, and rides', async () => {
  // BUG?: loadRiderBilling unauthenticated return omits charges property (returns undefined instead of empty array [])
  const unauthed = await loadRiderBilling(null, null)
  assert.equal(unauthed.profileError, 'Sign in required')
  assert.equal(unauthed.card, null)
  assert.deepEqual(unauthed.deposits, [])
  assert.deepEqual(unauthed.rides, [])
  assert.equal(unauthed.charges, undefined)

  const fakeDb = makeFakeSupabase({
    tables: {
      profiles: [{
        id: 'u1',
        stripe_card_brand: 'visa',
        stripe_card_last4: '4242',
        stripe_default_pm_id: 'pm_123',
        billing_activated_at: '2026-09-01T00:00:00Z',
      }],
      payments: [
        { id: 'p1', rider_id: 'u1', kind: 'deposit', amount_cents: 2500, status: 'succeeded', created_at: '2026-09-22' },
        { id: 'p2', rider_id: 'u1', kind: 'ride', amount_cents: 7500, status: 'succeeded', created_at: '2026-09-22' },
      ],
      trips: [
        { id: 't1', rider_id: 'u1', status: 'completed', pickup_label: 'Clemson', dropoff_label: 'GSP', fare_cents: 10000, deposit_cents: 2500, created_at: '2026-09-22' },
      ],
    },
  })

  const billing = await loadRiderBilling(fakeDb, 'u1')
  assert.deepEqual(billing.card, {
    brand: 'visa',
    last4: '4242',
    billingActivatedAt: '2026-09-01T00:00:00Z',
  })
  assert.equal(billing.deposits.length, 1)
  assert.equal(billing.deposits[0].id, 'p1')
  assert.equal(billing.charges.length, 2)
  assert.equal(billing.rides.length, 1)
  assert.equal(billing.profileError, null)
  assert.equal(billing.paymentsError, null)
  assert.equal(billing.ridesError, null)

  const fakeDbPmOnly = makeFakeSupabase({
    tables: {
      profiles: [{ id: 'u1', stripe_card_brand: null, stripe_card_last4: null, stripe_default_pm_id: 'pm_456', billing_activated_at: null }],
      payments: [],
      trips: [],
    },
  })
  const billingPm = await loadRiderBilling(fakeDbPmOnly, 'u1')
  assert.deepEqual(billingPm.card, {
    brand: 'card',
    last4: null,
    billingActivatedAt: null,
  })

  const fakeDbNoCard = makeFakeSupabase({
    tables: {
      profiles: [{ id: 'u1', stripe_card_brand: null, stripe_card_last4: null, stripe_default_pm_id: null }],
      payments: [],
      trips: [],
    },
  })
  const billingNoCard = await loadRiderBilling(fakeDbNoCard, 'u1')
  assert.equal(billingNoCard.card, null)

  const fakeDbErr = makeFakeSupabase({
    tables: {
      profiles: { __error: { message: 'profile down' } },
      payments: { __error: { message: 'pay down' } },
      trips: { __error: { message: 'trips down' } },
    },
  })
  const billingErr = await loadRiderBilling(fakeDbErr, 'u1')
  assert.equal(billingErr.card, null)
  assert.deepEqual(billingErr.deposits, [])
  assert.deepEqual(billingErr.charges, [])
  assert.deepEqual(billingErr.rides, [])
  assert.equal(billingErr.profileError, 'profile down')
  assert.equal(billingErr.paymentsError, 'pay down')
  assert.equal(billingErr.ridesError, 'trips down')
})

test('loadTripDeposit loads deposit status for a trip', async () => {
  const unauthed = await loadTripDeposit(null, null)
  assert.equal(unauthed.settled, false)
  assert.deepEqual(unauthed.payments, [])
  assert.equal(unauthed.error, null)

  const fakeDb = makeFakeSupabase({
    tables: {
      payments: [
        { id: 'p1', trip_id: 'trip-1', kind: 'deposit', amount_cents: 2500, status: 'succeeded' },
      ],
    },
  })
  const res = await loadTripDeposit(fakeDb, 'trip-1')
  assert.equal(res.settled, true)
  assert.equal(res.payments.length, 1)
  assert.equal(res.error, null)

  const fakeDbUnpaid = makeFakeSupabase({
    tables: {
      payments: [
        { id: 'p1', trip_id: 'trip-2', kind: 'deposit', amount_cents: 2500, status: 'requires_payment' },
      ],
    },
  })
  const resUnpaid = await loadTripDeposit(fakeDbUnpaid, 'trip-2')
  assert.equal(resUnpaid.settled, false)

  const fakeDbErr = makeFakeSupabase({
    tables: {
      payments: { __error: { message: 'Payments query error' } },
    },
  })
  const resErr = await loadTripDeposit(fakeDbErr, 'trip-1')
  assert.equal(resErr.settled, false)
  assert.equal(resErr.error, 'Payments query error')
})

test('quoteAirportFare calls API and falls back to previewAirportFare when route is missing', async () => {
  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url, opts) => {
      assert.ok(url.includes('/api/stripe-payment-methods?action=quote'))
      const body = JSON.parse(opts.body)
      assert.equal(body.airport, 'GSP')
      assert.equal(body.tier, 'standard')
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          quote: { fareCents: 9000, cashCents: 9000, breakdown: { student_discount_cents: 1000 } },
          surge: { multiplier: 1, rule: null },
          routeSource: 'google',
        }),
      }
    }

    const quote = await quoteAirportFare(null, { airport: 'GSP', isStudent: true })
    assert.equal(quote.source, 'api')
    assert.equal(quote.fareCents, 9000)
    assert.equal(quote.studentDiscountCents, 1000)

    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'not_found', message: 'Unknown payment action' }),
      }
    }

    const fallbackQuote = await quoteAirportFare(null, { airport: 'CLT', isStudent: false })
    assert.equal(fallbackQuote.source, 'fallback')
    assert.ok(fallbackQuote.fareCents > 0)
    assert.equal(fallbackQuote.depositCents, cardDepositCents(fallbackQuote.cashCents))

    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: 'Internal Server Error' }),
      }
    }

    await assert.rejects(
      () => quoteAirportFare(null, { airport: 'GSP' }),
      /Internal Server Error/,
    )
  } finally {
    globalThis.fetch = origFetch
  }
})

test('startAirportDeposit starts checkout session with fallback to legacy route', async () => {
  const origFetch = globalThis.fetch
  try {
    let modernBody = null
    globalThis.fetch = async (url, opts) => {
      assert.ok(url.includes('/api/stripe-payment-methods?action=airport-checkout'))
      modernBody = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'cs_123', url: 'https://checkout.stripe.com/123' }),
      }
    }

    const session = await startAirportDeposit(null, {
      airport: 'GSP',
      date: '2026-10-10',
      time: '14:00',
    })
    assert.equal(session.id, 'cs_123')
    assert.equal(modernBody.airport, 'GSP')
    assert.equal(modernBody.date, '2026-10-10')
    assert.equal(modernBody.time, '14:00')
    assert.equal(modernBody.useCredits, true)
    assert.equal(modernBody.origin, NATIVE_CHECKOUT_ORIGIN)

    await startAirportDeposit(null, {
      airport: 'ATL',
      date: '2026-10-10',
      time: 'not-a-time',
    })
    assert.equal(modernBody.airport, 'GSP')
    assert.equal(modernBody.date, '2026-10-10')
    assert.equal(modernBody.time, '12:00')

    // BUG?: startAirportDeposit ignores params.time if params.date is omitted or invalid format
    await startAirportDeposit(null, {
      airport: 'GSP',
      time: '14:00',
    })
    assert.equal(modernBody.date, undefined)
    assert.equal(modernBody.time, undefined)

    let legacyBody = null
    globalThis.fetch = async (url, opts) => {
      if (url.includes('action=airport-checkout')) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ error: 'not_found' }),
        }
      }
      if (url.includes('/api/create-checkout-session')) {
        legacyBody = JSON.parse(opts.body)
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'cs_legacy', url: 'https://checkout.stripe.com/legacy' }),
        }
      }
      throw new Error(`Unexpected url: ${url}`)
    }

    const fakeSupabase = {
      auth: { getSession: async () => ({ data: { session: null } }) },
    }
    const legacySession = await startAirportDeposit(fakeSupabase, {
      airport: 'CLT',
      date: '2026-10-12',
      time: '16:00',
      riderId: 'rider-99',
      riderName: 'Tiger',
    })
    assert.equal(legacySession.legacy, true)
    assert.equal(legacySession.id, 'cs_legacy')
    assert.equal(legacyBody.airport, 'CLT')
    assert.equal(legacyBody.riderId, 'rider-99')
    assert.equal(legacyBody.riderName, 'Tiger')

    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: 'not_found' }),
    })
    await assert.rejects(
      () => startAirportDeposit(null, { airport: 'GSP', riderId: 'r1' }),
      /Supabase is not configured/,
    )

    await assert.rejects(
      () => startAirportDeposit(fakeSupabase, { airport: 'GSP' }),
      /Sign in required/,
    )

    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ message: 'Server crash' }),
    })
    await assert.rejects(
      () => startAirportDeposit(fakeSupabase, { airport: 'GSP', riderId: 'r1' }),
      /Server crash/,
    )
  } finally {
    globalThis.fetch = origFetch
  }
})

test('abandonAirportCheckout calls abandon-checkout API endpoint', async () => {
  await assert.rejects(
    () => abandonAirportCheckout(null, {}),
    /Missing trip/,
  )

  const origFetch = globalThis.fetch
  try {
    let calledUrl = null
    let calledBody = null
    globalThis.fetch = async (url, opts) => {
      calledUrl = url
      calledBody = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, released: true }),
      }
    }

    const res = await abandonAirportCheckout(null, { tripId: 'trip_abc', sessionId: 'sess_123' })
    assert.ok(calledUrl.includes('/api/stripe-payment-methods?action=abandon-checkout'))
    assert.equal(calledBody.tripId, 'trip_abc')
    assert.equal(calledBody.sessionId, 'sess_123')
    assert.equal(res.released, true)

    const omitted = await abandonAirportCheckout(null, { tripId: 'trip_abc', sessionId: '' })
    assert.equal(calledBody.tripId, 'trip_abc')
    assert.equal(Object.hasOwn(calledBody, 'sessionId'), false)
    assert.equal(omitted.released, true)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('depositSurfaceCopy covers receipt surface and error cases', () => {
  const balance = depositBalance({ fareCents: 10000, depositCents: 2500 })
  const receipt = depositSurfaceCopy(balance, 'receipt', { studentDiscountCents: 1000 })
  assert.equal(receipt, '25% deposit $25.00. Remaining balance $75.00. The 10% Standard student discount is already in that fare.')
  const receiptNoStudent = depositSurfaceCopy(balance, 'receipt')
  assert.equal(receiptNoStudent, '25% deposit $25.00. Remaining balance $75.00.')

  assert.throws(
    () => depositSurfaceCopy(balance, 'nonexistent_surface'),
    /Unknown deposit surface: nonexistent_surface/,
  )
})

test('recomputeDeposit and depositBalance handle zero and negative values', () => {
  assert.deepEqual(recomputeDeposit(), { fareCents: 0, cashCents: 0, depositCents: 0 })
  assert.deepEqual(recomputeDeposit({ fareCents: -50, cashCents: -20 }), { fareCents: 0, cashCents: 0, depositCents: 0 })
  assert.deepEqual(depositBalance(), { fareCents: 0, depositCents: 0, remainingCents: 0 })
  assert.deepEqual(depositBalance({ fareCents: 5000, depositCents: 0 }), { fareCents: 5000, depositCents: 0, remainingCents: 5000 })
})

test('exported constants match configuration specifications', () => {
  assert.equal(STUDENT_DISCOUNT_BPS, 1000)
  assert.equal(STUDENT_DISCOUNT_LABEL, 'Clemson student · 10% off Standard')
  assert.match(STUDENT_EMAIL_HINT, /@clemson\.edu/)
  assert.match(STUDENT_CLAIM_COPY, /10% off Standard/)
  assert.match(STUDENT_EMAIL_REQUIRED_COPY, /Clemson student email/)
  assert.match(STUDENT_CONFIRM_EMAIL_COPY, /Confirm the Clemson email/)
  assert.equal(NATIVE_CHECKOUT_ORIGIN, 'https://clemson-airport-rides.vercel.app')
  assert.equal(
    STRIPE_NOT_CONFIGURED_COPY,
    'Stripe checkout is not configured on this machine. No charge was made. Live mode stays off.',
  )
})

