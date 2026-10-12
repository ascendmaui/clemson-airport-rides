/**
 * POST /api/trip-messages?action=dispute          { tripId, reason }  rider contests a fare
 * POST /api/trip-messages?action=dispute-summary  { tripId, refresh? } rider/driver/admin read
 *
 * Files a support_tickets row (category ride_dispute) and stores a summary built from
 * trip data in trip_dispute_summaries. The service role is used only after the caller
 * is verified as a party on the trip or staff.
 */
import { rateLimit } from '../agentHttp.js'
import { loadStaffAccess } from '../staffAccess.js'
import { buildDisputeSummary } from '../disputeSummary.js'

const DISPUTABLE = new Set(['completed', 'canceled', 'canceled_midride', 'cancelled_wait'])
const TRIP_COLS = 'id, rider_id, driver_id, status, pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_cents, tip_cents, wait_fee_cents, cancel_fee_cents, switch_fee_cents, boost_cents, surge_multiplier, fare_breakdown, payment_status, requested_at, accepted_at, arrived_at, pickup_at, completed_at, canceled_at, stops, metadata'

export async function loadDisputeInputs(sb, tripId) {
  const { data: trip } = await sb.from('trips').select(TRIP_COLS).eq('id', tripId).maybeSingle()
  if (!trip) return { trip: null }
  const [events, messages] = await Promise.all([
    sb.from('trip_events').select('kind, created_at').eq('trip_id', tripId).order('created_at', { ascending: true }).limit(200),
    sb.from('trip_messages').select('sender_id, sender_role, body, created_at').eq('trip_id', tripId).order('created_at', { ascending: true }).limit(200),
  ])
  // No per-trip GPS breadcrumb table exists yet (trip_driver_locations keeps the latest fix only).
  return { trip, events: events.data || [], messages: messages.data || [], gpsPoints: [] }
}

function stripMeta(summary) {
  // Keep the stored JSON small and free of route polylines.
  return { ...summary }
}

export async function handleDispute(req, res, { sb, user, body, json, action }, deps = {}) {
  const tripId = String(body?.tripId || '')
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) return json(res, 400, { error: 'tripId required' })
  const inputs = await (deps.loadDisputeInputs || loadDisputeInputs)(sb, tripId)
  const trip = inputs.trip
  if (!trip) return json(res, 404, { error: 'Trip not found' })
  const access = deps.access || await loadStaffAccess(sb, user)
  const role = trip.rider_id === user.id ? 'rider' : trip.driver_id === user.id ? 'driver' : access?.support ? 'admin' : null
  if (!role) return json(res, 403, { error: 'Not a party on this trip.' })

  const existing = await sb.from('trip_dispute_summaries')
    .select('id, ticket_id, status, reason, summary, summary_text, generated_at, opened_role, created_at')
    .eq('trip_id', tripId).maybeSingle()
  if (existing.error && !/does not exist|schema cache/i.test(existing.error.message || '')) {
    return json(res, 500, { error: 'Could not load dispute.' })
  }

  if (action === 'dispute-summary') {
    if (!existing.data) return json(res, 200, { ok: true, dispute: null })
    if (body?.refresh && role === 'admin') {
      const summary = buildDisputeSummary({ ...inputs, reason: existing.data.reason })
      const { data } = await sb.from('trip_dispute_summaries')
        .update({ summary: stripMeta(summary), summary_text: summary.text, generated_at: new Date().toISOString() })
        .eq('id', existing.data.id).select('id, ticket_id, status, reason, summary, summary_text, generated_at, opened_role, created_at').maybeSingle()
      return json(res, 200, { ok: true, dispute: data || existing.data })
    }
    return json(res, 200, { ok: true, dispute: existing.data })
  }

  // action === 'dispute'
  if (role !== 'rider') return json(res, 403, { error: 'Only the rider can dispute this fare.' })
  if (!DISPUTABLE.has(String(trip.status))) return json(res, 400, { error: 'You can dispute a fare after the trip ends.' })
  if (!rateLimit(req, { bucket: 'dispute', userId: user.id, limit: 5, windowMs: 10 * 60_000 })) {
    return json(res, 429, { error: 'Too many requests. Try again in a few minutes.' })
  }
  if (existing.data) return json(res, 200, { ok: true, dispute: existing.data, alreadyOpen: true })
  const reason = String(body?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 1000)
  if (reason.length < 8) return json(res, 400, { error: 'Tell us what looks wrong (at least a few words).' })

  const summary = buildDisputeSummary({ ...inputs, reason })
  const subject = `Fare dispute: ${trip.pickup_label || 'pickup'} → ${trip.dropoff_label || 'drop-off'}`.slice(0, 140)
  const ticket = await sb.from('support_tickets').insert({
    user_id: user.id,
    role_variant: 'rider',
    category: 'ride_dispute',
    subject,
    body: `${reason}\n\nTrip ${trip.id}`.slice(0, 4000),
    metadata: { source: 'dispute-fare', trip_id: trip.id },
  }).select('id').maybeSingle()
  if (ticket.error) console.error('[dispute] ticket', ticket.error.message)

  const inserted = await sb.from('trip_dispute_summaries').insert({
    trip_id: trip.id,
    ticket_id: ticket.data?.id || null,
    opened_by: user.id,
    opened_role: 'rider',
    reason,
    summary: stripMeta(summary),
    summary_text: summary.text,
  }).select('id, ticket_id, status, reason, summary, summary_text, generated_at, opened_role, created_at').maybeSingle()
  if (inserted.error) {
    console.error('[dispute] summary', inserted.error.message)
    return json(res, 500, { error: 'Could not open the dispute. Use Support in the app.' })
  }
  return json(res, 200, { ok: true, dispute: inserted.data })
}
