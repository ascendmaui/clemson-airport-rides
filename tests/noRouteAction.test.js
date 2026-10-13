import assert from 'node:assert/strict'
import test from 'node:test'
import { peekJsonBody, requestUrl, resolveRouteAction } from '../server/routeAction.js'

const DRIVER = {
  allowed: [
    'signup',
    'submit-review',
    'earnings',
    'offer-preview',
    'tip',
    'wait',
    'cancel-midride',
    'payouts',
    'inbox',
  ],
  legacy: {
    'driver-signup': 'signup',
    'driver-submit-review': 'submit-review',
    'driver-earnings': 'earnings',
    'trip-offer-preview': 'offer-preview',
    'trip-tip': 'tip',
    'trip-wait': 'wait',
    'trip-cancel-midride': 'cancel-midride',
    'driver-payouts': 'payouts',
  },
}

const SUPPORT = {
  allowed: ['help-chat', 'support-chat', 'ticket'],
  legacy: {
    'help-chat': 'help-chat',
    'support-chat': 'support-chat',
    'support-ticket': 'ticket',
  },
}

test('requestUrl falls back when the request URL cannot be parsed', () => {
  const url = requestUrl({ url: 'http://[' })
  assert.equal(url.pathname, '/')
  assert.equal(url.search, '')
})

test('requestUrl treats a missing url as the root', () => {
  const url = requestUrl({})
  assert.equal(url.pathname, '/')
})

test('peekJsonBody returns objects and parsed JSON strings', () => {
  assert.deepEqual(peekJsonBody({ body: { action: 'signup' } }), { action: 'signup' })
  assert.deepEqual(peekJsonBody({ body: '{"action":"wait"}' }), { action: 'wait' })
  assert.deepEqual(peekJsonBody({ body: '' }), {})
  assert.equal(peekJsonBody({ body: 'not-json' }), null)
  assert.equal(peekJsonBody({ body: 'null' }), null)
  assert.equal(peekJsonBody({ body: Buffer.from('{"action":"signup"}') }), null)
  assert.equal(peekJsonBody({}), null)
})

test('query action is the first candidate and wins over the path', () => {
  const action = resolveRouteAction(
    { url: '/api/driver-signup?action=payouts' },
    DRIVER,
  )
  assert.equal(action, 'payouts')
})

test('only the first query action is read', () => {
  const ignoredSecond = resolveRouteAction(
    { url: '/api/help-chat?action=nope&action=help-chat' },
    SUPPORT,
  )
  assert.equal(ignoredSecond, 'help-chat')

  const noPath = resolveRouteAction(
    { url: '/?action=nope&action=help-chat' },
    SUPPORT,
  )
  assert.equal(noPath, null)
})

test('req.query.action is used when the URL has no action', () => {
  assert.equal(
    resolveRouteAction({ url: '/api/driver', query: { action: 'earnings' } }, DRIVER),
    'earnings',
  )
  assert.equal(
    resolveRouteAction({ url: '/api/driver', query: { action: ['inbox', 'payouts'] } }, DRIVER),
    'inbox',
  )
  assert.equal(
    resolveRouteAction({ url: '/api/driver', query: { action: [] } }, DRIVER),
    null,
  )
})

test('whitespace around a query action is trimmed', () => {
  assert.equal(
    resolveRouteAction({ url: '/api/driver?action=%20inbox%20' }, DRIVER),
    'inbox',
  )
})

test('legacy names map from the path, not from the query string', () => {
  assert.equal(
    resolveRouteAction({ url: '/api/driver-signup' }, DRIVER),
    'signup',
  )
  assert.equal(
    resolveRouteAction({ url: '/api/trip-cancel-midride/' }, DRIVER),
    'cancel-midride',
  )
  assert.equal(
    resolveRouteAction({ url: '/api/driver?action=driver-signup' }, DRIVER),
    null,
  )
  assert.equal(
    resolveRouteAction({ url: '/api/support-ticket' }, SUPPORT),
    'ticket',
  )
})

test('routing headers supply a path segment after the query', () => {
  assert.equal(
    resolveRouteAction({
      url: '/',
      headers: { 'x-vercel-original-url': '/api/trip-offer-preview' },
    }, DRIVER),
    'offer-preview',
  )
  assert.equal(
    resolveRouteAction({
      url: '/',
      headers: { 'x-invoke-path': ['/api/support-ticket?ignored=1'] },
    }, SUPPORT),
    'ticket',
  )
  assert.equal(
    resolveRouteAction({
      url: '/',
      headers: { 'x-matched-path': '/api/driver-payouts', 'x-forwarded-uri': '/api/driver-signup' },
    }, DRIVER),
    'payouts',
  )
})

test('a header name match is case-sensitive on the headers object', () => {
  assert.equal(
    resolveRouteAction({
      url: '/',
      headers: { 'X-Invoke-Path': '/api/help-chat' },
    }, SUPPORT),
    null,
  )
})

test('body.action is last and a non-route body action is ignored', () => {
  assert.equal(
    resolveRouteAction({ url: '/api/driver', body: { action: 'wait' } }, DRIVER),
    'wait',
  )
  assert.equal(
    resolveRouteAction({
      url: '/api/help-chat',
      body: { action: 'ambassador' },
    }, SUPPORT),
    'help-chat',
  )
  assert.equal(
    resolveRouteAction({
      url: '/api/carpool-program',
      body: { action: 'first_ride' },
    }, {
      allowed: ['match', 'group', 'program', 'attribute'],
      legacy: { 'carpool-program': 'program' },
    }),
    'program',
  )
})

test('body.action from a JSON string counts, and invalid JSON does not throw', () => {
  assert.equal(
    resolveRouteAction({ url: '/', body: '{"action":"ticket"}' }, SUPPORT),
    'ticket',
  )
  assert.equal(
    resolveRouteAction({ url: '/', body: '{', }, SUPPORT),
    null,
  )
})

test('the first allowed candidate wins and unknown actions return null', () => {
  assert.equal(
    resolveRouteAction({
      url: '/api/help-chat?action=ticket',
      body: { action: 'help-chat' },
    }, SUPPORT),
    'ticket',
  )
  assert.equal(resolveRouteAction({ url: '/api/admin-drivers' }, SUPPORT), null)
  assert.equal(resolveRouteAction({ url: '/api/driver?action=' }, DRIVER), null)
  assert.equal(resolveRouteAction({ url: '/api/driver?action=signup' }, { allowed: [] }), null)
})

test('an allow-list Set is accepted', () => {
  assert.equal(
    resolveRouteAction(
      { url: '/api/admin?action=applicant-thread' },
      { allowed: new Set(['overview', 'applicant-thread', 'info-request']) },
    ),
    'applicant-thread',
  )
})
