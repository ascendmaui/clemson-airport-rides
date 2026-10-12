import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PERK_CONFIG_KEYS, buildPerks, default as handleDriverPerks } from './endpoints/driverPerks.js'
import { awardBonuses, payBonusLedger } from './perks.js'

test('ledger migration is additive with idempotent award key', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261012130000_driver_perks_ledger_streaks.sql', import.meta.url), 'utf8')
  assert.match(sql, /unique \(kind, driver_id, ref\)/)
  assert.match(sql, /on conflict \(key\) do nothing/)
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate)\b/i)
})

test('awardBonuses upserts with ignoreDuplicates on the ledger key', async () => {
  let call
  const sb = { from: () => ({ upsert: async (rows, opts) => { call = { rows, opts }; return { error: null } } }) }
  await awardBonuses(sb, 'd1', [{ kind: 'streak_trips', ref: 'trip:t', amountCents: 500 }, { kind: 'x', ref: 'r', amountCents: 0 }])
  assert.equal(call.rows.length, 1)
  assert.deepEqual(call.opts, { onConflict: 'kind,driver_id,ref', ignoreDuplicates: true })
})

test('payBonusLedger pays each row once with its id as idempotency key', async () => {
  const rows = [
    { id: 'b1', driver_id: 'd1', kind: 'streak_days', amount_cents: 1500, attempts: 0, status: 'pending' },
    { id: 'b2', driver_id: 'd2', kind: 'referral', amount_cents: 2500, attempts: 0, status: 'pending' },
    { id: 'b3', driver_id: 'd1', kind: 'x', amount_cents: 100, attempts: 5, status: 'failed' },
  ]
  const updates = []
  const q = { select: () => q, in: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) }
  const sb = { from: () => ({ ...q, update: (patch) => ({ eq: (_c, id) => ({ in: async () => { updates.push({ id, patch }); return {} } }) }) }) }
  const transfers = []
  const stripe = { transfers: { create: async (p, o) => { transfers.push({ p, o }); return { id: `tr_${p.amount}` } } } }
  const res = await payBonusLedger(sb, stripe, { loadAccount: async (_sb, id) => (id === 'd1' ? 'acct_1' : null) })
  assert.deepEqual(res.map((r) => r.status), ['paid', 'failed'])
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].o.idempotencyKey, 'bonus:b1')
  assert.equal(updates.find((u) => u.id === 'b2').patch.last_error, 'no_connect_account')
})

test('first ride migration only seeds config and does not rewrite the ledger', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261012241000_first_ride_daily_bonus.sql', import.meta.url), 'utf8')
  assert.match(sql, /first_ride_daily/)
  assert.match(sql, /'bonusCents', 500/)
  assert.match(sql, /'startsAt', to_char\(now\(\)/)
  assert.match(sql, /on conflict \(key\) do nothing/)
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate|alter table|create table)\b/i)
})

function perkDb({ config = {}, trips = [], isAdmin = false } = {}) {
  const upserts = []
  const configWrites = []
  const sb = {
    upserts,
    configWrites,
    from(table) {
      if (table === 'driver_perk_config') {
        const q = {
          select: () => q,
          eq: (_col, key) => { q.key = key; return q },
          maybeSingle: async () => ({ data: config[q.key] ? { value: config[q.key] } : null, error: null }),
          upsert: async (row) => { configWrites.push(row); return { error: null } },
        }
        return q
      }
      if (table === 'trips') {
        let cancels = false
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          contains: () => { cancels = true; return q },
          limit: async () => ({ data: cancels ? [] : trips, error: null }),
        }
        return q
      }
      if (table === 'driver_bonus_ledger') {
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          limit: async () => ({ data: [], error: null }),
          upsert: async (rows, opts) => { upserts.push({ rows, opts }); return { error: null } },
        }
        return q
      }
      if (table === 'profiles') {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { is_admin: isAdmin }, error: null }),
        }
        return q
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return sb
}

function mockRes() {
  return {
    statusCode: 0,
    body: '',
    writableEnded: false,
    headersSent: false,
    setHeader() {},
    end(payload) { this.body = payload; this.writableEnded = true },
  }
}

const FIRST = { enabled: true, startsAt: '2026-10-01T00:00:00Z', bonusCents: 500 }

test('GET perks awards the first completed ride of the NY day and skips canceled and e2e trips', async () => {
  const driverId = 'drv-1'
  const sb = perkDb({
    config: { first_ride_daily: FIRST },
    trips: [
      { id: 'e2e', driver_id: driverId, status: 'completed', completed_at: '2026-10-12T14:00:00Z', metadata: { e2e_test: true } },
      { id: 'canceled', driver_id: driverId, status: 'canceled', canceled_at: '2026-10-12T14:30:00Z', completed_at: null, metadata: {} },
      { id: 'real', driver_id: driverId, status: 'completed', completed_at: '2026-10-12T15:00:00Z', metadata: {} },
      { id: 'again', driver_id: driverId, status: 'completed', completed_at: '2026-10-12T18:00:00Z', metadata: {} },
    ],
  })
  const now = new Date('2026-10-12T20:00:00Z')
  const view = await buildPerks(sb, driverId, { now })
  assert.equal(view.firstRide.earned, true)
  assert.equal(view.firstRide.available, false)
  assert.equal(view.firstRide.bonusCents, 500)
  assert.equal(view.firstRide.today, '2026-10-12')
  assert.equal(sb.upserts.length, 1)
  assert.deepEqual(sb.upserts[0].rows, [{
    driver_id: driverId,
    kind: 'first_ride_daily',
    ref: 'drv-1:2026-10-12',
    amount_cents: 500,
    trip_id: 'real',
    metadata: { day: '2026-10-12' },
  }])
  assert.deepEqual(sb.upserts[0].opts, { onConflict: 'kind,driver_id,ref', ignoreDuplicates: true })

  const res = mockRes()
  await handleDriverPerks({ method: 'GET' }, res, { sb, user: { id: driverId }, now })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.firstRide.earned, true)
  assert.equal(body.firstRide.today, '2026-10-12')
})

test('first ride stays available until a qualifying completion, and admins can edit the amount', async () => {
  assert.ok(PERK_CONFIG_KEYS.includes('first_ride_daily'))
  const sb = perkDb({ config: { first_ride_daily: FIRST }, trips: [] })
  const open = await buildPerks(sb, 'drv-1', { now: new Date('2026-10-12T20:00:00Z') })
  assert.equal(open.firstRide.available, true)
  assert.equal(open.firstRide.earned, false)
  assert.equal(sb.upserts.length, 0)

  const denied = mockRes()
  await handleDriverPerks({
    method: 'POST',
    body: { op: 'config', key: 'first_ride_daily', value: { enabled: true, bonusCents: 700, startsAt: FIRST.startsAt } },
  }, denied, { sb, user: { id: 'drv-1' } })
  assert.equal(denied.statusCode, 403)

  const adminSb = perkDb({ config: { first_ride_daily: FIRST }, isAdmin: true })
  const saved = mockRes()
  await handleDriverPerks({
    method: 'POST',
    body: { op: 'config', key: 'first_ride_daily', value: { enabled: true, bonusCents: 700, startsAt: FIRST.startsAt } },
  }, saved, { sb: adminSb, user: { id: 'admin-1' } })
  assert.equal(saved.statusCode, 200)
  assert.equal(adminSb.configWrites[0].key, 'first_ride_daily')
  assert.equal(adminSb.configWrites[0].value.bonusCents, 700)
  assert.equal(adminSb.configWrites[0].updated_by, 'admin-1')
})

test('payBonusLedger pays a first_ride_daily row through the bonus idempotency key', async () => {
  const rows = [{ id: 'b9', driver_id: 'd1', kind: 'first_ride_daily', amount_cents: 500, attempts: 0, status: 'pending' }]
  const q = { select: () => q, in: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) }
  const sb = { from: () => ({ ...q, update: () => ({ eq: () => ({ in: async () => ({}) }) }) }) }
  const transfers = []
  const stripe = { transfers: { create: async (p, o) => { transfers.push({ p, o }); return { id: 'tr_500' } } } }
  const res = await payBonusLedger(sb, stripe, { loadAccount: async () => 'acct_1' })
  assert.equal(res[0].kind, 'first_ride_daily')
  assert.equal(res[0].status, 'paid')
  assert.equal(transfers[0].p.amount, 500)
  assert.equal(transfers[0].o.idempotencyKey, 'bonus:b9')
})
