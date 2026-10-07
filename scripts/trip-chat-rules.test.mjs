import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { displayFirstName } from '../src/lib/privacyDisplay.js'
import {
  LOST_ITEM_THREAD_WINDOW_MS,
  RIDE_CHAT_QUICK_REPLIES,
  canOpenLostItemReport,
  canSendTripMessage,
  canonicalQuickReply,
  lostItemReportState,
  messageLimitForMode,
  normalizeLostItemDescription,
  normalizeMessageBody,
  rideChatBanner,
  rideChatMode,
  tripPartyRole,
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
  assert.equal(rideChatMode({ status: 'arrived' }, now), 'compose')
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

const DAY = 24 * HOUR
const WINDOW = 7 * DAY

test('messaging is open before the ride and during it, and off after', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z')
  const pre = ['accepted', 'arriving', 'arrived']
  for (const status of pre) {
    assert.equal(canSendTripMessage({ status }, now), true, status)
    assert.equal(rideChatMode({ status }, now), 'compose', status)
  }
  assert.equal(canSendTripMessage({ status: 'in_progress' }, now), true)
  assert.equal(rideChatMode({ status: 'in_progress' }, now), 'compose')
  assert.equal(canSendTripMessage({ status: 'completed', completed_at: new Date(now - HOUR).toISOString() }, now), false)
  assert.equal(rideChatMode({ status: 'completed', completed_at: new Date(now - HOUR).toISOString() }, now), 'readonly')
  assert.equal(canSendTripMessage({ status: 'canceled', canceled_at: new Date(now - HOUR).toISOString() }, now), false)
  assert.equal(rideChatMode({ status: 'canceled', canceled_at: new Date(now - HOUR).toISOString() }, now), 'readonly')
  assert.equal(canSendTripMessage({ status: 'searching' }, now), false)
  assert.equal(rideChatBanner('compose'), null)
})

test('lost-item thread reopens messaging until the window ends or it is resolved', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z')
  assert.equal(LOST_ITEM_THREAD_WINDOW_MS, WINDOW)
  const trip = {
    status: 'completed',
    completed_at: new Date(now - 2 * DAY).toISOString(),
    rider_id: 'rider',
    driver_id: 'driver',
  }
  const open = { status: 'open', opened_at: new Date(now - DAY).toISOString() }
  const edge = { status: 'open', opened_at: new Date(now - WINDOW).toISOString() }
  const expired = { status: 'open', opened_at: new Date(now - WINDOW - 1).toISOString() }
  const resolved = { status: 'resolved', opened_at: new Date(now - HOUR).toISOString() }

  assert.equal(lostItemReportState(open, now), 'open')
  assert.equal(lostItemReportState(edge, now), 'open')
  assert.equal(lostItemReportState(expired, now), 'expired')
  assert.equal(lostItemReportState(resolved, now), 'resolved')
  assert.equal(canSendTripMessage(trip, now, open), true)
  assert.equal(canSendTripMessage(trip, now, edge), true)
  assert.equal(rideChatMode(trip, now, open), 'compose')
  assert.match(rideChatBanner('compose', open, now), /7 days/)
  assert.equal(canSendTripMessage(trip, now, expired), false)
  assert.equal(rideChatMode(trip, now, expired), 'readonly')
  assert.match(rideChatBanner('readonly', expired, now), /read-only/i)
  assert.equal(canSendTripMessage(trip, now, resolved), false)
  assert.equal(rideChatMode(trip, now, resolved), 'readonly')
  assert.match(rideChatBanner('readonly', resolved, now), /resolved/i)
  assert.equal(canSendTripMessage({ status: 'canceled', canceled_at: trip.completed_at }, now, open), false)

  assert.equal(canOpenLostItemReport(trip, now, 'driver'), true)
  assert.equal(canOpenLostItemReport(trip, now, 'rider'), true)
  assert.equal(canOpenLostItemReport({ ...trip, completed_at: new Date(now - WINDOW).toISOString() }, now, 'driver'), true)
  assert.equal(canOpenLostItemReport({ ...trip, completed_at: new Date(now - WINDOW - 1).toISOString() }, now, 'driver'), false)
  assert.equal(canOpenLostItemReport({ status: 'canceled', canceled_at: trip.completed_at }, now, 'driver'), false)
  assert.equal(canOpenLostItemReport(trip, now, null), false)
  assert.equal(tripPartyRole(trip, 'driver'), 'driver')
  assert.equal(tripPartyRole(trip, 'rider'), 'rider')
  assert.equal(tripPartyRole(trip, 'other'), null)
  assert.equal(normalizeLostItemDescription('  black   backpack '), 'black backpack')
  assert.equal(normalizeLostItemDescription('   '), null)
  assert.throws(() => normalizeLostItemDescription('a'.repeat(81)), /80/)
})

test('lost-item window constant matches the migration function', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/20261007220000_trip_lost_item_messaging.sql', import.meta.url),
    'utf8',
  )
  assert.equal(LOST_ITEM_THREAD_WINDOW_MS, 7 * 24 * 60 * 60 * 1000)
  assert.match(sql, /create or replace function public\.lost_item_thread_window\(\)/)
  assert.equal(sql.match(/interval '7 days'/g)?.length, 1)
  assert.match(sql, /lost_item_thread_window\(\)/)
})
