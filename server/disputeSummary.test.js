import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDisputeSummary, trailMiles } from './disputeSummary.js'

const TRIP = {
  id: '22222222-2222-2222-2222-222222222222',
  rider_id: 'r', driver_id: 'd', status: 'completed',
  pickup_label: 'Core Campus', dropoff_label: 'GSP Airport',
  pickup_lat: 34.6784, pickup_lng: -82.8397, dropoff_lat: 34.8957, dropoff_lng: -82.2189,
  fare_cents: 9800, wait_fee_cents: 300, tip_cents: 1000, surge_multiplier: 1.2,
  fare_breakdown: { rider_pays_cents: 8500, surge_label: 'Game day', student_discount_cents: 500 },
  payment_status: 'paid',
  requested_at: '2026-10-10T13:00:00Z', accepted_at: '2026-10-10T13:02:00Z',
  arrived_at: '2026-10-10T13:10:00Z', pickup_at: '2026-10-10T13:19:00Z', completed_at: '2026-10-10T14:40:00Z',
  metadata: { route_distance_m: 64374, route_duration_s: 2700 },
}

test('summary covers route, distance, wait, timestamps, chat, charges', () => {
  const s = buildDisputeSummary({
    trip: TRIP,
    reason: 'I was charged more than the quote',
    messages: [
      { sender_id: 'r', body: 'where are you', created_at: '2026-10-10T13:12:00Z' },
      { sender_id: 'd', sender_role: 'driver', body: 'Auto-reply: I am here', created_at: '2026-10-10T13:12:30Z' },
    ],
    events: [{ kind: 'accepted', created_at: '2026-10-10T13:02:00Z' }],
  })
  assert.equal(s.minutes.wait, 9)
  assert.equal(s.minutes.ride, 81)
  assert.equal(s.minutes.quoted, 45)
  assert.equal(s.distance.quotedMiles, 40)
  assert.equal(s.distance.gpsMiles, null)
  assert.equal(s.chat.length, 2)
  assert.equal(s.chat[0].from, 'rider')
  assert.equal(s.charges.discounts, 500)
  assert.ok(s.flags.some((f) => /waited 9 min/.test(f)))
  assert.ok(s.flags.some((f) => /Surge 1.2x/.test(f)))
  assert.ok(s.flags.some((f) => /\$98.00 differs from booking total \$85.00/.test(f)))
  assert.ok(s.flags.some((f) => /81 min vs 45 min/.test(f)))
  assert.match(s.text, /Core Campus → GSP Airport/)
  assert.match(s.text, /no trail recorded/)
  assert.match(s.text, /Rider says: "I was charged more than the quote"/)
  assert.match(s.text, /Oct 10, 9:19 AM ET/)
  assert.match(s.text, /does not decide the dispute or promise a refund/)
  assert.doesNotMatch(s.text, /will (be )?refund/i)
})

test('GPS trail compared to quote', () => {
  const pts = [{ lat: 34.6784, lng: -82.8397 }, { lat: 34.70, lng: -82.80 }, { lat: 34.72, lng: -82.76 }]
  const miles = trailMiles(pts)
  assert.ok(miles > 4 && miles < 6)
  const s = buildDisputeSummary({ trip: { ...TRIP, metadata: { route_distance_m: 3000 } }, gpsPoints: pts })
  assert.equal(s.distance.gpsSource, 'gps-trail')
  assert.ok(s.flags.some((f) => /over the quoted/.test(f)))
})

test('clean trip has no review points; canceled trip shows cancel time', () => {
  const s = buildDisputeSummary({ trip: { id: 'x', status: 'canceled', canceled_at: '2026-10-10T13:05:00Z', cancel_fee_cents: 500 } })
  assert.ok(s.flags.some((f) => /Cancel fee charged: \$5.00/.test(f)))
  assert.match(s.text, /canceled Oct 10/)
  const clean = buildDisputeSummary({ trip: { id: 'y', status: 'completed', fare_cents: 1000, payment_status: 'paid' } })
  assert.deepEqual(clean.flags, [])
  assert.throws(() => buildDisputeSummary({}))
})

test('dispute endpoint: rider opens, driver reads, stranger blocked', async () => {
  const { default: handler } = await import('../api/trip-messages.js')
  const store = { summary: null, ticket: null }
  const sb = {
    from(table) {
      const q = {
        _table: table,
        select() { return q }, eq() { return q }, update() { return q },
        insert(row) { if (table === 'support_tickets') store.ticket = row; else store.summary = { id: 's1', ...row }; return q },
        async maybeSingle() {
          if (table === 'support_tickets') return { data: { id: 't1' } }
          return { data: store.summary }
        },
      }
      return q
    },
  }
  const deps = (user) => ({ sb, user, access: { support: false }, loadDisputeInputs: async () => ({ trip: TRIP, events: [], messages: [], gpsPoints: [] }) })
  const call = async (user, action, body) => {
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
    await handler({ method: 'POST', url: `/api/trip-messages?action=${action}`, headers: {}, body }, res, deps(user))
    return { status: res.statusCode, json: JSON.parse(res.body) }
  }
  assert.equal((await call({ id: 'd' }, 'dispute', { tripId: TRIP.id, reason: 'too much money' })).status, 403)
  assert.equal((await call({ id: 'r' }, 'dispute', { tripId: TRIP.id, reason: 'no' })).status, 400)
  const opened = await call({ id: 'r' }, 'dispute', { tripId: TRIP.id, reason: 'Charged more than quoted' })
  assert.equal(opened.status, 200)
  assert.equal(store.ticket.category, 'ride_dispute')
  assert.equal(store.ticket.metadata.trip_id, TRIP.id)
  assert.match(store.summary.summary_text, /FARE DISPUTE SUMMARY/)
  const driverView = await call({ id: 'd' }, 'dispute-summary', { tripId: TRIP.id })
  assert.equal(driverView.status, 200)
  assert.match(driverView.json.dispute.summary_text, /Review points/)
  assert.equal((await call({ id: 'z' }, 'dispute-summary', { tripId: TRIP.id })).status, 403)
})
