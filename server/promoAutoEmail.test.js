import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { promoAutoEmail, PROMO_EMAIL_BRAND } from '../shared/promoEmail.js'
import { promoEmailBackoffMs, promoEmailsEnabled, runPromoEmailOutbox } from './promoEmailOutbox.js'
import handlePromoAdmin from './endpoints/promoAdmin.js'
import { autoSettingsPatch } from './promoCodes.js'

const NOW = new Date('2026-10-15T16:00:00Z')
const JOHN = { id: 'u-john', email: 'johnmatveyev@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' }
const RIDER = { id: 'u-rider', email: 'rider@clemson.edu', email_confirmed_at: '2026-01-01T00:00:00Z' }
const ENV_ON = { PROMO_CODE_EMAILS_ENABLED: '1', RESEND_API_KEY: 're_test_fake', RESEND_FROM: 'Clemson Rides <rides@example.com>' }

test('email: branded, code, expiry, terms, transactional footer with the address', () => {
  const msg = promoAutoEmail({ kind: 'auto_card', code: 'CARD7K2M9QXP', expiresAt: '2027-01-13T16:00:00Z' })
  assert.equal(msg.subject, '50% off your next ride | Clemson Rides')
  for (const body of [msg.text, msg.html]) {
    assert.match(body, /50% off your next ride\./)
    assert.match(body, /CARD7K2M9QXP/)
    assert.match(body, /January 13, 2027/)
    assert.match(body, /Single use/)
    assert.match(body, /does not combine with student or Tiger Pass pricing/)
    assert.match(body, /101 North Main Street, Greenville, SC 29601/)
    assert.match(body, /transactional message/)
    assert.doesNotMatch(body, /airport/i)
  }
  assert.match(msg.html, new RegExp(PROMO_EMAIL_BRAND.orange))
  assert.match(msg.html, new RegExp(PROMO_EMAIL_BRAND.purple))
  assert.equal(PROMO_EMAIL_BRAND.orange, '#F56600')
  assert.equal(PROMO_EMAIL_BRAND.purple, '#522D80')
  assert.match(promoAutoEmail({ kind: 'auto_signup', code: 'HIABCDEFGH', expiresAt: NOW }).text, /^Welcome to Clemson Rides/)
  assert.match(promoAutoEmail({ kind: 'auto_credit50', code: 'FIFTYABCDEFGH', expiresAt: NOW }).text, /reached \$50/)
  assert.match(promoAutoEmail({ kind: 'auto_card', code: 'X1234567', expiresAt: NOW, maxDiscountCents: 2500 }).text, /up to \$25 off/)
  assert.match(promoAutoEmail({ kind: 'auto_card', code: '<b>x</b>', expiresAt: NOW }).html, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.equal(promoAutoEmail({ kind: 'nope', code: 'X' }), null)
})

/** Outbox fake: rows, codes and auth users in memory; records updates. */
function outboxSb({ rows, codes, users }) {
  const updates = []
  return {
    updates,
    calls: [],
    rpc(name, args) {
      this.calls.push(name)
      assert.equal(name, 'promo_claim_email_batch')
      return Promise.resolve({ data: rows.slice(0, args.p_limit), error: null })
    },
    from(table) {
      const op = { table, filters: {}, patch: null }
      const q = {
        select() { return q },
        update(patch) { op.patch = patch; return q },
        eq(col, val) {
          op.filters[col] = val
          if (op.patch) { updates.push({ id: val, ...op.patch }); return Promise.resolve({ error: null }) }
          return q
        },
        maybeSingle() { return Promise.resolve({ data: codes[op.filters.id] || null, error: null }) },
      }
      return q
    },
    auth: { admin: { getUserById: async (id) => ({ data: { user: users[id] || null }, error: null }) } },
  }
}

const LIVE = (id, owner, extra = {}) => ({
  id, code: `CODE${id.toUpperCase()}`, active: true, expires_at: '2027-01-01T00:00:00Z',
  percent_off_bps: 5000, max_discount_cents: null, owner_profile_id: owner, ...extra,
})

test('outbox: off by default and never touches the database or the network', async () => {
  assert.equal(promoEmailsEnabled({}), false)
  const sb = outboxSb({ rows: [], codes: {}, users: {} })
  let fetched = 0
  const out = await runPromoEmailOutbox({ sb, env: {}, now: NOW, fetchImpl: () => { fetched += 1 } })
  assert.deepEqual(out, { ok: true, skipped: true, reason: 'flag_off' })
  assert.equal(sb.calls.length, 0)
  assert.equal(fetched, 0)
  // Even with the flag on, a test run without an injected fetch cannot send.
  assert.equal((await runPromoEmailOutbox({ sb, env: ENV_ON, now: NOW })).reason, 'test_env')
  assert.equal((await runPromoEmailOutbox({ sb, env: { PROMO_CODE_EMAILS_ENABLED: '1' }, now: NOW, fetchImpl: () => {} })).reason, 'resend_not_configured')
  assert.equal(sb.calls.length, 0)
})

test('outbox: sends once with an idempotency key, waits for unconfirmed emails, retries failures', async () => {
  const rows = [
    { id: 'o1', code_id: 'c1', profile_id: 'p1', kind: 'auto_signup', attempts: 1 },
    { id: 'o2', code_id: 'c2', profile_id: 'p2', kind: 'auto_card', attempts: 1 },
    { id: 'o3', code_id: 'c3', profile_id: 'p3', kind: 'auto_card', attempts: 1 },
    { id: 'o4', code_id: 'c4', profile_id: 'p4', kind: 'auto_credit50', attempts: 2 },
    { id: 'o5', code_id: 'c5', profile_id: 'p5', kind: 'auto_card', attempts: 8 },
  ]
  const codes = {
    c1: LIVE('c1', 'p1'), c2: LIVE('c2', 'p2'), c3: LIVE('c3', 'p3', { expires_at: '2026-01-01T00:00:00Z' }),
    c4: LIVE('c4', 'p4'), c5: LIVE('c5', 'p5'),
  }
  const users = {
    p1: { email: 'one@clemson.edu', email_confirmed_at: '2026-01-01' },
    p2: { email: 'two@clemson.edu', email_confirmed_at: null },
    p3: { email: 'three@clemson.edu', email_confirmed_at: '2026-01-01' },
    p4: { email: 'four@clemson.edu', email_confirmed_at: '2026-01-01' },
    p5: { email: 'five@clemson.edu', email_confirmed_at: '2026-01-01' },
  }
  const sb = outboxSb({ rows, codes, users })
  const posts = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    posts.push({ url, headers: init.headers, body })
    if (body.to[0].startsWith('four') || body.to[0].startsWith('five')) return { ok: false, status: 500, json: async () => ({ message: 'server error' }) }
    return { ok: true, status: 200, json: async () => ({ id: 'email_123' }) }
  }
  const out = await runPromoEmailOutbox({ sb, env: ENV_ON, now: NOW, fetchImpl })
  assert.deepEqual(out, { ok: true, leased: 5, sent: 1, retry: 1, failed: 1, skipped: 1, waiting: 1 })
  assert.equal(posts.length, 3)
  const first = posts[0]
  assert.equal(first.url, 'https://api.resend.com/emails')
  assert.equal(first.headers['Idempotency-Key'], 'promo-email-o1')
  assert.equal(first.body.from, ENV_ON.RESEND_FROM)
  assert.deepEqual(first.body.to, ['one@clemson.edu'])
  assert.match(first.body.html, /CODEC1/)
  const byId = Object.fromEntries(sb.updates.map((u) => [u.id, u]))
  assert.equal(byId.o1.status, 'sent')
  assert.equal(byId.o1.provider_message_id, 'email_123')
  assert.equal(byId.o2.status, 'pending')
  assert.equal(byId.o2.last_error, 'email_unconfirmed')
  assert.equal(byId.o3.status, 'skipped')
  assert.equal(byId.o4.status, 'pending')
  assert.equal(byId.o4.next_attempt_at, new Date(NOW.getTime() + promoEmailBackoffMs(2)).toISOString())
  assert.equal(byId.o5.status, 'failed')
  assert.doesNotMatch(JSON.stringify(sb.updates), /re_test_fake/, 'the API key is never stored')
})

test('backoff grows and is capped', () => {
  assert.equal(promoEmailBackoffMs(1), 5 * 60 * 1000)
  assert.equal(promoEmailBackoffMs(2), 10 * 60 * 1000)
  assert.equal(promoEmailBackoffMs(20), 12 * 60 * 60 * 1000)
})

test('the minute tick drains the outbox after dispatch (see staleTripSweep.test.js for the live run)', () => {
  const tick = readFileSync(new URL('./endpoints/scheduledDispatchTick.js', import.meta.url), 'utf8')
  assert.match(tick, /\(deps\.runPromoEmails \|\| runPromoEmailOutbox\)\(\{ sb, env, now, dryRun, fetchImpl: deps\.fetchImpl \}\)/)
})

test('auto settings: John only; cap is optional and empty means no cap', async () => {
  const res = { statusCode: 200, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
  await handlePromoAdmin({ method: 'POST', body: { maxDiscountCents: 2500 } }, res, 'promo-auto-settings-update', { sb: { from() { throw new Error('no db') } }, user: RIDER, env: {} })
  assert.equal(res.statusCode, 403)
  assert.deepEqual(autoSettingsPatch({ maxDiscountCents: null }), { ok: true, patch: { max_discount_cents: null } })
  assert.deepEqual(autoSettingsPatch({ maxDiscountCents: 2500, expiresDays: 60 }), { ok: true, patch: { max_discount_cents: 2500, expires_days: 60 } })
  assert.equal(autoSettingsPatch({ percentOff: 80 }).ok, false)
  assert.equal(autoSettingsPatch({ expiresDays: 400 }).ok, false)
  assert.equal(autoSettingsPatch({}).ok, false)
  void JOHN
})

test('no double 50%: request-driver never prices the standing first-ride offer, so one promo per ride holds', () => {
  const request = readFileSync(new URL('./endpoints/requestDriverTrip.js', import.meta.url), 'utf8')
  // If the standing 50% first-ride offer is ever wired into pricing, it must go
  // through choosePromoOrRecurring (one promo per ride) first. This test will
  // fail and force that review.
  assert.doesNotMatch(request, /standingPromos|selectRideDiscount|FIRST_RIDE_DISCOUNT/)
  assert.match(request, /applyPromoToRideRequest/)
})
