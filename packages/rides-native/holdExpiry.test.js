import assert from 'node:assert/strict'
import test from 'node:test'
import { airportHoldAnchorMs, UNPAID_AIRPORT_HOLD_TTL_MS as serverTtl } from '../../server/abandonedCheckout.js'
import { UNPAID_AIRPORT_HOLD_TTL_MS as sharedTtl } from '../../shared/airportHold.js'
import {
  HOLD_EXPIRED_LABEL,
  HOLD_LAST_MINUTE_LABEL,
  UNPAID_AIRPORT_HOLD_TTL_MS,
  holdDeadline,
  holdRemaining,
} from './holdExpiry.js'

const START = '2026-09-25T12:00:00.000Z'
const START_MS = Date.parse(START)
const TTL = 20 * 60 * 1000

function tripAt(createdAt, sessionAt) {
  const trip = { created_at: createdAt }
  if (sessionAt) trip.metadata = { stripe_checkout_created_at: sessionAt }
  return trip
}

test('ttl is the shared 20 minute constant the server re-exports', () => {
  assert.equal(sharedTtl, 20 * 60 * 1000)
  assert.equal(serverTtl, sharedTtl)
  assert.equal(UNPAID_AIRPORT_HOLD_TTL_MS, sharedTtl)
  assert.equal(HOLD_EXPIRED_LABEL, 'This hold expired — request again')
  assert.equal(HOLD_LAST_MINUTE_LABEL, 'Less than a minute left')
})

test('deadline is the hold start plus ttl, including the default ttl', () => {
  const trip = tripAt(START)
  assert.equal(holdDeadline(trip, TTL), START_MS + TTL)
  assert.equal(holdDeadline(trip), START_MS + UNPAID_AIRPORT_HOLD_TTL_MS)
})

test('deadline matches the server anchor plus ttl', () => {
  const trips = [
    tripAt('2026-09-24T14:40:00.000Z'),
    tripAt('2026-09-24T14:40:00.001Z'),
    tripAt('2026-09-24T14:00:00.000Z', '2026-09-24T14:50:00.000Z'),
    tripAt('2026-09-24T14:50:00.000Z', '2026-09-24T14:00:00.000Z'),
    { metadata: { stripe_checkout_created_at: '2026-09-24T14:50:00.000Z' } },
    {},
    null,
    { created_at: 'nope', metadata: { stripe_checkout_created_at: 'also-nope' } },
    { created_at: START, metadata: 'not-an-object' },
  ]
  for (const trip of trips) {
    const anchor = airportHoldAnchorMs(trip)
    const deadline = holdDeadline(trip, serverTtl)
    assert.equal(deadline, anchor == null ? null : anchor + serverTtl)
  }
})

test('boundaries: exact ttl is expired, one millisecond earlier is not', () => {
  const now = Date.parse('2026-09-24T15:00:00.000Z')
  const due = holdRemaining(tripAt('2026-09-24T14:40:00.000Z'), now)
  assert.equal(due.msLeft, 0)
  assert.equal(due.expired, true)
  assert.equal(due.label, 'This hold expired — request again')

  const kept = holdRemaining(tripAt('2026-09-24T14:40:00.001Z'), now)
  assert.equal(kept.msLeft, 1)
  assert.equal(kept.expired, false)
  assert.equal(kept.label, 'Less than a minute left')

  const past = holdRemaining(tripAt('2026-09-24T14:40:00.000Z'), now + 1)
  assert.equal(past.msLeft, -1)
  assert.equal(past.expired, true)
  assert.equal(past.label, 'This hold expired — request again')
})

test('labels floor whole minutes and switch under one minute', () => {
  const trip = tripAt(START)
  const at12 = holdRemaining(trip, START_MS + TTL - 12 * 60 * 1000, TTL)
  assert.equal(at12.msLeft, 12 * 60 * 1000)
  assert.equal(at12.expired, false)
  assert.equal(at12.label, 'Pay within 12 min to keep your ride')

  const almost13 = holdRemaining(trip, START_MS + TTL - (12 * 60 * 1000 + 59_999), TTL)
  assert.equal(almost13.label, 'Pay within 12 min to keep your ride')

  const justUnder12 = holdRemaining(trip, START_MS + TTL - (12 * 60 * 1000 - 1), TTL)
  assert.equal(justUnder12.msLeft, 12 * 60 * 1000 - 1)
  assert.equal(justUnder12.label, 'Pay within 11 min to keep your ride')

  const oneMinute = holdRemaining(trip, START_MS + TTL - 60_000, TTL)
  assert.equal(oneMinute.msLeft, 60_000)
  assert.equal(oneMinute.label, 'Pay within 1 min to keep your ride')

  const underMinute = holdRemaining(trip, START_MS + TTL - 59_999, TTL)
  assert.equal(underMinute.msLeft, 59_999)
  assert.equal(underMinute.expired, false)
  assert.equal(underMinute.label, 'Less than a minute left')
})

test('a later Checkout bind is the hold start', () => {
  const rebound = tripAt('2026-09-24T14:00:00.000Z', '2026-09-24T14:50:00.000Z')
  const now = Date.parse('2026-09-24T15:00:00.000Z')
  assert.equal(holdDeadline(rebound), Date.parse('2026-09-24T14:50:00.000Z') + UNPAID_AIRPORT_HOLD_TTL_MS)
  const rem = holdRemaining(rebound, now)
  assert.equal(rem.expired, false)
  assert.equal(rem.msLeft, 10 * 60 * 1000)
  assert.equal(rem.label, 'Pay within 10 min to keep your ride')
})

test('missing created_at uses the Checkout bind, or no deadline when both are absent', () => {
  const sessionOnly = { metadata: { stripe_checkout_created_at: '2026-09-25T12:10:00.000Z' } }
  assert.equal(holdDeadline(sessionOnly, TTL), Date.parse('2026-09-25T12:10:00.000Z') + TTL)

  const invalidCreated = {
    created_at: 'not-a-date',
    metadata: { stripe_checkout_created_at: START },
  }
  assert.equal(holdDeadline(invalidCreated, TTL), START_MS + TTL)

  for (const trip of [{}, { created_at: '' }, { created_at: '   ' }, { created_at: 'nope' }, { created_at: 1_700_000_000_000 }, null, undefined]) {
    assert.equal(holdDeadline(trip, TTL), null)
    assert.deepEqual(holdRemaining(trip, START_MS, TTL), { msLeft: null, expired: false, label: '' })
  }
})

test('clock skew: a future created_at is not expired and reports the extra minutes', () => {
  const now = START_MS
  const trip = tripAt('2026-09-25T12:05:00.000Z')
  const rem = holdRemaining(trip, now, TTL)
  assert.equal(rem.expired, false)
  assert.equal(rem.msLeft, 25 * 60 * 1000)
  assert.ok(rem.msLeft > TTL)
  assert.equal(rem.label, 'Pay within 25 min to keep your ride')
})

test('clock skew: a negative now is still a finite countdown', () => {
  const rem = holdRemaining(tripAt(START), -60_000, TTL)
  assert.equal(rem.expired, false)
  assert.equal(rem.msLeft, START_MS + TTL - (-60_000))
  assert.match(rem.label, /^Pay within \d+ min to keep your ride$/)
})

test('negative ttl and a zero ttl expire at or before the hold start', () => {
  const trip = tripAt(START)
  assert.equal(holdDeadline(trip, -1_000), START_MS - 1_000)
  const negative = holdRemaining(trip, START_MS, -1_000)
  assert.equal(negative.msLeft, -1_000)
  assert.equal(negative.expired, true)
  assert.equal(negative.label, 'This hold expired — request again')

  const stillBeforeNegativeDeadline = holdRemaining(trip, START_MS - 61_000, -60_000)
  assert.equal(stillBeforeNegativeDeadline.msLeft, 1_000)
  assert.equal(stillBeforeNegativeDeadline.expired, false)
  assert.equal(stillBeforeNegativeDeadline.label, 'Less than a minute left')

  assert.equal(holdDeadline(trip, 0), START_MS)
  assert.equal(holdRemaining(trip, START_MS, 0).expired, true)
  assert.equal(holdRemaining(trip, START_MS, 0).msLeft, 0)
  assert.equal(holdRemaining(trip, START_MS - 1, 0).expired, false)
  assert.equal(holdRemaining(trip, START_MS - 1, 0).msLeft, 1)
})

test('non-finite ttl falls back to the shared constant', () => {
  const trip = tripAt(START)
  assert.equal(holdDeadline(trip, Number.NaN), START_MS + UNPAID_AIRPORT_HOLD_TTL_MS)
  assert.equal(holdDeadline(trip, Number.POSITIVE_INFINITY), START_MS + UNPAID_AIRPORT_HOLD_TTL_MS)
  assert.equal(holdDeadline(trip, Number.NEGATIVE_INFINITY), START_MS + UNPAID_AIRPORT_HOLD_TTL_MS)
})

test('now accepts a Date or an ISO string', () => {
  const trip = tripAt(START)
  const when = new Date('2026-09-25T12:08:00.000Z')
  assert.equal(holdRemaining(trip, when, TTL).msLeft, holdDeadline(trip, TTL) - when.getTime())
  assert.equal(
    holdRemaining(trip, '2026-09-25T12:08:00.000Z', TTL).msLeft,
    holdDeadline(trip, TTL) - Date.parse('2026-09-25T12:08:00.000Z'),
  )
})

test('a missing or unreadable clock does not throw', () => {
  const created = new Date().toISOString()
  const rem = holdRemaining(tripAt(created), 'not-a-clock')
  assert.equal(typeof rem.msLeft, 'number')
  assert.equal(rem.expired, false)
  assert.ok(rem.msLeft > 0)
  assert.equal(holdRemaining(tripAt(created), null).expired, false)
})
