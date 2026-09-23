import assert from 'node:assert/strict'
import test from 'node:test'
import {
  depositSliceCents,
  driverNetCents,
  isDueNow,
  isWeekendPartyWindow,
  matchesQueueFilter,
  nextTripStatus,
  summarizeDepositAwareness,
  toDriverCard,
  tripTags,
} from './tripTags.js'

test('driver net is 80 percent and the deposit slice is 25 percent', () => {
  assert.equal(driverNetCents(10000), 8000)
  assert.equal(depositSliceCents(10000), 2500)
  assert.equal(depositSliceCents(10000, 400), 400)
})

test('student, game day, tesla, and chosen-driver tags come from stored trip fields', () => {
  const tags = tripTags({
    status: 'requested',
    driver_id: 'drv',
    tier: 'tesla',
    pickup_label: 'Memorial Stadium',
    metadata: { student_discount_cents: 180, window: 'game_day', purpose: 'tailgate' },
  })
  assert.deepEqual(tags.sort(), ['direct', 'game_day', 'student', 'tesla', 'weekend_party'].sort())
})

test('a stadium pickup is not game day unless a game is live or the trip says so', () => {
  const row = { status: 'searching', pickup_label: 'Memorial Stadium', dropoff_label: 'GSP' }
  assert.equal(tripTags(row).includes('game_day'), false)
  assert.equal(tripTags(row, { gameDayLive: true }).includes('game_day'), true)
})

test('weekend and party covers scheduled Friday night through Sunday only', () => {
  assert.equal(isWeekendPartyWindow('2026-10-02T21:30:00.000Z'), true)
  assert.equal(isWeekendPartyWindow('2026-10-02T18:00:00.000Z'), false)
  const saturday = toDriverCard({
    id: 's1',
    status: 'scheduled',
    pickup_at: '2026-10-03T18:00:00.000Z',
    fare_cents: 3200,
    metadata: { purpose: 'planned', kind: 'scheduled' },
  })
  assert.equal(saturday.tags.includes('weekend_party'), true)
  assert.equal(saturday.tags.includes('scheduled'), true)
  const immediate = tripTags({
    status: 'requested',
    driver_id: 'drv',
    metadata: {},
  })
  assert.equal(immediate.includes('weekend_party'), false)
})

test('queue filters and the live-trip lead window', () => {
  const card = toDriverCard({
    id: 'q1',
    status: 'scheduled',
    pickup_at: '2026-10-03T18:00:00.000Z',
    fare_cents: 2000,
    metadata: { isStudent: true, kind: 'scheduled' },
  })
  assert.equal(matchesQueueFilter(card, 'student'), true)
  assert.equal(matchesQueueFilter(card, 'all'), true)
  assert.throws(() => matchesQueueFilter(card, 'nope'), /Unknown queue filter/)
  const soon = new Date('2026-10-03T17:30:00.000Z')
  const later = new Date('2026-10-03T12:00:00.000Z')
  assert.equal(isDueNow(card, soon), true)
  assert.equal(isDueNow(card, later), false)
  assert.equal(isDueNow({ pickupAt: null }), true)
})

test('status advances one step and deposits summarize from payment rows', () => {
  assert.equal(nextTripStatus('accepted'), 'arriving')
  assert.equal(nextTripStatus('arriving'), 'arrived')
  assert.equal(nextTripStatus('arrived'), 'in_progress')
  assert.equal(nextTripStatus('in_progress'), 'completed')
  assert.equal(nextTripStatus('completed'), null)
  const summary = summarizeDepositAwareness(
    [{ id: 't1', status: 'completed', fare_cents: 4000, completed_at: '2026-10-03T15:00:00.000Z', dropoff_label: 'GSP' }],
    { t1: [{ kind: 'deposit', amountCents: 1000, status: 'succeeded' }, { kind: 'balance', amountCents: 3000, status: 'pending' }] },
    new Date('2026-10-03T18:00:00.000Z'),
  )
  assert.equal(summary.depositPaidCents, 1000)
  assert.equal(summary.depositOpenCents, 0)
  assert.equal(summary.driverNetCents, 3200)
  assert.equal(summary.todayNetCents, 3200)
  assert.match(summary.lines[0].line, /Deposit \$10\.00 paid/)
})
