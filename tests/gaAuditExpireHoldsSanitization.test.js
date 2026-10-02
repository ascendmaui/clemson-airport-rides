import assert from 'node:assert/strict'
import test from 'node:test'
import handler, {
  holdTtlCronAuthorized,
  MIN_UNPAID_HOLD_TTL_MS,
  MAX_UNPAID_HOLD_TTL_MS,
  parseHoldSweepLimit,
  parseHoldSweepTtlMs,
  sanitizeHoldResults,
} from '../server/endpoints/expireUnpaidAirportHolds.js'

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(key, val) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT')
      this.headers[key.toLowerCase()] = val
    },
    end(chunk) {
      if (this.writableEnded) throw new Error('ERR_STREAM_ALREADY_ENDED')
      this.writableEnded = true
      this.headersSent = true
      if (chunk) this.body += chunk
      return this
    },
  }
}

test('GA93: parseHoldSweepLimit parses and clamps sweep limit strictly between 1 and 40', () => {
  assert.equal(parseHoldSweepLimit({ query: { limit: '10' } }), 10)
  assert.equal(parseHoldSweepLimit({ query: { limit: '100' } }), 40, 'Capped at 40 max')
  assert.equal(parseHoldSweepLimit({ query: { limit: '-5' } }), 40, 'Negative falls back to default 40')
  assert.equal(parseHoldSweepLimit({ query: { limit: '0' } }), 40, 'Zero falls back to default 40')
  assert.equal(parseHoldSweepLimit({ query: { limit: 'invalid' } }), 40, 'Invalid string falls back to default 40')
  assert.equal(parseHoldSweepLimit({ url: '/api/expire-unpaid-airport-holds?limit=25' }), 25)
  assert.equal(parseHoldSweepLimit({}), 40)
})

test('GA93: parseHoldSweepTtlMs enforces safety floor (15m) and safety ceiling (7d) on custom TTL', () => {
  // Floor clamping: 5 mins must be clamped up to 15 mins (MIN_UNPAID_HOLD_TTL_MS)
  const fiveMinMs = 5 * 60 * 1000
  assert.equal(
    parseHoldSweepTtlMs({ query: { ttl_ms: fiveMinMs } }),
    MIN_UNPAID_HOLD_TTL_MS,
    'Clamped to safety floor',
  )

  // Ceiling clamping: 30 days must be clamped down to 7 days (MAX_UNPAID_HOLD_TTL_MS)
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  assert.equal(
    parseHoldSweepTtlMs({ query: { ttl_ms: thirtyDaysMs } }),
    MAX_UNPAID_HOLD_TTL_MS,
    'Clamped to safety ceiling',
  )

  // Seconds parameter support
  assert.equal(
    parseHoldSweepTtlMs({ query: { ttl_seconds: 1800 } }), // 30 minutes
    1800 * 1000,
  )

  // Missing or negative
  assert.equal(parseHoldSweepTtlMs({ query: {} }), undefined)
  assert.equal(parseHoldSweepTtlMs({ query: { ttl_ms: -100 } }), undefined)
})

test('GA93: sanitizeHoldResults truncates and strips database error details', () => {
  const rawResults = [
    { tripId: 'trip_1', released: true },
    {
      tripId: 'trip_2',
      released: false,
      error: 'duplicate key value violates unique constraint "trips_pkey"\nDETAIL: Key (id)=(trip_2) already exists in table public.trips.',
    },
  ]
  const sanitized = sanitizeHoldResults(rawResults)
  assert.equal(sanitized[0].released, true)
  assert.equal(
    sanitized[1].error,
    'duplicate key value violates unique constraint "trips_pkey"',
    'Database multiline detail is stripped',
  )
})

test('GA93: holdTtlCronAuthorized handles quoted bearer tokens and trims whitespace', () => {
  const env = { CRON_SECRET: 'super-secret-cron-token' }
  const reqQuoted = {
    headers: { authorization: 'Bearer "super-secret-cron-token"' },
  }
  assert.equal(holdTtlCronAuthorized(reqQuoted, env), true)

  const reqSingleQuoted = {
    headers: { authorization: "Bearer 'super-secret-cron-token'" },
  }
  assert.equal(holdTtlCronAuthorized(reqSingleQuoted, env), true)
})

test('GA93: handler passes parsed limit and ttlMs to release runner and returns sanitized results', async () => {
  const req = {
    method: 'POST',
    url: '/api/expire-unpaid-airport-holds?limit=15&ttl_seconds=1200',
    headers: { authorization: 'Bearer test-secret' },
  }
  const res = mockRes()

  let receivedOptions = null
  const overrides = {
    env: { CRON_SECRET: 'test-secret' },
    sb: {},
    release: async (sb, options) => {
      receivedOptions = options
      return {
        ok: true,
        scanned: 1,
        expired: 1,
        released: 1,
        skipped: 0,
        errors: 0,
        wouldExpire: 0,
        dryRun: false,
        results: [{ tripId: 't1', released: true }],
      }
    },
  }

  await handler(req, res, overrides)
  assert.equal(res.statusCode, 200)
  assert.equal(receivedOptions.limit, 15)
  assert.equal(receivedOptions.ttlMs, 1200 * 1000)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.released, 1)
})
