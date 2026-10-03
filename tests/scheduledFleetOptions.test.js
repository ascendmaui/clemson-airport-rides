import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import scheduleTripHandler from '../server/endpoints/scheduleTrip.js'
import {
  validateSchedule,
  approxPin,
  pinForDisplay,
  toRiderScheduleCard,
  toDriverQueueCard,
  distanceFareCents,
  ATL_FLOOR_CENTS,
} from '../src/lib/scheduledRideModel.js'
import { priceScheduledRequest } from '../server/authoritativeFare.js'
import {
  teslaFleetNotice,
  tripTags,
  toDriverCard,
  declineDisposition,
  declineActionLabel,
} from '../packages/rides-native/tripTags.js'

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function callHandler(handler, req, deps) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res, deps)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = null
  }
  return { status: res.statusCode, json }
}

function createFakeSb() {
  const tripsInserted = []
  const tripEventsInserted = []
  const sb = {
    tripsInserted,
    tripEventsInserted,
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        lte() { return chain },
        gte() { return chain },
        order() { return chain },
        limit() {
          if (table === 'game_day_events') return Promise.resolve({ data: [], error: null })
          return chain
        },
        async single() {
          if (table === 'trips') {
            const lastTrip = tripsInserted[tripsInserted.length - 1]
            return {
              data: {
                id: 'trip_sched_123',
                status: lastTrip?.status || 'scheduled',
                pickup_at: lastTrip?.pickup_at || null,
                pickup_label: lastTrip?.pickup_label || 'Campus',
                dropoff_label: lastTrip?.dropoff_label || 'GSP',
                fare_cents: lastTrip?.fare_cents || 3500,
                deposit_cents: lastTrip?.deposit_cents || 0,
              },
              error: null,
            }
          }
          return { data: null, error: null }
        },
        insert(row) {
          if (table === 'trips') tripsInserted.push(row)
          if (table === 'trip_events') tripEventsInserted.push(row)
          return chain
        },
      }
      return chain
    },
  }
  return sb
}

const mockStudentUser = {
  id: 'usr_student_clemson',
  email: 'tiger@clemson.edu',
  email_confirmed_at: '2026-09-01T12:00:00.000Z',
  user_metadata: { full_name: 'Tiger Student' },
}

const mockRegularUser = {
  id: 'usr_regular_rider',
  email: 'rider@gmail.com',
  email_confirmed_at: '2026-09-01T12:00:00.000Z',
  user_metadata: { full_name: 'Regular Rider' },
}

const defaultPlaces = {
  pickup: { label: 'Cooper Library', lat: 34.6783, lng: -82.8354 },
  dropoff: { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 },
}

describe('Scheduled rides & Tesla fleet option validation', () => {
  test('validateSchedule enforces minimum 30 minute lead time', () => {
    const now = new Date('2026-10-01T12:00:00.000Z')
    // 15 minutes ahead -> rejected
    const tooSoon = validateSchedule({
      date: '2026-10-01',
      time: '08:15', // 12:15 UTC in EDT
      pickup: defaultPlaces.pickup,
      dropoff: defaultPlaces.dropoff,
      now,
    })
    assert.equal(tooSoon.ok, false)
    assert.ok(tooSoon.errors.includes('Schedule at least 30 minutes ahead.'))

    // 45 minutes ahead -> accepted
    const future = new Date(now.getTime() + 45 * 60 * 1000)
    const valid = validateSchedule({
      date: '2026-10-01',
      time: '12:45',
      pickup: defaultPlaces.pickup,
      dropoff: defaultPlaces.dropoff,
      now,
    })
    assert.equal(valid.ok, true)
    assert.equal(valid.errors.length, 0)
    assert.ok(valid.pickupAt instanceof Date)
  })

  test('validateSchedule requires distinct pickup and dropoff locations', () => {
    const now = new Date('2026-10-01T12:00:00.000Z')
    const same = validateSchedule({
      date: '2026-10-02',
      time: '14:00',
      pickup: { label: 'Sikes Hall', lat: 34.678, lng: -82.835 },
      dropoff: { label: 'Sikes Hall', lat: 34.678, lng: -82.835 },
      now,
    })
    assert.equal(same.ok, false)
    assert.ok(same.errors.includes('Pickup and drop-off need to be different places.'))
  })

  test('distanceFareCents respects ATL floor cents for Atlanta trips', () => {
    const shortMeters = 5000 // ~3.1 miles
    const standardFare = distanceFareCents(shortMeters, null)
    assert.ok(standardFare < ATL_FLOOR_CENTS)

    const atlFare = distanceFareCents(shortMeters, 'ATL')
    assert.equal(atlFare, ATL_FLOOR_CENTS)
  })

  test('approxPin masks exact coordinates until trip is completed', () => {
    const rawLat = 34.6784321
    const rawLng = -82.8356789
    const approx = approxPin(rawLat, rawLng)
    assert.equal(approx.lat, 34.678)
    assert.equal(approx.lng, -82.836)

    const scheduledTrip = {
      status: 'scheduled',
      pickup_lat: rawLat,
      pickup_lng: rawLng,
    }
    assert.equal(pinForDisplay(scheduledTrip), null)

    const acceptedTrip = {
      status: 'accepted',
      pickup_lat: rawLat,
      pickup_lng: rawLng,
    }
    assert.equal(pinForDisplay(acceptedTrip), null)

    const completedTrip = {
      status: 'completed',
      pickup_lat: rawLat,
      pickup_lng: rawLng,
    }
    assert.equal(pinForDisplay(completedTrip), '~34.678, -82.836')
  })

  test('toDriverQueueCard sanitizes rider info to first name only', () => {
    const row = {
      id: 'sched_456',
      status: 'scheduled',
      pickup_label: 'Memorial Stadium',
      dropoff_label: 'Cooper Library',
      fare_cents: 1200,
      pickup_at: '2026-10-02T22:00:00.000Z',
      rider_note: 'Tailgate ride',
      passengers: 2,
      metadata: {
        purpose: 'party_weekend',
        rider_first_name: 'Tiger Student (Senior)',
      },
    }
    const card = toDriverQueueCard(row)
    assert.equal(card.id, 'sched_456')
    assert.equal(card.firstName, 'Tiger')
    assert.equal(card.purpose, 'Weekend / party')
    assert.equal(card.passengers, 2)
    assert.equal(card.pickupLat, undefined)
    assert.equal(card.dropoffLat, undefined)
  })
})

describe('Scheduled rides Tesla option flags and pricing', () => {
  test('priceScheduledRequest suppresses student discount when tier is tesla', () => {
    const pickup = { label: 'Campus', lat: 34.678, lng: -82.835 }
    const dropoff = { label: 'Downtown', lat: 34.683, lng: -82.837 }
    const at = new Date('2026-10-02T15:00:00.000Z')

    const standardStudent = priceScheduledRequest({
      pickup,
      dropoff,
      at,
      isStudent: true,
      tier: 'standard',
    })
    assert.equal(standardStudent.isStudent, true)
    assert.ok(standardStudent.discountCents > 0)

    const teslaStudent = priceScheduledRequest({
      pickup,
      dropoff,
      at,
      isStudent: true,
      tier: 'tesla',
    })
    assert.equal(teslaStudent.isStudent, false)
    assert.equal(teslaStudent.discountCents, 0)
    assert.equal(teslaStudent.tier, 'tesla')
    assert.ok(teslaStudent.fareCents > standardStudent.fareCents)
  })

  test('scheduleTrip endpoint flags tier: tesla with tesla_model_3 fleet metadata', async () => {
    const sb = createFakeSb()
    const validFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const res = await callHandler(
      scheduleTripHandler,
      {
        method: 'POST',
        body: {
          ...defaultPlaces,
          pickupAt: validFuture,
          purpose: 'party_weekend',
          tier: 'tesla',
          passengers: 3,
        },
      },
      {
        user: mockStudentUser,
        sb,
        ensureProfile: async () => ({ ok: true }),
      },
    )

    assert.equal(res.status, 200)
    assert.equal(res.json.studentDiscountApplied, false)
    assert.equal(res.json.discountCents, 0)

    assert.equal(sb.tripsInserted.length, 1)
    const trip = sb.tripsInserted[0]
    assert.equal(trip.tier, 'tesla')
    assert.equal(trip.metadata.tesla, true)
    assert.equal(trip.metadata.fleet, 'tesla_model_3')
    assert.equal(trip.metadata.purpose, 'party_weekend')
    assert.equal(trip.passengers, 3)

    // Verify trip event was recorded with scheduled kind
    assert.equal(sb.tripEventsInserted.length, 1)
    assert.equal(sb.tripEventsInserted[0].kind, 'scheduled')
  })

  test('scheduleTrip endpoint sanitizes invalid or robotaxi tier to standard', async () => {
    const sb = createFakeSb()
    const validFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const res = await callHandler(
      scheduleTripHandler,
      {
        method: 'POST',
        body: {
          ...defaultPlaces,
          pickupAt: validFuture,
          purpose: 'planned',
          tier: 'autonomous_robotaxi', // Not a supported tier; must sanitize
        },
      },
      {
        user: mockRegularUser,
        sb,
        ensureProfile: async () => ({ ok: true }),
      },
    )

    assert.equal(res.status, 200)
    assert.equal(sb.tripsInserted.length, 1)
    const trip = sb.tripsInserted[0]
    assert.equal(trip.tier, 'standard')
    assert.equal(trip.metadata.tesla, false)
    assert.equal(trip.metadata.fleet, 'standard')
  })
})

describe('Trip tags and driver card stub notices for Tesla fleet', () => {
  test('tripTags and toDriverCard generate tesla stub flag and notice', () => {
    const row = {
      id: 'trip_tesla_1',
      status: 'scheduled',
      tier: 'tesla',
      pickup_at: '2026-10-02T22:00:00.000Z',
      pickup_label: 'Memorial Stadium',
      dropoff_label: 'GSP Airport',
      metadata: {
        tesla: true,
        fleet: 'tesla_model_3',
        purpose: 'party_weekend',
      },
    }

    const tags = tripTags(row)
    assert.ok(tags.includes('tesla'))
    assert.ok(tags.includes('scheduled'))
    assert.ok(tags.includes('weekend_party'))

    const card = toDriverCard(row)
    assert.equal(card.teslaStub, true)
    assert.equal(card.tags.includes('tesla'), true)
    assert.equal(teslaFleetNotice(card.teslaStub), null)
    assert.equal(card.tagLabels.some((label) => /tesla|self-driving|robotaxi/i.test(label)), false)
  })

  test('scheduled ride decline disposition is leave, not cancel', () => {
    assert.equal(declineDisposition('scheduled'), 'leave')
    assert.equal(declineActionLabel('scheduled'), 'Not this one')

    assert.equal(declineDisposition('requested'), 'cancel')
    assert.equal(declineActionLabel('requested'), 'Decline and cancel')

    assert.equal(declineDisposition('searching'), 'release')
    assert.equal(declineActionLabel('searching'), 'Decline')
  })
})
