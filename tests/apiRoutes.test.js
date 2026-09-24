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

async function call(handler, req) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res)
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
    allowed: ['setup-intent', 'save', 'quote', 'airport-checkout', 'schedule-trip', 'buy-credits', 'credits-confirm', 'credit-lots', 'credits', 'collect', 'settle'],
    legacy: {
      'quote-fare': 'quote',
      'collect-payment': 'collect',
      'trip-settle': 'settle',
    },
  }
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
  const viaQuery = await call(friendRidesHandler, {
    method: 'GET',
    url: '/api/friend-rides?token=abc',
  })
  const viaLegacy = await call(friendRidesHandler, {
    method: 'GET',
    url: '/api/friend-rides-get?token=abc',
  })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    assert.equal(viaQuery.status, 503)
    assert.equal(viaLegacy.status, 503)
    return
  }
  assert.notEqual(viaQuery.status, 400)
  assert.notEqual(viaLegacy.status, 400)
})
