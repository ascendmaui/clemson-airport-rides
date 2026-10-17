/**
 * Web booking → driver, end to end, with no network:
 *   1. a WEB rider books through src/lib/trips.js (the same request-driver
 *      endpoint the native Rider app calls),
 *   2. the server dispatches (auto-assign) and alerts the driver: Expo push
 *      (mocked fetch) plus the driver_offer_alerts in-app record,
 *   3. the trip shows in the driver's available list through the same
 *      visibleOfferQuery the web console and the native Driver app use,
 *   4. the driver accepts with the shared driverDesk.acceptTrip, and
 *   5. completes through /api/driver?action=trip-status, capturing the card hold.
 * Plus the web driver console gate (approved vs. unapproved), sign-in routing,
 * the pickup-code check, today's earnings, and the Apple flag.
 */
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { memorySupabase } from './fixtures/memorySupabase.js'
import { tripCompletionDb } from './fixtures/tripCompletionDb.js'

const RIDER = '33333333-3333-4333-8333-333333333333'
const DRIVER = '11111111-1111-4111-8111-111111111111'
const PENDING = '55555555-5555-4555-8555-555555555555'
const IDLE = '66666666-6666-4666-8666-666666666666'
const PUSH_TOKEN = 'ExponentPushToken[web-booking-test]'

// The web client module under test, with ./payments swapped for a forwarder
// into the real server handler (same trick as src/lib/trips.test.js).
const fakePaymentsUrl = new URL('../src/lib/payments.js', import.meta.url)
fakePaymentsUrl.searchParams.set('deputyMock', 'webDriverConsole')
const slot = globalThis.__clemsonWebDriverConsole = { calls: [], forward: null }
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/src/lib/trips.js') && (specifier === './payments' || specifier === './payments.js')) {
      return { shortCircuit: true, url: fakePaymentsUrl.href }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url !== fakePaymentsUrl.href) return nextLoad(url, context)
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        const slot = globalThis.__clemsonWebDriverConsole
        export async function createServerDriverTrip(body) {
          slot.calls.push({ action: 'request-driver', body: structuredClone(body) })
          return slot.forward(body)
        }
      `,
    }
  },
})

const { requestDriverTrip: webRequestDriverTrip } = await import('../src/lib/trips.js')
const { default: requestDriverHandler } = await import('../server/endpoints/requestDriverTrip.js')
const { default: tripStatusEndpoint } = await import('../server/endpoints/tripStatus.js')
const { acceptTrip } = await import('../packages/rides-native/driverDesk.js')
const { offerVisibleToDriver, visibleOfferQuery } = await import('../shared/driverOrder.js')
const web = await import('../src/lib/webDriverConsole.js')

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function callHandler(handler, body, deps) {
  const res = mockRes()
  await handler({ method: 'POST', headers: {}, body, url: '/api' }, res, deps)
  const json = res.body ? JSON.parse(res.body) : null
  return { status: res.statusCode, json }
}

function fakeStripe() {
  const calls = { create: [], capture: [], transfers: 0 }
  let status = 'requires_capture'
  return {
    calls,
    paymentIntents: {
      create: async (params) => { calls.create.push(params); return { id: 'pi_web_hold', status: 'requires_capture', amount: params.amount, capture_method: params.capture_method } },
      retrieve: async () => ({ id: 'pi_web_hold', status }),
      capture: async (id, params = {}) => { calls.capture.push({ id, params }); status = 'succeeded'; return { id, status: 'succeeded', amount_received: params.amount_to_capture || 1000 } },
      cancel: async (id) => ({ id, status: 'canceled' }),
    },
    transfers: { create: async () => { calls.transfers += 1; return { id: 'tr_web' } } },
  }
}

function fleet() {
  return memorySupabase({
    profiles: [
      { id: RIDER, email: 'rider@example.com', full_name: 'Ava Rider', stripe_customer_id: 'cus_rider', stripe_default_pm_id: 'pm_rider' },
      { id: DRIVER, email: 'driver@example.com', full_name: 'Dee Driver', notification_prefs: null },
      { id: PENDING, email: 'pending@example.com', full_name: 'Pat Pending' },
      { id: IDLE, email: 'idle@example.com', full_name: 'Ida Idle' },
    ],
    driver_applications: [
      { profile_id: DRIVER, onboarding_status: 'approved' },
      { profile_id: PENDING, onboarding_status: 'pending_review' },
      { profile_id: IDLE, onboarding_status: 'approved' },
    ],
    driver_status: [
      { driver_id: DRIVER, online: true },
      { driver_id: PENDING, online: true },
      { driver_id: IDLE, online: false },
    ],
    driver_push_tokens: [{ driver_id: DRIVER, token: PUSH_TOKEN, platform: 'ios' }],
  }, { rpc: { women_only_pair_allowed: () => true } })
}

/** Book on the web as the rider, the way PickDriver's "Request next driver" does. */
async function bookOnWeb(sb, { stripe = fakeStripe() } = {}) {
  const pushes = []
  const pushFetch = async (url, init) => {
    pushes.push({ url, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-web-1' } }), { status: 200 })
  }
  slot.forward = async (body) => {
    const out = await callHandler(requestDriverHandler, body, {
      sb,
      user: { id: RIDER, email: 'rider@example.com', user_metadata: { full_name: 'Ava Rider' } },
      ensureProfile: async () => ({ ok: true }),
      stripe,
      fetch: pushFetch,
      env: {},
    })
    if (out.status !== 200) throw Object.assign(new Error(out.json?.error || 'request failed'), { status: out.status, payload: out.json })
    return out.json
  }
  const trip = await webRequestDriverTrip({
    riderId: RIDER,
    autoAssign: true,
    dest: 'Downtown Clemson',
    destLat: 34.6834,
    destLng: -82.8374,
    pickupLabel: 'Cooper Library',
    pickupLat: 34.6766,
    pickupLng: -82.8366,
    tier: 'standard',
  })
  return { trip, pushes, stripe }
}

/** Route the shared driver desk's API calls into the real trip-status endpoint. */
function withDriverApi(sb, user, run) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/driver?action=trip-status')) {
      const out = await callHandler(tripStatusEndpoint, JSON.parse(init.body || '{}'), { sb, user })
      return new Response(JSON.stringify(out.json), { status: out.status, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  return Promise.resolve(run()).finally(() => { globalThis.fetch = original })
}

test('a web booking uses the same request-driver endpoint as the native Rider app', () => {
  const webClient = readFileSync(new URL('../src/lib/payments.js', import.meta.url), 'utf8')
  const nativeClient = readFileSync(new URL('../packages/rides-native/drivers.js', import.meta.url), 'utf8')
  const api = readFileSync(new URL('../api/stripe-payment-methods.js', import.meta.url), 'utf8')
  assert.match(webClient, /createServerDriverTrip[\s\S]{0,120}\/api\/stripe-payment-methods\?action=request-driver/)
  assert.match(nativeClient, /\/api\/stripe-payment-methods\?action=request-driver/)
  assert.match(api, /'request-driver': handleRequestDriverTrip/)
  assert.match(api, /import handleRequestDriverTrip from '\.\.\/server\/endpoints\/requestDriverTrip\.js'/)
})

test('web booking is matched by server dispatch and the driver gets an Expo push and an in-app alert record', async () => {
  const sb = fleet()
  const { trip, pushes, stripe } = await bookOnWeb(sb)
  assert.equal(slot.calls.at(-1).body.autoAssign, true, 'web sends autoAssign like the native Rider app')

  const row = sb.tables.trips.find((t) => t.id === trip.id)
  assert.equal(row.status, 'searching')
  assert.equal(row.rider_id, RIDER)
  assert.equal(row.driver_id ?? null, null)
  assert.equal(row.metadata.match, 'auto')
  assert.equal(row.metadata.offer_driver_id, DRIVER, 'dispatch picked the only approved, online driver')
  assert.equal(row.metadata.fare_source, 'server')
  assert.ok(!row.deposit_cents, 'no deposit: card hold only')
  assert.equal(stripe.calls.create.length, 1, 'one card hold at request')
  assert.equal(stripe.calls.create[0].capture_method, 'manual')
  assert.equal(row.metadata.fare_authorization.status, 'requires_capture')

  assert.equal(pushes.length, 1, 'exactly one push')
  assert.match(pushes[0].url, /exp\.host\/--\/api\/v2\/push\/send/)
  assert.equal(pushes[0].body.to, PUSH_TOKEN)
  assert.equal(pushes[0].body.title, 'New ride request')
  assert.equal(pushes[0].body.data.tripId, trip.id)

  const alert = sb.tables.driver_offer_alerts.find((a) => a.trip_id === trip.id)
  assert.equal(alert.driver_id, DRIVER)
  assert.equal(alert.offer_marker, 'initial')
  assert.equal(alert.channels.push.sent, true)
  assert.equal(alert.channels.in_app.reason, 'open_driver_screen_only')
  assert.ok(sb.tables.trip_events.some((e) => e.trip_id === trip.id && e.kind === 'requested'))
})

test('the web booking appears in the matched driver\'s available rides exactly like a native booking', async () => {
  const sb = fleet()
  const { trip } = await bookOnWeb(sb)
  const listFor = async (driverId) => {
    const { data } = await visibleOfferQuery(sb.from('trips').select('*').in('status', ['searching', 'offered']), driverId)
    return data.filter((row) => offerVisibleToDriver(row, driverId)).map((row) => row.id)
  }
  assert.deepEqual(await listFor(DRIVER), [trip.id])
  assert.deepEqual(await listFor(IDLE), [], 'an exclusive offer is not shown to other drivers')

  // One query for every driver surface: web console, web watcher, native desk.
  for (const path of ['src/screens/DriverHome.jsx', 'src/components/DriverOfferWatcher.jsx', 'packages/rides-native/driverDesk.js']) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /visibleOfferQuery\(/, path)
  }
  const watcher = readFileSync(new URL('../src/components/DriverOfferWatcher.jsx', import.meta.url), 'utf8')
  assert.match(watcher, /postgres_changes', \{ event: '\*', schema: 'public', table: 'trips' \}/, 'web console listens on Supabase realtime')
})

test('the approved driver accepts the web booking with the shared driver desk; an unapproved one cannot', async () => {
  const sb = fleet()
  const { trip } = await bookOnWeb(sb)

  sb.tables.trips.find((t) => t.id === trip.id).metadata.offer_driver_id = null // open pool for the gate check
  await withDriverApi(sb, { id: PENDING }, async () => {
    await assert.rejects(() => acceptTrip(sb, { id: trip.id }, PENDING), /approval|under review/i)
  })
  assert.equal(sb.tables.trips.find((t) => t.id === trip.id).driver_id ?? null, null)
  sb.tables.trips.find((t) => t.id === trip.id).metadata.offer_driver_id = DRIVER

  const accepted = await withDriverApi(sb, { id: DRIVER }, () => acceptTrip(sb, { id: trip.id }, DRIVER))
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.driver_id, DRIVER)
  const code = sb.tables.trip_pickup_codes?.find((c) => c.trip_id === trip.id)?.code
  assert.ok(code && /^[A-Z2-9]{2,3}$/.test(code), 'accept issues the pickup code the rider shows')
  assert.ok(sb.tables.trip_events.some((e) => e.trip_id === trip.id && e.kind === 'accepted'))
})

test('the driver completes the web-booked trip and the card hold is captured through trip-status', async () => {
  const sb = fleet()
  const stripe = fakeStripe()
  const { trip } = await bookOnWeb(sb, { stripe })
  await withDriverApi(sb, { id: DRIVER }, () => acceptTrip(sb, { id: trip.id }, DRIVER))
  const arriving = await callHandler(tripStatusEndpoint, { tripId: trip.id, op: 'arriving' }, { sb, user: { id: DRIVER } })
  assert.equal(arriving.status, 200)
  assert.equal(arriving.json.trip.status, 'arriving')

  // Arrive and start run through the wait timer; completion is the money step.
  const live = { ...structuredClone(sb.tables.trips.find((t) => t.id === trip.id)), status: 'in_progress' }
  const db = tripCompletionDb(live, { profiles: [
    { id: RIDER, stripe_customer_id: 'cus_rider', stripe_default_pm_id: 'pm_rider' },
    { id: DRIVER, stripe_account_id: 'acct_driver' },
  ] })
  const res = mockRes()
  await tripStatusEndpoint({ method: 'POST', headers: {}, body: { tripId: trip.id, op: 'complete' } }, res, { sb: db, user: { id: DRIVER }, stripeClient: () => stripe })
  const out = JSON.parse(res.body)
  assert.equal(res.statusCode, 200, JSON.stringify(out))
  assert.equal(out.trip.status, 'completed')
  assert.equal(stripe.calls.capture.length, 1, 'captures the hold placed at web booking')
  assert.equal(stripe.calls.capture[0].id, 'pi_web_hold')
  assert.equal(stripe.calls.create.length, 1, 'no second charge')

  const today = web.todayDriverEarnings([{ ...out.trip, completed_at: new Date().toISOString() }])
  assert.equal(today.trips, 1)
  assert.ok(today.cents > 0 && today.cents < out.trip.fare_cents, 'today shows the driver share, not the gross fare')
})

test('web driver console gate: only approved drivers get the console; others get the status page', () => {
  assert.deepEqual(web.webDriverConsoleAccess({ onboarding_status: 'approved' }), { allowed: true, status: 'approved' })
  for (const status of ['pending_info', 'pending_docs', 'pending_review', 'rejected']) {
    assert.deepEqual(web.webDriverConsoleAccess({ onboarding_status: status }), { allowed: false, status })
  }
  assert.deepEqual(web.webDriverConsoleAccess(null), { allowed: false, status: 'none' })
  const home = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
  assert.match(home, /if \(!approved && !activeTrip\) \{\s*return <DriverApprovalGate application=\{application\} \/>/)
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /case 'driver':\s*return \(\s*<RequireAuth>\s*<DriverHome/)
  assert.match(app, /case 'driver-sign-in':\s*return <DriverSignIn \/>/)
})

test('signed-out drivers go to the driver sign-in (email, Google, Apple behind a flag)', async () => {
  for (const path of ['driver', 'earnings', 'driver-payouts', 'driver-w9']) assert.equal(web.driverSignInTarget(path), 'driver-sign-in')
  for (const path of ['account', 'admin', 'home']) assert.equal(web.driverSignInTarget(path), null)
  const guard = readFileSync(new URL('../src/components/RequireAuth.jsx', import.meta.url), 'utf8')
  assert.match(guard, /driverSignInTarget\(path\)/)

  const saved = globalThis.window
  try {
    const { getHashRoute } = await import('../src/lib/navigation.js')
    for (const pathname of ['/driver/sign-in', '/driver/login']) {
      globalThis.window = { location: { pathname, hash: '', search: '', origin: 'https://clemsonrides.com' }, sessionStorage: { getItem() { return null }, setItem() {} } }
      assert.equal(getHashRoute().path, 'driver-sign-in', pathname)
    }
    globalThis.window = { location: { pathname: '/driver', hash: '', search: '', origin: 'https://clemsonrides.com' }, sessionStorage: { getItem() { return null }, setItem() {} } }
    assert.equal(getHashRoute().path, 'driver')
  } finally {
    globalThis.window = saved
  }

  const screen = readFileSync(new URL('../src/screens/DriverSignIn.jsx', import.meta.url), 'utf8')
  assert.match(screen, /signInWithPassword|signIn\(email\.trim\(\), password\)/)
  assert.match(screen, /\{APPLE_ON && \(/, 'Apple button renders only when the flag is on')
  assert.equal(web.appleWebSignInEnabled({}), false, 'off by default')
  assert.equal(web.appleWebSignInEnabled({ VITE_APPLE_WEB_SIGNIN: '1' }), true)
  const auth = readFileSync(new URL('../src/lib/auth.jsx', import.meta.url), 'utf8')
  assert.match(auth, /provider: 'apple'/)
})

test('pickup code check: Start unlocks only on the rider\'s code; no code never blocks', () => {
  assert.deepEqual(web.pickupCodeState({ expected: 'K7Q', entered: '' }), { required: true, verified: false, mismatch: false })
  assert.deepEqual(web.pickupCodeState({ expected: 'K7Q', entered: 'k7q' }), { required: true, verified: true, mismatch: false })
  assert.deepEqual(web.pickupCodeState({ expected: 'K7Q', entered: 'K7A' }), { required: true, verified: false, mismatch: true })
  assert.deepEqual(web.pickupCodeState({ expected: null, entered: '' }), { required: false, verified: true, mismatch: false })
  const home = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
  assert.match(home, /onStart=\{activeTrip\.status === 'arrived' && pickupCheck\.verified \?/)
})

test('web-only drivers get a browser notification for a new offer when the tab is hidden', async () => {
  const shown = []
  function FakeNotification(title, options) { shown.push({ title, ...options }) }
  FakeNotification.permission = 'granted'
  assert.equal(web.showBrowserOfferNotice({ title: 'New ride offer', body: 'A → B', tag: 'offer-1' }, { Notification: FakeNotification, document: { hidden: true } }), true)
  assert.equal(web.showBrowserOfferNotice({ title: 'x', body: 'y' }, { Notification: FakeNotification, document: { hidden: false } }), false, 'visible tab uses the toast + chime')
  FakeNotification.permission = 'denied'
  assert.equal(web.showBrowserOfferNotice({ title: 'x', body: 'y' }, { Notification: FakeNotification, document: { hidden: true } }), false)
  assert.equal(shown.length, 1)
  assert.equal(await web.requestBrowserOfferPermission({}), 'unsupported')
})
