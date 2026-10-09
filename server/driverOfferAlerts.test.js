import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRIVER_OFFER_ALERT_CHANNELS,
  buildOfferAlertPlan,
  dispatchDriverOfferAlert,
  isQuietForDriverOffer,
  notifyDriverOffer,
  offerAlertCopy,
} from './driverOfferAlerts.js'
import { rebroadcastMissedOffers } from './matchingRebroadcast.js'
import { seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'

function memorySb(seed = {}) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }))
  function rowsOf(table) {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }
  function from(table) {
    const state = { filters: [], op: 'select', payload: null }
    const api = {
      select() { return api },
      eq(col, val) {
        state.filters.push({ col, val })
        return api
      },
      match(row) {
        return state.filters.every((filter) => row[filter.col] === filter.val)
      },
      async maybeSingle() {
        const found = rowsOf(table).filter((row) => api.match(row))
        return { data: found[0] ? { ...found[0] } : null, error: null }
      },
      delete() { state.op = 'delete'; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      insert(payload) {
        state.op = 'insert'
        state.payload = payload
        return api
      },
      then(resolve) {
        if (state.op === 'delete') {
          tables[table] = rowsOf(table).filter((row) => !api.match(row))
        }
        if (state.op === 'update') {
          rowsOf(table).filter((row) => api.match(row)).forEach((row) => Object.assign(row, state.payload))
        }
        if (state.op === 'insert') {
          rowsOf(table).push({ id: `${table}-${rowsOf(table).length + 1}`, ...state.payload })
          resolve({ data: null, error: null })
          return
        }
        resolve({ data: rowsOf(table).filter((row) => api.match(row)), error: null })
      },
    }
    return api
  }
  return { sb: { from }, tables }
}

const trip = {
  id: 'trip-1',
  pickup_label: 'Memorial Stadium',
  dropoff_label: 'Tillman Hall',
}

test('offer alerts use exactly the four specified channels', () => {
  assert.deepEqual(DRIVER_OFFER_ALERT_CHANNELS, ['in_app', 'push', 'sms', 'email'])
  const plan = buildOfferAlertPlan({ pushTokenPresent: true, phoneOnFile: true, emailOnFile: true })
  assert.deepEqual(Object.keys(plan), [...DRIVER_OFFER_ALERT_CHANNELS])
  assert.equal(plan.push.reason, 'push_not_sent')
  assert.match(plan.push.gap, /does not block the send/)
  assert.equal(JSON.stringify(plan).includes('@'), false)
  assert.equal(offerAlertCopy(trip).body, 'Memorial Stadium → Tillman Hall')
})

test('push posts without an access token while sms and email stay no-send', async () => {
  const previous = process.env.DRIVER_OFFER_ALERT_EMAIL
  delete process.env.DRIVER_OFFER_ALERT_EMAIL
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('live send')
  }
  try {
    const db = memorySb({
      profiles: [{ id: 'driver-1', email: 'driver@example.com', phone: '8645550100', notification_prefs: { ride: true } }],
      driver_status: [{ driver_id: 'driver-1' }],
      driver_push_tokens: [{ driver_id: 'driver-1', token: 'ExponentPushToken[test]', platform: 'ios' }],
    })
    let senderCalls = 0
    let pushCall = null
    const result = await dispatchDriverOfferAlert(db.sb, {
      trip,
      driverId: 'driver-1',
      offerMarker: 'initial',
      now: new Date('2026-10-04T18:00:00.000Z'),
    }, {
      env: {},
      fetch: async (url, init) => {
        pushCall = { url, init }
        return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }] }) }
      },
      sendEmail: async () => {
        senderCalls += 1
        return { emailed: true }
      },
    })
    assert.equal(senderCalls, 0)
    assert.equal(result.channels.in_app.reason, 'open_driver_screen_only')
    assert.equal(result.channels.in_app.sent, false)
    assert.equal(pushCall.init.method, 'POST')
    assert.equal(Object.hasOwn(pushCall.init.headers, 'Authorization'), false)
    assert.equal(result.channels.push.reason, 'sent')
    assert.equal(result.channels.push.sent, true)
    assert.equal(result.channels.push.tokenPresent, true)
    assert.equal(result.channels.push.tokenKind, 'expo')
    assert.equal(db.tables.driver_offer_alerts[0].channels.push.tokenKind, 'expo')
    assert.equal(result.channels.sms.reason, 'live_send_disabled')
    assert.equal(result.channels.sms.phoneOnFile, true)
    assert.equal(result.channels.sms.sent, false)
    assert.equal(result.channels.email.reason, 'live_send_disabled')
    assert.equal(result.channels.email.sent, false)
    assert.equal(JSON.stringify(result).includes('@'), false)
    assert.equal(JSON.stringify(result).includes('ExponentPushToken'), false)
    assert.equal(JSON.stringify(db.tables.driver_offer_alerts[0]).includes('@'), false)
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.DRIVER_OFFER_ALERT_EMAIL
    else process.env.DRIVER_OFFER_ALERT_EMAIL = previous
  }
})

test('email uses the injected sender only when the live flag is send, and a repeat does not send again', async () => {
  const previous = process.env.DRIVER_OFFER_ALERT_EMAIL
  const previousKey = process.env.RESEND_API_KEY
  const previousFrom = process.env.RESEND_FROM
  process.env.DRIVER_OFFER_ALERT_EMAIL = 'send'
  process.env.RESEND_API_KEY = 'test_key'
  process.env.RESEND_FROM = 'offers@example.com'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('live send')
  }
  const sent = []
  try {
    const db = memorySb({
      profiles: [{ id: 'driver-1', email: 'driver@example.com' }],
      driver_status: [{ driver_id: 'driver-1' }],
    })
    const deps = {
      sendEmail: async (payload) => {
        sent.push(payload)
        return { emailed: true, id: 'email_test' }
      },
    }
    const first = await dispatchDriverOfferAlert(db.sb, {
      trip,
      driverId: 'driver-1',
      offerMarker: 'initial',
    }, deps)
    const second = await dispatchDriverOfferAlert(db.sb, {
      trip,
      driverId: 'driver-1',
      offerMarker: 'initial',
    }, deps)
    assert.equal(first.channels.email.sent, true)
    assert.equal(second.duplicate, true)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'driver@example.com')
    assert.equal(sent[0].subject, 'New ride request')
    assert.equal(db.tables.driver_offer_alerts.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.DRIVER_OFFER_ALERT_EMAIL
    else process.env.DRIVER_OFFER_ALERT_EMAIL = previous
    if (previousKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousKey
    if (previousFrom === undefined) delete process.env.RESEND_FROM
    else process.env.RESEND_FROM = previousFrom
  }
})

test('quiet hours and the ride toggle suppress every channel', async () => {
  const db = memorySb({
    profiles: [{
      id: 'driver-1',
      email: 'driver@example.com',
      phone: '8645550100',
      notification_prefs: {
        ride: true,
        quiet: { dnd: false, scheduleEnabled: true, start: '22:00', end: '07:00' },
      },
    }],
    driver_status: [{ driver_id: 'driver-1', expo_push_token: 'token' }],
  })
  const quiet = await dispatchDriverOfferAlert(db.sb, {
    trip,
    driverId: 'driver-1',
    offerMarker: 'quiet',
    now: new Date('2026-10-04T06:30:00.000Z'),
  })
  assert.equal(isQuietForDriverOffer(db.tables.profiles[0].notification_prefs, new Date('2026-10-04T06:30:00.000Z')), true)
  assert.equal(isQuietForDriverOffer(db.tables.profiles[0].notification_prefs, new Date('2026-10-04T18:00:00.000Z')), false)
  for (const channel of DRIVER_OFFER_ALERT_CHANNELS) {
    assert.equal(quiet.channels[channel].sent, false)
    assert.equal(quiet.channels[channel].reason, 'quiet_hours')
  }

  const muted = memorySb({
    profiles: [{ id: 'driver-2', email: 'driver@example.com', notification_prefs: { ride: false } }],
  })
  const off = await dispatchDriverOfferAlert(muted.sb, {
    trip: { ...trip, id: 'trip-2' },
    driverId: 'driver-2',
    offerMarker: 'muted',
    now: new Date('2026-10-04T18:00:00.000Z'),
  })
  for (const channel of DRIVER_OFFER_ALERT_CHANNELS) {
    assert.equal(off.channels[channel].reason, 'ride_alerts_off')
  }
})

test('a client without an alert insert still returns the four no-send channels', async () => {
  const result = await dispatchDriverOfferAlert({
    from() {
      return { select() { return this }, eq() { return this }, async maybeSingle() { return { data: null, error: null } } }
    },
  }, { trip, driverId: 'driver-1', offerMarker: 'initial' })
  assert.equal(result.ok, true)
  assert.equal(result.recorded, false)
  assert.deepEqual(Object.keys(result.channels), [...DRIVER_OFFER_ALERT_CHANNELS])
  assert.equal(result.channels.email.sent, false)
})

test('a failed alert write does not throw out of the offer', async () => {
  const result = await notifyDriverOffer({
    from() {
      throw new Error('relation driver_offer_alerts does not exist')
    },
  }, { trip, driverId: 'driver-1', offerMarker: 'initial' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'alert_failed')
})

test('rebroadcast alerts the next driver and a dry run does not', async () => {
  const now = new Date('2026-10-04T12:01:00.000Z')
  const { supabase } = seedMatchingScenario({
    trip: {
      offer_expires_at: now.toISOString(),
      deposit_cents: 0,
      metadata: {
        kind: 'driver_request',
        match: 'auto',
        offer_driver_id: 'driver-1',
        auto_assign_queue: ['driver-1', 'driver-2'],
      },
    },
  })
  const calls = []
  const alertDriver = async (_sb, input) => {
    calls.push(input.driverId)
    return { ok: true }
  }
  const dry = await rebroadcastMissedOffers(supabase, { now, dryRun: true, alertDriver })
  assert.equal(dry.wouldAdvance, 1)
  assert.deepEqual(calls, [])
  const live = await rebroadcastMissedOffers(supabase, { now, alertDriver })
  assert.equal(live.pooled, 1)
  assert.equal(live.advanced, 1)
  assert.deepEqual(calls, ['driver-1', 'driver-2'])
})

for (const ticketShape of ['array', 'object']) {
  test(`DeviceNotRegistered ${ticketShape} ticket removes only the stale private token`, async () => {
    const db = memorySb({ driver_push_tokens: [
      { driver_id: 'driver-1', token: 'ExpoPushToken[stale]' },
      { driver_id: 'driver-2', token: 'ExpoPushToken[other]' },
    ] })
    const ticket = { status: 'error', details: { error: 'DeviceNotRegistered' } }
    const result = await dispatchDriverOfferAlert(db.sb, { trip, driverId: 'driver-1', offerMarker: 'initial' }, {
      env: {}, fetch: async () => ({ ok: true, json: async () => ({ data: ticketShape === 'array' ? [ticket] : ticket }) }),
    })
    assert.equal(result.channels.push.reason, 'device_not_registered')
    assert.equal(result.channels.push.tokenKind, 'expo')
    assert.deepEqual(db.tables.driver_push_tokens.map(row => row.driver_id), ['driver-2'])
    assert.equal(db.tables.driver_offer_alerts[0].channels.push.reason, 'device_not_registered')
  })
}

test('raw APNs token is audited but never sent to Expo', async () => {
  const db = memorySb({ driver_push_tokens: [{ driver_id: 'driver-1', token: 'a'.repeat(64) }] })
  const result = await dispatchDriverOfferAlert(db.sb, { trip, driverId: 'driver-1', offerMarker: 'raw' }, {
    fetch: async () => { assert.fail('raw token reached Expo') },
  })
  assert.equal(result.channels.push.sent, false)
  assert.equal(result.channels.push.reason, 'raw_device_token_unsupported')
  assert.equal(result.channels.push.tokenKind, 'raw')
  assert.equal(db.tables.driver_push_tokens.length, 1)
  assert.equal(db.tables.driver_offer_alerts[0].channels.push.tokenKind, 'raw')
})

test('rejected-token cleanup preserves a concurrently refreshed token', async () => {
  const db = memorySb({ driver_push_tokens: [{ driver_id: 'driver-1', token: 'ExpoPushToken[stale]' }] })
  const result = await dispatchDriverOfferAlert(db.sb, { trip, driverId: 'driver-1', offerMarker: 'refresh' }, {
    env: {}, fetch: async () => {
      db.tables.driver_push_tokens[0].token = 'ExpoPushToken[fresh]'
      return { ok: true, json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) }
    },
  })
  assert.equal(result.channels.push.reason, 'device_not_registered')
  assert.equal(db.tables.driver_push_tokens[0].token, 'ExpoPushToken[fresh]')
})

test('cleanup exceptions do not abort alert recording', async () => {
  const db = memorySb({ driver_push_tokens: [{ driver_id: 'driver-1', token: 'ExpoPushToken[stale]' }] })
  const from = db.sb.from
  db.sb.from = (table) => {
    const query = from(table)
    if (table === 'driver_push_tokens') query.delete = () => { throw new Error('cleanup unavailable') }
    return query
  }
  const result = await dispatchDriverOfferAlert(db.sb, { trip, driverId: 'driver-1', offerMarker: 'cleanup' }, {
    env: {}, fetch: async () => ({ ok: true, json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) }),
  })
  assert.equal(result.recorded, true)
  assert.equal(db.tables.driver_offer_alerts[0].channels.push.reason, 'device_not_registered')
})
