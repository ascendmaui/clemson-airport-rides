import assert from 'node:assert/strict'
import test from 'node:test'
import handler from './endpoints/weeklyCoupon.js'
import { runFridayDrop } from './weeklyCouponDrop.js'

const NOON = new Date('2026-10-09T16:00:00.000Z')
const THURSDAY = new Date('2026-10-08T16:00:00.000Z')

function memoryStore(people, tokens = []) {
  const drops = new Map()
  return {
    async find(key) { return drops.get(key) || null },
    async claim(key, coupon) {
      if (drops.has(key)) return false
      drops.set(key, { drop_key: key, coupon_id: coupon.id })
      return true
    },
    async listRecipients() { return people },
    async listPushTokens() { return tokens },
  }
}

function resMock() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

const ENV = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Clemson RIDES <rides@example.com>',
  EXPO_ACCESS_TOKEN: 'expo_test_token',
  CRON_SECRET: 'cron-secret',
}

test('outside Friday noon the drop does not email', async () => {
  const calls = []
  const result = await runFridayDrop({
    now: THURSDAY,
    env: ENV,
    store: memoryStore([{ email: 'a@clemson.edu', full_name: 'Ava' }]),
    fetchImpl: async (url) => {
      calls.push(url)
      return { ok: true, json: async () => ({ id: '1' }) }
    },
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'outside_friday_drop_hour')
  assert.equal(calls.length, 0)
  assert.equal(result.coupon.dropKey, '2026-10-02')
})

test('Friday noon emails active users, pushes when Expo is configured, and does not repeat', async () => {
  const calls = []
  const store = memoryStore([
    { email: 'ava@clemson.edu', full_name: 'Ava Tiger' },
    { email: '', full_name: 'No Mail' },
    { email: 'gone@clemson.edu', full_name: 'Gone', deleted_at: '2026-01-01' },
    { email: 'ben@g.clemson.edu', full_name: 'Ben' },
  ], ['ExponentPushToken[abc]'])
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ id: 'msg', data: [{ id: 'push' }] }) }
  }
  const first = await runFridayDrop({ now: NOON, env: ENV, store, fetchImpl })
  assert.equal(first.skipped, false)
  assert.equal(first.emailed, 2)
  assert.equal(first.emailFailed, 0)
  assert.equal(first.push.sent, true)
  assert.equal(first.push.count, 1)
  assert.equal(first.inApp, 'toast_on_next_open')
  const emails = calls.filter((call) => call.url.includes('api.resend.com'))
  assert.equal(emails.length, 2)
  assert.match(emails[0].body.text, /Refer two friends/)
  assert.match(emails[0].body.text, /\.edu/)
  assert.match(emails[0].body.text, /@clemson\.edu/)
  const second = await runFridayDrop({ now: NOON, env: ENV, store, fetchImpl })
  assert.equal(second.reason, 'already_dropped')
  assert.equal(calls.length, 3)
})

test('missing Resend and Expo keys are reported and nothing is claimed', async () => {
  const store = memoryStore([{ email: 'ava@clemson.edu', full_name: 'Ava' }])
  const result = await runFridayDrop({
    now: NOON,
    env: {},
    store,
    fetchImpl: async () => { throw new Error('should not send') },
  })
  assert.equal(result.reason, 'resend_not_configured')
  assert.equal(result.push.reason, 'expo_access_token_missing')
  assert.deepEqual(result.env, ['RESEND_API_KEY', 'RESEND_FROM', 'EXPO_ACCESS_TOKEN', 'CRON_SECRET'])
  const again = await runFridayDrop({
    now: NOON,
    env: ENV,
    store,
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: '1' }) }),
  })
  assert.equal(again.skipped, false)
  assert.equal(again.emailed, 1)
  assert.equal(again.push.reason, 'no_push_tokens')
})

test('public GET returns the coupon and a cron POST sends once', async () => {
  const store = memoryStore([{ email: 'ava@clemson.edu', full_name: 'Ava' }])
  const open = resMock()
  await handler({ method: 'GET', headers: {}, url: '/api/weekly-coupon' }, open, { now: THURSDAY, env: {} })
  const payload = JSON.parse(open.body)
  assert.equal(open.statusCode, 200)
  assert.equal(payload.dropHourEt, 12)
  assert.equal(payload.timeZone, 'America/New_York')
  assert.equal(payload.coupon.dropKey, '2026-10-02')
  assert.equal(payload.standingOffers.length, 4)

  const denied = resMock()
  await handler({ method: 'POST', headers: {}, url: '/api/weekly-coupon' }, denied, {
    now: NOON,
    env: ENV,
    store,
  })
  assert.equal(JSON.parse(denied.body).skipped, true)

  const sent = resMock()
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer cron-secret' },
    url: '/api/weekly-coupon',
  }, sent, { now: NOON, env: ENV, store, fetchImpl: async () => ({ ok: true, json: async () => ({ id: '1' }) }) })
  const body = JSON.parse(sent.body)
  assert.equal(body.emailed, 1)
  assert.match(body.coupon.code, /^[A-Z0-9]+$/)
})
