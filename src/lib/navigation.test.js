import assert from 'node:assert/strict'
import test from 'node:test'
import { WEB_ORIGIN } from '../../shared/productLinks.js'
import {
  carpoolInviteUrl,
  friendsInviteUrl,
  getHashRoute,
  navigate,
  redirectShareHashToPath,
  shareUrl,
} from './navigation.js'

test('share, friends, and carpool URLs format with proper origin and encoding', () => {
  assert.equal(shareUrl('tok_123'), `${WEB_ORIGIN}/share/tok_123`)
  assert.equal(friendsInviteUrl('friend+abc 123'), `${WEB_ORIGIN}/friends/friend%2Babc%20123`)
  assert.equal(carpoolInviteUrl('carpool/999'), `${WEB_ORIGIN}/carpool/carpool%2F999`)
})

test('getHashRoute defaults to landing in headless Node environment', () => {
  const route = getHashRoute()
  assert.equal(route.path, 'landing')
  assert.deepEqual(route.params, {})
  assert.deepEqual(route.segments, ['landing'])
})

test('getHashRoute parses routing paths and segment parameters under simulated browser window', () => {
  const originalWindow = globalThis.window
  const mockStorage = new Map()

  function setLocation(hash = '', pathname = '/', search = '') {
    globalThis.window = {
      location: {
        hash,
        pathname,
        search,
        origin: 'https://test.clemsonrides.com',
        replace: () => {},
        assign: () => {},
      },
      sessionStorage: {
        getItem: (k) => mockStorage.get(k) || null,
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k),
      },
    }
  }

  try {
    // 1. Path form for share route (standard production URL)
    setLocation('', '/share/tok_abc')
    const shareRoute = getHashRoute()
    assert.equal(shareRoute.path, 'share')
    assert.equal(shareRoute.params.token, 'tok_abc')

    // 2. Path form for friends invite route
    setLocation('', '/friends/fr_xyz')
    const friendsRoute = getHashRoute()
    assert.equal(friendsRoute.path, 'friends')
    assert.equal(friendsRoute.params.token, 'fr_xyz')

    // 3. Path form for carpool invite route
    setLocation('', '/carpool/cp_789')
    const carpoolRoute = getHashRoute()
    assert.equal(carpoolRoute.path, 'carpool')
    assert.equal(carpoolRoute.params.token, 'cp_789')

    // 4. Profile route
    setLocation('#/profile/usr_100')
    const profileRoute = getHashRoute()
    assert.equal(profileRoute.path, 'profile')
    assert.equal(profileRoute.params.id, 'usr_100')

    // 5. Rate route
    setLocation('#/rate/trip_200')
    const rateRoute = getHashRoute()
    assert.equal(rateRoute.path, 'rate')
    assert.equal(rateRoute.params.trip, 'trip_200')

    setLocation('#/tip/trip_210')
    const tipRoute = getHashRoute()
    assert.equal(tipRoute.path, 'tip')
    assert.equal(tipRoute.params.trip, 'trip_210')

    // 6. Account tab route
    setLocation('#/account/billing')
    const accountRoute = getHashRoute()
    assert.equal(accountRoute.path, 'account')
    assert.equal(accountRoute.params.tab, 'billing')

    // 7. Receipt route
    setLocation('#/receipt/trip_300')
    const receiptRoute = getHashRoute()
    assert.equal(receiptRoute.path, 'receipt')
    assert.equal(receiptRoute.params.trip, 'trip_300')

    // 8. Ambassador route
    setLocation('#/ambassador/CLEMSON20')
    const ambassadorRoute = getHashRoute()
    assert.equal(ambassadorRoute.path, 'ambassador')
    assert.equal(ambassadorRoute.params.code, 'CLEMSON20')

    // 9. Short ambassador alias route
    setLocation('#/a/TIGER10')
    const shortAmbassadorRoute = getHashRoute()
    assert.equal(shortAmbassadorRoute.path, 'a')
    assert.equal(shortAmbassadorRoute.params.code, 'TIGER10')

    // 10. Query string parameter parsing
    setLocation('#/carpool?hub=1&drive=1')
    const qsRoute = getHashRoute()
    assert.equal(qsRoute.path, 'carpool')
    assert.equal(qsRoute.params.hub, '1')
    assert.equal(qsRoute.params.drive, '1')
  } finally {
    globalThis.window = originalWindow
  }
})

test('redirectShareHashToPath replaces legacy hash routes with path form', () => {
  const originalWindow = globalThis.window
  let replacedUrl = null

  try {
    globalThis.window = {
      location: {
        hash: '#/share/token_123',
        pathname: '/',
        search: '?ref=test',
        origin: 'https://test.clemsonrides.com',
        replace: (url) => {
          replacedUrl = url
        },
      },
    }

    const redirected = redirectShareHashToPath()
    assert.equal(redirected, true)
    assert.equal(replacedUrl, 'https://test.clemsonrides.com/share/token_123?ref=test')

    // Non-redirecting hash
    globalThis.window.location.hash = '#/dashboard'
    assert.equal(redirectShareHashToPath(), false)
  } finally {
    globalThis.window = originalWindow
  }
})

test('navigate sets hash or assigns location URL', () => {
  const originalWindow = globalThis.window
  let assignedUrl = null

  try {
    globalThis.window = {
      location: {
        hash: '',
        origin: 'https://test.clemsonrides.com',
        assign: (url) => {
          assignedUrl = url
        },
      },
    }

    // Hash navigation
    navigate('dashboard', { tab: 'rides' })
    assert.equal(globalThis.window.location.hash, '#/dashboard?tab=rides')

    navigate('friends')
    assert.equal(globalThis.window.location.hash, '#/friends')

    navigate('carpool')
    assert.equal(globalThis.window.location.hash, '#/carpool?hub=1')

    // Path assign navigation for share/friends/carpool with token
    navigate('share', { token: 'tok_live' })
    assert.equal(assignedUrl, 'https://test.clemsonrides.com/share/tok_live')
  } finally {
    globalThis.window = originalWindow
  }
})
