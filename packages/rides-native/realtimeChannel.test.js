import assert from 'node:assert/strict'
import test from 'node:test'
import { uniqueChannelTopic } from './realtimeChannel.js'
import {
  subscribeLostItemReports,
  subscribeTripMessages,
  subscribeTripChatStatus,
} from './tripMessagesClient.js'

function deduplicatingClient() {
  const channels = new Map()
  return {
    channels,
    channel(topic) {
      if (channels.has(topic)) return channels.get(topic)
      const channel = {
        subscribed: false,
        callbacks: [],
        on(event, filter, callback) {
          if (this.subscribed) throw new Error('cannot add postgres_changes callbacks after subscribe()')
          this.callbacks.push(callback)
          return this
        },
        subscribe() {
          this.subscribed = true
          return this
        },
      }
      channels.set(topic, channel)
      return channel
    },
    removeChannel(channel) {
      for (const [topic, candidate] of channels) {
        if (candidate === channel) channels.delete(topic)
      }
    },
    emit(payload) {
      for (const channel of channels.values()) {
        for (const callback of channel.callbacks) callback(payload)
      }
    },
  }
}

test('same-base topics differ even when the random suffix repeats', () => {
  const originalRandom = Math.random
  try {
    Math.random = () => 0
    const first = uniqueChannelTopic('trips')
    const second = uniqueChannelTopic('trips')
    assert.match(first, /^trips:\d+-[a-z0-9]+$/)
    assert.match(second, /^trips:\d+-[a-z0-9]+$/)
    assert.notEqual(first, second)
  } finally {
    Math.random = originalRandom
  }
})

test('fake client reproduces realtime topic dedup and late callback rejection', () => {
  const client = deduplicatingClient()
  const channel = client.channel('shared').subscribe()
  assert.equal(client.channel('shared'), channel)
  assert.throws(() => client.channel('shared').on('postgres_changes', {}, () => {}), /after subscribe/)
})

for (const [name, subscribe, extract] of [
  ['lost item reports', (client, callback) => subscribeLostItemReports(client, callback), (payload) => payload],
  ['trip messages', (client, callback) => subscribeTripMessages(client, 'trip-1', callback), (payload) => payload],
  ['trip chat status', (client, callback) => subscribeTripChatStatus(client, 'trip-1', callback), (payload) => payload.new],
]) {
  test(`${name}: concurrent consumers own independent subscriptions and cleanup`, () => {
    const client = deduplicatingClient()
    const firstEvents = []
    const secondEvents = []
    const stopFirst = subscribe(client, (payload) => firstEvents.push(payload))
    const stopSecond = subscribe(client, (payload) => secondEvents.push(payload))
    assert.equal(client.channels.size, 2)
    const payload = { new: { id: 'trip-1', status: 'requested' } }
    client.emit(payload)
    assert.deepEqual(firstEvents, [extract(payload)])
    assert.deepEqual(secondEvents, [extract(payload)])
    stopFirst()
    assert.equal(client.channels.size, 1)
    client.emit(payload)
    assert.deepEqual(firstEvents, [extract(payload)])
    assert.deepEqual(secondEvents, [extract(payload), extract(payload)])
    stopSecond()
    assert.equal(client.channels.size, 0)
  })
}
