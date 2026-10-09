import test from 'node:test'
import assert from 'node:assert/strict'
import carpoolApiHandler from '../api/carpool.js'
import {
  handleCarpoolMatch,
  handleCarpoolGroup,
  handleCarpoolAttribute,
  handleCarpoolProgram,
} from '../server/carpoolRoutes.js'
import {
  gameDayActive,
  eligibleFirstRideIds,
  settleCarpoolSideEffects,
} from '../server/carpoolSettle.js'

function mockRes() {
  return {
    statusCode: 200,
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
      if (chunk) this.body += String(chunk)
      return this
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

test('gameDayActive: verifies date range checking, active flag, and error handling', async () => {
  // 1. Null supabase client returns false
  assert.equal(await gameDayActive(null), false)

  // 2. Active game day event covering target time
  const testDate = new Date('2026-10-10T18:00:00.000Z')
  const sbActive = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          lte: () => ({
            gte: () => ({
              limit: async () => ({
                data: [{ id: 'gd-1' }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }
  assert.equal(await gameDayActive(sbActive, testDate), true)

  // 3. No events found
  const sbEmpty = {
    from: () => ({
      select: () => ({
        eq: () => ({
          lte: () => ({
            gte: () => ({
              limit: async () => ({
                data: [],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }
  assert.equal(await gameDayActive(sbEmpty, testDate), false)

  // 4. Database error
  const sbError = {
    from: () => ({
      select: () => ({
        eq: () => ({
          lte: () => ({
            gte: () => ({
              limit: async () => ({
                data: null,
                error: { message: 'DB connection error' },
              }),
            }),
          }),
        }),
      }),
    }),
  }
  assert.equal(await gameDayActive(sbError, testDate), false)
})

test('eligibleFirstRideIds: enforces window open, grant deduping, completed trips, and schema tolerance', async () => {
  // Null sb returns empty
  assert.deepEqual(await eligibleFirstRideIds(null, [{ id: 'p1', user_id: 'u1' }]), [])

  // Tuesday noon (off-peak, window closed without game day)
  const offPeak = new Date('2026-09-22T16:00:00.000Z')
  const sb = { from: () => ({}) }
  assert.deepEqual(await eligibleFirstRideIds(sb, [{ id: 'p1', user_id: 'u1' }], offPeak, { gameDay: false }), [])

  // Saturday game day: window is open
  const gameDayTime = new Date('2026-09-26T18:00:00.000Z')

  // Case A: Participant already has a first_ride_grant
  const sbHasGrant = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { user_id: 'u_granted' }, error: null }),
        }),
      }),
    }),
  }
  const resGrant = await eligibleFirstRideIds(
    sbHasGrant,
    [{ id: 'p_granted', user_id: 'u_granted' }],
    gameDayTime,
    { gameDay: true },
  )
  assert.deepEqual(resGrant, [])

  // Case B: Participant already has a grant by normalized email
  const sbGrantEmail = {
    from: (table) => ({
      select: () => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            if (col === 'email_norm') return { data: { user_id: 'other_u' }, error: null }
            return { data: null, error: null }
          },
        }),
      }),
    }),
  }
  const resEmail = await eligibleFirstRideIds(
    sbGrantEmail,
    [{ id: 'p_email', user_id: 'u_clean', email: 'Test@Clemson.edu' }],
    gameDayTime,
    { gameDay: true },
  )
  assert.deepEqual(resEmail, [])

  // Case C: Participant has completed prior trips
  const sbHasTrips = {
    from: (table) => {
      if (table === 'first_ride_grants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'trips') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: 2, error: null }),
            }),
          }),
        }
      }
      return {}
    },
  }
  const resTrips = await eligibleFirstRideIds(
    sbHasTrips,
    [{ id: 'p_trips', user_id: 'u_veteran' }],
    gameDayTime,
    { gameDay: true },
  )
  assert.deepEqual(resTrips, [])

  // Case D: Eligible first-time participant
  const sbClean = {
    from: (table) => {
      if (table === 'first_ride_grants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'trips') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: 0, error: null }),
            }),
          }),
        }
      }
      return {}
    },
  }
  const resClean = await eligibleFirstRideIds(
    sbClean,
    [{ id: 'p_first', user_id: 'u_rookie', email: 'rookie@clemson.edu' }],
    gameDayTime,
    { gameDay: true },
  )
  assert.deepEqual(resClean, ['p_first'])

  // Case E: Schema missing table returns empty array
  const sbNoSchema = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'relation "first_ride_grants" does not exist' } }),
        }),
      }),
    }),
  }
  const resNoSchema = await eligibleFirstRideIds(
    sbNoSchema,
    [{ id: 'p_err', user_id: 'u_err' }],
    gameDayTime,
    { gameDay: true },
  )
  assert.deepEqual(resNoSchema, [])
})

test('settleCarpoolSideEffects: creates first-ride grants and handles errors', async () => {
  // Skipped when no carpool quote exists
  const noQuote = await settleCarpoolSideEffects({}, { ride: {}, trip: { id: 't1' }, participants: [] })
  assert.equal(noQuote.ok, true)
  assert.equal(noQuote.skipped, true)

  // With first-ride free share
  let insertedGrant = null
  const sb = {
    from: (table) => ({
      insert: async (row) => {
        insertedGrant = { table, row }
        return { error: null }
      },
      upsert: () => ({
        select: async () => ({ data: [{ id: 'amb-1' }], error: null }),
      }),
    }),
  }

  const ride = {
    id: 'fr_1',
    fare_breakdown: {
      carpool: {
        shares: [{ id: 'p_free', firstRideFree: true }],
      },
      ambassador_code: 'AMB_CODE',
    },
  }
  const participants = [
    { id: 'p_free', user_id: 'u_free', email: 'Free@Clemson.edu' },
  ]
  const trip = { id: 't_free' }

  const res = await settleCarpoolSideEffects(sb, { ride, trip, participants })
  assert.equal(res.ok, true)
  assert.equal(res.results.firstRide, 'granted')
  assert.equal(res.results.ambassador, 'ledgered')
  assert.equal(insertedGrant.table, 'first_ride_grants')
  assert.equal(insertedGrant.row.user_id, 'u_free')
  assert.equal(insertedGrant.row.email_norm, 'free@clemson.edu')
  assert.equal(insertedGrant.row.friend_ride_id, 'fr_1')

  // When grant insert fails, reports error message in results.firstRide
  const sbInsertError = {
    from: (table) => ({
      insert: async () => ({ error: { message: 'Unique grant constraint violation' } }),
      upsert: () => ({
        select: async () => ({ data: [], error: null }),
      }),
    }),
  }
  const resError = await settleCarpoolSideEffects(sbInsertError, { ride, trip, participants })
  assert.equal(resError.ok, true)
  assert.equal(resError.results.firstRide, 'Unique grant constraint violation')
})

test('handleCarpoolMatch: validates HTTP method, auth, coordinates, and returns match result', async () => {
  // 1. Method not allowed
  const res405 = mockRes()
  await handleCarpoolMatch({ method: 'GET' }, res405, {})
  assert.equal(res405.statusCode, 405)

  // 2. Missing Supabase
  const res503 = mockRes()
  await handleCarpoolMatch({ method: 'POST' }, res503, { sb: null })
  assert.equal(res503.statusCode, 503)

  // 3. Unauthenticated
  const res401 = mockRes()
  await handleCarpoolMatch({ method: 'POST' }, res401, { sb: {}, user: null })
  assert.equal(res401.statusCode, 401)

  // 4. Missing pickup/dropoff coordinates
  const resBadCoords = mockRes()
  await handleCarpoolMatch(
    { method: 'POST', body: { pickup: {}, dropoff: { lat: 34.68 } } },
    resBadCoords,
    { sb: {}, user: { id: 'u1' } },
  )
  assert.equal(resBadCoords.statusCode, 400)
  assert.match(parseJson(resBadCoords).error, /pickup and dropoff with lat\/lng are required/i)
})

test('handleCarpoolGroup: enforces driver approval gate for driving option', async () => {
  // Method 405
  const res405 = mockRes()
  await handleCarpoolGroup({ method: 'GET' }, res405, {})
  assert.equal(res405.statusCode, 405)

  // Missing coords
  const resCoords = mockRes()
  await handleCarpoolGroup(
    { method: 'POST', body: { pickup: null, dropoff: null } },
    resCoords,
    { sb: {}, user: { id: 'u1' } },
  )
  assert.equal(resCoords.statusCode, 400)
})

test('handleCarpoolAttribute: validates HTTP method, saves attribution, and maps status codes', async () => {
  // Method 405
  const res405 = mockRes()
  await handleCarpoolAttribute({ method: 'GET' }, res405, {})
  assert.equal(res405.statusCode, 405)

  // Missing sb
  const res503 = mockRes()
  await handleCarpoolAttribute({ method: 'POST' }, res503, { sb: null })
  assert.equal(res503.statusCode, 503)

  // Unauth
  const res401 = mockRes()
  await handleCarpoolAttribute({ method: 'POST' }, res401, { sb: {}, user: null })
  assert.equal(res401.statusCode, 401)
})

test('handleCarpoolProgram: evaluates ambassador stats and first-ride program eligibility', async () => {
  // Method 405
  const res405 = mockRes()
  await handleCarpoolProgram({ method: 'GET' }, res405, {})
  assert.equal(res405.statusCode, 405)

  // Missing sb
  const res503 = mockRes()
  await handleCarpoolProgram({ method: 'POST' }, res503, { sb: null })
  assert.equal(res503.statusCode, 503)

  // Unauth
  const res401 = mockRes()
  await handleCarpoolProgram({ method: 'POST' }, res401, { sb: {}, user: null })
  assert.equal(res401.statusCode, 401)

  // First-ride program eligibility check
  const fakeSb = {
    from: (table) => {
      if (table === 'game_day_events') {
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                gte: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'first_ride_grants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'trips') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: 0, error: null }),
            }),
          }),
        }
      }
      return {}
    },
  }

  const resProgram = mockRes()
  await handleCarpoolProgram(
    { method: 'POST', body: { action: 'first_ride' } },
    resProgram,
    { sb: fakeSb, user: { id: 'u_prog', email: 'prog@clemson.edu' } },
  )
  assert.equal(resProgram.statusCode, 200)
  const body = parseJson(resProgram)
  assert.equal(body.ok, true)
  assert.equal(body.code_type, 'first_ride')
  assert.equal(typeof body.windowOpen, 'boolean')
  assert.equal(typeof body.eligible, 'boolean')
})

test('api/carpool: router routes actions and rejects unknown actions with 400', async () => {
  // Unknown action
  const resUnknown = mockRes()
  await carpoolApiHandler({ method: 'POST', url: '/api/carpool?action=invalid_mystery' }, resUnknown)
  assert.equal(resUnknown.statusCode, 400)
  assert.match(parseJson(resUnknown).error, /Unknown carpool action/i)

  // OPTIONS preflight
  const resOptions = mockRes()
  await carpoolApiHandler({ method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } }, resOptions)
  assert.equal(resOptions.statusCode, 204)
})

test('handleCarpoolProgram: ambassador action returns stats with referral link or 503 on schema failure', async () => {
  // 1. Success with code returns 200 with referral link
  const sbOk = {
    from: (table) => {
      if (table === 'ambassador_codes') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { code: 'TIGER123', code_type: 'ambassador', created_at: new Date().toISOString() },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'ambassador_payout_ledger') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [{ id: 'l1', amount_cents: 500, status: 'pending' }, { id: 'l2', amount_cents: 500, status: 'paid' }],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return {}
    },
  }

  const resOk = mockRes()
  await handleCarpoolProgram(
    { method: 'POST', body: { action: 'ambassador', origin: 'https://rides.clemson.edu' } },
    resOk,
    { sb: sbOk, user: { id: 'u_amb' } },
  )
  assert.equal(resOk.statusCode, 200)
  const bodyOk = parseJson(resOk)
  assert.equal(bodyOk.ok, true)
  assert.equal(bodyOk.code, 'TIGER123')
  assert.equal(bodyOk.link, 'https://rides.clemson.edu/a/TIGER123')
  assert.equal(bodyOk.pendingCents, 500)
  assert.equal(bodyOk.paidCents, 500)

  // 2. Schema missing returns 503
  const sbMissing = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: 'relation "ambassador_codes" does not exist' },
          }),
        }),
      }),
    }),
  }
  const resMissing = mockRes()
  await handleCarpoolProgram(
    { method: 'POST', body: { action: 'ambassador' } },
    resMissing,
    { sb: sbMissing, user: { id: 'u_amb' } },
  )
  assert.equal(resMissing.statusCode, 503)
  assert.equal(parseJson(resMissing).code, 'schema_missing')
})

test('handleCarpoolAttribute: status code matrix for own link (409), schema missing (503), inactive (404), and errors', async () => {
  // 1. Own link -> 409
  const sbOwn = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { profile_id: 'u_attr', code: 'MY_CODE', code_type: 'ambassador' },
            error: null,
          }),
        }),
      }),
    }),
  }
  const resOwn = mockRes()
  await handleCarpoolAttribute(
    { method: 'POST', body: { code: 'MY_CODE' } },
    resOwn,
    { sb: sbOwn, user: { id: 'u_attr' } },
  )
  assert.equal(resOwn.statusCode, 409)
  assert.equal(parseJson(resOwn).code, 'own_link')

  // 2. Schema missing -> 503
  const sbMissing = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: 'relation "ambassador_codes" does not exist' },
          }),
        }),
      }),
    }),
  }
  const resMissing = mockRes()
  await handleCarpoolAttribute(
    { method: 'POST', body: { code: 'SOME_CODE' } },
    resMissing,
    { sb: sbMissing, user: { id: 'u_attr' } },
  )
  assert.equal(resMissing.statusCode, 503)
  assert.equal(parseJson(resMissing).code, 'schema_missing')

  // 3. Inactive code -> 404
  const sbInactive = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }
  const resInactive = mockRes()
  await handleCarpoolAttribute(
    { method: 'POST', body: { code: 'UNKNOWN_CODE' } },
    resInactive,
    { sb: sbInactive, user: { id: 'u_attr' } },
  )
  assert.equal(resInactive.statusCode, 404)
  assert.match(parseJson(resInactive).error, /not active/i)
})

test('handleCarpoolGroup: rejects unapproved driver attempting driving carpool with 403', async () => {
  const sbUnapproved = {
    from: (table) => {
      if (table === 'driver_applications') {
        return {
          select: () => ({
            in: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      return {}
    },
  }

  const resUnapproved = mockRes()
  await handleCarpoolGroup(
    {
      method: 'POST',
      body: {
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: { lat: 34.69, lng: -82.84 },
        driving: true,
      },
    },
    resUnapproved,
    { sb: sbUnapproved, user: { id: 'd_unapproved' } },
  )
  assert.equal(resUnapproved.statusCode, 403)
  const body = parseJson(resUnapproved)
  assert.equal(body.code, 'driver_not_approved')
  assert.match(body.error, /Admin must approve your driver application/)
})

