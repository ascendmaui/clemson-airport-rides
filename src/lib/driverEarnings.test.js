import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PLATFORM_FEE_RATE,
  TAX_DISCLAIMER,
  buildAnnualTaxCsv,
  buildAnnualTaxSummary,
  sanitizeCompletedTripForDriver,
  summarizeDriverEarnings,
} from './driverEarnings.js'

const TZ = 'America/New_York'
const NOW = new Date('2026-09-23T18:00:00Z')

function trip(partial) {
  return sanitizeCompletedTripForDriver({
    id: partial.id,
    status: 'completed',
    fare_cents: partial.fare,
    pickup_label: partial.pickup || '123 Main Street, Clemson, SC',
    dropoff_label: partial.dropoff || 'Memorial Stadium',
    pickup_lat: 34.6834,
    pickup_lng: -82.8374,
    dropoff_lat: 34.6788,
    dropoff_lng: -82.843,
    completed_at: partial.at,
    accepted_at: partial.accepted || null,
    metadata: partial.metadata || {},
    tip_cents: partial.tip,
    ...partial.extra,
  }, { riderName: partial.rider || 'Jordan Lee', payments: partial.payments || [] })
}

test('driver net subtracts a 20% platform fee and keeps tips', () => {
  assert.equal(PLATFORM_FEE_RATE, 0.2)
  const row = trip({
    id: 't1',
    fare: 10000,
    at: '2026-09-23T15:00:00Z',
    tip: 500,
    metadata: { wait_fee_cents: 200 },
  })
  assert.equal(row.platformFeeCents, 2000)
  assert.equal(row.netFareCents, 8000)
  assert.equal(row.tipCents, 500)
  assert.equal(row.waitFeeCents, 200)
  assert.equal(row.earnedCents, 8700)
  assert.equal(row.riderFirstName, 'Jordan')
  assert.equal(row.pickupLabel, 'Clemson area')
  assert.equal(JSON.stringify(row).includes('Main Street'), false)
  assert.equal(JSON.stringify(row).includes('Lee'), false)
  assert.notEqual(row.pickupApprox.lat, 34.6834)
})

test('today, week, and projected net use Monday weeks and recent pace', () => {
  const trips = [
    trip({ id: 'mon', fare: 3750, at: '2026-09-21T15:00:00Z' }),
    trip({ id: 'tue', fare: 3750, at: '2026-09-22T15:00:00Z' }),
    trip({ id: 'wed', fare: 3750, at: '2026-09-23T15:00:00Z' }),
    trip({ id: 'trail', fare: 3500, at: '2026-09-01T15:00:00Z' }),
  ]
  const summary = summarizeDriverEarnings(trips, { now: NOW, timeZone: TZ })
  assert.equal(summary.todayTripCount, 1)
  assert.equal(summary.todayEarningsCents, 3000)
  assert.equal(summary.weekTripCount, 3)
  assert.equal(summary.weekEarningsCents, 9000)
  assert.equal(summary.elapsedDays, 3)
  assert.equal(summary.remainingDays, 4)
  assert.equal(summary.paceSource, 'week_pace_blended_with_28_day')
  assert.equal(summary.projectedRemainderCents, 8520)
  assert.equal(summary.projectedWeekCents, 17520)
  assert.equal(summary.days[2].isToday, true)
  assert.equal(summary.days[2].earningsCents, 3000)
  assert.equal(summary.rides[0].id, 'wed')
})

test('annual tax summary is calendar year, net of 20%, with a records disclaimer', () => {
  const trips = [
    trip({ id: 'this-year', fare: 10000, at: '2026-12-31T23:30:00-05:00', tip: 250 }),
    trip({ id: 'next-year', fare: 10000, at: '2027-01-01T00:30:00-05:00' }),
  ]
  const summary = buildAnnualTaxSummary(trips, { year: 2026, timeZone: TZ })
  assert.equal(summary.tripCount, 1)
  assert.equal(summary.grossFareCents, 10000)
  assert.equal(summary.platformFeeCents, 2000)
  assert.equal(summary.netFareCents, 8000)
  assert.equal(summary.tipsCents, 250)
  assert.equal(summary.waitFeeCents, null)
  assert.equal(summary.driverNetCents, 8250)
  assert.equal(summary.disclaimer, TAX_DISCLAIMER)

  const csv = buildAnnualTaxCsv(summary)
  assert.match(csv, /not official IRS form — summary for your records/)
  assert.match(csv, /Platform fees 20%/)
  assert.match(csv, /not tracked/)
  assert.equal(csv.includes('Main Street'), false)
  assert.equal(csv.includes('Lee'), false)
  assert.match(csv, /Jordan/)
})
