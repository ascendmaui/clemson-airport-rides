import test from 'node:test'
import assert from 'node:assert/strict'
import driverPayoutsHandler, { isVercelCron } from '../server/endpoints/driverPayouts.js'

const SECRET = 'valid_cron_secret'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    headersSent: false,
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function dueTrip() {
  return {
    id: 'trip_cron',
    driver_id: 'd_1',
    fare_cents: 5000,
    status: 'completed',
    metadata: {
      payout: { status: 'failed', nextRetryAt: Date.now() - 1000, attempts: 1, amountCents: 4000 },
    },
  }
}

function mockSb(trips) {
  const state = { queries: 0 }
  const query = {
    select() { return query },
    eq() { return query },
    order() { return query },
    limit: async () => {
      state.queries += 1
      return { data: trips, error: null }
    },
  }
  return {
    queries: () => state.queries,
    from() { return query },
  }
}

/**
 * @param {'sweep'|'skipped'|'signin'|'forbidden'} expect
 */
async function invoke({ headers, env, url = '/api/driver-payouts', method = 'GET', user, trips }) {
  const res = mockRes()
  const sb = mockSb(trips === undefined ? [dueTrip()] : trips)
  const calls = { auth: 0, attempt: 0, write: 0 }
  await driverPayoutsHandler({ method, url, headers }, res, {
    sb,
    cronSecret: SECRET,
    env,
    user,
    userFromAuth: async () => {
      calls.auth += 1
      return null
    },
    loadConnectAccount: async () => 'acct_test',
    attemptDriverPayout: async () => {
      calls.attempt += 1
      return { ok: true, payout: { status: 'paid', attempts: 2 } }
    },
    writePayout: async () => {
      calls.write += 1
    },
  })
  return {
    status: res.statusCode,
    body: JSON.parse(res.body || '{}'),
    calls,
    queries: sb.queries(),
  }
}

test('isVercelCron matches legacy header, documented user-agent, and schedule', () => {
  assert.equal(isVercelCron({ headers: { 'x-vercel-cron': '1' } }), true)
  assert.equal(isVercelCron({ headers: { 'X-Vercel-Cron': 'true' } }), true)
  assert.equal(isVercelCron({ headers: { 'x-vercel-cron': '' } }), true)
  assert.equal(isVercelCron({ headers: { 'user-agent': 'vercel-cron/1.0' } }), true)
  assert.equal(isVercelCron({ headers: { 'User-Agent': ['Vercel-Cron/1.0'] } }), true)
  assert.equal(isVercelCron({ headers: { 'x-vercel-cron-schedule': '0 12 * * *' } }), true)
  assert.equal(isVercelCron({ headers: { 'X-Vercel-Cron-Schedule': '0 12 * * *' } }), true)
  assert.equal(isVercelCron({ headers: { 'user-agent': 'Mozilla/5.0' } }), false)
  assert.equal(isVercelCron({ headers: { 'x-vercel-cron-schedule': '   ' } }), false)
  assert.equal(isVercelCron({ headers: {} }), false)
  assert.equal(isVercelCron({}), false)
})

test('driver payout cron auth matrix', async () => {
  const vercel = { VERCEL: '1' }
  const offVercel = {}
  const bearer = { authorization: `Bearer ${SECRET}` }
  const badBearer = { authorization: 'Bearer wrong-secret' }
  const cases = [
    {
      name: 'vercel + x-vercel-cron + bearer runs the sweep',
      env: vercel,
      headers: { 'x-vercel-cron': '1', ...bearer },
      expect: 'sweep',
    },
    {
      name: 'vercel + x-vercel-cron + missing bearer skips',
      env: vercel,
      headers: { 'x-vercel-cron': '1' },
      expect: 'skipped',
    },
    {
      name: 'vercel + x-vercel-cron + bad bearer skips',
      env: vercel,
      headers: { 'x-vercel-cron': '1', ...badBearer },
      expect: 'skipped',
    },
    {
      name: 'vercel + documented UA without x-vercel-cron + bearer runs the sweep',
      env: vercel,
      headers: { 'user-agent': 'vercel-cron/1.0', ...bearer },
      expect: 'sweep',
    },
    {
      name: 'vercel + mixed-case UA array + bearer runs the sweep',
      env: vercel,
      headers: { 'User-Agent': ['vercel-cron/1.0'], ...bearer },
      expect: 'sweep',
    },
    {
      name: 'vercel + documented UA + bad bearer skips and does not move money',
      env: vercel,
      headers: { 'user-agent': 'vercel-cron/1.0', ...badBearer },
      expect: 'skipped',
    },
    {
      name: 'vercel + documented UA + missing bearer skips',
      env: vercel,
      headers: { 'user-agent': 'vercel-cron/1.0' },
      expect: 'skipped',
    },
    {
      name: 'vercel + x-vercel-cron-schedule + bearer runs the sweep',
      env: vercel,
      headers: { 'x-vercel-cron-schedule': '0 12 * * *', ...bearer },
      expect: 'sweep',
    },
    {
      name: 'vercel + x-vercel-cron-schedule + bad bearer skips',
      env: vercel,
      headers: { 'x-vercel-cron-schedule': '0 12 * * *', ...badBearer },
      expect: 'skipped',
    },
    {
      name: 'vercel + bearer alone is the signed-in branch',
      env: vercel,
      headers: bearer,
      expect: 'signin',
    },
    {
      name: 'vercel without a cron signal is the signed-in branch',
      env: vercel,
      headers: { 'user-agent': 'Mozilla/5.0' },
      expect: 'signin',
    },
    {
      name: 'off Vercel bearer alone runs the sweep',
      env: offVercel,
      headers: bearer,
      expect: 'sweep',
    },
    {
      name: 'off Vercel wrong bearer falls through to sign-in, not skipped',
      env: offVercel,
      headers: badBearer,
      expect: 'signin',
    },
    {
      name: 'off Vercel wrong bearer plus spoofed cron headers is still sign-in',
      env: offVercel,
      headers: {
        ...badBearer,
        'user-agent': 'vercel-cron/1.0',
        'x-vercel-cron': '1',
        'x-vercel-cron-schedule': '0 12 * * *',
      },
      expect: 'signin',
    },
    {
      name: 'off Vercel spoofed x-vercel-cron is ignored',
      env: offVercel,
      headers: { 'x-vercel-cron': '1' },
      expect: 'signin',
    },
    {
      name: 'off Vercel spoofed user-agent is ignored',
      env: offVercel,
      headers: { 'user-agent': 'vercel-cron/1.0' },
      expect: 'signin',
    },
    {
      name: 'off Vercel spoofed schedule and UA without bearer are ignored',
      env: offVercel,
      headers: {
        'user-agent': 'vercel-cron/1.0',
        'x-vercel-cron': '1',
        'x-vercel-cron-schedule': '0 12 * * *',
      },
      expect: 'signin',
    },
    {
      name: 'off Vercel bearer still runs when a spoofed UA is also present',
      env: offVercel,
      headers: { 'user-agent': 'vercel-cron/1.0', ...bearer },
      expect: 'sweep',
    },
  ]

  for (const entry of cases) {
    const result = await invoke(entry)
    if (entry.expect === 'sweep') {
      assert.equal(result.status, 200, entry.name)
      assert.equal(result.body.ok, true, entry.name)
      assert.equal(result.body.skipped, undefined, entry.name)
      assert.equal(result.calls.attempt, 1, entry.name)
      assert.equal(result.calls.write, 1, entry.name)
      assert.equal(result.calls.auth, 0, entry.name)
      assert.equal(result.queries, 1, entry.name)
      assert.notEqual(result.body.error, 'Sign in required', entry.name)
    } else if (entry.expect === 'skipped') {
      assert.equal(result.status, 200, entry.name)
      assert.equal(result.body.skipped, true, entry.name)
      assert.match(result.body.reason, /Set CRON_SECRET/, entry.name)
      assert.equal(result.calls.attempt, 0, entry.name)
      assert.equal(result.calls.write, 0, entry.name)
      assert.equal(result.calls.auth, 0, entry.name)
      assert.equal(result.queries, 0, entry.name)
    } else if (entry.expect === 'signin') {
      assert.equal(result.status, 401, entry.name)
      assert.equal(result.body.error, 'Sign in required', entry.name)
      assert.equal(result.body.skipped, undefined, entry.name)
      assert.equal(result.calls.attempt, 0, entry.name)
      assert.equal(result.calls.write, 0, entry.name)
      assert.equal(result.calls.auth, 1, entry.name)
      assert.equal(result.queries, 0, entry.name)
    } else {
      assert.fail(`unhandled expect ${entry.expect}`)
    }
  }
})

test('off Vercel valid bearer dry_run is 200 and a wrong bearer is 401', async () => {
  const dry = await invoke({
    env: {},
    url: '/api/driver-payouts?dry_run=1',
    headers: { authorization: `Bearer ${SECRET}` },
    trips: [],
  })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.ok, true)
  assert.equal(dry.body.dryRun, true)
  assert.deepEqual(dry.body.results, [])
  assert.equal(dry.body.skipped, undefined)
  assert.equal(dry.calls.attempt, 0)
  assert.equal(dry.calls.write, 0)
  assert.equal(dry.calls.auth, 0)

  const wrong = await invoke({
    env: {},
    url: '/api/driver-payouts?dry_run=1',
    headers: {
      authorization: 'Bearer wrong-secret',
      'user-agent': 'vercel-cron/1.0',
      'x-vercel-cron': '1',
    },
  })
  assert.equal(wrong.status, 401)
  assert.equal(wrong.body.error, 'Sign in required')
  assert.equal(wrong.body.skipped, undefined)
  assert.equal(wrong.body.ok, undefined)
  assert.equal(wrong.calls.attempt, 0)
  assert.equal(wrong.calls.write, 0)
  assert.equal(wrong.calls.auth, 1)
  assert.equal(wrong.queries, 0)
})

test('vercel cron dry_run still requires the bearer and does not transfer', async () => {
  const allowed = await invoke({
    env: { VERCEL: '1' },
    url: '/api/driver-payouts?dry_run=1',
    headers: {
      'user-agent': 'vercel-cron/1.0',
      authorization: `Bearer ${SECRET}`,
    },
  })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.body.dryRun, true)
  assert.equal(allowed.body.results.length, 1)
  assert.equal(allowed.body.results[0].wouldTransfer, true)
  assert.equal(allowed.calls.attempt, 0)
  assert.equal(allowed.calls.write, 0)

  const denied = await invoke({
    env: { VERCEL: '1' },
    url: '/api/driver-payouts?dry_run=1',
    headers: { 'user-agent': 'vercel-cron/1.0' },
  })
  assert.equal(denied.status, 200)
  assert.equal(denied.body.skipped, true)
  assert.equal(denied.body.dryRun, undefined)
  assert.equal(denied.calls.attempt, 0)
  assert.equal(denied.calls.write, 0)
})

test('DISABLE_CRON_ENDPOINTS still blocks a recognized Vercel cron sweep', async () => {
  const blocked = await invoke({
    env: { VERCEL: '1', DISABLE_CRON_ENDPOINTS: '1' },
    headers: {
      'user-agent': 'vercel-cron/1.0',
      'x-vercel-cron-schedule': '0 12 * * *',
      authorization: `Bearer ${SECRET}`,
    },
  })
  assert.equal(blocked.status, 403)
  assert.match(blocked.body.error, /disabled/)
  assert.equal(blocked.calls.attempt, 0)
  assert.equal(blocked.calls.write, 0)
  assert.equal(blocked.calls.auth, 0)
})

test('a signed-in driver on Vercel without a cron signal still gets earnings', async () => {
  const result = await invoke({
    env: { VERCEL: '1' },
    headers: { 'user-agent': 'Mozilla/5.0' },
    user: { id: 'd_1' },
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.error, undefined)
  assert.equal(result.calls.attempt, 0)
  assert.equal(result.calls.auth, 0)
  assert.equal(result.queries, 1)
  assert.equal(typeof result.body.paidCents, 'number')
})
