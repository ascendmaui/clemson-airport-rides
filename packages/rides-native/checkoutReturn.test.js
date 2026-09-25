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

test('parseCheckoutSessionId: accepts trimmed bare cs_test and cs_live ids only', () => {
  assert.equal(parseCheckoutSessionId('  cs_live_AbC_123  '), 'cs_live_AbC_123')
  assert.equal(parseCheckoutSessionId('cs_test_AbC_123'), 'cs_test_AbC_123')
  assert.equal(parseCheckoutSessionId('   '), null)
  assert.equal(parseCheckoutSessionId('cs_'), null)
  assert.equal(parseCheckoutSessionId('cs_bad id'), null)
  assert.equal(parseCheckoutSessionId('cs_test-abc'), null)
  assert.equal(parseCheckoutSessionId('CS_test_abc'), null)
  assert.equal(parseCheckoutSessionId('prefix cs_test_abc'), null)
})

test('parseCheckoutSessionId: reads query values before the hash and inside it', () => {
  assert.equal(
    parseCheckoutSessionId('https://x.test/?session_id=cs_test_search#/requested?session_id=cs_test_hash'),
    'cs_test_search',
  )
  assert.equal(
    parseCheckoutSessionId('https://host/#/requested?trip=a%2Fb&paid=1&sessionId=cs_test_camel'),
    'cs_test_camel',
  )
  assert.equal(parseCheckoutSessionId('?SESSION_ID=cs_test_upperkey'), 'cs_test_upperkey')
  assert.equal(parseCheckoutSessionId('?session_id=%20cs_live_abc%20'), 'cs_live_abc')
  assert.equal(parseCheckoutSessionId('?session_id=pi_123'), null)
  assert.equal(parseCheckoutSessionId('?session_id=%'), null)
  assert.equal(parseCheckoutSessionId('?session_id='), null)
  assert.equal(parseCheckoutSessionId('?session_id=&paid=1'), null)
  assert.equal(parseCheckoutSessionId('?session_id'), null)
})

test('parseCheckoutSessionId: query and object paths skip the bare-id charset check', () => {
  // BUG?: the header says a session id is returned only when it is valid. Bare strings must
  // match /^cs_[a-zA-Z0-9_]+$/, but object fields and query values return any trimmed string
  // that starts with "cs_", including an empty body, spaces, hyphens, "+", "%", and markup.
  // A broken percent-escape skips decodeURIComponent and returns the raw capture.
  assert.equal(parseCheckoutSessionId({ sessionId: 'cs_' }), 'cs_')
  assert.equal(parseCheckoutSessionId({ sessionId: 'cs_bad id' }), 'cs_bad id')
  assert.equal(parseCheckoutSessionId({ sessionId: 'cs_test_<script>' }), 'cs_test_<script>')
  assert.equal(parseCheckoutSessionId({ sessionId: 'cs_test_abc\ninjected' }), 'cs_test_abc\ninjected')
  assert.equal(parseCheckoutSessionId('?session_id=cs_test_%'), 'cs_test_%')
  assert.equal(parseCheckoutSessionId('https://x.test/?session_id=cs_test_%ZZ'), 'cs_test_%ZZ')
  assert.equal(parseCheckoutSessionId('?session_id=cs_test_a+b'), 'cs_test_a+b')
  assert.equal(parseCheckoutSessionId('?session_id=cs_test-abc'), 'cs_test-abc')
})

test('parseCheckoutSessionId: ignores a query string or hash that has no ? or & before the key', () => {
  // BUG?: the public comment says this extracts cs_ ids from a query string or hash.
  // `session_id=cs_test_abc` and `#session_id=cs_test_abc` have the key, and both return null
  // because the scanner only looks for "?" or "&".
  assert.equal(parseCheckoutSessionId('session_id=cs_test_abc'), null)
  assert.equal(parseCheckoutSessionId('#session_id=cs_test_abc'), null)
})

test('parseCheckoutSessionId: object fields prefer sessionId, then session_id, then params, then url', () => {
  assert.equal(parseCheckoutSessionId({ sessionId: '  cs_test_trim  ' }), 'cs_test_trim')
  assert.equal(parseCheckoutSessionId({ params: { sessionId: '  cs_test_nested  ' } }), 'cs_test_nested')
  assert.equal(
    parseCheckoutSessionId({
      params: { session_id: 'cs_test_params' },
      url: 'https://x.test/?session_id=cs_test_url',
    }),
    'cs_test_params',
  )
  assert.equal(
    parseCheckoutSessionId({
      sessionId: 'cs_test_top',
      params: { session_id: 'cs_test_params' },
      url: 'https://x.test/?session_id=cs_test_url',
    }),
    'cs_test_top',
  )
  assert.equal(
    parseCheckoutSessionId({ sessionId: 'nope', url: 'https://x.test/?session_id=cs_test_ok' }),
    'cs_test_ok',
  )
  assert.equal(
    parseCheckoutSessionId({ sessionId: '   ', href: 'https://x.test/?session_id=cs_test_href' }),
    'cs_test_href',
  )
  assert.equal(
    parseCheckoutSessionId({ sessionId: '', session_id: 'cs_test_snake' }),
    'cs_test_snake',
  )
  assert.equal(
    parseCheckoutSessionId({ params: { session_id: 'nope' }, hash: '#/x?session_id=cs_test_hash' }),
    'cs_test_hash',
  )
  assert.equal(parseCheckoutSessionId({ href: 'https://x.test/?session_id=cs_test_href' }), 'cs_test_href')
  assert.equal(parseCheckoutSessionId({ hash: '#/requested?session_id=cs_test_hash' }), 'cs_test_hash')
  assert.equal(parseCheckoutSessionId({}), null)
  assert.equal(parseCheckoutSessionId({ params: {} }), null)
  assert.equal(parseCheckoutSessionId({ url: '' }), null)
})

test('parseCheckoutSessionId: skips a truthy non-string field and reads the next string', () => {
  assert.equal(
    parseCheckoutSessionId({
      sessionId: 123,
      session_id: 'cs_test_snake',
      url: 'https://x.test/?session_id=cs_test_url',
    }),
    'cs_test_snake',
  )
  assert.equal(
    parseCheckoutSessionId({ url: 1, href: 'https://x.test/?session_id=cs_test_href' }),
    'cs_test_href',
  )
  assert.equal(
    parseCheckoutSessionId({ href: 1, hash: '#/schedule?session_id=cs_test_hash' }),
    'cs_test_hash',
  )
  assert.equal(
    parseCheckoutSessionId({ params: { sessionId: true, session_id: 'cs_test_params' } }),
    'cs_test_params',
  )
  assert.equal(parseCheckoutSessionId({ sessionId: 123, url: 1, href: false }), null)
})

test('parseCheckoutSessionId: returns null for non-strings without throwing', () => {
  assert.equal(parseCheckoutSessionId(0), null)
  assert.equal(parseCheckoutSessionId(12), null)
  assert.equal(parseCheckoutSessionId(false), null)
  assert.equal(parseCheckoutSessionId(true), null)
  assert.equal(parseCheckoutSessionId(['cs_test_a']), null)
  assert.equal(parseCheckoutSessionId({ url: 5 }), null)
})

test('parseCheckoutReturn: production success, cancel, and no-trip hashes', () => {
  assert.deepEqual(
    parseCheckoutReturn('https://clemson-airport-rides.vercel.app/#/requested?trip=trip_live_200&paid=1&session_id=cs_test_live_ret'),
    { sessionId: 'cs_test_live_ret', tripId: 'trip_live_200', paid: true, canceled: false, scheduled: false },
  )
  assert.deepEqual(
    parseCheckoutReturn('clemsonrides://schedule?paid=1&trip=trip_native_2&session_id=cs_test_native456'),
    { sessionId: 'cs_test_native456', tripId: 'trip_native_2', paid: true, canceled: false, scheduled: true },
  )
  assert.deepEqual(
    parseCheckoutReturn('https://clemson-airport-rides.vercel.app/#/schedule?canceled=1&trip=trip_42'),
    { sessionId: null, tripId: 'trip_42', paid: false, canceled: true, scheduled: true },
  )
  assert.deepEqual(parseCheckoutReturn('#/schedule?paid=1'), {
    sessionId: null,
    tripId: null,
    paid: true,
    canceled: false,
    scheduled: true,
  })
  assert.deepEqual(parseCheckoutReturn('#/schedule?paid=1&session_id=cs_test_notrip'), {
    sessionId: 'cs_test_notrip',
    tripId: null,
    paid: true,
    canceled: false,
    scheduled: true,
  })
  assert.deepEqual(parseCheckoutReturn('#/schedule'), {
    sessionId: null,
    tripId: null,
    paid: false,
    canceled: false,
    scheduled: true,
  })
  assert.deepEqual(parseCheckoutReturn('clemsonrides://schedule'), {
    sessionId: null,
    tripId: null,
    paid: false,
    canceled: false,
    scheduled: true,
  })
  assert.deepEqual(parseCheckoutReturn('cs_test_bare_only'), {
    sessionId: 'cs_test_bare_only',
    tripId: null,
    paid: false,
    canceled: false,
    scheduled: false,
  })
  assert.deepEqual(parseCheckoutReturn('https://x.test/#/requested?trip=only'), {
    sessionId: null,
    tripId: 'only',
    paid: false,
    canceled: false,
    scheduled: false,
  })
  assert.deepEqual(
    parseCheckoutReturn('#/schedule?paid=1&canceled=1&trip=both&session_id=cs_test_both'),
    { sessionId: 'cs_test_both', tripId: 'both', paid: true, canceled: true, scheduled: true },
  )
})

test('parseCheckoutReturn: trip, tripId, and trip_id fall through when earlier keys are empty', () => {
  assert.deepEqual(
    parseCheckoutReturn('?trip=fromTrip&tripId=fromTripId&trip_id=from_snake&paid=true&canceled=true'),
    { sessionId: null, tripId: 'fromTrip', paid: true, canceled: true, scheduled: false },
  )
  assert.deepEqual(
    parseCheckoutReturn('?trip=&tripId=fallback&paid=1&session_id=cs_test_f'),
    { sessionId: 'cs_test_f', tripId: 'fallback', paid: true, canceled: false, scheduled: false },
  )
  assert.deepEqual(parseCheckoutReturn('?trip=&tripId=&trip_id=snake&canceled=true'), {
    sessionId: null,
    tripId: 'snake',
    paid: false,
    canceled: true,
    scheduled: false,
  })
  assert.deepEqual(parseCheckoutReturn('?trip=%20abc%20&paid=true&canceled=1'), {
    sessionId: null,
    tripId: 'abc',
    paid: true,
    canceled: true,
    scheduled: false,
  })
  assert.equal(parseCheckoutReturn('?trip=t&paid=0&canceled=false').paid, false)
  assert.equal(parseCheckoutReturn('?trip=t&paid=0&canceled=false').canceled, false)
  assert.equal(parseCheckoutReturn('?trip=t&paid=false').paid, false)
  assert.equal(parseCheckoutReturn('?trip=t&scheduled=0').scheduled, false)
})

test('parseCheckoutReturn: blank trip text becomes an empty string and blocks the next id', () => {
  // BUG?: a whitespace-only trip is truthy, so tripId / trip_id are not consulted, and
  // String.trim() yields "" instead of null. The same blank object field clobbers a trip
  // that was already parsed from the URL.
  assert.equal(parseCheckoutReturn('https://x.test/#/requested?trip=%20%20%20&paid=1').tripId, '')
  assert.equal(parseCheckoutReturn('?trip=%20%20&tripId=fallback&paid=1').tripId, '')
  assert.equal(
    parseCheckoutReturn({
      url: 'https://x.test/#/requested?trip=fromurl&paid=1&session_id=cs_test_url',
      trip: ' ',
    }).tripId,
    '',
  )
})

test('parseCheckoutReturn: flag spellings and explicit scheduled on a live return', () => {
  assert.deepEqual(
    parseCheckoutReturn({
      tripId: '  fromId  ',
      paid: true,
      canceled: false,
      scheduled: true,
      sessionId: 'cs_test_b',
    }),
    { sessionId: 'cs_test_b', tripId: 'fromId', paid: true, canceled: false, scheduled: true },
  )
  assert.deepEqual(
    parseCheckoutReturn({ paid: 'true', canceled: 'true', scheduled: 'true', trip_id: 'snake' }),
    { sessionId: null, tripId: 'snake', paid: true, canceled: true, scheduled: true },
  )
  assert.deepEqual(parseCheckoutReturn({ canceled: true, trip_id: '  z  ' }), {
    sessionId: null,
    tripId: 'z',
    paid: false,
    canceled: true,
    scheduled: false,
  })
  assert.deepEqual(parseCheckoutReturn('#/requested?trip=t&scheduled=true'), {
    sessionId: null,
    tripId: 't',
    paid: false,
    canceled: false,
    scheduled: true,
  })
  assert.deepEqual(
    parseCheckoutReturn('clemsonrides://requested?trip=t&paid=1&scheduled=1&session_id=cs_test_s'),
    { sessionId: 'cs_test_s', tripId: 't', paid: true, canceled: false, scheduled: true },
  )
  assert.deepEqual(parseCheckoutReturn({ params: { trip: 'p', paid: '1', session_id: 'cs_test_p' } }), {
    sessionId: 'cs_test_p',
    tripId: 'p',
    paid: true,
    canceled: false,
    scheduled: false,
  })
})

test('parseCheckoutReturn: numeric 1 is not a paid, canceled, or scheduled flag', () => {
  // BUG?: object callers can pass numeric 1 (JSON numbers, Linking params coerced to numbers).
  // Only the string "1", the string "true", and boolean true count, so paid/canceled/scheduled stay false.
  assert.deepEqual(
    parseCheckoutReturn({ trip: 't', paid: 1, canceled: 1, scheduled: 1, sessionId: 'cs_test_n' }),
    { sessionId: 'cs_test_n', tripId: 't', paid: false, canceled: false, scheduled: false },
  )
})

test('parseCheckoutReturn: scheduled matches the substrings /schedule and schedule?', () => {
  // BUG?: scheduled is true whenever the raw text contains "/schedule" or "schedule?".
  // A live /requested return is marked scheduled when a query value holds those characters
  // (dest=/schedule, next=schedule?x=1), and so are /reschedule?, /unschedule?, and /schedule-demo.
  // scheduled=0, scheduled=false, and scheduled:false cannot turn the flag off once the path matches.
  // CheckoutDeepLink sends scheduled returns to /schedule, so a live trip would open the wrong screen.
  assert.equal(
    parseCheckoutReturn('clemsonrides://requested?trip=live1&paid=1&session_id=cs_test_a&dest=/schedule').scheduled,
    true,
  )
  assert.equal(
    parseCheckoutReturn('https://x.test/#/requested?trip=live1&paid=1&next=schedule?x=1&session_id=cs_test_a').scheduled,
    true,
  )
  assert.equal(
    parseCheckoutReturn('https://x.test/#/reschedule?trip=abc&paid=1&session_id=cs_test_a').scheduled,
    true,
  )
  assert.equal(
    parseCheckoutReturn('https://x.test/unschedule?trip=abc&paid=1&session_id=cs_test_a').scheduled,
    true,
  )
  assert.equal(
    parseCheckoutReturn('https://x.test/schedule-demo/#/requested?trip=live&paid=1&session_id=cs_test_a').scheduled,
    true,
  )
  assert.equal(
    parseCheckoutReturn('https://x.test/#/schedule?scheduled=false&scheduled=0&trip=t&paid=1').scheduled,
    true,
  )
  assert.equal(
    parseCheckoutReturn({
      url: 'https://x.test/#/schedule?paid=1&trip=t',
      scheduled: false,
    }).scheduled,
    true,
  )
  assert.equal(
    parseCheckoutReturn({
      url: 'https://x.test/#/requested?trip=t&paid=1',
      scheduled: false,
    }).scheduled,
    false,
  )
})

test('parseCheckoutReturn: duplicate session_id keeps the first value and duplicate trip keeps the last', () => {
  // BUG?: parseCheckoutSessionId uses the first session_id. The query map used for trip/paid/canceled
  // keeps the last value of each key. Search and hash can therefore name two different sessions.
  assert.deepEqual(
    parseCheckoutReturn('?session_id=cs_test_first&session_id=cs_test_second&trip=a&trip=b&paid=1'),
    { sessionId: 'cs_test_first', tripId: 'b', paid: true, canceled: false, scheduled: false },
  )
  assert.deepEqual(
    parseCheckoutReturn('https://x.test/?session_id=cs_test_search#/requested?trip=inhash&paid=1&session_id=cs_test_hash'),
    { sessionId: 'cs_test_search', tripId: 'inhash', paid: true, canceled: false, scheduled: false },
  )
})

test('parseCheckoutReturn: objects read url, then href, then hash, and params override the query', () => {
  assert.deepEqual(
    parseCheckoutReturn({ href: 'https://x.test/#/schedule?paid=true&trip=ht&session_id=cs_test_h' }),
    { sessionId: 'cs_test_h', tripId: 'ht', paid: true, canceled: false, scheduled: true },
  )
  assert.deepEqual(
    parseCheckoutReturn({ hash: '#/requested?trip=hh&canceled=1&session_id=cs_test_hash' }),
    { sessionId: 'cs_test_hash', tripId: 'hh', paid: false, canceled: true, scheduled: false },
  )
  assert.deepEqual(
    parseCheckoutReturn({
      sessionId: 'cs_test_top',
      url: 'https://x.test/#/requested?trip=fromurl&paid=1&session_id=cs_test_url',
    }),
    { sessionId: 'cs_test_top', tripId: 'fromurl', paid: true, canceled: false, scheduled: false },
  )
  assert.deepEqual(
    parseCheckoutReturn({
      url: 'https://x.test/#/requested?trip=fromurl&paid=1&session_id=cs_test_url',
      trip: 'fromobj',
      paid: false,
    }),
    { sessionId: 'cs_test_url', tripId: 'fromobj', paid: false, canceled: false, scheduled: false },
  )
  assert.deepEqual(
    parseCheckoutReturn({
      url: 'https://x.test/#/requested?trip=fromurl&paid=1&session_id=cs_test_url',
      params: { trip: 'fromparams', canceled: '1' },
    }),
    { sessionId: 'cs_test_url', tripId: 'fromparams', paid: true, canceled: true, scheduled: false },
  )
  assert.deepEqual(
    parseCheckoutReturn({
      url: 'https://x.test/?trip=fromurl&paid=1&session_id=cs_test_u',
      params: 'nope',
    }),
    { sessionId: 'cs_test_u', tripId: 'fromurl', paid: true, canceled: false, scheduled: false },
  )
  const urlObject = new URL('https://x.test/#/requested?trip=fromURL&paid=1&session_id=cs_test_urlobj')
  assert.deepEqual(parseCheckoutReturn(urlObject), {
    sessionId: 'cs_test_urlobj',
    tripId: 'fromURL',
    paid: true,
    canceled: false,
    scheduled: false,
  })
  assert.equal(parseCheckoutSessionId(urlObject), 'cs_test_urlobj')
})

test('parseCheckoutReturn: a non-string url falls through to href for the session id', () => {
  const mixed = { url: 1, href: 'https://x.test/#/requested?trip=fromhref&paid=1&session_id=cs_test_href' }
  assert.equal(parseCheckoutSessionId(mixed), 'cs_test_href')
  assert.deepEqual(parseCheckoutReturn(mixed), {
    sessionId: 'cs_test_href',
    tripId: 'fromhref',
    paid: true,
    canceled: false,
    scheduled: false,
  })
})

test('parseCheckoutReturn: a bad percent-escape keeps the raw trip text', () => {
  // The session id here is the loose query-string acceptance noted on parseCheckoutSessionId.
  assert.deepEqual(parseCheckoutReturn('?trip=%E0%A4%A&session_id=cs_test_%'), {
    sessionId: 'cs_test_%',
    tripId: '%E0%A4%A',
    paid: false,
    canceled: false,
    scheduled: false,
  })
})

test('parseCheckoutReturn: missing input returns the empty result and does not throw', () => {
  const empty = { sessionId: null, tripId: null, paid: false, canceled: false, scheduled: false }
  for (const input of [undefined, null, '', 0, false, 42, true, [], () => {}, Symbol('x'), 1n]) {
    assert.deepEqual(parseCheckoutReturn(input), empty)
  }
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
