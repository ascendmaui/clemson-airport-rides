import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPromoToRideRequest,
  cleanDeviceId,
  createPromoCodes,
  isPromoAdmin,
  publicCampaigns,
  updatePromoCode,
} from './promoCodes.js'
import handlePromoAdmin from './endpoints/promoAdmin.js'
import handlePromoCodes from './endpoints/promoCodes.js'
import adminDesk from './endpoints/adminDesk.js'
import weeklyCoupon from './endpoints/weeklyCoupon.js'

const NOW = new Date('2026-10-15T16:00:00Z')
const JOHN = { id: 'u-john', email: 'johnmatveyev@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' }
const RIDER = { id: 'u-rider', email: 'rider@clemson.edu', email_confirmed_at: '2026-01-01T00:00:00Z' }

/** Minimal Supabase stand-in: records every call; tables answer from `tables`. */
function fakeSb({ tables = {}, rpc = {} } = {}) {
  const calls = { rpc: [], from: [] }
  const sb = {
    calls,
    rpc(name, args) {
      calls.rpc.push({ name, args })
      const handler = rpc[name]
      return Promise.resolve(handler ? handler(args) : { data: null, error: { message: `no fake for ${name}` } })
    },
    from(table) {
      const op = { table, filters: [], action: 'select', payload: null }
      calls.from.push(op)
      const answer = () => {
        const handler = tables[table]
        const out = typeof handler === 'function' ? handler(op) : handler
        return out || { data: op.action === 'select' ? [] : null, error: null }
      }
      const q = {
        select() { return q },
        insert(payload) { op.action = 'insert'; op.payload = payload; return q },
        update(payload) { op.action = 'update'; op.payload = payload; return q },
        eq(col, val) { op.filters.push(['eq', col, val]); return q },
        in(col, val) { op.filters.push(['in', col, val]); return q },
        lte(col, val) { op.filters.push(['lte', col, val]); return q },
        gt(col, val) { op.filters.push(['gt', col, val]); return q },
        order() { return q },
        limit() { return q },
        maybeSingle() { return Promise.resolve(answer()) },
        single() { return Promise.resolve(answer()) },
        then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject) },
      }
      return q
    },
  }
  return sb
}

function fakeRes() {
  const res = {
    statusCode: 200, headers: {}, body: '', writableEnded: false, headersSent: false,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v },
    end(chunk) { if (chunk != null) res.body += chunk; res.writableEnded = true },
  }
  return res
}
const parsed = (res) => JSON.parse(res.body || '{}')

test('only a confirmed johnmatveyev@gmail.com is the promo admin', () => {
  assert.equal(isPromoAdmin(JOHN), true)
  assert.equal(isPromoAdmin({ ...JOHN, email_confirmed_at: null }), false)
  assert.equal(isPromoAdmin(RIDER), false)
  assert.equal(isPromoAdmin({ ...RIDER, role: 'admin', is_admin: true }), false)
})

test('device ids are sanitized', () => {
  assert.equal(cleanDeviceId('dev-0123456789abcdef'), 'dev-0123456789abcdef')
  assert.equal(cleanDeviceId('short'), null)
  assert.equal(cleanDeviceId("x'; drop table--"), null)
})

test('admin endpoints: 401 signed out, 403 for anyone but John, including staff', async () => {
  for (const [user, status] of [[null, 401], [RIDER, 403], [{ ...RIDER, role: 'admin' }, 403]]) {
    for (const action of ['promo-codes', 'promo-export']) {
      const res = fakeRes()
      await handlePromoAdmin({ method: 'GET', query: { action } }, res, action, { sb: fakeSb(), user })
      assert.equal(res.statusCode, status, `${action} ${user?.email}`)
    }
    const res = fakeRes()
    const sb = fakeSb()
    await handlePromoAdmin({ method: 'POST', body: { side: 'rider' } }, res, 'promo-create', { sb, user, env: {} })
    assert.equal(res.statusCode, status)
    assert.equal(sb.calls.from.length, 0, 'nothing touched before the admin check')
  }
})

test('admin desk routes promo actions to the owner-only handler', async () => {
  const res = fakeRes()
  await adminDesk({ method: 'GET', query: { action: 'promo-codes' }, headers: {} }, res, { sb: fakeSb(), user: RIDER })
  assert.equal(res.statusCode, 403)
  assert.equal(parsed(res).error, 'promo_admin_only')
})

const CODE_ROW = {
  id: 'c1', code: 'FALL20', side: 'rider', discount_type: 'percent', percent_off_bps: 2000, amount_off_cents: 0,
  max_discount_cents: 1500, min_trip_cents: 0, starts_at: '2026-10-01T00:00:00Z', expires_at: '2026-11-01T00:00:00Z',
  max_redemptions: 100, per_account_limit: 1, active: true, public_listing: true, campaign: 'fall',
}

test('John can list and export CSV; export is audited', async () => {
  const sb = fakeSb({
    tables: {
      promo_campaign_codes: { data: [CODE_ROW], error: null },
      promo_code_redemptions: { data: [{ code_id: 'c1', status: 'redeemed', discount_cents: 300 }], error: null },
      promo_code_admin_events: { data: null, error: null },
    },
  })
  const list = fakeRes()
  await handlePromoAdmin({ method: 'GET', query: { action: 'promo-codes' } }, list, 'promo-codes', { sb, user: JOHN })
  assert.equal(list.statusCode, 200)
  assert.equal(parsed(list).codes[0].counts.redeemed, 1)

  const csv = fakeRes()
  await handlePromoAdmin({ method: 'GET', query: { action: 'promo-export' } }, csv, 'promo-export', { sb, user: JOHN })
  assert.equal(csv.statusCode, 200)
  assert.match(csv.headers['content-type'], /text\/csv/)
  assert.match(csv.body, /^code,side,campaign/)
  assert.match(csv.body, /FALL20,rider,fall,20% off \(up to \$15\)/)
  const audit = sb.calls.from.find((op) => op.table === 'promo_code_admin_events' && op.action === 'insert')
  assert.equal(audit.payload.action, 'exported')
})

test('create validates, inserts one batch, and records who made it', async () => {
  let inserted = null
  const sb = fakeSb({
    tables: {
      promo_campaign_codes: (op) => {
        if (op.action === 'insert') { inserted = op.payload; return { data: op.payload, error: null } }
        return null
      },
    },
  })
  const bad = await createPromoCodes(sb, { actor: JOHN, input: { side: 'rider', discountType: 'percent', percentOff: 80 }, now: NOW })
  assert.equal(bad.ok, false)
  assert.equal(inserted, null)
  const out = await createPromoCodes(sb, {
    actor: JOHN,
    input: { side: 'rider', discountType: 'flat', amountOffCents: 500, prefix: 'FALL', count: 3, maxRedemptions: 1, expiresAt: '2026-11-15T00:00:00Z' },
    now: NOW,
  })
  assert.equal(out.ok, true)
  assert.equal(inserted.length, 3)
  assert.ok(inserted.every((r) => r.created_by_email === JOHN.email && r.batch_id === out.batchId && r.code.startsWith('FALL')))
})

test('a duplicate code is a 409, not a crash', async () => {
  const sb = fakeSb({ tables: { promo_campaign_codes: { data: null, error: { code: '23505', message: 'duplicate key' } } } })
  const out = await createPromoCodes(sb, {
    actor: JOHN, input: { code: 'FALL20', side: 'rider', discountType: 'flat', amountOffCents: 500, maxRedemptions: 5, expiresAt: '2026-11-15T00:00:00Z' }, now: NOW,
  })
  assert.equal(out.status, 409)
})

test('discount terms are frozen after issue', async () => {
  const sb = fakeSb({ tables: { promo_campaign_codes: { data: CODE_ROW, error: null } } })
  const frozen = await updatePromoCode(sb, { actor: JOHN, id: 'c1', patch: { percentOffBps: 5000 }, now: NOW })
  assert.equal(frozen.ok, false)
  assert.match(frozen.error, /cannot change/)
  const off = await updatePromoCode(sb, { actor: JOHN, id: 'c1', patch: { active: false }, now: NOW })
  assert.equal(off.ok, true)
  const update = sb.calls.from.find((op) => op.action === 'update')
  assert.equal(update.payload.active, false)
})

test('public campaign feed is opt-in, live rider codes only, and leaks no internals', async () => {
  const sb = fakeSb({ tables: { promo_campaign_codes: { data: [{ ...CODE_ROW, notes: 'secret', budget_cents: 100 }], error: null } } })
  const rows = await publicCampaigns(sb, { now: NOW })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].code, 'FALL20')
  assert.equal('notes' in rows[0], false)
  const filters = sb.calls.from[0].filters.map((f) => f.slice(0, 2).join(':'))
  for (const want of ['eq:public_listing', 'eq:active', 'eq:side', 'lte:starts_at', 'gt:expires_at']) assert.ok(filters.includes(want), want)

  const res = fakeRes()
  await weeklyCoupon({ method: 'GET', query: { action: 'promo-campaigns' }, headers: {} }, res, { sb })
  assert.equal(res.statusCode, 200)
  assert.equal(parsed(res).campaigns[0].code, 'FALL20')
})

test('check and claim need a signed-in user and pass the device id through', async () => {
  const signedOut = fakeRes()
  await handlePromoCodes({ method: 'POST', body: { code: 'FALL20' } }, signedOut, 'promo-claim', { sb: fakeSb(), user: null })
  assert.equal(signedOut.statusCode, 401)

  const sb = fakeSb({ rpc: { promo_claim_code: () => ({ data: { ok: true, code: 'FALL20' }, error: null }) } })
  const res = fakeRes()
  await handlePromoCodes({ method: 'POST', body: { code: 'fall20', side: 'driver', deviceId: 'dev-0123456789abcdef' } }, res, 'promo-claim', { sb, user: RIDER })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(sb.calls.rpc[0], {
    name: 'promo_claim_code',
    args: { p_profile: RIDER.id, p_code: 'FALL20', p_side: 'driver', p_device_id: 'dev-0123456789abcdef' },
  })
  const badSide = fakeRes()
  await handlePromoCodes({ method: 'POST', body: { code: 'FALL20', side: 'admin' } }, badSide, 'promo-check', { sb, user: RIDER })
  assert.equal(badSide.statusCode, 400)
})

const RECURRING = { fareCents: 1800, depositCents: 0 }
const LIST = { fareCents: 2000, depositCents: 0 }

function bookingSb({ check, reserve }) {
  return fakeSb({
    tables: { profiles: { data: { stripe_default_pm_id: 'pm_1' }, error: null } },
    rpc: {
      promo_check_code: (args) => ({ data: check(args), error: null }),
      promo_reserve_for_trip: (args) => ({ data: reserve(args), error: null }),
    },
  })
}

test('booking: a winning code reserves on the list fare with device and card, priced at list', async () => {
  const sb = bookingSb({
    check: () => ({ ok: true, code: 'FALL20', discount_cents: 400 }),
    reserve: (args) => ({
      ok: true, redemption_id: 'r1', code: 'FALL20', code_id: 'c1', discount_type: 'percent',
      percent_off_bps: 2000, max_discount_cents: 1500, min_trip_cents: 0, discount_cents: 400, trip: args.p_trip_id,
    }),
  })
  const stripe = { paymentMethods: { retrieve: async () => ({ card: { fingerprint: 'fp_abc' } }) } }
  const out = await applyPromoToRideRequest({
    sb, stripe, userId: RIDER.id, code: 'fall20', deviceId: 'dev-0123456789abcdef', recurring: RECURRING, list: LIST, now: NOW,
  })
  assert.equal(out.priced, LIST, 'fare_cents stays the pre-discount list fare (driver pay basis)')
  assert.equal(out.snapshot.redemption_id, 'r1')
  assert.equal(out.promo.applied, true)
  assert.equal(out.promo.riderPaysCents, 1600)
  const reserve = sb.calls.rpc.find((c) => c.name === 'promo_reserve_for_trip')
  assert.equal(reserve.args.p_trip_id, out.tripId)
  assert.equal(reserve.args.p_fare_cents, 2000)
  assert.equal(reserve.args.p_device_id, 'dev-0123456789abcdef')
  assert.equal(reserve.args.p_card_fingerprint, 'fp_abc')
})

test('booking: no stacking. When student / Tiger Pass is cheaper, the code is not reserved', async () => {
  const sb = bookingSb({ check: () => ({ ok: true, code: 'SMALL1', discount_cents: 100 }), reserve: () => assert.fail('must not reserve') })
  const out = await applyPromoToRideRequest({ sb, userId: RIDER.id, code: 'SMALL1', recurring: RECURRING, list: LIST, now: NOW })
  assert.equal(out.priced, RECURRING)
  assert.equal(out.snapshot, null)
  assert.equal(out.promo.applied, false)
  assert.equal(out.promo.reason, 'better_discount_applied')
})

test('booking: a refused code books at the normal price with the reason', async () => {
  const sb = bookingSb({ check: () => ({ ok: false, reason: 'expired' }), reserve: () => assert.fail('must not reserve') })
  const out = await applyPromoToRideRequest({ sb, userId: RIDER.id, code: 'OLD1', recurring: RECURRING, list: LIST, now: NOW })
  assert.equal(out.priced, RECURRING)
  assert.equal(out.promo.reason, 'expired')
  assert.equal(out.promo.message, 'That code has expired.')
})

test('booking: a lost race at reserve time books at the normal price', async () => {
  const sb = bookingSb({
    check: () => ({ ok: true, code: 'LAST1', discount_cents: 500 }),
    reserve: () => ({ ok: false, reason: 'max_redemptions' }),
  })
  const out = await applyPromoToRideRequest({ sb, userId: RIDER.id, code: 'LAST1', recurring: RECURRING, list: LIST, now: NOW })
  assert.equal(out.priced, RECURRING)
  assert.equal(out.snapshot, null)
  assert.equal(out.promo.reason, 'max_redemptions')
})

test('booking: a database error never blocks the ride', async () => {
  const sb = fakeSb({ rpc: { promo_check_code: () => { throw new Error('boom') } } })
  const out = await applyPromoToRideRequest({ sb, userId: RIDER.id, code: 'FALL20', recurring: RECURRING, list: LIST, now: NOW })
  assert.equal(out.priced, RECURRING)
  assert.equal(out.promo.reason, 'promo_unavailable')
})

test('booking with no code and no saved signup code changes nothing', async () => {
  const sb = fakeSb({ tables: { promo_code_redemptions: { data: [], error: null } } })
  const out = await applyPromoToRideRequest({ sb, userId: RIDER.id, recurring: RECURRING, list: LIST, now: NOW })
  assert.equal(out.priced, RECURRING)
  assert.equal(out.promo, null)
  assert.equal(sb.calls.rpc.length, 0)
})
