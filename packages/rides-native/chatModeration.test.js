import assert from 'node:assert/strict'
import test from 'node:test'
import { validateTicket } from '../../server/supportAgent.js'
import {
  buildChatModerationTicket, chatBlockKey, createChatBlockStore, CHAT_REPORT_REASONS,
} from './chatModeration.js'

const base = { tripId: 'trip-1', roleVariant: 'rider', reportedRole: 'driver', reportedUserId: 'driver-1' }

test('chat reports conform to the existing support validation for both trip roles and every reason', () => {
  for (const roleVariant of ['rider', 'driver']) {
    for (const reason of [...CHAT_REPORT_REASONS, undefined]) {
      const reportedRole = roleVariant === 'rider' ? 'driver' : 'rider'
      const ticket = buildChatModerationTicket({ ...base, roleVariant, reportedRole, reason })
      assert.equal(validateTicket(ticket).ok, true)
      assert.equal(ticket.confirmed, true)
      assert.equal(ticket.category, 'safety')
      assert.equal(ticket.roleVariant, roleVariant)
      assert.equal(ticket.subject, 'Report trip chat')
      assert.match(ticket.body, /Trip ID: trip-1/)
      assert.ok(ticket.body.includes(`Reported party role: ${reportedRole}`))
      assert.match(ticket.body, /Reported user ID: driver-1/)
      if (reason) assert.ok(ticket.body.includes(`Reason: ${reason}`))
      else assert.ok(!ticket.body.includes('Reason:'))
    }
  }
})

test('message reports include message ID and text; block tickets explicitly record the local block', () => {
  const ticket = buildChatModerationTicket({ ...base, message: { id: 'message-7', body: 'Reported text' } })
  assert.match(ticket.body, /Reported message ID: message-7/)
  assert.match(ticket.body, /Reported message text: Reported text/)
  const block = buildChatModerationTicket({ ...base, action: 'block' })
  assert.equal(validateTicket(block).ok, true)
  assert.match(block.subject, /Block/)
  assert.match(block.body, /confirmed blocking this person on this device/)
})

test('untrusted long input stays within ticket limits without dropping trip or message identifiers', () => {
  const ticket = buildChatModerationTicket({
    ...base, reason: 'x'.repeat(5000), message: { id: 'message-7', body: 'y'.repeat(5000) },
  })
  assert.equal(validateTicket(ticket).ok, true)
  assert.ok(ticket.body.length <= 4000)
  assert.match(ticket.body, /Reported message ID: message-7/)
  assert.throws(() => buildChatModerationTicket({ ...base, tripId: '' }), /ID/)
  assert.throws(() => buildChatModerationTicket({ ...base, reportedRole: 'rider' }), /roles/)
  assert.throws(() => buildChatModerationTicket({ ...base, roleVariant: 'staff' }), /roles/)
  assert.throws(() => buildChatModerationTicket({ ...base, action: 'delete' }), /action/)
  assert.throws(() => buildChatModerationTicket({ ...base, message: { body: 'text' } }), /ID/)
})

function memoryStorage() {
  const data = new Map()
  return {
    async getItem(key) { return data.get(key) ?? null },
    async setItem(key, value) { data.set(key, value) },
    async removeItem(key) { data.delete(key) },
  }
}

test('blocks persist across store instances, isolate accounts and peers, and support unblock', async () => {
  const storage = memoryStorage()
  const store = createChatBlockStore(storage)
  assert.equal(await store.isBlocked('rider-1', 'driver-1'), false)
  await store.setBlocked('rider-1', 'driver-1', true)
  const reopened = createChatBlockStore(storage)
  assert.equal(await reopened.isBlocked('rider-1', 'driver-1'), true)
  assert.equal(await reopened.isBlocked('rider-2', 'driver-1'), false)
  assert.equal(await reopened.isBlocked('rider-1', 'driver-2'), false)
  await reopened.setBlocked('rider-1', 'driver-1', false)
  assert.equal(await store.isBlocked('rider-1', 'driver-1'), false)
})

test('per-peer writes do not lose concurrent blocks and subscribers receive only successful writes', async () => {
  const store = createChatBlockStore(memoryStorage())
  const changes = []
  const unsubscribe = store.subscribe((key, blocked) => changes.push([key, blocked]))
  await Promise.all([store.setBlocked('rider', 'one', true), store.setBlocked('rider', 'two', true)])
  assert.equal(await store.isBlocked('rider', 'one'), true)
  assert.equal(await store.isBlocked('rider', 'two'), true)
  assert.equal(changes.length, 2)
  assert.deepEqual(changes[0], [chatBlockKey('rider', 'one'), true])
  unsubscribe()
  await store.setBlocked('rider', 'one', false)
  assert.equal(changes.length, 2)
})

test('storage errors propagate so the UI cannot claim successful blocking or unblocking', async () => {
  const storage = {
    async getItem() { throw new Error('read failed') },
    async setItem() { throw new Error('write failed') },
    async removeItem() { throw new Error('delete failed') },
  }
  const store = createChatBlockStore(storage)
  let changes = 0
  store.subscribe(() => { changes++ })
  await assert.rejects(store.isBlocked('rider', 'driver'), /read failed/)
  await assert.rejects(store.setBlocked('rider', 'driver', true), /write failed/)
  await assert.rejects(store.setBlocked('rider', 'driver', false), /delete failed/)
  assert.equal(changes, 0)
})

test('block keys are safe for SecureStore, collision resistant, and require both users', () => {
  assert.match(chatBlockKey('a/b', 'c@d'), /^[\w.-]+$/)
  assert.notEqual(chatBlockKey('a/b', 'c'), chatBlockKey('a_b', 'c'))
  assert.notEqual(chatBlockKey('ab', 'c'), chatBlockKey('a', 'bc'))
  assert.throws(() => chatBlockKey('', 'driver'), /ID/)
  assert.throws(() => chatBlockKey('rider', null), /ID/)
})
