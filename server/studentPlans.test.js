import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderPlanEmail } from './studentPlanEmail.js'
import { runNightlyQuotes, aiSummary } from './studentPlanQuotes.js'
import {
  assertClemsonStripeAccount, grantStudentPlanReferral, hashOtp, studentPlanMeta, subscriptionItems, syncStudentPlanFromStripe,
} from './studentPlans.js'
import { registrarProvider, manualProvider } from './registrarCheck.js'
import { memoryCreditStore } from './credits.js'
import { accountLooksLikeClemsonRides } from '../scripts/create-student-plan-prices.mjs'
import handler from './endpoints/studentPlans.js'

/** Tiny chainable Supabase fake keyed by table. */
function fakeSb(tables = {}) {
  const log = []
  function q(table) {
    const state = { table, filters: [], op: 'select', payload: null }
    const rows = () => (tables[table] || []).filter((r) => state.filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)))
    const api = {
      select() { return api },
      eq(k, v) { state.filters.push([k, v]); return api },
      in(k, v) { state.filters.push([k, v]); return api },
      is() { return api }, gte() { return api }, order() { return api }, limit() { return api },
      insert(p) { state.op = 'insert'; state.payload = p; log.push({ table, op: 'insert', p }); const exists = table === 'student_plan_referral_rewards' && (tables[table] || []).some((r) => r.referred_id === p.referred_id); if (!exists) (tables[table] ||= []).push(p); state.dup = exists; return api },
      update(p) { state.op = 'update'; state.payload = p; log.push({ table, op: 'update', p }); return api },
      upsert(p) { log.push({ table, op: 'upsert', p }); return api },
      maybeSingle() { return Promise.resolve(state.dup ? { error: { code: '23505', message: 'dup' } } : { data: state.op === 'insert' ? { id: 'q1', unsubscribe_token: 'abc' } : rows()[0] || null }) },
      then(res, rej) { return Promise.resolve(state.dup ? { error: { code: '23505', message: 'dup' } } : { data: state.op === 'select' ? rows() : null }).then(res, rej) },
    }
    return api
  }
  return { from: q, log }
}

const QUOTE = { planId: 'weekend_carpool', name: 'Weekend Carpool Plan', retailMonthlyCents: 21200, monthlyCents: 8900, semesterCents: 34900, savingsCents: 12300, expiresAt: '2026-10-28T00:00:00Z', priceLockMonths: 3 }

test('email template: dollar savings, unsubscribe link, business address, Clemson Rides name', () => {
  const e = renderPlanEmail({ firstName: 'Ty', metrics: { pattern: 'weekend_nightlife' }, quote: QUOTE, summary: 'Hi.', quoteId: 'q1', unsubscribeToken: 'abc123' })
  assert.match(e.text, /You would have spent \$212, your plan is \$89\./)
  assert.match(e.text, /101 North Main Street, Greenville, SC 29601/)
  assert.match(e.html, /101 North Main Street, Greenville, SC 29601/)
  assert.match(e.text, /op=unsubscribe&token=abc123/)
  assert.match(e.headers['List-Unsubscribe'], /unsubscribe/)
  assert.match(e.html, /Clemson Rides/)
  assert.doesNotMatch(e.html + e.text, /Crimson/i)
  assert.match(e.from, /^Clemson Rides <.+@.+>$/)
})

test('AI summary keeps rules-based numbers; falls back when the model changes them', async () => {
  const metrics = { projectedRidesPerMonth: 16, pattern: 'weekend_nightlife' }
  const bad = await aiSummary(metrics, QUOTE, { resolveLanguageModel: () => ({ model: {} }), generateText: async () => ({ text: 'Save $500 now!' }) })
  assert.match(bad, /\$89/)
  const none = await aiSummary(metrics, QUOTE, {})
  assert.match(none, /16 times a month/)
})

test('nightly job: dry run writes nothing; real run writes preview rows only', async () => {
  const trips = []
  for (let i = 0; i < 8; i++) {
    trips.push({ id: `t${i}`, rider_id: 'r1', status: 'completed', payment_status: 'paid', tier: 'carpool', fare_cents: 1200, surge_multiplier: 1,
      pickup_lat: 34.69, pickup_lng: -82.83, dropoff_lat: 34.68, dropoff_lng: -82.84, completed_at: new Date(Date.parse('2026-09-19T02:00:00Z') + i * 3.5 * 86400000).toISOString() })
  }
  const tables = {
    trips,
    profiles: [{ id: 'r1', email: 'tiger@clemson.edu', full_name: 'Tiger Paw', student_verified_at: '2026-09-01' }],
    plan_quotes: [], student_plan_email_optouts: [], student_plan_subscriptions: [],
  }
  const now = new Date('2026-10-14T21:00:00Z')
  const sb = fakeSb(tables)
  const dry = await runNightlyQuotes(sb, { now, env: {}, dryRun: true })
  assert.equal(dry.previews.length, 1)
  assert.equal(sb.log.filter((l) => l.op === 'insert').length, 0)
  const sb2 = fakeSb({ ...tables, plan_quotes: [] })
  const real = await runNightlyQuotes(sb2, { now, env: { STUDENT_PLAN_EMAILS_SEND: '1' }, dryRun: false })
  assert.equal(real.written, 1)
  assert.equal(real.sending, false)
  const ins = sb2.log.find((l) => l.op === 'insert' && l.table === 'plan_quotes')
  assert.equal(ins.p.email_status, 'preview')
})

test('nightly endpoint no-ops while the flag is off and requires the cron secret', async () => {
  const res = mockRes()
  await handler({ method: 'GET', url: '/x?op=nightly', headers: {} }, res, { env: {}, sb: fakeSb() , cronAuthorized: () => false })
  assert.equal(res.statusCode, 401)
  const res2 = mockRes()
  await handler({ method: 'GET', url: '/x?op=nightly', headers: {} }, res2, { env: {}, sb: fakeSb(), cronAuthorized: () => true })
  assert.equal(JSON.parse(res2.body).reason, 'feature_flag_off')
})

test('rider ops return enabled:false when the flag is off', async () => {
  const res = mockRes()
  await handler({ method: 'POST', body: { op: 'status' }, headers: {} }, res, { env: {}, sb: fakeSb(), user: { id: 'u', email: 'a@clemson.edu' }, stripe: null })
  assert.deepEqual(JSON.parse(res.body), { enabled: false })
})

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
    setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
    status(c) { this.statusCode = c; return this }, end(b) { this.body = b || ''; this.writableEnded = true },
    json(o) { this.body = JSON.stringify(o); return this },
  }
}

test('Stripe guard refuses a key from another account (ScreenshotSticky)', async () => {
  const stripe = { accounts: { retrieve: async () => ({ id: 'acct_screenshotsticky' }) } }
  await assert.rejects(assertClemsonStripeAccount(stripe, { STUDENT_PLANS_STRIPE_ACCOUNT_ID: 'acct_clemson' }), /not set up/)
  await assert.rejects(assertClemsonStripeAccount(stripe, {}), /not set up/)
  assert.equal(await assertClemsonStripeAccount({ accounts: { retrieve: async () => ({ id: 'acct_clemson' }) } }, { STUDENT_PLANS_STRIPE_ACCOUNT_ID: 'acct_clemson' }), 'acct_clemson')
})

test('price script only accepts the Clemson Rides account', () => {
  assert.equal(accountLooksLikeClemsonRides({ id: 'acct_1', business_profile: { name: 'ScreenshotSticky' } }, 'acct_1'), false)
  assert.equal(accountLooksLikeClemsonRides({ id: 'acct_1', business_profile: { name: 'Clemson Rides' } }, 'acct_2'), false)
  assert.equal(accountLooksLikeClemsonRides({ id: 'acct_1', business_profile: { name: 'Clemson Rides' } }, 'acct_1'), true)
})

test('subscription items read Price IDs from env and refuse when missing', () => {
  assert.throws(() => subscriptionItems({ planId: 'weekend_carpool', interval: 'month', env: {} }), /not configured/)
  assert.deepEqual(subscriptionItems({ planId: 'weekend_carpool', interval: 'semester', env: { STRIPE_PRICE_WEEKEND_CARPOOL_SEMESTER: 'price_s' } }), [{ price: 'price_s' }])
  const p = subscriptionItems({ planId: 'personalized', interval: 'month', priceCents: 6900, env: { STRIPE_PRODUCT_PERSONALIZED_PLAN: 'prod_p' } })
  assert.equal(p[0].price_data.unit_amount, 6900)
})

test('webhook sync: student plan metadata, invoice.paid grants referral credits to both once', async () => {
  assert.equal(studentPlanMeta({ metadata: { kind: 'tiger_pass' } }), null)
  const tables = { profiles: [{ id: 'kid', referred_by: 'ref' }], student_plan_subscriptions: [], student_plan_referral_rewards: [] }
  const sb = fakeSb(tables)
  const store = memoryCreditStore()
  const inv = { subscription: 'sub_1', amount_paid: 8900, parent: { subscription_details: { metadata: { kind: 'student_plan', rider_id: 'kid' } } } }
  const out = await syncStudentPlanFromStripe(sb, 'invoice.paid', inv, { env: {}, creditStore: store })
  assert.equal(out.referral.granted, true)
  assert.equal((await store.getCredits('ref')).balanceCents, 1000)
  assert.equal((await store.getCredits('kid')).balanceCents, 1000)
  const again = await grantStudentPlanReferral(sb, 'kid', { env: {}, creditStore: store })
  assert.equal(again.reason, 'already_granted')
  const trial = await syncStudentPlanFromStripe(fakeSb(tables), 'invoice.paid', { ...inv, amount_paid: 0 }, { env: {}, creditStore: store })
  assert.equal(trial.referral.reason, 'zero_invoice')
})

test('registrar check is pluggable and defaults to manual pending (no vendor)', async () => {
  assert.equal(registrarProvider({}).name, 'manual')
  assert.equal(registrarProvider({ REGISTRAR_PROVIDER: 'nsc' }).name, 'manual')
  assert.equal((await manualProvider.check()).status, 'pending')
})

test('OTP codes are stored hashed and bound to the rider', () => {
  assert.notEqual(hashOtp('a', '123456'), hashOtp('b', '123456'))
  assert.equal(hashOtp('a', '123456').length, 64)
})

test('migration is additive only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261014220000_student_plans.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /\b(drop\s+table|drop\s+column|alter\s+table\s+\S+\s+(drop|alter|rename))/i)
  for (const t of ['plan_quotes', 'student_enrollments', 'subscription_plans', 'student_plan_subscriptions', 'subscription_pauses']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`))
  }
})

test('rider app: badge color, Covered label, flag-gated Account row', () => {
  const acct = readFileSync(new URL('../apps/rider/app/(tabs)/account.tsx', import.meta.url), 'utf8')
  assert.match(acct, /withStudentPlans\(GROUPS, studentPlansOn\)/)
  assert.match(acct, /d\?\.enabled === true/)
  const screen = readFileSync(new URL('../apps/rider/app/student-plans.tsx', import.meta.url), 'utf8')
  assert.match(screen, /PLAN_BADGE_COLOR/)
  assert.match(screen, /COVERED_LABEL/)
})
