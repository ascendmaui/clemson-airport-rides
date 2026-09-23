import assert from 'node:assert/strict'
import test from 'node:test'
import { displayFirstName } from '../src/lib/privacyDisplay.js'
import {
  RIDE_CHAT_QUICK_REPLIES,
  canonicalQuickReply,
  messageLimitForMode,
  normalizeMessageBody,
  rideChatBanner,
  rideChatMode,
} from '../src/lib/tripChatRules.js'

const HOUR = 60 * 60 * 1000

test('displayFirstName keeps the first name only', () => {
  assert.equal(displayFirstName('Ada Lovelace'), 'Ada')
  assert.equal(displayFirstName('  Grace   Hopper '), 'Grace')
  assert.equal(displayFirstName('Madonna'), 'Madonna')
  assert.equal(displayFirstName(''), 'Rider')
  assert.equal(displayFirstName(null), 'Rider')
  assert.equal(displayFirstName('Mary-Jane Watson'), 'Mary-Jane')
  assert.equal(displayFirstName('Sam', 'Driver'), 'Sam')
})

test('quick replies are the partial caller list and nothing else', () => {
  assert.deepEqual([...RIDE_CHAT_QUICK_REPLIES], [
    'Just got your request',
    "I'm on the way",
    "I'm almost there",
    "I'm here",
    "I'm here, and I'm waiting",
  ])
  for (const phrase of RIDE_CHAT_QUICK_REPLIES) {
    assert.equal(canonicalQuickReply(phrase), phrase)
    assert.equal(normalizeMessageBody(phrase), phrase)
  }
  assert.equal(canonicalQuickReply('Thanks!'), null)
  assert.equal(canonicalQuickReply("Running a few minutes late"), null)
  assert.equal(canonicalQuickReply("I'm outside"), null)
  assert.equal(canonicalQuickReply("I'm here "), null)
  assert.equal(canonicalQuickReply('just got your request'), null)
})

test('ride chat mode follows active status and the 24 hour freeze', () => {
  const now = Date.parse('2026-09-23T12:00:00.000Z')
  assert.equal(rideChatMode({ status: 'accepted' }, now), 'compose')
  assert.equal(rideChatMode({ status: 'arriving' }, now), 'compose')
  assert.equal(rideChatMode({ status: 'in_progress' }, now), 'compose')
  assert.equal(rideChatMode({ status: 'searching' }, now), 'closed')
  assert.equal(rideChatMode({ status: 'offered' }, now), 'closed')
  assert.equal(
    rideChatMode({ status: 'completed', completed_at: new Date(now - HOUR).toISOString() }, now),
    'readonly',
  )
  assert.equal(
    rideChatMode({ status: 'canceled', canceled_at: new Date(now - 23 * HOUR).toISOString() }, now),
    'readonly',
  )
  assert.equal(
    rideChatMode(
      { status: 'completed', completed_at: new Date(now - 24 * HOUR).toISOString() },
      now,
    ),
    'readonly',
  )
  assert.equal(
    rideChatMode(
      { status: 'completed', completed_at: new Date(now - 24 * HOUR - 1).toISOString() },
      now,
    ),
    'closed',
  )
  assert.equal(rideChatMode(null, now), 'closed')
  assert.equal(messageLimitForMode('compose'), 200)
  assert.equal(messageLimitForMode('readonly'), 40)
  assert.equal(messageLimitForMode('closed'), 0)
  assert.equal(rideChatBanner('compose'), null)
  assert.match(rideChatBanner('readonly'), /read-only/i)
  assert.match(rideChatBanner('closed'), /closed/i)
})

test('normalizeMessageBody trims free text and rejects empty or oversized bodies', () => {
  assert.equal(normalizeMessageBody('  hello  '), 'hello')
  assert.throws(() => normalizeMessageBody('   '), /empty/i)
  assert.throws(() => normalizeMessageBody('a'.repeat(501)), /too long/i)
})
