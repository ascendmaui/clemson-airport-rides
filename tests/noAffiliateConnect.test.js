// Affiliate Connect (test mode) and Option C commissions.
// Lives under tests/no*.test.js so the existing test script picks it up.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  connectLinkUrls, connectOnboardingStatus, describeAffiliatePlan, formatMultiplier,
  isAffiliateTestKey, isAllowedAppOrigin, maskReferralName, payoutHistory, referralStatusLabel,
  riderFareQualifies,
} from '../shared/affiliates/rules.js'
import { AFFILIATE_RATES_DEFAULTS } from '../shared/affiliates/config.js'

const programSql = readFileSync(new URL('../supabase/migrations/20261012200000_affiliate_program.sql', import.meta.url), 'utf8')
const connectSql = readFileSync(new URL('../supabase/migrations/20261012230000_affiliate_connect.sql', import.meta.url), 'utf8')
const optionSql = readFileSync(new URL('../supabase/migrations/20261012231000_affiliate_option_c.sql', import.meta.url), 'utf8')

test('affiliate migrations are additive and use unique versions', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
  const versions = names.map((name) => name.slice(0, 14))
  for (const version of ['20261012200000', '20261012230000', '20261012231000']) {
    assert.equal(versions.filter((item) => item === version).length, 1, version)
  }
  for (const sql of [programSql, connectSql, optionSql]) {
    assert.doesNotMatch(sql, /drop table/i)
    assert.doesNotMatch(sql, /delete from/i)
    assert.doesNotMatch(sql, /truncate/i)
  }
})

test('outreach URL /affiliate and /affiliates both open the partner page', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('../src/screens/Affiliates.jsx', import.meta.url), 'utf8')
  assert.match(app, /case 'affiliate':\s*case 'affiliates':\s*return <AffiliatesScreen \/>/)
  assert.match(app, /'affiliate'/)
  assert.match(screen, /here === 'affiliate' \? 'affiliate' : 'affiliates'/)
})
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

function memorySb(tables) {
  function run(table, action, payload, filters, single) {
    const rows = tables[table] || (tables[table] = [])
    const match = (row) => filters.every((f) => {
      if (f.op === 'eq') return row[f.k] === f.v
      if (f.op === 'in') return f.v.includes(row[f.k])
      if (f.op === 'is') return f.v == null ? row[f.k] == null : row[f.k] === f.v
      return true
    })
    if (action === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ ...row }))
      if (table === 'affiliate_payout_events') {
        const dup = list.find((row) => rows.some((existing) => existing.stripe_event_id && existing.stripe_event_id === row.stripe_event_id))
        if (dup) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
      }
      rows.push(...list)
      return { data: single ? list[0] : list, error: null }
    }
    const found = rows.filter(match)
    if (action === 'update') {
      for (const row of found) Object.assign(row, payload)
    }
    return { data: single ? (found[0] || null) : found, error: null }
  }
  return {
    from(table) {
      const filters = []
      let action = 'select'
      let payload = null
      const api = {
        select() { return api },
        insert(row) { action = 'insert'; payload = row; return api },
        update(row) { action = 'update'; payload = row; return api },
        eq(k, v) { filters.push({ op: 'eq', k, v }); return api },
        in(k, v) { filters.push({ op: 'in', k, v }); return api },
        is(k, v) { filters.push({ op: 'is', k, v }); return api },
        order() { return api },
        limit() { return api },
        gte() { return api },
        maybeSingle() { return Promise.resolve(run(table, action, payload, filters, true)) },
        single() { return Promise.resolve(run(table, action, payload, filters, true)) },
        then(resolve, reject) { return Promise.resolve(run(table, action, payload, filters, false)).then(resolve, reject) },
      }
      return api
    },
  }
}

function response() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v },
    end(b) { this.body = b ?? ''; this.json = this.body ? JSON.parse(this.body) : {} },
  }
}

test('option C plan is config, with bonuses labeled for John', () => {
  const plan = describeAffiliatePlan()
  assert.equal(plan.plan, 'option_c')
  assert.equal(plan.rider_first_ride_cents, 400)
  assert.equal(plan.rider_min_fare_cents, 1500)
  assert.equal(plan.driver_first_trip_cents, 2000)
  assert.equal(plan.multipliers_pending_confirmation, true)
  assert.match(plan.multipliers_note, /John to confirm/)
  assert.equal(formatMultiplier(12500), '1.25×')
  assert.equal(formatMultiplier(15000), '1.5×')
  const campus = plan.partners.find((row) => row.type === 'campus_org')
  const business = plan.partners.find((row) => row.type === 'local_business')
  const creator = plan.partners.find((row) => row.type === 'influencer')
  const student = plan.partners.find((row) => row.type === 'student')
  assert.equal(campus.rider_cents, 500)
  assert.equal(business.driver_cents, 2500)
  assert.equal(creator.rider_cents, 600)
  assert.equal(creator.driver_cents, 3000)
  assert.equal(student.bonus, false)
  assert.equal(riderFareQualifies(1499), false)
  assert.equal(riderFareQualifies(1500), true)
  assert.equal(riderFareQualifies(null), false)
  assert.equal(maskReferralName('Jordan Smith', 'j@x.com'), 'J. S.')
  assert.equal(maskReferralName('', 'alex@clemson.edu'), 'A•••')
  assert.equal(referralStatusLabel({ status: 'qualified', role: 'driver' }), 'First trip')
  assert.equal(referralStatusLabel({ status: 'qualified', role: 'rider' }), 'First ride')
  assert.equal(referralStatusLabel({ status: 'rejected', role: 'rider' }), "Didn't qualify")
  assert.deepEqual(payoutHistory(
    [{ id: 'e1', event_type: 'transfer.created', amount_cents: 400, status: 'created', created_at: '2026-10-02T00:00:00Z', stripe_object_id: 'tr_1' }],
    [{ id: 'l1', status: 'paid', amount_cents: 400, payout_ref: 'tr_1', payout_method: 'stripe_connect', paid_at: '2026-10-02T00:00:00Z' },
      { id: 'l2', status: 'paid', amount_cents: 2000, payout_method: 'ride_credit', payout_ref: 'credit:l2', paid_at: '2026-10-03T00:00:00Z' }],
  ).map((row) => row.id), ['l2', 'e1'])
  const ui = readFileSync(new URL('../src/screens/Affiliates.jsx', import.meta.url), 'utf8')
  assert.match(ui, /AffiliatePlan/)
  assert.doesNotMatch(ui, /\$4\b/)
  assert.doesNotMatch(ui, /\$20\b/)
  assert.match(optionSql, /rider_min_fare_cents/)
  assert.doesNotMatch(optionSql, /drop table/i)
  assert.doesNotMatch(connectSql, /drop table/i)
  assert.equal(AFFILIATE_RATES_DEFAULTS.partner_type_bps.student, 10000)
})

test('connect status, test-mode key, and account link urls', () => {
  assert.equal(connectOnboardingStatus(null), 'not_started')
  assert.equal(connectOnboardingStatus({ id: 'acct_1', details_submitted: false, payouts_enabled: false }), 'pending')
  assert.equal(connectOnboardingStatus({
    id: 'acct_1', details_submitted: true, payouts_enabled: false,
    requirements: { disabled_reason: 'requirements.pending_verification' },
  }), 'pending')
  assert.equal(connectOnboardingStatus({
    id: 'acct_1', details_submitted: true, payouts_enabled: true, capabilities: { transfers: 'active' },
  }), 'verified')
  assert.equal(connectOnboardingStatus({
    id: 'acct_1', details_submitted: true, payouts_enabled: false,
    requirements: { disabled_reason: 'requirements.past_due' },
  }), 'restricted')
  assert.equal(connectOnboardingStatus({ id: 'acct_1', payouts_enabled: true, capabilities: { transfers: 'inactive' } }), 'restricted')
  assert.equal(isAffiliateTestKey('sk_test_crimson'), true)
  assert.equal(isAffiliateTestKey('sk_live_crimson'), false)
  assert.equal(isAffiliateTestKey('sk_test_screenshotsticky_key'), false)
  assert.equal(isAllowedAppOrigin('https://clemsonrides.com'), true)
  assert.equal(isAllowedAppOrigin('http://localhost:5173'), true)
  assert.equal(isAllowedAppOrigin('https://evil.example'), false)
  const urls = connectLinkUrls('https://clemsonrides.com/')
  assert.equal(urls.return_url, 'https://clemsonrides.com/affiliates?connect=return')
  assert.equal(urls.refresh_url, 'https://clemsonrides.com/affiliates?connect=refresh')
})

async function optionDb() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create type public.trip_status as enum ('searching','accepted','in_progress','completed','canceled');
    create table public.profiles (id uuid primary key, email text, phone text, full_name text);
    create table public.trips (
      id uuid primary key default gen_random_uuid(), rider_id uuid, driver_id uuid,
      status public.trip_status, fare_cents integer, metadata jsonb default '{}'
    );
  `)
  for (let i = 1; i <= 16; i++) {
    await db.query('insert into auth.users (id) values ($1)', [U(i)])
    await db.query('insert into profiles (id, email, phone, full_name) values ($1, $2, $3, $4)', [U(i), `u${i}@x.com`, null, `Rider ${i}`])
  }
  await db.exec(programSql)
  await db.exec(connectSql)
  await db.exec(optionSql)
  await db.exec(`insert into affiliates (id, user_id, code, partner_type, display_name, contact_email, phone, status)
    values ('${U(100)}', '${U(1)}', 'TIGER1', 'student', 'Tiger', 't@x.com', '864-555-0100', 'active')`)
  return db
}

test('option C qualify: $15 rider fare, $4 / $20, and partner multipliers', async (t) => {
  const db = await optionDb(); t.after(() => db.close())
  const rates = (await db.query(`select value from affiliate_config where key = 'rates'`)).rows[0].value
  assert.equal(rates.plan, 'option_c')
  assert.equal(rates.rider_first_ride_cents, 400)
  assert.equal(rates.rider_min_fare_cents, 1500)
  assert.equal(rates.driver_first_trip_cents, 2000)
  assert.equal(rates.partner_type_bps.influencer, 15000)
  assert.equal(rates.multipliers_pending_confirmation, true)

  await db.query(`insert into affiliate_attributions (affiliate_id, referred_user_id, role) values ($1, $2, 'rider')`, [U(100), U(2)])
  await db.query(`insert into trips (rider_id, driver_id, status, fare_cents) values ($1, $2, 'in_progress', 1000)`, [U(2), U(5)])
  await db.query(`update trips set status = 'completed' where rider_id = $1`, [U(2)])
  assert.equal((await db.query(`select reject_reason from affiliate_attributions where referred_user_id = $1`, [U(2)])).rows[0].reject_reason, 'fare_below_minimum')

  await db.query(`insert into affiliate_attributions (affiliate_id, referred_user_id, role) values ($1, $2, 'rider')`, [U(100), U(3)])
  await db.query(`insert into trips (rider_id, driver_id, status, fare_cents) values ($1, $2, 'in_progress', null)`, [U(3), U(6)])
  await db.query(`update trips set status = 'completed' where rider_id = $1`, [U(3)])
  assert.equal((await db.query(`select status from affiliate_attributions where referred_user_id = $1`, [U(3)])).rows[0].status, 'signed_up')
  await db.query(`update trips set fare_cents = 1600 where rider_id = $1`, [U(3)])
  assert.equal((await db.query(`select status from affiliate_attributions where referred_user_id = $1`, [U(3)])).rows[0].status, 'qualified')

  await db.query(`insert into affiliate_attributions (affiliate_id, referred_user_id, role) values ($1, $2, 'driver')`, [U(100), U(4)])
  await db.query(`insert into trips (rider_id, driver_id, status, fare_cents) values ($1, $2, 'in_progress', 500)`, [U(7), U(4)])
  await db.query(`update trips set status = 'completed' where driver_id = $1`, [U(4)])
  assert.equal((await db.query(`select status from affiliate_attributions where referred_user_id = $1 and role = 'driver'`, [U(4)])).rows[0].status, 'qualified')

  const paid = (await db.query(`select kind, amount_cents from affiliate_ledger order by kind`)).rows
  assert.deepEqual(paid, [
    { kind: 'referral_driver', amount_cents: 2000 },
    { kind: 'referral_rider', amount_cents: 400 },
  ])

  await db.query(`insert into affiliates (id, user_id, code, partner_type, display_name, contact_email, status)
    values ($1, $2, 'ORG01', 'campus_org', 'Org', 'o@x.com', 'active')`, [U(101), U(8)])
  await db.query(`insert into affiliate_attributions (affiliate_id, referred_user_id, role, masked_name) values ($1, $2, 'rider', 'A. B.')`, [U(101), U(9)])
  await db.query(`insert into trips (rider_id, driver_id, status, fare_cents) values ($1, $2, 'in_progress', 2000)`, [U(9), U(10)])
  await db.query(`update trips set status = 'completed' where rider_id = $1`, [U(9)])
  assert.equal((await db.query(`select amount_cents from affiliate_ledger where affiliate_id = $1`, [U(101)])).rows[0].amount_cents, 500)
})

test('affiliates read only their own dashboard rows', async (t) => {
  const db = await optionDb(); t.after(() => db.close())
  await db.query(`insert into affiliate_clicks (affiliate_id, device_hash) values ($1, 'dev')`, [U(100)])
  await db.query(`insert into affiliate_attributions (affiliate_id, referred_user_id, role, masked_name, device_hash) values ($1, $2, 'rider', 'J. S.', 'secret-device')`, [U(100), U(2)])
  await db.query(`insert into affiliate_payout_events (affiliate_id, stripe_event_id, event_type, amount_cents, status) values ($1, 'evt_1', 'payout.paid', 400, 'paid')`, [U(100)])

  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U(1)}', false)`)
  assert.equal((await db.query('select masked_name from affiliate_attributions')).rows[0].masked_name, 'J. S.')
  await assert.rejects(db.query('select device_hash from affiliate_attributions'))
  await assert.rejects(db.query('select referred_user_id from affiliate_attributions'))
  assert.equal((await db.query('select count(*)::int as n from affiliate_clicks')).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int as n from affiliate_payout_events')).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int as n from affiliate_dashboard_signals')).rows[0].n >= 1, true)
  await assert.rejects(db.query(`insert into affiliate_payout_events (affiliate_id, event_type) values ('${U(100)}', 'payout.paid')`))

  await db.exec(`select set_config('request.jwt.claim.sub', '${U(2)}', false)`)
  assert.equal((await db.query('select count(*)::int as n from affiliate_clicks')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int as n from affiliate_attributions')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int as n from affiliate_payout_events')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int as n from affiliate_ledger')).rows[0].n, 0)
})

test('connect onboarding and approval transfer stay in test mode', async () => {
  const { createAffiliatesHandler } = await import('../server/endpoints/affiliates.js')
  const calls = []
  const verified = {
    id: 'acct_test_aff', details_submitted: true, payouts_enabled: true, charges_enabled: true,
    capabilities: { transfers: 'active' }, requirements: {},
  }
  const stripe = {
    accounts: {
      create: async (params) => { calls.push(['account', params]); return { id: 'acct_test_aff', ...params, details_submitted: false, payouts_enabled: false, capabilities: { transfers: 'pending' }, requirements: {} } },
      retrieve: async () => verified,
    },
    accountLinks: {
      create: async (params) => { calls.push(['link', params]); return { url: 'https://connect.stripe.com/setup/e/acct_test_aff' } },
    },
    transfers: {
      create: async (params, opts) => { calls.push(['transfer', params, opts]); return { id: 'tr_test_1' } },
    },
  }
  const affId = U(100)
  const batchId = U(200)
  const entryId = U(201)
  const tables = {
    affiliates: [{
      id: affId, user_id: 'user-1', code: 'TIGER1', partner_type: 'student', display_name: 'Tiger',
      contact_email: 't@x.com', status: 'active', payout_method: 'stripe_connect',
      stripe_account_id: null, stripe_connect_status: 'not_started',
    }],
    affiliate_config: [{ key: 'rates', value: { ...AFFILIATE_RATES_DEFAULTS } }],
    affiliate_payout_batches: [],
    affiliate_ledger: [],
    affiliate_attributions: [],
    affiliate_clicks: [],
    affiliate_payout_events: [],
    profiles: [],
  }
  const sb = memorySb(tables)
  const handler = createAffiliatesHandler({
    admin: () => sb,
    userFromAuth: async () => ({ id: 'user-1', email: 't@x.com' }),
    loadStaffAccess: async () => ({ admin: true }),
    stripeClient: () => stripe,
    stripeKey: 'sk_test_crimson_rides',
  })
  const live = createAffiliatesHandler({
    admin: () => sb,
    userFromAuth: async () => ({ id: 'user-1' }),
    loadStaffAccess: async () => ({ admin: true }),
    stripeClient: () => stripe,
    stripeKey: 'sk_live_crimson',
  })
  const banned = createAffiliatesHandler({
    admin: () => sb,
    userFromAuth: async () => ({ id: 'user-1' }),
    loadStaffAccess: async () => ({ admin: false }),
    stripeClient: () => stripe,
    stripeKey: 'sk_test_screenshotsticky_nope',
  })

  let res = response()
  await handler({ method: 'GET', url: '/api/affiliates?action=plan', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json.plan.rider_first_ride_cents, 400)
  assert.equal(res.json.plan.rider_min_fare_cents, 1500)

  res = response()
  await live({ method: 'POST', url: '/api/affiliates?action=connect-start', headers: { origin: 'http://localhost:5173' }, body: {} }, res)
  assert.equal(res.statusCode, 403)
  assert.equal(calls.filter((c) => c[0] === 'account').length, 0)

  res = response()
  await banned({ method: 'POST', url: '/api/affiliates?action=connect-start', headers: {}, body: {} }, res)
  assert.equal(res.statusCode, 403)

  res = response()
  await handler({ method: 'POST', url: '/api/affiliates?action=connect-start', headers: { origin: 'http://localhost:5173' }, body: {} }, res)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json.url, 'https://connect.stripe.com/setup/e/acct_test_aff')
  assert.equal(res.json.connect_status, 'pending')
  const account = calls.find((c) => c[0] === 'account')[1]
  assert.equal(account.type, 'express')
  assert.equal(account.capabilities.transfers.requested, true)
  assert.equal(account.metadata.platform, 'crimson_rides')
  const link = calls.find((c) => c[0] === 'link')[1]
  assert.equal(link.type, 'account_onboarding')
  assert.equal(link.refresh_url, 'http://localhost:5173/affiliates?connect=refresh')
  assert.equal(link.return_url, 'http://localhost:5173/affiliates?connect=return')
  assert.equal(tables.affiliates[0].stripe_account_id, 'acct_test_aff')
  assert.equal(tables.affiliates[0].payout_method, 'stripe_connect')

  tables.affiliates[0].stripe_connect_status = 'verified'
  tables.affiliate_payout_batches.push({ id: batchId, status: 'draft', total_cents: 400, entry_count: 1 })
  tables.affiliate_ledger.push({
    id: entryId, affiliate_id: affId, amount_cents: 400, status: 'pending', batch_id: batchId, kind: 'referral_rider',
  })
  tables.affiliate_ledger.push({
    id: U(202), affiliate_id: affId, amount_cents: 400, status: 'void', batch_id: null, kind: 'referral_rider',
  })
  res = response()
  await handler({ method: 'POST', url: '/api/affiliates?action=admin-batch-approve', headers: {}, body: { batch_id: batchId } }, res)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json.batch.status, 'paid')
  const transfer = calls.find((c) => c[0] === 'transfer')
  assert.equal(transfer[1].amount, 400)
  assert.equal(transfer[1].destination, 'acct_test_aff')
  assert.equal(transfer[1].metadata.kind, 'affiliate_payout')
  assert.equal(transfer[2].idempotencyKey, `affiliate:${entryId}`)
  assert.equal(tables.affiliate_ledger.find((row) => row.id === entryId).status, 'paid')
  assert.equal(tables.affiliate_ledger.find((row) => row.id === entryId).payout_ref, 'tr_test_1')
  assert.equal(tables.affiliate_ledger.find((row) => row.id === U(202)).status, 'void')

  const before = calls.filter((c) => c[0] === 'transfer').length
  tables.affiliates[0].stripe_connect_status = 'pending'
  tables.affiliates[0].payout_method = 'stripe_connect'
  const retryBatch = U(203)
  const retryEntry = U(204)
  tables.affiliate_payout_batches.push({ id: retryBatch, status: 'draft', total_cents: 400, entry_count: 1 })
  tables.affiliate_ledger.push({ id: retryEntry, affiliate_id: affId, amount_cents: 400, status: 'pending', batch_id: retryBatch, kind: 'referral_rider' })
  stripe.accounts.retrieve = async () => ({ id: 'acct_test_aff', details_submitted: true, payouts_enabled: false, capabilities: { transfers: 'pending' }, requirements: { disabled_reason: 'requirements.pending_verification' } })
  res = response()
  await handler({ method: 'POST', url: '/api/affiliates?action=admin-batch-approve', headers: {}, body: { batch_id: retryBatch } }, res)
  assert.equal(res.json.batch.status, 'failed')
  assert.equal(calls.filter((c) => c[0] === 'transfer').length, before)
  assert.equal(tables.affiliate_ledger.find((row) => row.id === retryEntry).status, 'approved')

  res = response()
  await live({ method: 'POST', url: '/api/affiliates?action=admin-batch-pay', headers: {}, body: { batch_id: retryBatch } }, res)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(calls.filter((c) => c[0] === 'transfer').length, before)
  assert.match(res.json.results.find((row) => row.id === retryEntry).error, /test key/i)
})

test('connect webhooks record account, transfer, and payout events', async () => {
  const { handleAffiliateConnectEvent } = await import('../server/affiliateConnect.js')
  const handler = (await import('../api/stripe-webhook.js')).default
  const affId = U(100)
  const tables = {
    affiliates: [{ id: affId, stripe_account_id: 'acct_test_aff', stripe_connect_status: 'pending', stripe_onboarded_at: null }],
    affiliate_ledger: [{ id: U(201), affiliate_id: affId }],
    affiliate_payout_events: [],
  }
  const sb = memorySb(tables)
  const account = await handleAffiliateConnectEvent(sb, {
    id: 'evt_acct', type: 'account.updated', livemode: false,
    data: { object: { id: 'acct_test_aff', details_submitted: true, payouts_enabled: true, charges_enabled: true, capabilities: { transfers: 'active' }, requirements: {}, metadata: { program: 'affiliate', affiliate_id: affId } } },
  })
  assert.equal(account.connect_status, 'verified')
  assert.equal(tables.affiliates[0].stripe_connect_status, 'verified')

  const transfer = await handleAffiliateConnectEvent(sb, {
    id: 'evt_tr', type: 'transfer.created',
    data: { object: { id: 'tr_1', amount: 400, currency: 'usd', destination: 'acct_test_aff', metadata: { kind: 'affiliate_payout', ledger_id: U(201) } } },
  })
  assert.equal(transfer.ok, true)
  assert.equal(tables.affiliate_payout_events[0].event_type, 'transfer.created')
  const again = await handleAffiliateConnectEvent(sb, {
    id: 'evt_tr', type: 'transfer.created',
    data: { object: { id: 'tr_1', amount: 400, currency: 'usd', destination: 'acct_test_aff', metadata: { kind: 'affiliate_payout', ledger_id: U(201) } } },
  })
  assert.equal(again.duplicate, true)

  const payout = await handleAffiliateConnectEvent(sb, {
    id: 'evt_po', type: 'payout.paid', account: 'acct_test_aff',
    data: { object: { id: 'po_1', amount: 400, currency: 'usd', status: 'paid' } },
  })
  assert.equal(payout.ok, true)
  assert.equal(tables.affiliate_payout_events.some((row) => row.event_type === 'payout.paid'), true)

  const other = await handleAffiliateConnectEvent(sb, {
    id: 'evt_other', type: 'payout.paid', account: 'acct_driver',
    data: { object: { id: 'po_driver', amount: 900, status: 'paid' } },
  })
  assert.equal(other.skipped, true)

  const res = response()
  await handler({
    method: 'POST',
    headers: {},
    rawBody: Buffer.from(JSON.stringify({
      id: 'evt_live', type: 'account.updated', livemode: true,
      data: { object: { id: 'acct_test_aff', payouts_enabled: false, details_submitted: false } },
    })),
  }, res, { stripeSecret: 'sk_test_crimson', webhookSecret: '', serviceKey: 'service', serviceClient: () => sb })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json.affiliate.reason, 'live_mode')
  assert.equal(tables.affiliates[0].stripe_connect_status, 'verified')
})
