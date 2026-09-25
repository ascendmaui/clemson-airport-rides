import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { DEFAULT_API_BASE } from '../apiOrigin.js'
import { GENERIC_ERROR_COPY, UNAVAILABLE_COPY } from '../apiErrors.js'
import {
  setCarpoolApiBase,
  apiBase,
  inviteUrl,
  apiErrorMessage,
  matchCarpool,
  createCarpoolGroup,
  claimAmbassadorAttribution,
  carpoolProgram,
  createCarpoolOffer,
  getFriendRide,
  joinFriendRide,
  recomputeFriendRide,
  confirmFriendCharges,
} from './carpoolApi.js'

let originalFetch

beforeEach(() => {
  originalFetch = globalThis.fetch
  setCarpoolApiBase('')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setCarpoolApiBase('')
})

function stubFetch({ status = 200, ok = true, json = {}, text, error } = {}) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (error) {
      throw error
    }
    const responseText = text !== undefined ? text : JSON.stringify(json)
    return {
      status,
      ok: ok ?? (status >= 200 && status < 300),
      async text() {
        return responseText
      },
    }
  }
  return calls
}

function fakeSupabase(token = 'test-bearer-token-123') {
  return {
    auth: {
      async getSession() {
        return token
          ? { data: { session: { access_token: token } } }
          : { data: { session: null } }
      },
    },
  }
}

test('setCarpoolApiBase / apiBase: defaults, strips trailing slash, and resets override', () => {
  // DEFAULT_API_BASE is WEB_ORIGIN from shared/productLinks.js, via apiOrigin.js.
  assert.equal(DEFAULT_API_BASE, 'https://clemson-rides.vercel.app')
  assert.equal(apiBase(), DEFAULT_API_BASE)

  setCarpoolApiBase('https://preview.clemson-rides.vercel.app/')
  assert.equal(apiBase(), 'https://preview.clemson-rides.vercel.app')

  setCarpoolApiBase('http://localhost:3000')
  assert.equal(apiBase(), 'http://localhost:3000')

  // Robustness fix: strips multiple trailing slashes cleanly
  setCarpoolApiBase('https://custom-host.com//')
  assert.equal(apiBase(), 'https://custom-host.com')
  setCarpoolApiBase('https://custom-host.com///')
  assert.equal(apiBase(), 'https://custom-host.com')

  // Override reset via empty string, null, and undefined
  setCarpoolApiBase('')
  assert.equal(apiBase(), DEFAULT_API_BASE)

  setCarpoolApiBase('https://staging.clemson-airport-rides.com')
  assert.equal(apiBase(), 'https://staging.clemson-airport-rides.com')
  setCarpoolApiBase(null)
  assert.equal(apiBase(), DEFAULT_API_BASE)

  setCarpoolApiBase('https://staging.clemson-airport-rides.com')
  assert.equal(apiBase(), 'https://staging.clemson-airport-rides.com')
  setCarpoolApiBase(undefined)
  assert.equal(apiBase(), DEFAULT_API_BASE)
})

test('inviteUrl: formats carpool vs friend links, encodes token, and handles unknown kinds', () => {
  assert.equal(
    inviteUrl('abc123xyz'),
    `${DEFAULT_API_BASE}/carpool/abc123xyz`,
  )
  assert.equal(
    inviteUrl('abc123xyz', 'carpool'),
    `${DEFAULT_API_BASE}/carpool/abc123xyz`,
  )
  assert.equal(
    inviteUrl('abc123xyz', 'friends'),
    `${DEFAULT_API_BASE}/friends/abc123xyz`,
  )

  // URI encoding for special characters
  assert.equal(
    inviteUrl('tok/en?with space#hash', 'friends'),
    `${DEFAULT_API_BASE}/friends/tok%2Fen%3Fwith%20space%23hash`,
  )

  // Respects custom apiBase override
  setCarpoolApiBase('http://localhost:3000/')
  assert.equal(
    inviteUrl('tok123', 'friends'),
    'http://localhost:3000/friends/tok123',
  )
  setCarpoolApiBase('')

  // BUG?: inviteUrl only branches on kind === 'friends', so any other kind (e.g. 'tailgate') defaults to 'carpool'
  assert.equal(
    inviteUrl('tok123', 'tailgate'),
    `${DEFAULT_API_BASE}/carpool/tok123`,
  )
})

test('apiErrorMessage: resolves message from Error, payload.message, payload.error, strings, and empty fallbacks', () => {
  // Error instances
  assert.equal(apiErrorMessage(new Error('Connection timed out')), 'Connection timed out')
  assert.equal(apiErrorMessage(new Error('')), 'Something went wrong')

  // BUG?: apiErrorMessage('plain error string') returns 'Something went wrong' because it checks err instanceof Error and err?.payload, ignoring typeof err === 'string'
  assert.equal(apiErrorMessage('plain error string'), 'Something went wrong')

  // BUG?: apiErrorMessage({ message: 'plain obj' }) returns 'Something went wrong' because it is not an instance of Error and has no payload wrapper
  assert.equal(apiErrorMessage({ message: 'plain obj' }), 'Something went wrong')

  // Empty / falsy / non-error values
  assert.equal(apiErrorMessage(null), 'Something went wrong')
  assert.equal(apiErrorMessage(undefined), 'Something went wrong')
  assert.equal(apiErrorMessage(''), 'Something went wrong')
  assert.equal(apiErrorMessage(0), 'Something went wrong')
  assert.equal(apiErrorMessage(false), 'Something went wrong')
  assert.equal(apiErrorMessage({}), 'Something went wrong')

  // Payload error shapes
  assert.equal(
    apiErrorMessage({ payload: { message: 'Carpool seat is full' } }),
    'Carpool seat is full',
  )
  assert.equal(
    apiErrorMessage({ payload: { error: 'Invalid invite token' } }),
    'Invalid invite token',
  )
  assert.equal(
    apiErrorMessage({ payload: { message: 'Message takes precedence', error: 'Ignored error' } }),
    'Message takes precedence',
  )
  assert.equal(
    apiErrorMessage({ payload: { message: '', error: 'Fallback to error field' } }),
    'Fallback to error field',
  )
  assert.equal(
    apiErrorMessage({ payload: { message: 123, error: false } }),
    'Something went wrong',
  )

  // Error instance with payload
  const errWithPayloadMsg = Object.assign(new Error('Outer error message'), {
    payload: { message: 'Payload specific message' },
  })
  assert.equal(apiErrorMessage(errWithPayloadMsg), 'Payload specific message')

  const errWithPayloadErr = Object.assign(new Error('Outer error message'), {
    payload: { error: 'Payload specific error' },
  })
  assert.equal(apiErrorMessage(errWithPayloadErr), 'Payload specific error')

  const errWithEmptyPayload = Object.assign(new Error('Outer error message'), {
    payload: {},
  })
  assert.equal(apiErrorMessage(errWithEmptyPayload), 'Outer error message')
})

test('matchCarpool: asserts POST method, path, session bearer, JSON body, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, matchId: 'm-101', status: 'matched' },
  })
  const supabase = fakeSupabase('bearer-match-123')

  const res = await matchCarpool(supabase, {
    pickup: 'Clemson Campus',
    dropoff: 'GSP Airport',
    displayName: 'Alex Rider',
    partyType: 'tailgate',
    departAt: '2026-09-25T14:00:00Z',
    ambassadorCode: 'amb_tiger1',
  })

  assert.deepEqual(res, { ok: true, matchId: 'm-101', status: 'matched' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/carpool?action=match`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].options.headers.Accept, 'application/json')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-match-123')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    pickup: 'Clemson Campus',
    dropoff: 'GSP Airport',
    displayName: 'Alex Rider',
    partyType: 'tailgate',
    departAt: '2026-09-25T14:00:00Z',
    ambassadorCode: 'amb_tiger1',
  })

  // Defaults partyType to 'carpool' and omits falsy departAt and ambassadorCode
  const calls2 = stubFetch({ status: 200, json: { ok: true } })
  await matchCarpool(fakeSupabase(), {
    pickup: 'Clemson',
    dropoff: 'Greenville',
    displayName: 'Sam',
  })
  assert.deepEqual(JSON.parse(calls2[0].options.body), {
    pickup: 'Clemson',
    dropoff: 'Greenville',
    displayName: 'Sam',
    partyType: 'carpool',
  })

  // Without auth session: Authorization header omitted
  const callsNoAuth = stubFetch({ status: 200, json: { ok: true } })
  await matchCarpool(fakeSupabase(null), {
    pickup: 'Clemson',
    dropoff: 'GSP',
    displayName: 'Guest',
  })
  assert.equal(callsNoAuth[0].options.headers.Authorization, undefined)

  // With null supabase client: Authorization header omitted
  const callsNullSupabase = stubFetch({ status: 200, json: { ok: true } })
  await matchCarpool(null, {
    pickup: 'Clemson',
    dropoff: 'GSP',
    displayName: 'Guest',
  })
  assert.equal(callsNullSupabase[0].options.headers.Authorization, undefined)
})

test('createCarpoolGroup: asserts POST method, path, session bearer, JSON body, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, groupId: 'grp-202' },
  })
  const supabase = fakeSupabase('bearer-group-234')

  // BUG?: createCarpoolGroup hardcodes driving: false, ignoring driving: true if passed on body
  const res = await createCarpoolGroup(supabase, {
    pickup: 'Grand Marc',
    dropoff: 'Memorial Stadium',
    displayName: 'Jordan',
    partyType: 'tailgate',
    driving: true,
    ambassadorCode: 'amb_clemson',
  })

  assert.deepEqual(res, { ok: true, groupId: 'grp-202' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/carpool?action=group`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-group-234')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    pickup: 'Grand Marc',
    dropoff: 'Memorial Stadium',
    displayName: 'Jordan',
    partyType: 'tailgate',
    driving: false,
    ambassadorCode: 'amb_clemson',
  })

  // Defaults partyType to 'carpool' when not 'tailgate'
  const callsDefault = stubFetch({ status: 200, json: { ok: true } })
  await createCarpoolGroup(supabase, {
    pickup: 'Downtown',
    dropoff: 'GSP',
    displayName: 'Casey',
    partyType: 'regular',
  })
  assert.equal(JSON.parse(callsDefault[0].options.body).partyType, 'carpool')
})

test('claimAmbassadorAttribution: asserts POST method, path, session bearer, JSON body, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, code: 'amb_tiger99' },
  })
  const supabase = fakeSupabase('bearer-attr-345')

  const res = await claimAmbassadorAttribution(supabase, 'amb_tiger99')

  assert.deepEqual(res, { ok: true, code: 'amb_tiger99' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/carpool?action=attribute`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-attr-345')
  assert.deepEqual(JSON.parse(calls[0].options.body), { code: 'amb_tiger99' })
})

test('carpoolProgram: asserts POST method, path, session bearer, origin from apiBase, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, program: { active: true } },
  })
  const supabase = fakeSupabase('bearer-prog-456')

  const res = await carpoolProgram(supabase, 'status')

  assert.deepEqual(res, { ok: true, program: { active: true } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/carpool?action=program`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-prog-456')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: 'status',
    origin: DEFAULT_API_BASE,
  })

  // Respects overridden apiBase in body.origin
  setCarpoolApiBase('https://rides.clemson.edu')
  const callsOverride = stubFetch({ status: 200, json: { ok: true } })
  await carpoolProgram(supabase, 'terms')
  assert.equal(callsOverride[0].url, 'https://rides.clemson.edu/api/carpool?action=program')
  assert.equal(JSON.parse(callsOverride[0].options.body).origin, 'https://rides.clemson.edu')
  setCarpoolApiBase('')
})

test('createCarpoolOffer: asserts POST method, path, session bearer, JSON body defaults, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, rideId: 'ride-303', token: 'tok-friend-1' },
  })
  const supabase = fakeSupabase('bearer-offer-567')

  const res = await createCarpoolOffer(supabase, {
    displayName: 'Morgan',
    pickup: 'The Reserve',
    dropoff: 'CLT Airport',
    splitMode: 'by_distance',
    partyType: 'tailgate',
    ambassadorCode: 'amb_offer',
  })

  assert.deepEqual(res, { ok: true, rideId: 'ride-303', token: 'tok-friend-1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/friend-rides?action=create`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-offer-567')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    displayName: 'Morgan',
    pickup: 'The Reserve',
    dropoff: 'CLT Airport',
    splitMode: 'by_distance',
    kind: 'carpool',
    partyType: 'tailgate',
    ambassadorCode: 'amb_offer',
  })

  // splitMode defaults to 'even' when not 'by_distance', partyType defaults to 'carpool'
  const callsDefault = stubFetch({ status: 200, json: { ok: true } })
  await createCarpoolOffer(supabase, {
    displayName: 'Taylor',
    pickup: 'Earle St',
    dropoff: 'GSP',
  })
  assert.deepEqual(JSON.parse(callsDefault[0].options.body), {
    displayName: 'Taylor',
    pickup: 'Earle St',
    dropoff: 'GSP',
    splitMode: 'even',
    kind: 'carpool',
    partyType: 'carpool',
  })
})

test('getFriendRide: asserts GET method, encoded token query param, session bearer, no body, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, ride: { id: 'r-404', status: 'open' } },
  })
  const supabase = fakeSupabase('bearer-get-678')

  const res = await getFriendRide(supabase, 'special token/with+symbols=')

  assert.deepEqual(res, { ok: true, ride: { id: 'r-404', status: 'open' } })
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    `${DEFAULT_API_BASE}/api/friend-rides?action=get&token=special%20token%2Fwith%2Bsymbols%3D`,
  )
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-get-678')
  assert.equal(calls[0].options.body, undefined)
})

test('joinFriendRide: asserts POST method, path, session bearer, JSON body, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, participantId: 'p-505' },
  })
  const supabase = fakeSupabase('bearer-join-789')

  const res = await joinFriendRide(supabase, {
    token: 'tok-abc',
    displayName: 'Riley',
    pickup: 'Bowman Field',
    ambassadorCode: 'amb_join',
  })

  assert.deepEqual(res, { ok: true, participantId: 'p-505' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/friend-rides?action=join`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-join-789')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    token: 'tok-abc',
    displayName: 'Riley',
    pickup: 'Bowman Field',
    ambassadorCode: 'amb_join',
  })

  // Falsy ambassadorCode is converted to undefined and omitted in JSON body
  const calls2 = stubFetch({ status: 200, json: { ok: true } })
  await joinFriendRide(supabase, {
    token: 'tok-abc',
    displayName: 'Riley',
    ambassadorCode: '',
  })
  assert.deepEqual(JSON.parse(calls2[0].options.body), {
    token: 'tok-abc',
    displayName: 'Riley',
  })
})

test('recomputeFriendRide: asserts POST method, path, session bearer, splitMode handling, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, fares: [{ participantId: 'p-1', shareCents: 1200 }] },
  })
  const supabase = fakeSupabase('bearer-recompute-890')

  const res = await recomputeFriendRide(supabase, 'tok-recomp', 'by_distance')

  assert.deepEqual(res, { ok: true, fares: [{ participantId: 'p-1', shareCents: 1200 }] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/friend-rides?action=recompute`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-recompute-890')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    token: 'tok-recomp',
    splitMode: 'by_distance',
  })

  // splitMode !== 'by_distance' defaults to 'even'
  const callsEven = stubFetch({ status: 200, json: { ok: true } })
  await recomputeFriendRide(supabase, 'tok-recomp', 'even')
  assert.equal(JSON.parse(callsEven[0].options.body).splitMode, 'even')

  const callsFallback = stubFetch({ status: 200, json: { ok: true } })
  await recomputeFriendRide(supabase, 'tok-recomp', undefined)
  assert.equal(JSON.parse(callsFallback[0].options.body).splitMode, 'even')
})

test('confirmFriendCharges: asserts POST method, path, session bearer, quote ID/signature coercion, and parsed success', async () => {
  const calls = stubFetch({
    status: 200,
    json: { ok: true, status: 'confirmed' },
  })
  const supabase = fakeSupabase('bearer-confirm-901')

  const quote = { quoteId: 12345, quoteSignature: 'sig-abc-987' }
  const res = await confirmFriendCharges(supabase, 'tok-confirm', quote)

  assert.deepEqual(res, { ok: true, status: 'confirmed' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DEFAULT_API_BASE}/api/friend-rides?action=confirm-charges`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer bearer-confirm-901')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    token: 'tok-confirm',
    useCredits: true,
    origin: DEFAULT_API_BASE,
    quoteId: '12345',
    quoteSignature: 'sig-abc-987',
  })

  // When quote is null, undefined, or missing ids, quoteId and quoteSignature are omitted
  const callsNoQuote = stubFetch({ status: 200, json: { ok: true } })
  await confirmFriendCharges(supabase, 'tok-confirm', null)
  assert.deepEqual(JSON.parse(callsNoQuote[0].options.body), {
    token: 'tok-confirm',
    useCredits: true,
    origin: DEFAULT_API_BASE,
  })

  const callsEmptyQuote = stubFetch({ status: 200, json: { ok: true } })
  await confirmFriendCharges(supabase, 'tok-confirm', {})
  assert.deepEqual(JSON.parse(callsEmptyQuote[0].options.body), {
    token: 'tok-confirm',
    useCredits: true,
    origin: DEFAULT_API_BASE,
  })
})

test('non-OK JSON, malformed response, and network throw paths via apiErrorMessage', async () => {
  // Non-OK with data.error
  stubFetch({
    status: 400,
    ok: false,
    json: { error: 'Carpool ride is closed' },
  })
  await assert.rejects(
    () => matchCarpool(fakeSupabase(), { pickup: 'A', dropoff: 'B', displayName: 'C' }),
    (err) => {
      assert.equal(err.message, 'Carpool ride is closed')
      assert.equal(err.status, 400)
      assert.deepEqual(err.payload, { error: 'Carpool ride is closed' })
      assert.equal(apiErrorMessage(err), 'Carpool ride is closed')
      return true
    },
  )

  // Non-OK with data.message
  stubFetch({
    status: 404,
    ok: false,
    json: { message: 'Friend ride not found' },
  })
  await assert.rejects(
    () => getFriendRide(fakeSupabase(), 'missing-token'),
    (err) => {
      assert.equal(err.message, 'Friend ride not found')
      assert.equal(err.status, 404)
      assert.deepEqual(err.payload, { message: 'Friend ride not found' })
      assert.equal(apiErrorMessage(err), 'Friend ride not found')
      return true
    },
  )

  // 5xx with no user-facing message uses the generic copy (friendlyApiError kind 'server').
  stubFetch({
    status: 500,
    ok: false,
    json: { details: 'internal failure' },
  })
  await assert.rejects(
    () => carpoolProgram(fakeSupabase(), 'status'),
    (err) => {
      assert.equal(err.message, GENERIC_ERROR_COPY)
      assert.equal(err.status, 500)
      assert.equal(err.kind, 'server')
      assert.deepEqual(err.payload, { details: 'internal failure' })
      assert.equal(apiErrorMessage(err), GENERIC_ERROR_COPY)
      return true
    },
  )

  // 503 is always the unavailable copy, including an empty body.
  stubFetch({
    status: 503,
    ok: false,
    text: '',
  })
  await assert.rejects(
    () => claimAmbassadorAttribution(fakeSupabase(), 'code'),
    (err) => {
      assert.equal(err.message, UNAVAILABLE_COPY)
      assert.equal(err.status, 503)
      assert.equal(err.kind, 'unavailable')
      assert.equal(err.unavailable, true)
      assert.deepEqual(err.payload, {})
      assert.equal(apiErrorMessage(err), UNAVAILABLE_COPY)
      return true
    },
  )

  // Non-OK HTML is mapped through friendlyApiError. 502 is kind 'server', so the
  // thrown message is the generic copy. apiErrorMessage still prefers payload.message,
  // and the client stores the raw body there when JSON parsing fails.
  const gatewayHtml = '<html><body>502 Bad Gateway</body></html>'
  stubFetch({
    status: 502,
    ok: false,
    text: gatewayHtml,
  })
  await assert.rejects(
    () => joinFriendRide(fakeSupabase(), { token: 'tok' }),
    (err) => {
      assert.equal(err.message, GENERIC_ERROR_COPY)
      assert.equal(err.status, 502)
      assert.equal(err.kind, 'server')
      assert.deepEqual(err.payload, { message: gatewayHtml })
      // BUG?: apiErrorMessage returns the raw HTML payload when friendly kind is not auth/unavailable.
      assert.equal(apiErrorMessage(err), gatewayHtml)
      return true
    },
  )

  // Network error (fetch rejects with TypeError)
  stubFetch({
    error: new TypeError('Failed to fetch'),
  })
  await assert.rejects(
    () => recomputeFriendRide(fakeSupabase(), 'tok', 'even'),
    (err) => {
      assert.equal(err.message, 'Failed to fetch')
      assert.equal(apiErrorMessage(err), 'Failed to fetch')
      return true
    },
  )

  // Network error (fetch rejects with object without message)
  stubFetch({
    error: {},
  })
  await assert.rejects(
    () => confirmFriendCharges(fakeSupabase(), 'tok', null),
    (err) => {
      assert.equal(err.message, 'Network error')
      assert.equal(apiErrorMessage(err), 'Network error')
      return true
    },
  )
})
