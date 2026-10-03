import assert from 'node:assert/strict'
import test from 'node:test'
import { notifyAssignedDriver, tokensForIosAssignmentPush } from './driverAssignmentNotice.js'

const RIDER = 'rider@clemson.edu'
const JOHN = 'johnmatveyev@gmail.com'

test('iOS assignment push uses the shared Expo token and skips Android-only rows', () => {
  const tokens = tokensForIosAssignmentPush({
    statusToken: 'ExponentPushToken[ios-or-shared]',
    rows: [
      { token: 'ExponentPushToken[android]', platform: 'android' },
      { token: 'ExponentPushToken[ios]', platform: 'ios' },
      { token: 'ExponentPushToken[ios-or-shared]', platform: 'ios' },
    ],
  })
  assert.deepEqual(tokens.map((item) => item.token), [
    'ExponentPushToken[ios-or-shared]',
    'ExponentPushToken[ios]',
  ])
  assert.equal(tokens.some((item) => item.platform === 'android'), false)
})

function noticeSb(captures) {
  return {
    from(table) {
      const api = {
        select() { return api },
        eq() { return api },
        insert(payload) {
          captures.inserts.push({ table, payload })
          return Promise.resolve({ error: null })
        },
        maybeSingle() {
          if (table === 'driver_status') {
            return Promise.resolve({ data: { expo_push_token: 'ExponentPushToken[shared]' }, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
        then(resolve, reject) {
          if (table === 'driver_web_push') {
            return Promise.resolve({
              data: [{ endpoint: 'https://push.example/driver', p256dh: 'key', auth: 'auth' }],
              error: null,
            }).then(resolve, reject)
          }
          if (table === 'driver_push_tokens') {
            return Promise.resolve({
              data: [
                { token: 'ExponentPushToken[android]', platform: 'android' },
                { token: 'ExponentPushToken[ios]', platform: 'ios' },
              ],
              error: null,
            }).then(resolve, reject)
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        },
      }
      return api
    },
  }
}

test('assignment notifies only the driver on email, in-app, web push, and iOS push', async () => {
  const captures = { inserts: [], mail: [], web: [], expo: null }
  const sb = noticeSb(captures)
  const report = await notifyAssignedDriver(sb, {
    driverId: 'john-id',
    email: ' JohnMatveyev@gmail.com ',
    riderEmail: RIDER,
    trip: {
      id: 'trip-1',
      rider_id: 'rider-1',
      pickup_label: 'Memorial Stadium',
      dropoff_label: 'GSP Airport',
      metadata: { rider_email: RIDER },
    },
  }, {
    sendMail: async (message) => {
      captures.mail.push(message)
      return { emailed: true, id: 'email-1' }
    },
    sendWebPush: async (subscription, payload) => {
      captures.web.push({ subscription, payload })
      return { ok: true }
    },
    fetch: async (url, init) => {
      captures.expo = { url, body: JSON.parse(init.body) }
      return { ok: true, status: 200, json: async () => ({ data: [] }) }
    },
    env: { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' },
  })

  assert.equal(report.riderNotified, false)
  assert.equal(report.driverEmail, JOHN)
  assert.equal(report.email.to, JOHN)
  assert.equal(report.email.emailed, true)
  assert.deepEqual(captures.mail, [{
    to: JOHN,
    subject: 'You were assigned to a ride',
    text: 'Memorial Stadium → GSP Airport. This ride is assigned to you.',
  }])
  assert.equal(captures.inserts.length, 1)
  assert.equal(captures.inserts[0].table, 'driver_notifications')
  assert.equal(captures.inserts[0].payload.driver_id, 'john-id')
  assert.equal(captures.inserts[0].payload.kind, 'ride_assigned')
  assert.equal(captures.inserts[0].payload.rider_id, undefined)
  assert.equal(captures.web.length, 1)
  assert.equal(captures.web[0].subscription.endpoint, 'https://push.example/driver')
  assert.equal(JSON.parse(captures.web[0].payload).title, 'You were assigned to a ride')
  assert.deepEqual(captures.expo.body.map((message) => message.to), [
    'ExponentPushToken[shared]',
    'ExponentPushToken[ios]',
  ])
  assert.equal(captures.expo.url, 'https://exp.host/--/api/v2/push/send')
  const serialized = JSON.stringify({ report, captures })
  assert.equal(serialized.includes(RIDER), false)
})
