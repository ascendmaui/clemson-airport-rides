import assert from 'node:assert/strict'
import test from 'node:test'
import {
  declineDisposition,
  depositSliceCents,
  isAirportDepositPaid,
  isAirportDepositTrip,
  isOpenPoolClaimable,
  isUnpaidAirportDepositTrip,
  queueEmptyCopy,
  scheduledQueueTitle,
  driverNetCents,
  fareCollection,
  isDueNow,
  isSameZonedWeek,
  isWeekendPartyWindow,
  matchesQueueFilter,
  nextTripStatus,
  PREFERRED_REQUEST_NOTE,
  preferredRequestNote,
  summarizeDepositAwareness,
  tagLabel,
  tagTone,
  TESLA_FLEET_NOTICE,
  teslaFleetNotice,
  toDriverCard,
  tripTags,
  weekNetCents,
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
  assert.equal(tagLabel('direct'), 'Preferred by rider')
  assert.equal(preferredRequestNote({ tags }), PREFERRED_REQUEST_NOTE)
  assert.equal(preferredRequestNote({ tags: ['student'] }), null)
  assert.equal(tagTone('Preferred by rider'), 'orange')
  assert.equal(tagTone('Chosen later'), 'purple')
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

test('weekend queue copy names scheduled airport and campus pickups', () => {
  const empty = queueEmptyCopy('weekend_party')
  assert.equal(empty.title, 'No weekend or party rides')
  assert.match(empty.body, /Friday evening through Sunday/)
  assert.match(empty.body, /airport and campus/)
  assert.equal(scheduledQueueTitle('weekend_party'), 'Scheduled weekend and party rides')
  assert.equal(scheduledQueueTitle('all'), 'Scheduled')
  assert.equal(scheduledQueueTitle('student'), 'Scheduled')
  assert.throws(() => queueEmptyCopy('nope'), /Unknown queue filter/)
})

test('Tesla fleet notice is profile-only and appears only when Tesla is selected', () => {
  assert.equal(teslaFleetNotice(false), null)
  assert.equal(teslaFleetNotice(true), TESLA_FLEET_NOTICE)
  assert.match(TESLA_FLEET_NOTICE, /profile option only/)
  assert.match(TESLA_FLEET_NOTICE, /person still drives/)
  assert.match(TESLA_FLEET_NOTICE, /no self-driving dispatch/)
  const tesla = toDriverCard({ id: 't1', status: 'accepted', tier: 'tesla_self_driving', fare_cents: 3600 })
  const standard = toDriverCard({ id: 't2', status: 'accepted', tier: 'standard', fare_cents: 1800 })
  assert.equal(tesla.teslaStub, true)
  assert.equal(teslaFleetNotice(tesla.teslaStub), TESLA_FLEET_NOTICE)
  assert.equal(standard.teslaStub, false)
  assert.equal(teslaFleetNotice(standard.teslaStub), null)
})

test('an explicit party weekend purpose tags the weekend filter and a Tesla tier stays a stub tag', () => {
  const tags = tripTags({
    status: 'scheduled',
    tier: 'tesla',
    pickup_at: '2026-09-30T22:00:00.000Z',
    metadata: { purpose: 'party_weekend', kind: 'scheduled', tesla: true },
  })
  assert.equal(tags.includes('weekend_party'), true)
  assert.equal(tags.includes('tesla'), true)
  assert.equal(tags.includes('scheduled'), true)
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

test('carpool shares replace the listed fare and keep the 25 percent deposit', () => {
  const card = toDriverCard({
    id: 'c1',
    status: 'requested',
    driver_id: 'drv',
    fare_cents: 1800,
    passengers: 3,
    metadata: {
      kind: 'carpool',
      fare_breakdown: {
        carpool: {
          shares: [
            { id: 'a', label: 'Alex', shareCents: 1200 },
            { id: 'b', name: 'Blair', shareCents: 1200 },
          ],
        },
      },
    },
  })
  assert.equal(card.tags.includes('carpool'), true)
  assert.equal(card.passengers, 3)
  const fare = fareCollection(card)
  assert.equal(fare.fareCents, 2400)
  assert.equal(fare.depositCents, 600)
  assert.equal(fare.remainderCents, 1800)
  assert.equal(fare.driverNetCents, 1920)
  assert.equal(fare.platformFeeCents, 480)
  assert.equal(fare.shares[1].label, 'Blair')
})

test('week net uses Monday through Sunday in America/New_York', () => {
  const now = new Date('2026-10-07T15:00:00.000Z')
  assert.equal(isSameZonedWeek('2026-10-05T14:00:00.000Z', now), true)
  assert.equal(isSameZonedWeek('2026-10-04T15:00:00.000Z', now), false)
  assert.equal(weekNetCents([
    { status: 'completed', fare_cents: 1000, completed_at: '2026-10-05T14:00:00.000Z' },
    { status: 'completed', fare_cents: 1000, completed_at: '2026-10-04T15:00:00.000Z' },
    { status: 'canceled', fare_cents: 5000, completed_at: '2026-10-06T15:00:00.000Z' },
  ], now), 800)
})

test('decline keeps an open match available and cancels a chosen-driver request', () => {
  assert.equal(declineDisposition('searching'), 'release')
  assert.equal(declineDisposition('offered'), 'release')
  assert.equal(declineDisposition('scheduled'), 'leave')
  assert.equal(declineDisposition('requested'), 'cancel')
})


test('unpaid airport deposit trips are gated out of the open pool until paid', () => {
  const unpaid = {
    id: 't1',
    status: 'searching',
    deposit_cents: 2500,
    rider_note: null,
    metadata: {
      kind: 'airport',
      purpose: 'airport',
      airport: 'GSP',
      stripe_checkout_session_id: 'cs_1',
    },
  }
  assert.equal(isAirportDepositTrip(unpaid), true)
  assert.equal(isAirportDepositPaid(unpaid), false)
  assert.equal(isUnpaidAirportDepositTrip(unpaid), true)
  assert.equal(isOpenPoolClaimable(unpaid), false)

  const paidViaFare = {
    ...unpaid,
    metadata: { ...unpaid.metadata, fare_paid_cents: 2500 },
  }
  assert.equal(isAirportDepositPaid(paidViaFare), true)
  assert.equal(isUnpaidAirportDepositTrip(paidViaFare), false)
  assert.equal(isOpenPoolClaimable(paidViaFare), true)

  const paidViaStamp = {
    ...unpaid,
    metadata: {
      ...unpaid.metadata,
      checkout_deposit: { session_id: 'cs_1', at: '2026-09-24T14:00:00.000Z' },
    },
  }
  assert.equal(isAirportDepositPaid(paidViaStamp), true)
  assert.equal(isUnpaidAirportDepositTrip(paidViaStamp), false)

  const creditsOnly = {
    id: 't2',
    status: 'searching',
    deposit_cents: 0,
    metadata: { kind: 'airport', purpose: 'airport', airport: 'GSP' },
  }
  assert.equal(isAirportDepositTrip(creditsOnly), false)
  assert.equal(isUnpaidAirportDepositTrip(creditsOnly), false)
  assert.equal(isOpenPoolClaimable(creditsOnly), true)

  const campus = {
    id: 't3',
    status: 'searching',
    deposit_cents: null,
    metadata: { purpose: 'campus' },
  }
  assert.equal(isAirportDepositTrip(campus), false)
  assert.equal(isUnpaidAirportDepositTrip(campus), false)
  assert.equal(isOpenPoolClaimable(campus), true)

  const scheduledAirport = {
    id: 't4',
    status: 'scheduled',
    deposit_cents: 1800,
    rider_note: 'airport',
    metadata: { kind: 'scheduled', airport: 'CLT' },
  }
  assert.equal(isUnpaidAirportDepositTrip(scheduledAirport), true)
  assert.equal(
    isUnpaidAirportDepositTrip({
      ...scheduledAirport,
      metadata: { ...scheduledAirport.metadata, fare_paid_cents: 1800 },
    }),
    false,
  )
})
