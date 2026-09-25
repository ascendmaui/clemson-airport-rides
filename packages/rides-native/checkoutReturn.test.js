import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCheckoutSessionId, parseCheckoutReturn } from './checkoutReturn.js'
import { checkoutSuccessHash } from './liveTrip.js'
import { NATIVE_CHECKOUT_ORIGIN, reconcileCheckout } from './riderMoney.js'

test('parseCheckoutSessionId: extracts session_id from web hash return URLs', () => {
  // Stripe return pages use NATIVE_CHECKOUT_ORIGIN (WEB_ORIGIN in shared/productLinks.js).
  assert.equal(NATIVE_CHECKOUT_ORIGIN, 'https://clemson-rides.vercel.app')

  const liveHash = `${checkoutSuccessHash({ tripId: 'trip_live_1', scheduled: false })}&session_id=cs_test_live123`
  assert.equal(parseCheckoutSessionId(liveHash), 'cs_test_live123')

  const schedHash = `${checkoutSuccessHash({ tripId: 'trip_sched_2', scheduled: true })}&session_id=cs_test_sched456`
  assert.equal(parseCheckoutSessionId(schedHash), 'cs_test_sched456')

  const fullLiveUrl = `${NATIVE_CHECKOUT_ORIGIN}/${liveHash}`
  assert.equal(parseCheckoutSessionId(fullLiveUrl), 'cs_test_live123')

  const fullSchedUrl = `${NATIVE_CHECKOUT_ORIGIN}/${schedHash}`
  assert.equal(parseCheckoutSessionId(fullSchedUrl), 'cs_test_sched456')
})

test('parseCheckoutSessionId: extracts session_id from query params in URL search', () => {
  const urlWithSearch = `${NATIVE_CHECKOUT_ORIGIN}/?session_id=cs_test_search789#/requested?trip=trip_123&paid=1`
  assert.equal(parseCheckoutSessionId(urlWithSearch), 'cs_test_search789')
})

test('parseCheckoutSessionId: extracts session_id from native deep links', () => {
  assert.equal(
    parseCheckoutSessionId('clemsonrides://requested?trip=trip_native_1&paid=1&session_id=cs_test_native123'),
    'cs_test_native123'
  )
  assert.equal(
    parseCheckoutSessionId('clemsonrides://schedule?paid=1&trip=trip_native_2&session_id=cs_test_native456'),
    'cs_test_native456'
  )
  assert.equal(
    parseCheckoutSessionId('clemsonrides:///#/schedule?paid=1&trip=trip_native_3&session_id=cs_test_native789'),
    'cs_test_native789'
  )
})

test('parseCheckoutSessionId: handles objects and bare IDs', () => {
  assert.equal(parseCheckoutSessionId({ session_id: 'cs_test_obj1' }), 'cs_test_obj1')
  assert.equal(parseCheckoutSessionId({ sessionId: 'cs_test_obj2' }), 'cs_test_obj2')
  assert.equal(parseCheckoutSessionId({ params: { session_id: 'cs_test_nested' } }), 'cs_test_nested')
  assert.equal(parseCheckoutSessionId({ url: 'clemsonrides://success?session_id=cs_test_url_obj' }), 'cs_test_url_obj')
  assert.equal(parseCheckoutSessionId('cs_test_bare_string_123'), 'cs_test_bare_string_123')
})

test('parseCheckoutSessionId: returns null for missing or invalid inputs', () => {
  assert.equal(parseCheckoutSessionId(null), null)
  assert.equal(parseCheckoutSessionId(undefined), null)
  assert.equal(parseCheckoutSessionId(''), null)
  assert.equal(parseCheckoutSessionId('#/requested?trip=abc&paid=1'), null)
  assert.equal(parseCheckoutSessionId('#/schedule?canceled=1&trip=abc'), null)
  assert.equal(parseCheckoutSessionId(`${NATIVE_CHECKOUT_ORIGIN}/`), null)
  assert.equal(parseCheckoutSessionId({}), null)
  assert.equal(parseCheckoutSessionId('not_a_session_id'), null)
})

test('parseCheckoutReturn: extracts full return context', () => {
  const schedReturn = parseCheckoutReturn(
    `${NATIVE_CHECKOUT_ORIGIN}/#/schedule?paid=1&trip=trip_sched_100&session_id=cs_test_sched_ret`
  )
  assert.equal(schedReturn.sessionId, 'cs_test_sched_ret')
  assert.equal(schedReturn.tripId, 'trip_sched_100')
  assert.equal(schedReturn.paid, true)
  assert.equal(schedReturn.canceled, false)
  assert.equal(schedReturn.scheduled, true)

  const liveReturn = parseCheckoutReturn(
    `${NATIVE_CHECKOUT_ORIGIN}/#/requested?trip=trip_live_200&paid=1&session_id=cs_test_live_ret`
  )
  assert.equal(liveReturn.sessionId, 'cs_test_live_ret')
  assert.equal(liveReturn.tripId, 'trip_live_200')
  assert.equal(liveReturn.paid, true)
  assert.equal(liveReturn.canceled, false)
  assert.equal(liveReturn.scheduled, false)

  const cancelReturn = parseCheckoutReturn(
    `${NATIVE_CHECKOUT_ORIGIN}/#/schedule?canceled=1&trip=trip_cancel_300`
  )
  assert.equal(cancelReturn.sessionId, null)
  assert.equal(cancelReturn.tripId, 'trip_cancel_300')
  assert.equal(cancelReturn.paid, false)
  assert.equal(cancelReturn.canceled, true)
  assert.equal(cancelReturn.scheduled, true)
})

test('reconcileCheckout in riderMoney: rejects missing sessionId', async () => {
  await assert.rejects(
    () => reconcileCheckout(null, null),
    /Missing sessionId/
  )
  await assert.rejects(
    () => reconcileCheckout(null, ''),
    /Missing sessionId/
  )
  await assert.rejects(
    () => reconcileCheckout(null, {}),
    /Missing sessionId/
  )
})
