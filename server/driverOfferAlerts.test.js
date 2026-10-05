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
      insert(payload) {
        state.op = 'insert'
        state.payload = payload
        return api
      },
      then(resolve) {
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
  assert.equal(JSON.stringify(plan).includes('@'), false)
  assert.equal(offerAlertCopy(trip).body, 'Memorial Stadium → Tillman Hall')
})

test('push, sms, and email stay no-send without a live flag, even when contact data exists', async () => {
  const previous = process.env.DRIVER_OFFER_ALERT_EMAIL
  const previousPush = process.env.DRIVER_OFFER_ALERT_PUSH
  delete process.env.DRIVER_OFFER_ALERT_EMAIL
  delete process.env.DRIVER_OFFER_ALERT_PUSH
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('live send')
  }
  try {
    const db = memorySb({
      profiles: [{ id: 'driver-1', email: 'driver@example.com', phone: '8645550100', notification_prefs: { ride: true } }],
      driver_status: [{ driver_id: 'driver-1', expo_push_token: 'ExponentPushToken[test]' }],
      driver_push_tokens: [],
    })
    let senderCalls = 0
    const result = await dispatchDriverOfferAlert(db.sb, {
      trip,
      driverId: 'driver-1',
      offerMarker: 'initial',
      now: new Date('2026-10-04T18:00:00.000Z'),
    }, {
      sendEmail: async () => {
        senderCalls += 1
        return { emailed: true }
      },
    })
    assert.equal(senderCalls, 0)
    assert.equal(result.channels.in_app.reason, 'open_driver_screen_only')
    assert.equal(result.channels.in_app.sent, false)
    assert.equal(result.channels.push.reason, 'push_sender_missing')
    assert.equal(result.channels.push.sent, false)
    assert.equal(result.channels.push.tokenPresent, true)
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
    if (previousPush === undefined) delete process.env.DRIVER_OFFER_ALERT_PUSH
    else process.env.DRIVER_OFFER_ALERT_PUSH = previousPush
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

test('APNs sends only a device token when the push flag and credentials are set', async () => {
  const previous = {
    DRIVER_OFFER_ALERT_PUSH: process.env.DRIVER_OFFER_ALERT_PUSH,
    APNS_KEY_ID: process.env.APNS_KEY_ID,
    APNS_TEAM_ID: process.env.APNS_TEAM_ID,
    APNS_KEY_P8: process.env.APNS_KEY_P8,
    APNS_TOPIC: process.env.APNS_TOPIC,
    APNS_ENV: process.env.APNS_ENV,
  }
  process.env.DRIVER_OFFER_ALERT_PUSH = 'send'
  process.env.APNS_KEY_ID = 'KEYID123'
  process.env.APNS_TEAM_ID = 'L85AF3V872'
  process.env.APNS_KEY_P8 = '-----BEGIN PRIVATE KEY-----\nnot-used\n-----END PRIVATE KEY-----'
  process.env.APNS_TOPIC = 'com.ascendmaui.clemsonrides.driver'
  process.env.APNS_ENV = 'sandbox'
  const device = 'ab'.repeat(32)
  try {
    const expoOnly = memorySb({
      profiles: [{ id: 'driver-1', email: 'driver@example.com', phone: '8645550100' }],
      driver_status: [{ driver_id: 'driver-1', expo_push_token: 'ExponentPushToken[test]' }],
    })
    let sends = 0
    const skipped = await dispatchDriverOfferAlert(expoOnly.sb, {
      trip,
      driverId: 'driver-1',
      offerMarker: 'expo',
    }, {
      sendApns: async () => {
        sends += 1
        return { sent: true }
      },
      sendEmail: async () => ({ emailed: false }),
    })
    assert.equal(sends, 0)
    assert.equal(skipped.channels.push.sent, false)
    assert.equal(skipped.channels.push.reason, 'apns_device_token_missing')
    assert.equal(skipped.channels.sms.reason, 'live_send_disabled')
    assert.equal(JSON.stringify(skipped).includes('ExponentPushToken'), false)

    const ready = memorySb({
      profiles: [{ id: 'driver-1', phone: '8645550100' }],
      driver_status: [{ driver_id: 'driver-1', expo_push_token: 'ExponentPushToken[test]', apns_device_token: device }],
    })
    const sent = []
    const result = await dispatchDriverOfferAlert(ready.sb, {
      trip,
      driverId: 'driver-1',
      offerMarker: 'device',
    }, {
      sendApns: async (input) => {
        sent.push(input)
        return { sent: true, reason: null }
      },
    })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].token, device)
    assert.equal(result.channels.push.sent, true)
    assert.equal(result.channels.push.reason, null)
    assert.equal(JSON.stringify(result).includes(device), false)
    assert.equal(JSON.stringify(ready.tables.driver_offer_alerts[0]).includes(device), false)
    assert.equal(result.channels.sms.sent, false)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
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
  assert.equal(live.advanced, 1)
  assert.deepEqual(calls, ['driver-2'])
})
