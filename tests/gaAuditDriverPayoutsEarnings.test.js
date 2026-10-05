import test from 'node:test'
import assert from 'node:assert/strict'
import driverEarningsHandler, { resolveUser } from '../server/endpoints/driverEarnings.js'
import driverPayoutsHandler, { cronAuthorized, isVercelCron, runDuePayouts } from '../server/endpoints/driverPayouts.js'
import driverApiHandler from '../api/driver.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    headersSent: false,
    body: '',
    setHeader(name, value) {
      if (this.headersSent) {
        throw new Error('ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent')
      }
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      if (this.writableEnded) {
        throw new Error('ERR_STREAM_WRITE_AFTER_END: write after end')
      }
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function parseJson(res) {
  try {
    return JSON.parse(res.body || '{}')
  } catch {
    return null
  }
}

test('GA95: driverEarnings resolveUser handles Bearer token parsing and dependency injection', async () => {
  // Direct user injection
  const direct = await resolveUser({ headers: {} }, null, { user: { id: 'u_direct' } })
  assert.equal(direct.id, 'u_direct')

  // Missing or empty header
  assert.equal(await resolveUser({ headers: {} }, null), null)
  assert.equal(await resolveUser({ headers: { authorization: 'Basic 123' } }, null), null)

  // Auth failure from Supabase
  const mockSbFail = {
    auth: {
      getUser: async (token) => {
        assert.equal(token, 'bad_token')
        return { data: null, error: new Error('Invalid token') }
      },
    },
  }
  const failed = await resolveUser({ headers: { authorization: 'Bearer bad_token' } }, mockSbFail)
  assert.equal(failed, null)

  // Auth success
  const mockSbSuccess = {
    auth: {
      getUser: async (token) => {
        assert.equal(token, 'good_token')
        return { data: { user: { id: 'u_authed', email: 'driver@clemson.edu' } }, error: null }
      },
    },
  }
  const authed = await resolveUser({ headers: { Authorization: 'Bearer good_token' } }, mockSbSuccess)
  assert.equal(authed.id, 'u_authed')
})

test('GA95: driverEarnings rejects non-GET methods with 405 and proper Allow/Cache-Control headers', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const req = { method, headers: {} }
    const res = mockRes()
    await driverEarningsHandler(req, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.headers['allow'], 'GET, OPTIONS')
    assert.match(res.headers['cache-control'], /no-store/)
    const body = parseJson(res)
    assert.equal(body.error, 'Method not allowed')
  }
})

test('GA95: driverEarnings returns 503 if Supabase service role key is unconfigured', async () => {
  const req = { method: 'GET', headers: {} }
  const res = mockRes()
  await driverEarningsHandler(req, res, { sb: null })
  assert.equal(res.statusCode, 503)
  assert.match(res.headers['cache-control'], /no-store/)
  assert.equal(parseJson(res).error, 'SUPABASE_SERVICE_ROLE_KEY not configured')
})

test('GA95: driverEarnings returns 401 if user is unauthenticated', async () => {
  const req = { method: 'GET', headers: {} }
  const res = mockRes()
  const mockSb = { auth: { getUser: async () => ({ data: null, error: null }) } }
  await driverEarningsHandler(req, res, { sb: mockSb, user: null })
  assert.equal(res.statusCode, 401)
  assert.equal(parseJson(res).error, 'Sign in required')
})

test('GA95: driverEarnings handles database error on trips query', async () => {
  const req = { method: 'GET', headers: {} }
  const res = mockRes()
  const mockSb = {
    from: (table) => {
      assert.equal(table, 'trips')
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: null, error: { message: 'Database connection failed' } }),
              }),
            }),
          }),
        }),
      }
    },
  }
  await driverEarningsHandler(req, res, { sb: mockSb, user: { id: 'd_1' } })
  assert.equal(res.statusCode, 500)
  assert.equal(parseJson(res).error, 'Database connection failed')
})

test('GA95: driverEarnings returns empty maps when driver has no completed trips', async () => {
  const req = { method: 'GET', headers: {} }
  const res = mockRes()
  const mockSb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  }
  await driverEarningsHandler(req, res, { sb: mockSb, user: { id: 'd_1' } })
  assert.equal(res.statusCode, 200)
  const body = parseJson(res)
  assert.deepEqual(body.paymentsByTrip, {})
  assert.deepEqual(body.billsByTrip, {})
})

test('GA95: driverEarnings aggregates payments and ride bills across trips', async () => {
  const req = { method: 'GET', headers: {} }
  const res = mockRes()
  const mockSb = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: 't_1' }, { id: 't_2' }],
                error: null,
              }),
            }),
          }),
        }),
        in: async (col, ids) => {
          assert.equal(col, 'trip_id')
          assert.deepEqual(ids, ['t_1', 't_2'])
          if (table === 'payments') {
            return {
              data: [
                { trip_id: 't_1', kind: 'rider_fare', amount_cents: 4500, status: 'succeeded' },
                { trip_id: 't_1', kind: 'tip', amount_cents: 500, status: 'succeeded' },
                { trip_id: 't_2', kind: 'rider_fare', amount_cents: 6000, status: 'succeeded' },
              ],
              error: null,
            }
          }
          if (table === 'ride_bills') {
            return {
              data: [
                {
                  trip_id: 't_1',
                  base_cents: 1000,
                  distance_cents: 2500,
                  time_cents: 1000,
                  surge_cents: 500,
                  distance_m: 16090,
                  duration_s: 1200,
                },
                {
                  trip_id: 't_2',
                  base_cents: 1500,
                  distance_cents: 3500,
                  time_cents: 1000,
                  surge_cents: 0,
                  distance_m: 24140,
                  duration_s: 1800,
                },
              ],
              error: null,
            }
          }
          throw new Error('Unknown table: ' + table)
        },
      }),
    }),
  }

  await driverEarningsHandler(req, res, { sb: mockSb, user: { id: 'd_1' } })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['cache-control'], /no-store/)
  const body = parseJson(res)
  assert.equal(body.paymentsByTrip['t_1'].length, 2)
  assert.equal(body.paymentsByTrip['t_1'][0].amountCents, 4500)
  assert.equal(body.paymentsByTrip['t_1'][1].amountCents, 500)
  assert.equal(body.paymentsByTrip['t_2'].length, 1)

  assert.equal(body.billsByTrip['t_1'].baseCents, 1000)
  assert.equal(body.billsByTrip['t_1'].distanceCents, 2500)
  assert.equal(body.billsByTrip['t_1'].surgeCents, 500)
  assert.equal(body.billsByTrip['t_1'].distanceM, 16090)
  assert.equal(body.billsByTrip['t_1'].durationS, 1200)

  assert.equal(body.billsByTrip['t_2'].baseCents, 1500)
  assert.equal(body.billsByTrip['t_2'].surgeCents, 0)
})

test('GA95: cronAuthorized validates secret hygiene, case-insensitivity, and bearer stripping', () => {
  // Missing or placeholder secret
  assert.equal(cronAuthorized({ headers: {} }, ''), false)
  assert.equal(cronAuthorized({ headers: { authorization: 'Bearer test' } }, 'placeholder_key'), false)

  // Matching with whitespace trimming
  assert.equal(cronAuthorized({ headers: { authorization: 'Bearer secret123 ' } }, ' secret123 \n'), true)
  assert.equal(cronAuthorized({ headers: { Authorization: 'bearer secret123' } }, 'secret123'), true)
  assert.equal(cronAuthorized({ headers: { AUTHORIZATION: 'Bearer secret123' } }, 'secret123'), true)
  assert.equal(cronAuthorized({ headers: { authorization: 'Bearer wrong' } }, 'secret123'), false)
})

test('GA95: isVercelCron detects various header representations', () => {
  assert.equal(isVercelCron({ headers: { 'x-vercel-cron': '1' } }), true)
  assert.equal(isVercelCron({ headers: { 'X-Vercel-Cron': 'true' } }), true)
  assert.equal(isVercelCron({ headers: { 'X-VERCEL-CRON': '1' } }), true)
  assert.equal(isVercelCron({ headers: {} }), false)
})

test('GA95: driverPayouts rejects invalid HTTP methods with 405 and Allow/Cache-Control', async () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const req = { method, headers: {} }
    const res = mockRes()
    await driverPayoutsHandler(req, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.headers['allow'], 'GET, POST, OPTIONS')
    assert.match(res.headers['cache-control'], /no-store/)
    assert.equal(parseJson(res).error, 'Method not allowed')
  }
})

test('GA95: driverPayouts handles Vercel cron skips when unauthenticated', async () => {
  const req = { method: 'POST', headers: { 'x-vercel-cron': '1' } }
  const res = mockRes()
  // VERCEL is set on Vercel. Off Vercel a spoofed x-vercel-cron header is ignored.
  await driverPayoutsHandler(req, res, { sb: {}, cronSecret: 'cron_pw_123', env: { VERCEL: '1' } })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['cache-control'], /no-store/)
  const body = parseJson(res)
  assert.equal(body.skipped, true)
  assert.match(body.reason, /Set CRON_SECRET/)
})

test('GA95: driverPayouts executes due payouts on authorized cron', async () => {
  const req = {
    method: 'POST',
    headers: {
      'x-vercel-cron': '1',
      authorization: 'Bearer valid_cron_secret',
    },
  }
  const res = mockRes()
  const mockTrips = [
    {
      id: 'trip_p1',
      driver_id: 'd_1',
      fare_cents: 5000,
      status: 'completed',
      metadata: {
        payout: { status: 'failed', nextRetryAt: Date.now() - 10000, attempts: 1 },
      },
    },
  ]
  const mockSb = {
    from: (table) => {
      assert.equal(table, 'trips')
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async (lim) => {
                assert.equal(lim, 80)
                return { data: mockTrips, error: null }
              },
            }),
          }),
        }),
      }
    },
  }

  let attempted = false
  let written = false
  await driverPayoutsHandler(req, res, {
    sb: mockSb,
    cronSecret: 'valid_cron_secret',
    loadConnectAccount: async () => 'acct_connect_1',
    attemptDriverPayout: async () => {
      attempted = true
      return { ok: true, payout: { status: 'paid', attempts: 2 } }
    },
    writePayout: async () => {
      written = true
    },
  })

  assert.equal(res.statusCode, 200)
  assert.equal(attempted, true)
  assert.equal(written, true)
  const body = parseJson(res)
  assert.equal(body.ok, true)
  assert.equal(body.results.length, 1)
  assert.equal(body.results[0].status, 'paid')
})

test('GA95: driverPayouts returns summary for signed-in driver GET request', async () => {
  const req = { method: 'GET', headers: {} }
  const res = mockRes()
  const mockTrips = [
    {
      id: 't_c1',
      driver_id: 'd_auth',
      fare_cents: 6000,
      status: 'completed',
      metadata: { payout: { status: 'paid', amountCents: 4800 } },
    },
  ]
  const mockSb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: mockTrips, error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  await driverPayoutsHandler(req, res, {
    sb: mockSb,
    user: { id: 'd_auth' },
  })

  assert.equal(res.statusCode, 200)
  assert.match(res.headers['cache-control'], /no-store/)
  const body = parseJson(res)
  assert.equal(body.paidCents, 4800)
  assert.equal(body.pendingCents, 0)
  assert.deepEqual(body.pending, [])
})

test('GA95: driverPayouts triggers manual retry on driver POST request', async () => {
  const req = { method: 'POST', headers: {} }
  const res = mockRes()
  const mockTrips = [
    {
      id: 't_retry',
      driver_id: 'd_auth',
      fare_cents: 5000,
      status: 'completed',
      metadata: { payout: { status: 'failed', nextRetryAt: Date.now() - 5000, attempts: 1 } },
    },
  ]
  const mockSb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: mockTrips, error: null }),
            }),
          }),
        }),
      }),
    }),
  }

  let attemptCalled = false
  await driverPayoutsHandler(req, res, {
    sb: mockSb,
    user: { id: 'd_auth' },
    loadConnectAccount: async () => 'acct_123',
    attemptDriverPayout: async () => {
      attemptCalled = true
      return { ok: true, payout: { status: 'paid', attempts: 2 } }
    },
    writePayout: async () => {},
  })

  assert.equal(res.statusCode, 200)
  assert.equal(attemptCalled, true)
  const body = parseJson(res)
  assert.equal(body.results.length, 1)
  assert.equal(body.results[0].tripId, 't_retry')
  assert.equal(body.results[0].status, 'paid')
})

test('GA95: driver API router dispatches earnings and payouts actions forwarding dependencies', async () => {
  // Test earnings dispatch
  const earningsReq = { method: 'GET', url: '/api/driver?action=earnings', headers: {} }
  const earningsRes = mockRes()
  let earningsCalled = false
  const mockEarningsSb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: async () => {
                earningsCalled = true
                return { data: [], error: null }
              },
            }),
          }),
        }),
      }),
    }),
  }
  await driverApiHandler(earningsReq, earningsRes, {
    sb: mockEarningsSb,
    user: { id: 'd_router' },
  })
  assert.equal(earningsRes.statusCode, 200)
  assert.equal(earningsCalled, true)

  // Test payouts dispatch
  const payoutsReq = { method: 'GET', url: '/api/driver?action=payouts', headers: {} }
  const payoutsRes = mockRes()
  let payoutsCalled = false
  const mockPayoutsSb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => {
                payoutsCalled = true
                return { data: [], error: null }
              },
            }),
          }),
        }),
      }),
    }),
  }
  await driverApiHandler(payoutsReq, payoutsRes, {
    sb: mockPayoutsSb,
    user: { id: 'd_router' },
  })
  assert.equal(payoutsRes.statusCode, 200)
  assert.equal(payoutsCalled, true)

  // Test unknown driver action
  const badReq = { method: 'GET', url: '/api/driver?action=unknown_action', headers: {} }
  const badRes = mockRes()
  await driverApiHandler(badReq, badRes)
  assert.equal(badRes.statusCode, 400)
  assert.match(parseJson(badRes).error, /Unknown driver action/)
})
