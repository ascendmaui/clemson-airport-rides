import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRouteAction } from '../server/routeAction.js'
import carpoolHandler from '../api/carpool.js'
import friendRidesHandler from '../api/friend-rides.js'
import driverHandler from '../api/driver.js'
import stripePaymentHandler from '../api/stripe-payment-methods.js'

const CARPOOL = {
  allowed: ['match', 'group', 'program'],
  legacy: {
    'carpool-match': 'match',
    'carpool-group': 'group',
    'carpool-program': 'program',
  },
}

const FRIEND = {
  allowed: ['create', 'get', 'join', 'recompute', 'confirm-charges', 'retry-charge'],
  legacy: {
    'friend-rides-create': 'create',
    'friend-rides-get': 'get',
    'friend-rides-join': 'join',
    'friend-rides-recompute': 'recompute',
    'friend-rides-confirm-charges': 'confirm-charges',
    'friend-rides-retry-charge': 'retry-charge',
  },
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function call(handler, req, ...rest) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res, ...rest)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.statusCode, json }
}

test('carpool action comes from query, path, legacy file, or body', () => {
  assert.equal(resolveRouteAction({ url: '/api/carpool?action=match' }, CARPOOL), 'match')
  assert.equal(resolveRouteAction({ url: '/api/carpool/group' }, CARPOOL), 'group')
  assert.equal(resolveRouteAction({ url: '/api/carpool-program' }, CARPOOL), 'program')
  assert.equal(
    resolveRouteAction({ url: '/api/carpool', body: { action: 'match', pickup: {} } }, CARPOOL),
    'match',
  )
  assert.equal(
    resolveRouteAction({
      url: '/api/carpool?action=program',
      body: { action: 'first_ride' },
    }, CARPOOL),
    'program',
  )
  assert.equal(
    resolveRouteAction({ url: '/api/carpool', body: { action: 'ambassador' } }, CARPOOL),
    null,
  )
  assert.equal(
    resolveRouteAction({
      url: '/api/carpool',
      headers: { 'x-vercel-original-url': '/api/carpool-group?x=1' },
    }, CARPOOL),
    'group',
  )
})

test('friend ride action prefers query over a program-style body and maps legacy names', () => {
  assert.equal(resolveRouteAction({ url: '/api/friend-rides?action=confirm-charges' }, FRIEND), 'confirm-charges')
  assert.equal(resolveRouteAction({ url: '/api/friend-rides-retry-charge' }, FRIEND), 'retry-charge')
  assert.equal(resolveRouteAction({ url: '/api/friend-rides/join' }, FRIEND), 'join')
  assert.equal(
    resolveRouteAction({ url: '/api/friend-rides', query: { action: 'get' } }, FRIEND),
    'get',
  )
  assert.equal(
    resolveRouteAction({ url: '/api/friend-rides', body: '{"action":"create"}' }, FRIEND),
    'create',
  )
})

test('consolidated handlers reject unknown actions and wrong methods', async () => {
  const missing = await call(carpoolHandler, { method: 'POST', url: '/api/carpool' })
  assert.equal(missing.status, 400)
  assert.match(missing.json.error, /action=match/)

  const programSubAction = await call(carpoolHandler, {
    method: 'POST',
    url: '/api/carpool',
    body: { action: 'first_ride' },
  })
  assert.equal(programSubAction.status, 400)

  const matchGet = await call(carpoolHandler, { method: 'GET', url: '/api/carpool?action=match' })
  assert.equal(matchGet.status, 405)

  const legacyGroup = await call(carpoolHandler, { method: 'GET', url: '/api/carpool-group' })
  assert.equal(legacyGroup.status, 405)

  const preflight = await call(carpoolHandler, { method: 'OPTIONS', url: '/api/carpool' })
  assert.equal(preflight.status, 204)

  const friendMissing = await call(friendRidesHandler, { method: 'POST', url: '/api/friend-rides' })
  assert.equal(friendMissing.status, 400)

  const createGet = await call(friendRidesHandler, { method: 'GET', url: '/api/friend-rides?action=create' })
  assert.equal(createGet.status, 405)

  const joinGet = await call(friendRidesHandler, { method: 'GET', url: '/api/friend-rides-join' })
  assert.equal(joinGet.status, 405)

  const driverGet = await call(driverHandler, { method: 'GET', url: '/api/driver-signup' })
  assert.equal(driverGet.status, 405)

  const driverMissing = await call(driverHandler, { method: 'POST', url: '/api/driver' })
  assert.equal(driverMissing.status, 400)

  const stripeGet = await call(stripePaymentHandler, {
    method: 'GET',
    url: '/api/stripe-save-payment-method',
  })
  assert.equal(stripeGet.status, 405)

  const stripeMissing = await call(stripePaymentHandler, {
    method: 'POST',
    url: '/api/stripe-payment-methods',
  })
  assert.equal(stripeMissing.status, 400)

  const requestDriver = await call(stripePaymentHandler, {
    method: 'POST',
    url: '/api/stripe-payment-methods?action=request-driver',
  })
  assert.notEqual(requestDriver.status, 400)

  const abandon = await call(stripePaymentHandler, {
    method: 'POST',
    url: '/api/stripe-payment-methods?action=abandon-checkout',
    body: {},
  })
  assert.notEqual(abandon.status, 400)

  const reconcile = await call(stripePaymentHandler, {
    method: 'POST',
    url: '/api/stripe-payment-methods?action=reconcile-checkout',
    body: {},
  })
  assert.notEqual(reconcile.status, 400)
})

test('saved payment methods list and select are their own routes', async () => {
  const listed = await call(stripePaymentHandler, {
    method: 'GET',
    url: '/api/stripe-payment-methods',
  })
  assert.notEqual(listed.status, 400)
  assert.ok([200, 401, 503].includes(listed.status))

  const select = await call(stripePaymentHandler, {
    method: 'POST',
    url: '/api/stripe-payment-methods',
    body: { action: 'default', paymentMethodId: 'pm_card' },
  })
  assert.notEqual(select.status, 400)
  assert.ok([200, 401, 503].includes(select.status))

  const remove = await call(stripePaymentHandler, {
    method: 'POST',
    url: '/api/stripe-payment-methods',
    body: { action: 'detach', paymentMethodId: 'pm_card' },
  })
  assert.notEqual(remove.status, 400)
  assert.ok([200, 401, 503].includes(remove.status))
})

test('held routes fold into existing routers and ignore body sub-actions', () => {
  const driver = {
    allowed: ['signup', 'submit-review', 'earnings', 'offer-preview', 'tip', 'wait', 'cancel-midride', 'payouts'],
    legacy: {
      'driver-earnings': 'earnings',
      'trip-wait': 'wait',
      'trip-cancel-midride': 'cancel-midride',
      'driver-payouts': 'payouts',
    },
  }
  assert.equal(resolveRouteAction({ url: '/api/driver?action=wait', body: { action: 'arrive', tripId: 't' } }, driver), 'wait')
  assert.equal(resolveRouteAction({ url: '/api/trip-wait', body: { action: 'tick' } }, driver), 'wait')
  assert.equal(resolveRouteAction({ url: '/api/driver-earnings' }, driver), 'earnings')

  const pay = {
    allowed: ['setup-intent', 'save', 'quote', 'airport-checkout', 'schedule-trip', 'buy-credits', 'credits-confirm', 'credit-lots', 'credits', 'collect', 'settle', 'reconcile-checkout'],
    legacy: {
      'quote-fare': 'quote',
      'collect-payment': 'collect',
      'trip-settle': 'settle',
    },
  }
  assert.equal(
    resolveRouteAction({ url: '/api/stripe-payment-methods?action=reconcile-checkout' }, pay),
    'reconcile-checkout',
  )
  assert.equal(
    resolveRouteAction({ url: '/api/stripe-payment-methods?action=credits', body: { action: 'buy', tierId: 'pack' } }, pay),
    'credits',
  )
  assert.equal(resolveRouteAction({ url: '/api/stripe-payment-methods', body: { action: 'default' } }, pay), null)
  assert.equal(resolveRouteAction({ url: '/api/trip-settle', body: { action: 'complete', tripId: 't' } }, pay), 'settle')

  const support = {
    allowed: ['help-chat', 'support-chat', 'ticket'],
    legacy: { 'help-chat': 'help-chat', 'support-chat': 'support-chat', 'support-ticket': 'ticket' },
  }
  assert.equal(resolveRouteAction({ url: '/api/help-chat' }, support), 'help-chat')
  assert.equal(resolveRouteAction({ url: '/api/admin-drivers?action=ticket' }, support), 'ticket')
  assert.equal(resolveRouteAction({ url: '/api/admin-drivers', body: { profileId: 'p', decision: 'approve' } }, support), null)
})

test('GET friend ride with a token reaches the get handler', async () => {
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const viaQuery = await call(friendRidesHandler, {
      method: 'GET',
      url: '/api/friend-rides?token=abc',
    })
    const viaLegacy = await call(friendRidesHandler, {
      method: 'GET',
      url: '/api/friend-rides-get?token=abc',
    })
    assert.equal(viaQuery.status, 503)
    assert.equal(viaLegacy.status, 503)
  } finally {
    if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY
  }
})

test('consolidated route handlers forward injected dependencies to sub-handlers', async () => {
  const fakeSb = {
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        in() { return chain },
        order() { return chain },
        limit() { return chain },
        maybeSingle: async () => {
          if (table === 'friend_rides') {
            return {
              data: {
                id: 'r1',
                token: 'tok-mock',
                status: 'open',
                driver_profile_id: 'd1',
              },
              error: null,
            }
          }
          if (table === 'vehicles') {
            return { data: { make: 'Toyota', model: 'Prius', seats: 4 }, error: null }
          }
          return { data: null, error: null }
        },
        then(resolve) {
          resolve({ data: [], error: null })
        },
      }
      return chain
    },
  }

  const result = await call(
    friendRidesHandler,
    { method: 'GET', url: '/api/friend-rides?token=tok-mock' },
    { sb: fakeSb },
  )

  assert.equal(result.status, 200)
  assert.equal(result.json.id, 'r1')
})
