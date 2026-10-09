import test from 'node:test'
import assert from 'node:assert/strict'
import {
  counterpartId,
  lostItemNoticeCopy,
  messageNoticeCopy,
  notifyTripCounterpart,
} from './tripMessageNotify.js'
import { LOST_ITEM_THREAD_WINDOW_MS } from '../src/lib/tripChatRules.js'

const trip = {
  id: 'trip-1',
  rider_id: 'rider',
  driver_id: 'driver',
  status: 'accepted',
}

function sb(rows) {
  return {
    from(table) {
      const filters = []
      const builder = {
        select() { return builder },
        eq(col, val) {
          filters.push([col, val])
          return builder
        },
        async maybeSingle() {
          const list = rows[table] || []
          const found = list.find((row) => filters.every(([col, val]) => row[col] === val)) || null
          return { data: found, error: null }
        },
      }
      return builder
    },
    auth: {
      admin: {
        async getUserById(id) {
          const user = (rows.authUsers || []).find((row) => row.id === id)
          return { data: { user: user || null } }
        },
      },
    },
  }
}

test('notices name the other party and keep the lost-item window in the copy', () => {
  assert.equal(counterpartId(trip, 'rider'), 'driver')
  assert.equal(counterpartId(trip, 'driver'), 'rider')
  assert.equal(counterpartId(trip, 'stranger'), null)
  assert.equal(messageNoticeCopy('  on my way  ').email, false)
  assert.match(messageNoticeCopy('  on my way  ').body, /on my way/)
  const lost = lostItemNoticeCopy('black backpack', 'driver')
  assert.equal(lost.email, true)
  assert.match(lost.body, /Your driver/)
  assert.match(lost.body, /black backpack/)
  assert.match(lostItemNoticeCopy('phone charger', 'rider').body, /Your rider/)
  assert.match(lost.body, new RegExp(String(LOST_ITEM_THREAD_WINDOW_MS / (24 * 60 * 60 * 1000))))
})

test('a message push goes to the other party and a lost-item report also emails', async () => {
  const pushes = []
  const emails = []
  const store = sb({
    trips: [trip],
    trip_messages: [{ id: 'm1', trip_id: 'trip-1', sender_id: 'driver', body: 'I am outside' }],
    trip_lost_item_reports: [{ id: 'r1', trip_id: 'trip-1', reporter_id: 'driver', reporter_role: 'driver', description: 'black backpack', status: 'open' }],
    driver_status: [{ driver_id: 'rider', expo_push_token: 'ExponentPushToken[rider]' }],
    profiles: [{ id: 'rider', email: 'rider@clemson.edu' }],
  })
  const message = await notifyTripCounterpart({
    sb: store,
    actorId: 'driver',
    tripId: 'trip-1',
    kind: 'message',
    messageId: 'm1',
  }, {
    sendPush: async (payload) => {
      pushes.push(payload)
      return { sent: true }
    },
    sendEmail: async (payload) => {
      emails.push(payload)
      return { emailed: true }
    },
  })
  assert.equal(message.ok, true)
  assert.equal(message.recipientId, 'rider')
  assert.equal(pushes[0].to, 'ExponentPushToken[rider]')
  assert.equal(pushes[0].data.kind, 'trip_message')
  assert.equal(emails.length, 0)

  const lost = await notifyTripCounterpart({
    sb: store,
    actorId: 'driver',
    tripId: 'trip-1',
    kind: 'lost-item',
    reportId: 'r1',
  }, {
    sendPush: async (payload) => {
      pushes.push(payload)
      return { sent: true }
    },
    sendEmail: async (payload) => {
      emails.push(payload)
      return { emailed: true }
    },
  })
  assert.equal(lost.ok, true)
  assert.equal(lost.email.emailed, true)
  assert.equal(emails[0].to, 'rider@clemson.edu')
  assert.equal(pushes[1].data.tripId, 'trip-1')
  assert.equal(JSON.stringify(lost).includes('ExponentPushToken'), false)
})

test('strangers and missing rows do not send', async () => {
  const store = sb({ trips: [trip], trip_messages: [], profiles: [] })
  let pushes = 0
  const stranger = await notifyTripCounterpart({
    sb: store,
    actorId: 'stranger',
    tripId: 'trip-1',
    kind: 'message',
    messageId: 'm1',
  }, { sendPush: async () => { pushes += 1; return { sent: true } } })
  assert.equal(stranger.reason, 'not_a_party')
  const missing = await notifyTripCounterpart({
    sb: store,
    actorId: 'rider',
    tripId: 'trip-1',
    kind: 'message',
    messageId: 'missing',
  }, { sendPush: async () => { pushes += 1; return { sent: true } } })
  assert.equal(missing.reason, 'message_not_found')
  assert.equal(pushes, 0)
})
