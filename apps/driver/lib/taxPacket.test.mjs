import assert from 'node:assert/strict'
import test from 'node:test'
import { loadYearEnd, snapshotYearEnd } from './taxPacket.ts'

const NOW = new Date('2026-08-01T16:00:00.000Z')

test('snapshotYearEnd splits routed miles, stored en-route miles, and the configured rate', () => {
  const view = snapshotYearEnd({
    now: NOW,
    year: 2026,
    driverId: 'driver-1',
    logs: [{ trip_id: 't1', enroute_miles: 0.4, enroute_source: 'straight_line' }],
    trips: [
      {
        id: 't1',
        driver_id: 'driver-1',
        status: 'completed',
        fare_cents: 10000,
        tip_cents: 250,
        completed_at: '2026-03-15T16:00:00.000Z',
        pickup_label: '123 Main Street, Clemson, SC',
        dropoff_label: 'GSP Airport',
        metadata: {
          route_distance_m: 1609.344,
          payout: { status: 'paid', amountCents: 6400 },
        },
      },
      {
        id: 'other-driver',
        driver_id: 'driver-2',
        status: 'completed',
        fare_cents: 50000,
        completed_at: '2026-04-01T16:00:00.000Z',
      },
      {
        id: 'plain-cancel',
        driver_id: 'driver-1',
        status: 'canceled',
        fare_cents: 4000,
        canceled_at: '2026-03-20T16:00:00.000Z',
      },
      {
        id: 'last-year',
        driver_id: 'driver-1',
        status: 'completed',
        fare_cents: 9000,
        completed_at: '2025-12-15T16:00:00.000Z',
      },
    ],
  })

  assert.equal(view.source, 'trip-records')
  assert.equal(view.year, 2026)
  assert.equal(view.grossEarningsCents, 10250)
  assert.equal(view.tipsCents, 250)
  assert.equal(view.platformFeeCents, 3600)
  assert.equal(view.driverNetCents, 6650)
  assert.equal(view.payoutsCents, 6400)
  assert.equal(view.earningsTripCount, 1)
  assert.equal(view.onTripMiles, 1)
  assert.equal(view.enrouteMiles, 0.4)
  assert.equal(view.deductibleMiles, 1.4)
  assert.equal(view.estimate, true)
  assert.ok(view.estimatedDeductionCents > 0)
  assert.match(view.rateLabel, /72\.5¢/)
  assert.match(view.disclaimer, /not tax advice/i)
  assert.equal(view.stripe1099Url, 'https://connect.stripe.com/express_login')
  assert.equal(view.trips[0].pickupLabel, 'Clemson area')
  assert.equal(view.trips[0].dropoffLabel, 'Greenville · GSP Airport')
  assert.equal(view.trips.some((trip) => trip.id === 'plain-cancel' || trip.id === 'other-driver'), false)
  assert.doesNotMatch(JSON.stringify(view.trips), /Main Street/)
})

test('loadYearEnd uses the tax summary service when it responds', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      year: 2026,
      years: [2026, 2025],
      timeZone: 'America/New_York',
      grossEarningsCents: 100,
      tipsCents: 0,
      platformFeeCents: 20,
      driverNetCents: 80,
      earningsTripCount: 1,
      payoutsCents: 80,
      pendingPayoutCents: 0,
      onTripMiles: 2,
      enrouteMiles: 0.5,
      deductibleMiles: 2.5,
      enrouteUntrackedTrips: 0,
      estimatedDeductionCents: 181,
      estimate: true,
      rateGap: false,
      rateLabel: 'Estimate using the configured IRS business standard mileage rate.',
      disclaimer: 'This is not tax advice.',
      mileageEstimateNote: 'The mileage deduction is an estimate.',
      stripe1099Note: 'Stripe issues Connect 1099 forms.',
      stripe1099Url: 'https://connect.stripe.com/express_login',
      form1099InfoUrl: 'https://www.irs.gov/forms-pubs/about-form-1099-nec',
      stripeTaxReportingUrl: 'https://docs.stripe.com/connect/tax-reporting',
      trips: [],
    }),
  })
  try {
    const view = await loadYearEnd({
      auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
      from() {
        throw new Error('trip tables should stay unread when the service responds')
      },
    }, 'driver-1', 2026)
    assert.equal(view.source, 'server')
    assert.equal(view.grossEarningsCents, 100)
    assert.equal(view.onTripMiles, 2)
    assert.equal(view.enrouteMiles, 0.5)
    assert.deepEqual(view.years, [2026, 2025])
  } finally {
    globalThis.fetch = original
  }
})

test('loadYearEnd falls back to trip records when the service is down', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('network down')
  }
  const tables = {
    trips: [{
      id: 't1',
      driver_id: 'driver-1',
      status: 'completed',
      fare_cents: 1000,
      tip_cents: 0,
      completed_at: '2026-07-15T16:00:00.000Z',
      pickup_label: 'Clemson University',
      dropoff_label: 'Seneca',
      metadata: { route_distance_m: 3218.688 },
    }],
    driver_mileage_logs: [],
    driver_mileage_rates: [],
  }
  function query(rows) {
    const builder = {
      eq() { return builder },
      in() { return builder },
      order() { return builder },
      limit() { return builder },
      then(resolve, reject) {
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
      },
    }
    return builder
  }
  try {
    const view = await loadYearEnd({
      auth: { getSession: async () => ({ data: { session: null } }) },
      from(table) {
        return { select: () => query(tables[table] || []) }
      },
    }, 'driver-1', 2026)
    assert.equal(view.source, 'trip-records')
    assert.equal(view.onTripMiles, 2)
    assert.match(view.sourceNote, /trip records/i)
    assert.match(view.rateLabel, /76¢/)
  } finally {
    globalThis.fetch = original
  }
})
