import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { attemptDriverPayout, attemptTipPayout, writePayout } from './payouts.js'
import { executeCashout } from './cashout.js'
import { payBonusLedger } from './perks.js'
import { decideApproval, payoutGate, connectAccountState } from './payoutApproval.js'
import { rerunApprovalSource } from './payoutApprovalExecute.js'
import handlePayoutApprovals from './endpoints/payoutApprovals.js'
import { cashoutBalanceCents } from '../shared/cashout.js'
import {
  approvalStatusLabel, isPayoutApprover, payoutApprovalRequired, publicApprovalRow,
} from '../shared/payoutApproval.js'

const LIVE = { STRIPE_SECRET_KEY: 'sk_live_test_only', CASHOUT_LIVE_ENABLED: '1' }
const TEST = { STRIPE_SECRET_KEY: 'sk_test_x' }
const JOHN = { id: 'admin-1', email: 'johnmatveyev@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' }

function fakeDb(seed = {}, rpcHandlers = {}) {
  const state = { payout_approval_requests: [], payout_approval_events: [], admin_notifications: [], rpcCalls: [], ...structuredClone(seed) }
  let n = 0
  function from(table) {
    if (!state[table]) state[table] = []
    const filters = []
    let op = 'select'
    let patch = null
    let rows = null
    let conflict = null
    let single = false
    const match = (row) => filters.every((f) => f(row))
    function run() {
      const list = state[table]
      if (op === 'insert') {
        const out = []
        for (const r of rows) {
          if (table === 'payout_approval_requests' && list.some((x) => x.source_ref === r.source_ref)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
          }
          const saved = { id: `${table}-${++n}`, attempts: 0, requested_at: new Date().toISOString(), ...r }
          list.push(saved)
          out.push(saved)
        }
        return { data: single ? out[0] : out, error: null }
      }
      if (op === 'upsert') {
        for (const r of rows) {
          const keys = String(conflict || 'id').split(',')
          const hit = list.find((x) => keys.every((k) => x[k] === r[k]))
          if (hit) Object.assign(hit, r)
          else list.push({ id: `${table}-${++n}`, ...r })
        }
        return { data: null, error: null }
      }
      if (op === 'update') {
        const hit = list.filter(match)
        hit.forEach((r) => Object.assign(r, structuredClone(patch)))
        return { data: single ? (hit[0] || null) : hit, error: null }
      }
      const hit = list.filter(match)
      return { data: single ? (hit[0] || null) : hit, error: null }
    }
    const api = {
      select() { return api },
      insert(r) { op = 'insert'; rows = Array.isArray(r) ? r : [r]; return api },
      update(p) { op = 'update'; patch = p; return api },
      upsert(r, opts) { op = 'upsert'; rows = Array.isArray(r) ? r : [r]; conflict = opts?.onConflict; return api },
      eq(c, v) { filters.push((r) => r[c] === v); return api },
      neq(c, v) { filters.push((r) => r[c] !== v); return api },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return api },
      contains() { return api },
      order() { return api },
      limit() { return api },
      maybeSingle() { single = true; return Promise.resolve(run()) },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return api
  }
  async function rpc(name, args) {
    state.rpcCalls.push([name, args])
    return rpcHandlers[name] ? rpcHandlers[name](args, state) : { data: null, error: null }
  }
  return { state, from, rpc }
}

function stripeMock({ externals = [] } = {}) {
  const calls = { transfers: [], payouts: [], retrieve: [] }
  return {
    calls,
    transfers: { create: async (params, opts) => { calls.transfers.push({ params, opts }); return { id: `tr_${calls.transfers.length}` } } },
    payouts: { create: async (params, opts) => { calls.payouts.push({ params, opts }); return { id: `po_${calls.payouts.length}` } } },
    accounts: {
      retrieve: async (id) => {
        calls.retrieve.push(id)
        if (String(id).startsWith('acct_testmode')) {
          const err = new Error(`No such account: '${id}'; a similar object exists in test mode, but a live mode key was used`)
          err.code = 'resource_missing'
          err.statusCode = 404
          throw err
        }
        return { id, details_submitted: true, payouts_enabled: true }
      },
      listExternalAccounts: async () => ({ data: externals }),
    },
  }
}

function trip(id, cents = 2000, extra = {}) {
  return {
    id, driver_id: 'd1', status: 'completed', fare_cents: cents, tip_cents: 0,
    metadata: { driver_net_cents: cents, payout: { status: 'pending', amountCents: cents, attempts: 0 } },
    ...extra,
  }
}

test('approval is required for every live key and optional in test mode', () => {
  assert.equal(payoutApprovalRequired({ STRIPE_SECRET_KEY: 'sk_live_x' }), true)
  assert.equal(payoutApprovalRequired({ STRIPE_SECRET_KEY: 'rk_live_x' }), true)
  assert.equal(payoutApprovalRequired({ STRIPE_SECRET_KEY: 'sk_test_x' }), false)
  assert.equal(payoutApprovalRequired({ STRIPE_SECRET_KEY: 'sk_test_x', PAYOUT_APPROVAL_REQUIRED: '1' }), true)
  // A live key cannot turn it off.
  assert.equal(payoutApprovalRequired({ STRIPE_SECRET_KEY: 'sk_live_x', PAYOUT_APPROVAL_REQUIRED: '0' }), true)
})

test('only John (verified email) is the payout approver', () => {
  assert.equal(isPayoutApprover(JOHN), true)
  assert.equal(isPayoutApprover({ ...JOHN, email: 'JohnMatveyev@Gmail.com ' }), true)
  assert.equal(isPayoutApprover({ ...JOHN, email_confirmed_at: null }), false)
  assert.equal(isPayoutApprover({ id: 'x', email: 'ascendmaui@gmail.com', email_confirmed_at: 'y' }), false)
  assert.equal(isPayoutApprover({ id: 'x', email: 'someone@clemson.edu', email_confirmed_at: 'y', is_admin: true }), false)
  assert.equal(isPayoutApprover(null), false)
})

test('test mode keeps paying without a request row', async () => {
  const sb = fakeDb()
  const stripe = stripeMock()
  const res = await attemptDriverPayout({ trip: trip('t-test'), stripe, connectAccountId: 'acct_1', sb, env: TEST })
  assert.equal(res.ok, true)
  assert.equal(stripe.calls.transfers.length, 1)
  assert.equal(sb.state.payout_approval_requests.length, 0)
})

test('live trip payout waits for approval, approve sends exactly once, rerun never pays twice', async () => {
  const t = trip('t1')
  const sb = fakeDb({ trips: [t], profiles: [{ id: 'd1', stripe_account_id: 'acct_live1' }], driver_payouts: [] })
  const stripe = stripeMock()
  const first = await attemptDriverPayout({ trip: t, stripe, connectAccountId: 'acct_live1', sb, env: LIVE })
  assert.equal(first.pendingApproval, true)
  assert.equal(first.payout.status, 'pending_approval')
  assert.equal(stripe.calls.transfers.length, 0)
  await writePayout(sb, t, first.payout)
  assert.equal(sb.state.payout_approval_requests.length, 1)
  const req = sb.state.payout_approval_requests[0]
  assert.equal(req.status, 'pending_approval')
  assert.equal(req.kind, 'trip_payout')
  assert.equal(req.amount_cents, 2000)
  assert.equal(sb.state.payout_approval_events[0].action, 'requested')
  assert.equal(sb.state.admin_notifications.length, 1)
  // Pending approval is not cash-out balance, so it cannot be claimed twice.
  assert.equal(cashoutBalanceCents(sb.state.trips), 0)

  const again = await attemptDriverPayout({ trip: sb.state.trips[0], stripe, connectAccountId: 'acct_live1', sb, env: LIVE })
  assert.equal(again.pendingApproval, true)
  assert.equal(sb.state.payout_approval_requests.length, 1)
  assert.equal(stripe.calls.transfers.length, 0)

  const decided = await decideApproval(sb, { id: req.id, decision: 'approve', actor: JOHN })
  assert.equal(decided.ok, true)
  const run = await rerunApprovalSource({ sb, stripe, request: decided.request, env: LIVE })
  assert.equal(run.ok, true)
  assert.equal(stripe.calls.transfers.length, 1)
  assert.equal(stripe.calls.transfers[0].opts.idempotencyKey, `approval:${req.id}:transfer:0`)
  assert.equal(stripe.calls.transfers[0].params.amount, 2000)
  assert.equal(sb.state.payout_approval_requests[0].status, 'sent')
  assert.equal(sb.state.trips[0].metadata.payout.status, 'paid')
  const actions = sb.state.payout_approval_events.map((e) => e.action)
  assert.deepEqual(actions, ['requested', 'approved', 'sent'])
  assert.equal(sb.state.payout_approval_events[1].actor_email, 'johnmatveyev@gmail.com')

  const twice = await decideApproval(sb, { id: req.id, decision: 'approve', actor: JOHN })
  assert.equal(twice.ok, false)
  assert.equal(twice.status, 409)
  await rerunApprovalSource({ sb, stripe, request: sb.state.payout_approval_requests[0], env: LIVE })
  assert.equal(stripe.calls.transfers.length, 1)
})

test('reject releases the trip payout back to the cash-out balance with the reason', async () => {
  const t = trip('t2', 1500)
  const sb = fakeDb({ trips: [t], profiles: [{ id: 'd1', stripe_account_id: 'acct_live1' }], driver_payouts: [] })
  const stripe = stripeMock()
  const first = await attemptDriverPayout({ trip: t, stripe, connectAccountId: 'acct_live1', sb, env: LIVE })
  await writePayout(sb, t, first.payout)
  const req = sb.state.payout_approval_requests[0]
  const decided = await decideApproval(sb, { id: req.id, decision: 'reject', actor: JOHN, reason: '  duplicate   trip ' })
  assert.equal(decided.ok, true)
  assert.equal(decided.request.reject_reason, 'duplicate trip')
  await rerunApprovalSource({ sb, stripe, request: decided.request, env: LIVE })
  assert.equal(stripe.calls.transfers.length, 0)
  assert.equal(sb.state.trips[0].metadata.payout.status, 'pending')
  assert.equal(sb.state.trips[0].metadata.payout.lastError, 'rejected_by_admin')
  assert.equal(cashoutBalanceCents(sb.state.trips), 1500)
  assert.equal(approvalStatusLabel(decided.request), 'Rejected: duplicate trip')
  assert.equal(publicApprovalRow(decided.request).statusLabel, 'Rejected: duplicate trip')
})

test('a test-mode connected account is flagged for re-onboarding and never requested or sent', async () => {
  const sb = fakeDb()
  const stripe = stripeMock()
  const res = await attemptDriverPayout({ trip: trip('t3'), stripe, connectAccountId: 'acct_testmode_old', sb, env: LIVE })
  assert.equal(res.needsReonboard, true)
  assert.equal(res.payout.lastError, 'needs_reonboard')
  assert.equal(res.payout.attempts, 0)
  assert.equal(sb.state.payout_approval_requests.length, 0)
  assert.equal(stripe.calls.transfers.length, 0)
  assert.deepEqual(await connectAccountState(stripe, 'acct_testmode_old'), { ok: false, reason: 'needs_reonboard' })
})

test('tips go through the same gate', async () => {
  const t = { ...trip('t4'), tip_cents: 500, metadata: { payout: { status: 'paid', amountCents: 2000 } } }
  const sb = fakeDb({ trips: [t], profiles: [{ id: 'd1', stripe_account_id: 'acct_live1' }], backup_driver_payouts: [] })
  const stripe = stripeMock()
  const res = await attemptTipPayout({ sb, trip: t, stripe, env: LIVE })
  assert.equal(res.pendingApproval, true)
  assert.equal(stripe.calls.transfers.length, 0)
  assert.equal(sb.state.payout_approval_requests[0].kind, 'tip')
  assert.equal(sb.state.payout_approval_requests[0].source_ref, 'payout-tip:t4')
})

test('bonuses wait for approval and pay once after it', async () => {
  const sb = fakeDb({
    driver_bonus_ledger: [{ id: 'b1', driver_id: 'd1', kind: 'streak', amount_cents: 1000, status: 'pending', attempts: 0 }],
    profiles: [{ id: 'd1', stripe_account_id: 'acct_live1' }],
  })
  const stripe = stripeMock()
  const first = await payBonusLedger(sb, stripe, { env: LIVE })
  assert.equal(first[0].status, 'pending_approval')
  assert.equal(stripe.calls.transfers.length, 0)
  assert.equal(sb.state.driver_bonus_ledger[0].status, 'pending')
  const req = sb.state.payout_approval_requests[0]
  const decided = await decideApproval(sb, { id: req.id, decision: 'approve', actor: JOHN })
  await rerunApprovalSource({ sb, stripe, request: decided.request, env: LIVE })
  assert.equal(stripe.calls.transfers.length, 1)
  assert.equal(sb.state.driver_bonus_ledger[0].status, 'paid')
  await payBonusLedger(sb, stripe, { env: LIVE })
  assert.equal(stripe.calls.transfers.length, 1)
})

function cashoutDb() {
  return fakeDb({
    profiles: [{ id: 'd1', stripe_account_id: 'acct_live1' }],
    trips: [trip('c1', 3000)],
    driver_cashouts: [],
  }, {
    claim_driver_cashout: (args, state) => {
      const row = { id: 'co1', driver_id: 'd1', status: 'claimed', method: 'standard', gross_cents: 3000, fee_cents: 0, net_cents: 3000, trip_ids: ['c1'] }
      state.driver_cashouts.push(row)
      state.trips[0].metadata.payout.status = 'cashout_pending'
      return { data: [row], error: null }
    },
    settle_driver_cashout: (args, state) => {
      const row = state.driver_cashouts.find((r) => r.id === args.p_cashout)
      row.status = args.p_status
      state.trips[0].metadata.payout.status = args.p_ok ? 'paid' : 'pending'
      return { data: row, error: null }
    },
  })
}

const NOON_SAFE = new Date('2026-10-15T15:00:00Z')

test('live cash-out holds the claim as Pending approval; approve transfers and pays out once', async () => {
  const sb = cashoutDb()
  const stripe = stripeMock({ externals: [{ object: 'bank_account', last4: '6789' }] })
  const res = await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 0, env: LIVE, now: NOON_SAFE, method: 'standard' })
  assert.equal(res.ok, true)
  assert.equal(res.pendingApproval, true)
  assert.equal(stripe.calls.transfers.length, 0)
  assert.equal(stripe.calls.payouts.length, 0)
  const req = sb.state.payout_approval_requests[0]
  assert.equal(req.kind, 'cashout')
  assert.equal(req.amount_cents, 3000)
  const decided = await decideApproval(sb, { id: req.id, decision: 'approve', actor: JOHN })
  const run = await rerunApprovalSource({ sb, stripe, request: decided.request, env: LIVE })
  assert.equal(run.ok, true)
  assert.equal(stripe.calls.transfers.length, 1)
  assert.equal(stripe.calls.payouts.length, 1)
  assert.equal(stripe.calls.transfers[0].opts.idempotencyKey, `approval:${req.id}:cashout-transfer:0`)
  assert.equal(sb.state.driver_cashouts[0].status, 'paid')
  assert.equal(sb.state.payout_approval_requests[0].status, 'sent')
  const again = await rerunApprovalSource({ sb, stripe, request: sb.state.payout_approval_requests[0], env: LIVE })
  assert.equal(again.ok, false)
  assert.equal(stripe.calls.transfers.length, 1)
})

test('rejected cash-out releases the held trips back to the balance', async () => {
  const sb = cashoutDb()
  const stripe = stripeMock({ externals: [{ object: 'bank_account', last4: '6789' }] })
  await executeCashout({ sb, stripe, driverId: 'd1', expectedFeeCents: 0, env: LIVE, now: NOON_SAFE, method: 'standard' })
  const req = sb.state.payout_approval_requests[0]
  const decided = await decideApproval(sb, { id: req.id, decision: 'reject', actor: JOHN, reason: 'call me' })
  await rerunApprovalSource({ sb, stripe, request: decided.request, env: LIVE })
  assert.equal(stripe.calls.transfers.length, 0)
  assert.equal(sb.state.driver_cashouts[0].status, 'failed')
  assert.equal(sb.state.trips[0].metadata.payout.status, 'pending')
  const settle = sb.state.rpcCalls.find(([name]) => name === 'settle_driver_cashout')
  assert.match(settle[1].p_error, /rejected_by_admin: call me/)
})

test('the gate refuses to send a different amount than the one approved', async () => {
  const sb = fakeDb()
  const base = { sb, env: LIVE, kind: 'trip_payout', sourceRef: 'payout:tx', payeeId: 'd1', notify: null }
  await payoutGate({ ...base, amountCents: 1000 })
  const req = sb.state.payout_approval_requests[0]
  await decideApproval(sb, { id: req.id, decision: 'approve', actor: JOHN })
  const changed = await payoutGate({ ...base, amountCents: 1200 })
  assert.equal(changed.allowed, false)
  assert.equal(changed.status, 'amount_changed')
  const same = await payoutGate({ ...base, amountCents: 1000 })
  assert.equal(same.allowed, true)
})

function mockRes() {
  return { statusCode: 0, body: '', setHeader() {}, end(p) { this.body = p == null ? '' : String(p) } }
}

test('approval endpoint: only John may list or decide; drivers see their own requests', async () => {
  const sb = fakeDb({ profiles: [{ id: 'd1', full_name: 'Ada', email: 'ada@clemson.edu' }] })
  await payoutGate({ sb, env: LIVE, kind: 'tip', sourceRef: 'payout-tip:z', payeeId: 'd1', amountCents: 700, notify: null })
  const driver = { id: 'd1', email: 'ada@clemson.edu', email_confirmed_at: 'x' }
  let res = mockRes()
  await handlePayoutApprovals({ method: 'GET', headers: {}, url: '/api/driver?action=payout-approvals&scope=admin', query: { scope: 'admin' } }, res, { sb, user: driver, env: LIVE })
  assert.equal(res.statusCode, 403)
  res = mockRes()
  await handlePayoutApprovals({ method: 'POST', headers: {}, body: { id: sb.state.payout_approval_requests[0].id, decision: 'approve' } }, res, { sb, user: driver, env: LIVE })
  assert.equal(res.statusCode, 403)
  assert.equal(sb.state.payout_approval_requests[0].status, 'pending_approval')
  res = mockRes()
  await handlePayoutApprovals({ method: 'GET', headers: {}, url: '/api/driver?action=payout-approvals' }, res, { sb, user: driver, env: LIVE })
  const mine = JSON.parse(res.body)
  assert.equal(mine.requests.length, 1)
  assert.equal(mine.requests[0].statusLabel, 'Pending approval')
  assert.equal(mine.requests[0].destination_account, undefined)
  res = mockRes()
  await handlePayoutApprovals({ method: 'GET', headers: {}, url: '/api/driver?action=payout-approvals&scope=admin', query: { scope: 'admin' } }, res, { sb, user: JOHN, env: LIVE })
  const queue = JSON.parse(res.body)
  assert.equal(queue.pending.length, 1)
  assert.equal(queue.pending[0].driverName, 'Ada')
  assert.equal(queue.pending[0].amountCents, 700)
  res = mockRes()
  let ran = 0
  await handlePayoutApprovals({ method: 'POST', headers: {}, body: { id: queue.pending[0].id, decision: 'reject', reason: 'no' } }, res, {
    sb, user: JOHN, env: LIVE, stripe: null, rerunApprovalSource: async () => { ran += 1; return { ok: true } },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(ran, 1)
  assert.equal(sb.state.payout_approval_requests[0].status, 'rejected')
})

test('migration adds RLS, the sole-approver function and the transition guard', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261015131500_payout_approval_requests.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.payout_approval_requests/)
  assert.match(sql, /source_ref text NOT NULL UNIQUE/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /payee_id = auth\.uid\(\) OR public\.is_payout_approver\(\)/)
  assert.match(sql, /lower\(u\.email\) = 'johnmatveyev@gmail\.com'/)
  assert.match(sql, /payout_request_not_pending/)
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/i)
})

test('rider app never gets the payout approvals panel; driver admin does', () => {
  const driverAdmin = readFileSync(new URL('../apps/driver/app/admin.tsx', import.meta.url), 'utf8')
  const riderAdmin = readFileSync(new URL('../apps/rider/app/admin.tsx', import.meta.url), 'utf8')
  assert.match(driverAdmin, /PayoutApprovalsPanel/)
  assert.doesNotMatch(riderAdmin, /PayoutApprovals/)
})
