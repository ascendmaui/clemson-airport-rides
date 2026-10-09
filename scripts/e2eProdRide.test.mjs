import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnvFile, assertE2EGuard, decideStripeMode, shouldContinueWithoutHold, errorDetail, main } from './e2e-prod-ride.mjs'

test('env parser supports literal values, quotes, comments, CRLF and export without expansion', () => {
  assert.deepEqual(parseEnvFile(`
# comment
export KEY = value\r
PASSWORD='a b # c=$NOT_EXPANDED'
DOUBLE="quoted # text" # trailing comment
EMPTY=
URL=https://example.com/a=b#fragment
COMMENT=value # comment
INVALID LINE
BAD="unclosed
NOPE="closed" garbage
KEY=last
`), { KEY: 'last', PASSWORD: 'a b # c=$NOT_EXPANDED', DOUBLE: 'quoted # text', EMPTY: '',
    URL: 'https://example.com/a=b#fragment', COMMENT: 'value' })
})

const emails = { E2E_RIDER_EMAIL: 'e2e+rider@clemsonrides.com', E2E_DRIVER_EMAIL: 'E2E+driver@clemsonrides.com' }
test('guard refuses without confirmation, including dry-check, and refuses either non-test account', () => {
  assert.throws(() => assertE2EGuard([], emails), /confirm-prod-e2e/)
  assert.throws(() => assertE2EGuard(['--dry-check'], emails), /confirm-prod-e2e/)
  for (const key of Object.keys(emails)) {
    assert.throws(() => assertE2EGuard(['--confirm-prod-e2e'], { ...emails, [key]: 'real@example.com' }), /Both emails/)
  }
  assert.doesNotThrow(() => assertE2EGuard(['--confirm-prod-e2e'], emails))
})

test('Stripe mode fails closed unless test key plus explicitly non-live retrieval', () => {
  assert.equal(decideStripeMode('pk_live_example', { livemode: false }), 'live')
  assert.equal(decideStripeMode('pk_test_example', { livemode: true }), 'live')
  assert.equal(decideStripeMode('pk_test_example', { livemode: false }, new Error('mismatch')), 'live')
  assert.equal(decideStripeMode('pk_test_example', { livemode: false }), 'test')
  assert.equal(decideStripeMode('pk_test_example', {}), 'live')
  assert.equal(decideStripeMode('pk_test_example', null), 'live')
  assert.equal(decideStripeMode('invalid', { livemode: false }), 'live')
})

test('continuation requires the flag, verified test mode, created trip and strict E2E marker', () => {
  const allowed = { flag: true, stripeMode: 'test', tripCreated: true, e2eFlag: true }
  assert.equal(shouldContinueWithoutHold(allowed), true)
  for (const [key, values] of Object.entries({ flag: [false, undefined, 'true'],
    stripeMode: ['live', undefined], tripCreated: [false, undefined], e2eFlag: [false, undefined, 'true'] })) {
    for (const value of values) assert.equal(shouldContinueWithoutHold({ ...allowed, [key]: value }), false)
  }
})

test('error details select messages and codes without dumping response credentials', () => {
  assert.equal(errorDetail({ error: { message: 'declined', code: 'card_declined', clientSecret: 'secret' },
    password: 'secret' }), 'declined; card_declined')
  assert.equal(errorDetail({ message: 'forbidden', code: '42501' }), 'forbidden; 42501')
  assert.equal(errorDetail({ error: 'failed', code: 'failed', failure: { code: 'failed' } }), 'failed')
  assert.equal(errorDetail(null), '')
  assert.equal(errorDetail('raw message'), 'raw message')
})

// These exercise the real CLI orchestration with all network calls intercepted locally.
// No production URL, account, key or credentials are used.
async function withMockRun({ args = ['--confirm-prod-e2e'], key = 'pk_test_fake', retrievalFails = false,
  failOnline = false, fullRide = false, noCard = false, failOffer = false, lostBookingResponse = false,
  payoutRls = false, failedHold = false, e2eFlag = true, directCharge = false,
  paymentOverride = {}, failTip = false, persistedError = true,
  tipCustom = true, tipPresets = [{ id: 'pct-20', cents: 160 }, { id: 'pct-15', cents: 120 }],
  tipPersisted = true, failTipOffer = false } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'e2e-ride-test-'))
  const filename = join(folder, 'env')
  await writeFile(filename, '')
  const config = { ...emails, E2E_ENV_FILE: filename, E2E_BASE_URL: 'https://app.invalid',
    SUPABASE_URL: 'https://supabase.invalid', SUPABASE_ANON_KEY: 'anon-fake-key', STRIPE_PUBLISHABLE_KEY: key,
    E2E_RIDER_PASSWORD: 'rider-fake-password', E2E_DRIVER_PASSWORD: 'driver-fake-password' }
  const previous = Object.fromEntries(Object.keys(config).map(k => [k, process.env[k]]))
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  const calls = [], logs = []
  let online = false
  let trip = null
  let defaultCard = !noCard
  Object.assign(process.env, config)
  console.log = line => logs.push(line)
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input)
    const body = options.body instanceof URLSearchParams ? Object.fromEntries(options.body)
      : options.body ? JSON.parse(String(options.body)) : undefined
    calls.push({ url, body, method: options.method || 'GET', authorization: new Headers(options.headers).get('authorization') })
    let result, status = 200
    if (url.includes('/auth/v1/token')) {
      const role = body.email.toLowerCase().includes('+rider') ? 'rider' : 'driver'
      result = { access_token: `fake-${role}-token`, refresh_token: `fake-${role}-refresh`, expires_in: 3600,
        token_type: 'bearer', user: { id: role, email: body.email } }
    } else if (url.endsWith('/api/healthz')) result = { ok: true, sha: 'test-sha' }
    else if (url.endsWith('/api/stripe-setup-intent')) result = { setupIntentId: 'seti_fake', clientSecret: 'seti_fake_secret_fake' }
    else if (url.startsWith('https://api.stripe.com/')) {
      status = retrievalFails ? 401 : 200
      result = retrievalFails ? { error: 'mode mismatch' } : { livemode: key.startsWith('pk_live_'), status: 'succeeded' }
    } else if (url.endsWith('/api/stripe-save-payment-method')) {
      defaultCard = true
      result = { ok: true, paymentMethodId: 'pm_saved' }
    } else if (url.includes('/rest/v1/profiles')) result = { stripe_default_pm_id: defaultCard ? 'pm_saved' : null }
    else if (url.includes('/rest/v1/driver_status')) {
      if (body) {
        if (failOnline && body.online) { status = 403; result = { message: 'online rejected' } }
        else { online = body.online; result = {} }
      } else result = { online }
    } else if (fullRide && url.endsWith('/api/quote-fare')) result = { fareCents: 800 }
    else if (fullRide && url.endsWith('?action=request-driver')) {
      trip = { id: 'trip_mock', rider_id: 'rider', driver_id: null, status: 'searching', fare_cents: 800,
        tier: 'standard', deposit_cents: 0, rider_note: body.note, metadata: { e2e_test: e2eFlag,
          offer_driver_id: 'driver', offer_phase: 'exclusive', offer_share_bps: 8000,
          fare_authorization: { status: 'requires_capture', paymentIntentId: 'pi_mock' } } }
      if (failedHold) {
        trip.metadata.fare_authorization = { status: 'failed' }
        if (persistedError) trip.metadata.outstanding_balance = { attempts: [
          { stripeError: { message: 'Stripe account is not eligible for holds' } },
          { stripeError: { message: `second attempt rider-fake-password ${key} fake-rider-token` } },
        ] }
      }
      if (lostBookingResponse) throw new Error('Simulated lost booking response')
      result = { trip, fareCents: 800, authorization: failedHold ? { ok: false, failure: { code: 'charge_failed' } }
        : { ok: true, authorization: { paymentIntentId: 'pi_mock' } } }
    } else if (fullRide && url.endsWith('?action=mark-offered')) {
      if (failOffer) { status = 503; result = { error: 'offer failed' } }
      else { trip.status = 'offered'; result = { ok: true } }
    } else if (fullRide && url.endsWith('?action=wait')) {
      assert.equal(body.action, 'arrive')
      trip.status = 'arrived'
      trip.arrived_at = new Date().toISOString()
      result = { trip }
    } else if (fullRide && url.endsWith('?action=settle')) {
      trip.status = body.action === 'complete' ? 'completed' : 'canceled'
      trip.metadata.fare_authorization.status = body.action === 'complete' ? (directCharge ? 'failed' : 'captured') : 'canceled'
      trip.metadata.payout = { amountCents: 640, status: 'pending' }
      result = { ok: true, status: trip.status, payment: { ok: true, method: 'card', status: 'succeeded', amountCents: 800, paymentIntentId: 'pi_mock', ...paymentOverride } }
    } else if (fullRide && url.endsWith('?action=tip-choice')) {
      assert.equal(options.headers.Authorization, 'Bearer fake-rider-token')
      assert.equal(body.tripId, trip.id)
      if (body.mode === 'offer') result = failTipOffer ? { ok: false, error: 'offer unavailable' }
        : { ok: true, mode: 'offer', presets: tipPresets,
          ...(tipCustom ? { custom: { minCents: 100, maxCents: 10000 } } : {}) }
      else {
        assert.equal(body.mode, 'record')
        const cents = body.choiceId === 'custom' ? Number(body.customDollars) * 100
          : tipPresets.find(row => row.id === body.choiceId)?.cents
        if (tipPersisted && !failTip) trip.tip_cents = cents
        result = failTip ? { ok: false, error: { message: 'tip declined', code: 'card_declined' } }
          : { ok: true, mode: 'record', choice: { id: body.choiceId, tipCents: cents,
            charged: tipPersisted, chargeStatus: tipPersisted ? 'charged' : 'no_card' },
            chargedTipCents: tipPersisted ? cents : 0,
            payment: { paymentIntentId: 'pi_tip_mock', status: tipPersisted ? 'succeeded' : 'failed',
              clientSecret: 'seti_fake_secret_fake' } }
      }
    }
    else if (fullRide && url.includes('/rest/v1/trips')) {
      if (options.method === 'PATCH') Object.assign(trip, body)
      result = options.headers?.Accept?.includes('vnd.pgrst.object') ? trip : [trip]
    } else if (fullRide && url.includes('/rest/v1/driver_applications')) result = { onboarding_status: 'approved' }
    else if (fullRide && url.includes('/rest/v1/rpc/women_only_pair_allowed')) result = true
    else if (fullRide && url.includes('/rest/v1/trip_events')) result = {}
    else if (fullRide && url.includes('/rest/v1/driver_payouts')) {
      status = payoutRls ? 403 : 200
      result = payoutRls ? { message: 'ledger forbidden' } : { trip_id: trip.id, driver_id: 'driver', amount_cents: 640, status: 'pending' }
    } else throw new Error('Unexpected mocked network request')
    return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const exitCode = await main(args)
    const summary = JSON.parse(logs.at(-1))
    for (const secret of [...Object.values(config).filter((v, i) => /PASSWORD|KEY/.test(Object.keys(config)[i])),
      'fake-rider-token', 'fake-driver-token', 'seti_fake_secret_fake']) {
      assert.equal(logs.join('\n').includes(secret), false, 'must not print credentials')
    }
    return { exitCode, summary, calls, logs, online, trip }
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(folder, { recursive: true, force: true })
  }
}

test('CLI refuses without flag before any network request', async () => {
  const result = await withMockRun({ args: [] })
  assert.equal(result.exitCode, 1)
  assert.deepEqual(result.calls, [])
  assert.equal(result.summary.steps[0].status, 'FAIL')
})

test('live key or failed Stripe retrieval exits successfully before card, presence or booking', async () => {
  for (const options of [{ key: 'pk_live_fake' }, { retrievalFails: true },
    { key: 'pk_live_fake', args: ['--confirm-prod-e2e', '--continue-without-hold'] },
    { retrievalFails: true, args: ['--confirm-prod-e2e', '--continue-without-hold'] }]) {
    const result = await withMockRun(options)
    assert.equal(result.exitCode, 0)
    assert.equal(result.summary.stripeMode, 'live')
    assert.equal(result.summary.tripId, null)
    assert.equal(result.summary.capturePayoutExercised, false)
    assert.equal(result.summary.steps.find(s => s.name === 'book').detail, 'live Stripe: refusing to place a real hold')
    assert.equal(result.calls.length, 5) // health, two sign-ins, setup and retrieval
  }
})

test('dry check signs in and checks mode without health, presence or booking', async () => {
  const result = await withMockRun({ args: ['--confirm-prod-e2e', '--dry-check'] })
  assert.equal(result.exitCode, 0)
  assert.equal(result.summary.stripeMode, 'test')
  assert.equal(result.calls.length, 4)
  assert.equal(result.summary.steps.find(s => s.name === 'card').status, 'SKIP')
})

test('a failed online step stops the ride and still sets driver offline', async () => {
  const result = await withMockRun({ failOnline: true })
  assert.equal(result.exitCode, 1)
  assert.equal(result.summary.steps.find(s => s.name === 'driver_online').status, 'FAIL')
  assert.match(result.summary.steps.find(s => s.name === 'driver_online').detail, /online rejected/)
  assert.equal(result.summary.steps.find(s => s.name === 'book').status, 'SKIP')
  assert.equal(result.summary.steps.find(s => s.name === 'cleanup').status, 'PASS')
  assert.equal(result.online, false)
  assert.ok(result.calls.some(c => c.body?.online === false))
})

test('test mode drives the real driverDesk lifecycle, saves a card and verifies capture/ledger', async () => {
  for (const payoutRls of [false, true]) {
    const result = await withMockRun({ fullRide: true, noCard: true, payoutRls })
    assert.equal(result.exitCode, 0, result.logs.join('\n'))
    assert.equal(result.summary.tripId, 'trip_mock')
    assert.equal(result.summary.capturedCents, 800)
    assert.equal(result.summary.capturePayoutExercised, true)
    assert.equal(result.trip.status, 'completed')
    assert.equal(result.trip.metadata.driver_payout_cents, 640)
    assert.equal(result.online, false)
    const completion = result.calls.findIndex(c => c.body?.action === 'complete')
    const tip = result.calls.findIndex(c => c.url.endsWith('?action=tip-choice'))
    assert.ok(result.calls.slice(completion + 1, tip).some(c => c.body?.online === false))
    assert.deepEqual(result.calls.filter(c => c.url.endsWith('?action=tip-choice')).map(c => c.body), [
      { mode: 'offer', tripId: 'trip_mock' },
      { mode: 'record', tripId: 'trip_mock', choiceId: 'custom', customDollars: '1' },
    ])
    const recorded = result.calls.findIndex(c => c.body?.mode === 'record')
    assert.ok(result.calls.slice(recorded + 1).some(c => c.url.includes('/rest/v1/trips')
      && c.method === 'GET' && c.authorization === 'Bearer fake-rider-token'))
    assert.match(result.summary.steps.find(s => s.name === 'tip').detail,
      /tip_cents 100; charged true; chargeStatus charged; chargedTipCents 100; paymentIntentId pi_tip_mock; status succeeded/)
  }
})

test('tip selects the smallest positive preset when custom is unavailable', async () => {
  const result = await withMockRun({ fullRide: true, tipCustom: false,
    tipPresets: [{ id: 'skip', cents: 0 }, { id: 'large', cents: 300 }, { id: 'small', cents: 100 }] })
  assert.equal(result.exitCode, 0, result.logs.join('\n'))
  assert.deepEqual(result.calls.find(c => c.body?.mode === 'record').body,
    { mode: 'record', tripId: 'trip_mock', choiceId: 'small' })
  assert.equal(result.trip.tip_cents, 100)
})

test('tip requires a usable offer and a positive persisted tip even when record is OK', async () => {
  for (const options of [{ tipPersisted: false }, { failTipOffer: true }, { tipCustom: false, tipPresets: [] }]) {
    const result = await withMockRun({ fullRide: true, ...options })
    assert.equal(result.exitCode, 1)
    const tip = result.summary.steps.find(s => s.name === 'tip')
    assert.equal(tip.status, 'FAIL')
    assert.equal(result.summary.steps.find(s => s.name === 'payout_ledger').status, 'SKIP')
    if (options.tipPersisted === false) assert.match(tip.detail, /positive tip_cents.*charged false.*chargeStatus no_card/)
    else assert.equal(result.calls.some(c => c.body?.mode === 'record'), false)
  }
})

test('offer failure or a lost booking response cancels exactly one trip and releases its hold', async () => {
  for (const options of [{ failOffer: true }, { lostBookingResponse: true }]) {
    const result = await withMockRun({ fullRide: true, ...options })
    assert.equal(result.exitCode, 1)
    assert.equal(result.summary.tripId, 'trip_mock')
    assert.equal(result.summary.steps.find(s => s.name === 'cleanup').status, 'PASS', result.logs.join('\n'))
    assert.equal(result.trip.status, 'canceled')
    assert.equal(result.trip.metadata.fare_authorization.status, 'canceled')
    assert.equal(result.online, false)
    assert.equal(result.calls.filter(c => c.url.endsWith('?action=request-driver')).length, 1)
    assert.equal(result.calls.filter(c => c.body?.action === 'cancel').length, 1)
  }
})

const continueArgs = ['--confirm-prod-e2e', '--continue-without-hold']

test('failed hold continues all later steps only with opt-in and still exits nonzero', async () => {
  for (const directCharge of [true, false]) {
    const result = await withMockRun({ fullRide: true, failedHold: true, directCharge, args: continueArgs })
    assert.equal(result.exitCode, 1, result.logs.join('\n'))
    const book = result.summary.steps.find(s => s.name === 'book')
    assert.equal(book.status, 'FAIL')
    assert.match(book.detail, /authorization code charge_failed/)
    assert.match(book.detail, /Stripe account is not eligible for holds/)
    assert.match(book.detail, /second attempt \[redacted\]/)
    for (const name of ['offer', 'accept', 'en_route', 'pickup', 'in_progress', 'complete', 'capture', 'tip', 'payout_ledger', 'cleanup']) {
      assert.equal(result.summary.steps.find(s => s.name === name).status, 'PASS', result.logs.join('\n'))
    }
    assert.match(result.summary.steps.find(s => s.name === 'capture').detail,
      directCharge ? /direct card charge succeeded/ : /captured hold/)
    assert.equal(result.summary.capturePayoutExercised, true)
    assert.equal(result.trip.status, 'completed')
    assert.equal(result.online, false)
  }
})

test('failed hold stops without opt-in; unmarked or lost-response bookings stop even with opt-in', async () => {
  for (const options of [{}, { e2eFlag: false, args: continueArgs }, { lostBookingResponse: true, args: continueArgs }]) {
    const result = await withMockRun({ fullRide: true, failedHold: true, ...options })
    assert.equal(result.exitCode, 1)
    assert.equal(result.summary.steps.find(s => s.name === 'book').status, 'FAIL')
    assert.equal(result.summary.steps.find(s => s.name === 'offer').status, 'SKIP')
    assert.equal(result.summary.steps.find(s => s.name === 'cleanup').status, 'PASS')
    assert.equal(result.trip.status, 'canceled')
  }
})

test('continuation tolerates unreadable persisted diagnostics and still enforces direct card settlement', async () => {
  const success = await withMockRun({ fullRide: true, failedHold: true, directCharge: true,
    persistedError: false, args: continueArgs })
  assert.equal(success.summary.steps.find(s => s.name === 'capture').status, 'PASS')
  for (const paymentOverride of [{ ok: false, error: 'charge rejected', code: 'charge_failed' },
    { method: 'credits' }, { status: 'requires_action' }]) {
    const result = await withMockRun({ fullRide: true, failedHold: true, directCharge: true,
      args: continueArgs, paymentOverride })
    assert.equal(result.summary.steps.find(s => s.name === 'capture').status, 'FAIL')
    assert.equal(result.summary.steps.find(s => s.name === 'tip').status, 'SKIP')
    if (paymentOverride.error) assert.match(result.summary.steps.find(s => s.name === 'capture').detail, /charge_failed.*charge rejected/)
  }
  const normal = await withMockRun({ fullRide: true, directCharge: true })
  assert.equal(normal.summary.steps.find(s => s.name === 'capture').status, 'FAIL')
})

test('HTTP and JSON failures include server diagnostics and stop later steps', async () => {
  const http = await withMockRun({ fullRide: true, failOffer: true })
  assert.match(http.summary.steps.find(s => s.name === 'offer').detail, /HTTP 503.*offer failed/)
  const json = await withMockRun({ fullRide: true, failedHold: true, args: continueArgs, failTip: true })
  assert.match(json.summary.steps.find(s => s.name === 'tip').detail, /tip declined.*card_declined/)
  assert.equal(json.summary.steps.find(s => s.name === 'payout_ledger').status, 'SKIP')
})
