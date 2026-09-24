import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dueScheduleReminders,
  nextReminder,
  purposeLabel,
  REMINDER_WINDOWS,
  toDriverQueueCard,
  toRiderScheduleCard,
} from './scheduledRideModel.js'

test('weekend and party purpose is labeled for the driver queue', () => {
  assert.equal(purposeLabel('party_weekend'), 'Weekend / party')
  assert.equal(purposeLabel('airport'), 'Airport')
  const card = toDriverQueueCard({
    id: 'w1',
    status: 'scheduled',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    fare_cents: 6800,
    pickup_at: '2026-10-03T01:00:00.000Z',
    rider_note: 'party_weekend',
    passengers: 1,
    metadata: { purpose: 'party_weekend', rider_first_name: 'Ava' },
  })
  assert.equal(card.purpose, 'Weekend / party')
  assert.equal(card.pickupLabel, 'Memorial Stadium')
  assert.equal(card.dropoffLabel, 'GSP Airport')
  assert.equal(card.firstName, 'Ava')
})

test('rider upcoming card keeps fare and deposit for the remaining balance', () => {
  const card = toRiderScheduleCard({
    id: 'a1',
    status: 'scheduled',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'Charlotte Douglas (CLT)',
    fare_cents: 9000,
    deposit_cents: 2250,
    pickup_at: '2026-10-03T15:00:00.000Z',
    metadata: { purpose: 'airport', fare_is_estimate: false },
  })
  assert.equal(card.fareCents, 9000)
  assert.equal(card.depositCents, 2250)
  assert.equal(card.purpose, 'Airport')
  assert.equal(card.estimate, false)
})

const HOUR = 60 * 60 * 1000

test('reminder windows stay tightest-first', () => {
  assert.deepEqual(REMINDER_WINDOWS.map((window) => window.id), ['m15', 'h1', 'h24'])
  assert.equal(REMINDER_WINDOWS[0].label, 'Pickup in about 15 minutes')
  assert.equal(REMINDER_WINDOWS[1].label, 'Pickup in about an hour')
  assert.equal(REMINDER_WINDOWS[2].label, 'Pickup is tomorrow')
})

test('due reminders use the tightest window and stay up after a stamp', () => {
  const now = new Date('2026-10-03T16:00:00.000Z')
  const trip = {
    id: 't1',
    status: 'scheduled',
    pickup_label: 'White C',
    dropoff_label: 'Sikes Hall',
    pickup_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    metadata: { reminders: { m15: true, h1: true, h24: true, now: true } },
  }
  const [card] = dueScheduleReminders([trip], now)
  assert.equal(card.windowId, 'm15')
  assert.equal(card.label, 'Pickup in about 15 minutes')
  assert.equal(card.pickupLabel, 'White C')
  assert.equal(card.dropoffLabel, 'Sikes Hall')
  assert.match(card.body, /White C → Sikes Hall/)
  assert.notEqual(card.whenLabel, 'Time TBD')
  assert.equal(nextReminder(trip, now, { m15: true }), null)
})

test('due reminders keep the hour and day windows and drop everything else', () => {
  const now = new Date('2026-10-03T16:00:00.000Z')
  const make = (id, ms, status = 'accepted') => ({
    id,
    status,
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    pickup_at: new Date(now.getTime() + ms).toISOString(),
  })
  const cards = dueScheduleReminders([
    make('far', 25 * HOUR),
    make('day', 20 * HOUR),
    make('hour', 50 * 60 * 1000),
    make('done', 10 * 60 * 1000, 'completed'),
    { id: '', status: 'scheduled', pickup_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString() },
  ], now)
  assert.deepEqual(cards.map((card) => [card.tripId, card.windowId]), [
    ['hour', 'h1'],
    ['day', 'h24'],
  ])
  assert.equal(cards[0].label, 'Pickup in about an hour')
  assert.equal(cards[1].label, 'Pickup is tomorrow')
})

test('a pickup inside the grace period is due now', () => {
  const now = new Date('2026-10-03T16:00:00.000Z')
  const [card] = dueScheduleReminders([{
    id: 'now1',
    status: 'arriving',
    pickupLabel: 'Downtown Clemson',
    dropoffLabel: 'White C',
    scheduled_for: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
  }], now)
  assert.equal(card.windowId, 'now')
  assert.equal(card.label, 'Pickup time is now')
  assert.match(card.body, /Downtown Clemson → White C/)
})

test('due reminders ignore empty input and pickups that already passed the grace period', () => {
  const now = new Date('2026-10-03T16:00:00.000Z')
  assert.deepEqual(dueScheduleReminders(null, now), [])
  assert.deepEqual(dueScheduleReminders(undefined, now), [])
  assert.deepEqual(dueScheduleReminders([], now), [])
  const late = dueScheduleReminders([{
    id: 'late',
    status: 'scheduled',
    pickup_label: 'Lot 5',
    dropoff_label: 'Sikes Hall',
    pickup_at: new Date(now.getTime() - 21 * 60 * 1000).toISOString(),
  }], now)
  assert.deepEqual(late, [])
})
