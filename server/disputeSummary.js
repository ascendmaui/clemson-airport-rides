/**
 * Fare dispute summary builder. Pure: takes rows already loaded from Supabase and
 * returns structured facts, review flags, and a ready-to-paste text summary.
 * Only states what the records show; never decides the dispute or promises a refund.
 */

const MI_PER_M = 1 / 1609.344

function cents(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : null
}
export function money(value) {
  const n = cents(value)
  return n == null ? '—' : `$${(n / 100).toFixed(2)}`
}
function iso(value) {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
function minutesBetween(a, b) {
  const x = Date.parse(a)
  const y = Date.parse(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < x) return null
  return Math.round((y - x) / 60000)
}
function haversineMiles(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every((v) => Number.isFinite(Number(v)))) return null
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}
export function formatClock(value, tz = 'America/New_York') {
  const when = iso(value)
  if (!when) return '—'
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(when)) + ' ET'
}

/** Sum of GPS segment distances (miles) from ordered {lat,lng} points, or null. */
export function trailMiles(points = []) {
  let total = 0
  let used = 0
  for (let i = 1; i < points.length; i++) {
    const seg = haversineMiles(points[i - 1], points[i])
    if (seg == null || seg > 5) continue // drop jumps
    total += seg
    used += 1
  }
  return used ? total : null
}

function firstEvent(events, kinds) {
  const hit = events.find((e) => kinds.includes(e.kind))
  return hit ? hit.created_at : null
}

/**
 * @param {object} input
 * @param {object} input.trip       trips row
 * @param {object[]} [input.events] trip_events rows
 * @param {object[]} [input.messages] trip_messages rows (with sender_role or sender_id)
 * @param {object[]} [input.gpsPoints] ordered GPS fixes, if a trail exists
 * @param {string} [input.reason]   what the rider said
 */
export function buildDisputeSummary({ trip, events = [], messages = [], gpsPoints = [], reason = '' }) {
  if (!trip?.id) throw new Error('trip required')
  const meta = trip.metadata || {}
  const fb = trip.fare_breakdown || {}
  const ordered = [...events].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  const timeline = {
    requested: iso(trip.requested_at || firstEvent(ordered, ['requested'])),
    accepted: iso(trip.accepted_at || firstEvent(ordered, ['accepted'])),
    arrived: iso(trip.arrived_at || firstEvent(ordered, ['arrived'])),
    started: iso(trip.pickup_at || firstEvent(ordered, ['in_progress'])),
    completed: iso(trip.completed_at || firstEvent(ordered, ['completed'])),
    canceled: iso(trip.canceled_at || firstEvent(ordered, ['canceled', 'driver_canceled', 'cancelled_wait'])),
  }
  const waitMinutes = minutesBetween(timeline.arrived, timeline.started)
  const rideMinutes = minutesBetween(timeline.started, timeline.completed)

  const quotedMiles = Number.isFinite(Number(meta.route_distance_m)) ? Number(meta.route_distance_m) * MI_PER_M : null
  const quotedMinutes = Number.isFinite(Number(meta.route_duration_s)) ? Math.round(Number(meta.route_duration_s) / 60) : null
  const gps = trailMiles(gpsPoints)
  const straight = haversineMiles({ lat: trip.pickup_lat, lng: trip.pickup_lng }, { lat: trip.dropoff_lat, lng: trip.dropoff_lng })

  const charges = {
    fare: cents(trip.fare_cents),
    quotedRiderPays: cents(fb.rider_pays_cents ?? meta.billing_fare_cents),
    paid: cents(meta.fare_paid_cents),
    waitFee: cents(trip.wait_fee_cents),
    cancelFee: cents(trip.cancel_fee_cents),
    switchFee: cents(trip.switch_fee_cents),
    tip: cents(trip.tip_cents),
    boost: cents(trip.boost_cents),
    surgeMultiplier: Number(trip.surge_multiplier) > 1 ? Number(trip.surge_multiplier) : null,
    surgeLabel: fb.surge_label || null,
    discounts: (cents(fb.student_discount_cents) || 0) + (cents(fb.schedule_discount_cents) || 0) + (cents(fb.credit_discount_cents) || 0) + (cents(fb.carpool_discount_cents) || 0),
    paymentStatus: trip.payment_status || null,
    fareIsEstimate: Boolean(meta.fare_is_estimate),
  }

  const flags = []
  if (waitMinutes != null && waitMinutes > 5) flags.push(`Driver waited ${waitMinutes} min at pickup${charges.waitFee ? ` (wait fee ${money(charges.waitFee)})` : ''}.`)
  if (charges.cancelFee) flags.push(`Cancel fee charged: ${money(charges.cancelFee)}.`)
  if (charges.surgeMultiplier) flags.push(`Surge ${charges.surgeMultiplier}x applied${charges.surgeLabel ? ` (${charges.surgeLabel})` : ''}.`)
  if (charges.fareIsEstimate) flags.push('Fare was shown as an estimate at booking.')
  if (charges.quotedRiderPays != null && charges.fare != null && Math.abs(charges.fare - charges.quotedRiderPays) >= 100) {
    flags.push(`Final fare ${money(charges.fare)} differs from booking total ${money(charges.quotedRiderPays)}.`)
  }
  if (gps != null && quotedMiles) {
    const ratio = gps / quotedMiles
    if (ratio > 1.25) flags.push(`GPS distance ${gps.toFixed(1)} mi is ${Math.round((ratio - 1) * 100)}% over the quoted ${quotedMiles.toFixed(1)} mi.`)
    if (ratio < 0.6) flags.push(`GPS distance ${gps.toFixed(1)} mi is well under the quoted ${quotedMiles.toFixed(1)} mi.`)
  }
  if (rideMinutes != null && quotedMinutes && rideMinutes > quotedMinutes * 1.5 && rideMinutes - quotedMinutes >= 10) {
    flags.push(`Ride took ${rideMinutes} min vs ${quotedMinutes} min routed.`)
  }
  if (Array.isArray(trip.stops) && trip.stops.length) flags.push(`${trip.stops.length} extra stop(s) on the trip.`)
  if (charges.paymentStatus && !/paid|succeeded|captured|settled/i.test(charges.paymentStatus)) flags.push(`Payment status: ${charges.paymentStatus}.`)

  const chat = messages
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(-12)
    .map((m) => ({
      at: iso(m.created_at),
      from: m.sender_role || (m.sender_id === trip.driver_id ? 'driver' : m.sender_id === trip.rider_id ? 'rider' : 'other'),
      body: String(m.body || '').slice(0, 240),
    }))

  const distance = {
    quotedMiles: quotedMiles != null ? Number(quotedMiles.toFixed(2)) : null,
    gpsMiles: gps != null ? Number(gps.toFixed(2)) : null,
    straightLineMiles: straight != null ? Number(straight.toFixed(2)) : null,
    gpsSource: gps != null ? 'gps-trail' : 'none',
  }

  const lines = []
  lines.push(`FARE DISPUTE SUMMARY · trip ${String(trip.id).slice(0, 8)} · status ${trip.status}`)
  if (reason) lines.push(`Rider says: "${String(reason).slice(0, 400)}"`)
  lines.push('')
  lines.push(`Route: ${trip.pickup_label || 'pickup'} → ${trip.dropoff_label || 'drop-off'}${Array.isArray(trip.stops) && trip.stops.length ? ` (+${trip.stops.length} stop)` : ''}`)
  lines.push(`Distance: quoted ${distance.quotedMiles ?? '—'} mi · GPS ${distance.gpsMiles ?? 'no trail recorded'}${distance.gpsMiles == null ? '' : ' mi'} · straight line ${distance.straightLineMiles ?? '—'} mi`)
  lines.push(`Time: routed ${quotedMinutes ?? '—'} min · actual ride ${rideMinutes ?? '—'} min · wait at pickup ${waitMinutes ?? '—'} min`)
  lines.push(`Timestamps: requested ${formatClock(timeline.requested)} · accepted ${formatClock(timeline.accepted)} · arrived ${formatClock(timeline.arrived)} · started ${formatClock(timeline.started)} · ${timeline.canceled && !timeline.completed ? `canceled ${formatClock(timeline.canceled)}` : `completed ${formatClock(timeline.completed)}`}`)
  lines.push(`Charges: fare ${money(charges.fare)} (booking total ${money(charges.quotedRiderPays)})${charges.waitFee ? ` · wait fee ${money(charges.waitFee)}` : ''}${charges.cancelFee ? ` · cancel fee ${money(charges.cancelFee)}` : ''}${charges.switchFee ? ` · switch fee ${money(charges.switchFee)}` : ''}${charges.discounts ? ` · discounts −${money(charges.discounts)}` : ''}${charges.tip ? ` · tip ${money(charges.tip)}` : ''} · payment ${charges.paymentStatus || '—'}`)
  lines.push('')
  lines.push(flags.length ? 'Review points:' : 'Review points: none found in the trip record.')
  for (const flag of flags) lines.push(`• ${flag}`)
  lines.push('')
  lines.push(chat.length ? `Chat (last ${chat.length}):` : 'Chat: no messages.')
  for (const m of chat) lines.push(`  [${formatClock(m.at)}] ${m.from}: ${m.body}`)
  lines.push('')
  lines.push('Generated from trip records. This summary does not decide the dispute or promise a refund.')

  return {
    version: 1,
    tripId: trip.id,
    route: { pickup: trip.pickup_label || null, dropoff: trip.dropoff_label || null, stops: Array.isArray(trip.stops) ? trip.stops.length : 0 },
    distance,
    minutes: { quoted: quotedMinutes, ride: rideMinutes, wait: waitMinutes },
    timeline,
    charges,
    flags,
    chat,
    text: lines.join('\n'),
  }
}
